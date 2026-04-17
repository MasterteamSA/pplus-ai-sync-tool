"use client";

import { useEffect, useMemo, useState } from "react";
import { flow, SEED_LEVELS, type MatchDecision } from "@/lib/flow-state";

/**
 * /match — entity-level matching between source and target. Uses the same
 * deterministic-then-AI pipeline exposed at /api/ai/align but scoped to
 * Levels + Logs here; property-key alignment has its own page at /align.
 */

type Entity = { id: string; key?: string; name: string };

interface MatchResponse {
  ok: boolean;
  decisions: MatchDecision[];
  unusedTargetKeys?: string[];
  error?: string;
}

export default function MatchPage() {
  const [kind, setKind] = useState<"level" | "log">("level");
  const [source, setSource] = useState<string>(JSON.stringify(SEED_LEVELS.source, null, 2));
  const [target, setTarget] = useState<string>(JSON.stringify(SEED_LEVELS.target, null, 2));
  const [useAi, setUseAi] = useState(true);
  const [decisions, setDecisions] = useState<MatchDecision[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Hydrate from localStorage on mount so SSR markup matches the client.
  useEffect(() => {
    setDecisions(flow.getMatches());
  }, []);

  async function run() {
    setLoading(true);
    setErr(null);
    try {
      const src = JSON.parse(source) as Entity[];
      const tgt = JSON.parse(target) as Entity[];
      // Reuse the align endpoint — Levels have a name, not a formula grammar,
      // so we call alignment with each row as a degenerate "key".
      const res = await fetch("/api/ai/align", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          source: src.map((e) => ({ key: e.key ?? e.name, name: e.name })),
          target: tgt.map((e) => ({ key: e.key ?? e.name, name: e.name })),
          sourceLevelNames: [],
          targetLevelNames: [],
          levelMap: {},
          useAi,
          hint: `Match ${kind}s across instances. Use name + structural hints.`,
        }),
      });
      const json = (await res.json()) as MatchResponse;
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
      } else {
        const withAccept = json.decisions.map((d) => ({ ...d, kind, accepted: d.confidence >= 0.9 }));
        setDecisions(withAccept);
        flow.setMatches(withAccept);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const accepted = decisions.filter((d) => d.accepted).length;
  const total = decisions.length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Match</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Pair source entities with their counterparts on target.
          Deterministic matches (id → key → name → fuzzy) run first; Claude
          resolves the residual with self-validation.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border border-black/10 dark:border-white/10 overflow-hidden text-sm">
          {(["level", "log"] as const).map((k) => (
            <button
              key={k}
              onClick={() => {
                setKind(k);
                if (k === "level") {
                  setSource(JSON.stringify(SEED_LEVELS.source, null, 2));
                  setTarget(JSON.stringify(SEED_LEVELS.target, null, 2));
                }
              }}
              className={`px-3 py-1.5 ${
                kind === k ? "bg-ink text-paper dark:bg-paper dark:text-ink" : ""
              }`}
            >
              {k === "level" ? "Levels" : "Logs"}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          Use Claude for residual
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? "Matching…" : "Run matching"}
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <JsonBlock label="Source entities" value={source} onChange={setSource} />
        <JsonBlock label="Target entities" value={target} onChange={setTarget} />
      </div>

      {err && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm">{err}</div>
      )}

      {decisions.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">Decisions</h2>
            <div className="text-xs opacity-70">
              {accepted} / {total} accepted (confidence ≥ 90%)
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
            <table className="w-full text-sm min-w-[680px]">
              <thead className="bg-black/5 dark:bg-white/5 text-left">
                <tr>
                  <th className="p-2">Accept</th>
                  <th className="p-2">Source</th>
                  <th className="p-2">→ Target</th>
                  <th className="p-2">Method</th>
                  <th className="p-2">Confidence</th>
                  <th className="p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {decisions.map((d, i) => (
                  <tr key={i} className="border-t border-black/10 dark:border-white/10 align-top">
                    <td className="p-2">
                      <input
                        type="checkbox"
                        checked={!!d.accepted}
                        onChange={(e) => {
                          const next = decisions.map((x, j) =>
                            i === j ? { ...x, accepted: e.target.checked } : x,
                          );
                          setDecisions(next);
                          flow.setMatches(next);
                        }}
                      />
                    </td>
                    <td className="p-2 font-mono text-xs">{d.sourceId}</td>
                    <td className="p-2 font-mono text-xs">{d.targetId ?? <span className="opacity-50">—</span>}</td>
                    <td className="p-2"><Chip>{d.method}</Chip></td>
                    <td className="p-2"><ConfidenceBar value={d.confidence} /></td>
                    <td className="p-2 text-xs opacity-85 max-w-md">{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a href="/snapshot" className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5">
          ← Snapshot
        </a>
        <a
          href="/align"
          className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
        >
          Align property keys →
        </a>
        <a
          href="/diff"
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium"
        >
          Continue to Diff →
        </a>
      </div>
    </div>
  );
}

function JsonBlock({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs opacity-70">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        spellCheck={false}
        className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 font-mono text-xs"
      />
    </label>
  );
}
function Chip({ children }: { children: React.ReactNode }) {
  return <span className="rounded bg-black/10 dark:bg-white/10 px-2 py-0.5 text-xs whitespace-nowrap">{children}</span>;
}
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct >= 0.9 ? "bg-green-500" : pct >= 0.7 ? "bg-yellow-500" : pct > 0 ? "bg-orange-500" : "bg-gray-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 sm:w-20 h-2 bg-black/10 dark:bg-white/10 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-xs tabular-nums opacity-75">{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}
