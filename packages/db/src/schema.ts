import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const envCredentials = pgTable(
  "env_credentials",
  {
    id: text("id").primaryKey(),
    label: text("label").notNull(),
    baseUrl: text("base_url").notNull(),
    authMode: varchar("auth_mode", { length: 16 }).notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    tag: text("tag").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at"),
    lastCheckOk: boolean("last_check_ok"),
  },
  (t) => ({
    labelIdx: uniqueIndex("env_credentials_label_idx").on(t.label),
  }),
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    sourceCredentialId: text("source_credential_id").notNull().references(() => envCredentials.id),
    kinds: jsonb("kinds").$type<string[]>().notNull(),
    actor: text("actor").notNull(),
    status: varchar("status", { length: 32 }).notNull().default("draft"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("runs_status_idx").on(t.status),
  }),
);

export const targetRuns = pgTable(
  "target_runs",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetCredentialId: text("target_credential_id").notNull().references(() => envCredentials.id),
    status: varchar("status", { length: 32 }).notNull().default("pending"),
    startedAt: timestamp("started_at"),
    completedAt: timestamp("completed_at"),
    error: text("error"),
  },
  (t) => ({
    byRun: index("target_runs_run_idx").on(t.runId),
  }),
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetRunId: text("target_run_id").references(() => targetRuns.id, { onDelete: "cascade" }),
    env: varchar("env", { length: 16 }).notNull(),
    envLabel: text("env_label").notNull(),
    baseUrl: text("base_url").notNull(),
    capturedAt: timestamp("captured_at").notNull().defaultNow(),
    kinds: jsonb("kinds").$type<string[]>().notNull(),
    entities: jsonb("entities").$type<Record<string, unknown>>().notNull(),
    isPreApply: boolean("is_pre_apply").notNull().default(false),
  },
  (t) => ({
    byRun: index("snapshots_run_idx").on(t.runId),
  }),
);

export const mappingDecisions = pgTable(
  "mapping_decisions",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetRunId: text("target_run_id").notNull().references(() => targetRuns.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 32 }).notNull(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id"),
    method: varchar("method", { length: 16 }).notNull(),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    accepted: boolean("accepted").notNull().default(false),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    bySource: index("mapping_decisions_source_idx").on(t.runId, t.targetRunId, t.kind, t.sourceId),
  }),
);

export const syncPlans = pgTable(
  "sync_plans",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetRunId: text("target_run_id").notNull().references(() => targetRuns.id, { onDelete: "cascade" }),
    ops: jsonb("ops").$type<unknown[]>().notNull(),
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byTarget: uniqueIndex("sync_plans_target_idx").on(t.runId, t.targetRunId),
  }),
);

export const auditEntries = pgTable(
  "audit_entries",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetRunId: text("target_run_id").references(() => targetRuns.id, { onDelete: "cascade" }),
    stage: varchar("stage", { length: 32 }).notNull(),
    ok: boolean("ok").notNull(),
    actor: text("actor").notNull(),
    ts: timestamp("ts").notNull().defaultNow(),
    opIndex: integer("op_index"),
    message: text("message"),
    payloadRef: text("payload_ref"),
  },
  (t) => ({
    byRun: index("audit_entries_run_idx").on(t.runId, t.stage),
  }),
);

export const appliedOps = pgTable(
  "applied_ops",
  {
    id: text("id").primaryKey(),
    runId: text("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    targetRunId: text("target_run_id").notNull().references(() => targetRuns.id, { onDelete: "cascade" }),
    opId: text("op_id").notNull(),
    kind: varchar("kind", { length: 32 }).notNull(),
    opType: varchar("op_type", { length: 16 }).notNull(),
    ok: boolean("ok").notNull(),
    newId: text("new_id"),
    error: text("error"),
    appliedAt: timestamp("applied_at").notNull().defaultNow(),
  },
  (t) => ({
    byTarget: index("applied_ops_target_idx").on(t.runId, t.targetRunId),
  }),
);
