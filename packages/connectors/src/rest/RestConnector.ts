import ky, { type KyInstance } from "ky";
import PQueue from "p-queue";
import { createHash } from "node:crypto";

import type { DiffOp, Entity, EntityKind } from "@pplus-sync/core";

import type { ApplyResult, ConnectorConfig, PPlusConnector } from "../interface.js";
import { ENDPOINTS, NOTIFY_SYNC } from "./endpoints.js";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function buildAuthHeaders(cfg: ConnectorConfig): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json", ...cfg.auth.extraHeaders };
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
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
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

  async testConnection(): Promise<{ ok: boolean; user?: string; error?: string }> {
    try {
      const res = await this.http.get("api/me", { throwHttpErrors: false });
      if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
      const body = (await res.json().catch(() => null)) as { username?: string } | null;
      return body?.username ? { ok: true, user: body.username } : { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
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
