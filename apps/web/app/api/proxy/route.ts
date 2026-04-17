import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  url: z.string().url(),
  method: z.enum(["GET", "POST", "PUT", "DELETE"]).default("GET"),
  token: z.string().optional(),
  csr: z.string().optional(),
  body: z.unknown().optional(),
});

/**
 * POST /api/proxy — relay an authenticated request from the server.
 * Used for one-off PPlus calls that don't fit the generic connector
 * (e.g. dashboard Charts/Link where the body shape differs from CRUD).
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { url, method, token, csr, body: reqBody } = parsed.data;
  const headers: Record<string, string> = {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (csr) headers.csr = csr;
  if (reqBody !== undefined) headers["Content-Type"] = "application/json";

  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(reqBody !== undefined ? { body: JSON.stringify(reqBody) } : {}),
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      text: text.slice(0, 2000),
      json,
    });
  } catch (err) {
    const e = err as Error & { cause?: { code?: string; message?: string } };
    const code = e.cause?.code ? `${e.cause.code}: ${e.cause.message ?? e.message}` : e.message;
    return NextResponse.json({ ok: false, status: 0, error: `NETWORK ${code}` });
  }
}
