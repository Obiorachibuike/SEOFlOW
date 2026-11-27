
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

function getDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();

  if (!databaseUrl) {
    throw new Error(
      "[SEOFlow Database] DATABASE_URL environment variable is missing."
    );
  }

  try {
    const parsedUrl = new URL(databaseUrl);

    if (
      parsedUrl.protocol !== "postgres:" &&
      parsedUrl.protocol !== "postgresql:"
    ) {
      throw new Error("Invalid PostgreSQL connection protocol.");
    }

    return databaseUrl;
  } catch {
    throw new Error(
      "[SEOFlow Database] DATABASE_URL is invalid. Check your PostgreSQL connection string."
    );
  }
}

const connectionString = getDatabaseUrl();

const isProduction = process.env.NODE_ENV === "production";

export const pool = new Pool({
  connectionString,

  max: isProduction ? 3 : 10,

  idleTimeoutMillis: 30000,

  connectionTimeoutMillis: 10000,

  allowExitOnIdle: !isProduction,

  ssl: isProduction
    ? { rejectUnauthorized: false }
    : undefined,
});

// Handle errors from idle PostgreSQL connections.
pool.on("error", (error) => {
  console.error(
    "[SEOFlow Database] Unexpected PostgreSQL pool error:",
    {
      message: error.message,
      code: error.code,
    }
  );
});

// Create the Drizzle database instance.
export const db = drizzle(pool, { schema });

// Verify database connectivity when explicitly called.
export async function checkDatabaseConnection(): Promise<boolean> {
  let client;

  try {
    client = await pool.connect();

    await client.query("SELECT 1");

    return true;
  } catch (error) {
    console.error(
      "[SEOFlow Database] Connection health check failed:",
      error instanceof Error ? error.message : "Unknown database error"
    );

    return false;
  } finally {
    client?.release();
  }
}

// Graceful shutdown for scripts and long-running processes.
// Do not call this after every request in a serverless deployment.
export async function closeDatabaseConnection(): Promise<void> {
  try {
    await pool.end();
  } catch (error) {
    console.error(
      "[SEOFlow Database] Failed to close connection pool:",
      error instanceof Error ? error.message : "Unknown error"
    );

    throw error;
  }
}
