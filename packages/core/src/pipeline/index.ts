import type {
  DiffOp,
  Entity,
  EntityKind,
  MappingDecision,
  RunDescriptor,
  Snapshot,
  SyncPlan,
} from "../types.js";

/**
 * Stage orchestrator. Each stage is idempotent keyed by (runId, targetRunId, stage)
 * so the UI can resume after a crash or tab close. Storage is injected so the
 * web app and tests can share this exact flow.
 */
export interface PipelineStorage {
  putSnapshot(s: Snapshot): Promise<void>;
  getSnapshot(id: string): Promise<Snapshot | null>;
  putMappings(runId: string, targetRunId: string, decisions: MappingDecision[]): Promise<void>;
  getMappings(runId: string, targetRunId: string): Promise<MappingDecision[]>;
  putPlan(plan: SyncPlan): Promise<void>;
  getPlan(runId: string, targetRunId: string): Promise<SyncPlan | null>;
  audit(stage: string, payload: unknown, opts: { runId: string; targetRunId?: string; ok: boolean; actor: string; message?: string }): Promise<void>;
}

export interface PipelineHooks {
  onProgress?: (stage: string, pct: number, detail?: string) => void;
}

export type Stage = "capture" | "match" | "diff" | "plan" | "apply" | "audit";

export function orderEntityKindsForApply(kinds: EntityKind[]): EntityKind[] {
  const order: EntityKind[] = [
    "level",
    "source",
    "log",
    "levelAttachedLogs",
    "property",
    "logProperty",
    "levelSection",
    "propertyStatus",
    "levelStatus",
    "phaseGate",
    "lookup",
    "workflow",
    "dashboard",
    "chartComponent",
    "role",
    "escalation",
    "procurement",
    "cardConfig",
    "processBuilder",
    "approvalProcess",
    "codeBuilder",
    "notification",
    "user",
    "group",
    "classification",
    "scheduleView",
    "setting",
    "holiday",
    "accessibility",
    "delegation",
  ];
  return order.filter((k) => kinds.includes(k));
}

export function summarizePlan(ops: DiffOp[]): SyncPlan["summary"] {
  const summary: SyncPlan["summary"] = {};
  for (const op of ops) {
    const bucket = (summary[op.kind] ??= { c: 0, u: 0, d: 0, r: 0 });
    if (op.op === "create") bucket.c++;
    else if (op.op === "update") bucket.u++;
    else if (op.op === "delete") bucket.d++;
    else if (op.op === "rewriteRef") bucket.r++;
  }
  return summary;
}

export interface PipelineContext {
  run: RunDescriptor;
  storage: PipelineStorage;
  hooks?: PipelineHooks;
}

/**
 * Placeholder for the full orchestrator. The MVP stage implementations land
 * in follow-up files (capture.ts, match.ts, diff.ts, plan.ts, apply.ts).
 * This module exposes the shared contracts so storage and hooks stay stable
 * as the stages are filled in.
 */
export async function emptyEntityBucket(kinds: EntityKind[]): Promise<Partial<Record<EntityKind, Entity[]>>> {
  return Object.fromEntries(kinds.map((k) => [k, []] as const));
}
