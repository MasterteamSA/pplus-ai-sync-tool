import type Anthropic from "@anthropic-ai/sdk";

type ToolDef = Anthropic.Messages.Tool;

export const proposeMappingTool: ToolDef = {
  name: "proposeMapping",
  description:
    "Propose pairings between unmatched source entities and unmatched target entities. Deterministic matches have already been removed. Only use the IDs present in the provided lists. Return an array of proposals; any source you cannot confidently match should be omitted.",
  input_schema: {
    type: "object",
    properties: {
      kind: {
        type: "string",
        enum: [
          "level",
          "log",
          "property",
          "propertyStatus",
          "phaseGate",
          "lookup",
          "workflow",
          "dashboard",
          "chartComponent",
          "source",
        ],
      },
      proposals: {
        type: "array",
        items: {
          type: "object",
          properties: {
            sourceId: { type: "string" },
            targetId: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            reason: { type: "string" },
          },
          required: ["sourceId", "targetId", "confidence", "reason"],
        },
      },
    },
    required: ["kind", "proposals"],
  },
};

export const rewriteFormulaTool: ToolDef = {
  name: "rewriteFormula",
  description:
    "Rewrite a PPlus formula or script so that every {{Key}} reference is updated according to the provided keyMap. Do not introduce keys outside keyMap.to values or the original formula's unchanged keys. If the rewrite is unsafe, return the original with confidence < 0.5.",
  input_schema: {
    type: "object",
    properties: {
      rewritten: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      unchanged: { type: "boolean" },
      notes: { type: "string" },
    },
    required: ["rewritten", "confidence", "unchanged"],
  },
};

export const classifyRiskTool: ToolDef = {
  name: "classifyRisk",
  description:
    "Classify the risk of a single sync operation. low: safe, easily reversible. med: meaningful change, review suggested. high: destructive, ambiguous, or touches many dependents.",
  input_schema: {
    type: "object",
    properties: {
      risk: { type: "string", enum: ["low", "med", "high"] },
      reasons: { type: "array", items: { type: "string" } },
    },
    required: ["risk", "reasons"],
  },
};

export const TOOLS: ToolDef[] = [proposeMappingTool, rewriteFormulaTool, classifyRiskTool];
