import { parseKey, type ParsedKey } from "./key-parser";
import { similarity } from "./matchers";

/**
 * Align property keys from a source instance to a target instance when the
 * two use different naming. The algorithm is:
 *
 *   1. Parse both sides into (levelName, baseName, uniqueId) triples.
 *   2. For each matched level pair (source level → target level), pair up
 *      properties by normalized baseName. Exact match first, then fuzzy
 *      with a score. Emit a decision with evidence.
 *   3. For properties whose level is unmatched, try a whole-catalog baseName
 *      search with lower confidence.
 *   4. If formula co-occurrence data is provided, boost matches whose
 *      co-occurrence neighbourhoods line up.
 *   5. Anything still unresolved is emitted as a candidate list for the AI
 *      agent to resolve semantically.
 *
 * Output decisions are explainable — each has a method, a numeric
 * confidence, and a human-readable reason — so the UI can surface them for
 * confirmation.
 */

export type KeyAlignMethod =
  | "exact-key"
  | "level-swap-exact"
  | "level-swap-fuzzy"
  | "global-fuzzy"
  | "cooccurrence-boost"
  | "ai"
  | "unresolved";

export interface KeyAlignmentDecision {
  sourceKey: string;
  targetKey: string | null;
  method: KeyAlignMethod;
  confidence: number;
  reason: string;
  candidates?: { targetKey: string; score: number; reason: string }[];
}

export interface AlignKeysProperty {
  key: string;
  name?: string | undefined;
  type?: string | undefined;
  formula?: string | null | undefined;
}

export interface AlignKeysInput {
  source: AlignKeysProperty[];
  target: AlignKeysProperty[];
  sourceLevelNames: string[];
  targetLevelNames: string[];
  /** Matched level pairs (source level name → target level name). */
  levelMap: Record<string, string>;
  /** Optional: formulas on each side, used as a cross-evidence signal. */
  sourceFormulas?: string[] | undefined;
  targetFormulas?: string[] | undefined;
  /** Minimum score to auto-accept a fuzzy match; below this goes to AI queue. */
  fuzzyAcceptThreshold?: number;
}

export interface AlignKeysResult {
  decisions: KeyAlignmentDecision[];
  unresolvedSourceKeys: string[];
  /** Keys the AI should decide on — includes candidate hints. */
  aiQueue: KeyAlignmentDecision[];
  /** Keys present on target but not in any decision. */
  unusedTargetKeys: string[];
}

const normalize = (s: string): string =>
  s.toLowerCase().normalize("NFKD").replace(/[\s_-]+/g, "").replace(/[^a-z0-9]/g, "");

function buildCooccurrence(formulas: string[] | undefined, keys: Set<string>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (!formulas) return out;
  for (const formula of formulas) {
    const hits: string[] = [];
    const re = /\{\{\s*([^{}]+?)\s*\}\}/g;
    for (let m = re.exec(formula); m; m = re.exec(formula)) {
      const k = m[1];
      if (k && keys.has(k)) hits.push(k);
    }
    for (const a of hits) {
      if (!out.has(a)) out.set(a, new Set());
      for (const b of hits) if (a !== b) out.get(a)!.add(b);
    }
  }
  return out;
}

