export const ENTITY_KINDS = [
  // ── Hierarchy & data model ──
  "level",           // /api/Levels                — level definitions
  "log",             // /api/Logs                  — log-type definitions
  "property",        // /api/Levels/{id}/Properties — level properties
  "logProperty",     // /api/Logs/{id}/Properties   — log properties (per-log)
  "levelSection",    // /api/Levels/{id}/Sections   — property groupings
  "propertyStatus",  // /api/properties/{schemaId}/Status — status values
  "levelStatus",     // /api/Levels/{id}/Statuses   — per-level statuses/colors
  "phaseGate",       // /api/Levels/{id}/PhaseGates
  "lookup",          // /api/Lookups               — ~40 lookup lists
  "source",          // /api/source                — Level.Sources (legacy kept)

  // ── Per-level admin sections ──
  "levelAttachedLogs", // /api/Levels/{id}/Logs      — which logs bind to a level
  "role",              // /api/Levels/{id}/Roles
  "escalation",        // /api/Levels/{id}/Escalation
  "procurement",       // /api/Levels/{id}/Procurement
  "cardConfig",        // /api/Levels/{id}/CardsManagement
  "processBuilder",    // /api/Levels/{id}/ProcessBuilder
  "approvalProcess",   // /api/Levels/{id}/Approvals
  "codeBuilder",       // /api/Levels/{id}/Code
  "notification",      // /api/Levels/{id}/Notifications
  "workflow",          // /api/workflow + level-attached workflows

  // ── Dashboards ──
  "dashboard",       // /api/Dashboards
  "chartComponent",  // /api/component/chart

  // ── Global admin ──
  "user",            // /api/Users
  "group",           // /api/Groups
  "setting",         // /api/Settings (identity, colors, images, SMTP)
  "holiday",         // /api/Holidays
  "accessibility",   // /api/Accessibilities (permission groups, categories, landing)
  "classification",  // /api/Classification/risks, /api/Classification/issues
  "scheduleView",    // /api/ScheduleViews
  "delegation",      // /api/Delegations
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
