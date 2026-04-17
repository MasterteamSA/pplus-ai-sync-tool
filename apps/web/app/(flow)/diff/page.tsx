"use client";

import { useEffect, useMemo, useState } from "react";
import { flow, type DiffOp } from "@/lib/flow-state";
import { applySafeModeFilter, NEVER_SYNCABLE_KINDS, isBuiltin } from "@/lib/sync-filters";

interface CaptureEntity {
  id: string;
  key?: string;
  name: string;
  hash?: string;
  payload?: unknown;
}

interface CaptureResponse {
  ok: boolean;
  entities?: Record<string, CaptureEntity[]>;
  errors?: Record<string, string>;
  error?: string;
}

/**
 * /diff — builds the plan from real captured data on the connected source
 * and target. No dummy seed: pressing "Build from live data" does a real
 * capture on both envs for the selected kinds, pairs entities by
 * id/key/name, and produces create/update/delete ops with risk tagging.
 */

function riskFor(op: DiffOp["op"], kind: string): DiffOp["risk"] {
  if (op === "delete") return "high";
  if (op === "rewriteRef") return "low";
  if (kind === "user" || kind === "group" || kind === "accessibility") return "med";
  return op === "create" ? "med" : "low";
}

function pairEntities(
  kind: string,
  src: CaptureEntity[],
  tgt: CaptureEntity[],
): DiffOp[] {
  const ops: DiffOp[] = [];
  const tgtById = new Map(tgt.map((t) => [t.id, t] as const));
  const tgtByKey = new Map(tgt.filter((t) => t.key).map((t) => [t.key!, t] as const));
  const tgtByName = new Map(tgt.map((t) => [t.name?.toLowerCase().trim(), t] as const));
  const used = new Set<string>();

  const findMatch = (s: CaptureEntity): CaptureEntity | undefined => {
    const byId = tgtById.get(s.id);
    if (byId && !used.has(byId.id)) return byId;
    if (s.key) {
      const byKey = tgtByKey.get(s.key);
      if (byKey && !used.has(byKey.id)) return byKey;
    }
    const byName = tgtByName.get(s.name?.toLowerCase().trim());
    if (byName && !used.has(byName.id)) return byName;
    return undefined;
  };

  for (const s of src) {
    const match = findMatch(s);
    if (!match) {
      ops.push({
        id: `${kind}:create:${s.id}`,
        op: "create",
        kind,
        sourceId: s.id,
        label: `Create ${kind}: ${s.name}`,
        detail: s.key ? `key=${s.key}` : `id=${s.id}`,
        risk: riskFor("create", kind),
        payload: s.payload ?? s,
        sourceEntity: { payload: s.payload ?? s },
      });
      continue;
    }
    used.add(match.id);
    if (s.hash && match.hash && s.hash === match.hash) continue;
    ops.push({
      id: `${kind}:update:${s.id}:${match.id}`,
      op: "update",
      kind,
      sourceId: s.id,
      targetId: match.id,
      label: `Update ${kind}: ${s.name}`,
      detail: s.key
        ? `source.key=${s.key} → target.key=${match.key ?? match.id}`
        : `source ${s.id} → target ${match.id}`,
      risk: riskFor("update", kind),
      payload: s.payload ?? s,
      sourceEntity: { payload: s.payload ?? s },
      targetEntity: { payload: match.payload ?? match },
    });
  }

  for (const t of tgt) {
    if (used.has(t.id)) continue;
    ops.push({
      id: `${kind}:delete:${t.id}`,
      op: "delete",
      kind,
      targetId: t.id,
      label: `Delete ${kind}: ${t.name}`,
      detail: t.key ? `key=${t.key}` : `id=${t.id}`,
      risk: riskFor("delete", kind),
      targetEntity: { payload: t.payload ?? t },
    });
  }

  return ops;
}

