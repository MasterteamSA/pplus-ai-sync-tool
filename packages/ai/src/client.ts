import { query, type Options, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Entity, EntityKind } from "@pplus-sync/core";
import { SYSTEM_PROMPT } from "./prompts";

/**
 * The AI layer runs via the Claude Agent SDK, which spawns the locally
 * installed `claude` CLI. This means the tool uses whatever subscription or
 * API key is already configured on the machine — no ANTHROPIC_API_KEY needed.
 *
 * For structured output we ask the model to return a single fenced JSON block
 * and parse it. (The agent SDK's `tools` option is for built-in Claude Code
 * tools like Read/Bash — we disable all of them since we only want text.)
 */

export interface AiClientOptions {
  model?: string;
  /** Working directory for the spawned `claude` process; defaults to cwd. */
  cwd?: string;
}

export interface CatalogSlice {
  kind: EntityKind;
  source: Pick<Entity, "id" | "key" | "name">[];
  target: Pick<Entity, "id" | "key" | "name">[];
}

export interface ProposeMappingInput {
  kind: EntityKind;
  unmatchedSource: Pick<Entity, "id" | "key" | "name">[];
  unmatchedTarget: Pick<Entity, "id" | "key" | "name">[];
  hint?: string;
}

export interface MappingProposal {
  sourceId: string;
  targetId: string;
  confidence: number;
  reason: string;
}

export interface RewriteFormulaInput {
  formula: string;
  keyMap: { from: string; to: string }[];
  grammar: "pplus-expr" | "js";
}

export interface RewriteFormulaOutput {
  rewritten: string;
  confidence: number;
  unchanged: boolean;
  notes?: string;
}

function buildSystemPrompt(catalog: CatalogSlice[]): string {
  return [
    SYSTEM_PROMPT,
    "",
    "=== Normalized catalog for this run (reference only, do not modify) ===",
    JSON.stringify(catalog),
    "=== End catalog ===",
    "",
    "When asked to return structured data, reply with EXACTLY one fenced JSON",
    "block (```json ... ```) containing the object or array described, and",
    "nothing else outside the fence.",
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const jsonStr = fenceMatch ? (fenceMatch[1] ?? "").trim() : text.trim();
  return JSON.parse(jsonStr);
}

function resolveClaudeExecutable(): string | undefined {
  const explicit = process.env.CLAUDE_CODE_EXECUTABLE ?? process.env.PPLUS_CLAUDE_PATH;
  if (explicit) return explicit;
  const home = process.env.HOME;
  const candidates = [
    home ? `${home}/.npm-global/bin/claude` : undefined,
    home ? `${home}/.local/bin/claude` : undefined,
    "/usr/local/bin/claude",
    "/opt/homebrew/bin/claude",
  ].filter((p): p is string => typeof p === "string");
  return candidates[0];
}

async function runQuery(
  prompt: string,
  systemPrompt: string,
  opts: { model: string; cwd: string | undefined },
): Promise<string> {
  const pathToClaudeCodeExecutable = resolveClaudeExecutable();
  const queryOptions: Options = {
    systemPrompt,
    tools: [],
    model: opts.model,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    settingSources: [],
  };
  let text = "";
  for await (const msg of query({ prompt, options: queryOptions }) as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") text += block.text;
      }
    }
    if (msg.type === "result") break;
  }
  return text;
}

async function* streamQuery(
  prompt: string,
  systemPrompt: string,
  opts: { model: string; cwd: string | undefined },
): AsyncIterable<string> {
  const pathToClaudeCodeExecutable = resolveClaudeExecutable();
  const queryOptions: Options = {
    systemPrompt,
    tools: [],
    model: opts.model,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(pathToClaudeCodeExecutable ? { pathToClaudeCodeExecutable } : {}),
    settingSources: [],
  };
  for await (const msg of query({ prompt, options: queryOptions }) as AsyncIterable<SDKMessage>) {
    if (msg.type === "assistant") {
      for (const block of msg.message.content) {
        if (block.type === "text") yield block.text;
      }
    }
    if (msg.type === "result") break;
  }
}

export class AiClient {
  private readonly model: string;
  private readonly cwd: string | undefined;

