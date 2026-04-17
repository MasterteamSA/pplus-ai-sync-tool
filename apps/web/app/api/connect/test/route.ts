import { NextResponse } from "next/server";
import { z } from "zod";
import { RestConnector } from "@pplus-sync/connectors";

const body = z.object({
  label: z.string().min(1),
  baseUrl: z.string().url(),
  authMode: z.enum(["cookie", "bearer", "basic"]),
  secret: z.string().optional().default(""),
});

export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "invalid input" }, { status: 400 });
  }
  const { label, baseUrl, authMode, secret } = parsed.data;

  const auth =
    authMode === "cookie"
      ? { mode: "cookie" as const, cookie: secret }
      : authMode === "bearer"
      ? { mode: "bearer" as const, bearer: secret }
      : (() => {
          const [user, ...rest] = secret.split(":");
          return { mode: "basic" as const, basic: { user: user ?? "", pass: rest.join(":") } };
        })();

  const connector = new RestConnector({ label, baseUrl, auth });
  const result = await connector.testConnection();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
