import { NextResponse } from "next/server";
import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";
import { entityKindSchema } from "@pplus-sync/shared";
import type { Entity, EntityKind } from "@pplus-sync/core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  label: z.string().default("source"),
  baseUrl: z.string().url(),
  authMode: z.enum(["cookie", "bearer", "basic"]),
  secret: z.string().default(""),
  csr: z.string().default(""),
  kinds: z.array(entityKindSchema).min(1),
  /** Limit entities returned per kind to keep responses small. */
  limit: z.number().int().min(1).max(5000).default(500),
});

/**
 * POST /api/capture
 * Snapshots the requested entity kinds from a PPlus instance using
 * RestConnector. For perLevel / perLog kinds the connector iterates
 * captured parents; for global kinds it's a single list call.
 *
 * Returns entities grouped by kind with the real payload, hash, key, name.
 * Used by /align and /diff to fetch live data instead of dummy seeds.
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { label, baseUrl, authMode, secret, csr, kinds, limit } = parsed.data;

  const extraHeaders = csr ? { csr } : undefined;
  const auth =
    authMode === "cookie"
      ? { mode: "cookie" as const, cookie: secret, ...(extraHeaders ? { extraHeaders } : {}) }
      : authMode === "bearer"
      ? { mode: "bearer" as const, bearer: secret, ...(extraHeaders ? { extraHeaders } : {}) }
      : (() => {
          const [user, ...rest] = secret.split(":");
          return {
            mode: "basic" as const,
            basic: { user: user ?? "", pass: rest.join(":") },
            ...(extraHeaders ? { extraHeaders } : {}),
          };
        })();

  const connector = new RestConnector({ label, baseUrl, auth });
  const t0 = Date.now();
  const entities: Partial<Record<EntityKind, Entity[]>> = {};
  const errors: Record<string, string> = {};

  const diagnostics: Record<string, { status: number; ct: string; preview: string }> = {};

  for (const k of kinds) {
    const bucket: Entity[] = [];
    try {
      for await (const e of connector.snapshot([k])) {
        bucket.push(e);
        if (bucket.length >= limit) break;
      }
      entities[k] = bucket;
      // When no entities land, probe the same path directly to show why.
      if (bucket.length === 0) {
        try {
          const diag = await connector.diagnoseList(k);
          diagnostics[k] = diag;
        } catch {
          /* ignore */
        }
      }
    } catch (err) {
      errors[k] = (err as Error).message;
    }
  }

  const counts = Object.fromEntries(
    Object.entries(entities).map(([k, list]) => [k, list?.length ?? 0]),
  );

  return NextResponse.json({
    ok: true,
    ms: Date.now() - t0,
    baseUrl: connector.baseUrl,
    counts,
    entities,
    errors: Object.keys(errors).length ? errors : undefined,
    diagnostics: Object.keys(diagnostics).length ? diagnostics : undefined,
  });
}
