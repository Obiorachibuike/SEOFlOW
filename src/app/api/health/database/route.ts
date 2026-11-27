import { NextResponse } from "next/server";
import { checkAuthSchema, checkDatabaseHealth, getPoolStats } from "@/db";
import { getEnvPresence, REQUIRED_SERVER_ENV } from "@/lib/env";
import { requireDiagnosticsAccess, DIAGNOSTICS_UNAUTHORIZED_BODY } from "@/lib/diagnostics";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Detailed database diagnostics. Restricted to super administrators or to
 * callers presenting the HEALTH_DIAGNOSTICS_KEY bearer token.
 *
 * Reports: environment-variable presence (booleans only), real query latency,
 * Better Auth table/column availability, and pool occupancy. No hosts,
 * credentials, URLs or stack traces are disclosed.
 */
export async function GET(request: Request) {
  const access = await requireDiagnosticsAccess(request);
  if (!access.ok) {
    return NextResponse.json(DIAGNOSTICS_UNAUTHORIZED_BODY, { status: 404 });
  }

  const started = Date.now();
  const health = await checkDatabaseHealth();
  const schema = health.ok ? await checkAuthSchema() : null;
  const poolStats = getPoolStats();

  const schemaOk = schema?.ok ?? false;
  const healthy = health.ok && schemaOk;

  const body = {
    status: healthy ? "ok" : "error",
    service: "SEOFlow",
    timestamp: new Date().toISOString(),
    latencyMs: Date.now() - started,
    checks: {
      environment: getEnvPresence(REQUIRED_SERVER_ENV),
      database: health.ok
        ? { ok: true, latencyMs: health.latencyMs }
        : { ok: false, code: health.code, referenceId: health.referenceId, retryable: health.retryable },
      authSchema: schema
        ? schema.ok
          ? { ok: true }
          : {
              ok: false,
              missingTables: schema.missingTables,
              missingColumns: schema.missingColumns.map((column) => `${column.table}.${column.column}`),
              code: schema.code,
              referenceId: schema.referenceId
            }
        : { ok: false, reason: "database unreachable" },
      pool: poolStats
    }
  };

  if (!healthy) {
    logger.error("DIAGNOSTICS_DATABASE_UNHEALTHY", {
      operation: "health.database",
      databaseOk: health.ok,
      schemaOk,
      ...(health.ok ? {} : { databaseCode: health.code, referenceId: health.referenceId }),
      ...(schema && !schema.ok ? { schemaCode: schema.code, schemaReferenceId: schema.referenceId } : {})
    });
    return NextResponse.json(body, { status: 503 });
  }

  return NextResponse.json(body, { status: 200 });
}
