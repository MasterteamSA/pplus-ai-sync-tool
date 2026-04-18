import ky, { type KyInstance } from "ky";
import PQueue from "p-queue";
import { createHash } from "node:crypto";

import type { DiffOp, Entity, EntityKind } from "@pplus-sync/core";

import type { ApplyOptions, ApplyResult, ConnectorConfig, PPlusConnector } from "../interface";
import { ENDPOINTS, NOTIFY_SYNC } from "./endpoints";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildAuthHeaders(cfg: ConnectorConfig): Record<string, string> {
  const headers: Record<string, string> = {
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

const CONNECTION_PROBES = [
  "service/api/identity/users/current",
  "service/api/users/current",
  "service/api/Dashboards",
  "service/api/identity/Groups",
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
  DisplayName?: string | { en?: string; ar?: string };
  parentId?: string | number;
  levelId?: string | number;
  logId?: string | number;
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

function coerce(raw: RawEntity, kind: EntityKind, parentId?: string): Entity {
  const id = String(raw.id ?? raw._id ?? raw.Id ?? "");
  const nameRaw = raw.Name ?? raw.name ?? raw.DisplayName ?? raw.displayName ?? "";
  const name =
    typeof nameRaw === "string" ? nameRaw : (nameRaw?.en ?? nameRaw?.ar ?? "");
  const key = (raw.key ?? raw.Key) as string | undefined;
  // Use explicit parentId if provided (from iteration context), else from payload.
  const pid = parentId ?? (raw.parentId != null ? String(raw.parentId) : undefined);
  return {
    kind,
    id,
    ...(key !== undefined ? { key } : {}),
    name: String(name),
    ...(pid !== undefined ? { parentId: pid } : {}),
    payload: raw,
    hash: stableHash(raw),
  };
}

/**
 * Substitute path placeholders like {levelId}, {logId}, {schemaId} with actual values.
 */
function resolvePath(template: string, vars: Record<string, string>): string {
  let path = template;
  for (const [key, value] of Object.entries(vars)) {
    path = path.replace(`{${key}}`, value);
  }
  return path;
}

export class RestConnector implements PPlusConnector {
  readonly label: string;
  readonly baseUrl: string;
  private readonly http: KyInstance;
  private readonly queue: PQueue;

  constructor(private readonly cfg: ConnectorConfig) {
    this.label = cfg.label;
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
        if (res.ok) {
          const ct = res.headers.get("content-type") ?? "";
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
        void e;
      }
    }
    if (lastReachable) {
      return {
        ok: false,
        probed: lastReachable.probed,
        status: lastReachable.status,
        error: `HTTP ${lastReachable.status} — host answered but probe endpoints not found.`,
      };
    }
    return { ok: false, error: `host ${this.baseUrl} unreachable or blocked` };
  }

  /**
   * Fetch a flat list from a single endpoint path. Used internally.
   */
  private async fetchList(path: string, extraHeaders?: Record<string, string>): Promise<RawEntity[]> {
    const cleaned = path.replace(/^\//, "");
    const headers = extraHeaders ?? {};
    const raw = await this.queue.add(() =>
      this.http.get(cleaned, { headers, throwHttpErrors: false }).json<unknown>(),
    );
    return unwrapList(raw);
  }

  /**
   * Snapshot all entities of the requested kinds.
   *
   * For perLevel/perLog scoped kinds, the connector first fetches the list of
   * levels/logs and then iterates over each one, substituting the parent ID
   * into the endpoint path. This mirrors the backend's ComparisonService
   * approach of loading per-level and per-log children.
   */
  async *snapshot(kinds: EntityKind[]): AsyncIterable<Entity> {
    // Cache levels and logs on first need to avoid re-fetching.
    let levelsCache: RawEntity[] | null = null;
    let logsCache: RawEntity[] | null = null;

    const getLevels = async (): Promise<RawEntity[]> => {
      if (!levelsCache) {
        levelsCache = await this.fetchList(ENDPOINTS.level.list, ENDPOINTS.level.headers);
      }
      return levelsCache;
    };

    const getLogs = async (): Promise<RawEntity[]> => {
      if (!logsCache) {
        logsCache = await this.fetchList(ENDPOINTS.log.list, ENDPOINTS.log.headers);
      }
      return logsCache;
    };

    for (const kind of kinds) {
      const endpoint = ENDPOINTS[kind];
      const extra = endpoint.headers ?? {};

      if (endpoint.scope === "global") {
        // Simple: one call, list everything.
        const list = await this.fetchList(endpoint.list, extra);
        for (const item of list) yield coerce(item, kind);
      } else if (endpoint.scope === "perLevel") {
        // Iterate over each level and fetch child entities.
        const levels = await getLevels();
        for (const level of levels) {
          const levelId = String(level.id ?? level._id ?? level.Id ?? "");
          if (!levelId) continue;
          const path = resolvePath(endpoint.list, { levelId, schemaId: levelId });
          try {
            const list = await this.fetchList(path, extra);
            for (const item of list) {
              yield coerce(item, kind, levelId);
            }
          } catch {
            // Some levels may not support certain sub-endpoints; skip quietly.
          }
        }
      } else if (endpoint.scope === "perLog") {
        // Iterate over each log and fetch child entities.
        const logs = await getLogs();
        for (const log of logs) {
          const logId = String(log.id ?? log._id ?? log.Id ?? "");
          if (!logId) continue;
          const path = resolvePath(endpoint.list, { logId });
          try {
            const list = await this.fetchList(path, extra);
            for (const item of list) {
              yield coerce(item, kind, logId);
            }
          } catch {
            // Skip errors on individual logs.
          }
        }
      }
    }
  }

  async diagnoseList(kind: EntityKind): Promise<{ status: number; ct: string; preview: string; path: string }> {
    const endpoint = ENDPOINTS[kind];
    const path = endpoint.list.replace(/^\//, "");
    const extra = endpoint.headers ?? {};
    const res = await this.http.get(path, { headers: extra, throwHttpErrors: false });
    const ct = res.headers.get("content-type") ?? "";
    let preview = "";
    try {
      preview = (await res.text()).slice(0, 400);
    } catch { /* ignore */ }
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
   * Try a request, then retry with alternate path prefix if 404/405.
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
      try {
        const res = await this.queue.add(() =>
          method === "post"
            ? this.http.post(cleaned, init)
            : method === "put"
            ? this.http.put(cleaned, init)
            : this.http.delete(cleaned, init),
        );
        const raw = await res!.text().catch(() => "");
        let body: T | null = null;
        try {
          body = raw ? (JSON.parse(raw) as T) : null;
        } catch {
          body = null;
        }
        return { res: res!, body, errText: raw, networkError: null as Error | null };
      } catch (err) {
        const e = err as Error & { cause?: unknown };
        const cause = e.cause as { code?: string; message?: string } | undefined;
        const detail = cause?.code
          ? `${cause.code}${cause.message ? ": " + cause.message : ""}`
          : cause?.message ?? e.message;
        const url = `${this.baseUrl}/${cleaned}`;
        return {
          res: null as unknown as Response,
          body: null,
          errText: `NETWORK ${detail} @ ${method.toUpperCase()} ${url}`,
          networkError: e,
        };
      }
    };

    // Retry on network failures with exponential backoff.
    let first = await tryOne(path);
    if (first.networkError) {
      const delays = [500, 1500, 3500];
      for (const d of delays) {
        await new Promise((r) => setTimeout(r, d));
        first = await tryOne(path);
        if (!first.networkError) break;
      }
    }
    if (first.networkError) {
      return {
        ok: false,
        status: 0,
        body: null,
        pathUsed: path,
        error: `${first.errText} (target unreachable after 4 attempts)`,
      };
    }
    if (first.res.ok) return { ok: true, status: first.res.status, body: first.body, pathUsed: path };

    if (first.res.status === 404 || first.res.status === 405) {
      const alt = path.startsWith("/service/api/")
        ? path.replace(/^\/service\/api\//, "/api/")
        : path.startsWith("/api/")
        ? path.replace(/^\/api\//, "/service/api/")
        : null;
      if (alt) {
        const retry = await tryOne(alt);
        if (retry.networkError) {
          return { ok: false, status: 0, body: null, pathUsed: alt, error: retry.errText };
        }
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
      status: first.res.status,
      body: first.body,
      pathUsed: path,
      error: `HTTP ${first.res.status} ${first.errText.slice(0, 400)}`.trim(),
    };
  }

  /**
   * Apply a change operation to the target instance.
   *
   * For perLevel/perLog endpoints, the caller should have already resolved
   * the path with the correct parent ID. If the op has a parentId, we use
   * it to resolve {levelId}/{logId} in the endpoint template.
   */
  async applyChange(
    op: DiffOp & { parentId?: string },
    options: ApplyOptions = {},
  ): Promise<ApplyResult> {
    const endpoint = ENDPOINTS[op.kind];
    const extra = endpoint.headers ?? {};
    const override = options.overridePath;

    // Build path vars from op context for perLevel/perLog endpoints.
    const pathVars: Record<string, string> = {};
    if (op.parentId) {
      pathVars.levelId = op.parentId;
      pathVars.logId = op.parentId;
      pathVars.schemaId = op.parentId;
    }
    if (op.targetId) {
      pathVars.schemaId = pathVars.schemaId || op.targetId;
    }

    if (op.op === "create") {
      const rawPath = override ?? resolvePath(endpoint.create, pathVars);
      const r = await this.withPathFallback<RawEntity>(rawPath, extra, op.after, "post");
      if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
      return {
        ok: true,
        newId: String((r.body?.id as string | number | undefined) ?? r.body?._id ?? ""),
      };
    }
    if (op.op === "update" || op.op === "rewriteRef") {
      if (!op.targetId) return { ok: false, error: "update missing targetId" };
      const rawPath = override ?? resolvePath(endpoint.update(op.targetId), pathVars);
      const r = await this.withPathFallback<RawEntity>(rawPath, extra, op.after, "put");
      if (!r.ok) return { ok: false, error: r.error ?? `HTTP ${r.status}` };
      return { ok: true };
    }
    if (op.op === "delete") {
      if (!op.targetId) return { ok: false, error: "delete missing targetId" };
      const rawPath = override ?? resolvePath(endpoint.delete(op.targetId), pathVars);
      const r = await this.withPathFallback<RawEntity>(rawPath, extra, undefined, "delete");
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
      // best-effort
    }
  }
}
