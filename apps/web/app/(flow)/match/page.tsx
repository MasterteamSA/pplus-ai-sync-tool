export default function MatchPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Match</h1>
      <p className="opacity-80 max-w-2xl">
        Review how source entities map to each target. Deterministic matches
        (id → key → name → fuzzy) run locally; Claude <code>proposeMapping</code>
        fills the residual. Each row is editable.
      </p>
      <p className="text-sm opacity-60">
        Matching table + AI call lands in the pipeline implementation pass.
      </p>
    </div>
  );
}
