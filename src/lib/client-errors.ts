/**
 * Client-side helpers for rendering authentication errors safely.
 *
 * Better Auth's client returns `error` objects shaped like
 * `{ code, message, referenceId?, status, statusText }` for HTTP failures,
 * or throws for network/timeout failures. This module converts any of those
 * into a safe, user-facing message — never leaking stack traces, SQL or
 * connection details — and preserves a reference ID when the server issued
 * one.
 */

export type ClientAuthError = {
  message: string;
  referenceId?: string;
};

const REFERENCE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTERNAL_LOOKING_PATTERN =
  /(relation|column|syntax error|postgres|node-postgres|sqlstate|pg_|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|ECONNRESET|at\s+[\w.]+\s+\(|stack trace|duplicate key)/i;

function looksInternal(message: string): boolean {
  return INTERNAL_LOOKING_PATTERN.test(message) || message.length > 300;
}

export function describeAuthError(error: unknown, fallback: string): ClientAuthError {
  const shape = (error ?? {}) as {
    message?: unknown;
    code?: unknown;
    referenceId?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };

  const status =
    typeof shape.status === "number"
      ? shape.status
      : typeof shape.statusCode === "number"
        ? shape.statusCode
        : undefined;

  const serverMessage =
    typeof shape.message === "string" && shape.message.trim().length > 0 ? shape.message.trim() : null;

  let message = serverMessage ?? fallback;
  if (status !== undefined && status >= 500) {
    message = serverMessage && !looksInternal(serverMessage) ? serverMessage : fallback;
  } else if (serverMessage && looksInternal(serverMessage)) {
    message = fallback;
  }

  const referenceId =
    typeof shape.referenceId === "string" && REFERENCE_ID_PATTERN.test(shape.referenceId)
      ? shape.referenceId
      : undefined;

  return referenceId ? { message, referenceId } : { message };
}

export class TimeoutError extends Error {
  constructor(message = "The request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function isTimeoutError(error: unknown): boolean {
  return error instanceof TimeoutError || (error instanceof Error && error.name === "TimeoutError");
}

/** Race a promise against a timeout. The underlying work is not cancelled. */
export async function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new TimeoutError()), milliseconds);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const AUTH_REQUEST_TIMEOUT_MS = 20_000;
