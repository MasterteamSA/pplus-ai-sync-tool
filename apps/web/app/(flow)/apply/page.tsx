"use client";

import { useEffect, useMemo, useState } from "react";
import { flow, type DiffOp, type RunRecord } from "@/lib/flow-state";

interface OpResult {
  id: string;
  ok: boolean;
  newId?: string;
  error?: string;
}

interface TargetState {
  label: string;
  baseUrl: string;
  selected: boolean;
  rollback: boolean;
  confirmText: string;
  progress: number;
  status: "idle" | "running" | "done" | "failed";
  failedOpId?: string;
  applied?: number;
  failedCount?: number;
  results?: OpResult[];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export default function ApplyPage() {
  const [ops, setOps] = useState<DiffOp[]>([]);
  const [targets, setTargets] = useState<TargetState[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setOps(flow.getDiff());
    const envs = flow.getEnvs();
    setTargets(
      envs.targets
        .filter((t) => t.baseUrl)
        .map((t) => ({
          label: t.label,
          baseUrl: t.baseUrl,
          selected: true,
          rollback: true,
          confirmText: "",
          progress: 0,
          status: "idle" as const,
        })),
    );
  }, []);

  const selected = useMemo(() => targets.filter((t) => t.selected), [targets]);
  const canApply = useMemo(
    () =>
      !running &&
      ops.length > 0 &&
      selected.length > 0 &&
      selected.every((t) => t.confirmText === `APPLY ${hostOf(t.baseUrl)}`),
    [running, ops, selected],
  );

