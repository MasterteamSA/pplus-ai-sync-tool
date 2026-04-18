import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";
import { AutopilotAi } from "@pplus-sync/ai";
import { entityKindSchema } from "@pplus-sync/shared";
import type { Entity, EntityKind } from "@pplus-sync/core";
import {
  stripServerFields,
  injectTargetId,
  remapReferences,
  rewritePropertyKey,
  type IdMap,
} from "@pplus-sync/core";
import { rewriteFormula } from "@pplus-sync/formula";
import { db, schema } from "@pplus-sync/db";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ─── Input schemas ────────────────────────────────────────────────────── */

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
  limitPerKind: z.number().int().min(1).max(2000).default(500),
  maxAiRetries: z.number().int().min(0).max(100).default(40),
  maxStall: z.number().int().min(1).max(10).default(3),
  dryRun: z.boolean().default(false),
  includeBuiltins: z.boolean().default(false),
  includeDeletes: z.boolean().default(false),
  includeUpdates: z.boolean().default(true),
});

/* ─── Sync ordering (mirrors backend ConfigurationSyncOrchestrator) ──── */

/**
 * The backend syncs in this exact order:
 *  1. Level schema (names, tree structure)
 *  2. Level connections (Sources / parent-child)
 *  3. Log schema
 *  4. Level-attached logs (which logs bind to which levels)
 *  5. Properties (with key adjustment for renamed levels/logs)
 *  6. Log properties
 *  7. Level sections
 *  8. Property statuses
 *  9. Level statuses
 * 10. Phase gates
 * 11. Lookups
 * 12. Workflows
 * 13. Dashboards + chart components
 * 14. Everything else (roles, escalation, procurement, etc.)
 */
const SYNC_ORDER: EntityKind[] = [
  "level",
  "source",             // level connections
  "log",
  "levelAttachedLogs",  // level-log bindings
  "property",
  "logProperty",
  "levelSection",
  "propertyStatus",
  "levelStatus",
  "phaseGate",
  "lookup",
  "workflow",
  "dashboard",
  "chartComponent",
  // Admin kinds last
  "role",
  "escalation",
  "procurement",
  "cardConfig",
  "processBuilder",
  "approvalProcess",
  "codeBuilder",
  "notification",
  // Global admin
  "user",
  "group",
  "classification",
  "scheduleView",
  "setting",
  "holiday",
  "accessibility",
  "delegation",
];

function orderKinds(requested: EntityKind[]): EntityKind[] {
  const set = new Set(requested);
  return SYNC_ORDER.filter((k) => set.has(k));
}

/* ─── Built-in / system record detection ───────────────────────────────── */

function isBuiltin(kind: string, entity: { payload?: unknown }): boolean {
  const p = entity.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return false;
  if (p.canBeDeleted === false) return true;
  if (kind === "log" && p.type === 1) return true;
  if (kind === "log" && typeof p.id === "number" && p.id <= 12) return true;
  if (kind === "lookup" && typeof p.id === "number" && (p.id as number) < 1000) return true;
  return false;
}

/* ─── Entity name helpers ──────────────────────────────────────────────── */

function entityName(e: Entity | { payload?: unknown; name?: string }): string {
  const p = e.payload as Record<string, unknown> | undefined;
  if (e.name) return String(e.name);
  if (!p) return "";
  const raw = p.Name ?? p.name ?? p.displayName ?? p.DisplayName ?? "";
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as { en?: string; ar?: string };
    return obj.en ?? obj.ar ?? "";
  }
  return "";
}

function normalizedName(e: Entity): string {
  return entityName(e).toLowerCase().replace(/[\s_-]+/g, "").trim();
}

/* ─── SSE envelope ─────────────────────────────────────────────────────── */

interface Envelope {
  type: "status" | "ai" | "op" | "phase" | "done" | "error";
  phase: "init" | "capture" | "diff" | "apply" | "done";
  ts: number;
  [k: string]: unknown;
}

