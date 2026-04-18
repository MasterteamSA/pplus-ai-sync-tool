/**
 * PPlus v4 API Conventions & Knowledge Base
 *
 * Single source of truth for all PPlus-specific knowledge needed to
 * successfully sync configuration between instances. Derived from:
 *  - ConfigurationDiffTool (C# backend, EF Core sync engine)
 *  - pplus-knowledge repo (57 chunks, 9 categories)
 *  - PPlus-Agent repo (MCP server with 44+ knowledge chunks)
 *  - End-to-end test results (MTPPLUS → PIF, 40/42 ops succeeded)
 *
 * This module is imported by both the deterministic pipeline and the
 * AI prompts, ensuring both code paths share identical conventions.
 */

/* ─── Authentication ──────────────────────────────────────────────── */

/**
 * PPlus login endpoint paths, in priority order.
 * Deployments vary — some use capital `/Service/`, others lowercase.
 */
export const LOGIN_PATHS = [
  "/Service/api/users/authenticate",
  "/service/api/users/authenticate",
  "/Service/api/Authentication/authenticate",
  "/service/api/Authentication/authenticate",
] as const;

/**
 * Login request body variants. The first is most common.
 */
export const LOGIN_PAYLOADS = [
  (u: string, p: string) => ({ UserName: u, Password: p }),
  (u: string, p: string) => ({ userName: u, password: p }),
] as const;

/**
 * Required headers for every PPlus API request.
 */
export const REQUIRED_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "X-Requested-With": "XMLHttpRequest",
} as const;

/**
 * The CSR token is shared across most PPlus instances.
 * It's stored in localStorage under key 'csr'.
 */
export const DEFAULT_CSR = "=8yPFwmIQPX96bxPVFP_62WCH*+o]v*g";

/* ─── Response Format ─────────────────────────────────────────────── */

/**
 * Standard PPlus response wrapper (PPlusResponse<T>):
 * {
 *   status: number,     // HTTP-like status
 *   code: number,       // 1 = success
 *   data: T,            // Payload (array or object)
 *   message: string,    // Human-readable
 *   errors: string      // Error detail
 * }
 *
 * Some endpoints nest deeper: { data: { data: T } }
 */

/* ─── PPlus Intentional Typos (MUST PRESERVE) ─────────────────────── */

/**
 * PPlus has field names with intentional misspellings throughout
 * the codebase. These MUST be preserved exactly — "fixing" them
 * will break the system.
 */
export const PPLUS_TYPOS = {
  /** Dashboard chart config field — NOT "configuration" */
  configration: "configration",
  /** Chart handler function name field — NOT "functionName" */
  fuctionName: "fuctionName",
  /** Filter required field — NOT "isRequired" */
  isRequird: "isRequird",
  /** Aggregation function — NOT "Average" */
  Avarage: "Avarage",
  /** Aggregation function — NOT "DistinctCount" */
  DisticntCount: "DisticntCount",
  /** Aggregation function — NOT "First" */
  Frist: "Frist",
} as const;

/* ─── Bilingual/Localized Fields ──────────────────────────────────── */

/**
 * PPlus uses TranslatableValue pattern: { ar: string, en: string }
 * for ALL user-visible text fields. This is NOT optional — the
 * FluentValidation rules dereference `.ar` and `.en` directly,
 * causing NullReferenceException when a plain string is passed.
 *
 * Fields that MUST be localized objects:
 */
export const LOCALIZED_FIELDS = [
  "displayName",
  "DisplayName",
  "name",
  "Name",
  "description",
  "Description",
  "title",
  "Title",
] as const;

/**
 * Entity kinds that require bilingual field normalization.
 */
export const LOCALIZED_KINDS = new Set([
  "lookup",
  "propertyStatus",
  "levelStatus",
  "phaseGate",
  "property",
  "logProperty",
  "levelSection",
  "levelAttachedLogs",
  "role",
  "escalation",
  "notification",
]);

/* ─── Server-Assigned Fields ──────────────────────────────────────── */

/**
 * Fields the PPlus server assigns automatically.
 * MUST be stripped from CREATE payloads.
 * MUST be preserved (with target ID) in UPDATE payloads.
 */
export const SERVER_ASSIGNED_FIELDS = new Set([
  "id", "_id", "Id", "ID",
  "createdAt", "CreatedAt", "created", "Created",
  "updatedAt", "UpdatedAt", "updated", "Updated",
  "createdBy", "CreatedBy",
  "updatedBy", "UpdatedBy",
  "createdDate", "modifiedDate", "modifiedBy",
]);

/* ─── Frontend-Only Fields ────────────────────────────────────────── */

/**
 * Fields that exist in the frontend Angular app but MUST NOT be sent
 * to the backend API. Including them causes WAF 403 errors.
 */
export const FRONTEND_ONLY_FIELDS = new Set([
  "propertyData",
  "operationLevel",
  "operationLevelGroup",
]);

