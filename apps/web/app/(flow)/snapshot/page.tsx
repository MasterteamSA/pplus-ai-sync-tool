import { ENTITY_PRESETS } from "@pplus-sync/shared";

export default function SnapshotPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshot</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Pick which entity kinds to sync. Dashboards are <strong>off</strong> by
          default — the safe path is schema-only until you opt in.
        </p>
      </div>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-4">
        <div className="mb-3 text-sm opacity-75">Presets (editable in config/presets.json later):</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ENTITY_PRESETS).map(([name, kinds]) => (
            <div key={name} className="rounded border border-black/10 dark:border-white/10 px-3 py-2 text-sm">
              <div className="font-medium">{name}</div>
              <div className="opacity-70 mt-1 font-mono text-xs">{kinds.join(", ")}</div>
            </div>
          ))}
        </div>
      </section>

      <p className="text-sm opacity-60">
        Per-run selection UI + capture execution lands in the pipeline implementation pass.
      </p>
    </div>
  );
}
