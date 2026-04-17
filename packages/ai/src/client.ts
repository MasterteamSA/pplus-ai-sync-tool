import Anthropic from "@anthropic-ai/sdk";
import type { Entity, EntityKind } from "@pplus-sync/core";
import { SYSTEM_PROMPT } from "./prompts.js";
import {
  TOOLS,
  proposeMappingTool,
  rewriteFormulaTool,
  classifyRiskTool,
} from "./tools.js";

export interface AiClientOptions {
  apiKey?: string;
  model?: string;
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

export class AiClient {
  private readonly client: Anthropic | null;
  private readonly model: string;

  constructor(opts: AiClientOptions = {}) {
    const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.model = opts.model ?? process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7";
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /**
   * Build a system block that pins both catalogs into the prompt cache.
   * Reused across every tool call in a run; subsequent calls hit the 5-min
   * ephemeral cache and pay only the delta + output.
   */
  private buildSystem(catalog: CatalogSlice[]): Anthropic.Messages.TextBlockParam[] {
    return [
      { type: "text", text: SYSTEM_PROMPT },
      {
        type: "text",
        text: `Catalog for this run (normalized):\n${JSON.stringify(catalog)}`,
        cache_control: { type: "ephemeral" },
      },
    ];
  }

  async proposeMapping(
    catalog: CatalogSlice[],
    input: ProposeMappingInput,
  ): Promise<MappingProposal[]> {
    if (!this.client) throw new Error("AI disabled: ANTHROPIC_API_KEY not set");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: this.buildSystem(catalog),
      tools: TOOLS,
      tool_choice: { type: "tool", name: proposeMappingTool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Propose mappings for kind="${input.kind}".${
                input.hint ? `\nOperator hint: ${input.hint}` : ""
              }\nUnmatched source:\n${JSON.stringify(input.unmatchedSource)}\nUnmatched target:\n${JSON.stringify(input.unmatchedTarget)}`,
            },
          ],
        },
      ],
    });
    for (const block of res.content) {
      if (block.type === "tool_use" && block.name === proposeMappingTool.name) {
        const parsed = block.input as { proposals?: MappingProposal[] };
        return parsed.proposals ?? [];
      }
    }
    return [];
  }

  async rewriteFormula(
    catalog: CatalogSlice[],
    input: RewriteFormulaInput,
  ): Promise<RewriteFormulaOutput> {
    if (!this.client) throw new Error("AI disabled: ANTHROPIC_API_KEY not set");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 2048,
      system: this.buildSystem(catalog),
      tools: TOOLS,
      tool_choice: { type: "tool", name: rewriteFormulaTool.name },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Rewrite this ${input.grammar} formula using the key map.\nFormula:\n${input.formula}\nKey map:\n${JSON.stringify(input.keyMap)}`,
            },
          ],
        },
      ],
    });
    for (const block of res.content) {
      if (block.type === "tool_use" && block.name === rewriteFormulaTool.name) {
        return block.input as RewriteFormulaOutput;
      }
    }
    return { rewritten: input.formula, confidence: 0, unchanged: true, notes: "no tool output" };
  }

  async classifyRisk(
    catalog: CatalogSlice[],
    opJson: unknown,
  ): Promise<{ risk: "low" | "med" | "high"; reasons: string[] }> {
    if (!this.client) throw new Error("AI disabled: ANTHROPIC_API_KEY not set");
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: 512,
      system: this.buildSystem(catalog),
      tools: TOOLS,
      tool_choice: { type: "tool", name: classifyRiskTool.name },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: `Classify risk for op:\n${JSON.stringify(opJson)}` },
          ],
        },
      ],
    });
    for (const block of res.content) {
      if (block.type === "tool_use" && block.name === classifyRiskTool.name) {
        return block.input as { risk: "low" | "med" | "high"; reasons: string[] };
      }
    }
    return { risk: "med", reasons: ["no tool output"] };
  }

  /** Streaming explanation used by /api/ai/explain route. */
  async *explainDiff(
    catalog: CatalogSlice[],
    ops: unknown[],
  ): AsyncIterable<string> {
    if (!this.client) throw new Error("AI disabled: ANTHROPIC_API_KEY not set");
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system: this.buildSystem(catalog),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Explain the following diff operations to a human operator in plain English, grouped by entity kind. Highlight any risky or unusual changes.\n${JSON.stringify(ops)}`,
            },
          ],
        },
      ],
    });
    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        yield event.delta.text;
      }
    }
  }
}
