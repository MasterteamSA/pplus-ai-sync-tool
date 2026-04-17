import type { Entity, EntityKind, MappingDecision } from "./types";

const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[\s_-]+/g, "").replace(/[^a-z0-9]/g, "");

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (curr[j - 1] ?? 0) + 1,
        (prev[j] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[bl] ?? 0;
}

export function similarity(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

export interface MatchContext {
  kind: EntityKind;
  source: Entity[];
  target: Entity[];
  fuzzyThreshold?: number;
}

export interface MatchResult {
  decisions: MappingDecision[];
  unmatchedSource: Entity[];
  unmatchedTarget: Entity[];
}

/**
 * Deterministic pass: exact id → exact key → normalized-name → fuzzy-name.
 * The residual goes to the AI `proposeMapping` tool.
 */
export function deterministicMatch(ctx: MatchContext): MatchResult {
  const threshold = ctx.fuzzyThreshold ?? 0.92;
  const decisions: MappingDecision[] = [];
  const targetById = new Map(ctx.target.map((t) => [t.id, t]));
  const targetByKey = new Map(
    ctx.target.filter((t) => t.key).map((t) => [t.key!, t]),
  );
  const targetByNorm = new Map(ctx.target.map((t) => [normalize(t.name), t]));
  const usedTargetIds = new Set<string>();

  const take = (src: Entity, tgt: Entity, method: MappingDecision["method"], confidence: number, reason: string) => {
    usedTargetIds.add(tgt.id);
    decisions.push({
      kind: ctx.kind,
      sourceId: src.id,
      targetId: tgt.id,
      method,
      confidence,
      reason,
      accepted: confidence >= 0.98,
    });
  };

  const remainingSource: Entity[] = [];
  for (const src of ctx.source) {
    const byId = targetById.get(src.id);
    if (byId && !usedTargetIds.has(byId.id)) {
      take(src, byId, "id", 1, "exact id match");
      continue;
    }
    if (src.key) {
      const byKey = targetByKey.get(src.key);
      if (byKey && !usedTargetIds.has(byKey.id)) {
        take(src, byKey, "key", 0.99, "exact key match");
        continue;
      }
    }
    const byNorm = targetByNorm.get(normalize(src.name));
    if (byNorm && !usedTargetIds.has(byNorm.id)) {
      take(src, byNorm, "name", 0.95, "normalized-name match");
      continue;
    }
    remainingSource.push(src);
  }

  const remainingTarget = ctx.target.filter((t) => !usedTargetIds.has(t.id));
  const stillUnmatched: Entity[] = [];
  for (const src of remainingSource) {
    let best: { tgt: Entity; score: number } | null = null;
    for (const tgt of remainingTarget) {
      if (usedTargetIds.has(tgt.id)) continue;
      const score = similarity(normalize(src.name), normalize(tgt.name));
      if (!best || score > best.score) best = { tgt, score };
    }
    if (best && best.score >= threshold) {
      take(src, best.tgt, "fuzzy", best.score, `fuzzy name similarity ${best.score.toFixed(2)}`);
    } else {
      stillUnmatched.push(src);
    }
  }

  return {
    decisions,
    unmatchedSource: stillUnmatched,
    unmatchedTarget: ctx.target.filter((t) => !usedTargetIds.has(t.id)),
  };
}
