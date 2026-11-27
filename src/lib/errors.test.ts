import { describe, expect, it } from "vitest";
import {
  AppError,
  ERROR_CODES,
  PUBLIC_MESSAGES,
  classifyAuthError,
  classifyDatabaseError,
  classifyError,
  getReferenceId,
  isAppError,
  isDatabaseError,
  toPublicError
} from "./errors";

const pgError = (code: string, message = "pg error") => Object.assign(new Error(message), { code });

describe("classifyDatabaseError", () => {
  it("classifies connection refusal as DATABASE_CONNECTION_ERROR, retryable", () => {
    const error = classifyDatabaseError(pgError("ECONNREFUSED", "connect ECONNREFUSED 10.0.0.1:5432"), "test.op");
    expect(error.code).toBe(ERROR_CODES.DATABASE_CONNECTION_ERROR);
    expect(error.retryable).toBe(true);
    expect(error.operation).toBe("test.op");
    expect(error.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("classifies SQLSTATE 08xxx connection failures as DATABASE_CONNECTION_ERROR", () => {
    for (const code of ["08000", "08006", "08P01", "57P03", "ENOTFOUND", "EAI_AGAIN"]) {
      expect(classifyDatabaseError(pgError(code)).code).toBe(ERROR_CODES.DATABASE_CONNECTION_ERROR);
    }
  });

  it("classifies timeouts as DATABASE_CONNECTION_TIMEOUT", () => {
    expect(classifyDatabaseError(pgError("ETIMEDOUT")).code).toBe(ERROR_CODES.DATABASE_CONNECTION_TIMEOUT);
    expect(classifyDatabaseError(pgError("57014")).code).toBe(ERROR_CODES.DATABASE_CONNECTION_TIMEOUT);
    expect(classifyDatabaseError(new Error("Connection timed out")).code).toBe(ERROR_CODES.DATABASE_CONNECTION_TIMEOUT);
  });

  it("classifies too_many_connections as DATABASE_POOL_EXHAUSTED", () => {
    expect(classifyDatabaseError(pgError("53300")).code).toBe(ERROR_CODES.DATABASE_POOL_EXHAUSTED);
    expect(classifyDatabaseError(pgError("53400")).code).toBe(ERROR_CODES.DATABASE_POOL_EXHAUSTED);
  });

  it("classifies authentication/permission SQLSTATEs as DATABASE_PERMISSION_ERROR", () => {
    for (const code of ["28000", "28P01", "42501"]) {
      expect(classifyDatabaseError(pgError(code)).code).toBe(ERROR_CODES.DATABASE_PERMISSION_ERROR);
    }
  });

  it("classifies missing database as DATABASE_CONFIGURATION_ERROR", () => {
    expect(classifyDatabaseError(pgError("3D000")).code).toBe(ERROR_CODES.DATABASE_CONFIGURATION_ERROR);
  });

  it("classifies missing tables/columns as DATABASE_SCHEMA_ERROR", () => {
    expect(classifyDatabaseError(pgError("42P01", 'relation "user" does not exist')).code).toBe(ERROR_CODES.DATABASE_SCHEMA_ERROR);
    expect(classifyDatabaseError(pgError("42703")).code).toBe(ERROR_CODES.DATABASE_SCHEMA_ERROR);
    expect(classifyDatabaseError(new Error('relation "session" does not exist')).code).toBe(ERROR_CODES.DATABASE_SCHEMA_ERROR);
  });

  it("classifies Better Auth SchemaMismatchError as DATABASE_SCHEMA_ERROR", () => {
    const mismatch = Object.assign(new Error("Schema mismatch"), { name: "SchemaMismatchError" });
    expect(classifyDatabaseError(mismatch).code).toBe(ERROR_CODES.DATABASE_SCHEMA_ERROR);
  });

  it("classifies other SQLSTATEs as DATABASE_QUERY_ERROR", () => {
    expect(classifyDatabaseError(pgError("23505")).code).toBe(ERROR_CODES.DATABASE_QUERY_ERROR);
    expect(classifyDatabaseError(pgError("22P02")).code).toBe(ERROR_CODES.DATABASE_QUERY_ERROR);
  });

  it("preserves reference IDs of pre-classified AppErrors instead of generating new ones", () => {
    const original = classifyDatabaseError(pgError("ECONNREFUSED"), "op");
    const again = classifyDatabaseError(original, "other-op");
    expect(again).toBe(original);
    expect(again.referenceId).toBe(original.referenceId);
  });
});

describe("classifyAuthError", () => {
  it("maps database failures during auth onto AUTH_DATABASE_ERROR preserving the reference ID", () => {
    const raw = pgError("ECONNREFUSED");
    const wrapped = classifyAuthError(raw, "auth.signin");
    expect(wrapped.code).toBe(ERROR_CODES.AUTH_DATABASE_ERROR);
    expect(wrapped.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("re-wraps DATABASE_* AppErrors thrown inside auth as AUTH_DATABASE_ERROR with the same reference ID", () => {
    const dbError = classifyDatabaseError(pgError("42P01"), "db.op");
    const wrapped = classifyAuthError(dbError, "auth.handler", ERROR_CODES.AUTH_DATABASE_ERROR);
    expect(wrapped.code).toBe(ERROR_CODES.AUTH_DATABASE_ERROR);
    expect(wrapped.referenceId).toBe(dbError.referenceId);
  });

  it("keeps non-database AppErrors untouched", () => {
    const emailError = new AppError(ERROR_CODES.EMAIL_DELIVERY_ERROR, "nope", { operation: "auth.email" });
    expect(classifyAuthError(emailError, "auth.handler")).toBe(emailError);
  });

  it("maps unknown non-database failures onto the provided fallback code", () => {
    expect(classifyAuthError(new Error("boom"), "auth.handler", ERROR_CODES.INTERNAL_ERROR).code).toBe(ERROR_CODES.INTERNAL_ERROR);
    expect(classifyAuthError(new Error("boom"), "auth.session", ERROR_CODES.AUTH_SESSION_ERROR).code).toBe(ERROR_CODES.AUTH_SESSION_ERROR);
  });
});

describe("classifyError / toPublicError", () => {
  it("returns AppError instances unchanged", () => {
    const original = new AppError(ERROR_CODES.DATABASE_CONNECTION_ERROR, "public", { operation: "x" });
    expect(classifyError(original, "y")).toBe(original);
  });

  it("produces a public payload without internals", () => {
    const payload = toPublicError(pgError("42P01", 'relation "user" does not exist'), "db.test");
    expect(payload.code).toBe(ERROR_CODES.DATABASE_SCHEMA_ERROR);
    expect(payload.referenceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(payload)).not.toMatch(/user|relation|sql/i);
  });

  it("never emits SQL or connection strings in public messages", () => {
    for (const code of Object.values(ERROR_CODES)) {
      const message = PUBLIC_MESSAGES[code];
      expect(message).not.toMatch(/postgres:\/\/|postgresql:\/\/|\bSELECT\b|\bINSERT\b|\bDROP\b|secret/i);
    }
  });

  it("assigns unique reference IDs to distinct failures", () => {
    const ids = new Set(
      Array.from({ length: 32 }, () =>
        toPublicError(pgError("ECONNREFUSED"), "op").referenceId
      )
    );
    expect(ids.size).toBe(32);
  });
});

describe("isDatabaseError", () => {
  it("recognises driver codes and messages", () => {
    expect(isDatabaseError(pgError("ECONNREFUSED"))).toBe(true);
    expect(isDatabaseError(pgError("23505"))).toBe(true);
    expect(isDatabaseError(new Error("Connection timed out"))).toBe(true);
    expect(isDatabaseError(new Error("some unrelated failure"))).toBe(false);
  });

  it("exposes reference IDs only from AppErrors", () => {
    expect(getReferenceId(new Error("x"))).toBeUndefined();
    expect(getReferenceId(new AppError(ERROR_CODES.INTERNAL_ERROR, "x"))).toMatch(/^[0-9a-f-]{36}$/);
    expect(isAppError(new AppError(ERROR_CODES.INTERNAL_ERROR, "x"))).toBe(true);
  });
});
