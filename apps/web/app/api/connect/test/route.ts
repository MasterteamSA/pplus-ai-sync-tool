import { NextResponse } from "next/server";
import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";

const body = z.object({
  label: z.string().min(1),
  baseUrl: z.string().url(),
  authMode: z.enum(["cookie", "bearer", "basic"]),
  secret: z.string().optional().default(""),
  csr: z.string().optional().default(""),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
  }
  const { label, baseUrl, authMode, secret, csr } = parsed.data;

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
  const result = await connector.testConnection();
  return NextResponse.json(
    { ...result, normalizedBaseUrl: connector.baseUrl },
    { status: result.ok ? 200 : 502 },
  );
}
