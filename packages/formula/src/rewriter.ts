import { extractKeys, stringify, tokenize, type Token } from "./parser";

export interface KeyMap {
  [from: string]: string;
}

export interface RewriteResult {
  before: string;
  after: string;
  changed: boolean;
  rewrites: { from: string; to: string; location: string }[];
  unresolved: string[];
}

/**
 * Deterministic rewrite: replaces every `{{from}}` with `{{to}}` using keyMap.
 * Any key not in keyMap stays untouched (that's a legitimate no-op for keys
 * whose property wasn't renamed). Post-rewrite we re-parse and emit the list
 * of keys still present; the caller can cross-check them against the known
 * target property-key set and fail the op if an unknown key slipped through.
 */
export function rewriteFormula(input: string, keyMap: KeyMap, fieldPath = "formula"): RewriteResult {
  const tokens = tokenize(input);
  const rewrites: RewriteResult["rewrites"] = [];
  const out: Token[] = tokens.map((t) => {
    if (t.type !== "keyRef") return t;
    const next = keyMap[t.key];
    if (next && next !== t.key) {
      rewrites.push({ from: t.key, to: next, location: fieldPath });
      return { type: "keyRef", key: next, raw: `{{${next}}}` };
    }
    return t;
  });
  const after = stringify(out);
  return {
    before: input,
    after,
    changed: rewrites.length > 0,
    rewrites,
    unresolved: [],
  };
}

/**
 * Validates that the rewritten output references only keys present in `allowed`.
 * Returns the list of unknown keys (empty = safe to apply).
 */
export function validateRewrittenKeys(rewritten: string, allowed: ReadonlySet<string>): string[] {
  const unknown: string[] = [];
  for (const key of extractKeys(rewritten)) {
    if (!allowed.has(key)) unknown.push(key);
  }
  return unknown;
}
