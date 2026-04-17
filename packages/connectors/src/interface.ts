import type { DiffOp, Entity, EntityKind } from "@pplus-sync/core";

export interface AuthConfig {
  mode: "cookie" | "bearer" | "basic";
  /** Raw cookie string (`name=value; name2=value2`) for cookie mode. */
  cookie?: string;
  bearer?: string;
  basic?: { user: string; pass: string };
  /** Extra headers PPlus requires, e.g. `csr` for chart endpoints. */
  extraHeaders?: Record<string, string>;
}

export interface ConnectorConfig {
  label: string;
  baseUrl: string;
  auth: AuthConfig;
  concurrency?: number;
}

export interface ApplyResult {
  ok: boolean;
  newId?: string;
  error?: string;
}

export interface ApplyOptions {
  /**
   * Override the endpoint path used for this apply. Useful when Claude has
   * proposed an alternate route (e.g. /service/api/logs/custom) after an
   * initial attempt at the default endpoint failed.
   */
  overridePath?: string;
}

export interface PPlusConnector {
  readonly label: string;
  readonly baseUrl: string;

  /** Smoke check — GET `/me` (or equivalent) to validate auth. */
  testConnection(): Promise<{ ok: boolean; user?: string; error?: string }>;

  /** Streams entities of the requested kinds; order within a kind is stable. */
  snapshot(kinds: EntityKind[]): AsyncIterable<Entity>;

  fetchEntity(kind: EntityKind, id: string): Promise<Entity | null>;

  applyChange(op: DiffOp, options?: ApplyOptions): Promise<ApplyResult>;

  /**
   * Existing PPlus notification — POST /api/configuration/sync-notification.
   * Leave no-op on failure (warning only).
   */
  notifySync(payload: { updatedProperties: string[]; addedProperties: string[]; addedItems: string[] }): Promise<void>;
}
