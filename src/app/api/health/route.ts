import { NextResponse } from "next/server";
import { checkDatabaseHealth } from "@/db";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Public, minimal health signal. No infrastructure details are disclosed.
 */
export async function GET() {
  const health = await checkDatabaseHealth();

  if (!health.ok) {
    logger.error("HEALTH_CHECK_FAILED", {
      operation: "health.public",
      code: health.code,
      referenceId: health.referenceId,
      latencyMs: health.latencyMs
    });
    return NextResponse.json(
      {
        status: "error",
        code: health.code,
        referenceId: health.referenceId,
        message: "Database service is temporarily unavailable."
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { status: "ok", service: "SEOFlow", timestamp: new Date().toISOString() },
    { status: 200 }
  );
}
