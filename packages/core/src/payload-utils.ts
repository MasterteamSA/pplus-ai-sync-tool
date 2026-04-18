/**
 * Payload sanitization helpers for the sync pipeline.
 *
 * PPlus conventions (from the backend ConfigurationDiffTool):
 *  - Server-assigned fields must NOT be sent on create.
 *  - Updates must include the target's ID in the body AND the URL.
 *  - Reference fields (levelId, logId, parentId, refId) must be
 *    remapped from source IDs to target IDs using the level/log maps.
 */

/** Fields the server assigns automatically — never send on create. */
const SERVER_ASSIGNED = new Set([
  "id",
  "_id",
  "Id",
  "ID",
  "createdAt",
  "CreatedAt",
  "created",
  "Created",
  "updatedAt",
  "UpdatedAt",
  "updated",
  "Updated",
  "createdBy",
  "CreatedBy",
  "updatedBy",
  "UpdatedBy",
  "createdDate",
  "modifiedDate",
  "modifiedBy",
]);

/** Fields that hold references to levels, logs, or parent IDs. */
const REFERENCE_FIELDS = [
  "levelId",
  "LevelId",
  "logId",
  "LogId",
  "parentId",
  "ParentId",
  "refId",
  "RefId",
  "levelLogId",
  "LevelLogId",
] as const;

/**
 * Strip server-assigned fields from a payload (for CREATE operations).
 * Returns a shallow clone; original is not mutated.
 */
export function stripServerFields(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (!SERVER_ASSIGNED.has(k)) {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Inject the target's ID into a payload (for UPDATE operations).
 * PPlus expects the id in both the URL path and the body.
 */
export function injectTargetId(
  payload: unknown,
  targetId: string,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const obj = payload as Record<string, unknown>;
  const out = { ...obj };
  // Use whichever id field the original payload had.
  if ("id" in obj) out.id = isNaN(Number(targetId)) ? targetId : Number(targetId);
  else if ("Id" in obj) out.Id = isNaN(Number(targetId)) ? targetId : Number(targetId);
  else if ("_id" in obj) out._id = targetId;
  else out.id = isNaN(Number(targetId)) ? targetId : Number(targetId);
  return out;
}

export interface IdMap {
  /** source ID → target ID */
  levels: Map<string, string>;
  /** source ID → target ID */
  logs: Map<string, string>;
  /** source level name → target level name */
  levelNames: Map<string, string>;
  /** source log name → target log name */
  logNames: Map<string, string>;
}

/**
 * Remap reference fields in a payload from source IDs to target IDs.
 * Used when creating/updating entities that reference levels or logs
 * (e.g. properties have a levelId field that must point to the target's level).
 */
export function remapReferences(
  payload: unknown,
  idMap: IdMap,
): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }
  const obj = { ...(payload as Record<string, unknown>) };

  for (const field of REFERENCE_FIELDS) {
    const val = obj[field];
    if (val == null) continue;
    const strVal = String(val);
    if (field === "levelId" || field === "LevelId" || field === "refId" || field === "RefId") {
      const mapped = idMap.levels.get(strVal);
      if (mapped) obj[field] = isNaN(Number(mapped)) ? mapped : Number(mapped);
    }
    if (field === "logId" || field === "LogId") {
      const mapped = idMap.logs.get(strVal);
      if (mapped) obj[field] = isNaN(Number(mapped)) ? mapped : Number(mapped);
    }
    if (field === "parentId" || field === "ParentId") {
      // Parent could be a level or a log — try both maps.
      const mappedLevel = idMap.levels.get(strVal);
      const mappedLog = idMap.logs.get(strVal);
      const mapped = mappedLevel ?? mappedLog;
      if (mapped) obj[field] = isNaN(Number(mapped)) ? mapped : Number(mapped);
    }
  }
  return obj;
}

/**
 * Rewrite property keys in a payload when level/log names have changed.
 * E.g. if source level is "Site" and target is "Facility",
 * a key like "Site_Revenue_1" becomes "Facility_Revenue_1".
 */
export function rewritePropertyKey(
  key: string,
  levelNameMap: Map<string, string>,
  logNameMap: Map<string, string>,
): string {
  let result = key;
  for (const [srcName, tgtName] of levelNameMap) {
    if (result.startsWith(srcName + "_")) {
      result = tgtName + result.slice(srcName.length);
      break;
    }
  }
  for (const [srcName, tgtName] of logNameMap) {
    if (result.startsWith(srcName + "_")) {
      result = tgtName + result.slice(srcName.length);
      break;
    }
  }
  return result;
}

/**
 * Full preparation of a payload for a CREATE operation:
 * strip server fields, remap references, rewrite property key if applicable.
 */
export function prepareCreatePayload(
  payload: unknown,
  idMap: IdMap,
  kind?: string,
): unknown {
  let p = stripServerFields(payload);
  p = remapReferences(p, idMap);

  // Rewrite the key field for property-like entities.
  if (kind === "property" || kind === "logProperty") {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const obj = p as Record<string, unknown>;
      const key = (obj.key ?? obj.Key) as string | undefined;
      if (key) {
        const newKey = rewritePropertyKey(key, idMap.levelNames, idMap.logNames);
        if ("key" in obj) (obj as Record<string, unknown>).key = newKey;
        if ("Key" in obj) (obj as Record<string, unknown>).Key = newKey;
      }
    }
  }
  return p;
}

/**
 * Full preparation of a payload for an UPDATE operation:
 * inject target ID, remap references, rewrite property key if applicable.
 */
export function prepareUpdatePayload(
  payload: unknown,
  targetId: string,
  idMap: IdMap,
  kind?: string,
): unknown {
  let p = injectTargetId(payload, targetId);
  p = remapReferences(p, idMap);

  if (kind === "property" || kind === "logProperty") {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const obj = p as Record<string, unknown>;
      const key = (obj.key ?? obj.Key) as string | undefined;
      if (key) {
        const newKey = rewritePropertyKey(key, idMap.levelNames, idMap.logNames);
        if ("key" in obj) (obj as Record<string, unknown>).key = newKey;
        if ("Key" in obj) (obj as Record<string, unknown>).Key = newKey;
      }
    }
  }
  return p;
}
