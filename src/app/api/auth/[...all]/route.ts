import { auth } from "@/auth";
import { randomUUID } from "node:crypto";
import {
  ERROR_CODES,
  PUBLIC_MESSAGES,
  classifyAuthError
} from "@/lib/errors";
import { logger, errorDiagnostics } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Auth.js/Better Auth request handler.
 *
 * Unexpected failures (typically database outages) are classified here and
 * returned as a stable, safe payload so clients can surface a reference ID:
 *
 *   { "code": "AUTH_DATABASE_ERROR", "referenceId": "<uuid>", "message": "..." }
 *
 * Better Auth's expected API errors (bad credentials, rate limits, validation)
 * keep their normal structured responses because they are returned — not
 * thrown — by the framework.
 */
async function handleAuthRequest(request: Request): Promise<Response> {
  const started = Date.now();
  const requestId = request.headers.get("x-request-id") ?? randomUUID();
  const method = request.method;
  const path = new URL(request.url).pathname;

  try {
    const response = await auth.handler(request);

    if (response.status >= 500) {
      // Defense in depth: Better Auth logs the root cause; we replace the
      // empty 500 with a safe, traceable payload.
      const referenceId = randomUUID();
      logger.error("AUTH_HANDLER_INTERNAL_ERROR", {
        operation: "auth.handler",
        code: ERROR_CODES.AUTH_DATABASE_ERROR,
        referenceId,
        requestId,
        method,
        path,
        status: response.status,
        latencyMs: Date.now() - started
      });
      return Response.json(
        {
          code: ERROR_CODES.AUTH_DATABASE_ERROR,
          referenceId,
          message: PUBLIC_MESSAGES.AUTH_DATABASE_ERROR
        },
        { status: 500 }
      );
    }

    return response;
  } catch (error) {
    const appError = classifyAuthError(error, "auth.handler", ERROR_CODES.INTERNAL_ERROR);
    logger.error("AUTH_REQUEST_FAILED", {
      operation: "auth.handler",
      code: appError.code,
      referenceId: appError.referenceId,
      requestId,
      method,
      path,
      statusCode: appError.statusCode,
      retryable: appError.retryable,
      latencyMs: Date.now() - started,
      ...errorDiagnostics(error)
    });

    return Response.json(
      {
        code: appError.code,
        referenceId: appError.referenceId,
        message: appError.message,
        retryable: appError.retryable
      },
      { status: appError.statusCode }
    );
  }
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}
