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
  // ── Response format ──
  "PPlus wraps responses as {status, code, data: [...], message, errors}. Single items: {data:{...}}.",
  // ── Base paths ──
  "Base path is /service/api/... (or /Service/api/... — case varies by deployment). Users/Groups under /service/api/identity/...",
  "Chart and Dashboard endpoints need header 'csr: <token>'.",
  // ── CRUD paths ──
  "Create: POST /service/api/Logs, POST /service/api/Lookups, POST /service/api/SchemaLevels.",
  "Update: PUT /service/api/Logs/{id}, PUT /service/api/Lookups/{id}. ID must be in body AND URL.",
  "Created entities must NOT carry id/_id/createdAt/updatedAt/createdBy/updatedBy (server assigns).",
  // ── CRITICAL: Bilingual/localized fields ──
  "ALL user-visible string fields MUST be localized {ar: string, en: string} objects, NOT plain strings.",
  "This applies to: displayName, name, Name, description — on lookups, properties, statuses, phase gates, sections, and their nested items.",
  "FluentValidation rules dereference displayName.ar — a plain string causes NullReferenceException.",
  "Example: displayName must be {\"ar\": \"حالة\", \"en\": \"Status\"}, not just \"Status\".",
  "If the source payload has displayName as a string, convert it: {\"ar\": originalString, \"en\": originalString}.",
  "Nested items (e.g. lookup items) also need name as {ar, en} objects.",
  // ── Model binding ──
  "If the server returns 'Invalid request payload format' (ModelBinderExtensions.GetSanitizedModelAsync), try stripping ALL id fields including from nested items.",
  "Do NOT wrap the body in {data:{...}} or {lookup:{...}} envelopes — PPlus expects flat root objects.",
  "For updates: keep the id in the root object matching the URL param; strip ids from nested items.",
  // ── System records ──
  "type=1 logs are built-in (read-only). type=2 is custom. canBeDeleted=false means protected.",
  "Arabic 'غير مسموح التعديل' = edit not allowed, 'غير مسموح الحذف' = delete not allowed — server policy, never retry.",
  // ── PPlus typos (MUST preserve) ──
  "PPlus has intentional typos that MUST be preserved exactly: 'configration' (not configuration), 'fuctionName' (not functionName), 'isRequird' (not isRequired).",
  // ── Dashboard specifics ──
  "Save dashboard configs via POST /service/api/Dashboards/Charts/Link with {DashboardId: STRING, configration: JSON_STRING}.",
  "DO NOT include DashboardId in POST /service/api/Dashboards/Chart body — causes WAF 403.",
  "DO NOT include propertyData or operationLevel in filter objects — causes 403.",
  // ── Authentication ──
  "Login: POST /Service/api/users/authenticate with {UserName, Password}. Returns {data:{token, user}}.",
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
