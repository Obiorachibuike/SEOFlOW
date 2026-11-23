import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";

const globalForDb = globalThis as typeof globalThis & { seoflowPool?: Pool };

export const pool = globalForDb.seoflowPool ?? new Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/seoflow",
  max: process.env.NODE_ENV === "production" ? 10 : 4,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  allowExitOnIdle: process.env.NODE_ENV !== "production"
});

if (process.env.NODE_ENV !== "production") globalForDb.seoflowPool = pool;

export const db = drizzle(pool, { schema });
export type Database = typeof db;
