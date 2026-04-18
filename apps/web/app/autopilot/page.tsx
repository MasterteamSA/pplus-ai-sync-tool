"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { flow } from "@/lib/flow-state";

const ENTITY_PRESETS: Record<string, string[]> = {
  "Schema only": [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup",
  ],
  "Schema + Admin": [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup",
    "levelAttachedLogs", "role", "escalation", "procurement",
    "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
    "notification",
  ],
  "Schema + Dashboards": [
    "level", "log", "property", "logProperty", "propertyStatus", "phaseGate",
    "lookup", "dashboard", "chartComponent",
  ],
  "Global admin": [
    "user", "group", "setting", "holiday", "accessibility",
    "classification", "scheduleView", "delegation", "workflow",
  ],
  Everything: [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup", "source",
    "levelAttachedLogs", "role", "escalation", "procurement",
    "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
    "notification", "workflow",
    "dashboard", "chartComponent",
    "user", "group", "setting", "holiday", "accessibility",
    "classification", "scheduleView", "delegation",
  ],
};

const KIND_GROUPS: { title: string; kinds: { value: string; label: string }[] }[] = [
  {
    title: "Schema",
    kinds: [
      { value: "level", label: "Levels" },
      { value: "log", label: "Logs" },
      { value: "property", label: "Properties" },
      { value: "logProperty", label: "Log Properties" },
      { value: "levelSection", label: "Sections" },
      { value: "propertyStatus", label: "Property Statuses" },
      { value: "levelStatus", label: "Level Statuses" },
      { value: "phaseGate", label: "Phase Gates" },
      { value: "lookup", label: "Lookups" },
      { value: "source", label: "Level Connections" },
    ],
  },
  {
    title: "Level Admin",
    kinds: [
      { value: "levelAttachedLogs", label: "Level-Log Bindings" },
      { value: "role", label: "Roles" },
      { value: "escalation", label: "Escalation" },
      { value: "procurement", label: "Procurement" },
      { value: "cardConfig", label: "Card Config" },
      { value: "processBuilder", label: "Process Builder" },
      { value: "approvalProcess", label: "Approvals" },
      { value: "codeBuilder", label: "Code Builder" },
      { value: "notification", label: "Notifications" },
      { value: "workflow", label: "Workflows" },
    ],
  },
  {
    title: "Dashboards",
    kinds: [
      { value: "dashboard", label: "Dashboards" },
      { value: "chartComponent", label: "Chart Components" },
    ],
  },
  {
    title: "Global Admin",
    kinds: [
      { value: "user", label: "Users" },
      { value: "group", label: "Groups" },
      { value: "setting", label: "Settings" },
      { value: "holiday", label: "Holidays" },
      { value: "accessibility", label: "Accessibility" },
      { value: "classification", label: "Classification" },
      { value: "scheduleView", label: "Schedule Views" },
      { value: "delegation", label: "Delegations" },
    ],
  },
];

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

  type AuthMode = "cookie" | "bearer" | "basic";
  const [srcUrl, setSrcUrl] = useState("");
  const [srcAuth, setSrcAuth] = useState<AuthMode>("bearer");
  const [srcSecret, setSrcSecret] = useState("");
  const [srcCsr, setSrcCsr] = useState("");
  const [tgtUrl, setTgtUrl] = useState("");
  const [tgtAuth, setTgtAuth] = useState<AuthMode>("bearer");
  const [tgtSecret, setTgtSecret] = useState("");
  const [tgtCsr, setTgtCsr] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [includeBuiltins, setIncludeBuiltins] = useState(false);
  const [includeUpdates, setIncludeUpdates] = useState(true);
  const [includeDeletes, setIncludeDeletes] = useState(false);

  useEffect(() => {
    const envs = flow.getEnvs();
    if (envs.source) {
      setSrcUrl(envs.source.baseUrl ?? "");
      setSrcAuth((envs.source.authMode as AuthMode) ?? "bearer");
      setSrcSecret(envs.source.secret ?? "");
      setSrcCsr(envs.source.csr ?? "");
    }
    const t0 = envs.targets?.[0];
    if (t0) {
      setTgtUrl(t0.baseUrl ?? "");
      setTgtAuth((t0.authMode as AuthMode) ?? "bearer");
      setTgtSecret(t0.secret ?? "");
      setTgtCsr(t0.csr ?? "");
    }
    const saved = flow.getKinds();
    const preset = ENTITY_PRESETS["Schema only"] as string[];
    setKinds(saved.length > 0 ? saved : preset);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    flow.setEnvs({
      source: { label: "source", baseUrl: srcUrl, authMode: srcAuth, secret: srcSecret, csr: srcCsr, ok: false },
      targets: tgtUrl
        ? [{ label: "target-1", baseUrl: tgtUrl, authMode: tgtAuth, secret: tgtSecret, csr: tgtCsr, ok: false }]
        : [],
    });
  }, [ready, srcUrl, srcAuth, srcSecret, srcCsr, tgtUrl, tgtAuth, tgtSecret, tgtCsr]);

  useEffect(() => {
    if (!ready) return;
    flow.setKinds(kinds);
  }, [ready, kinds]);

  const srcOk = ready && !!srcUrl && !!srcSecret;
  const tgtOk = ready && !!tgtUrl && !!tgtSecret;
  const kindsOk = ready && kinds.length > 0;

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events]);

  function toggleKind(k: string) {
    setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]));
  }

  function applyPreset(name: string) {
    setKinds(ENTITY_PRESETS[name] || []);
  }

  async function run(dryRun: boolean) {
    if (!srcOk || !tgtOk || !kindsOk) return;
    setRunning(true);
    setEvents([]);
    const res = await fetch("/api/autopilot", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        source: { label: "source", baseUrl: srcUrl, authMode: srcAuth, secret: srcSecret, csr: srcCsr },
        target: { label: "target-1", baseUrl: tgtUrl, authMode: tgtAuth, secret: tgtSecret, csr: tgtCsr },
        kinds,
        limitPerKind: 500,
        maxAiRetries: 40,
        dryRun,
        includeBuiltins,
        includeUpdates,
        includeDeletes,
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
            if (ev.applied !== undefined) {
              flow.addRun({
                id: ev.runId ?? `auto-${ev.ts}`,
                createdAt: new Date(ev.ts).toISOString(),
                actor: "autopilot",
                sourceLabel: "source",
                targetLabels: ["target-1"],
                kinds,
                ops: ev.total ?? 0,
                applied: ev.applied,
                failed: ev.failed ?? 0,
                status: (ev.failed ?? 0) > 0 ? "failed" : "applied",
                summary: `Autopilot: ${ev.applied} ok · ${ev.failed ?? 0} failed of ${ev.total}`,
              });
            }
          }
        } catch { /* ignore */ }
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
        <h1 className="text-2xl font-semibold tracking-tight">Autopilot Sync</h1>
        <p className="mt-2 opacity-80 max-w-2xl text-sm">
          One click: capture source + target, compute diff, apply with Claude
          self-healing. Operations are applied in dependency order
          (levels → logs → properties → statuses → dashboards).
          Every event is streamed and persisted to the audit log.
        </p>
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <EnvForm
          title="Source"
          ok={srcOk}
          url={srcUrl}
          onUrl={setSrcUrl}
          auth={srcAuth}
          onAuth={setSrcAuth}
          secret={srcSecret}
          onSecret={setSrcSecret}
          csr={srcCsr}
          onCsr={setSrcCsr}
        />
        <EnvForm
          title="Target"
          ok={tgtOk}
          url={tgtUrl}
          onUrl={setTgtUrl}
          auth={tgtAuth}
          onAuth={setTgtAuth}
          secret={tgtSecret}
          onSecret={setTgtSecret}
          csr={tgtCsr}
          onCsr={setTgtCsr}
        />
      </section>

      {/* ── Kind Selector ── */}
      <section className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-medium flex items-center gap-2">
            <span className={`inline-block size-2 rounded-full ${kindsOk ? "bg-green-500" : "bg-red-500"}`} />
            Entity Kinds ({kinds.length} selected)
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.keys(ENTITY_PRESETS).map((name) => (
              <button
                key={name}
                onClick={() => applyPreset(name)}
                className="text-xs px-2 py-1 rounded border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
              >
                {name}
              </button>
            ))}
            <button
              onClick={() => setKinds([])}
              className="text-xs px-2 py-1 rounded border border-red-300 dark:border-red-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {KIND_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="text-xs uppercase opacity-50 tracking-wide mb-1">{group.title}</div>
              <div className="space-y-0.5">
                {group.kinds.map((k) => (
                  <label key={k.value} className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={kinds.includes(k.value)}
                      onChange={() => toggleKind(k.value)}
                      className="rounded"
                    />
                    <span>{k.label}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Safe Mode ── */}
      <section className="rounded-lg border border-black/10 dark:border-white/10 p-3 text-sm">
        <div className="text-xs uppercase opacity-60 mb-2 tracking-wide">Sync mode</div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeUpdates} onChange={(e) => setIncludeUpdates(e.target.checked)} />
            <span>Include updates</span>
            <span className="opacity-60">(overwrite existing target entities)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeDeletes} onChange={(e) => setIncludeDeletes(e.target.checked)} />
            <span>Include deletes</span>
            <span className="opacity-60">(remove target-only entities)</span>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={includeBuiltins} onChange={(e) => setIncludeBuiltins(e.target.checked)} />
            <span>Include system records</span>
            <span className="opacity-60">(built-in logs/lookups)</span>
          </label>
        </div>
      </section>

      {/* ── Run buttons ── */}
      <section className="flex flex-wrap items-center gap-3">
        <button
          onClick={() => run(false)}
          disabled={running || !srcOk || !tgtOk || !kindsOk}
          className="rounded-md bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 transition-colors px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          {running ? "Running…" : "Run Sync"}
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

      {/* ── Log ── */}
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

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <a
          href="/history"
          className="rounded-md border border-border bg-background px-4 py-2 text-sm font-medium shadow-sm hover:bg-accent hover:text-accent-foreground transition-colors"
        >
          View history
        </a>
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

