import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockCheckDatabaseHealth, mockCheckAuthSchema, mockGetPoolStats, mockGetSession } = vi.hoisted(() => ({
  mockCheckDatabaseHealth: vi.fn(),
  mockCheckAuthSchema: vi.fn(),
  mockGetPoolStats: vi.fn(),
  mockGetSession: vi.fn()
}));

vi.mock("@/db", () => ({
  checkDatabaseHealth: mockCheckDatabaseHealth,
  checkAuthSchema: mockCheckAuthSchema,
  getPoolStats: mockGetPoolStats
}));

vi.mock("@/auth", () => ({
  auth: { api: { getSession: mockGetSession } },
  resolveAppUrl: () => "https://seoflow-rose.vercel.app"
}));

import { GET as getPublicHealth } from "./route";
import { GET as getDatabaseHealth } from "./database/route";
import { GET as getAuthHealth } from "./auth/route";

const REQUEST_URL = "https://seoflow-rose.vercel.app/api/health/database";

function authedRequest(headers: Record<string, string> = {}) {
  return new NextRequest(new Request(REQUEST_URL, { headers }));
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.HEALTH_DIAGNOSTICS_KEY;
  mockCheckDatabaseHealth.mockResolvedValue({ ok: true, latencyMs: 7 });
  mockCheckAuthSchema.mockResolvedValue({ ok: true });
  mockGetPoolStats.mockReturnValue({ totalCount: 2, idleCount: 1, waitingCount: 0, max: 3 });
  mockGetSession.mockResolvedValue(null);
});

describe("GET /api/health (public)", () => {
  it("returns minimal ok payload without infrastructure details", async () => {
    const response = await getPublicHealth();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("SEOFlow");
    expect(Object.keys(body).sort()).toEqual(["service", "status", "timestamp"]);
  });

  it("returns 503 with code and referenceId when the database is down — no internals", async () => {
    mockCheckDatabaseHealth.mockResolvedValue({
      ok: false,
      code: "DATABASE_CONNECTION_ERROR",
      referenceId: "108e9014-5cf3-4202-9b5b-9e31d0a9d620",
      retryable: true,
      latencyMs: 12
    });
    const response = await getPublicHealth();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe("DATABASE_CONNECTION_ERROR");
    expect(body.referenceId).toBe("108e9014-5cf3-4202-9b5b-9e31d0a9d620");
    expect(JSON.stringify(body)).not.toMatch(/postgres|host|password|stack/i);
  });
});

describe("GET /api/health/database (restricted)", () => {
  it("returns 404 without credentials", async () => {
    const response = await getDatabaseHealth(authedRequest());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.message).toBe("Not found.");
  });

  it("returns 404 with a wrong diagnostics key", async () => {
    process.env.HEALTH_DIAGNOSTICS_KEY = "correct-key";
    const response = await getDatabaseHealth(authedRequest({ authorization: "Bearer wrong-key" }));
    expect(response.status).toBe(404);
  });

  it("accepts the diagnostics bearer key and reports detailed checks", async () => {
    process.env.HEALTH_DIAGNOSTICS_KEY = "correct-key";
    const response = await getDatabaseHealth(authedRequest({ authorization: "Bearer correct-key" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.database.ok).toBe(true);
    expect(body.checks.authSchema.ok).toBe(true);
    expect(typeof body.checks.environment.DATABASE_URL).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("correct-key");
  });

  it("accepts a super-admin session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", platformRole: "super_admin" } });
    const response = await getDatabaseHealth(authedRequest());
    expect(response.status).toBe(200);
  });

  it("rejects a non-admin session", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1", platformRole: "user" } });
    const response = await getDatabaseHealth(authedRequest());
    expect(response.status).toBe(404);
  });

  it("returns 503 and names the missing tables when the auth schema is absent", async () => {
    process.env.HEALTH_DIAGNOSTICS_KEY = "correct-key";
    mockCheckAuthSchema.mockResolvedValue({
      ok: false,
      missingTables: ["user", "session"],
      missingColumns: [],
      code: "DATABASE_SCHEMA_ERROR",
      referenceId: "108e9014-5cf3-4202-9b5b-9e31d0a9d620"
    });
    const response = await getDatabaseHealth(authedRequest({ authorization: "Bearer correct-key" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.checks.authSchema.missingTables).toEqual(["user", "session"]);
    expect(body.checks.authSchema.referenceId).toBe("108e9014-5cf3-4202-9b5b-9e31d0a9d620");
    expect(JSON.stringify(body)).not.toMatch(/postgres:\/\/|password/i);
  });
});

describe("GET /api/health/auth (restricted)", () => {
  it("returns 404 without credentials", async () => {
    const response = await getAuthHealth(authedRequest());
    expect(response.status).toBe(404);
  });

  it("reports configuration presence without values", async () => {
    process.env.HEALTH_DIAGNOSTICS_KEY = "correct-key";
    process.env.BETTER_AUTH_SECRET = "x".repeat(48);
    process.env.BETTER_AUTH_URL = "https://seoflow-rose.vercel.app";
    const response = await getAuthHealth(authedRequest({ authorization: "Bearer correct-key" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.checks.secretConfigured).toBe(true);
    expect(body.checks.secretStrong).toBe(true);
    expect(typeof body.checks.googleOAuthConfigured).toBe("boolean");
    expect(JSON.stringify(body)).not.toContain("x".repeat(48));
    delete process.env.BETTER_AUTH_SECRET;
  });
});
