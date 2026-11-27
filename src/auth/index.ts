import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { db } from "@/db";
import * as schema from "@/db/schema";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { sendAccountEmail } from "@/lib/email";
import { logger, redactString, errorDiagnostics } from "@/lib/logger";
import { AppError, ERROR_CODES, PUBLIC_MESSAGES } from "@/lib/errors";

const isProduction = process.env.NODE_ENV === "production";
const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";

/**
 * Resolve the Better Auth secret. A build-time placeholder is used only while
 * `next build` collects page data; it is never usable at runtime.
 */
function resolveSecret(): string {
  const secret = process.env.BETTER_AUTH_SECRET?.trim();
  if (secret) {
    if (isProduction && secret.length < 32) {
      logger.warn("AUTH_CONFIGURATION_WARNING", {
        operation: "auth.config",
        reason: "BETTER_AUTH_SECRET is shorter than 32 characters"
      });
    }
    return secret;
  }
  if (isProductionBuild) return "build-only-secret-never-use-this-at-runtime-32-characters";
  if (isProduction) throw new Error("BETTER_AUTH_SECRET must be set in production.");
  return "local-development-secret-change-this-before-deploying-32-characters";
}

/** Resolve and normalize the application URL (never a database connection string). */
export function resolveAppUrl(): string {
  const candidate =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    "http://localhost:3000";
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    return url.origin;
  } catch {
    throw new Error("BETTER_AUTH_URL / NEXT_PUBLIC_APP_URL must be an absolute http(s) URL.");
  }
}

function resolveTrustedOrigins(appUrl: string): string[] {
  const origins = new Set<string>([appUrl]);
  // Vercel preview deployments get their own hostname; trust it exactly.
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    try {
      origins.add(new URL(`https://${vercelUrl}`).origin);
    } catch {
      logger.warn("AUTH_CONFIGURATION_WARNING", {
        operation: "auth.config",
        reason: "VERCEL_URL is not a valid hostname"
      });
    }
  }
  return [...origins];
}

async function sendAccountEmailSafely(
  input: { to: string; subject: string; url: string; action: "verify" | "reset" | "invite" },
  operation: string
): Promise<void> {
  try {
    await sendAccountEmail(input);
  } catch (error) {
    const appError = new AppError(ERROR_CODES.EMAIL_DELIVERY_ERROR, PUBLIC_MESSAGES.EMAIL_DELIVERY_ERROR, {
      operation,
      cause: error,
      retryable: true
    });
    logger.error("AUTH_EMAIL_DELIVERY_FAILED", {
      operation,
      code: appError.code,
      referenceId: appError.referenceId,
      action: input.action,
      ...errorDiagnostics(error)
    });
    throw appError;
  }
}

export type SeoFlowDatabase = NodePgDatabase<typeof schema>;

/** Factory used by the application singleton and by integration tests. */
export function createSeoFlowAuth(database: SeoFlowDatabase) {
  const secret = resolveSecret();
  const appUrl = resolveAppUrl();
  const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

  return betterAuth({
    appName: "SEOFlow",
    baseURL: appUrl,
    secret,
    trustedOrigins: resolveTrustedOrigins(appUrl),
    database: drizzleAdapter(database, {
      provider: "pg",
      schema: { user: users, session: sessions, account: accounts, verification: verifications }
    }),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      sendResetPassword: async ({ user, url }) => {
        await sendAccountEmailSafely(
          { to: user.email, subject: "Reset your SEOFlow password", url, action: "reset" },
          "auth.password-reset-email"
        );
      }
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendAccountEmailSafely(
          { to: user.email, subject: "Verify your SEOFlow email", url, action: "verify" },
          "auth.verification-email"
        );
      }
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: process.env.GOOGLE_CLIENT_ID!.trim(),
            clientSecret: process.env.GOOGLE_CLIENT_SECRET!.trim()
          }
        }
      : {},
    advanced: {
      useSecureCookies: isProduction,
      defaultCookieAttributes: {
        sameSite: "lax",
        httpOnly: true,
        secure: isProduction
      }
    },
    // Unexpected (non-APIError) failures — for example a database outage —
    // are rethrown so the HTTP handler can classify them and return a stable
    // reference ID. Expected API errors keep Better Auth's normal responses.
    onAPIError: {
      throw: true
    },
    logger: {
      level: isProduction ? "warn" : "debug",
      log: (level, message, ...args) => {
        const target = logger.child({ component: "better-auth" });
        const fields: Record<string, unknown> = { detail: redactString(message) };
        const sanitizedArgs = args.length > 0 ? args.map((arg) =>
          typeof arg === "string" ? redactString(arg) : arg
        ) : [];
        if (sanitizedArgs.length > 0) fields.args = sanitizedArgs;
        if (level === "error") target.error("BETTER_AUTH_ERROR", fields);
        else if (level === "warn") target.warn("BETTER_AUTH_WARN", fields);
        else target.debug("BETTER_AUTH_DEBUG", fields);
      }
    }
  });
}

export const auth = createSeoFlowAuth(db);

export type Auth = typeof auth;
