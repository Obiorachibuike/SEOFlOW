import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "@/db";
import { accounts, sessions, users, verifications } from "@/db/schema";
import { recordAuthServerFailure } from "@/auth/diagnostics";
import { sendAccountEmail } from "@/lib/email";

const isProductionBuild = process.env.NEXT_PHASE === "phase-production-build";
const secret = process.env.BETTER_AUTH_SECRET?.trim() || (isProductionBuild
  ? "build-only-secret-never-use-this-at-runtime-32-characters"
  : process.env.NODE_ENV === "production"
    ? undefined
    : "local-development-secret-change-this-before-deploying-32-characters");

if (!secret) throw new Error("BETTER_AUTH_SECRET must be set in production.");

const appUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  appName: "SEOFlow",
  baseURL: appUrl,
  secret,
  trustedOrigins: [appUrl],
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user: users, session: sessions, account: accounts, verification: verifications }
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      await sendAccountEmail({ to: user.email, subject: "Reset your SEOFlow password", url, action: "reset" });
    }
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      await sendAccountEmail({ to: user.email, subject: "Verify your SEOFlow email", url, action: "verify" });
    }
  },
  socialProviders: googleEnabled ? {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!
    }
  } : {},
  onAPIError: {
    onError(error) {
      recordAuthServerFailure(error);
    }
  },
  advanced: {
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: {
      sameSite: "lax",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production"
    }
  }
});
