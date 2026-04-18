import type { EntityKind } from "@pplus-sync/core";

/**
 * Real PPlus REST endpoints for every sync-able configuration surface.
 *
 * Scopes:
 *   - global:   one call per instance
 *   - perLevel: iterate over captured Levels; {levelId} is substituted
 *   - perLog:   iterate over captured Logs;   {logId}   is substituted
 *
 * Path variables:
 *   {levelId}  — substituted with the actual level ID
 *   {logId}    — substituted with the actual log ID
 *   {schemaId} — substituted with property/level ID for status endpoints
 */

export type Scope = "global" | "perLevel" | "perLog";

export interface EndpointSet {
  list: string;
  byId: (id: string) => string;
  create: string;
  update: (id: string) => string;
  delete: (id: string) => string;
  headers?: Record<string, string>;
  scope: Scope;
  perLevel?: boolean;
}

const L = "/service/api";

const level = (path: string): string => `${L}/Levels/{levelId}${path}`;
const log = (path: string): string => `${L}/Logs/{logId}${path}`;

export const ENDPOINTS: Record<EntityKind, EndpointSet> = {
  // ── Hierarchy & data model ────────────────────────────────────────────
  level: {
    list: `${L}/Levels`,
    byId: (id) => `${L}/Levels/${id}`,
    create: `${L}/Levels`,
    update: (id) => `${L}/Levels/${id}`,
    delete: (id) => `${L}/Levels/${id}`,
    scope: "global",
  },
  log: {
    list: `${L}/Logs`,
    byId: (id) => `${L}/Logs/${id}`,
    create: `${L}/Logs`,
    update: (id) => `${L}/Logs/${id}`,
    delete: (id) => `${L}/Logs/${id}`,
    scope: "global",
  },
  property: {
    list: level("/Properties"),
    byId: (id) => `${L}/Properties/${id}`,
    create: level("/Properties"),
    update: (id) => `${L}/Properties/${id}`,
    delete: (id) => `${L}/Properties/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  logProperty: {
    list: log("/Properties"),
    byId: (id) => `${L}/Properties/${id}`,
    create: log("/Properties"),
    update: (id) => `${L}/Properties/${id}`,
    delete: (id) => `${L}/Properties/${id}`,
    scope: "perLog",
  },
  levelSection: {
    list: level("/Sections"),
    byId: (id) => `${L}/Sections/${id}`,
    create: level("/Sections"),
    update: (id) => `${L}/Sections/${id}`,
    delete: (id) => `${L}/Sections/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  propertyStatus: {
    // Status endpoints are per-property: /properties/{propertyId}/Status
    // During snapshot, we iterate over properties within each level.
    // The {schemaId} will be resolved to the property ID.
    list: `${L}/properties/{schemaId}/Status`,
    byId: (id) => `${L}/properties/Status/${id}`,
    create: `${L}/properties/{schemaId}/Status`,
    update: (id) => `${L}/properties/Status/${id}`,
    delete: (id) => `${L}/properties/Status/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  levelStatus: {
    list: level("/Statuses"),
    byId: (id) => `${L}/Statuses/${id}`,
    create: level("/Statuses"),
    update: (id) => `${L}/Statuses/${id}`,
    delete: (id) => `${L}/Statuses/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  phaseGate: {
    list: level("/PhaseGates"),
    byId: (id) => `${L}/PhaseGates/${id}`,
    create: level("/PhaseGates"),
    update: (id) => `${L}/PhaseGates/${id}`,
    delete: (id) => `${L}/PhaseGates/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  lookup: {
    list: `${L}/Lookups`,
    byId: (id) => `${L}/Lookups/${id}`,
    create: `${L}/Lookups`,
    update: (id) => `${L}/Lookups/${id}`,
    delete: (id) => `${L}/Lookups/${id}`,
    scope: "global",
  },
  source: {
    // Level connections (parent-child). Fetched globally from SchemaLevelsController.
    list: `${L}/SchemaLevels/connections`,
    byId: (id) => `${L}/SchemaLevels/connections/${id}`,
    create: `${L}/SchemaLevels/connections`,
    update: (id) => `${L}/SchemaLevels/connections/update`,
    delete: (id) => `${L}/SchemaLevels/connections/${id}`,
    scope: "global",
  },

  // ── Per-level admin sections ──────────────────────────────────────────
  levelAttachedLogs: {
    list: level("/Logs"),
    byId: (id) => `${L}/LevelLogs/${id}`,
    create: level("/Logs"),
    update: (id) => `${L}/LevelLogs/${id}`,
    delete: (id) => `${L}/LevelLogs/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  role: {
    list: level("/Roles"),
    byId: (id) => `${L}/Roles/${id}`,
    create: level("/Roles"),
    update: (id) => `${L}/Roles/${id}`,
    delete: (id) => `${L}/Roles/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  escalation: {
    list: level("/Escalation"),
    byId: (id) => `${L}/Escalation/${id}`,
    create: level("/Escalation"),
    update: (id) => `${L}/Escalation/${id}`,
    delete: (id) => `${L}/Escalation/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  procurement: {
    list: level("/Procurement"),
    byId: (id) => `${L}/Procurement/${id}`,
    create: level("/Procurement"),
    update: (id) => `${L}/Procurement/${id}`,
    delete: (id) => `${L}/Procurement/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  cardConfig: {
    list: level("/CardsManagement"),
    byId: (id) => `${L}/CardsManagement/${id}`,
    create: level("/CardsManagement"),
    update: (id) => `${L}/CardsManagement/${id}`,
    delete: (id) => `${L}/CardsManagement/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  processBuilder: {
    list: level("/ProcessBuilder"),
    byId: (id) => `${L}/ProcessBuilder/${id}`,
    create: level("/ProcessBuilder"),
    update: (id) => `${L}/ProcessBuilder/${id}`,
    delete: (id) => `${L}/ProcessBuilder/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  approvalProcess: {
    list: level("/Approvals"),
    byId: (id) => `${L}/Approvals/${id}`,
    create: level("/Approvals"),
    update: (id) => `${L}/Approvals/${id}`,
    delete: (id) => `${L}/Approvals/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  codeBuilder: {
    list: level("/Code"),
    byId: (id) => `${L}/Code/${id}`,
    create: level("/Code"),
    update: (id) => `${L}/Code/${id}`,
    delete: (id) => `${L}/Code/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  notification: {
    list: level("/Notifications"),
    byId: (id) => `${L}/Notifications/${id}`,
    create: level("/Notifications"),
    update: (id) => `${L}/Notifications/${id}`,
    delete: (id) => `${L}/Notifications/${id}`,
    scope: "perLevel",
    perLevel: true,
  },
  workflow: {
    list: `${L}/Workflow`,
    byId: (id) => `${L}/Workflow/${id}`,
    create: `${L}/Workflow`,
    update: (id) => `${L}/Workflow/${id}`,
    delete: (id) => `${L}/Workflow/${id}`,
    scope: "global",
  },

  // ── Dashboards ────────────────────────────────────────────────────────
  dashboard: {
    list: `${L}/Dashboards`,
    byId: (id) => `${L}/Dashboards/${id}`,
    create: `${L}/Dashboards`,
    update: (id) => `${L}/Dashboards/${id}`,
    delete: (id) => `${L}/Dashboards/${id}`,
    headers: { csr: "1" },
    scope: "global",
  },
  chartComponent: {
    list: `${L}/component/chart`,
    byId: (id) => `${L}/component/chart/${id}`,
    create: `${L}/component/chart`,
    update: (id) => `${L}/component/chart/${id}`,
    delete: (id) => `${L}/component/chart/${id}`,
    headers: { csr: "1" },
    scope: "global",
  },

  // ── Global admin ──────────────────────────────────────────────────────
  user: {
    list: `${L}/identity/Users`,
    byId: (id) => `${L}/identity/Users/${id}`,
    create: `${L}/identity/Users`,
    update: (id) => `${L}/identity/Users/${id}`,
    delete: (id) => `${L}/identity/Users/${id}`,
    scope: "global",
  },
  group: {
    list: `${L}/identity/Groups`,
    byId: (id) => `${L}/identity/Groups/${id}`,
    create: `${L}/identity/Groups`,
    update: (id) => `${L}/identity/Groups/${id}`,
    delete: (id) => `${L}/identity/Groups/${id}`,
    scope: "global",
  },
  setting: {
    list: `${L}/Settings`,
    byId: (id) => `${L}/Settings/${id}`,
    create: `${L}/Settings`,
    update: (id) => `${L}/Settings/${id}`,
    delete: (id) => `${L}/Settings/${id}`,
    scope: "global",
  },
  holiday: {
    list: `${L}/Holidays`,
    byId: (id) => `${L}/Holidays/${id}`,
    create: `${L}/Holidays`,
    update: (id) => `${L}/Holidays/${id}`,
    delete: (id) => `${L}/Holidays/${id}`,
    scope: "global",
  },
  accessibility: {
    list: `${L}/Accessibilities`,
    byId: (id) => `${L}/Accessibilities/${id}`,
    create: `${L}/Accessibilities`,
    update: (id) => `${L}/Accessibilities/${id}`,
    delete: (id) => `${L}/Accessibilities/${id}`,
    scope: "global",
  },
  classification: {
    list: `${L}/Classification`,
    byId: (id) => `${L}/Classification/${id}`,
    create: `${L}/Classification`,
    update: (id) => `${L}/Classification/${id}`,
    delete: (id) => `${L}/Classification/${id}`,
    scope: "global",
  },
  scheduleView: {
    list: `${L}/ScheduleViews`,
    byId: (id) => `${L}/ScheduleViews/${id}`,
    create: `${L}/ScheduleViews`,
    update: (id) => `${L}/ScheduleViews/${id}`,
    delete: (id) => `${L}/ScheduleViews/${id}`,
    scope: "global",
  },
  delegation: {
    list: `${L}/Delegations`,
    byId: (id) => `${L}/Delegations/${id}`,
    create: `${L}/Delegations`,
    update: (id) => `${L}/Delegations/${id}`,
    delete: (id) => `${L}/Delegations/${id}`,
    scope: "global",
  },
};

export const NOTIFY_SYNC = "/service/api/configuration/sync-notification";
