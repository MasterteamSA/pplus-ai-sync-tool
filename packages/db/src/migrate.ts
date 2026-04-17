import { migrate as migratePGlite } from "drizzle-orm/pglite/migrator";
import { migrate as migratePg } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePGlite } from "drizzle-orm/pglite";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import { PGlite } from "@electric-sql/pglite";
import postgres from "postgres";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const url = process.env.DATABASE_URL;
const migrationsFolder = "./drizzle";

if (!url || url.startsWith("pglite:")) {
  const rawPath = url?.replace(/^pglite:\/?\/?/, "") || (() => {
    const base = path.join(os.homedir(), ".pplus-ai-sync");
    fs.mkdirSync(base, { recursive: true });
    return path.join(base, "db");
  })();
  const pglite = new PGlite(rawPath);
  await pglite.waitReady;
  const db = drizzlePGlite(pglite);
  await migratePGlite(db, { migrationsFolder });
  await pglite.close();
  console.log(`[pglite] migrations applied at ${rawPath}`);
} else {
  const client = postgres(url, { max: 1 });
  const db = drizzlePg(client);
  await migratePg(db, { migrationsFolder });
  await client.end();
  console.log("[postgres] migrations applied");
}
