import { NextResponse } from "next/server";
import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";
import { entityKindSchema } from "@pplus-sync/shared";
import type { DiffOp } from "@pplus-sync/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
});

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
  const { target, ops, dryRun } = parsed.data;

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

  for (const rawOp of ops) {
    if (dryRun) {
      results.push({ id: rawOp.id, ok: true, newId: "dry-run" });
      continue;
    }

    // Reshape op so RestConnector.applyChange gets the payload it expects.
    // Our DiffOp may carry the payload on `after`, `before`, or `payload`.
    const after =
      (rawOp.after as unknown) ??
      (rawOp.payload as unknown) ??
      null;
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
      if (!res.ok) break; // abort on first failure
    } catch (e) {
      results.push({ id: rawOp.id, ok: false, error: (e as Error).message });
      break;
    }
  }

  const ok = results.every((r) => r.ok);
  const applied = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok,
    ms: Date.now() - t0,
    applied,
    failed,
    total: ops.length,
    results,
    dryRun,
    targetBaseUrl: connector.baseUrl,
  });
}