/* ─── System/Built-in Record Detection ────────────────────────────── */

/**
 * Heuristics for detecting system records that should not be modified.
 */
export function isSystemRecord(kind: string, payload: Record<string, unknown>): boolean {
  if (payload.canBeDeleted === false) return true;
  if (kind === "log" && payload.type === 1) return true;
  if (kind === "log" && typeof payload.id === "number" && payload.id <= 12) return true;
  if (kind === "lookup" && typeof payload.id === "number" && (payload.id as number) < 1000) return true;
  return false;
}

/* ─── Sync Dependency Order ───────────────────────────────────────── */

/**
 * The exact order entities must be synced, derived from the backend
 * ConfigurationSyncOrchestrator. Violating this order causes foreign
 * key failures and orphaned references.
 *
 * Backend sync steps with weights:
 *  1. Level Schema (10%)
 *  2. Level Connections (10%)
 *  3. Log Schema (10%)
 *  4. Level-Attached Logs (15%)
 *  5. Properties + Key Adjustment (20%)
 *  6. Log Properties
 *  7. Level Sections
 *  8. Property Statuses (10%)
 *  9. Level Statuses
 * 10. Phase Gates (10%)
 * 11. Lookups (10%)
 * 12. Workflows (5%)
 * 13. Dashboards + Charts
 * 14. Admin entities (roles, escalation, etc.)
 */
export const SYNC_ORDER = [
  "level",
  "source",
  "log",
  "levelAttachedLogs",
  "property",
  "logProperty",
  "levelSection",
  "propertyStatus",
  "levelStatus",
  "phaseGate",
  "lookup",
  "workflow",
  "dashboard",
  "chartComponent",
  "role",
  "escalation",
  "procurement",
  "cardConfig",
  "processBuilder",
  "approvalProcess",
  "codeBuilder",
  "notification",
  "user",
  "group",
  "classification",
  "scheduleView",
  "setting",
  "holiday",
  "accessibility",
  "delegation",
] as const;

/* ─── Entity-Specific Knowledge ───────────────────────────────────── */

/**
 * Per-entity-kind knowledge for payload preparation.
 */
export const ENTITY_KNOWLEDGE: Record<string, {
  /** Fields to strip from create payloads beyond SERVER_ASSIGNED. */
  stripOnCreate?: string[];
  /** Fields to preserve on update (don't overwrite from source). */
  preserveOnUpdate?: string[];
  /** Whether this kind supports update or is create-only. */
  createOnly?: boolean;
  /** Whether nested items need ID stripping on create. */
  stripNestedIds?: boolean;
  /** Notes for AI self-healing. */
  notes?: string;
}> = {
  level: {
    preserveOnUpdate: ["parentId", "sources"],
    notes: "Levels are tree-scoped. Name changes trigger property key adjustments.",
  },
  log: {
    stripOnCreate: ["type"],
    notes: "type=1 is built-in (read-only). Only type=2 (custom) can be created. Created logs must NOT carry type=1.",
  },
  property: {
    preserveOnUpdate: ["levelId", "logId", "levelLogId"],
    notes: "Key format: LevelName_PropertyName_UID. Keys must be rewritten when level names change. Formula/Script fields contain {{Key}} references that need rewriting.",
  },
  logProperty: {
    preserveOnUpdate: ["levelId", "logId", "levelLogId"],
    notes: "Same as property but scoped to a log.",
  },
  propertyStatus: {
    stripNestedIds: true,
    notes: "Endpoint is /properties/{propertyId}/Status. Status values need localized display names.",
  },
  phaseGate: {
    createOnly: true,
    stripNestedIds: true,
    notes: "Phase gates are CREATE-ONLY — existing gates are never updated, only new ones are added. Nested items (checklist tasks) also need localized names.",
  },
  lookup: {
    stripNestedIds: true,
    notes: "Lookup items are nested in the payload. Both root displayName and item names MUST be {ar, en} objects. Items need id stripped on create. System lookups (id < 1000) are protected.",
  },
  workflow: {
    notes: "Workflows use FULL REPLACEMENT strategy: delete all activities/actions, then recreate. Self-referencing FK (PreviousWorkflowActivityId) must be nullified before deletion. Match by commandName.",
  },
  dashboard: {
    notes: "Dashboard shell created via POST /Dashboards. Chart grid saved separately via POST /Dashboards/Charts/Link with {DashboardId: STRING, configration: JSON_STRING}. DashboardId must be string. The 'configration' typo is intentional.",
  },
  chartComponent: {
    notes: "Charts are linked to dashboards via /Dashboards/Charts/Link, not created independently. The csr header is required.",
  },
  levelAttachedLogs: {
    notes: "Binds logs to levels. Must be synced after both levels and logs exist on target.",
  },
  source: {
    notes: "Level connections (parent-child). Fetched from SchemaLevels/connections. Properties: isOptional, allowManyToMany, supportWeights.",
  },
};

