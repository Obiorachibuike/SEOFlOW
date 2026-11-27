/**
 * Centralized error taxonomy, classification and public error payloads for
 * SEOFlow authentication and database operations.
 *
 * Every unexpected failure is:
 *   1. Classified into a stable error code.
 *   2. Assigned a unique reference ID (UUID).
 *   3. Logged with sanitized diagnostic context (see ./logger).
 *   4. Returned with a safe, non-sensitive public message.
 *
 * Reference IDs are generated once per failure and preserved when an error is
 * rethrown or re-wrapped, so a single ID always traces to exactly one log
 * event.
 */

import { randomUUID } from "node:crypto";

export const ERROR_CODES = {
  // Database
  DATABASE_CONFIGURATION_ERROR: "DATABASE_CONFIGURATION_ERROR",
  DATABASE_CONNECTION_ERROR: "DATABASE_CONNECTION_ERROR",
  DATABASE_CONNECTION_TIMEOUT: "DATABASE_CONNECTION_TIMEOUT",
  DATABASE_POOL_EXHAUSTED: "DATABASE_POOL_EXHAUSTED",
  DATABASE_QUERY_ERROR: "DATABASE_QUERY_ERROR",
  DATABASE_PERMISSION_ERROR: "DATABASE_PERMISSION_ERROR",
  DATABASE_SCHEMA_ERROR: "DATABASE_SCHEMA_ERROR",
  DATABASE_MIGRATION_ERROR: "DATABASE_MIGRATION_ERROR",
  // Authentication
  AUTH_CONFIGURATION_ERROR: "AUTH_CONFIGURATION_ERROR",
  AUTH_DATABASE_ERROR: "AUTH_DATABASE_ERROR",
  AUTH_SIGNUP_FAILED: "AUTH_SIGNUP_FAILED",
  AUTH_LOGIN_FAILED: "AUTH_LOGIN_FAILED",
  AUTH_SESSION_ERROR: "AUTH_SESSION_ERROR",
  AUTH_VERIFICATION_ERROR: "AUTH_VERIFICATION_ERROR",
  AUTH_PASSWORD_RESET_ERROR: "AUTH_PASSWORD_RESET_ERROR",
  AUTH_OAUTH_ERROR: "AUTH_OAUTH_ERROR",
  AUTH_INVALID_CREDENTIALS: "AUTH_INVALID_CREDENTIALS",
  AUTH_EMAIL_NOT_VERIFIED: "AUTH_EMAIL_NOT_VERIFIED",
  AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED",
  EMAIL_DELIVERY_ERROR: "EMAIL_DELIVERY_ERROR",
  // Generic
  INTERNAL_ERROR: "INTERNAL_ERROR"
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type ErrorCategory =
  | "configuration"
  | "connection"
  | "timeout"
  | "pool"
  | "query"
  | "schema"
  | "permission"
  | "authentication"
  | "internal";

export type AppErrorOptions = {
  operation?: string;
  category?: ErrorCategory;
  statusCode?: number;
  retryable?: boolean;
  cause?: unknown;
  /** Preserve an existing reference ID instead of generating a new one. */
  referenceId?: string;
  details?: Record<string, unknown>;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly referenceId: string;
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly retryable: boolean;
  readonly operation: string;
  readonly timestamp: string;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, publicMessage: string, options: AppErrorOptions = {}) {
    super(publicMessage, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.referenceId = options.referenceId ?? randomUUID();
    this.category = options.category ?? categoryForCode(code);
    this.statusCode = options.statusCode ?? statusCodeForCode(code);
    this.retryable = options.retryable ?? retryableForCode(code);
    this.operation = options.operation ?? "unknown";
    this.timestamp = new Date().toISOString();
    this.details = options.details;
  }

  get publicMessage(): string {
    return this.message;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export function createReferenceId(): string {
  return randomUUID();
}

export function getReferenceId(error: unknown): string | undefined {
  return isAppError(error) ? error.referenceId : undefined;
}

const CODE_METADATA: Record<ErrorCode, { category: ErrorCategory; statusCode: number; retryable: boolean }> = {
  DATABASE_CONFIGURATION_ERROR: { category: "configuration", statusCode: 500, retryable: false },
  DATABASE_CONNECTION_ERROR: { category: "connection", statusCode: 503, retryable: true },
  DATABASE_CONNECTION_TIMEOUT: { category: "timeout", statusCode: 503, retryable: true },
  DATABASE_POOL_EXHAUSTED: { category: "pool", statusCode: 503, retryable: true },
  DATABASE_QUERY_ERROR: { category: "query", statusCode: 500, retryable: false },
  DATABASE_PERMISSION_ERROR: { category: "permission", statusCode: 500, retryable: false },
  DATABASE_SCHEMA_ERROR: { category: "schema", statusCode: 500, retryable: false },
  DATABASE_MIGRATION_ERROR: { category: "schema", statusCode: 500, retryable: false },
  AUTH_CONFIGURATION_ERROR: { category: "configuration", statusCode: 500, retryable: false },
  AUTH_DATABASE_ERROR: { category: "query", statusCode: 500, retryable: true },
  AUTH_SIGNUP_FAILED: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_LOGIN_FAILED: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_SESSION_ERROR: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_VERIFICATION_ERROR: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_PASSWORD_RESET_ERROR: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_OAUTH_ERROR: { category: "authentication", statusCode: 500, retryable: true },
  AUTH_INVALID_CREDENTIALS: { category: "authentication", statusCode: 401, retryable: false },
  AUTH_EMAIL_NOT_VERIFIED: { category: "authentication", statusCode: 403, retryable: false },
  AUTH_RATE_LIMITED: { category: "authentication", statusCode: 429, retryable: true },
  EMAIL_DELIVERY_ERROR: { category: "authentication", statusCode: 500, retryable: true },
  INTERNAL_ERROR: { category: "internal", statusCode: 500, retryable: false }
};

function categoryForCode(code: ErrorCode): ErrorCategory {
  return CODE_METADATA[code]?.category ?? "internal";
}

function statusCodeForCode(code: ErrorCode): number {
  return CODE_METADATA[code]?.statusCode ?? 500;
}

function retryableForCode(code: ErrorCode): boolean {
  return CODE_METADATA[code]?.retryable ?? false;
}

/** Safe, public-facing messages. Never include internals. */
export const PUBLIC_MESSAGES: Record<ErrorCode, string> = {
  DATABASE_CONFIGURATION_ERROR: "The account service is not configured correctly. Please contact support and share the reference ID.",
  DATABASE_CONNECTION_ERROR: "We couldn't connect to your account database. Please try again shortly.",
  DATABASE_CONNECTION_TIMEOUT: "The account database took too long to respond. Please try again shortly.",
  DATABASE_POOL_EXHAUSTED: "The account service is busy right now. Please try again shortly.",
  DATABASE_QUERY_ERROR: "We couldn't complete the request against your account database. Please try again shortly.",
  DATABASE_PERMISSION_ERROR: "The account database rejected the request. Please contact support and share the reference ID.",
  DATABASE_SCHEMA_ERROR: "The account database is missing required updates. Please contact an administrator and share the reference ID.",
  DATABASE_MIGRATION_ERROR: "The account database could not be upgraded automatically. Please contact an administrator and share the reference ID.",
  AUTH_CONFIGURATION_ERROR: "The sign-in service is not configured correctly. Please contact support and share the reference ID.",
  AUTH_DATABASE_ERROR: "We couldn't connect to your account database. Please try again shortly.",
  AUTH_SIGNUP_FAILED: "We couldn't create your account. Please try again shortly.",
  AUTH_LOGIN_FAILED: "We couldn't sign you in. Please try again shortly.",
  AUTH_SESSION_ERROR: "We couldn't verify your session. Please sign in again.",
  AUTH_VERIFICATION_ERROR: "We couldn't verify your email address. Please request a new verification link.",
  AUTH_PASSWORD_RESET_ERROR: "We couldn't process your password reset. Please try again shortly.",
  AUTH_OAUTH_ERROR: "Google sign-in is unavailable right now. Please try again shortly.",
  AUTH_INVALID_CREDENTIALS: "The email or password you entered is incorrect.",
  AUTH_EMAIL_NOT_VERIFIED: "Please verify your email address before signing in. Check your inbox for the verification link.",
  AUTH_RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  EMAIL_DELIVERY_ERROR: "We couldn't send the email. Please try again shortly.",
  INTERNAL_ERROR: "An unexpected error occurred. Please try again shortly, and contact support with the reference ID if the problem continues."
};

/** PostgreSQL SQLSTATE (XX000-XX999 / class-based) and common driver codes. */
const PG_CONNECTION_CODES = new Set([
  "08000", "08001", "08003", "08004", "08006", "08007", "08P01",
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "EPIPE", "ENETUNREACH", "EHOSTUNREACH",
  "57P01", "57P02", "57P03"
]);
const PG_CONFIGURATION_CODES = new Set(["3D000"]); // database does not exist
const PG_TIMEOUT_CODES = new Set(["ETIMEDOUT", "CONNECT_TIMEOUT", "57014"]);
const PG_POOL_CODES = new Set(["53300", "53400"]);
const PG_PERMISSION_CODES = new Set(["28000", "28P01", "42501"]);
const PG_SCHEMA_CODES = new Set([
  "3F000", "42P01", "42P02", "42703", "42704", "42883", "42809", "42P07", "42P10"
]);

function pgSqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

function looksLikeTimeout(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(timeout|timed out|etimedout)/i.test(message);
}

function looksLikeMissingTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /(relation .* does not exist|table .* does not exist|column .* does not exist|does not exist)/i.test(message);
}

function looksLikeSchemaMismatch(error: unknown): boolean {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  if (typeof name === "string" && /schemamismatch/i.test(name)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(schema.*mismatch|unexpected-required-column|missing-table|missing-column)/i.test(message);
}

export function isDatabaseError(error: unknown): boolean {
  if (isAppError(error)) return error.code.startsWith("DATABASE_");
  const code = pgSqlState(error);
  if (code) {
    return (
      PG_CONNECTION_CODES.has(code) ||
      PG_TIMEOUT_CODES.has(code) ||
      PG_POOL_CODES.has(code) ||
      PG_PERMISSION_CODES.has(code) ||
      PG_SCHEMA_CODES.has(code) ||
      /^(08|57)/.test(code) ||
      /^23/.test(code) ||
      /^22/.test(code)
    );
  }
  return looksLikeTimeout(error) || looksLikeMissingTable(error) || looksLikeSchemaMismatch(error);
}

/** Classify any thrown value into a stable database-related AppError. */
export function classifyDatabaseError(error: unknown, operation = "database"): AppError {
  if (isAppError(error)) return error;

  const code = pgSqlState(error);
  const cause = error;

  if (looksLikeSchemaMismatch(error)) {
    return new AppError(ERROR_CODES.DATABASE_SCHEMA_ERROR, PUBLIC_MESSAGES.DATABASE_SCHEMA_ERROR, {
      operation, cause, category: "schema", retryable: false
    });
  }
  if ((code && PG_TIMEOUT_CODES.has(code)) || looksLikeTimeout(error)) {
    return new AppError(ERROR_CODES.DATABASE_CONNECTION_TIMEOUT, PUBLIC_MESSAGES.DATABASE_CONNECTION_TIMEOUT, {
      operation, cause, category: "timeout", retryable: true
    });
  }
  if (code && PG_POOL_CODES.has(code)) {
    return new AppError(ERROR_CODES.DATABASE_POOL_EXHAUSTED, PUBLIC_MESSAGES.DATABASE_POOL_EXHAUSTED, {
      operation, cause, category: "pool", retryable: true
    });
  }
  if (code && PG_PERMISSION_CODES.has(code)) {
    return new AppError(ERROR_CODES.DATABASE_PERMISSION_ERROR, PUBLIC_MESSAGES.DATABASE_PERMISSION_ERROR, {
      operation, cause, category: "permission", retryable: false
    });
  }
  if (code && PG_CONFIGURATION_CODES.has(code)) {
    return new AppError(ERROR_CODES.DATABASE_CONFIGURATION_ERROR, PUBLIC_MESSAGES.DATABASE_CONFIGURATION_ERROR, {
      operation, cause, category: "configuration", retryable: false
    });
  }
  if ((code && PG_SCHEMA_CODES.has(code)) || looksLikeMissingTable(error)) {
    return new AppError(ERROR_CODES.DATABASE_SCHEMA_ERROR, PUBLIC_MESSAGES.DATABASE_SCHEMA_ERROR, {
      operation, cause, category: "schema", retryable: false
    });
  }
  if (code && PG_CONNECTION_CODES.has(code)) {
    return new AppError(ERROR_CODES.DATABASE_CONNECTION_ERROR, PUBLIC_MESSAGES.DATABASE_CONNECTION_ERROR, {
      operation, cause, category: "connection", retryable: true
    });
  }
  // Fall back to query error: the pool was usable but the operation failed.
  return new AppError(ERROR_CODES.DATABASE_QUERY_ERROR, PUBLIC_MESSAGES.DATABASE_QUERY_ERROR, {
    operation, cause, category: "query", retryable: false
  });
}

/**
 * Classify any thrown value into an AppError for an authentication operation.
 * Database-looking failures map onto AUTH_DATABASE_ERROR (keeping the
 * underlying classification available via `cause`); everything else maps onto
 * the provided fallback code.
 */
export function classifyAuthError(error: unknown, operation: string, fallback: ErrorCode = ERROR_CODES.AUTH_DATABASE_ERROR): AppError {
  if (isAppError(error)) {
    // Preserve the original reference ID; re-wrap only if the code is not auth-scoped.
    if (error.code.startsWith("DATABASE_") && fallback === ERROR_CODES.AUTH_DATABASE_ERROR) {
      return new AppError(ERROR_CODES.AUTH_DATABASE_ERROR, PUBLIC_MESSAGES.AUTH_DATABASE_ERROR, {
        operation,
        cause: error,
        category: "query",
        retryable: true,
        referenceId: error.referenceId
      });
    }
    return error;
  }
  if (isDatabaseError(error)) {
    const dbError = classifyDatabaseError(error, operation);
    return new AppError(ERROR_CODES.AUTH_DATABASE_ERROR, PUBLIC_MESSAGES.AUTH_DATABASE_ERROR, {
      operation,
      cause: dbError,
      category: "query",
      retryable: true,
      referenceId: dbError.referenceId
    });
  }
  return new AppError(fallback, PUBLIC_MESSAGES[fallback], { operation, cause: error });
}

/** Generic classifier used by HTTP handlers and the auth route wrapper. */
export function classifyError(error: unknown, operation: string): AppError {
  if (isAppError(error)) return error;
  if (isDatabaseError(error)) return classifyDatabaseError(error, operation);
  return new AppError(ERROR_CODES.INTERNAL_ERROR, PUBLIC_MESSAGES.INTERNAL_ERROR, {
    operation,
    cause: error
  });
}

export type PublicErrorPayload = {
  code: ErrorCode;
  referenceId: string;
  category: ErrorCategory;
  message: string;
  timestamp: string;
  retryable: boolean;
  operation: string;
};

/** Build the safe, client-facing payload. Never leaks internals. */
export function toPublicError(error: unknown, operation?: string): PublicErrorPayload {
  const appError = classifyError(error, operation ?? "error");
  return {
    code: appError.code,
    referenceId: appError.referenceId,
    category: appError.category,
    message: appError.message,
    timestamp: appError.timestamp,
    retryable: appError.retryable,
    operation: appError.operation
  };
}