function EnvForm({
  title,
  ok,
  url,
  onUrl,
  auth,
  onAuth,
  secret,
  onSecret,
  csr,
  onCsr,
}: {
  title: string;
  ok: boolean;
  url: string;
  onUrl: (v: string) => void;
  auth: "cookie" | "bearer" | "basic";
  onAuth: (v: "cookie" | "bearer" | "basic") => void;
  secret: string;
  onSecret: (v: string) => void;
  csr: string;
  onCsr: (v: string) => void;
}) {
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [loginStatus, setLoginStatus] = useState<"idle" | "loading" | "ok" | "fail">("idle");
  const [loginMsg, setLoginMsg] = useState("");

  async function doLogin() {
    if (!url || !loginUser || !loginPass) return;
    setLoginStatus("loading");
    setLoginMsg("");
    try {
      const res = await fetch("/api/connect/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl: url, username: loginUser, password: loginPass }),
      });
      const data = await res.json();
      if (data.ok) {
        onAuth("bearer");
        onSecret(data.token);
        setLoginStatus("ok");
        setLoginMsg(`Logged in as ${data.user}`);
        setLoginPass("");
      } else {
        setLoginStatus("fail");
        setLoginMsg(data.error ?? "Login failed");
      }
    } catch (e) {
      setLoginStatus("fail");
      setLoginMsg((e as Error).message);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-medium flex items-center gap-2">
          <span className={`inline-block size-2 rounded-full ${ok ? "bg-green-500" : "bg-gray-400"}`} />
          {title}
        </div>
      </div>
      <label className="block">
        <span className="text-xs opacity-70">URL</span>
        <input
          value={url}
          onChange={(e) => onUrl(e.target.value)}
          placeholder="https://instance.pplus.example"
          className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm font-mono"
        />
      </label>

      {/* Quick Login */}
      <div className="rounded border border-black/5 dark:border-white/5 p-2 space-y-2 bg-black/[0.02] dark:bg-white/[0.02]">
        <div className="text-xs opacity-60">Quick login (auto-fetches bearer token)</div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <input
            value={loginUser}
            onChange={(e) => setLoginUser(e.target.value)}
            placeholder="Username"
            className="rounded border border-black/10 dark:border-white/10 bg-transparent p-1.5 text-sm"
          />
          <input
            value={loginPass}
            onChange={(e) => setLoginPass(e.target.value)}
            placeholder="Password"
            type="password"
            className="rounded border border-black/10 dark:border-white/10 bg-transparent p-1.5 text-sm"
            onKeyDown={(e) => e.key === "Enter" && doLogin()}
          />
          <button
            onClick={doLogin}
            disabled={!url || !loginUser || !loginPass || loginStatus === "loading"}
            className="rounded bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {loginStatus === "loading" ? "…" : "Login"}
          </button>
        </div>
        {loginMsg && (
          <div className={`text-xs ${loginStatus === "ok" ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
            {loginMsg}
          </div>
        )}
      </div>

      {/* Manual token entry */}
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="text-xs opacity-70">Auth mode</span>
          <select
            value={auth}
            onChange={(e) => onAuth(e.target.value as "cookie" | "bearer" | "basic")}
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-background text-foreground p-2 text-sm"
          >
            <option value="cookie" className="bg-background text-foreground">cookie</option>
            <option value="bearer" className="bg-background text-foreground">bearer</option>
            <option value="basic" className="bg-background text-foreground">basic (user:pass)</option>
          </select>
        </label>
        <label className="block">
          <span className="text-xs opacity-70">
            Secret{" "}
            <span className="opacity-60">
              ({auth === "basic" ? "user:pass" : auth === "bearer" ? "token" : "cookie header"})
            </span>
          </span>
          <input
            value={secret}
            onChange={(e) => onSecret(e.target.value)}
            type="password"
            className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm font-mono"
          />
        </label>
      </div>
      <label className="block">
        <span className="text-xs opacity-70">
          CSR token <span className="opacity-60">(optional — auto-filled: =8yPFwmIQPX96bxPVFP_62WCH*+o]v*g)</span>
        </span>
        <input
          value={csr}
          onChange={(e) => onCsr(e.target.value)}
          type="password"
          placeholder="=8yPFwmIQPX96bxPVFP_62WCH*+o]v*g"
          className="mt-1 w-full rounded border border-black/10 dark:border-white/10 bg-transparent p-2 text-sm font-mono"
        />
      </label>
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
