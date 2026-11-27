import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLogger, errorDiagnostics, redactString, sanitizeForLog, logger } from "./logger";

function captureStdout() {
  const lines: string[] = [];
  const write = vi.spyOn(process.stdout, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stdout.write);
  return { lines, restore: () => write.mockRestore() };
}

function captureStderr() {
  const lines: string[] = [];
  const write = vi.spyOn(process.stderr, "write").mockImplementation(((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
  return { lines, restore: () => write.mockRestore() };
}

describe("logger redaction", () => {
  let out: ReturnType<typeof captureStdout>;
  let err: ReturnType<typeof captureStderr>;

  beforeEach(() => {
    out = captureStdout();
    err = captureStderr();
  });

  afterEach(() => {
    out.restore();
    err.restore();
  });

  it("redacts passwords, tokens, secrets and cookies by key name", () => {
    logger.error("TEST_EVENT", {
      password: "hunter2",
      accessToken: "abc123",
      nested: { clientSecret: "shh", userAgent: "keep" },
      authorization: "Bearer xyz",
      cookie: "session=secret-cookie"
    });
    const line = err.lines.join("");
    expect(line).not.toContain("hunter2");
    expect(line).not.toContain("abc123");
    expect(line).not.toContain("shh");
    expect(line).not.toContain("secret-cookie");
    expect(line).toContain("[redacted]");
    expect(line).toContain("keep");
  });

  it("redacts connection strings and bearer tokens inside free-text values", () => {
    expect(redactString("failed for postgres://app:super-secret@db.internal:5432/seoflow?sslmode=require")).not.toContain("super-secret");
    expect(redactString("Authorization: Bearer verysecrettoken")).not.toContain("verysecrettoken");
    expect(redactString("contact ops@example.com please")).not.toContain("ops@example.com");
  });

  it("redacts connection strings embedded in logged Error messages", () => {
    logger.error("TEST_EVENT", { error: new Error("connect failed for postgres://u:p@host:5432/db") });
    expect(err.lines.join("")).not.toContain("u:p@");
  });

  it("never throws on circular structures or bigints", () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    expect(() => logger.info("CIRCULAR_EVENT", circular)).not.toThrow();
    expect(() => logger.info("BIGINT_EVENT", { n: BigInt(42) })).not.toThrow();
    expect(out.lines.join("")).toContain("[circular]");
    expect(out.lines.join("")).toContain("42");
  });

  it("emits structured JSON with severity, timestamp, event and environment", () => {
    logger.warn("STRUCT_EVENT", { extra: "value" });
    const line = out.lines.find((entry) => entry.includes("STRUCT_EVENT"));
    expect(line).toBeTruthy();
    const parsed = JSON.parse(line!);
    expect(parsed.severity).toBe("WARN");
    expect(parsed.event).toBe("STRUCT_EVENT");
    expect(parsed.service).toBe("seoflow");
    expect(typeof parsed.timestamp).toBe("string");
    expect(parsed.extra).toBe("value");
  });

  it("createLogger binds child context", () => {
    const child = createLogger({ component: "test" }).child({ requestId: "req-1" });
    child.info("CHILD_EVENT");
    const line = out.lines.find((entry) => entry.includes("CHILD_EVENT"))!;
    const parsed = JSON.parse(line);
    expect(parsed.component).toBe("test");
    expect(parsed.requestId).toBe("req-1");
  });

  it("sanitizeForLog tolerates null, undefined and primitives", () => {
    expect(sanitizeForLog(null)).toBeNull();
    expect(sanitizeForLog(undefined)).toBeNull();
    expect(sanitizeForLog("plain")).toBe("plain");
    expect(sanitizeForLog(123)).toBe(123);
  });
});

describe("errorDiagnostics", () => {
  it("extracts pg diagnostics and sanitizes messages", () => {
    const pgError = Object.assign(new Error("connect ECONNREFUSED postgres://u:p@h/db"), {
      code: "ECONNREFUSED",
      severity: "ERROR",
      routine: "connect"
    });
    const diagnostics = errorDiagnostics(pgError);
    expect(diagnostics.pgCode).toBe("ECONNREFUSED");
    expect(diagnostics.pgSeverity).toBe("ERROR");
    expect(diagnostics.pgRoutine).toBe("connect");
    expect(String(diagnostics.errorMessage)).not.toContain("u:p@");
  });

  it("handles non-Error throwables", () => {
    const diagnostics = errorDiagnostics("string failure");
    expect(diagnostics.errorName).toBe("UnknownError");
  });
});
