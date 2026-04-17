"use client";

import { useState } from "react";

interface Decision {
  sourceKey: string;
  targetKey: string | null;
  method: string;
  confidence: number;
  reason: string;
}

interface AlignResponse {
  ok: boolean;
  totalMs: number;
  aiMs: number;
  deterministicCount: number;
  aiCount: number;
  unresolvedCount: number;
  byMethod: Record<string, number>;
  decisions: Decision[];
  unusedTargetKeys: string[];
  error?: string;
}

const demoSource = JSON.stringify(
  [
    { key: "Site_Revenue_1", name: "Revenue", type: "number" },
    { key: "Site_Cost_2", name: "Cost", type: "number" },
    { key: "Site_Area_12", name: "Area", type: "number", formula: "{{Site_Revenue_1}} - {{Site_Cost_2}}" },
    { key: "Site_Owner_3", name: "Owner", type: "string" },
    { key: "Site_Mystery_7", name: "Something", type: "string" },
  ],
  null,
  2,
);

const demoTarget = JSON.stringify(
  [
    { key: "Facility_Revenue_91", name: "Revenue", type: "number" },
    { key: "Facility_Cost_92", name: "Cost", type: "number" },
    { key: "Facility_Area_78", name: "Area", type: "number" },
    { key: "Facility_Manager_4", name: "Manager", type: "string" },
    { key: "Facility_Orphan_1", name: "Orphan", type: "string" },
  ],
  null,
  2,
);

export default function AlignPage() {
  const [source, setSource] = useState(demoSource);
  const [target, setTarget] = useState(demoTarget);
  const [sourceLevels, setSourceLevels] = useState("Site");
  const [targetLevels, setTargetLevels] = useState("Facility");
  const [levelMap, setLevelMap] = useState('{"Site":"Facility"}');
  const [useAi, setUseAi] = useState(true);
  const [hint, setHint] = useState("The organization renamed Sites to Facilities last quarter.");
  const [result, setResult] = useState<AlignResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setResult(null);
    try {
      const body = {
        source: JSON.parse(source),
        target: JSON.parse(target),
        sourceLevelNames: sourceLevels.split(",").map((s) => s.trim()).filter(Boolean),
        targetLevelNames: targetLevels.split(",").map((s) => s.trim()).filter(Boolean),
        levelMap: JSON.parse(levelMap),
        useAi,
        hint: hint || undefined,
      };
      const res = await fetch("/api/ai/align", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as AlignResponse;
      if (!res.ok || !json.ok) {
        setErr(json.error ?? `HTTP ${res.status}`);
      } else {
        setResult(json);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Smart Key Alignment</h1>
        <p className="mt-2 max-w-3xl opacity-80">
          Paste two property-key catalogs (source + target) and the known level rename map.
          The deterministic engine resolves exact / level-swap / baseName / co-occurrence matches;
          Claude resolves the residual with self-validation (proposed keys must exist in the target).
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <LabeledTextArea label="Source properties (JSON)" value={source} onChange={setSource} />
        <LabeledTextArea label="Target properties (JSON)" value={target} onChange={setTarget} />
      </div>

      <div className="grid gap-4 sm:grid-cols-4">
        <LabeledInput label="Source level names (comma-sep)" value={sourceLevels} onChange={setSourceLevels} />
        <LabeledInput label="Target level names (comma-sep)" value={targetLevels} onChange={setTargetLevels} />
        <LabeledInput label="Level map (JSON)" value={levelMap} onChange={setLevelMap} />
        <LabeledInput label="Operator hint" value={hint} onChange={setHint} />
      </div>

      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          Use AI for residual (Claude CLI)
        </label>
        <button
          onClick={run}
          disabled={loading}
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {loading ? "Aligning…" : "Run alignment"}
        </button>
      </div>

      {err && <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm">{err}</div>}

      {result && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge>total {result.totalMs}ms</Badge>
            <Badge>ai {result.aiMs}ms</Badge>
            <Badge>deterministic {result.deterministicCount}</Badge>
            <Badge>ai {result.aiCount}</Badge>
            <Badge intent="warn">unresolved {result.unresolvedCount}</Badge>
            {Object.entries(result.byMethod).map(([m, n]) => (
              <Badge key={m}>{m}: {n}</Badge>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
            <table className="w-full text-sm">
              <thead className="bg-black/5 dark:bg-white/5">
                <tr>
                  <th className="text-left p-2">Source key</th>
                  <th className="text-left p-2">→ Target key</th>
                  <th className="text-left p-2">Method</th>
                  <th className="text-left p-2">Confidence</th>
                  <th className="text-left p-2">Reason</th>
                </tr>
              </thead>
              <tbody>
                {result.decisions.map((d) => (
                  <tr key={d.sourceKey} className="border-t border-black/10 dark:border-white/10">
                    <td className="p-2 font-mono text-xs">{d.sourceKey}</td>
                    <td className="p-2 font-mono text-xs">
                      {d.targetKey ?? <span className="opacity-50">—</span>}
                    </td>
                    <td className="p-2"><span className="rounded bg-black/10 dark:bg-white/10 px-2 py-0.5 text-xs">{d.method}</span></td>
                    <td className="p-2">
                      <ConfidenceBar value={d.confidence} />
                    </td>
                    <td className="p-2 text-xs opacity-85">{d.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.unusedTargetKeys.length > 0 && (
            <div className="rounded-lg border border-black/10 dark:border-white/10 p-3 text-sm">
              <div className="font-medium mb-1">Unused target keys</div>
              <div className="opacity-75 font-mono text-xs">{result.unusedTargetKeys.join(", ")}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LabeledTextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs opacity-70">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={10}
        className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 font-mono text-xs"
        spellCheck={false}
      />
    </label>
  );
}
function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="text-xs opacity-70">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm"
      />
    </label>
  );
}
function Badge({ children, intent }: { children: React.ReactNode; intent?: "warn" }) {
  const color =
    intent === "warn"
      ? "bg-yellow-500/20 border-yellow-500/50"
      : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10";
  return <span className={`rounded border px-2 py-0.5 ${color}`}>{children}</span>;
}
function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct >= 0.9 ? "bg-green-500" : pct >= 0.7 ? "bg-yellow-500" : pct > 0 ? "bg-orange-500" : "bg-gray-400";
  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-2 bg-black/10 dark:bg-white/10 rounded overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className="text-xs tabular-nums opacity-75">{(pct * 100).toFixed(0)}%</span>
    </div>
  );
}
