"use client";

/**
 * Lightweight client-side state for the flow pages. Persists to localStorage
 * so the operator can walk through Connect → Snapshot → Match → Align → Diff
 * → Apply → History without a server round-trip. Replaced by real DB-backed
 * runs in the pipeline implementation pass.
 */

export interface EnvEntry {
  label: string;
  baseUrl: string;
  authMode: "cookie" | "bearer" | "basic";
  secret?: string;
  csr?: string;
  ok?: boolean;
}

export interface MatchDecision {
  kind: string;
  sourceId: string;
  targetId: string | null;
  method: string;
  confidence: number;
  reason: string;
  accepted?: boolean;
}

export interface DiffOp {
  id: string;
  op: "create" | "update" | "delete" | "rewriteRef";
  kind: string;
  sourceId?: string;
  targetId?: string;
  label: string;
  detail: string;
  risk: "low" | "med" | "high";
}

export interface RunRecord {
  id: string;
  createdAt: string;
  actor: string;
  sourceLabel: string;
  targetLabels: string[];
  kinds: string[];
  ops: number;
  applied: number;
  failed: number;
  status: "draft" | "matched" | "planned" | "applied" | "failed" | "rolled-back";
  summary?: string;
}

const K = {
  envs: "pplus-sync:envs",
  kinds: "pplus-sync:selectedKinds",
  matches: "pplus-sync:matches",
  diff: "pplus-sync:diff",
  history: "pplus-sync:history",
} as const;

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
}

export const flow = {
  getEnvs: () => read<{ source?: EnvEntry; targets: EnvEntry[] }>(K.envs, { targets: [] }),
  setEnvs: (v: { source?: EnvEntry; targets: EnvEntry[] }) => write(K.envs, v),

  getKinds: () => read<string[]>(K.kinds, []),
  setKinds: (v: string[]) => write(K.kinds, v),

  getMatches: () => read<MatchDecision[]>(K.matches, []),
  setMatches: (v: MatchDecision[]) => write(K.matches, v),

  getDiff: () => read<DiffOp[]>(K.diff, []),
  setDiff: (v: DiffOp[]) => write(K.diff, v),

  getHistory: () => read<RunRecord[]>(K.history, []),
  addRun: (r: RunRecord) => write(K.history, [r, ...read<RunRecord[]>(K.history, [])].slice(0, 50)),
  updateRun: (id: string, patch: Partial<RunRecord>) => {
    const list = read<RunRecord[]>(K.history, []);
    write(
      K.history,
      list.map((r) => (r.id === id ? { ...r, ...patch } : r)),
    );
  },
  removeRun: (id: string) =>
    write(K.history, read<RunRecord[]>(K.history, []).filter((r) => r.id !== id)),
};

// ──────────────────────────────────────────────────────────────────────────
// Demo seeds — so every page has sensible default content even before the
// operator has clicked through the whole flow.
// ──────────────────────────────────────────────────────────────────────────

export const SEED_LEVELS = {
  source: [
    { id: "L-1", key: "Site", name: "Site", parentId: null },
    { id: "L-2", key: "Project", name: "Project", parentId: "L-1" },
  ],
  target: [
    { id: "L-11", key: "Facility", name: "Facility", parentId: null },
    { id: "L-12", key: "Project", name: "Project", parentId: "L-11" },
  ],
  levelMap: { Site: "Facility" },
};

export const SEED_PROPS = {
  source: [
    { key: "Site_Revenue_1", name: "Revenue" },
    { key: "Site_Cost_2", name: "Cost" },
    { key: "Site_Area_12", name: "Area", formula: "{{Site_Revenue_1}} - {{Site_Cost_2}}" },
    { key: "Site_Owner_3", name: "Owner" },
    { key: "Site_Mystery_7", name: "Mystery" },
  ],
  target: [
    { key: "Facility_Revenue_91", name: "Revenue" },
    { key: "Facility_Cost_92", name: "Cost" },
    { key: "Facility_Area_78", name: "Area" },
    { key: "Facility_Manager_4", name: "Manager" },
    { key: "Facility_Orphan_1", name: "Orphan" },
  ],
};

export const SEED_DIFF: DiffOp[] = [
  {
    id: "op-1",
    op: "update",
    kind: "level",
    sourceId: "L-1",
    targetId: "L-11",
    label: "Level: Site → Facility",
    detail: "Rename confirmed; child properties will be re-keyed.",
    risk: "med",
  },
  {
    id: "op-2",
    op: "rewriteRef",
    kind: "property",
    sourceId: "Site_Area_12",
    targetId: "Facility_Area_78",
    label: "Formula rewrite: Site_Area_12 → Facility_Area_78",
    detail: "{{Site_Revenue_1}} - {{Site_Cost_2}} → {{Facility_Revenue_91}} - {{Facility_Cost_92}}",
    risk: "low",
  },
  {
    id: "op-3",
    op: "create",
    kind: "property",
    sourceId: "Site_Mystery_7",
    label: "Create property: Mystery on target",
    detail: "No match found on target — creates new property.",
    risk: "high",
  },
  {
    id: "op-4",
    op: "delete",
    kind: "property",
    targetId: "Facility_Orphan_1",
    label: "Delete orphan: Facility_Orphan_1",
    detail: "Exists on target but not source; will be removed on apply.",
    risk: "high",
  },
];
