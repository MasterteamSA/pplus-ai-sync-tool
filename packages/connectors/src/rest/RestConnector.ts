import ky, { type KyInstance } from "ky";
import PQueue from "p-queue";
import { createHash } from "node:crypto";

import type { DiffOp, Entity, EntityKind } from "@pplus-sync/core";

import type { ApplyResult, ConnectorConfig, PPlusConnector } from "../interface";
import { ENDPOINTS, NOTIFY_SYNC } from "./endpoints";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildAuthHeaders(cfg: ConnectorConfig): Record<string, string> {
  const headers: Record<string, string> = {
    // Send a permissive Accept: some PPlus deployments 406 on strict application/json.
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    ...cfg.auth.extraHeaders,
  };
  if (cfg.auth.mode === "cookie" && cfg.auth.cookie) {
    headers.Cookie = cfg.auth.cookie;
  }
  if (cfg.auth.mode === "bearer" && cfg.auth.bearer) {
    headers.Authorization = `Bearer ${cfg.auth.bearer}`;
  }
  if (cfg.auth.mode === "basic" && cfg.auth.basic) {
    const token = Buffer.from(`${cfg.auth.basic.user}:${cfg.auth.basic.pass}`).toString("base64");
    headers.Authorization = `Basic ${token}`;
  }
  return headers;
}

function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/$/, "");
  }
}

/**
 * Paths worth probing for connection tests. Different PPlus instances expose
 * different shapes — some have /api/user/current, some /api/me, some only
 * return content under product-specific paths like /Home/Cards. We accept any
 * 2xx on at least one probe; a 401/403 also counts as "reachable" since it
 * proves the host is real and answering (just rejecting this auth).
 */
const CONNECTION_PROBES = [
  // Real PPlus layout — base path is /service/api/, not /api/.
  // Identity + currentUser endpoints come first because they verify auth.
  "service/api/identity/users/current",
  "service/api/users/current",
  "service/api/Dashboards",
  "service/api/identity/Groups",
  // Fallbacks for older / non-standard installs.
  "api/user/current",
  "api/users/current",
  "api/me",
  "api/account/me",
];

interface RawEntity {
  id?: string | number;
  _id?: string;
  key?: string;
  Key?: string;
  name?: string;
  Name?: string | { en?: string; ar?: string };
  displayName?: string;
  parentId?: string | number;
  [k: string]: unknown;
}

/**
 * PPlus wraps list responses in {Status, Code, Data, Message, Errors}. Older
 * .NET endpoints use lowercase {data}. Some return a bare array. Handle all.
 */
function unwrapList(raw: unknown): RawEntity[] {
  if (Array.isArray(raw)) return raw as RawEntity[];
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    // Arrays nested one level in (PPlusResponse: {Data: [...]}).
    for (const key of ["Data", "data", "items", "Items", "result", "Result"]) {
      const v = o[key];
      if (Array.isArray(v)) return v as RawEntity[];
      if (v && typeof v === "object") {
        const vo = v as Record<string, unknown>;
        for (const kk of ["items", "Items", "data", "Data"]) {
          const vv = vo[kk];
          if (Array.isArray(vv)) return vv as RawEntity[];
        }
      }
    }
    // Single-entity response wrapped as {Data: {id, ...}} or {data: {data: {id, ...}}}.
    const single = (o as { Data?: unknown; data?: unknown }).Data ?? (o as { data?: unknown }).data ?? o;
    if (single && typeof single === "object") {
      const inner = (single as { data?: unknown }).data;
      const candidate = inner && typeof inner === "object" && !Array.isArray(inner) ? inner : single;
      if (
        candidate &&
        typeof candidate === "object" &&
        ("id" in (candidate as object) || "_id" in (candidate as object) || "Id" in (candidate as object))
      ) {
        return [candidate as RawEntity];
      }
    }
  }
  return [];
}

function coerce(raw: RawEntity, kind: EntityKind): Entity {
  const id = String(raw.id ?? raw._id ?? "");
  const nameRaw = raw.Name ?? raw.name ?? raw.displayName ?? "";
  const name =
    typeof nameRaw === "string" ? nameRaw : (nameRaw?.en ?? nameRaw?.ar ?? "");
  const key = (raw.key ?? raw.Key) as string | undefined;
  const parentId = raw.parentId != null ? String(raw.parentId) : undefined;
  return {
    kind,
    id,
    ...(key !== undefined ? { key } : {}),
    name: String(name),
    ...(parentId !== undefined ? { parentId } : {}),
    payload: raw,
    hash: stableHash(raw),
  };
}

