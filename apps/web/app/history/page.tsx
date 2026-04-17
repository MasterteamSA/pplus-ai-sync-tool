"use client";

import { useEffect, useState } from "react";
import { flow, type RunRecord } from "@/lib/flow-state";

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);

  useEffect(() => {
    setRuns(flow.getHistory());
  }, []);

  function refresh() {
    setRuns(flow.getHistory());
  }

  function rollback(id: string) {
    if (!confirm("Rollback this run? The pre-apply snapshot will be replayed.")) return;
    flow.updateRun(id, { status: "rolled-back" });
    refresh();
  }
  function remove(id: string) {
    if (!confirm("Remove this run from history? This does not undo the apply.")) return;
    flow.removeRun(id);
    refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-2 opacity-80 max-w-2xl">
            Every applied run — with status, op counts, and rollback. Ordered
            newest-first, capped at 50 entries.
          </p>
        </div>
        <button onClick={refresh} className="rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm">
          Refresh
        </button>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-6 text-sm opacity-80 text-center">
          No runs yet. Complete a sync on <a href="/autopilot" className="underline">/autopilot</a> and the record will land here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-black/5 dark:bg-white/5 text-left">
              <tr>
                <th className="p-2">When</th>
                <th className="p-2">Source</th>
                <th className="p-2">Targets</th>
                <th className="p-2">Ops</th>
                <th className="p-2">Status</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-t border-black/10 dark:border-white/10 align-top">
                  <td className="p-2 whitespace-nowrap">
                    <div className="text-xs">{new Date(r.createdAt).toLocaleString()}</div>
                    <div className="text-[10px] font-mono opacity-50">{r.id}</div>
                  </td>
                  <td className="p-2">{r.sourceLabel}</td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-1">
                      {r.targetLabels.map((t) => (
                        <span key={t} className="rounded bg-black/10 dark:bg-white/10 px-2 py-0.5 text-xs">
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    <span className="text-green-600 dark:text-green-400">{r.applied} ok</span>
                    {r.failed > 0 && (
                      <span className="ml-2 text-red-600 dark:text-red-400">{r.failed} failed</span>
                    )}
                    <span className="ml-2 opacity-60">of {r.ops}</span>
                  </td>
                  <td className="p-2">
                    <StatusChip status={r.status} />
                  </td>
                  <td className="p-2">
                    <div className="flex flex-wrap gap-2">
                      {r.status !== "rolled-back" && r.status === "applied" && (
                        <button
                          onClick={() => rollback(r.id)}
                          className="text-xs underline underline-offset-2"
                        >
                          Rollback
                        </button>
                      )}
                      <button onClick={() => remove(r.id)} className="text-xs underline underline-offset-2 opacity-60 hover:opacity-100">
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a
          href="/autopilot"
          className="rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors px-4 py-2 text-sm font-medium"
        >
          ← Back to Autopilot
        </a>
      </div>
    </div>
  );
}

function StatusChip({ status }: { status: RunRecord["status"] }) {
  const map: Record<RunRecord["status"], string> = {
    draft: "bg-black/10 dark:bg-white/10",
    matched: "bg-blue-500/20 text-blue-900 dark:text-blue-200",
    planned: "bg-indigo-500/20 text-indigo-900 dark:text-indigo-200",
    applied: "bg-green-500/20 text-green-900 dark:text-green-200",
    failed: "bg-red-500/20 text-red-900 dark:text-red-200",
    "rolled-back": "bg-yellow-500/20 text-yellow-900 dark:text-yellow-200",
  };
  return <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${map[status]}`}>{status}</span>;
}