export default function DiffPage() {
  const [ops, setOps] = useState<DiffOp[]>([]);
  const [filter, setFilter] = useState<"all" | "create" | "update" | "delete" | "rewriteRef">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [explaining, setExplaining] = useState(false);
  const [explanation, setExplanation] = useState("");
  const [building, setBuilding] = useState(false);
  const [buildStatus, setBuildStatus] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [includeBuiltins, setIncludeBuiltins] = useState(false);
  const [includeUpdates, setIncludeUpdates] = useState(false);
  const [includeDeletes, setIncludeDeletes] = useState(false);

  useEffect(() => {
    const stored = flow.getDiff();
    setOps(stored);
    setSelected(new Set(stored.map((o) => o.id)));
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
  const clearDiff = () => {
    setOps([]);
    setSelected(new Set());
    flow.setDiff([]);
    setExplanation("");
    setBuildStatus(null);
  };

  async function buildFromLive() {
    const envs = flow.getEnvs();
    const srcEnv = envs.source;
    const tgtEnv = envs.targets?.[0];
    if (!srcEnv?.baseUrl) {
      setBuildError("No source configured. Go to /connect first.");
      return;
    }
    if (!tgtEnv?.baseUrl) {
      setBuildError("No target configured. Go to /connect first.");
      return;
    }
    const kinds = flow.getKinds();
    if (kinds.length === 0) {
      setBuildError("No kinds selected. Go to /snapshot and pick at least one.");
      return;
    }

    setBuilding(true);
    setBuildError(null);
    setBuildStatus(`Capturing ${kinds.length} kind(s) from ${srcEnv.label} and ${tgtEnv.label}…`);

    async function capture(env: typeof srcEnv): Promise<CaptureResponse> {
      const res = await fetch("/api/capture", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: env!.label,
          baseUrl: env!.baseUrl,
          authMode: env!.authMode,
          secret: env!.secret ?? "",
          csr: env!.csr ?? "",
          kinds,
          limit: 500,
        }),
      });
      return (await res.json()) as CaptureResponse;
    }

    try {
      const [srcCap, tgtCap] = await Promise.all([capture(srcEnv), capture(tgtEnv)]);
      if (!srcCap.ok) throw new Error(`source capture: ${srcCap.error ?? "failed"}`);
      if (!tgtCap.ok) throw new Error(`target capture: ${tgtCap.error ?? "failed"}`);

      const rawOps: DiffOp[] = [];
      for (const kind of kinds) {
        const s = srcCap.entities?.[kind] ?? [];
        const t = tgtCap.entities?.[kind] ?? [];
        rawOps.push(...pairEntities(kind, s, t));
      }
      const { kept, dropped } = applySafeModeFilter(rawOps, {
        includeBuiltins,
        includeUpdates,
        includeDeletes,
      });
      setOps(kept);
      setSelected(new Set(kept.map((o) => o.id)));
      flow.setDiff(kept);

      const srcErrs = srcCap.errors ? Object.entries(srcCap.errors) : [];
      const tgtErrs = tgtCap.errors ? Object.entries(tgtCap.errors) : [];
      const warn = [...srcErrs, ...tgtErrs].slice(0, 3);
      const dropBreakdown = dropped.reduce<Record<string, number>>((acc, d) => {
        acc[d.reason] = (acc[d.reason] ?? 0) + 1;
        return acc;
      }, {});
      const dropSummary = Object.entries(dropBreakdown)
        .map(([reason, n]) => `${n} ${reason}`)
        .join(" · ");
      setBuildStatus(
        `Built ${kept.length} op(s)` +
          (dropped.length ? ` (filtered ${dropped.length}: ${dropSummary})` : "") +
          (warn.length
            ? ` · warnings: ${warn.map(([k, m]) => `${k}: ${m}`).join("; ")}${srcErrs.length + tgtErrs.length > warn.length ? "…" : ""}`
            : ""),
      );
    } catch (e) {
      setBuildError((e as Error).message);
      setBuildStatus(null);
    } finally {
      setBuilding(false);
    }
  }

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
          Build the plan from live source + target data, review every operation,
          and ask Claude to explain the changes in plain English.
        </p>
      </div>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-3 text-sm">
        <div className="text-xs uppercase opacity-60 mb-2 tracking-wide">Safe mode — all off by default</div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeUpdates} onChange={(e) => setIncludeUpdates(e.target.checked)} />
            <span>Include updates</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDeletes} onChange={(e) => setIncludeDeletes(e.target.checked)} />
            <span>Include deletes</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeBuiltins} onChange={(e) => setIncludeBuiltins(e.target.checked)} />
            <span>Include system records</span>
          </label>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3">
        <button
          onClick={buildFromLive}
          disabled={building}
          className="rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors px-4 py-2 text-sm font-medium disabled:opacity-60"
        >
          {building ? "Capturing + diffing…" : ops.length ? "Rebuild from live data" : "Build from live data"}
        </button>
        {ops.length > 0 && (
          <button onClick={clearDiff} className="rounded-md border border-black/10 dark:border-white/10 px-3 py-1.5 text-sm">
            Clear diff
          </button>
        )}
        <span className="text-xs opacity-70">
          Uses connected envs from <a href="/connect" className="underline">/connect</a> and kinds from <a href="/snapshot" className="underline">/snapshot</a>.
        </span>
      </section>

      {buildStatus && <div className="text-xs opacity-75">{buildStatus}</div>}
      {buildError && (
        <div className="rounded border border-red-500/50 bg-red-500/10 p-3 text-sm">{buildError}</div>
      )}

      {ops.length === 0 ? (
        <EmptyState />
      ) : (
        <>
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
                    filter === k ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors" : ""
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
              className="ml-auto rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors px-3 py-1.5 text-sm disabled:opacity-60"
            >
              {explaining ? "Claude is explaining…" : "Explain selected"}
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
        </>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a href="/match" className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm">
          ← Match
        </a>
        <a
          href="/apply"
          className="rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors px-4 py-2 text-sm font-medium"
        >
          Continue to Apply →
        </a>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-black/20 dark:border-white/20 p-8 text-center space-y-2">
      <div className="text-base font-medium">No diff yet</div>
      <div className="text-sm opacity-75 max-w-md mx-auto">
        Click <strong>Build from live data</strong> to capture the selected kinds from your
        connected source + target and generate operations. Nothing will be applied.
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
