/**
 * Shared filtering helpers used by both the /autopilot orchestrator and the
 * manual /diff → /apply flow. Keeps the "what's safe to write" policy in
 * one place.
 */

/**
 * Kinds that are structurally un-syncable via flat CRUD on PPlus. Attempts
 * to POST/PUT/DELETE these always 405 — they exist, but PPlus manages them
 * through tree/specialty endpoints (level-management, settings UI, etc.)
 * that need more context than a simple REST sync.
 */
export const NEVER_SYNCABLE_KINDS: ReadonlySet<string> = new Set([
  "level",
  "accessibility",
  "setting",
  "delegation",
  "holiday",
]);

/**
 * Detect a "system/built-in" record that the target refuses to mutate.
 * Heuristics come from real PPlus payloads observed on pplusrua-prod /
 * raapplus:
 *   - payload.canBeDeleted === false  → protected by the server.
 *   - kind="log" AND payload.type === 1  → built-in (Task, Risk, Issue, …).
 *   - kind="log" AND numeric id <= 12  → seeded.
 *   - kind="lookup" AND numeric id < 1000  → seeded.
 */
export function isBuiltin(kind: string, entity: { payload?: unknown } | undefined | null): boolean {
  const p = entity?.payload as Record<string, unknown> | undefined;
  if (!p || typeof p !== "object") return false;
  if (p.canBeDeleted === false) return true;
  if (kind === "log" && (p.type as unknown) === 1) return true;
  if (kind === "log" && typeof p.id === "number" && (p.id as number) <= 12) return true;
  if (kind === "lookup" && typeof p.id === "number" && (p.id as number) < 1000) return true;
  return false;
}

export interface SafeModeOptions {
  /** Default false — skip all built-in/system records. */
  includeBuiltins?: boolean;
  /** Default false — skip updates to existing entities. */
  includeUpdates?: boolean;
  /** Default false — skip deleting target-only entities. */
  includeDeletes?: boolean;
}

export interface FilterableOp {
  op: "create" | "update" | "delete" | "rewriteRef";
  kind: string;
  sourceEntity?: { payload?: unknown } | null | undefined;
  targetEntity?: { payload?: unknown } | null | undefined;
}

export interface FilterResult<T> {
  kept: T[];
  dropped: { op: T; reason: string }[];
}

/**
 * Filter a list of diff ops using safe-mode rules. Returns kept + dropped
 * with reasons so the UI can surface exactly what was filtered.
 */
export function applySafeModeFilter<T extends FilterableOp>(
  ops: T[],
  opts: SafeModeOptions = {},
): FilterResult<T> {
  const includeBuiltins = opts.includeBuiltins ?? false;
  const includeUpdates = opts.includeUpdates ?? false;
  const includeDeletes = opts.includeDeletes ?? false;

  const kept: T[] = [];
  const dropped: { op: T; reason: string }[] = [];

  for (const op of ops) {
    if (NEVER_SYNCABLE_KINDS.has(op.kind)) {
      dropped.push({ op, reason: `kind '${op.kind}' is not syncable via flat CRUD` });
      continue;
    }
    if (!includeUpdates && op.op === "update") {
      dropped.push({ op, reason: "updates off (safe mode)" });
      continue;
    }
    if (!includeDeletes && op.op === "delete") {
      dropped.push({ op, reason: "deletes off (safe mode)" });
      continue;
    }
    if (!includeBuiltins) {
      if (isBuiltin(op.kind, op.sourceEntity) || isBuiltin(op.kind, op.targetEntity)) {
        dropped.push({ op, reason: "system/built-in record (safe mode)" });
        continue;
      }
    }
    kept.push(op);
  }

  return { kept, dropped };
}
