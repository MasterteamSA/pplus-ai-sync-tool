import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set");

declare global {
  // eslint-disable-next-line no-var
  var __pplus_sync_pg: ReturnType<typeof postgres> | undefined;
}

const queryClient = globalThis.__pplus_sync_pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalThis.__pplus_sync_pg = queryClient;

export const db = drizzle(queryClient, { schema });
export { schema };
