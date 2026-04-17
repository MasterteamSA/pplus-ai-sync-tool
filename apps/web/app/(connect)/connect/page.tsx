"use client";

import { useState } from "react";

interface EnvRow {
  label: string;
  baseUrl: string;
  authMode: "cookie" | "bearer" | "basic";
  secret: string;
  status?: "idle" | "testing" | "ok" | "error";
  statusDetail?: string;
}

const emptyRow = (label: string): EnvRow => ({
  label,
  baseUrl: "",
  authMode: "cookie",
  secret: "",
  status: "idle",
});

export default function ConnectPage() {
  const [source, setSource] = useState<EnvRow>(emptyRow("source"));
  const [targets, setTargets] = useState<EnvRow[]>([emptyRow("target-1")]);
  const [bulk, setBulk] = useState("");

  const addTarget = () => setTargets((t) => [...t, emptyRow(`target-${t.length + 1}`)]);
  const removeTarget = (i: number) => setTargets((t) => t.filter((_, idx) => idx !== i));

  const pasteBulk = () => {
    const urls = bulk
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (urls.length === 0) return;
    setTargets(
      urls.map((u, i) => ({
        label: `target-${i + 1}`,
        baseUrl: u,
        authMode: "cookie",
        secret: "",
        status: "idle",
      })),
    );
    setBulk("");
  };

  const testRow = async (row: EnvRow, setRow: (r: EnvRow) => void) => {
    const { statusDetail: _omit, ...rest } = row;
    void _omit;
    setRow({ ...rest, status: "testing" });
    try {
      const res = await fetch("/api/connect/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label: row.label,
          baseUrl: row.baseUrl,
          authMode: row.authMode,
          secret: row.secret,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; user?: string };
      if (res.ok && body.ok) {
        setRow({ ...row, status: "ok", statusDetail: body.user ?? "connected" });
      } else {
        setRow({ ...row, status: "error", statusDetail: body.error ?? `HTTP ${res.status}` });
      }
    } catch (e) {
      setRow({ ...row, status: "error", statusDetail: (e as Error).message });
    }
  };

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Connect</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Enter the source PPlus instance and one or more targets. Credentials
          are stored encrypted on this machine and never leave the server.
        </p>
      </div>

      <EnvCard title="Source" row={source} onChange={setSource} onTest={() => testRow(source, setSource)} />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Targets</h2>
          <button
            type="button"
            onClick={addTarget}
            className="text-sm underline underline-offset-4"
          >
            + Add target
          </button>
        </div>
        {targets.map((row, i) => {
          const rest = {
            title: `Target ${i + 1}`,
            row,
            onChange: (r: EnvRow) => setTargets((arr) => arr.map((x, idx) => (idx === i ? r : x))),
            onTest: () =>
              testRow(row, (r) => setTargets((arr) => arr.map((x, idx) => (idx === i ? r : x)))),
            ...(targets.length > 1 ? { onRemove: () => removeTarget(i) } : {}),
          };
          return <EnvCard key={i} {...rest} />;
        })}

        <details className="rounded-md border border-black/10 dark:border-white/10 p-4">
          <summary className="cursor-pointer text-sm font-medium">Bulk paste target URLs</summary>
          <p className="mt-2 text-sm opacity-75">
            One URL per line. Auth mode defaults to <code>cookie</code>; fill each
            row's secret after pasting.
          </p>
          <textarea
            value={bulk}
            onChange={(e) => setBulk(e.target.value)}
            rows={4}
            className="mt-2 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 font-mono text-sm"
            placeholder={"https://target-a.example\nhttps://target-b.example"}
          />
          <button
            type="button"
            onClick={pasteBulk}
            className="mt-2 rounded bg-ink text-paper dark:bg-paper dark:text-ink px-3 py-1.5 text-sm"
          >
            Replace targets with list
          </button>
        </details>
      </section>

      <section className="pt-4 flex items-center gap-3">
        <a
          href="/snapshot"
          className="inline-flex items-center rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium"
        >
          Continue to Snapshot →
        </a>
        <span className="text-xs opacity-60">
          (Saving + run creation hooks come in the pipeline implementation pass.)
        </span>
      </section>
    </div>
  );
}

function EnvCard({
  title,
  row,
  onChange,
  onTest,
  onRemove,
}: {
  title: string;
  row: EnvRow;
  onChange: (r: EnvRow) => void;
  onTest: () => void;
  onRemove?: () => void;
}) {
  const set = <K extends keyof EnvRow>(k: K, v: EnvRow[K]) => onChange({ ...row, [k]: v });
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium">{title}</div>
        <div className="flex items-center gap-2">
          <StatusDot row={row} />
          <button
            type="button"
            onClick={onTest}
            className="text-sm underline underline-offset-4"
            disabled={!row.baseUrl}
          >
            Test connection
          </button>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="text-sm opacity-60 hover:opacity-100"
              aria-label="Remove"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs opacity-70">Label</span>
          <input
            value={row.label}
            onChange={(e) => set("label", e.target.value)}
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm"
          />
        </label>
        <label className="block">
          <span className="text-xs opacity-70">Base URL</span>
          <input
            value={row.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            placeholder="https://instance.pplus.example"
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs opacity-70">Auth mode</span>
          <select
            value={row.authMode}
            onChange={(e) => set("authMode", e.target.value as EnvRow["authMode"])}
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm"
          >
            <option value="cookie">cookie</option>
            <option value="bearer">bearer</option>
            <option value="basic">basic (user:pass)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs opacity-70">
            Secret{" "}
            <span className="opacity-60">
              ({row.authMode === "basic" ? "user:pass" : row.authMode === "bearer" ? "token" : "cookie header"})
            </span>
          </span>
          <input
            value={row.secret}
            onChange={(e) => set("secret", e.target.value)}
            type="password"
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm font-mono"
          />
        </label>
      </div>
      {row.statusDetail && (
        <div className="text-xs opacity-70">{row.statusDetail}</div>
      )}
    </div>
  );
}

function StatusDot({ row }: { row: EnvRow }) {
  const color =
    row.status === "ok" ? "bg-green-500" :
    row.status === "error" ? "bg-red-500" :
    row.status === "testing" ? "bg-yellow-500 animate-pulse" :
    "bg-gray-400";
  return <span className={`inline-block size-2 rounded-full ${color}`} aria-label={row.status} />;
}
