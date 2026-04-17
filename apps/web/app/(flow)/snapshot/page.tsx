"use client";

import { useEffect, useMemo, useState } from "react";
import { ENTITY_PRESETS, entityKindSchema } from "@pplus-sync/shared";

type EntityKind = (typeof entityKindSchema._def.values)[number];

const ALL_KINDS: readonly EntityKind[] = entityKindSchema._def.values;

const KIND_LABELS: Record<EntityKind, { label: string; hint: string }> = {
  // Hierarchy & data model
  level: { label: "Levels", hint: "Hierarchical units (Portfolio → Program → Project)" },
  log: { label: "Logs", hint: "Log-type definitions (Tasks, Risks, Issues, 20+ types)" },
  property: { label: "Level properties", hint: "Properties defined on each level type" },
  logProperty: { label: "Log properties", hint: "Properties defined on each log type (per-log)" },
  levelSection: { label: "Level sections", hint: "Groupings of properties into named sections" },
  propertyStatus: { label: "Property statuses", hint: "Status values + colors per status property" },
  levelStatus: { label: "Level statuses", hint: "Per-level status colors + C# formulas" },
  phaseGate: { label: "Phase gates", hint: "Lifecycle phases + allowed processes per phase" },
  lookup: { label: "Lookups", hint: "All ~40 lookup lists (risks, issues, procurement…)" },
  source: { label: "Sources", hint: "Level data-source bindings" },
  // Per-level admin
  levelAttachedLogs: { label: "Manage logs", hint: "Which log types attach to each level" },
  role: { label: "Roles & permissions", hint: "Per-level roles + module permission matrix" },
  escalation: { label: "Escalation chains", hint: "SLA-based escalation rules per level" },
  procurement: { label: "Procurement stages", hint: "Procurement flow + contract stages" },
  cardConfig: { label: "Cards management", hint: "Which fields appear on level cards (Card + Workspace + Logs sub-tabs)" },
  processBuilder: { label: "Process builder", hint: "Multi-step workflow processes per level" },
  approvalProcess: { label: "Manage approvals", hint: "~50 approval toggles (Create/Update/Delete per entity)" },
  codeBuilder: { label: "Code builder", hint: "Auto-code pattern per level (e.g. PF-{n}-YYYY)" },
  notification: { label: "Notifications", hint: "Trigger events + email templates per level" },
  workflow: { label: "Workflows", hint: "State-machine workflow definitions" },
  // Dashboards
  dashboard: { label: "Dashboards", hint: "Dashboard layouts + filter config + chart bindings" },
  chartComponent: { label: "Chart components", hint: "Chart widgets referenced by dashboards" },
  // Global admin
  user: { label: "Users", hint: "Account records (email, username, hour rate, IDs)" },
  group: { label: "Groups", hint: "User groups (~15: admin, PMO, Delivery Managers…)" },
  setting: { label: "Manage settings", hint: "Identity, colors, logos, SMTP, timezone, currency" },
  holiday: { label: "Holidays", hint: "Holiday list affecting schedule calculations" },
  accessibility: { label: "Accessibilities", hint: "8 permission groups + categories + landing page" },
  classification: { label: "Classification", hint: "5×5 risk matrix + issue classification" },
  scheduleView: { label: "Schedule views", hint: "Column configurations for the Gantt view" },
  delegation: { label: "Delegations", hint: "Approval-authority delegations between users" },
};

const GROUPS: { title: string; kinds: EntityKind[] }[] = [
  {
    title: "Schema",
    kinds: [
      "level", "log", "property", "logProperty", "levelSection",
      "propertyStatus", "levelStatus", "phaseGate", "lookup", "source",
    ],
  },
  {
    title: "Per-level admin",
    kinds: [
      "levelAttachedLogs", "role", "escalation", "procurement",
      "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
      "notification",
    ],
  },
  { title: "Workflow", kinds: ["workflow"] },
  { title: "Dashboards", kinds: ["dashboard", "chartComponent"] },
  {
    title: "Global admin",
    kinds: [
      "user", "group", "setting", "holiday", "accessibility",
      "classification", "scheduleView", "delegation",
    ],
  },
];

const STORAGE_KEY = "pplus-sync:selectedKinds";

export default function SnapshotPage() {
  const [selected, setSelected] = useState<Set<EntityKind>>(() => new Set());
  const [hydrated, setHydrated] = useState(false);
  const [activePreset, setActivePreset] = useState<string | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as EntityKind[];
        setSelected(new Set(parsed.filter((k) => ALL_KINDS.includes(k))));
      } else {
        setSelected(new Set(ENTITY_PRESETS["Schema only"]));
        setActivePreset("Schema only");
      }
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...selected]));
  }, [selected, hydrated]);

  const toggle = (k: EntityKind) => {
    setActivePreset(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  };
  const applyPreset = (name: string) => {
    const kinds = ENTITY_PRESETS[name];
    if (!kinds) return;
    setActivePreset(name);
    setSelected(new Set(kinds));
  };
  const clearAll = () => {
    setActivePreset(null);
    setSelected(new Set());
  };

  const counts = useMemo(() => ({
    selected: selected.size,
    total: ALL_KINDS.length,
  }), [selected]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Snapshot</h1>
        <p className="mt-2 opacity-80 max-w-2xl">
          Pick which entity kinds to capture from the source and each target.
          Dashboards default to <strong>off</strong> — the safe path is
          schema-only until you opt in.
        </p>
      </div>

      <section className="rounded-lg border border-black/10 dark:border-white/10 p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-sm font-medium">Presets</div>
          <div className="text-xs opacity-70">Click one to replace the current selection</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ENTITY_PRESETS).map(([name, kinds]) => {
            const active = activePreset === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => applyPreset(name)}
                className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                  active
                    ? "border-ink dark:border-paper bg-ink text-paper dark:bg-paper dark:text-ink"
                    : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                }`}
              >
                <div className="font-medium">{name}</div>
                <div className="opacity-75 text-xs mt-0.5 font-mono">
                  {kinds.length} kinds
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={clearAll}
            className="rounded-md border border-black/10 dark:border-white/10 px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/5"
          >
            Clear all
          </button>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Entity kinds</h2>
          <div className="text-xs opacity-70">
            {counts.selected} / {counts.total} selected
          </div>
        </div>

        {GROUPS.map((group) => (
          <div key={group.title} className="rounded-lg border border-black/10 dark:border-white/10 p-4">
            <div className="text-xs uppercase tracking-wide opacity-60 mb-3">{group.title}</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {group.kinds.map((k) => {
                const on = selected.has(k);
                return (
                  <label
                    key={k}
                    className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                      on
                        ? "border-green-500/50 bg-green-500/5"
                        : "border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => toggle(k)}
                      className="mt-1"
                    />
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{KIND_LABELS[k].label}</div>
                      <div className="text-xs opacity-75 mt-0.5">{KIND_LABELS[k].hint}</div>
                      <div className="text-[10px] font-mono opacity-50 mt-1">{k}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      <section className="pt-2 flex flex-wrap items-center gap-3">
        <a
          href="/connect"
          className="rounded-md border border-black/10 dark:border-white/10 px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/5"
        >
          ← Connect
        </a>
        <button
          type="button"
          disabled={counts.selected === 0}
          onClick={() => (window.location.href = "/match")}
          className="rounded-md bg-ink text-paper dark:bg-paper dark:text-ink px-4 py-2 text-sm font-medium disabled:opacity-50"
        >
          Continue to Match →
        </button>
        <span className="text-xs opacity-60">
          Capture execution arrives with the pipeline pass; selection is persisted.
        </span>
      </section>
    </div>
  );
}
