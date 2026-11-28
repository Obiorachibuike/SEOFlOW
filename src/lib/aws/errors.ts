/**
 * Classification of AWS SDK failures into stable SEOFlow error codes.
 *
 * AWS SDK v3 errors carry a `name` (e.g. "AccessDenied", "ThrottlingException"),
 * an optional `$metadata.httpStatusCode`, and for some services a `Code`/`code`
 * field. This module normalises those into AppErrors so HTTP handlers, logs
 * and alerts never see raw provider internals.
 */

import { AppError, ERROR_CODES, PUBLIC_MESSAGES, isAppError } from "@/lib/errors";

type AwsSdkErrorShape = {
  name?: unknown;
  Code?: unknown;
  code?: unknown;
  $metadata?: { httpStatusCode?: unknown };
  message?: unknown;
};

const ACCESS_DENIED_NAMES = new Set([
  "AccessDenied",
  "AccessDeniedException",
  "AccessDeniedForColumn",
  "UnauthorizedOperation",
  "InvalidClientTokenId",
  "SignatureDoesNotMatch",
  "SignatureDoesNotMatchException",
  "ExpiredToken",
  "ExpiredTokenException",
  "ExpiredTokenExceptionCache",
  "TokenRefreshRequired",
  "NotAuthorized",
  "NotAuthorizedException",
  "AccessForbidden",
  "AuthFailure",
  "InvalidAccessKeyId"
]);

const RETRYABLE_SERVICE_NAMES = new Set([
  "ServiceUnavailable",
  "ServiceUnavailableException",
  "InternalFailure",
  "InternalError",
  "InternalServerError",
  "Throttling",
  "ThrottlingException",
  "Throttled",
  "ThrottlingExceptionWithMessage",
  "RequestExpired",
  "RequestLimitExceeded",
  "ProvisionedThroughputExceededException",
  "PriorRequestNotComplete",
  "TooManyRequestsException",
  "RequestTimeout",
  "RequestTimeoutException",
  "ConnectionClosedError",
  "NetworkingError",
  "TimeoutError",
  "EndpointConnectionError"
]);

function errorName(error: unknown): string | undefined {
  const shape = error as AwsSdkErrorShape | null | undefined;
  const candidate = shape?.name ?? shape?.Code ?? shape?.code;
  return typeof candidate === "string" ? candidate : undefined;
}

function httpStatus(error: unknown): number | undefined {
  const status = (error as AwsSdkErrorShape | null | undefined)?.$metadata?.httpStatusCode;
  return typeof status === "number" ? status : undefined;
}

function nameMatches(candidate: string | undefined, patterns: Set<string>): boolean {
  if (!candidate) return false;
  if (patterns.has(candidate)) return true;
  return [...patterns].some((pattern) => candidate.toLowerCase().includes(pattern.toLowerCase()));
}

/** Classify any thrown value from an AWS SDK call into an AppError. */
export function classifyAwsError(error: unknown, operation: string): AppError {
  if (isAppError(error)) return error;

  const name = errorName(error);
  const status = httpStatus(error);
  const message = error instanceof Error ? error.message : String(error);

  if (nameMatches(name, ACCESS_DENIED_NAMES) || status === 401 || status === 403) {
    return new AppError(ERROR_CODES.AWS_ACCESS_DENIED, PUBLIC_MESSAGES.AWS_ACCESS_DENIED, {
      operation,
      category: "permission",
      retryable: false,
      cause: error,
      details: name ? { providerError: name.slice(0, 128) } : undefined
    });
  }

  const looksThrottled = status === 429 || (typeof name === "string" && /throttl|too.?many.?requests|limit.?exceeded/i.test(name));
  const looksNetwork = /(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|socket hang up|network)/i.test(message);

  if (looksThrottled || nameMatches(name, RETRYABLE_SERVICE_NAMES) || (status !== undefined && status >= 500) || looksNetwork) {
    return new AppError(ERROR_CODES.AWS_SERVICE_UNAVAILABLE, PUBLIC_MESSAGES.AWS_SERVICE_UNAVAILABLE, {
      operation,
      category: "connection",
      retryable: true,
      cause: error,
      details: name ? { providerError: name.slice(0, 128) } : undefined
    });
  }

  // Validation-shaped provider errors (bad parameter, message rejected, invalid
  // identity) are not safely retryable and are configuration-shaped: surface
  // them as AWS_CONFIGURATION_ERROR so operators inspect the setup.
  const looksValidation =
    (status !== undefined && status >= 400 && status < 500) ||
    (typeof name === "string" && /(validation|invalid|missing|malformed|does not exist|not verified|rejected)/i.test(name));

  if (looksValidation) {
    return new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      cause: error,
      details: name ? { providerError: name.slice(0, 128) } : undefined
    });
  }

  return new AppError(ERROR_CODES.AWS_SERVICE_UNAVAILABLE, PUBLIC_MESSAGES.AWS_SERVICE_UNAVAILABLE, {
    operation,
    category: "connection",
    retryable: true,
    cause: error,
    details: name ? { providerError: name.slice(0, 128) } : undefined
  });
}
