/**
 * PPlus property keys follow the convention `LevelName_PropertyName_UniqueId`.
 * LevelName and PropertyName may themselves contain underscores (e.g.
 * `Site_Area_Measure`). UniqueId is usually numeric and trails at the end.
 * This parser is best-effort: it separates a trailing numeric suffix as the
 * UniqueId, the leading token(s) matching a provided level-name list as the
 * level prefix, and the middle as the base name.
 *
 * Why explicit level-name awareness matters: without it we'd guess the
 * level/name boundary wrong whenever names contain underscores. The caller
 * passes the known set of level names from the catalog.
 */

export interface ParsedKey {
  raw: string;
  levelName: string | null;
  baseName: string;
  uniqueId: string | null;
}

const UID_RE = /^[0-9a-f]{4,}$|^\d{1,6}$/i;

export function parseKey(raw: string, knownLevelNames: readonly string[]): ParsedKey {
  const tokens = raw.split("_");
  if (tokens.length === 0) return { raw, levelName: null, baseName: raw, uniqueId: null };

  // Pull a trailing UID-looking token off.
  let uniqueId: string | null = null;
  const last = tokens[tokens.length - 1];
  if (last && UID_RE.test(last)) {
    uniqueId = last;
    tokens.pop();
  }
  if (tokens.length === 0) return { raw, levelName: null, baseName: raw, uniqueId };

  // Try to match the longest prefix against knownLevelNames.
  const normalized = (s: string): string => s.toLowerCase().replace(/[\s_-]+/g, "");
  const levelSet = new Map(knownLevelNames.map((n) => [normalized(n), n] as const));
  for (let take = Math.min(tokens.length - 1, 4); take >= 1; take--) {
    const candidate = tokens.slice(0, take).join("");
    const hit = levelSet.get(normalized(candidate));
    if (hit) {
      return {
        raw,
        levelName: hit,
        baseName: tokens.slice(take).join("_"),
        uniqueId,
      };
    }
  }
  // Fall back: first token is the level, rest is the name.
  return {
    raw,
    levelName: tokens[0] ?? null,
    baseName: tokens.slice(1).join("_") || (tokens[0] ?? raw),
    uniqueId,
  };
}

/** Compose a key from its parts with the standard `_` separator. */
export function composeKey(parts: { levelName?: string | null; baseName: string; uniqueId?: string | null }): string {
  const segs: string[] = [];
  if (parts.levelName) segs.push(parts.levelName);
  segs.push(parts.baseName);
  if (parts.uniqueId) segs.push(parts.uniqueId);
  return segs.join("_");
}
