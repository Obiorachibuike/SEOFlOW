import { AsyncLocalStorage } from "node:async_hooks";
import { getAuthErrorMessage } from "@/lib/auth-errors";

export type AuthServerFailureCode =
  | "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED"
  | "AUTH_EMAIL_DELIVERY_FAILED"
  | "AUTH_DATABASE_ERROR"
  | "AUTH_SERVER_ERROR";

export type AuthServerFailure = {
  code: AuthServerFailureCode;
  message: string;
};

export type AuthRequestDiagnosticContext = {
  requestId: string;
  operation: string;
  failure?: AuthServerFailure;
  failureLogged?: boolean;
};

export const authRequestDiagnosticContext = new AsyncLocalStorage<AuthRequestDiagnosticContext>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = [];
  const visited = new Set<unknown>();
  let current: unknown = error;

  while (isRecord(current) && !visited.has(current) && chain.length < 6) {
    visited.add(current);
    chain.push(current);
    current = current.cause;
  }

  return chain;
}

function findAuthEmailCode(chain: Record<string, unknown>[]): AuthServerFailureCode | undefined {
  for (const item of chain) {
    if (item.code === "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED" || item.code === "AUTH_EMAIL_DELIVERY_FAILED") {
      return item.code;
    }
  }
  return undefined;
}

function isDatabaseFailure(chain: Record<string, unknown>[]): boolean {
  const postgresState = /^(?:08|28|3D|42|53|54|55|57P|58|XX)[A-Z0-9]{3}$/i;
  const socketCodes = /^(?:ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|EPIPE)$/;
  const databaseMessage = /postgres|postgresql|database|drizzle|relation .* does not exist|column .* does not exist|connection (?:refused|timed out|terminated)/i;

  return chain.some((item) => {
    const code = typeof item.code === "string" ? item.code : "";
    const message = typeof item.message === "string" ? item.message : "";
    return postgresState.test(code) || socketCodes.test(code) || databaseMessage.test(message);
  });
}

function getStatusCode(chain: Record<string, unknown>[]): number | undefined {
  for (const item of chain) {
    if (typeof item.statusCode === "number") return item.statusCode;
    if (typeof item.status === "number") return item.status;
  }
  return undefined;
}

export function classifyAuthServerFailure(error: unknown): AuthServerFailure | undefined {
  const chain = errorChain(error);
  const statusCode = getStatusCode(chain);
  if (statusCode !== undefined && statusCode < 500) return undefined;

  const code = findAuthEmailCode(chain)
    ?? (isDatabaseFailure(chain) ? "AUTH_DATABASE_ERROR" : "AUTH_SERVER_ERROR");
  return { code, message: getAuthErrorMessage(code) };
}

export function recordAuthDiagnosticFailure(failure: AuthServerFailure): void {
  const context = authRequestDiagnosticContext.getStore();
  if (context) context.failure = failure;

  if (context?.failureLogged) return;
  if (context) context.failureLogged = true;

  console.error(JSON.stringify({
    event: "seoflow_auth_failure",
    requestId: context?.requestId ?? null,
    operation: context?.operation ?? "auth",
    code: failure.code
  }));
}

export function recordAuthServerFailure(error: unknown): AuthServerFailure | undefined {
  const failure = classifyAuthServerFailure(error);
  if (failure) recordAuthDiagnosticFailure(failure);
  return failure;
}
