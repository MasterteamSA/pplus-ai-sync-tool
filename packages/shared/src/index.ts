import { z } from "zod";

export const entityKindSchema = z.enum([
  // Hierarchy & data model
  "level", "log", "property", "logProperty", "levelSection",
  "propertyStatus", "levelStatus", "phaseGate", "lookup", "source",
  // Per-level admin sections
  "levelAttachedLogs", "role", "escalation", "procurement",
  "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
  "notification", "workflow",
  // Dashboards
  "dashboard", "chartComponent",
  // Global admin
  "user", "group", "setting", "holiday", "accessibility",
  "classification", "scheduleView", "delegation",
]);

export const authModeSchema = z.enum(["cookie", "bearer", "basic"]);

export const envFormSchema = z.object({
  label: z.string().min(1).max(64),
  baseUrl: z.string().url(),
  authMode: authModeSchema,
  cookie: z.string().optional(),
  bearer: z.string().optional(),
  basicUser: z.string().optional(),
  basicPass: z.string().optional(),
});

export const connectFormSchema = z.object({
  source: envFormSchema,
  targets: z.array(envFormSchema).min(1).max(20),
});

export const createRunSchema = z.object({
  sourceCredentialId: z.string().min(1),
  targetCredentialIds: z.array(z.string().min(1)).min(1),
  kinds: z.array(entityKindSchema).min(1),
});

export const ENTITY_PRESETS: Record<string, z.infer<typeof entityKindSchema>[]> = {
  "Schema only": [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup",
  ],
  "Schema + Admin": [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup",
    "levelAttachedLogs", "role", "escalation", "procurement",
    "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
    "notification",
  ],
  "Schema + Dashboards": [
    "level", "log", "property", "logProperty", "propertyStatus", "phaseGate",
    "lookup", "dashboard", "chartComponent",
  ],
  "Global admin": [
    "user", "group", "setting", "holiday", "accessibility",
    "classification", "scheduleView", "delegation", "workflow",
  ],
  Everything: [
    "level", "log", "property", "logProperty", "levelSection",
    "propertyStatus", "levelStatus", "phaseGate", "lookup", "source",
    "levelAttachedLogs", "role", "escalation", "procurement",
    "cardConfig", "processBuilder", "approvalProcess", "codeBuilder",
    "notification", "workflow",
    "dashboard", "chartComponent",
    "user", "group", "setting", "holiday", "accessibility",
    "classification", "scheduleView", "delegation",
  ],
};

export type EnvForm = z.infer<typeof envFormSchema>;
export type ConnectForm = z.infer<typeof connectFormSchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