/* ─── Dashboard Chart Types ───────────────────────────────────────── */

/**
 * All 22 PPlus chart types with their handler mappings.
 * The fuctionName (typo preserved) and componentName are required
 * in clientConfig for the chart to render.
 */
export const CHART_TYPES: Record<string, { fuctionName: string; componentName: string; chartTypeId: string }> = {
  CardViewV2Chart: { fuctionName: "handleOverviewCard", componentName: "cardsStatistic", chartTypeId: "statistics-overview-card" },
  BarV2Chart: { fuctionName: "handleBarChart", componentName: "chart", chartTypeId: "chart-bar-chart" },
  StackBarV2Chart: { fuctionName: "handleStackBarChart", componentName: "chart", chartTypeId: "chart-stack-bar-chart" },
  PieV2Chart: { fuctionName: "handleDonutChart", componentName: "chart", chartTypeId: "chart-donut-chart" },
  GaugeV2Chart: { fuctionName: "handleGaugeChart", componentName: "chart", chartTypeId: "chart-gauge-chart" },
  TableView: { fuctionName: "handleTableView", componentName: "table", chartTypeId: "2-table-view" },
  LineChart: { fuctionName: "handleLineChart", componentName: "chart", chartTypeId: "chart-line-chart" },
  SplitChart: { fuctionName: "handleSplitterChart", componentName: "chart", chartTypeId: "chart-splitter-chart" },
  Properties: { fuctionName: "handleProperties", componentName: "entityPreview", chartTypeId: "entity-preview" },
  TimelineChart: { fuctionName: "handleTimelineV2MultiLevel", componentName: "timelineMultiViewChart", chartTypeId: "timeline-view-multi-level" },
};

/* ─── Property ViewTypes ──────────────────────────────────────────── */

/**
 * All PPlus property view types. The viewType field determines how
 * a property is rendered and stored.
 */
export const PROPERTY_VIEW_TYPES = [
  "Text", "Number", "Float", "Longtext", "Currency",
  "Date", "DateTime", "Time",
  "Lookup", "Status", "Checkbox", "User", "MultiUser",
  "DynamicList", "Slider", "Percentage",
  "Attachment", "ReferenceProperty", "EditableListView",
  "ChecklistForm", "LookupMatrix", "Location",
  "Integrated", "API",
] as const;

/* ─── Filter Operations ───────────────────────────────────────────── */

/**
 * Valid filter operations for chart data queries.
 */
export const FILTER_OPERATIONS = [
  "Equals", "NotEquals", "GreaterThan", "LessThan",
  "Contains", "Between", "OneOf", "Latest",
  "Empty", "NotEmpty",
  "GreaterThanOrEquals", "LessThanOrEquals",
] as const;

/* ─── Aggregation Functions ───────────────────────────────────────── */

/**
 * Valid aggregation functions. Note the intentional typos.
 */
export const AGGREGATION_FUNCTIONS = [
  "Sum", "Avg", "Avarage", "Average", "Count",
  "Max", "Min", "None", "DisticntCount", "Last", "Frist",
] as const;

/* ─── Instance Configuration Discovery ────────────────────────────── */

/**
 * Endpoints for discovering instance-specific configuration.
 * Module IDs, property keys, and level hierarchies vary per instance.
 */
export const DISCOVERY_ENDPOINTS = {
  /** Get level hierarchy for the instance */
  moduleTypes: "/service/api/Dashboards/ModulesTypes/Level",
  /** Get property keys for a specific level module */
  moduleProperties: (moduleType: string, moduleId: string) =>
    `/service/api/Dashboards/GetModuleProperties/${moduleType}/${moduleId}`,
  /** Get all dashboards */
  dashboards: "/service/api/Dashboards",
  /** Get general settings */
  settings: "/service/api/Settings/general",
} as const;

/* ─── Key Matching Rules ──────────────────────────────────────────── */

/**
 * Property key format: LevelName_PropertyBaseName_UniqueId
 * Examples:
 *   project_Name           (simple)
 *   K_Portfolio_Dvrc9_Id   (with K_ prefix and GUID fragment)
 *   1_4_source_K_Port_2Ui  (with numeric prefixes and source_ link)
 *
 * When level names change between instances, the LevelName portion
 * of the key must be rewritten while preserving BaseName and UID.
 *
 * Source link keys follow the pattern: source_K_LevelName_GUID
 * These reference parent-child joins across levels.
 */

/**
 * Name normalization for entity matching.
 * Strips spaces, hyphens, underscores and lowercases for comparison.
 * The backend's LevelMatcher uses 90%+ name similarity threshold.
 */
export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[\s_\-]+/g, "").trim();
}

/**
 * Levenshtein similarity threshold for fuzzy matching.
 * Backend uses 90% for levels/logs.
 */
export const FUZZY_MATCH_THRESHOLD = 0.90;
