"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flow } from "@/lib/flow-state";

interface Event {
  type: "status" | "ai" | "op" | "phase" | "done" | "error";
  phase: "init" | "capture" | "diff" | "apply" | "done";
  ts: number;
  msg: string;
  opId?: string;
  kind?: string;
  source?: number;
  target?: number;
  result?: "ok" | "fail";
  attempt?: number;
  newId?: string;
  runId?: string;
  applied?: number;
  failed?: number;
  total?: number;
  count?: number;
  planned?: number;
}

export default function AutopilotPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [running, setRunning] = useState(false);
  const [aiPending, setAiPending] = useState(false);
  const [ready, setReady] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const [envs, setEnvs] = useState<ReturnType<typeof flow.getEnvs>>({ targets: [] });
  const [kinds, setKinds] = useState<string[]>([]);

  useEffect(() => {
    setEnvs(flow.getEnvs());
    setKinds(flow.getKinds());
    setReady(true);
  }, []);

  const srcOk = ready && !!envs.source?.baseUrl;
  const tgtOk = ready && !!envs.targets?.[0]?.baseUrl;
  const kindsOk = ready && kinds.length > 0;
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  async function run(dryRun: boolean) {
    if (!srcOk || !tgtOk || !kindsOk) return;
    setRunning(true);
    setEvents([]);
    const src = envs.source!;
    const tgt = envs.targets[0]!;
    const res = await fetch("/api/autopilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: {
          label: src.label,
          baseUrl: src.baseUrl,
          authMode: src.authMode,
          secret: src.secret ?? "",
          csr: src.csr ?? "",
        },
        target: {
          label: tgt.label,
          baseUrl: tgt.baseUrl,
          authMode: tgt.authMode,
          secret: tgt.secret ?? "",
          csr: tgt.csr ?? "",
        },
        kinds,
        limitPerKind: 200,
        maxAiRetries: 2,
        dryRun,
      }),
    });
    if (!res.body) {
      setRunning(false);
      return;
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const chunks = buf.split("\n\n");
      buf = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const line = chunk.replace(/^data: /, "").trim();
        if (!line) continue;
        try {
          const ev = JSON.parse(line) as Event;
          setEvents((prev) => [...prev, ev]);
          if (ev.type === "ai") setAiPending(ev.msg.includes("proposing"));
          if (ev.type === "done" || ev.type === "error") setAiPending(false);
          if (ev.type === "done") {
            // Save a history record.
            if (ev.applied !== undefined) {
              flow.addRun({
                id: ev.runId ?? `auto-${ev.ts}`,
                createdAt: new Date(ev.ts).toISOString(),
                actor: "autopilot",
                sourceLabel: src.label,
                targetLabels: [tgt.label],
                kinds,
                ops: ev.total ?? 0,
                applied: ev.applied,
                failed: ev.failed ?? 0,
                status: (ev.failed ?? 0) > 0 ? "failed" : "applied",
                summary: `Autopilot: ${ev.applied} ok · ${ev.failed ?? 0} failed of ${ev.total}`,
              });
            }
          }
        } catch {
          /* ignore */
        }
      }
    }
    setRunning(false);
    setAiPending(false);
  }

  const summary = useMemo(() => {
    const lastDone = [...events].reverse().find((e) => e.type === "done");
    return lastDone
      ? { applied: lastDone.applied ?? 0, failed: lastDone.failed ?? 0, total: lastDone.total ?? 0, runId: lastDone.runId }
      : null;
  }, [events]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Autopilot</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          One click: capture source + target, compute diff, apply with Claude in the
          loop — on any POST failure Claude inspects the server error + a
          real target sample and proposes a fix, then the tool retries. Every
          event is streamed here and persisted to the run audit log.
        </p>
      </div>

      {ready && (
        <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 text-sm">
          <div className="flex flex-wrap gap-3">
            <StatusItem ok={srcOk} label="Source" value={envs.source?.baseUrl ?? "not configured"} href="/connect" />
            <StatusItem ok={tgtOk} label="Target" value={envs.targets?.[0]?.baseUrl ?? "not configured"} href="/connect" />
            <StatusItem
              ok={kindsOk}
              label="Kinds"
              value={kindsOk ? `${kinds.length} selected` : "none selected"}
              href="/snapshot"
            />
          </div>
        </section>
      )}

      <section className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => run(false)}
          disabled={running || !srcOk || !tgtOk || !kindsOk}
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {running ? "Running autopilot…" : "Run autopilot"}
        </button>
        <button
          onClick={() => run(true)}
          disabled={running || !srcOk || !tgtOk || !kindsOk}
          className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
        >
          Dry-run (no writes)
        </button>
        {aiPending && (
          <span className="flex items-center gap-2 text-sm">
            <Spinner /> <span>Claude is thinking…</span>
          </span>
        )}
        {summary && (
          <span className="ml-auto text-xs">
            <span className="text-green-600 dark:text-green-400">{summary.applied} ok</span>
            {summary.failed > 0 && (
              <span className="ml-2 text-red-600 dark:text-red-400">{summary.failed} failed</span>
            )}
            <span className="ml-2 opacity-60">of {summary.total}</span>
            {summary.runId && <span className="ml-2 font-mono opacity-50">{summary.runId}</span>}
          </span>
        )}
      </section>

      <section
        ref={logRef}
        className="rounded-lg border border-black/10 dark:border-white/10 p-3 bg-black/5 dark:bg-white/5 font-mono text-xs max-h-[520px] overflow-y-auto space-y-1"
      >
        {events.length === 0 && (
          <div className="opacity-60">Log will appear here when the run starts.</div>
        )}
        {events.map((e, i) => (
          <EventRow key={i} e={e} />
        ))}
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <a href="/snapshot" className="text-sm underline underline-offset-2">← Snapshot</a>
        <a href="/history" className="text-sm underline underline-offset-2">View history →</a>
      </div>
    </div>
  );
}

function EventRow({ e }: { e: Event }) {
  const t = new Date(e.ts).toLocaleTimeString();
  const tag =
    e.type === "error" ? "text-red-600 dark:text-red-400" :
    e.type === "ai" ? "text-purple-600 dark:text-purple-400" :
    e.type === "op" && e.result === "ok" ? "text-green-600 dark:text-green-400" :
    e.type === "op" && e.result === "fail" ? "text-red-600 dark:text-red-400" :
    e.type === "phase" ? "text-blue-600 dark:text-blue-400 font-semibold" :
    e.type === "done" ? "text-green-700 dark:text-green-300 font-semibold" :
    "opacity-80";
  return (
    <div className="flex items-start gap-2 break-words">
      <span className="opacity-50 shrink-0">{t}</span>
      <span className="shrink-0 uppercase opacity-60 w-14">{e.phase}</span>
      <span className={`${tag} min-w-0`}>{e.msg}</span>
    </div>
  );
}

function StatusItem({ ok, label, value, href }: { ok: boolean; label: string; value: string; href: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block size-2 rounded-full ${ok ? "bg-green-500" : "bg-red-500"}`} />
      <span className="font-medium">{label}:</span>
      <span className="opacity-75 font-mono text-xs break-all">{value}</span>
      {!ok && <a href={href} className="text-xs underline ml-1">configure</a>}
    </div>
  );
}

function Spinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
