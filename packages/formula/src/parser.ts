/**
 * PPlus formula/script token parser.
 *
 * PPlus formulas embed property-key references in `{{Key}}` syntax, e.g.
 *   `SUM({{Site_Area_12}}) / {{Site_Count_9}}`
 *
 * This parser scans a string and emits a flat token list. It is intentionally
 * dumb: any text outside `{{...}}` is a Text token; anything inside is a KeyRef.
 * That covers the documented PPlus expression language. For JS scripts with
 * embedded keys (rare), the rewriter hands off to Claude via rewriteFormula.
 */

export type Token =
  | { type: "text"; value: string }
  | { type: "keyRef"; key: string; raw: string };

const KEY_RE = /\{\{\s*([^{}\s][^{}]*?)\s*\}\}/g;

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let lastIndex = 0;
  KEY_RE.lastIndex = 0;
  for (;;) {
    const m = KEY_RE.exec(input);
    if (!m) break;
    if (m.index > lastIndex) {
      tokens.push({ type: "text", value: input.slice(lastIndex, m.index) });
    }
    tokens.push({ type: "keyRef", key: m[1]!, raw: m[0] });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < input.length) {
    tokens.push({ type: "text", value: input.slice(lastIndex) });
  }
  return tokens;
}

export function stringify(tokens: Token[]): string {
  return tokens
    .map((t) => (t.type === "text" ? t.value : `{{${t.key}}}`))
    .join("");
}

export function extractKeys(input: string): string[] {
  const out: string[] = [];
  for (const t of tokenize(input)) if (t.type === "keyRef") out.push(t.key);
  return out;
}
