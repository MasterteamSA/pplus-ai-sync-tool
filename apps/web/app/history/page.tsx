export default function HistoryPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">History</h1>
      <p className="opacity-80 max-w-2xl">
        Every run, every target, every op — queryable by date, actor, target
        host, or entity kind. Rollback from any applied run.
      </p>
      <p className="text-sm opacity-60">
        Audit table + rollback action lands in the pipeline implementation pass.
      </p>
    </div>
  );
}
