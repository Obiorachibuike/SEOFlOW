import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { poolInstances, MockPool } = vi.hoisted(() => {
  const poolInstances: Array<Record<string, unknown>> = [];
  class MockPool {
    static nextQueryError: Error & { code?: string } | null = null;
    static nextQueryResult: unknown = { rows: [{ "?column?": 1 }], rowCount: 1 };
    config: Record<string, unknown>;
    totalCount = 2;
    idleCount = 1;
    waitingCount = 0;
    options: Record<string, unknown>;
    handlers = new Map<string, (...args: unknown[]) => void>();
    ended = false;

    constructor(config: Record<string, unknown>) {
      this.config = config;
      this.options = config;
      poolInstances.push(this as unknown as Record<string, unknown>);
    }
    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(event, handler);
      return this;
    }
    async query(): Promise<unknown> {
      if (MockPool.nextQueryError) throw MockPool.nextQueryError;
      return MockPool.nextQueryResult;
    }
    async connect() {
      return { query: this.query.bind(this), release: vi.fn() };
    }
    async end() {
      this.ended = true;
    }
  }
  return { poolInstances, MockPool };
});

vi.mock("pg", () => ({ Pool: MockPool }));

const ORIGINAL_ENV = { ...process.env };

async function importDb() {
  vi.resetModules();
  return import("./index");
}

beforeEach(() => {
  poolInstances.length = 0;
  MockPool.nextQueryError = null;
  MockPool.nextQueryResult = { rows: [{ "?column?": 1 }], rowCount: 1 };
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
  delete process.env.DATABASE_URL;
  delete process.env.DATABASE_SSL;
  delete process.env.DATABASE_CA_CERT;
  delete process.env.PG_POOL_MAX;
  delete process.env.DATABASE_CONNECTION_TIMEOUT_MS;
  delete (globalThis as Record<string, unknown>).__seoflowPool;
  delete (globalThis as Record<string, unknown>).__seoflowDb;
});

afterEach(() => {
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv;
});

describe("resolveDatabaseConfig", () => {
  it("fails with DATABASE_CONFIGURATION_ERROR when DATABASE_URL is missing", async () => {
    const { resolveDatabaseConfig } = await importDb();
    const result = resolveDatabaseConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DATABASE_CONFIGURATION_ERROR");
      expect(result.error.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("fails with DATABASE_CONFIGURATION_ERROR when DATABASE_URL is not a URL", async () => {
    process.env.DATABASE_URL = "not-a-connection-string";
    const { resolveDatabaseConfig } = await importDb();
    const result = resolveDatabaseConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_CONFIGURATION_ERROR");
  });

  it("rejects non-PostgreSQL protocols", async () => {
    process.env.DATABASE_URL = "mysql://u:p@localhost:3306/db";
    const { resolveDatabaseConfig } = await importDb();
    const result = resolveDatabaseConfig();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DATABASE_CONFIGURATION_ERROR");
  });

  it("accepts postgres:// and postgresql:// URLs", async () => {
    for (const value of ["postgres://u:p@localhost:5432/db", "postgresql://u:p@db.internal/db?sslmode=require"]) {
      process.env.DATABASE_URL = value;
      const { resolveDatabaseConfig } = await importDb();
      expect(resolveDatabaseConfig().ok).toBe(true);
    }
  });
});

describe("buildPoolConfig / TLS resolution", () => {
  it("does not force insecure TLS in production by default", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/db";
    const { buildPoolConfig } = await importDb();
    const config = buildPoolConfig(process.env.DATABASE_URL);
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
  });

  it("leaves ssl undefined when the connection string carries sslmode (driver handles it)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/db?sslmode=require";
    const { resolveSsl } = await importDb();
    expect(resolveSsl(process.env.DATABASE_URL)).toBeUndefined();
  });

  it("honors explicit DATABASE_SSL=no-verify as an opt-in escape hatch", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_SSL = "no-verify";
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/db";
    const { resolveSsl } = await importDb();
    expect(resolveSsl(process.env.DATABASE_URL)).toEqual({ rejectUnauthorized: false });
  });

  it("honors DATABASE_SSL=disable for private-network deployments", async () => {
    process.env.DATABASE_SSL = "disable";
    const { resolveSsl } = await importDb();
    expect(resolveSsl("postgres://u:p@localhost:5432/db")).toBe(false);
  });

  it("uses DATABASE_CA_CERT for verified TLS with a private CA", async () => {
    process.env.DATABASE_CA_CERT = "-----BEGIN CERTIFICATE-----\nfake\n-----END CERTIFICATE-----";
    const { resolveSsl } = await importDb();
    expect(resolveSsl("postgres://u:p@db.internal:5432/db")).toEqual({
      ca: process.env.DATABASE_CA_CERT,
      rejectUnauthorized: true
    });
  });

  it("applies serverless-friendly pool sizing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.env.DATABASE_URL = "postgres://u:p@db.internal:5432/db";
    const { buildPoolConfig } = await importDb();
    const config = buildPoolConfig(process.env.DATABASE_URL);
    expect(config.max).toBe(3);
    expect(config.connectionTimeoutMillis).toBe(5000);
    expect(config.allowExitOnIdle).toBe(true);
  });

  it("validates PG_POOL_MAX and DATABASE_CONNECTION_TIMEOUT_MS overrides", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    process.env.PG_POOL_MAX = "7";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "2500";
    const { buildPoolConfig } = await importDb();
    const config = buildPoolConfig(process.env.DATABASE_URL);
    expect(config.max).toBe(7);
    expect(config.connectionTimeoutMillis).toBe(2500);

    process.env.PG_POOL_MAX = "999999";
    process.env.DATABASE_CONNECTION_TIMEOUT_MS = "1";
    const configClamped = buildPoolConfig(process.env.DATABASE_URL);
    expect(configClamped.max).toBe(10); // falls back to development default
    expect(configClamped.connectionTimeoutMillis).toBe(5000);
  });
});

