import { describe, expect, it } from "vitest";
import { classifyAuthServerFailure } from "@/auth/diagnostics";

describe("auth server error classification", () => {
  it("classifies PostgreSQL connection errors by their source", () => {
    const error = Object.assign(new Error("connection refused"), { code: "ECONNREFUSED" });
    expect(classifyAuthServerFailure(error)).toMatchObject({ code: "AUTH_DATABASE_ERROR" });
  });

  it("recognizes wrapped email delivery failures", () => {
    const error = Object.assign(new Error("Account email delivery failed."), {
      code: "AUTH_EMAIL_DELIVERY_FAILED",
      cause: new Error("SMTP credentials are not included in the public diagnostic")
    });
    expect(classifyAuthServerFailure(error)).toMatchObject({ code: "AUTH_EMAIL_DELIVERY_FAILED" });
  });

  it("does not classify ordinary authentication rejections as server failures", () => {
    expect(classifyAuthServerFailure({
      statusCode: 401,
      body: { code: "INVALID_EMAIL_OR_PASSWORD" }
    })).toBeUndefined();
  });

  it("uses a safe fallback for unclassified server exceptions", () => {
    expect(classifyAuthServerFailure(new Error("internal implementation details"))).toMatchObject({
      code: "AUTH_SERVER_ERROR",
      message: expect.not.stringContaining("internal implementation details")
    });
  });
});
