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
        this.http.get(path, { headers: extra }).json<RawEntity[] | { items?: RawEntity[] }>(),
      );
      const list = Array.isArray(raw) ? raw : (raw?.items ?? []);
      for (const item of list) yield coerce(item, kind);
    }
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

  async applyChange(op: DiffOp): Promise<ApplyResult> {
    const endpoint = ENDPOINTS[op.kind];
    const extra = endpoint.headers ?? {};
    try {
      if (op.op === "create") {
        const path = endpoint.create.replace(/^\//, "");
        const body = await this.queue.add(() =>
          this.http.post(path, { headers: extra, json: op.after }).json<RawEntity>(),
        );
        return { ok: true, newId: String(body?.id ?? body?._id ?? "") };
      }
      if (op.op === "update" || op.op === "rewriteRef") {
        if (!op.targetId) return { ok: false, error: "update missing targetId" };
        const path = endpoint.update(op.targetId).replace(/^\//, "");
        await this.queue.add(() => this.http.put(path, { headers: extra, json: op.after }));
        return { ok: true };
      }
      if (op.op === "delete") {
        if (!op.targetId) return { ok: false, error: "delete missing targetId" };
        const path = endpoint.delete(op.targetId).replace(/^\//, "");
        await this.queue.add(() => this.http.delete(path, { headers: extra }));
        return { ok: true };
      }
      return { ok: false, error: `unsupported op ${op.op}` };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