describe("getPool", () => {
  it("throws AppError DATABASE_CONFIGURATION_ERROR (not a bare Error) when unconfigured", async () => {
    const { getPool } = await importDb();
    try {
      getPool();
      expect.unreachable("getPool should have thrown");
    } catch (error) {
      expect((error as { code?: string }).code).toBe("DATABASE_CONFIGURATION_ERROR");
      expect((error as { referenceId?: string }).referenceId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("creates exactly one shared pool per runtime", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    const { getPool } = await importDb();
    const first = getPool();
    const second = getPool();
    expect(first).toBe(second);
    expect(poolInstances).toHaveLength(1);
  });
});

describe("checkDatabaseHealth", () => {
  it("returns ok with latency when the database answers SELECT 1", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    const { checkDatabaseHealth } = await importDb();
    const result = await checkDatabaseHealth();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns DATABASE_CONNECTION_ERROR when the database is unreachable", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    MockPool.nextQueryError = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const { checkDatabaseHealth } = await importDb();
    const result = await checkDatabaseHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("DATABASE_CONNECTION_ERROR");
      expect(result.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("returns DATABASE_SCHEMA_ERROR when auth tables are missing", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    MockPool.nextQueryError = Object.assign(new Error('relation "user" does not exist'), { code: "42P01" });
    const { checkDatabaseHealth } = await importDb();
    const result = await checkDatabaseHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DATABASE_SCHEMA_ERROR");
  });

  it("never throws when the pool itself cannot be created", async () => {
    delete process.env.DATABASE_URL;
    const { checkDatabaseHealth } = await importDb();
    const result = await checkDatabaseHealth();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("DATABASE_CONFIGURATION_ERROR");
  });
});

describe("checkAuthSchema", () => {
  it("reports missing tables and columns by name", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    MockPool.nextQueryResult = {
      rows: [
        { table_name: "user", column_name: "id" },
        { table_name: "user", column_name: "name" },
        { table_name: "user", column_name: "email" }
        // everything else missing
      ],
      rowCount: 3
    };
    const { checkAuthSchema } = await importDb();
    const result = await checkAuthSchema();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingTables).toEqual(expect.arrayContaining(["session", "account", "verification"]));
      expect(result.missingColumns).toEqual(
        expect.arrayContaining([
          { table: "user", column: "email_verified" },
          { table: "user", column: "created_at" }
        ])
      );
      expect(result.code).toBe("DATABASE_SCHEMA_ERROR");
      expect(result.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it("passes when every required table and column exists", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    const { REQUIRED_AUTH_COLUMNS } = await importDb();
    MockPool.nextQueryResult = {
      rows: Object.entries(REQUIRED_AUTH_COLUMNS).flatMap(([table, columns]) =>
        columns.map((column) => ({ table_name: table, column_name: column }))
      ),
      rowCount: 24
    };
    const { checkAuthSchema } = await importDb();
    const result = await checkAuthSchema();
    expect(result.ok).toBe(true);
  });
});

describe("closeDatabaseConnection", () => {
  it("ends the shared pool and resets the singleton", async () => {
    process.env.DATABASE_URL = "postgres://u:p@localhost:5432/db";
    const { getPool, closeDatabaseConnection } = await importDb();
    const first = getPool();
    await closeDatabaseConnection();
    expect((first as unknown as { ended: boolean }).ended).toBe(true);
    const second = getPool();
    expect(second).not.toBe(first);
  });
});
