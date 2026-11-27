/**
 * PostgreSQL connection management for SEOFlow.
 *
 * Production-grade behavior:
 * - DATABASE_URL is validated lazily (never throws at module import time).
 * - A single shared connection pool is reused per runtime (per serverless
 *   container / long-running process). It is never created per request and
 *   never closed after a request.
 * - TLS is configured securely: an `sslmode` in the connection string is
 *   honored by the `pg` driver; otherwise production defaults to verified
 *   certificates. `DATABASE_SSL=no-verify` is an explicit, documented escape
 *   hatch — never the default.
 * - Failures are classified into stable error codes with reference IDs
 *   (see src/lib/errors.ts) and logged with sanitized context.
 */

import { Pool, type PoolConfig } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
import { logger, errorDiagnostics } from "@/lib/logger";
import {
  AppError,
  ERROR_CODES,
  PUBLIC_MESSAGES,
  classifyDatabaseError,
  type ErrorCode
} from "@/lib/errors";

export const REQUIRED_AUTH_TABLES = ["user", "session", "account", "verification"] as const;
export type RequiredAuthTable = (typeof REQUIRED_AUTH_TABLES)[number];

/** Columns that must exist for Better Auth to function correctly. */
export const REQUIRED_AUTH_COLUMNS: Record<RequiredAuthTable, string[]> = {
  user: ["id", "name", "email", "email_verified", "platform_role", "created_at", "updated_at"],
  session: ["id", "expires_at", "token", "user_id", "created_at", "updated_at"],
  account: ["id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at"],
  verification: ["id", "identifier", "value", "expires_at", "created_at", "updated_at"]
};

export type DatabaseConfigResult =
  | { ok: true; connectionString: string }
  | { ok: false; error: AppError };

/** Validate DATABASE_URL without throwing. Safe to call anywhere. */
export function resolveDatabaseConfig(): DatabaseConfigResult {
  const raw = process.env.DATABASE_URL;
  const connectionString = raw?.trim();

  if (!connectionString) {
    return {
      ok: false,
      error: new AppError(ERROR_CODES.DATABASE_CONFIGURATION_ERROR, PUBLIC_MESSAGES.DATABASE_CONFIGURATION_ERROR, {
        operation: "database.config",
        category: "configuration",
        retryable: false,
        details: { reason: "DATABASE_URL is not set" }
      })
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    return {
      ok: false,
      error: new AppError(ERROR_CODES.DATABASE_CONFIGURATION_ERROR, PUBLIC_MESSAGES.DATABASE_CONFIGURATION_ERROR, {
        operation: "database.config",
        category: "configuration",
        retryable: false,
        details: { reason: "DATABASE_URL could not be parsed" }
      })
    };
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return {
      ok: false,
      error: new AppError(ERROR_CODES.DATABASE_CONFIGURATION_ERROR, PUBLIC_MESSAGES.DATABASE_CONFIGURATION_ERROR, {
        operation: "database.config",
        category: "configuration",
        retryable: false,
        details: { reason: "DATABASE_URL must use the postgres:// or postgresql:// protocol" }
      })
    };
  }

  if (!parsed.hostname) {
    return {
      ok: false,
      error: new AppError(ERROR_CODES.DATABASE_CONFIGURATION_ERROR, PUBLIC_MESSAGES.DATABASE_CONFIGURATION_ERROR, {
        operation: "database.config",
        category: "configuration",
        retryable: false,
        details: { reason: "DATABASE_URL is missing a host" }
      })
    };
  }

  return { ok: true, connectionString };
}

type SslSetting = PoolConfig["ssl"] | undefined;

/** Resolve the TLS configuration. Never downgrades security silently. */
export function resolveSsl(connectionString: string): SslSetting {
  const override = process.env.DATABASE_SSL?.trim().toLowerCase();

  if (override === "disable") {
    // Explicit operator choice (e.g. a private socket/VPC deployment).
    return false;
  }
  if (override === "no-verify") {
    // Explicit escape hatch for providers whose certificate chain cannot be
    // verified from the runtime. Never the default.
    return { rejectUnauthorized: false };
  }

  const caCert = process.env.DATABASE_CA_CERT?.trim();
  if (caCert) {
    return { ca: caCert, rejectUnauthorized: true };
  }

  let sslmode: string | null = null;
  try {
    sslmode = new URL(connectionString).searchParams.get("sslmode");
  } catch {
    sslmode = null;
  }

  // An explicit sslmode in the connection string is honored by the driver
  // (pg-connection-string). Do not override the operator's choice.
  if (sslmode) {
    return undefined;
  }

  // Production default: verify the provider certificate chain.
  if (process.env.NODE_ENV === "production") {
    return { rejectUnauthorized: true };
  }
  return undefined;
}

function parsePoolMax(isProduction: boolean): number {
  const raw = process.env.PG_POOL_MAX?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) return parsed;
  }
  return isProduction ? 3 : 10;
}

