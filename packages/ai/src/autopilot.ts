import { AiClient } from "./client";

/**
 * Autopilot AI helpers — Claude as an active participant at every failure.
 * All methods return structured output and are safe to call in a loop; they
 * never throw on bad AI output, returning an `ok: false` + reason instead.
 */

/**
 * Real PPlus API conventions captured from knowledge-base chunks
 * admin-overview, admin-remaining-tabs, api-dashboards. Pasted into the
 * fixPayload prompt so Claude has concrete knowledge instead of guessing.
 */
const PPLUS_CONVENTIONS = [
  "PPlus wraps list responses as {status, code, data: [...]} (or nested {data:{data:{...}}} for single items).",
  "Base path is /service/api/... for most endpoints. Some (users, groups) live under /service/api/identity/... Chart and Dashboard endpoints need a 'csr' header.",
  "Create paths: POST /service/api/Logs, POST /service/api/Lookups, POST /service/api/Levels/{parentId}/children (levels are tree-scoped, not flat).",
  "Update paths: PUT /service/api/Logs/{id}, PUT /service/api/Lookups/{id}.",
  "Custom logs differ from built-in by type: type=1 is built-in (read-only on most instances), type=2 is custom (user-creatable).",
  "payload.canBeDeleted=false means the server refuses delete. payload.id=<1000 on lookups usually means seeded/system.",
  "Arabic error 'غير مسموح الحذف' (not allowed to delete) is a server-side policy — never repair by retrying delete.",
  "Some endpoints demand both name (string) AND descriptionObject ({ar,en}). Missing either yields 500 with a generic 'Internal Server Error'.",
  "POST to /service/api/Logs might expect the body under {log: {...}} or {data: {...}} wrapper on some instances — try both shapes if raw POST 500s.",
  "Created entities must NOT carry id/_id/createdAt/updatedAt/createdBy/updatedBy (server assigns). Updates usually need id in the body AND in the URL.",
].join("\n  - ");

export interface PayloadFixInput {
  /** Entity kind being written. */
  kind: string;
  /** HTTP status returned by the target. */
  status: number;
  /** Raw response body from the target (truncated). */
  errorBody: string;
  /** The payload we sent that was rejected. */
  sentPayload: unknown;
  /**
   * One or more successful entities of the same kind from the target.
   * Pass an array to give Claude multiple reference shapes.
   */
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
      `You are repairing a failed PPlus API write. Known PPlus conventions:\n  - ${PPLUS_CONVENTIONS}`,
      `A ${input.status >= 400 && input.status < 500 ? "client" : "server"} error occurred on kind="${input.kind}" with HTTP ${input.status}.`,
      `Sent payload:\n${JSON.stringify(input.sentPayload, null, 2)}`,
      `Server error body (truncated):\n${input.errorBody.slice(0, 1000)}`,
      input.targetSample
        ? `Successful existing ${input.kind}(s) on the target${
            Array.isArray(input.targetSample) ? ` (${(input.targetSample as unknown[]).length} samples)` : ""
          }:\n${JSON.stringify(input.targetSample, null, 2)}`
        : `No target sample was available — infer shape from PPlus conventions above.`,
      input.sourceSample
        ? `The original ${input.kind} from source was:\n${JSON.stringify(input.sourceSample, null, 2)}`
        : "",
      input.priorAttempts?.length
        ? `Previous fix attempts that also failed:\n- ${input.priorAttempts.join("\n- ")}\nDo not repeat these.`
        : "",
      ``,
      `Task: return a JSON object { payload, reason, altPath? } where`,
      ` - payload is the corrected object the tool will retry against the same endpoint (or altPath),`,
      ` - reason is ONE sentence describing the single most significant change you made,`,
      ` - altPath (optional) is a different relative URL like "/service/api/Logs/custom" or`,
      `   "/service/api/logs" (lowercase) when you suspect the path itself is wrong.`,
      `Strategies to consider in order:`,
      `  1. Add any field the error body demands (e.g. "required field X missing").`,
      `  2. If target sample has a field the sent payload lacks, add it using the target's value as a template.`,
      `  3. If the error mentions "configuration" / "properties" / "schema", attach a minimal such object.`,
      `  4. If the HTTP code is 405 or path looks wrong, propose altPath (creates usually POST to a sub-route like /parent/children).`,
      `  5. If the error starts with NETWORK (ENOTFOUND / ECONNREFUSED / ETIMEDOUT / EPIPE / certificate-problem):`,
      `     - Propose an altPath on the same host with a different prefix (/api/... vs /service/api/..., lowercase variants).`,
      `     - If the error is ENOTFOUND or the hostname looks odd, keep payload the same but suggest the operator verify the URL; return payload unchanged + reason noting DNS/URL issue.`,
      `  6. The operator demands NO failed operations — keep proposing structurally different payloads/paths across attempts. Prefer changing shape over giving up.`,
      `  7. Only set payload to null if you truly cannot see any next avenue.`,
      `Rules:`,
      `  - Never hallucinate field values. Copy from target/source samples, or leave the field out.`,
      `  - Never re-include server-assigned fields (id, _id, Id, createdAt, updatedAt, createdBy, updatedBy).`,
      `  - Reply with EXACTLY one fenced JSON block.`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const parsed = await this.ai.runJson<{
      payload?: unknown;
      reason?: string;
      altPath?: string;
    }>(prompt);
    if (!parsed) return { ok: false, payload: null, reason: "AI output not parseable" };
    if (parsed.payload === undefined || parsed.payload === null) {
      return { ok: false, payload: null, reason: parsed.reason ?? "no safe fix" };
    }
    return {
      ok: true,
      payload: parsed.payload,
      reason: parsed.reason ?? "AI-proposed repair",
      ...(parsed.altPath ? { altPath: parsed.altPath } : {}),
    };
  }

  async discoverEndpoint(input: EndpointDiscoverInput): Promise<EndpointDiscoverOutput> {
    const prompt = [
      `Find the right REST endpoint for kind="${input.kind}" on a PPlus instance.`,
      `Already tried (and failed): ${input.triedPaths.join(", ")}`,
      `Latest status: ${input.latestStatus}. Latest body preview: ${input.latestPreview.slice(0, 400)}`,
      `PPlus conventions:\n  - ${PPLUS_CONVENTIONS}`,
      `Return a JSON object { paths: string[], reason: string } with up to 5 relative paths in priority order.`,
    ].join("\n\n");
    const parsed = await this.ai.runJson<{ paths?: string[]; reason?: string }>(prompt);
    if (!parsed || !Array.isArray(parsed.paths)) {
      return { ok: false, paths: [], reason: parsed?.reason ?? "AI output not parseable" };
    }
    return { ok: parsed.paths.length > 0, paths: parsed.paths, reason: parsed.reason ?? "" };
  }
}
