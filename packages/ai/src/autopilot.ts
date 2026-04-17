import { AiClient } from "./client";

/**
 * Autopilot AI helpers — Claude as an active participant at every failure.
 * All methods return structured output and are safe to call in a loop; they
 * never throw on bad AI output, returning an `ok: false` + reason instead.
 */

export interface PayloadFixInput {
  /** Entity kind being written. */
  kind: string;
  /** HTTP status returned by the target. */
  status: number;
  /** Raw response body from the target (truncated). */
  errorBody: string;
  /** The payload we sent that was rejected. */
  sentPayload: unknown;
  /** A successful entity of the same kind from the target, if available. */
  targetSample?: unknown;
  /** A successful entity of the same kind from the source (reference). */
  sourceSample?: unknown;
  /** Previous fix attempt notes, if any (so we don't loop identically). */
  priorAttempts?: string[];
}

export interface PayloadFixOutput {
  ok: boolean;
  /** The repaired payload to retry, or null if Claude can't confidently fix. */
  payload: unknown;
  /** One sentence describing what changed and why. */
  reason: string;
  /** If Claude wants the tool to target a different endpoint path. */
  altPath?: string;
}

export interface EndpointDiscoverInput {
  kind: string;
  triedPaths: string[];
  latestStatus: number;
  latestPreview: string;
}

export interface EndpointDiscoverOutput {
  ok: boolean;
  /** Suggested paths in priority order. Relative ("/api/...") — connector
   *  strips leading slash. Empty array if Claude can't propose anything. */
  paths: string[];
  reason: string;
}

export class AutopilotAi {
  constructor(private readonly ai: AiClient = new AiClient()) {}

  async fixPayload(input: PayloadFixInput): Promise<PayloadFixOutput> {
    const prompt = [
      `A POST to a PPlus instance for kind="${input.kind}" failed with HTTP ${input.status}.`,
      `Sent payload:\n${JSON.stringify(input.sentPayload, null, 2)}`,
      `Server error body (truncated):\n${input.errorBody.slice(0, 800)}`,
      input.targetSample
        ? `A successful existing ${input.kind} on the target looks like:\n${JSON.stringify(input.targetSample, null, 2)}`
        : `No target sample was available.`,
      input.sourceSample
        ? `The original ${input.kind} from source was:\n${JSON.stringify(input.sourceSample, null, 2)}`
        : "",
      input.priorAttempts?.length
        ? `Previous fix attempts that also failed:\n- ${input.priorAttempts.join("\n- ")}`
        : "",
      ``,
      `Task: return a JSON object { payload, reason, altPath? } where`,
      ` - payload is the corrected object to POST to the same (or altPath) endpoint,`,
      ` - reason is one sentence explaining what you changed and why,`,
      ` - altPath (optional) is a different relative URL to try instead, e.g. "/service/api/logs/custom".`,
      `Rules:`,
      `  1. Never hallucinate fields that aren't in the source, sample, or error body.`,
      `  2. If the server error clearly demands a missing field, add it with a value inferred from the samples.`,
      `  3. If you have no confident fix, set payload to null and explain why.`,
      `  4. Reply with EXACTLY one fenced JSON block.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const res = await this.ai.proposeMapping(
        [],
        {
          kind: "property",
          unmatchedSource: [],
          unmatchedTarget: [],
          hint: prompt,
        },
      );
      // proposeMapping returns an array — we don't use that path. Use the
      // raw rewriteFormula endpoint which already returns structured JSON.
      void res;
    } catch {
      /* ignore; fall through to rewriteFormula path */
    }

    // Use rewriteFormula as a JSON-returning interface (it already outputs
    // { rewritten, confidence, unchanged, notes? } so we repurpose fields).
    const out = await this.ai.rewriteFormula([], {
      formula: JSON.stringify({
        task: "fixPayload",
        kind: input.kind,
        status: input.status,
        errorBody: input.errorBody.slice(0, 800),
        sentPayload: input.sentPayload,
        targetSample: input.targetSample,
        sourceSample: input.sourceSample,
        priorAttempts: input.priorAttempts ?? [],
      }),
      keyMap: [],
      grammar: "js",
    });
    // `rewritten` should be a JSON string of { payload, reason, altPath? }.
    try {
      const parsed = JSON.parse(out.rewritten || "{}") as {
        payload?: unknown;
        reason?: string;
        altPath?: string;
      };
      if (parsed.payload === undefined || parsed.payload === null) {
        return { ok: false, payload: null, reason: parsed.reason ?? out.notes ?? "no fix" };
      }
      return {
        ok: true,
        payload: parsed.payload,
        reason: parsed.reason ?? "AI-proposed repair",
        ...(parsed.altPath ? { altPath: parsed.altPath } : {}),
      };
    } catch {
      return { ok: false, payload: null, reason: out.notes ?? "AI output not parseable" };
    }
  }

  async discoverEndpoint(input: EndpointDiscoverInput): Promise<EndpointDiscoverOutput> {
    const out = await this.ai.rewriteFormula([], {
      formula: JSON.stringify({
        task: "discoverEndpoint",
        kind: input.kind,
        triedPaths: input.triedPaths,
        latestStatus: input.latestStatus,
        latestPreview: input.latestPreview.slice(0, 400),
        hint:
          "PPlus endpoints are typically under /service/api/... but some (users/groups) are under /service/api/identity/... and some use lowercase. Return up to 5 candidate relative paths in priority order.",
      }),
      keyMap: [],
      grammar: "js",
    });
    try {
      const parsed = JSON.parse(out.rewritten || "{}") as { paths?: string[]; reason?: string };
      return {
        ok: Array.isArray(parsed.paths) && parsed.paths.length > 0,
        paths: parsed.paths ?? [],
        reason: parsed.reason ?? "",
      };
    } catch {
      return { ok: false, paths: [], reason: "AI output not parseable" };
    }
  }
}
