"use client";

import { useEffect, useMemo, useState } from "react";
import { flow, SEED_DIFF, type DiffOp } from "@/lib/flow-state";

export default function DiffPage() {
  const [ops, setOps] = useState<DiffOp[]>([]);
  const [filter, setFilter] = useState<"all" | "create" | "update" | "delete" | "rewriteRef">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState("");

  useEffect(() => {
    const stored = flow.getDiff();
    if (stored.length === 0) {
      flow.setDiff(SEED_DIFF);
      setOps(SEED_DIFF);
      setSelected(new Set(SEED_DIFF.map((o) => o.id)));
    } else {
      setOps(stored);
      setSelected(new Set(stored.map((o) => o.id)));
    }
  }, []);

  const filteredOps = useMemo(
    () => (filter === "all" ? ops : ops.filter((o) => o.op === filter)),
    [ops, filter],
  );
  const summary = useMemo(() => {
    const s = { create: 0, update: 0, delete: 0, rewriteRef: 0 };
    for (const o of ops) s[o.op]++;
    return s;
  }, [ops]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAll = () => setSelected(new Set(filteredOps.map((o) => o.id)));
  const clearAll = () => setSelected(new Set());

  const regenerateDemo = () => {
    flow.setDiff(SEED_DIFF);
    setOps(SEED_DIFF);
    setSelected(new Set(SEED_DIFF.map((o) => o.id)));
    setExplanation("");
  };

  async function explain() {
    const chosen = ops.filter((o) => selected.has(o.id));
    if (chosen.length === 0) return;
    setExplaining(true);
    setExplanation("");
    try {
      const res = await fetch("/api/ai/explain", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ops: chosen }),
      });
      if (!res.body) throw new Error("no response stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        setExplanation((prev) => prev + decoder.decode(value));
      }
    } catch (e) {
      setExplanation(`Failed: ${(e as Error).message}`);
    } finally {
      setExplaining(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Diff</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Review every operation before it's applied. Toggle each to include or
          exclude; Claude will explain the set you've selected in plain English.
        </p>
      </div>

      <section className="grid gap-3 sm:grid-cols-4">
        {(["create", "update", "delete", "rewriteRef"] as const).map((k) => (
          <div key={k} className="rounded-lg border border-black/10 dark:border-white/10 p-3">
            <div className="text-xs uppercase opacity-60 tracking-wide">{k}</div>
            <div className="text-xl font-semibold mt-1 tabular-nums">{summary[k]}</div>
          </div>
        ))}
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 overflow-hidden text-xs">
          {(["all", "create", "update", "delete", "rewriteRef"] as const).map((k) => (
            <button
              key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 ${
                filter === k ? "bg-ink text-paper dark:bg-paper dark:text-ink" : ""
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <button onClick={selectAll} className="text-xs underline underline-offset-2">
          Select all
        </button>
        <button onClick={clearAll} className="text-xs underline underline-offset-2">
          Clear
        </button>
        <span className="text-xs opacity-70">
          {selected.size} / {ops.length} selected
        </span>
        <button
          onClick={explain}
          disabled={explaining || selected.size === 0}
          className="ml-auto rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-3 py-1.5 text-sm disabled:opacity-60"
        >
          {explaining ? "Claude is explaining…" : "Explain selected"}
        </button>
        <button
          onClick={regenerateDemo}
          className="rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm"
        >
          Reset to demo
        </button>
      </section>

      <section className="space-y-2">
        {filteredOps.map((op) => {
          const on = selected.has(op.id);
          const riskColor =
            op.risk === "high"
              ? "border-red-500/60 bg-red-500/5"
              : op.risk === "med"
              ? "border-yellow-500/60 bg-yellow-500/5"
              : "border-black/10 dark:border-white/10";
          return (
            <label
              key={op.id}
              className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${riskColor}`}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(op.id)} className="mt-1" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Chip>{op.op}</Chip>
                  <Chip>{op.kind}</Chip>
                  <RiskChip risk={op.risk} />
                  <span className="font-medium truncate">{op.label}</span>
                </div>
                <div className="mt-1 text-xs opacity-75 break-words">{op.detail}</div>
                <div className="mt-1 text-[10px] font-mono opacity-50">
                  {op.sourceId && `src: ${op.sourceId}`} {op.targetId && `· tgt: ${op.targetId}`}
                </div>
              </div>
            </label>
          );
        })}
        {filteredOps.length === 0 && (
          <div className="opacity-60 text-sm">No operations match this filter.</div>
        )}
      </section>

      {(explanation || explaining) && (
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4">
          <div className="text-xs uppercase opacity-60 mb-2">Claude explanation</div>
          <pre className="whitespace-pre-wrap text-sm leading-relaxed">{explanation}</pre>
          {explaining && <div className="text-xs opacity-60 mt-2">Streaming…</div>}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a href="/match" className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm">
          ← Match
        </a>
        <a
          href="/apply"
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium"
        >
          Continue to Apply →
        </a>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-black/10 dark:bg-white/10 px-2 py-0.5 text-xs whitespace-nowrap">
      {children}
    </span>
  );
}
function RiskChip({ risk }: { risk: "low" | "med" | "high" }) {
  const color =
    risk === "high"
      ? "bg-red-500/20 text-red-900 dark:text-red-200"
      : risk === "med"
      ? "bg-yellow-500/20 text-yellow-900 dark:text-yellow-200"
      : "bg-green-500/20 text-green-900 dark:text-green-200";
  return (
    <span className={`rounded px-2 py-0.5 text-xs whitespace-nowrap ${color}`}>risk: {risk}</span>
  );
}