  const patch = (i: number, p: Partial<TargetState>) =>
    setTargets((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...p } : t)));

  async function apply() {
    setRunning(true);
    const envs = flow.getEnvs();
    const runId = `run-${Date.now()}`;
    const record: RunRecord = {
      id: runId,
      createdAt: new Date().toISOString(),
      actor: "admin",
      sourceLabel: envs.source?.label ?? "source",
      targetLabels: selected.map((t) => t.label),
      kinds: flow.getKinds(),
      ops: ops.length,
      applied: 0,
      failed: 0,
      status: "applied",
      summary: `${ops.length} ops · ${selected.length} target(s)`,
    };
    flow.addRun(record);

    let grandApplied = 0;
    let grandFailed = 0;
    let anyTargetFailed = false;

    for (let i = 0; i < targets.length; i++) {
      const t = targets[i];
      if (!t || !t.selected) continue;
      const envEntry = envs.targets.find((e) => e.label === t.label);
      if (!envEntry) {
        patch(i, { status: "failed", progress: 0, failedOpId: "no-env" });
        anyTargetFailed = true;
        continue;
      }

      patch(i, { status: "running", progress: 0 });
      try {
        const res = await fetch("/api/apply", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            target: {
              label: envEntry.label,
              baseUrl: envEntry.baseUrl,
              authMode: envEntry.authMode,
              secret: envEntry.secret ?? "",
              csr: envEntry.csr ?? "",
            },
            ops,
            dryRun: false,
          }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          applied?: number;
          failed?: number;
          total?: number;
          results?: OpResult[];
          error?: string;
        };

        const applied = body.applied ?? 0;
        const failed = body.failed ?? 0;
        grandApplied += applied;
        grandFailed += failed;

        const firstFail = body.results?.find((r) => !r.ok);
        const done = !res.ok || !body.ok || firstFail;
        if (done) anyTargetFailed = true;
        patch(i, {
          status: done ? "failed" : "done",
          progress: ops.length ? (applied / ops.length) * 100 : 100,
          ...(firstFail?.id ? { failedOpId: firstFail.id } : {}),
          applied,
          failedCount: failed,
          results: body.results ?? [],
        });
      } catch (e) {
        anyTargetFailed = true;
        grandFailed += 1;
        patch(i, { status: "failed", failedOpId: `network: ${(e as Error).message}` });
      }
    }

    flow.updateRun(runId, {
      applied: grandApplied,
      failed: grandFailed,
      status: anyTargetFailed ? "failed" : "applied",
    });
    setRunning(false);
  }

  if (ops.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
        <p className="opacity-80 max-w-2xl">
          No diff operations yet. Go to <a className="underline" href="/diff">Diff</a> to build a plan,
          then come back.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Apply</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Pick which targets to apply to, optionally take a rollback snapshot per
          target, type <code>APPLY &lt;host&gt;</code> to confirm each, then run.
          Every op produces an audit row; rollback restores the pre-apply snapshot.
        </p>
      </div>

      {targets.length === 0 ? (
        <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 text-sm opacity-80">
          No targets configured. Go to <a href="/connect" className="underline">Connect</a> to add one.
        </div>
      ) : (
        <section className="space-y-3">
          {targets.map((t, i) => {
            const host = hostOf(t.baseUrl);
            const needsText = `APPLY ${host}`;
            const confirmed = t.confirmText === needsText;
            return (
              <div
                key={i}
                className={`rounded-lg border p-4 space-y-3 ${
                  t.selected
                    ? "border-black/20 dark:border-white/20"
                    : "border-black/10 dark:border-white/10 opacity-70"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 font-medium">
                    <input
                      type="checkbox"
                      checked={t.selected}
                      onChange={(e) => patch(i, { selected: e.target.checked })}
                    />
                    <span>{t.label}</span>
                    <span className="opacity-60 font-mono text-xs">· {host}</span>
                  </label>
                  <StatusBadge status={t.status} />
                </div>

                <label className="flex items-center gap-2 text-sm opacity-90">
                  <input
                    type="checkbox"
                    checked={t.rollback}
                    onChange={(e) => patch(i, { rollback: e.target.checked })}
                  />
                  Create pre-apply rollback snapshot
                </label>

                <div>
                  <div className="text-xs opacity-70 mb-1">
                    Type <code className="font-mono">{needsText}</code> to confirm
                  </div>
                  <input
                    value={t.confirmText}
                    onChange={(e) => patch(i, { confirmText: e.target.value })}
                    placeholder={needsText}
                    className={`w-full rounded border bg-transparent p-2 text-sm font-mono ${
                      confirmed
                        ? "border-green-500/60"
                        : "border-black/10 dark:border-white/10"
                    }`}
                    disabled={t.status === "running" || t.status === "done"}
                  />
                </div>

                {(t.status !== "idle" || t.progress > 0) && (
                  <div className="space-y-2">
                    <div className="h-2 w-full bg-black/10 dark:bg-white/10 rounded overflow-hidden">
                      <div
                        className={`h-full ${t.status === "failed" ? "bg-red-500" : "bg-green-500"}`}
                        style={{ width: `${t.progress}%` }}
                      />
                    </div>
                    {(t.applied !== undefined || t.failedCount !== undefined) && (
                      <div className="text-xs opacity-80">
                        <span className="text-green-600 dark:text-green-400">{t.applied ?? 0} ok</span>
                        {(t.failedCount ?? 0) > 0 && (
                          <span className="ml-2 text-red-600 dark:text-red-400">
                            {t.failedCount} failed
                          </span>
                        )}
                        <span className="ml-2 opacity-60">of {ops.length}</span>
                      </div>
                    )}
                    {t.results && t.results.some((r) => !r.ok) && (
                      <details className="rounded border border-black/10 dark:border-white/10 p-2 text-xs">
                        <summary className="cursor-pointer opacity-80">
                          Show {t.results.filter((r) => !r.ok).length} failure(s)
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {t.results
                            .filter((r) => !r.ok)
                            .map((r) => (
                              <li key={r.id} className="font-mono break-all">
                                <span className="opacity-70">{r.id}:</span>{" "}
                                <span className="text-red-600 dark:text-red-400">{r.error}</span>
                              </li>
                            ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a href="/diff" className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm">
          ← Diff
        </a>
        <button
          onClick={apply}
          disabled={!canApply}
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {running ? "Applying…" : `Apply to ${selected.length} target(s)`}
        </button>
        <a href="/history" className="text-sm underline underline-offset-2">
          View history →
        </a>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: TargetState["status"] }) {
  const map = {
    idle: { label: "idle", color: "bg-black/10 dark:bg-white/10" },
    running: { label: "running", color: "bg-yellow-500/20 text-yellow-900 dark:text-yellow-200" },
    done: { label: "done", color: "bg-green-500/20 text-green-900 dark:text-green-200" },
    failed: { label: "failed", color: "bg-red-500/20 text-red-900 dark:text-red-200" },
  };
  const { label, color } = map[status];
  return <span className={`rounded px-2 py-0.5 text-xs ${color}`}>{label}</span>;
}
