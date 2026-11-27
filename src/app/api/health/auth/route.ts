import { NextResponse } from "next/server";
import { checkAuthSchema } from "@/db";
import { getEnvPresence, isGoogleOAuthConfigured, isSmtpConfigured } from "@/lib/env";
import { requireDiagnosticsAccess, DIAGNOSTICS_UNAUTHORIZED_BODY } from "@/lib/diagnostics";
import { resolveAppUrl } from "@/auth";
import { logger, errorDiagnostics } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Detailed authentication diagnostics. Restricted to super administrators or
 * to callers presenting the HEALTH_DIAGNOSTICS_KEY bearer token.
 *
 * Reports configuration presence (booleans only) and Better Auth table
 * availability. Never returns secret values.
 */
export async function GET(request: Request) {
  const access = await requireDiagnosticsAccess(request);
  if (!access.ok) {
    return NextResponse.json(DIAGNOSTICS_UNAUTHORIZED_BODY, { status: 404 });
  }

  const secret = process.env.BETTER_AUTH_SECRET?.trim() ?? "";
  const secretConfigured = secret.length > 0;
  const secretStrong = secret.length >= 32;

  let baseUrlValid = false;
  let baseUrlHttps = false;
  try {
    const appUrl = resolveAppUrl();
    baseUrlValid = true;
    baseUrlHttps = appUrl.startsWith("https://");
  } catch (error) {
    logger.warn("DIAGNOSTICS_AUTH_CONFIGURATION", {
      operation: "health.auth",
      reason: "app URL could not be resolved",
      ...errorDiagnostics(error)
    });
  }

  const authSchema = await checkAuthSchema();
  const schemaOk = authSchema.ok;

  const healthy = secretConfigured && secretStrong && baseUrlValid && schemaOk;

  const body = {
    status: healthy ? "ok" : "error",
    service: "SEOFlow",
    timestamp: new Date().toISOString(),
    checks: {
      secretConfigured,
      secretStrong,
      baseUrlValid,
      baseUrlHttps,
      googleOAuthConfigured: isGoogleOAuthConfigured(),
      googleOAuthPubliclyEnabled: process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true",
      smtpConfigured: isSmtpConfigured(),
      authSchema: schemaOk
        ? { ok: true }
        : {
            ok: false,
            missingTables: authSchema.missingTables,
            missingColumns: authSchema.missingColumns.map((column) => `${column.table}.${column.column}`),
            code: authSchema.code,
            referenceId: authSchema.referenceId
          },
      environment: getEnvPresence([
        "DATABASE_URL",
        "BETTER_AUTH_SECRET",
        "BETTER_AUTH_URL",
        "NEXT_PUBLIC_APP_URL",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "SMTP_HOST"
      ])
    }
  };

  if (!healthy) {
    return NextResponse.json(body, { status: 503 });
  }

  return NextResponse.json(body, { status: 200 });
}
