export default function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">PPlus AI Sync Tool</h1>
        <p className="mt-3 max-w-2xl opacity-80">
          Paste a source URL and one or more target URLs; pick which entity kinds
          to sync; review the AI-assisted diff; apply with a single confirm. Every
          run is audited and every write is reversible.
        </p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        {[
          { title: "Flexible scope", body: "Opt in / out of Dashboards, Charts, Workflows per run." },
          { title: "AI-assisted mapping", body: "Claude proposes matches for renamed entities; you confirm." },
          { title: "Multi-target fan-out", body: "One source → N targets, reviewed and applied independently." },
        ].map((c) => (
          <div key={c.title} className="rounded-lg border border-black/10 dark:border-white/10 p-4">
            <div className="font-medium">{c.title}</div>
            <div className="mt-1 text-sm opacity-75">{c.body}</div>
          </div>
        ))}
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
