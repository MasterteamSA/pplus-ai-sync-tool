import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { db, schema } from "./client";

const username = process.env.SEED_USER ?? "admin";
const password = process.env.SEED_PASSWORD ?? "admin";

const salt = randomBytes(16).toString("hex");
const hash = scryptSync(password, salt, 64).toString("hex");
const passwordHash = `${salt}:${hash}`;

await db
  .insert(schema.users)
  .values({ id: randomUUID(), username, passwordHash })
  .onConflictDoNothing();

console.log(`seeded operator user: ${username} (password from SEED_PASSWORD or default "admin")`);
process.exit(0);