function parseConnectionTimeout(): number {
  const raw = process.env.DATABASE_CONNECTION_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 500 && parsed <= 60_000) return parsed;
  }
  return 5_000;
}

/**
 * Bound how long any single statement may run (default 15s, override with
 * DATABASE_QUERY_TIMEOUT_MS). Prevents one pathological query from pinning
 * every pool slot and starving authentication traffic.
 */
function parseQueryTimeout(): number {
  const raw = process.env.DATABASE_QUERY_TIMEOUT_MS?.trim();
  if (raw) {
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed) && parsed >= 1_000 && parsed <= 120_000) return parsed;
  }
  return 15_000;
}

export function buildPoolConfig(connectionString: string): PoolConfig {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    connectionString,
    max: parsePoolMax(isProduction),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: parseConnectionTimeout(),
    query_timeout: parseQueryTimeout(),
    statement_timeout: parseQueryTimeout(),
    allowExitOnIdle: true,
    ssl: resolveSsl(connectionString)
  };
}

type PoolGlobal = typeof globalThis & {
  __seoflowPool?: Pool;
  __seoflowDb?: NodePgDatabase<typeof schema>;
};

const globalForDb = globalThis as PoolGlobal;

/**
 * Returns the shared pool, creating it on first use. Throws AppError
 * (DATABASE_CONFIGURATION_ERROR) when DATABASE_URL is missing or invalid.
 */
export function getPool(): Pool {
  const existing = globalForDb.__seoflowPool;
  if (existing) return existing;

  const config = resolveDatabaseConfig();
  if (!config.ok) {
    throw config.error;
  }

  const pool = new Pool(buildPoolConfig(config.connectionString));
  pool.on("error", (error: Error & { code?: string }) => {
    // Idle-client errors must not crash the process.
    logger.error("DATABASE_POOL_ERROR", {
      operation: "database.pool",
      ...errorDiagnostics(error),
      driver: "node-postgres"
    });
  });
  globalForDb.__seoflowPool = pool;
  return pool;
}

function getDatabase(): NodePgDatabase<typeof schema> {
  const existing = globalForDb.__seoflowDb;
  if (existing) return existing;
  const client = drizzle(getPool(), { schema });
  globalForDb.__seoflowDb = client;
  return client;
}

function lazySingleton<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, property) {
      const value = Reflect.get(resolve() as object, property) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(resolve()) : value;
    },
    has(_target, property) {
      return property in (resolve() as object);
    },
    getOwnPropertyDescriptor(_target, property) {
      const descriptor = Reflect.getOwnPropertyDescriptor(resolve() as object, property);
      if (descriptor) descriptor.configurable = true;
      return descriptor;
    },
    ownKeys() {
      return Reflect.ownKeys(resolve() as object);
    }
  });
}

/**
 * Shared database instance. Importing this module never throws; configuration
 * and connection failures surface as classified AppErrors when the database is
 * first used (i.e. during a query), and are reported by /api/health*.
 */
export const db: NodePgDatabase<typeof schema> = lazySingleton(getDatabase);

/** Shared pool for scripts/workers that manage their own lifecycle. */
export const pool: Pool = lazySingleton(getPool);

export type DatabaseHealthResult =
  | { ok: true; latencyMs: number }
  | { ok: false; code: ErrorCode; referenceId: string; retryable: boolean; latencyMs: number };