export class RestConnector implements PPlusConnector {
  readonly label: string;
  readonly baseUrl: string;
  private readonly http: KyInstance;
  private readonly queue: PQueue;

  constructor(private readonly cfg: ConnectorConfig) {
    this.label = cfg.label;
    // Normalize to origin — callers paste URLs like
    // `https://instance.example/Home/Cards` which would otherwise get
    // concatenated onto every request path.
    this.baseUrl = originOf(cfg.baseUrl);
    this.queue = new PQueue({ concurrency: cfg.concurrency ?? 4 });
    this.http = ky.create({
      prefixUrl: this.baseUrl,
      timeout: 30_000,
      retry: { limit: 3, methods: ["get"], statusCodes: [408, 429, 500, 502, 503, 504] },
      headers: buildAuthHeaders(cfg),
      hooks: {
        beforeError: [
          (err) => {
            err.message = `[${cfg.label}] ${err.message}`;
            return err;
          },
        ],
      },
    });
  }

  async testConnection(): Promise<{ ok: boolean; user?: string; probed?: string; status?: number; error?: string }> {
    let lastReachable: { status: number; probed: string } | null = null;
    for (const path of CONNECTION_PROBES) {
      try {
        const res = await this.http.get(path, { throwHttpErrors: false, retry: 0 });
        // 2xx = verified with this auth. 401/403 = host reachable but auth rejected.
        if (res.ok) {
          const ct = res.headers.get("content-type") ?? "";
          // A 200 that returns HTML is almost always a login redirect page.
          // Treat that as reachable-but-unverified so we don't falsely succeed.
          if (ct.includes("text/html")) {
            lastReachable = { status: res.status, probed: path || "/" };
            continue;
          }
          const body = (await res.json().catch(() => null)) as
            | { username?: string; userName?: string; email?: string; name?: string }
            | null;
          const user = body?.username ?? body?.userName ?? body?.email ?? body?.name;
          return user
            ? { ok: true, user, probed: path || "/", status: res.status }
            : { ok: true, probed: path || "/", status: res.status };
        }
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            probed: path || "/",
            status: res.status,
            error: `HTTP ${res.status} — host reached, credentials were rejected`,
          };
        }
        lastReachable = { status: res.status, probed: path || "/" };
      } catch (e) {
        // network / DNS — try next path; if they all fail we'll report below.
        void e;
      }
    }
    if (lastReachable) {
      return {
        ok: false,
        probed: lastReachable.probed,
        status: lastReachable.status,
        error: `HTTP ${lastReachable.status} — host answered but none of the probe endpoints exist on this instance. Use "Test connection" only as a heuristic; the real connector probes run at snapshot time.`,
      };
    }
    return { ok: false, error: `host ${this.baseUrl} unreachable or blocked` };
  }

  async *snapshot(kinds: EntityKind[]): AsyncIterable<Entity> {
    for (const kind of kinds) {
      const endpoint = ENDPOINTS[kind];
      const path = endpoint.list.replace(/^\//, "");
      const extra = endpoint.headers ?? {};
      const raw = await this.queue.add(() =>
        this.http.get(path, { headers: extra, throwHttpErrors: false }).json<unknown>(),
      );
      const list = unwrapList(raw);
      for (const item of list) yield coerce(item, kind);
    }
  }

  /** Diagnostic probe — returns the raw status/content-type/preview for the
   *  list endpoint of a given kind. Used by /api/capture to explain why a
   *  bucket came back empty. */
  async diagnoseList(kind: EntityKind): Promise<{ status: number; ct: string; preview: string; path: string }> {
    const endpoint = ENDPOINTS[kind];
    const path = endpoint.list.replace(/^\//, "");
    const extra = endpoint.headers ?? {};
    const res = await this.http.get(path, { headers: extra, throwHttpErrors: false });
    const ct = res.headers.get("content-type") ?? "";
    let preview = "";
    try {
      preview = (await res.text()).slice(0, 400);
    } catch {
      /* ignore */
    }
    return { status: res.status, ct, preview, path };
  }

  async fetchEntity(kind: EntityKind, id: string): Promise<Entity | null> {
    const endpoint = ENDPOINTS[kind];
    const path = endpoint.byId(id).replace(/^\//, "");
    const extra = endpoint.headers ?? {};
    const res = await this.queue.add(() =>
      this.http.get(path, { headers: extra, throwHttpErrors: false }),
    );
    if (!res) return null;
    if (!res.ok) return null;
    const raw = await res.json<RawEntity>();
    return coerce(raw, kind);
  }

  /**
   * Try a request, then retry once with a sibling path prefix if the server
   * responds 404/405. PPlus instances route both /service/api/... and
   * /api/... depending on deployment, so we try the alternate before
   * giving up.
   */
  private async withPathFallback<T>(
    path: string,
    headers: Record<string, string>,
    json: unknown,
    method: "post" | "put" | "delete",
  ): Promise<{ ok: boolean; status: number; body: T | null; pathUsed: string; error?: string }> {
    const tryOne = async (p: string) => {
      const cleaned = p.replace(/^\//, "");
      const init: Record<string, unknown> = { headers, throwHttpErrors: false };
      if (method !== "delete" && json !== undefined) init.json = json;
      const res = await this.queue.add(() =>
        method === "post"
          ? this.http.post(cleaned, init)
          : method === "put"
          ? this.http.put(cleaned, init)
          : this.http.delete(cleaned, init),
      );
      // Read the body text once; try JSON parse. This guarantees we always
      // have bytes to put in an error message even when the response is
      // empty or non-JSON.
      const raw = await res!.text().catch(() => "");
      let body: T | null = null;
      try {
        body = raw ? (JSON.parse(raw) as T) : null;
      } catch {
        body = null;
      }
      return { res: res!, body, errText: raw };
    };

    const { res, body, errText } = await tryOne(path);
    if (res.ok) return { ok: true, status: res.status, body, pathUsed: path };

    if (res.status === 404 || res.status === 405) {
      const alt = path.startsWith("/service/api/")
        ? path.replace(/^\/service\/api\//, "/api/")
        : path.startsWith("/api/")
        ? path.replace(/^\/api\//, "/service/api/")
        : null;
      if (alt) {
        const retry = await tryOne(alt);
        if (retry.res.ok) return { ok: true, status: retry.res.status, body: retry.body, pathUsed: alt };
        return {
          ok: false,
          status: retry.res.status,
          body: retry.body,
          pathUsed: alt,
          error: `HTTP ${retry.res.status} ${retry.errText.slice(0, 400)}`.trim(),
        };
      }
    }
    return {
      ok: false,
      status: res.status,
      body,
      pathUsed: path,
      error: `HTTP ${res.status} ${errText.slice(0, 400)}`.trim(),
    };
  }

  async applyChange(op: DiffOp): Promise<ApplyResult> {
    const endpoint = ENDPOINTS[op.kind];
    const extra = endpoint.headers ?? {};
    if (op.op === "create") {
      const r = await this.withPathFallback<RawEntity>(endpoint.create, extra, op.after, "post");
      if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
      return {
        ok: true,
        newId: String((r.body?.id as string | number | undefined) ?? r.body?._id ?? ""),
      };
    }
    if (op.op === "update" || op.op === "rewriteRef") {
      if (!op.targetId) return { ok: false, error: "update missing targetId" };
      const r = await this.withPathFallback<RawEntity>(endpoint.update(op.targetId), extra, op.after, "put");
      if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
      return { ok: true };
    }
    if (op.op === "delete") {
      if (!op.targetId) return { ok: false, error: "delete missing targetId" };
      const r = await this.withPathFallback<RawEntity>(endpoint.delete(op.targetId), extra, undefined, "delete");
      if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
      return { ok: true };
    }
    return { ok: false, error: `unsupported op ${op.op}` };
  }

  async notifySync(payload: {
    updatedProperties: string[];
    addedProperties: string[];
    addedItems: string[];
  }): Promise<void> {
    try {
      await this.http.post(NOTIFY_SYNC.replace(/^\//, ""), {
        json: { ...payload, timestamp: new Date().toISOString() },
      });
    } catch {
      // best-effort; existing tool logs-and-continues per ConfigurationSyncService.cs:649
    }
  }
}
