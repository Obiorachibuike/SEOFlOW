import { randomUUID } from "node:crypto";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/auth";
import {
  authRequestDiagnosticContext,
  recordAuthDiagnosticFailure,
  recordAuthServerFailure,
  type AuthRequestDiagnosticContext,
  type AuthServerFailure
} from "@/auth/diagnostics";
import { isAccountEmailConfigured } from "@/lib/email";
import { getAuthErrorMessage } from "@/lib/auth-errors";

export const runtime = "nodejs";

const handlers = toNextJsHandler(auth);
const EMAIL_NOT_VERIFIED_CODE = "EMAIL_NOT_VERIFIED";
const EMAIL_DELIVERY_NOT_CONFIGURED = "AUTH_EMAIL_DELIVERY_NOT_CONFIGURED";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmailSendingEndpoint(pathname: string, method: string): boolean {
  return method === "POST" && (
    pathname.endsWith("/sign-up/email") ||
    pathname.endsWith("/send-verification-email")
  );
}

function failureResponse(failure: AuthServerFailure, requestId: string, status: number): Response {
  return Response.json({
    message: failure.message,
    code: failure.code,
    requestId
  }, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-seoflow-auth-request-id": requestId
    }
  });
}

async function addDiagnosticReference(response: Response, requestId: string): Promise<Response> {
  const headers = new Headers(response.headers);
  headers.set("x-seoflow-auth-request-id", requestId);
  headers.set("cache-control", "no-store");

  const payload = await response.clone().json().catch(() => undefined);
  if (isRecord(payload)) {
    return new Response(JSON.stringify({ ...payload, requestId }), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function handleAuthRequest(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const pathname = new URL(request.url).pathname;
  const operation = `${request.method} ${pathname}`;
  const context: AuthRequestDiagnosticContext = { requestId, operation };

  return authRequestDiagnosticContext.run(context, async () => {
    const productionEmailUnavailable = process.env.NODE_ENV === "production" && !isAccountEmailConfigured();
    if (productionEmailUnavailable && isEmailSendingEndpoint(pathname, request.method)) {
      const failure: AuthServerFailure = {
        code: EMAIL_DELIVERY_NOT_CONFIGURED,
        message: getAuthErrorMessage(EMAIL_DELIVERY_NOT_CONFIGURED)
      };
      recordAuthDiagnosticFailure(failure);
      return failureResponse(failure, requestId, 503);
    }

    let response: Response;
    try {
      response = request.method === "GET"
        ? await handlers.GET(request)
        : await handlers.POST(request);
    } catch (error) {
      const failure = recordAuthServerFailure(error) ?? {
        code: "AUTH_SERVER_ERROR" as const,
        message: getAuthErrorMessage("AUTH_SERVER_ERROR")
      };
      if (!context.failureLogged) recordAuthDiagnosticFailure(failure);
      return failureResponse(failure, requestId, 500);
    }

    if (response.status >= 500) {
      const failure = context.failure ?? {
        code: "AUTH_SERVER_ERROR" as const,
        message: getAuthErrorMessage("AUTH_SERVER_ERROR")
      };
      if (!context.failureLogged) recordAuthDiagnosticFailure(failure);
      return failureResponse(failure, requestId, response.status);
    }

    if (request.method === "POST" && pathname.endsWith("/sign-in/email") && productionEmailUnavailable && !response.ok) {
      const payload = await response.clone().json().catch(() => undefined);
      if (isRecord(payload) && payload.code === EMAIL_NOT_VERIFIED_CODE) {
        const failure: AuthServerFailure = {
          code: EMAIL_DELIVERY_NOT_CONFIGURED,
          message: getAuthErrorMessage(EMAIL_DELIVERY_NOT_CONFIGURED)
        };
        recordAuthDiagnosticFailure(failure);
        return failureResponse(failure, requestId, 503);
      }
    }

    if (isEmailSendingEndpoint(pathname, request.method) && context.failure) {
      return failureResponse(context.failure, requestId, 503);
    }

    return response.ok ? response : addDiagnosticReference(response, requestId);
  });
}

export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
