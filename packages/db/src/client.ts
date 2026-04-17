import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePGlite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import * as schema from "./schema";

/**
 * Storage backend selection:
 *
 *   DATABASE_URL=postgres://...   → real Postgres via postgres-js
 *   DATABASE_URL=pglite://<path>  → embedded Postgres (PGlite) at given path
 *   DATABASE_URL unset            → PGlite at ~/.pplus-ai-sync/db
 *
 * PGlite is a WASM build of Postgres that runs in-process. It means the tool
 * works on any machine with just Node — no Docker, no Postgres install. The
 * Drizzle schema is identical for both backends.
 */

export type DrizzleDb =
  | ReturnType<typeof drizzlePGlite<typeof schema>>
  | ReturnType<typeof drizzlePg<typeof schema>>;

declare global {
  // eslint-disable-next-line no-var
  var __pplus_sync_db: DrizzleDb | undefined;
}

function defaultPGlitePath(): string {
  const base = path.join(os.homedir(), ".pplus-ai-sync");
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, "db");
}

function init(): DrizzleDb {
  const url = process.env.DATABASE_URL;
  if (!url || url.startsWith("pglite:")) {
    const rawPath = url?.replace(/^pglite:\/?\/?/, "") || defaultPGlitePath();
    const pglite = new PGlite(rawPath);
    return drizzlePGlite(pglite, { schema });
  }
  const client = postgres(url, { max: 10 });
  return drizzlePg(client, { schema });
}

export const db: DrizzleDb = globalThis.__pplus_sync_db ?? init();
if (process.env.NODE_ENV !== "production") globalThis.__pplus_sync_db = db;

export { schema };
