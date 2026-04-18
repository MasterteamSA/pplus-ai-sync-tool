import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const body = z.object({
  baseUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

/**
 * POST /api/connect/login
 *
 * Authenticates against a PPlus instance and returns the JWT token.
 * Tries multiple login endpoint paths since deployments vary:
 *   /Service/api/users/authenticate  (most common, capital S)
 *   /service/api/users/authenticate  (lowercase)
 *   /Service/api/Authentication/authenticate
 *   /service/api/Authentication/authenticate
 */
export async function POST(req: Request) {
  const parsed = body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ ok: false, error: parsed.error.flatten() }, { status: 400 });
  }
  const { baseUrl, username, password } = parsed.data;
  const origin = new URL(baseUrl).origin;

  const LOGIN_PATHS = [
    "/Service/api/users/authenticate",
    "/service/api/users/authenticate",
    "/Service/api/Authentication/authenticate",
    "/service/api/Authentication/authenticate",
  ];

  const payloads = [
    { UserName: username, Password: password },
    { userName: username, password: password },
    { username, password },
  ];

  for (const path of LOGIN_PATHS) {
    for (const payload of payloads) {
      try {
        const res = await fetch(`${origin}${path}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) continue;

        const json = (await res.json()) as {
          data?: {
            token?: string;
            user?: { displayName?: string; userName?: string };
          };
          cacheSession?: string;
        };

        const token = json?.data?.token;
        if (!token) continue;

        return Response.json({
          ok: true,
          token,
          user: json.data?.user?.displayName ?? json.data?.user?.userName ?? username,
          cacheSession: json.cacheSession,
          loginPath: path,
        });
      } catch {
        continue;
      }
    }
  }

  return Response.json(
    { ok: false, error: "Authentication failed — tried all known PPlus login endpoints" },
    { status: 401 },
  );
}
