import { describe, expect, it } from "vitest";
import { classifyAwsError } from "./errors";

describe("classifyAwsError", () => {
  it("passes through pre-classified AppErrors", () => {
    const original = classifyAwsError(new Error("boom"), "op");
    expect(classifyAwsError(original, "other")).toBe(original);
  });

  it("maps AccessDenied and 403/401 statuses to AWS_ACCESS_DENIED", () => {
    expect(classifyAwsError(Object.assign(new Error("no"), { name: "AccessDenied" }), "op").code).toBe("AWS_ACCESS_DENIED");
    expect(classifyAwsError(Object.assign(new Error("no"), { name: "ExpiredTokenException" }), "op").code).toBe("AWS_ACCESS_DENIED");
    expect(classifyAwsError(Object.assign(new Error("no"), { $metadata: { httpStatusCode: 403 } }), "op").code).toBe("AWS_ACCESS_DENIED");
  });

  it("maps throttling, 5xx and network failures to AWS_SERVICE_UNAVAILABLE (retryable)", () => {
    const throttled = classifyAwsError(Object.assign(new Error("slow down"), { name: "ThrottlingException" }), "op");
    expect(throttled.code).toBe("AWS_SERVICE_UNAVAILABLE");
    expect(throttled.retryable).toBe(true);
    const server = classifyAwsError(Object.assign(new Error("kaput"), { $metadata: { httpStatusCode: 503 } }), "op");
    expect(server.code).toBe("AWS_SERVICE_UNAVAILABLE");
    const network = classifyAwsError(new Error("connect ECONNREFUSED 10.0.0.1:443"), "op");
    expect(network.code).toBe("AWS_SERVICE_UNAVAILABLE");
  });

  it("maps 4xx validation-style failures to AWS_CONFIGURATION_ERROR", () => {
    const invalid = classifyAwsError(Object.assign(new Error("bad param"), { name: "ValidationException", $metadata: { httpStatusCode: 400 } }), "op");
    expect(invalid.code).toBe("AWS_CONFIGURATION_ERROR");
    expect(invalid.retryable).toBe(false);
  });

  it("never leaks the raw provider message into the public message", () => {
    const error = classifyAwsError(Object.assign(new Error("secret internal detail account 123456789012"), { name: "AccessDenied" }), "op");
    expect(error.message).not.toContain("123456789012");
  });
});
