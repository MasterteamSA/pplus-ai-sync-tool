import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID, scryptSync, randomBytes } from "node:crypto";

import type { DrizzleDb } from "./client";
import * as schema from "./schema";

/**
 * First-boot bootstrap — apply any pending migrations and seed the default
 * operator user if none exists. Idempotent: safe to call on every import.
 * We guard with a module-level promise so concurrent calls share a single
 * bootstrap.
 */

let bootstrapPromise: Promise<void> | null = null;

export function ensureBootstrapped(db: DrizzleDb, isPGlite: boolean): Promise<void> {
  if (!bootstrapPromise) bootstrapPromise = runBootstrap(db, isPGlite);
  return bootstrapPromise;
}

function findMigrationsFolder(): string {
  // When running from source (tsx), __dirname is packages/db/src.
  // When running via Next.js, the module may be compiled elsewhere; fall back
  // to a couple of candidate paths relative to CWD.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "drizzle"),
    path.resolve(here, "..", "..", "drizzle"),
    path.resolve(process.cwd(), "packages/db/drizzle"),
    path.resolve(process.cwd(), "../../packages/db/drizzle"),
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error(`migrations folder not found; tried: ${candidates.join(", ")}`);
}

async function runBootstrap(db: DrizzleDb, isPGlite: boolean): Promise<void> {
  const migrationsFolder = findMigrationsFolder();
  if (isPGlite) {
    // Drizzle's pglite migrator types are specific to its drizzle instance.
    // Cast to any to reuse the shared DrizzleDb union.
    await migratePGlite(db as never, { migrationsFolder });
  } else {
    await migratePg(db as never, { migrationsFolder });
  }
  await seedDefaultUser(db);
}

async function seedDefaultUser(db: DrizzleDb): Promise<void> {
  const existing = await db.select({ id: schema.users.id }).from(schema.users).limit(1);
  if (existing.length > 0) return;

  const username = process.env.SEED_USER ?? "admin";
  const password = process.env.SEED_PASSWORD ?? "admin";
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  await db
    .insert(schema.users)
    .values({ id: randomUUID(), username, passwordHash: `${salt}:${hash}` })
    .onConflictDoNothing();
}
