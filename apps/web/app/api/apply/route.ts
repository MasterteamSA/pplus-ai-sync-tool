import { NextResponse } from "next/server";
import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";
import { entityKindSchema } from "@pplus-sync/shared";
import type { DiffOp } from "@pplus-sync/core";
import { NEVER_SYNCABLE_KINDS, isBuiltin } from "@/lib/sync-filters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const entityShape = z.object({ payload: z.unknown().optional() }).nullish();

const opSchema = z.object({
  id: z.string(),
  op: z.enum(["create", "update", "delete", "rewriteRef"]),
  kind: entityKindSchema,
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  payload: z.unknown().optional(),
  label: z.string().optional(),
  sourceEntity: entityShape,
  targetEntity: entityShape,
});

const body = z.object({
  target: z.object({
    label: z.string().default("target"),
    baseUrl: z.string().url(),
    authMode: z.enum(["cookie", "bearer", "basic"]),
    secret: z.string().default(""),
    csr: z.string().default(""),
  }),
  ops: z.array(opSchema).min(1),
  dryRun: z.boolean().default(false),
  continueOnError: z.boolean().default(true),
  /** Server-side safe-mode backstop — identical semantics to /autopilot. */
  includeBuiltins: z.boolean().default(false),
  includeUpdates: z.boolean().default(true),
  includeDeletes: z.boolean().default(true),
});

/**
 * Fields PPlus assigns server-side — if we POST them on a create, the
 * server usually 400s or silently ignores with an ambiguous error.
 * Strip them so the target generates its own.
 */
const SERVER_FIELDS = new Set([
  "id", "_id", "Id",
  "createdAt", "CreatedAt", "createdDate",
  "updatedAt", "UpdatedAt", "modifiedAt",
  "createdBy", "CreatedBy", "createdById",
  "updatedBy", "UpdatedBy", "updatedById",
]);

function cleanPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleanPayload);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SERVER_FIELDS.has(k)) continue;
      out[k] = cleanPayload(v);
    }
    return out;
  }
  return value;
}

interface OpResult {
  id: string;
  ok: boolean;
  newId?: string;
  error?: string;
}

/**
 * POST /api/apply
 * Executes the given DiffOps against the target PPlus instance using
 * RestConnector.applyChange. Runs sequentially so that any failure aborts
 * the rest (safer default for config sync than parallel). dryRun returns
 * the planned operations without writing.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { target, ops, dryRun, continueOnError, includeBuiltins, includeUpdates, includeDeletes } = parsed.data;

  // Server-side guardrails: drop ops the target will always refuse. Report
  // them as "skipped" with the reason so the client can surface why nothing
  // happened on those ids.
  const skipped: OpResult[] = [];
  const safeOps = ops.filter((op) => {
    if (NEVER_SYNCABLE_KINDS.has(op.kind)) {
      skipped.push({ id: op.id, ok: false, error: `skipped — kind '${op.kind}' not syncable via flat CRUD` });
      return false;
    }
    if (!includeUpdates && op.op === "update") {
      skipped.push({ id: op.id, ok: false, error: "skipped — updates off" });
      return false;
    }
    if (!includeDeletes && op.op === "delete") {
      skipped.push({ id: op.id, ok: false, error: "skipped — deletes off" });
      return false;
    }
    if (!includeBuiltins) {
      if (isBuiltin(op.kind, op.sourceEntity) || isBuiltin(op.kind, op.targetEntity)) {
        skipped.push({ id: op.id, ok: false, error: "skipped — system/built-in record" });
        return false;
      }
    }
    return true;
  });

  const extraHeaders = target.csr ? { csr: target.csr } : undefined;
  const auth =
    target.authMode === "cookie"
      ? { mode: "cookie" as const, cookie: target.secret, ...(extraHeaders ? { extraHeaders } : {}) }
      : target.authMode === "bearer"
      ? { mode: "bearer" as const, bearer: target.secret, ...(extraHeaders ? { extraHeaders } : {}) }
      : (() => {
          const [user, ...rest] = target.secret.split(":");
          return {
            mode: "basic" as const,
            basic: { user: user ?? "", pass: rest.join(":") },
            ...(extraHeaders ? { extraHeaders } : {}),
          };
        })();

  const connector = new RestConnector({ label: target.label, baseUrl: target.baseUrl, auth });
  const t0 = Date.now();
  const results: OpResult[] = [];

  for (const rawOp of safeOps) {
    if (dryRun) {
      results.push({ id: rawOp.id, ok: true, newId: "dry-run" });
      continue;
    }

    const rawAfter =
      (rawOp.after as unknown) ??
      (rawOp.payload as unknown) ??
      null;
    // Strip server-assigned fields for create; keep as-is for update (the
    // target may need its own id back in the body).
    const after = rawOp.op === "create" ? cleanPayload(rawAfter) : rawAfter;

    const op: DiffOp = {
      id: rawOp.id,
      op: rawOp.op,
      kind: rawOp.kind,
      risk: "low",
      ...(rawOp.sourceId ? { sourceId: rawOp.sourceId } : {}),
      ...(rawOp.targetId ? { targetId: rawOp.targetId } : {}),
      ...(rawOp.before !== undefined ? { before: rawOp.before } : {}),
      ...(after !== undefined ? { after } : {}),
    };

    try {
      const res = await connector.applyChange(op);
      results.push({
        id: rawOp.id,
        ok: res.ok,
        ...(res.newId ? { newId: res.newId } : {}),
        ...(res.error ? { error: res.error } : {}),
      });
      if (!res.ok && !continueOnError) break;
    } catch (e) {
      results.push({ id: rawOp.id, ok: false, error: (e as Error).message });
      if (!continueOnError) break;
    }
  }

  const combined: OpResult[] = [...results, ...skipped];
  const ok = combined.every((r) => r.ok);
  const applied = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const skippedCount = skipped.length;

  return NextResponse.json({
    ok,
    ms: Date.now() - t0,
    applied,
    failed,
    skipped: skippedCount,
    total: ops.length,
    results: combined,
    dryRun,
    targetBaseUrl: connector.baseUrl,
  });
}
