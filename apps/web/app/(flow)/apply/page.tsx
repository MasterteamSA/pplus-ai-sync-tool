export default function ApplyPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
      <p className="opacity-80 max-w-2xl">
        Select which targets to apply to, toggle the pre-apply rollback snapshot
        per target, type <code>APPLY &lt;targetHost&gt;</code> to confirm, and run.
        Every op produces an audit row; any failure leaves the target restorable
        from the pre-apply snapshot.
      </p>
      <p className="text-sm opacity-60">
        Apply engine + nonce flow lands in the pipeline implementation pass.
      </p>
    </div>
  );
}
