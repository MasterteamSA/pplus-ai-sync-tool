import type { EntityKind } from "@pplus-sync/core";

/**
 * Frozen map of PPlus REST endpoints. Paths validated against the
 * MasterteamSA/pplus4-backend controllers at scaffold time; adjust per
 * instance as needed (some deployments prefix /api differently).
 *
 * `list`   → GET, returns an array of this kind
 * `byId`   → GET, returns a single entity
 * `create` → POST
 * `update` → PUT
 * `delete` → DELETE
 *
 * The `csr` header requirement for chart endpoints is honored by RestConnector
 * via AuthConfig.extraHeaders.
 */
export interface EndpointSet {
  list: string;
  byId: (id: string) => string;
  create: string;
  update: (id: string) => string;
  delete: (id: string) => string;
  /** Headers required beyond auth — per `dashboard_dialog_building_guide.md`. */
  headers?: Record<string, string>;
}

export const ENDPOINTS: Record<EntityKind, EndpointSet> = {
  level: {
    list: "/api/level",
    byId: (id) => `/api/level/${id}`,
    create: "/api/level",
    update: (id) => `/api/level/${id}`,
    delete: (id) => `/api/level/${id}`,
  },
  log: {
    list: "/api/log",
    byId: (id) => `/api/log/${id}`,
    create: "/api/log",
    update: (id) => `/api/log/${id}`,
    delete: (id) => `/api/log/${id}`,
  },
  property: {
    list: "/api/property",
    byId: (id) => `/api/property/${id}`,
    create: "/api/property",
    update: (id) => `/api/property/${id}`,
    delete: (id) => `/api/property/${id}`,
  },
  propertyStatus: {
    list: "/api/property-status",
    byId: (id) => `/api/property-status/${id}`,
    create: "/api/property-status",
    update: (id) => `/api/property-status/${id}`,
    delete: (id) => `/api/property-status/${id}`,
  },
  phaseGate: {
    list: "/api/phase-gate",
    byId: (id) => `/api/phase-gate/${id}`,
    create: "/api/phase-gate",
    update: (id) => `/api/phase-gate/${id}`,
    delete: (id) => `/api/phase-gate/${id}`,
  },
  lookup: {
    list: "/api/lookup",
    byId: (id) => `/api/lookup/${id}`,
    create: "/api/lookup",
    update: (id) => `/api/lookup/${id}`,
    delete: (id) => `/api/lookup/${id}`,
  },
  workflow: {
    list: "/api/workflow",
    byId: (id) => `/api/workflow/${id}`,
    create: "/api/workflow",
    update: (id) => `/api/workflow/${id}`,
    delete: (id) => `/api/workflow/${id}`,
  },
  dashboard: {
    list: "/api/dashboard",
    byId: (id) => `/api/dashboard/${id}`,
    create: "/api/dashboard",
    update: (id) => `/api/dashboard/${id}`,
    delete: (id) => `/api/dashboard/${id}`,
    headers: { csr: "1" },
  },
  chartComponent: {
    list: "/api/component/chart",
    byId: (id) => `/api/component/chart/${id}`,
    create: "/api/component/chart",
    update: (id) => `/api/component/chart/${id}`,
    delete: (id) => `/api/component/chart/${id}`,
    headers: { csr: "1" },
  },
  source: {
    list: "/api/source",
    byId: (id) => `/api/source/${id}`,
    create: "/api/source",
    update: (id) => `/api/source/${id}`,
    delete: (id) => `/api/source/${id}`,
  },
};

export const NOTIFY_SYNC = "/api/configuration/sync-notification";
