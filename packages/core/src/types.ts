export const ENTITY_KINDS = [
  "level",
  "log",
  "property",
  "propertyStatus",
  "phaseGate",
  "lookup",
  "workflow",
  "dashboard",
  "chartComponent",
  "source",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export interface Entity<K extends EntityKind = EntityKind> {
  kind: K;
  id: string;
  key?: string;
  name: string;
  parentId?: string;
  payload: unknown;
  hash: string;
}

export interface Snapshot {
  id: string;
  env: "source" | "target";
  envLabel: string;
  baseUrl: string;
  capturedAt: string;
  kinds: EntityKind[];
  entities: Partial<Record<EntityKind, Entity[]>>;
  instanceHint?: string;
}

export type MatchMethod = "id" | "key" | "name" | "fuzzy" | "semantic" | "manual" | "create";

export interface MappingDecision {
  kind: EntityKind;
  sourceId: string;
  targetId: string | null;
  method: MatchMethod;
  confidence: number;
  reason: string;
  accepted: boolean;
}

export type DiffOpKind = "create" | "update" | "delete" | "rewriteRef";

export interface RefRewrite {
  from: string;
  to: string;
  location: string;
}

export interface DiffOp {
  id: string;
  op: DiffOpKind;
  kind: EntityKind;
  sourceId?: string;
  targetId?: string;
  before?: unknown;
  after?: unknown;
  refRewrites?: RefRewrite[];
  risk: "low" | "med" | "high";
  riskReasons?: string[];
}

export interface SyncPlan {
  runId: string;
  targetRunId: string;
  ops: DiffOp[];
  summary: Partial<Record<EntityKind, { c: number; u: number; d: number; r: number }>>;
}

export interface AuditEntry {
  runId: string;
  targetRunId?: string;
  actor: string;
  ts: string;
  stage: "capture" | "match" | "diff" | "plan" | "apply" | "rollback";
  ok: boolean;
  payloadRef: string;
  message?: string;
}

export interface TargetConnection {
  id: string;
  label: string;
  baseUrl: string;
  authMode: "cookie" | "bearer" | "basic";
}

export interface RunDescriptor {
  runId: string;
  source: TargetConnection;
  targets: TargetConnection[];
  kinds: EntityKind[];
  createdAt: string;
  actor: string;
}
