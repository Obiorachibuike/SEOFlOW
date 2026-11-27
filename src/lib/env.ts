/**
 * Environment-variable presence checks.
 *
 * Reports which variables are set (booleans and coarse metadata only). Never
 * reads or returns values, so it is safe to use in health diagnostics.
 */

export const REQUIRED_SERVER_ENV = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
  "NEXT_PUBLIC_APP_URL"
] as const;

export const OPTIONAL_SERVER_ENV = [
  "SECRETS_ENCRYPTION_KEY",
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "HEALTH_DIAGNOSTICS_KEY",
  "DATABASE_SSL",
  "DATABASE_CA_CERT",
  "LOG_LEVEL"
] as const;

export type EnvPresence = Record<string, boolean>;

export function getEnvPresence(keys: readonly string[] = [...REQUIRED_SERVER_ENV, ...OPTIONAL_SERVER_ENV]): EnvPresence {
  const presence: EnvPresence = {};
  for (const key of keys) {
    presence[key] = Boolean(process.env[key] && process.env[key]!.trim().length > 0);
  }
  return presence;
}

export function isSmtpConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim() && process.env.SMTP_PASSWORD?.trim());
}

export function isGoogleOAuthConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

export function isGoogleOAuthPubliclyEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true";
}
