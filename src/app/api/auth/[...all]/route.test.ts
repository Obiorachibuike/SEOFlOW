import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockHandler } = vi.hoisted(() => ({ mockHandler: vi.fn() }));

vi.mock("@/auth", () => ({
  auth: { handler: mockHandler }
}));

import { POST, GET } from "./route";

const request = (body: string) =>
  new Request("https://seoflow-rose.vercel.app/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  });

beforeEach(() => {
  mockHandler.mockReset();
});

describe("auth route wrapper", () => {
  it("passes through normal responses untouched", async () => {
    mockHandler.mockResolvedValue(Response.json({ ok: true }, { status: 200 }));
    const response = await POST(request("{}"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("converts better-auth 4xx API responses untouched (no referenceId injection)", async () => {
    mockHandler.mockResolvedValue(Response.json({ code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" }, { status: 401 }));
    const response = await POST(request("{}"));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
    expect(body.referenceId).toBeUndefined();
  });

  it("returns a structured AUTH_DATABASE_ERROR with referenceId when the database is unreachable", async () => {
    const dbError = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:5432"), { code: "ECONNREFUSED" });
    mockHandler.mockRejectedValue(dbError);
    const response = await POST(request("{}"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("AUTH_DATABASE_ERROR");
    expect(body.referenceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(body.message).not.toMatch(/ECONNREFUSED|10\.1\.2\.3|password|postgres/i);
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|10\.1\.2\.3/);
  });

  it("returns AUTH_DATABASE_ERROR when required tables are missing", async () => {
    const schemaError = Object.assign(new Error('relation "user" does not exist'), { code: "42P01" });
    mockHandler.mockRejectedValue(schemaError);
    const response = await POST(request("{}"));
    const body = await response.json();
    expect(body.code).toBe("AUTH_DATABASE_ERROR");
    expect(body.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("preserves the referenceId of pre-classified AppErrors thrown inside the handler", async () => {
    const { AppError, ERROR_CODES } = await import("@/lib/errors");
    const appError = new AppError(ERROR_CODES.DATABASE_POOL_EXHAUSTED, "pool busy", { operation: "test" });
    mockHandler.mockRejectedValue(appError);
    const response = await POST(request("{}"));
    const body = await response.json();
    // DATABASE_* errors surface with their own classification, keeping the ID
    expect(body.referenceId).toBe(appError.referenceId);
    expect(body.code).toBe("DATABASE_POOL_EXHAUSTED");
  });

  it("maps unknown unexpected errors onto INTERNAL_ERROR with a referenceId", async () => {
    mockHandler.mockRejectedValue(new Error("something weird happened"));
    const response = await POST(request("{}"));
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toMatch(/something weird/i);
  });

  it("replaces an empty better-auth 500 with a traceable payload", async () => {
    mockHandler.mockResolvedValue(new Response(null, { status: 500 }));
    const response = await POST(request("{}"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("AUTH_DATABASE_ERROR");
    expect(body.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("handles GET requests the same way", async () => {
    mockHandler.mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }));
    const response = await GET(new Request("https://seoflow-rose.vercel.app/api/auth/get-session"));
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("AUTH_DATABASE_ERROR");
  });
});