  constructor(opts: AiClientOptions = {}) {
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
    this.cwd = opts.cwd;
  }

  /**
   * Always enabled when the `claude` CLI is on PATH. The actual check happens
   * on first call; failures surface as caught exceptions with a clear message.
   */
  readonly enabled = true;

  async proposeMapping(
    catalog: CatalogSlice[],
    input: ProposeMappingInput,
  ): Promise<MappingProposal[]> {
    const sys = buildSystemPrompt(catalog);
    const prompt =
      `Propose mappings for kind="${input.kind}".` +
      (input.hint ? `\nOperator hint: ${input.hint}` : "") +
      `\nUnmatched source (id/key/name):\n${JSON.stringify(input.unmatchedSource)}` +
      `\nUnmatched target (id/key/name):\n${JSON.stringify(input.unmatchedTarget)}` +
      `\n\nReturn a JSON array of { sourceId, targetId, confidence, reason }. ` +
      `Omit any source you cannot confidently match.`;
    const text = await runQuery(prompt, sys, { model: this.model, cwd: this.cwd });
    const parsed = extractJson(text);
    return Array.isArray(parsed) ? (parsed as MappingProposal[]) : [];
  }

  async rewriteFormula(
    catalog: CatalogSlice[],
    input: RewriteFormulaInput,
  ): Promise<RewriteFormulaOutput> {
    const sys = buildSystemPrompt(catalog);
    const prompt =
      `Rewrite this ${input.grammar} formula so every {{Key}} reference matches the key map.\n` +
      `Only use keys from keyMap.to values or keys already present in the original that are NOT in keyMap.from.\n` +
      `Formula:\n${input.formula}\n\nKey map:\n${JSON.stringify(input.keyMap)}\n\n` +
      `Return a JSON object { rewritten, confidence, unchanged, notes? }. ` +
      `If unsafe, return the original with confidence < 0.5 and unchanged=true.`;
    const text = await runQuery(prompt, sys, { model: this.model, cwd: this.cwd });
    const parsed = extractJson(text) as Partial<RewriteFormulaOutput>;
    return {
      rewritten: parsed.rewritten ?? input.formula,
      confidence: parsed.confidence ?? 0,
      unchanged: parsed.unchanged ?? true,
      ...(parsed.notes ? { notes: parsed.notes } : {}),
    };
  }

  async classifyRisk(
    catalog: CatalogSlice[],
    opJson: unknown,
  ): Promise<{ risk: "low" | "med" | "high"; reasons: string[] }> {
    const sys = buildSystemPrompt(catalog);
    const prompt =
      `Classify the risk of this sync operation: low, med, or high.\n` +
      `Op:\n${JSON.stringify(opJson)}\n\n` +
      `Return a JSON object { risk: "low"|"med"|"high", reasons: string[] }.`;
    const text = await runQuery(prompt, sys, { model: this.model, cwd: this.cwd });
    const parsed = extractJson(text) as { risk?: "low" | "med" | "high"; reasons?: string[] };
    return { risk: parsed.risk ?? "med", reasons: parsed.reasons ?? [] };
  }

  /**
   * Direct JSON channel: sends the prompt as-is (no formula/rewriter framing)
   * and parses the first fenced JSON block from the response.
   */
  async runJson<T = unknown>(prompt: string, systemPromptOverride?: string): Promise<T | null> {
    const sys =
      systemPromptOverride ??
      [
        "You are a structured-output helper.",
        "Respond with EXACTLY one fenced ```json ... ``` block and nothing else.",
      ].join("\n");
    const text = await runQuery(prompt, sys, { model: this.model, cwd: this.cwd });
    try {
      return extractJson(text) as T;
    } catch {
      return null;
    }
  }

  explainDiff(catalog: CatalogSlice[], ops: unknown[]): AsyncIterable<string> {
    const sys = buildSystemPrompt(catalog);
    const prompt =
      `Explain the following diff operations to a human operator in plain English, grouped by entity kind. ` +
      `Highlight risky or unusual changes. Do NOT output JSON — write prose.\n\n${JSON.stringify(ops)}`;
    return streamQuery(prompt, sys, { model: this.model, cwd: this.cwd });
  }
}
