import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";
import { AutopilotAi } from "@pplus-sync/ai";
import { entityKindSchema } from "@pplus-sync/shared";
import type { Entity } from "@pplus-sync/core";
import { db, schema } from "@pplus-sync/db";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const envSchema = z.object({
  label: z.string().default("env"),
  baseUrl: z.string().url(),
  authMode: z.enum(["cookie", "bearer", "basic"]),
  secret: z.string().default(""),
  csr: z.string().default(""),
});

const body = z.object({
  source: envSchema,
  target: envSchema,
  kinds: z.array(entityKindSchema).min(1),
  limitPerKind: z.number().int().min(1).max(500).default(200),
  maxAiRetries: z.number().int().min(0).max(3).default(1),
  dryRun: z.boolean().default(false),
});

interface Envelope {
  type: "status" | "ai" | "op" | "phase" | "done" | "error";
  phase: "init" | "capture" | "diff" | "apply" | "done";
  ts: number;
  [k: string]: unknown;
}

/**
 * POST /api/autopilot — SSE stream
 * Runs the full sync pipeline end-to-end with Claude in the loop:
 *   1. Capture source + target for each kind.
 *   2. Deterministic diff (create/update/delete) using id → key → name.
 *   3. Apply each op; on failure, ask Claude to repair the payload using
 *      the server error + a real target sample, retry up to maxAiRetries.
 *   4. Every event written to audit_entries so the run is fully replayable.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return new Response(JSON.stringify({ ok: false, error: parsed.error.flatten() }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const input = parsed.data;
  const runId = `auto-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // Seed a run row so audit_entries have a parent.
  try {
    await db.insert(schema.runs).values({
      id: runId,
      sourceCredentialId: input.source.label,
      kinds: input.kinds,
      actor: "autopilot",
      status: "draft",
    } as never).onConflictDoNothing();
  } catch {
    /* non-fatal */
  }

  const encoder = new TextEncoder();
  async function persist(ev: Envelope) {
    try {
      await db.insert(schema.auditEntries).values({
        id: randomUUID(),
        runId,
        stage: ev.phase,
        ok: ev.type !== "error",
        actor: "autopilot",
        message: ev.type,
        payloadRef: JSON.stringify(ev),
      } as never);
    } catch {
      /* non-fatal */
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = async (ev: Omit<Envelope, "ts">) => {
        const full = { ...ev, ts: Date.now() } as Envelope;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(full)}\n\n`));
        await persist(full);
      };
      const srcConn = authConnector(input.source);
      const tgtConn = authConnector(input.target);
      const ai = new AutopilotAi();

      try {
        await send({ type: "status", phase: "init", msg: `Run ${runId} starting`, runId });

        // ── Phase 1: capture ──────────────────────────────────────────
        await send({ type: "phase", phase: "capture", msg: "Capturing source + target" });
        const srcByKind: Record<string, Entity[]> = {};
        const tgtByKind: Record<string, Entity[]> = {};
        for (const kind of input.kinds) {
          const srcBucket: Entity[] = [];
          const tgtBucket: Entity[] = [];
          try {
            for await (const e of srcConn.snapshot([kind])) {
              srcBucket.push(e);
              if (srcBucket.length >= input.limitPerKind) break;
            }
          } catch (err) {
            await send({ type: "error", phase: "capture", msg: `source ${kind}: ${(err as Error).message}` });
          }
          try {
            for await (const e of tgtConn.snapshot([kind])) {
              tgtBucket.push(e);
              if (tgtBucket.length >= input.limitPerKind) break;
            }
          } catch (err) {
            await send({ type: "error", phase: "capture", msg: `target ${kind}: ${(err as Error).message}` });
          }
          srcByKind[kind] = srcBucket;
          tgtByKind[kind] = tgtBucket;
          await send({
            type: "status",
            phase: "capture",
            msg: `captured ${kind}`,
            kind,
            source: srcBucket.length,
            target: tgtBucket.length,
          });
        }

        // ── Phase 2: diff ─────────────────────────────────────────────
        await send({ type: "phase", phase: "diff", msg: "Computing diff" });
        interface Op {
          id: string;
          op: "create" | "update" | "delete";
          kind: string;
          sourceId?: string;
          targetId?: string;
          label: string;
          payload?: unknown;
          sourceEntity?: Entity;
        }
        const ops: Op[] = [];
        for (const kind of input.kinds) {
          const src = srcByKind[kind] ?? [];
          const tgt = tgtByKind[kind] ?? [];
          const used = new Set<string>();
          const byId = new Map(tgt.map((t) => [t.id, t] as const));
          const byKey = new Map(tgt.filter((t) => t.key).map((t) => [t.key!, t] as const));
          const byName = new Map(
            tgt.map((t) => [t.name?.toLowerCase().trim(), t] as const),
          );
          for (const s of src) {
            const m =
              byId.get(s.id) ??
              (s.key ? byKey.get(s.key) : undefined) ??
              byName.get(s.name?.toLowerCase().trim());
            if (!m) {
              ops.push({
                id: `${kind}:create:${s.id}`,
                op: "create",
                kind,
                sourceId: s.id,
                label: `Create ${kind}: ${s.name}`,
                payload: s.payload,
                sourceEntity: s,
              });
              continue;
            }
            used.add(m.id);
            if (s.hash && m.hash && s.hash === m.hash) continue;
            ops.push({
              id: `${kind}:update:${s.id}:${m.id}`,
              op: "update",
              kind,
              sourceId: s.id,
              targetId: m.id,
              label: `Update ${kind}: ${s.name}`,
              payload: s.payload,
              sourceEntity: s,
            });
          }
        }
        await send({ type: "status", phase: "diff", msg: `${ops.length} op(s) planned`, count: ops.length });

        if (input.dryRun) {
          await send({ type: "done", phase: "done", msg: "dryRun — nothing applied", runId, planned: ops.length });
          controller.close();
          return;
        }

        // ── Phase 3: apply with Claude-assisted self-healing ──────────
        await send({ type: "phase", phase: "apply", msg: `Applying ${ops.length} op(s)` });
        let applied = 0;
        let failed = 0;
        for (const op of ops) {
          await send({ type: "op", phase: "apply", msg: `→ ${op.label}`, opId: op.id });
          let attempt = 0;
          let payload = op.payload;
          let lastError = "";
          let ok = false;
          const priorAttempts: string[] = [];
          while (attempt <= input.maxAiRetries) {
            const res = await tgtConn.applyChange({
              id: op.id,
              op: op.op,
              kind: op.kind as never,
              risk: "low",
              ...(op.sourceId ? { sourceId: op.sourceId } : {}),
              ...(op.targetId ? { targetId: op.targetId } : {}),
              ...(payload !== undefined ? { after: payload } : {}),
            });
            if (res.ok) {
              ok = true;
              await send({
                type: "op",
                phase: "apply",
                msg: `✓ ${op.label}`,
                opId: op.id,
                result: "ok",
                ...(res.newId ? { newId: res.newId } : {}),
                attempt,
              });
              break;
            }
            lastError = res.error ?? "unknown";
            await send({
              type: "op",
              phase: "apply",
              msg: `✗ ${op.label} — ${lastError}`,
              opId: op.id,
              result: "fail",
              attempt,
            });
            if (attempt >= input.maxAiRetries) break;
            // Ask Claude to repair.
            await send({ type: "ai", phase: "apply", msg: "Claude is proposing a fix…", opId: op.id });
            const targetSample = tgtByKind[op.kind]?.[0]?.payload;
            const fix = await ai.fixPayload({
              kind: op.kind,
              status: extractStatus(lastError),
              errorBody: lastError,
              sentPayload: payload,
              ...(targetSample !== undefined ? { targetSample } : {}),
              ...(op.sourceEntity?.payload !== undefined
                ? { sourceSample: op.sourceEntity.payload }
                : {}),
              priorAttempts,
            });
            if (!fix.ok) {
              await send({ type: "ai", phase: "apply", msg: `Claude: no safe fix — ${fix.reason}`, opId: op.id });
              break;
            }
            await send({ type: "ai", phase: "apply", msg: `Claude: ${fix.reason}`, opId: op.id });
            priorAttempts.push(fix.reason);
            payload = fix.payload;
            attempt++;
          }
          if (ok) applied++;
          else failed++;
        }

        await send({
          type: "done",
          phase: "done",
          msg: `Finished`,
          runId,
          applied,
          failed,
          total: ops.length,
        });
      } catch (err) {
        await send({ type: "error", phase: "apply", msg: `fatal: ${(err as Error).message}` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

function authConnector(env: z.infer<typeof envSchema>): RestConnector {
  const extra = env.csr ? { csr: env.csr } : undefined;
  const auth =
    env.authMode === "cookie"
      ? { mode: "cookie" as const, cookie: env.secret, ...(extra ? { extraHeaders: extra } : {}) }
      : env.authMode === "bearer"
      ? { mode: "bearer" as const, bearer: env.secret, ...(extra ? { extraHeaders: extra } : {}) }
      : (() => {
          const [u, ...r] = env.secret.split(":");
          return {
            mode: "basic" as const,
            basic: { user: u ?? "", pass: r.join(":") },
            ...(extra ? { extraHeaders: extra } : {}),
          };
        })();
  return new RestConnector({ label: env.label, baseUrl: env.baseUrl, auth });
}

function extractStatus(err: string): number {
  const m = err.match(/HTTP\s+(\d{3})/);
  return m ? Number(m[1]) : 500;
}