/* ─── Main handler ─────────────────────────────────────────────────────── */

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
  const { includeBuiltins, includeDeletes, includeUpdates, maxStall } = input;

  // Seed a run row so audit_entries have a parent.
  try {
    await db.insert(schema.runs).values({
      id: runId,
      sourceCredentialId: input.source.label,
      kinds: input.kinds,
      actor: "autopilot",
      status: "draft",
    } as never).onConflictDoNothing();
  } catch { /* non-fatal */ }

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
    } catch { /* non-fatal */ }
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

        // ── Phase 1: Capture ─────────────────────────────────────────
        await send({ type: "phase", phase: "capture", msg: "Capturing source + target" });
        const srcByKind: Record<string, Entity[]> = {};
        const tgtByKind: Record<string, Entity[]> = {};

        // Always capture levels and logs first — needed for ID mapping.
        const orderedKinds = orderKinds(input.kinds);
        const allKinds = new Set(orderedKinds);
        // Ensure levels and logs are always captured for mapping, even if
        // not explicitly requested for sync.
        const captureKinds = new Set(orderedKinds);
        captureKinds.add("level");
        captureKinds.add("log");

        for (const kind of captureKinds) {
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

        // ── Build ID maps (level + log matching) ─────────────────────
        // This mirrors the backend's LevelMatcher: match by ID, then by
        // normalized name, building source→target maps for both IDs and names.
        const idMap: IdMap = {
          levels: new Map(),
          logs: new Map(),
          levelNames: new Map(),
          logNames: new Map(),
        };

        function buildEntityMap(
          kind: "level" | "log",
          srcEntities: Entity[],
          tgtEntities: Entity[],
        ) {
          const tgtById = new Map(tgtEntities.map((e) => [e.id, e]));
          const tgtByName = new Map(tgtEntities.map((e) => [normalizedName(e), e]));
          const usedTargetIds = new Set<string>();

          for (const src of srcEntities) {
            // Try exact ID match first.
            let matched = tgtById.get(src.id);
            if (matched && !usedTargetIds.has(matched.id)) {
              usedTargetIds.add(matched.id);
            } else {
              // Try normalized name match.
              matched = tgtByName.get(normalizedName(src));
              if (matched && !usedTargetIds.has(matched.id)) {
                usedTargetIds.add(matched.id);
              } else {
                matched = undefined;
              }
            }

            if (matched) {
              if (kind === "level") {
                idMap.levels.set(src.id, matched.id);
                const srcName = entityName(src);
                const tgtName = entityName(matched);
                if (srcName && tgtName && srcName !== tgtName) {
                  idMap.levelNames.set(srcName, tgtName);
                }
              } else {
                idMap.logs.set(src.id, matched.id);
                const srcName = entityName(src);
                const tgtName = entityName(matched);
                if (srcName && tgtName && srcName !== tgtName) {
                  idMap.logNames.set(srcName, tgtName);
                }
              }
            }
          }
        }

        buildEntityMap("level", srcByKind.level ?? [], tgtByKind.level ?? []);
        buildEntityMap("log", srcByKind.log ?? [], tgtByKind.log ?? []);

        await send({
          type: "status",
          phase: "capture",
          msg: `ID maps built: ${idMap.levels.size} levels, ${idMap.logs.size} logs mapped` +
            (idMap.levelNames.size > 0 ? ` · level renames: ${[...idMap.levelNames.entries()].map(([s, t]) => `${s}→${t}`).join(", ")}` : "") +
            (idMap.logNames.size > 0 ? ` · log renames: ${[...idMap.logNames.entries()].map(([s, t]) => `${s}→${t}`).join(", ")}` : ""),
        });

        // Also build a property key map for formula rewriting.
        // Maps source property key → target property key.
        const propertyKeyMap = new Map<string, string>();
        function buildPropertyKeyMap(srcProps: Entity[], tgtProps: Entity[]) {
          const tgtByKey = new Map(tgtProps.filter((e) => e.key).map((e) => [e.key!, e]));
          const tgtByName = new Map(tgtProps.map((e) => [normalizedName(e), e]));

          for (const src of srcProps) {
            if (!src.key) continue;
            // Rewrite the source key using level/log name map.
            const rewrittenKey = rewritePropertyKey(src.key, idMap.levelNames, idMap.logNames);

            // Try to find a matching target property.
            const exact = tgtByKey.get(src.key) ?? tgtByKey.get(rewrittenKey);
            if (exact?.key) {
              if (src.key !== exact.key) {
                propertyKeyMap.set(src.key, exact.key);
              }
              continue;
            }
            // Fall back to name match.
            const byName = tgtByName.get(normalizedName(src));
            if (byName?.key && src.key !== byName.key) {
              propertyKeyMap.set(src.key, byName.key);
            }
          }
        }

        buildPropertyKeyMap(
          [...(srcByKind.property ?? []), ...(srcByKind.logProperty ?? [])],
          [...(tgtByKind.property ?? []), ...(tgtByKind.logProperty ?? [])],
        );

        if (propertyKeyMap.size > 0) {
          await send({
            type: "status",
            phase: "capture",
            msg: `Property key map: ${propertyKeyMap.size} key rewrites identified`,
          });
        }

        // ── Phase 2: Diff ────────────────────────────────────────────
        await send({ type: "phase", phase: "diff", msg: "Computing diff" });

        interface Op {
          id: string;
          op: "create" | "update" | "delete";
          kind: EntityKind;
          sourceId?: string | undefined;
          targetId?: string | undefined;
          parentId?: string | undefined;
          label: string;
          payload?: unknown | undefined;
          sourceEntity?: Entity | undefined;
        }
        const ops: Op[] = [];
        let skippedBuiltin = 0;
        let skippedUpdate = 0;
        let skippedDelete = 0;

        for (const kind of orderedKinds) {
          const src = srcByKind[kind] ?? [];
          const tgt = tgtByKind[kind] ?? [];

          // Build match indexes on target entities.
          const byId = new Map(tgt.map((t) => [t.id, t] as const));
          const byKey = new Map(tgt.filter((t) => t.key).map((t) => [t.key!, t] as const));
          const byName = new Map(tgt.map((t) => [normalizedName(t), t] as const));
          const usedTargetIds = new Set<string>();

          for (const s of src) {
            // For properties, also try matching by rewritten key.
            let rewrittenKey: string | undefined;
            if (s.key && (kind === "property" || kind === "logProperty")) {
              rewrittenKey = rewritePropertyKey(s.key, idMap.levelNames, idMap.logNames);
            }

            const m =
              byId.get(s.id) ??
              (s.key ? byKey.get(s.key) : undefined) ??
              (rewrittenKey ? byKey.get(rewrittenKey) : undefined) ??
              byName.get(normalizedName(s));

            if (!m) {
              // CREATE
              if (!includeBuiltins && isBuiltin(kind, s)) {
                skippedBuiltin++;
                continue;
              }

              // Prepare the create payload.
              let payload = stripServerFields(s.payload);
              payload = remapReferences(payload, idMap);

              // Rewrite property key in payload if level/log was renamed.
              if (kind === "property" || kind === "logProperty") {
                payload = rewritePayloadKey(payload, idMap);
              }
              // Rewrite formulas in the payload.
              if (propertyKeyMap.size > 0) {
                payload = rewritePayloadFormulas(payload, propertyKeyMap);
              }

              // Resolve parentId for perLevel/perLog kinds.
              let parentId: string | undefined;
              if (s.parentId) {
                parentId = idMap.levels.get(s.parentId) ?? idMap.logs.get(s.parentId) ?? s.parentId;
              }

              ops.push({
                id: `${kind}:create:${s.id}`,
                op: "create",
                kind,
                sourceId: s.id,
                parentId,
                label: `Create ${kind}: ${entityName(s)}`,
                payload,
                sourceEntity: s,
              });
              continue;
            }

            usedTargetIds.add(m.id);
            // Skip if content identical.
            if (s.hash && m.hash && s.hash === m.hash) continue;

            // UPDATE
            if (!includeUpdates) {
              skippedUpdate++;
              continue;
            }
            if (!includeBuiltins && (isBuiltin(kind, s) || isBuiltin(kind, m))) {
              skippedBuiltin++;
              continue;
            }

            // Prepare update payload with target ID injected.
            let payload = injectTargetId(s.payload, m.id);
            payload = remapReferences(payload, idMap);

            if (kind === "property" || kind === "logProperty") {
              payload = rewritePayloadKey(payload, idMap);
            }
            if (propertyKeyMap.size > 0) {
              payload = rewritePayloadFormulas(payload, propertyKeyMap);
            }

            let parentId: string | undefined;
            if (m.parentId) {
              parentId = m.parentId; // Keep target's parent for updates.
            } else if (s.parentId) {
              parentId = idMap.levels.get(s.parentId) ?? idMap.logs.get(s.parentId) ?? s.parentId;
            }

            ops.push({
              id: `${kind}:update:${s.id}:${m.id}`,
              op: "update",
              kind,
              sourceId: s.id,
              targetId: m.id,
              parentId,
              label: `Update ${kind}: ${entityName(s)}`,
              payload,
              sourceEntity: s,
            });
          }

          // DELETE (target-only entities)
          if (includeDeletes) {
            for (const t of tgt) {
              if (usedTargetIds.has(t.id)) continue;
              if (!includeBuiltins && isBuiltin(kind, t)) {
                skippedBuiltin++;
                continue;
              }
              ops.push({
                id: `${kind}:delete:${t.id}`,
                op: "delete",
                kind,
                targetId: t.id,
                parentId: t.parentId,
                label: `Delete ${kind}: ${entityName(t)}`,
                sourceEntity: t,
              });
            }
          } else {
            const orphanCount = tgt.filter((t) => !usedTargetIds.has(t.id)).length;
            skippedDelete += orphanCount;
          }
        }

        await send({
          type: "status",
          phase: "diff",
          msg:
            `${ops.length} op(s) planned` +
            (skippedBuiltin ? ` · ${skippedBuiltin} system skipped` : "") +
            (skippedUpdate ? ` · ${skippedUpdate} update(s) skipped (safe mode)` : "") +
            (skippedDelete ? ` · ${skippedDelete} delete(s) skipped (safe mode)` : ""),
          count: ops.length,
          skippedBuiltin,
          skippedUpdate,
          skippedDelete,
        });

        if (input.dryRun) {
          await send({ type: "done", phase: "done", msg: "dryRun — nothing applied", runId, planned: ops.length });
          controller.close();
          return;
        }

        // ── Phase 3: Apply with Claude-assisted self-healing ─────────
        await send({ type: "phase", phase: "apply", msg: `Applying ${ops.length} op(s)` });
        let applied = 0;
        let failed = 0;
        const addedProperties: string[] = [];
        const updatedProperties: string[] = [];
        const addedItems: string[] = [];

        for (const op of ops) {
          await send({ type: "op", phase: "apply", msg: `→ ${op.label}`, opId: op.id });
          let attempt = 0;
          let payload = op.payload;
          let overridePath: string | undefined;
          let lastError = "";
          let prevLastError = "";
          let ok = false;
          let consecutiveStall = 0;
          let consecutiveSameError = 0;
          const priorAttempts: string[] = [];
          const targetSamples = (tgtByKind[op.kind] ?? [])
            .slice(0, 3)
            .map((e) => e.payload)
            .filter((p) => p !== undefined);

          while (true) {
            let res: Awaited<ReturnType<typeof tgtConn.applyChange>>;
            try {
              res = await tgtConn.applyChange(
                {
                  id: op.id,
                  op: op.op,
                  kind: op.kind as never,
                  risk: "low",
                  ...(op.sourceId ? { sourceId: op.sourceId } : {}),
                  ...(op.targetId ? { targetId: op.targetId } : {}),
                  ...(op.parentId ? { parentId: op.parentId } : {}),
                  ...(payload !== undefined ? { after: payload } : {}),
                },
                overridePath ? { overridePath } : undefined,
              );
            } catch (err) {
              res = { ok: false, error: `NETWORK ${(err as Error).message}` };
            }

            if (res.ok) {
              ok = true;
              await send({
                type: "op",
                phase: "apply",
                msg: `✓ ${op.label}${attempt > 0 ? ` (after ${attempt} AI fix${attempt === 1 ? "" : "es"})` : ""}`,
                opId: op.id,
                result: "ok",
                ...(res.newId ? { newId: res.newId } : {}),
                attempt,
              });

              // Track for sync notification.
              if (op.kind === "property" || op.kind === "logProperty") {
                const key = getPayloadKey(payload);
                if (key) {
                  if (op.op === "create") addedProperties.push(key);
                  else if (op.op === "update") updatedProperties.push(key);
                }
              }
              if (op.kind === "lookup" && op.op === "create") {
                addedItems.push(entityName(op.sourceEntity ?? { name: "" }));
              }

              // Dashboard post-create: link charts.
              if (op.op === "create" && op.kind === "dashboard" && res.newId && op.sourceEntity?.payload) {
                await linkDashboardCharts(input.target, res.newId, op.sourceEntity.payload, send, op);
              }
              break;
            }

            prevLastError = lastError;
            lastError = res.error ?? "unknown";

            // Hard stop for explicit server refusals.
            const refusalText = /not allowed|not permitted|forbidden|غير مسموح/i.test(lastError);
            const isMethodNotAllowed = /HTTP\s+405/.test(lastError);
            const isProtected = isMethodNotAllowed || refusalText;

            await send({
              type: "op",
              phase: "apply",
              msg: isProtected
                ? `↷ ${op.label} — target refuses (${summarizeErr(lastError)})`
                : `✗ ${op.label} [attempt ${attempt + 1}] — ${summarizeErr(lastError)}`,
              opId: op.id,
              result: "fail",
              attempt,
            });
            if (isProtected) break;
            if (attempt >= input.maxAiRetries) {
              await send({
                type: "ai",
                phase: "apply",
                msg: `stopping — hit hard cap of ${input.maxAiRetries} AI retries`,
                opId: op.id,
              });
              break;
            }

            const sameAsLast = prevLastError && lastError === prevLastError;
            if (sameAsLast) consecutiveSameError++;
            else consecutiveSameError = 0;

            await send({ type: "ai", phase: "apply", msg: `Claude is proposing a fix… (attempt ${attempt + 1})`, opId: op.id });
            const fix = await ai.fixPayload({
              kind: op.kind,
              status: extractStatus(lastError),
              errorBody: lastError,
              sentPayload: payload,
              ...(targetSamples.length > 0 ? { targetSample: targetSamples } : {}),
              ...(op.sourceEntity?.payload !== undefined
                ? { sourceSample: op.sourceEntity.payload }
                : {}),
              priorAttempts: [
                ...priorAttempts,
                ...(consecutiveSameError >= 1
                  ? [`SAME ERROR REPEATED — try a structurally different approach.`]
                  : []),
              ],
            });

            if (!fix.ok) {
              consecutiveStall++;
              await send({
                type: "ai",
                phase: "apply",
                msg: `Claude: no safe fix — ${fix.reason}${consecutiveStall < maxStall ? " · retrying" : " · giving up"}`,
                opId: op.id,
              });
              if (consecutiveStall >= maxStall) break;
              priorAttempts.push(`attempt ${attempt + 1}: Claude declined — ${fix.reason}`);
              attempt++;
              continue;
            }
            consecutiveStall = 0;
            const pathNote = fix.altPath ? ` · altPath=${fix.altPath}` : "";
            await send({ type: "ai", phase: "apply", msg: `Claude: ${fix.reason}${pathNote}`, opId: op.id });
            priorAttempts.push(
              `attempt ${attempt + 1}: HTTP ${extractStatus(lastError)} → ${fix.reason}${fix.altPath ? ` (altPath=${fix.altPath})` : ""}`,
            );
            payload = fix.payload;
            overridePath = fix.altPath;
            attempt++;
          }
          if (ok) applied++;
          else failed++;
        }

        // Send sync notification to target (best-effort).
        if (applied > 0) {
          try {
            await tgtConn.notifySync({ updatedProperties, addedProperties, addedItems });
          } catch { /* ignore */ }
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

/* ─── Helpers ──────────────────────────────────────────────────────────── */

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

function summarizeErr(err: string): string {
  const s = err.replace(/<!DOCTYPE[\s\S]*?<\/html>/gi, "").replace(/\s+/g, " ").trim();
  try {
    const json = JSON.parse(s.replace(/^HTTP\s+\d{3}\s+/, ""));
    const msg = (json as { error?: string; message?: string }).error ??
                (json as { error?: string; message?: string }).message;
    return msg ? `${(s.match(/HTTP\s+\d{3}/) ?? [""])[0]} ${msg}`.trim() : s.slice(0, 200);
  } catch {
    return s.slice(0, 200);
  }
}

function getPayloadKey(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  return (p.key ?? p.Key) as string | undefined;
}

/**
 * Rewrite the key/Key field inside a payload using the level/log name map.
 */
function rewritePayloadKey(payload: unknown, idMap: IdMap): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = { ...(payload as Record<string, unknown>) };
  const key = (obj.key ?? obj.Key) as string | undefined;
  if (key) {
    const newKey = rewritePropertyKey(key, idMap.levelNames, idMap.logNames);
    if ("key" in obj) obj.key = newKey;
    if ("Key" in obj) obj.Key = newKey;
  }
  return obj;
}

/**
 * Rewrite {{Key}} references in formula/script fields within a payload.
 * Uses the deterministic formula rewriter from @pplus-sync/formula.
 */
function rewritePayloadFormulas(
  payload: unknown,
  keyMap: Map<string, string>,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const obj = { ...(payload as Record<string, unknown>) };
  const formulaFields = ["formula", "Formula", "formulaRaw", "FormulaRaw", "script", "Script"];
  const keyMapObj: Record<string, string> = {};
  for (const [from, to] of keyMap) keyMapObj[from] = to;

  for (const field of formulaFields) {
    const val = obj[field];
    if (typeof val !== "string" || !val.includes("{{")) continue;
    try {
      const result = rewriteFormula(val, keyMapObj);
      if (result.changed) {
        obj[field] = result.after;
      }
    } catch {
      // Leave formula unchanged if rewriter fails.
    }
  }
  return obj;
}

/**
 * Post-create hook for dashboards: link the chart grid to the new dashboard.
 * The metadata POST creates the shell, but chart layout lives at
 * payload.charts.configration and must be POSTed to /Dashboards/Charts/Link.
 */
async function linkDashboardCharts(
  target: z.infer<typeof envSchema>,
  newId: string,
  sourcePayload: unknown,
  send: (ev: Omit<Envelope, "ts">) => Promise<void>,
  op: { id: string; label: string },
) {
  const srcPayload = sourcePayload as {
    charts?: { configration?: string };
  };
  const configration = srcPayload.charts?.configration;
  if (!configration) return;

  try {
    const linkUrl = `${target.baseUrl.replace(/\/$/, "")}/service/api/Dashboards/Charts/Link`;
    const linkRes = await fetch(linkUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest",
        Authorization: `Bearer ${target.secret}`,
        ...(target.csr ? { csr: target.csr } : { csr: "1" }),
      },
      body: JSON.stringify({ DashboardId: String(newId), configration }),
    });
    if (linkRes.ok) {
      await send({
        type: "op", phase: "apply",
        msg: `✓ ${op.label} — charts linked`,
        opId: `${op.id}:link`, result: "ok",
      });
    } else {
      await send({
        type: "op", phase: "apply",
        msg: `✗ ${op.label} — charts NOT linked (HTTP ${linkRes.status})`,
        opId: `${op.id}:link`, result: "fail",
      });
    }
  } catch (e) {
    await send({
      type: "op", phase: "apply",
      msg: `✗ ${op.label} — charts link errored: ${(e as Error).message}`,
      opId: `${op.id}:link`, result: "fail",
    });
  }
}
