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
    list: "/service/api/level",
    byId: (id) => `/service/api/level/${id}`,
    create: "/service/api/level",
    update: (id) => `/service/api/level/${id}`,
    delete: (id) => `/service/api/level/${id}`,
  },
  log: {
    list: "/service/api/log",
    byId: (id) => `/service/api/log/${id}`,
    create: "/service/api/log",
    update: (id) => `/service/api/log/${id}`,
    delete: (id) => `/service/api/log/${id}`,
  },
  property: {
    list: "/service/api/property",
    byId: (id) => `/service/api/property/${id}`,
    create: "/service/api/property",
    update: (id) => `/service/api/property/${id}`,
    delete: (id) => `/service/api/property/${id}`,
  },
  propertyStatus: {
    list: "/service/api/property-status",
    byId: (id) => `/service/api/property-status/${id}`,
    create: "/service/api/property-status",
    update: (id) => `/service/api/property-status/${id}`,
    delete: (id) => `/service/api/property-status/${id}`,
  },
  phaseGate: {
    list: "/service/api/phase-gate",
    byId: (id) => `/service/api/phase-gate/${id}`,
    create: "/service/api/phase-gate",
    update: (id) => `/service/api/phase-gate/${id}`,
    delete: (id) => `/service/api/phase-gate/${id}`,
  },
  lookup: {
    list: "/service/api/lookup",
    byId: (id) => `/service/api/lookup/${id}`,
    create: "/service/api/lookup",
    update: (id) => `/service/api/lookup/${id}`,
    delete: (id) => `/service/api/lookup/${id}`,
  },
  workflow: {
    list: "/service/api/workflow",
    byId: (id) => `/service/api/workflow/${id}`,
    create: "/service/api/workflow",
    update: (id) => `/service/api/workflow/${id}`,
    delete: (id) => `/service/api/workflow/${id}`,
  },
  dashboard: {
    list: "/service/api/dashboard",
    byId: (id) => `/service/api/dashboard/${id}`,
    create: "/service/api/dashboard",
    update: (id) => `/service/api/dashboard/${id}`,
    delete: (id) => `/service/api/dashboard/${id}`,
    headers: { csr: "1" },
  },
  chartComponent: {
    list: "/service/api/component/chart",
    byId: (id) => `/service/api/component/chart/${id}`,
    create: "/service/api/component/chart",
    update: (id) => `/service/api/component/chart/${id}`,
    delete: (id) => `/service/api/component/chart/${id}`,
    headers: { csr: "1" },
  },
  source: {
    list: "/service/api/source",
    byId: (id) => `/service/api/source/${id}`,
    create: "/service/api/source",
    update: (id) => `/service/api/source/${id}`,
    delete: (id) => `/service/api/source/${id}`,
  },
};

export const NOTIFY_SYNC = "/service/api/configuration/sync-notification";
