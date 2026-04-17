import type { Config } from "drizzle-kit";

/**
 * drizzle-kit only emits SQL against a dialect; at runtime the same migrations
 * are applied to either PGlite (default) or real Postgres. So we pin dialect
 * to `postgresql` and let drizzle-kit generate SQL — no live DB needed for
 * `drizzle-kit generate`.
 */
export default {
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
} satisfies Config;
