import type { KeyAlignmentDecision } from "@pplus-sync/core";
import { AiClient } from "./client";

/**
 * Agentic key resolver. Takes the residual decisions the deterministic
 * aligner couldn't close (each with up to N candidate targetKeys) and asks
 * Claude to pick the best candidate — or return null if no candidate is
 * safe. The agent then self-validates: every chosen targetKey must exist in
 * the provided target-key allow-set. Anything failing validation is retried
 * once with the failure reason appended to the prompt.
 *
 * Context supplied to Claude:
 *   • matched level pairs (source → target)
 *   • full lists of source/target property keys (with name + type)
 *   • optional per-key formula usage (shows how a key is referenced)
 *
 * We do NOT leak formulas or key values beyond what the operator has
 * already given us; nothing is fetched from outside the run.
 */

export interface KeyAgentContext {
  levelMap: Record<string, string>;
  sourceKeys: { key: string; name?: string; type?: string; formulas?: string[] }[];
  targetKeys: { key: string; name?: string; type?: string; formulas?: string[] }[];
  hint?: string;
}

export interface KeyAgentResult {
  sourceKey: string;
  targetKey: string | null;
  confidence: number;
  reason: string;
  /** Which candidates the agent considered. */
  considered?: string[];
}

export class KeyAgent {
  constructor(private readonly ai: AiClient = new AiClient()) {}

  async resolve(
    residuals: KeyAlignmentDecision[],
    ctx: KeyAgentContext,
  ): Promise<KeyAgentResult[]> {
    if (residuals.length === 0) return [];
    const targetKeySet = new Set(ctx.targetKeys.map((k) => k.key));

    const call = async (passNote: string): Promise<KeyAgentResult[]> => {
      const catalog = [
        {
          kind: "property" as const,
          source: ctx.sourceKeys.map((s) => ({ id: s.key, key: s.key, name: s.name ?? s.key })),
          target: ctx.targetKeys.map((t) => ({ id: t.key, key: t.key, name: t.name ?? t.key })),
        },
      ];
      const residualJson = residuals.map((r) => ({
        sourceKey: r.sourceKey,
        candidates: r.candidates?.map((c) => ({ targetKey: c.targetKey, score: c.score, hint: c.reason })) ?? [],
        reasonSoFar: r.reason,
      }));
      const hint =
        [
          ctx.hint ?? "",
          `Known level renames: ${JSON.stringify(ctx.levelMap)}`,
          passNote,
        ]
          .filter(Boolean)
          .join("\n");

      const proposals = await this.ai.proposeMapping(catalog, {
        kind: "property",
        unmatchedSource: residuals.map((r) => ({ id: r.sourceKey, key: r.sourceKey, name: r.sourceKey })),
        unmatchedTarget: ctx.targetKeys
          .filter((t) => !residuals.every((r) => r.candidates?.every((c) => c.targetKey !== t.key)))
          .map((t) => ({ id: t.key, key: t.key, name: t.name ?? t.key })),
        hint,
      });

      return residuals.map((r) => {
        const match = proposals.find((p) => p.sourceId === r.sourceKey);
        if (!match) {
          return {
            sourceKey: r.sourceKey,
            targetKey: null,
            confidence: 0,
            reason: "AI declined to propose a match — needs human decision",
            considered: r.candidates?.map((c) => c.targetKey) ?? [],
          };
        }
        return {
          sourceKey: r.sourceKey,
          targetKey: match.targetId,
          confidence: match.confidence,
          reason: match.reason,
          considered: r.candidates?.map((c) => c.targetKey) ?? [],
        };
      });
    };

    let results = await call("First pass — pick the single best target for each source, or none.");
    const invalid = results.filter((r) => r.targetKey && !targetKeySet.has(r.targetKey));
    if (invalid.length > 0) {
      const note =
        `Prior attempt produced ${invalid.length} target key(s) that don't exist on the target: ` +
        invalid.map((i) => i.targetKey).join(", ") +
        `. Only pick keys that are in the provided target list.`;
      results = await call(note);
    }

    // Final validation pass: nullify any still-invalid picks.
    for (const r of results) {
      if (r.targetKey && !targetKeySet.has(r.targetKey)) {
        r.targetKey = null;
        r.confidence = 0;
        r.reason = "AI proposed a non-existent target key; suppressed.";
      }
    }
    return results;
  }
}
