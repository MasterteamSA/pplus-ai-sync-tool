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
  /**
   * True for entity kinds that are scoped to a parent Level. The connector
   * will snapshot Levels first, then iterate calling list / byId with each
   * level id substituted into {levelId}.
   */
  perLevel?: boolean;
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
  // Per-level admin sections. Paths are the best educated guess based on the
  // admin UI routes (/admin/level-managment/{id}/...); the connector lets the
  // operator override any path in settings if a given instance differs.
  processBuilder: {
    list: "/service/api/level/{levelId}/processes",
    byId: (id) => `/service/api/processes/${id}`,
    create: "/service/api/level/{levelId}/processes",
    update: (id) => `/service/api/processes/${id}`,
    delete: (id) => `/service/api/processes/${id}`,
    perLevel: true,
  },
  approvalProcess: {
    list: "/service/api/level/{levelId}/approvals",
    byId: (id) => `/service/api/approvals/${id}`,
    create: "/service/api/level/{levelId}/approvals",
    update: (id) => `/service/api/approvals/${id}`,
    delete: (id) => `/service/api/approvals/${id}`,
    perLevel: true,
  },
  role: {
    list: "/service/api/level/{levelId}/roles",
    byId: (id) => `/service/api/roles/${id}`,
    create: "/service/api/level/{levelId}/roles",
    update: (id) => `/service/api/roles/${id}`,
    delete: (id) => `/service/api/roles/${id}`,
    perLevel: true,
  },
  escalation: {
    list: "/service/api/level/{levelId}/escalations",
    byId: (id) => `/service/api/escalations/${id}`,
    create: "/service/api/level/{levelId}/escalations",
    update: (id) => `/service/api/escalations/${id}`,
    delete: (id) => `/service/api/escalations/${id}`,
    perLevel: true,
  },
  procurement: {
    list: "/service/api/level/{levelId}/procurement",
    byId: (id) => `/service/api/procurement/${id}`,
    create: "/service/api/level/{levelId}/procurement",
    update: (id) => `/service/api/procurement/${id}`,
    delete: (id) => `/service/api/procurement/${id}`,
    perLevel: true,
  },
  cardConfig: {
    list: "/service/api/level/{levelId}/cards",
    byId: (id) => `/service/api/cards/${id}`,
    create: "/service/api/level/{levelId}/cards",
    update: (id) => `/service/api/cards/${id}`,
    delete: (id) => `/service/api/cards/${id}`,
    perLevel: true,
  },
  levelStatus: {
    list: "/service/api/level/{levelId}/statuses",
    byId: (id) => `/service/api/statuses/${id}`,
    create: "/service/api/level/{levelId}/statuses",
    update: (id) => `/service/api/statuses/${id}`,
    delete: (id) => `/service/api/statuses/${id}`,
    perLevel: true,
  },
};

export const NOTIFY_SYNC = "/service/api/configuration/sync-notification";