export function alignKeys(input: AlignKeysInput): AlignKeysResult {
  const {
    source,
    target,
    sourceLevelNames,
    targetLevelNames,
    levelMap,
    sourceFormulas,
    targetFormulas,
    fuzzyAcceptThreshold = 0.8,
  } = input;

  const srcParsed: ParsedKey[] = source.map((p) => parseKey(p.key, sourceLevelNames));
  const tgtParsed: ParsedKey[] = target.map((p) => parseKey(p.key, targetLevelNames));

  const tgtByKey = new Map(target.map((p) => [p.key, p] as const));
  const tgtByNormBase = new Map<string, ParsedKey[]>();
  for (const tp of tgtParsed) {
    const bucket = tgtByNormBase.get(normalize(tp.baseName)) ?? [];
    bucket.push(tp);
    tgtByNormBase.set(normalize(tp.baseName), bucket);
  }

  const tgtByLevelAndBase = new Map<string, Map<string, ParsedKey[]>>();
  for (const tp of tgtParsed) {
    const levelKey = tp.levelName ? normalize(tp.levelName) : "__nolevel__";
    let inner = tgtByLevelAndBase.get(levelKey);
    if (!inner) {
      inner = new Map();
      tgtByLevelAndBase.set(levelKey, inner);
    }
    const bucket = inner.get(normalize(tp.baseName)) ?? [];
    bucket.push(tp);
    inner.set(normalize(tp.baseName), bucket);
  }

  const srcKeys = new Set(source.map((p) => p.key));
  const tgtKeys = new Set(target.map((p) => p.key));
  const srcCooc = buildCooccurrence(sourceFormulas, srcKeys);
  const tgtCooc = buildCooccurrence(targetFormulas, tgtKeys);

  const used = new Set<string>();
  const decisions: KeyAlignmentDecision[] = [];
  const aiQueue: KeyAlignmentDecision[] = [];

  const take = (decision: KeyAlignmentDecision) => {
    if (decision.targetKey) used.add(decision.targetKey);
    decisions.push(decision);
  };

  for (const sp of srcParsed) {
    // 1. exact key match.
    if (tgtByKey.has(sp.raw)) {
      take({
        sourceKey: sp.raw,
        targetKey: sp.raw,
        method: "exact-key",
        confidence: 1,
        reason: "identical key on both sides",
      });
      continue;
    }

    // 2. level-swap: use levelMap to rewrite source level, check for exact.
    if (sp.levelName && levelMap[sp.levelName] && sp.uniqueId) {
      const candidate = `${levelMap[sp.levelName]}_${sp.baseName}_${sp.uniqueId}`;
      if (tgtByKey.has(candidate)) {
        take({
          sourceKey: sp.raw,
          targetKey: candidate,
          method: "level-swap-exact",
          confidence: 0.99,
          reason: `level-rename ${sp.levelName}→${levelMap[sp.levelName]} keeps baseName and UID`,
        });
        continue;
      }
    }

    // 3. level-swap-fuzzy: same level + same baseName, different UID.
    if (sp.levelName && levelMap[sp.levelName]) {
      const mappedLevel = levelMap[sp.levelName];
      if (mappedLevel) {
        const inner = tgtByLevelAndBase.get(normalize(mappedLevel));
        const bucket = inner?.get(normalize(sp.baseName)) ?? [];
        const available = bucket.filter((b) => !used.has(b.raw));
        if (available.length === 1 && available[0]) {
          take({
            sourceKey: sp.raw,
            targetKey: available[0].raw,
            method: "level-swap-fuzzy",
            confidence: 0.95,
            reason: `unique baseName match within level ${mappedLevel} (UID drift)`,
          });
          continue;
        }
        if (available.length > 1) {
          aiQueue.push({
            sourceKey: sp.raw,
            targetKey: null,
            method: "unresolved",
            confidence: 0,
            reason: `ambiguous: ${available.length} target keys share baseName in level ${mappedLevel}`,
            candidates: available.map((c) => ({
              targetKey: c.raw,
              score: 0.7,
              reason: "same level + baseName after level rename",
            })),
          });
          continue;
        }
      }
    }

    // 4. global baseName match (even across levels), as last deterministic pass.
    const globalBucket = tgtByNormBase.get(normalize(sp.baseName)) ?? [];
    const globalAvail = globalBucket.filter((b) => !used.has(b.raw));
    if (globalAvail.length === 1 && globalAvail[0]) {
      // Apply cooccurrence boost.
      const cooBoost = cooccurrenceScore(sp.raw, globalAvail[0].raw, srcCooc, tgtCooc);
      const base = 0.82;
      const conf = Math.min(0.94, base + cooBoost * 0.12);
      take({
        sourceKey: sp.raw,
        targetKey: globalAvail[0].raw,
        method: cooBoost > 0 ? "cooccurrence-boost" : "global-fuzzy",
        confidence: conf,
        reason:
          cooBoost > 0
            ? `baseName match; ${cooBoost.toFixed(2)} formula-neighbourhood overlap supports it`
            : "baseName is unique across target (level differs)",
      });
      continue;
    }

    // 5. fuzzy: top-3 candidates by baseName similarity within any mapped level.
    const candidates: { targetKey: string; score: number; reason: string }[] = [];
    for (const tp of tgtParsed) {
      if (used.has(tp.raw)) continue;
      const nameSim = similarity(normalize(sp.baseName), normalize(tp.baseName));
      const levelAligned = sp.levelName && tp.levelName && levelMap[sp.levelName] === tp.levelName;
      const score = nameSim * (levelAligned ? 1 : 0.6);
      if (score >= 0.35) {
        candidates.push({
          targetKey: tp.raw,
          score,
          reason: `baseName similarity ${nameSim.toFixed(2)}${levelAligned ? " within matched level" : ""}`,
        });
      }
    }
    candidates.sort((a, b) => b.score - a.score);
    const top = candidates[0];
    if (top && top.score >= fuzzyAcceptThreshold && (candidates[1]?.score ?? 0) < top.score - 0.1) {
      take({
        sourceKey: sp.raw,
        targetKey: top.targetKey,
        method: "global-fuzzy",
        confidence: top.score,
        reason: top.reason,
      });
      continue;
    }

    aiQueue.push({
      sourceKey: sp.raw,
      targetKey: null,
      method: "unresolved",
      confidence: 0,
      reason:
        candidates.length === 0
          ? "no deterministic match found"
          : `top candidate confidence ${top?.score.toFixed(2)} below threshold`,
      candidates: candidates.slice(0, 5),
    });
  }

  const unusedTargetKeys = target.map((t) => t.key).filter((k) => !used.has(k));
  return {
    decisions,
    unresolvedSourceKeys: aiQueue.map((q) => q.sourceKey),
    aiQueue,
    unusedTargetKeys,
  };
}

function cooccurrenceScore(
  srcKey: string,
  tgtKey: string,
  srcCooc: Map<string, Set<string>>,
  tgtCooc: Map<string, Set<string>>,
): number {
  const srcNeighbors = srcCooc.get(srcKey);
  const tgtNeighbors = tgtCooc.get(tgtKey);
  if (!srcNeighbors || !tgtNeighbors || srcNeighbors.size === 0 || tgtNeighbors.size === 0) {
    return 0;
  }
  // Lightweight: share-of-neighbourhood by normalized baseName match.
  const srcBases = new Set(
    Array.from(srcNeighbors).map((k) => normalize(k.split("_").slice(1, -1).join("_") || k)),
  );
  const tgtBases = new Set(
    Array.from(tgtNeighbors).map((k) => normalize(k.split("_").slice(1, -1).join("_") || k)),
  );
  let overlap = 0;
  for (const b of srcBases) if (tgtBases.has(b)) overlap++;
  const max = Math.max(srcBases.size, tgtBases.size);
  return max === 0 ? 0 : overlap / max;
}
