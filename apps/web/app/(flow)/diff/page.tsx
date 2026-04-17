export default function DiffPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Diff</h1>
      <p className="opacity-80 max-w-2xl">
        Per-target visual diff grouped by entity kind. Every <code>rewriteRef</code>
        op is validated against the target key-set before it lands in the plan.
        Click <em>Explain</em> to stream a Claude narration of the changes.
      </p>
      <p className="text-sm opacity-60">
        Diff viewer + explain stream lands in the pipeline implementation pass.
      </p>
    </div>
  );
}
