import { db, dbReady, schema } from "@pplus-sync/db";

async function dbStatus(): Promise<{ ok: boolean; users: number; msg: string }> {
  try {
    await dbReady;
    const rows = await db.select({ id: schema.users.id }).from(schema.users);
    return { ok: true, users: rows.length, msg: "embedded PGlite reachable" };
  } catch (e) {
    return { ok: false, users: 0, msg: (e as Error).message };
  }
}

export default async function HomePage() {
  const dbInfo = await dbStatus();

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">PPlus AI Sync Tool</h1>
        <p className="mt-3 max-w-2xl opacity-80">
          Paste a source URL and one or more target URLs; pick which entity kinds
          to sync; review the AI-assisted diff; apply with a single confirm. Every
          run is audited and every write is reversible.
        </p>
        <p className="mt-2 max-w-2xl text-sm opacity-70">
          Runs on any device — the AI layer uses your local{" "}
          <code className="font-mono">claude</code> CLI, so whatever Claude
          subscription (or API key) is already on this machine is what powers
          the tool. No extra credentials required.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Flexible scope", body: "Opt in / out of Dashboards, Charts, Workflows per run." },
          { title: "AI-agentic mapping", body: "Claude proposes matches for renamed entities; you confirm." },
          { title: "Multi-target fan-out", body: "One source → N targets, reviewed and applied independently." },
        ].map((c) => (
          <div key={c.title} className="rounded-lg border border-black/10 dark:border-white/10 p-4">
            <div className="font-medium">{c.title}</div>
            <div className="mt-1 text-sm opacity-75">{c.body}</div>
          </div>
        ))}
      </section>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-4">
        <div className="text-sm font-medium mb-2">System status</div>
        <ul className="text-sm space-y-1">
          <li>
            <Dot ok={dbInfo.ok} /> Storage — <span className="opacity-80">{dbInfo.msg}</span>
            {dbInfo.ok && <span className="opacity-60"> · {dbInfo.users} user(s) seeded</span>}
          </li>
          <li>
            <Dot ok /> AI — <span className="opacity-80">via local Claude Agent SDK</span>
            <a href="/api/ai/ping" className="ml-2 text-xs underline underline-offset-2">
              test ping
            </a>
          </li>
        </ul>
      </section>

      <section className="pt-4">
        <a
          href="/connect"
          className="inline-flex items-center rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium"
        >
          Start a run →
        </a>
      </section>
    </div>
  );
}

function Dot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-block size-2 rounded-full mr-2 align-middle ${ok ? "bg-green-500" : "bg-red-500"}`}
      aria-label={ok ? "ok" : "fail"}
    />
  );
}
