import { z } from "zod";

export const entityKindSchema = z.enum([
  "level",
  "log",
  "property",
  "propertyStatus",
  "phaseGate",
  "lookup",
  "workflow",
  "dashboard",
  "chartComponent",
  "source",
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
  "Schema only": ["level", "log", "property", "propertyStatus", "phaseGate", "lookup"],
  "Schema + Workflows": ["level", "log", "property", "propertyStatus", "phaseGate", "lookup", "workflow"],
  "Schema + Dashboards": [
    "level", "log", "property", "propertyStatus", "phaseGate", "lookup",
    "dashboard", "chartComponent",
  ],
  Everything: [
    "level", "log", "property", "propertyStatus", "phaseGate", "lookup",
    "workflow", "dashboard", "chartComponent", "source",
  ],
};

export type EnvForm = z.infer<typeof envFormSchema>;
export type ConnectForm = z.infer<typeof connectFormSchema>;
export type CreateRunInput = z.infer<typeof createRunSchema>;
