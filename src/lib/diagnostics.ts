/**
 * Access control for the detailed diagnostic endpoints.
 *
 * Detailed diagnostics are available to:
 *   1. A platform super administrator with an active session, or
 *   2. A caller presenting `Authorization: Bearer $HEALTH_DIAGNOSTICS_KEY`
 *      (a long random token configured only on the server).
 *
 * Everything else receives the same 404 response so the endpoints do not
 * reveal their own existence. No secrets, hosts, connection strings or stack
 * traces are ever returned.
 */

import { timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { logger, errorDiagnostics } from "@/lib/logger";

export type DiagnosticsAccess =
  | { ok: true; via: "session" | "key" }
  | { ok: false };

function safeEqual(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  if (candidateBuffer.length !== expectedBuffer.length) return false;
  try {
    return timingSafeEqual(candidateBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export async function requireDiagnosticsAccess(request: Request): Promise<DiagnosticsAccess> {
  const configuredKey = process.env.HEALTH_DIAGNOSTICS_KEY?.trim();
  if (configuredKey) {
    const header = request.headers.get("authorization");
    if (header?.startsWith("Bearer ")) {
      const candidate = header.slice("Bearer ".length).trim();
      if (candidate && safeEqual(candidate, configuredKey)) {
        return { ok: true, via: "key" };
      }
    }
  }

  try {
    const session = await auth.api.getSession({ headers: request.headers });
    const role = (session?.user as { platformRole?: string } | undefined)?.platformRole;
    if (session && role === "super_admin") {
      return { ok: true, via: "session" };
    }
  } catch (error) {
    logger.error("DIAGNOSTICS_SESSION_LOOKUP_FAILED", {
      operation: "diagnostics.access",
      ...errorDiagnostics(error)
    });
  }

  return { ok: false };
}

export const DIAGNOSTICS_UNAUTHORIZED_BODY = {
  status: "error",
  code: "NOT_FOUND",
  message: "Not found."
} as const;
