import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePGlite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import * as schema from "./schema";
import { ensureBootstrapped } from "./bootstrap";

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
 *
 * On first access we run pending migrations + seed a default operator user.
 * That makes the first `pnpm dev` a zero-setup experience.
 */

export type DrizzleDb =
  | ReturnType<typeof drizzlePGlite<typeof schema>>
  | ReturnType<typeof drizzlePg<typeof schema>>;

interface Cached {
  db: DrizzleDb;
  ready: Promise<void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __pplus_sync_db: Cached | undefined;
}

function defaultPGlitePath(): string {
  const base = path.join(os.homedir(), ".pplus-ai-sync");
  fs.mkdirSync(base, { recursive: true });
  return path.join(base, "db");
}

function init(): Cached {
  const url = process.env.DATABASE_URL;
  const isPGlite = !url || url.startsWith("pglite:");
  let db: DrizzleDb;
  if (isPGlite) {
    const rawPath = url?.replace(/^pglite:\/?\/?/, "") || defaultPGlitePath();
    const pglite = new PGlite(rawPath);
    db = drizzlePGlite(pglite, { schema });
  } else {
    const client = postgres(url!, { max: 10 });
    db = drizzlePg(client, { schema });
  }
  const ready = ensureBootstrapped(db, isPGlite).catch((err) => {
    console.error("[pplus-sync] bootstrap failed:", err);
    throw err;
  });
  return { db, ready };
}

const cached: Cached = globalThis.__pplus_sync_db ?? init();
if (process.env.NODE_ENV !== "production") globalThis.__pplus_sync_db = cached;

export const db: DrizzleDb = cached.db;
export const dbReady: Promise<void> = cached.ready;
export { schema };