/** Performs a real, lightweight query. Never reports success without one. */
export async function checkDatabaseHealth(timeoutMs = 5_000): Promise<DatabaseHealthResult> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      getPool().query("SELECT 1"),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          const timeoutError = new Error(`Health check timed out after ${timeoutMs}ms`);
          timeoutError.name = "TimeoutError";
          (timeoutError as { code?: string }).code = "ETIMEDOUT";
          reject(timeoutError);
        }, timeoutMs);
      })
    ]);
    void result;
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    const classified = classifyDatabaseError(error, "database.health");
    if (classified.code !== ERROR_CODES.DATABASE_CONFIGURATION_ERROR) {
      logger.error("DATABASE_HEALTH_CHECK_FAILED", {
        operation: "database.health",
        code: classified.code,
        referenceId: classified.referenceId,
        retryable: classified.retryable,
        latencyMs: Date.now() - started,
        ...errorDiagnostics(error)
      });
    }
    return {
      ok: false,
      code: classified.code,
      referenceId: classified.referenceId,
      retryable: classified.retryable,
      latencyMs: Date.now() - started
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type AuthSchemaResult =
  | { ok: true }
  | {
      ok: false;
      missingTables: string[];
      missingColumns: Array<{ table: string; column: string }>;
      code: ErrorCode;
      referenceId: string;
    };

/** Verifies that the Better Auth tables and critical columns exist. */
export async function checkAuthSchema(): Promise<AuthSchemaResult> {
  try {
    const client = getPool();
    const result = await client.query<{ table_name: string; column_name: string }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])`,
      [[...REQUIRED_AUTH_TABLES]]
    );

    const present = new Map<string, Set<string>>();
    for (const row of result.rows) {
      const key = row.table_name;
      if (!present.has(key)) present.set(key, new Set());
      present.get(key)!.add(row.column_name);
    }

    const missingTables: string[] = [];
    const missingColumns: Array<{ table: string; column: string }> = [];
    for (const table of REQUIRED_AUTH_TABLES) {
      const tableColumns = present.get(table);
      if (!tableColumns) {
        missingTables.push(table);
        continue;
      }
      for (const column of REQUIRED_AUTH_COLUMNS[table]) {
        if (!tableColumns.has(column)) missingColumns.push({ table, column });
      }
    }

    if (missingTables.length > 0 || missingColumns.length > 0) {
      const error = new AppError(ERROR_CODES.DATABASE_SCHEMA_ERROR, PUBLIC_MESSAGES.DATABASE_SCHEMA_ERROR, {
        operation: "database.schema",
        category: "schema",
        retryable: false,
        details: { missingTables, missingColumns: missingColumns.map((c) => `${c.table}.${c.column}`) }
      });
      logger.error("DATABASE_SCHEMA_CHECK_FAILED", {
        operation: "database.schema",
        code: error.code,
        referenceId: error.referenceId,
        missingTables,
        missingColumns: missingColumns.map((c) => `${c.table}.${c.column}`)
      });
      return { ok: false, missingTables, missingColumns, code: error.code, referenceId: error.referenceId };
    }

    return { ok: true };
  } catch (error) {
    const classified = classifyDatabaseError(error, "database.schema");
    logger.error("DATABASE_SCHEMA_CHECK_FAILED", {
      operation: "database.schema",
      code: classified.code,
      referenceId: classified.referenceId,
      ...errorDiagnostics(error)
    });
    return {
      ok: false,
      missingTables: [],
      missingColumns: [],
      code: classified.code,
      referenceId: classified.referenceId
    };
  }
}

/** Backwards-compatible boolean health check used by scripts. */
export async function checkDatabaseConnection(): Promise<boolean> {
  const result = await checkDatabaseHealth();
  return result.ok;
}

/** Pool statistics for diagnostics. Counts only; no connection details. */
export function getPoolStats(): { totalCount: number; idleCount: number; waitingCount: number; max: number } | null {
  const existing = globalForDb.__seoflowPool;
  if (!existing) return null;
  return {
    totalCount: existing.totalCount,
    idleCount: existing.idleCount,
    waitingCount: existing.waitingCount,
    max: (existing.options as PoolConfig).max ?? 0
  };
}

/** Graceful shutdown for scripts and long-running processes (never per request). */
export async function closeDatabaseConnection(): Promise<void> {
  const existing = globalForDb.__seoflowPool;
  if (!existing) return;
  globalForDb.__seoflowPool = undefined;
  globalForDb.__seoflowDb = undefined;
  try {
    await existing.end();
  } catch (error) {
    logger.error("DATABASE_POOL_CLOSE_FAILED", {
      operation: "database.pool",
      ...errorDiagnostics(error)
    });
    throw error;
  }
}
