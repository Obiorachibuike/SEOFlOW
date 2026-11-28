/**
 * Shared AWS configuration and credential resolution for SEOFlow.
 *
 * Two credential strategies are supported, in order of preference:
 *
 * 1. **Vercel AWS integration (role-based, recommended).** The Vercel AWS
 *    integration provisions an AWS IAM role that trusts Vercel's OIDC issuer
 *    and injects `AWS_ROLE_ARN`, `AWS_ACCOUNT_ID`, `AWS_REGION`,
 *    `AWS_RESOURCE_ARN` and `S3_BUCKET_NAME` as sensitive env vars. Vercel
 *    also injects a per-deployment OIDC token as `VERCEL_OIDC_TOKEN`. The app
 *    exchanges it for temporary credentials with STS
 *    AssumeRoleWithWebIdentity. Temporary credentials are cached in-process
 *    until shortly before expiry and are never logged.
 *
 * 2. **Static credentials (S3-compatible stores, MinIO, explicit keys).**
 *    `S3_ACCESS_KEY_ID` + `S3_SECRET_ACCESS_KEY`, optionally with a custom
 *    `S3_ENDPOINT`. Suitable for non-AWS S3-compatible object stores and
 *    environments without the Vercel integration.
 *
 * Neither strategy involves Cognito, Amplify, RDS or Lambda. When no
 * credentials are configured, callers receive `null` (feature disabled) —
 * never placeholder credentials and never a silent fallback to a different
 * provider.
 */

import { STSClient, AssumeRoleWithWebIdentityCommand } from "@aws-sdk/client-sts";
import { AppError, ERROR_CODES, PUBLIC_MESSAGES } from "@/lib/errors";
import { classifyAwsError } from "./errors";

export type AwsCredentials = {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
};

export type AwsCredentialStrategy = "vercel-oidc-role" | "static" | "none";

const REGION_PATTERN = /^[a-z0-9-]{1,64}$/i;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const ROLE_ARN_PATTERN = /^arn:aws:iam::\d{12}:role\/[\w+=,.@\-/]{1,512}$/;
const ACCOUNT_ID_PATTERN = /^\d{12}$/;

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/** Resolve the AWS region (`AWS_REGION` from the Vercel integration, else `S3_REGION`). */
export function resolveAwsRegion(): string | null {
  const raw = clean(process.env.AWS_REGION) ?? clean(process.env.S3_REGION);
  if (!raw) return null;
  if (!REGION_PATTERN.test(raw)) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation: "aws.config",
      category: "configuration",
      retryable: false,
      details: { reason: "region is not a valid AWS region name" }
    });
  }
  return raw;
}

/** Resolve the S3 bucket (`S3_BUCKET_NAME` from the Vercel integration, else `S3_BUCKET`). */
export function resolveS3BucketName(): string | null {
  const raw = clean(process.env.S3_BUCKET_NAME) ?? clean(process.env.S3_BUCKET);
  if (!raw) return null;
  if (!BUCKET_PATTERN.test(raw) || raw.includes("..")) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation: "aws.config",
      category: "configuration",
      retryable: false,
      details: { reason: "bucket name is not valid" }
    });
  }
  return raw;
}

/** Validate the integration-provided account id when present. Presence-only for diagnostics. */
export function resolveAwsAccountId(): string | null {
  const raw = clean(process.env.AWS_ACCOUNT_ID);
  if (!raw) return null;
  if (!ACCOUNT_ID_PATTERN.test(raw)) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation: "aws.config",
      category: "configuration",
      retryable: false,
      details: { reason: "AWS_ACCOUNT_ID is not a 12-digit account id" }
    });
  }
  return raw;
}

/** Validate the integration role ARN when present. */
export function resolveAwsRoleArn(): string | null {
  const raw = clean(process.env.AWS_ROLE_ARN);
  if (!raw) return null;
  if (!ROLE_ARN_PATTERN.test(raw)) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation: "aws.config",
      category: "configuration",
      retryable: false,
      details: { reason: "AWS_ROLE_ARN is not a valid IAM role ARN" }
    });
  }
  return raw;
}

export function isVercelOidcRoleConfigured(): boolean {
  return Boolean(clean(process.env.VERCEL_OIDC_TOKEN) && clean(process.env.AWS_ROLE_ARN));
}

export function hasStaticS3Credentials(): boolean {
  return Boolean(clean(process.env.S3_ACCESS_KEY_ID) && clean(process.env.S3_SECRET_ACCESS_KEY));
}

export function awsCredentialStrategy(): AwsCredentialStrategy {
  if (isVercelOidcRoleConfigured()) return "vercel-oidc-role";
  if (hasStaticS3Credentials()) return "static";
  return "none";
}

/** True when at least one AWS credential strategy is fully configured. */
export function isAwsConfigured(): boolean {
  return awsCredentialStrategy() !== "none";
}

type RoleCredentialCache = AwsCredentials & { expiresAt: number };
let roleCredentialCache: RoleCredentialCache | null = null;

/** Test hook: clear the cached temporary credentials. */
export function resetAwsCredentialCacheForTests(): void {
  roleCredentialCache = null;
}

async function assumeVercelRole(region: string, roleArn: string, operation: string): Promise<AwsCredentials> {
  const now = Date.now();
  if (roleCredentialCache && roleCredentialCache.expiresAt - now > 5 * 60 * 1000) {
    return roleCredentialCache;
  }
  const token = clean(process.env.VERCEL_OIDC_TOKEN);
  if (!token) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      details: { reason: "AWS_ROLE_ARN is set but VERCEL_OIDC_TOKEN is missing" }
    });
  }
  const sts = new STSClient({ region });
  let output;
  try {
    output = await sts.send(new AssumeRoleWithWebIdentityCommand({
      RoleArn: roleArn,
      WebIdentityToken: token,
      // RoleSessionName must match [\w+=,.@-]{2,64}
      RoleSessionName: `seoflow-${Math.floor(now / 1000)}`,
      DurationSeconds: 3600
    }));
  } catch (error) {
    throw classifyAwsError(error, operation);
  } finally {
    sts.destroy();
  }
  const credentials = output.Credentials;
  const expiresAt = credentials?.Expiration ? credentials.Expiration.getTime() : now + 3600 * 1000;
  if (!credentials?.AccessKeyId || !credentials.SecretAccessKey || !credentials.SessionToken) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation,
      category: "configuration",
      retryable: false,
      details: { reason: "STS returned incomplete temporary credentials" }
    });
  }
  roleCredentialCache = {
    accessKeyId: credentials.AccessKeyId,
    secretAccessKey: credentials.SecretAccessKey,
    sessionToken: credentials.SessionToken,
    expiresAt
  };
  return roleCredentialCache;
}

/**
 * Resolve credentials for an AWS SDK call.
 *
 * Returns `null` when no credential strategy is configured (feature disabled).
 * Throws AppError for configured-but-broken strategies (invalid config, STS
 * failure, denied role) — callers must not treat those as "disabled".
 */
export async function getAwsCredentials(operation = "aws.credentials"): Promise<AwsCredentials | null> {
  const strategy = awsCredentialStrategy();
  const region = resolveAwsRegion();

  if (strategy === "vercel-oidc-role") {
    if (!region) {
      throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
        operation,
        category: "configuration",
        retryable: false,
        details: { reason: "AWS_REGION is required for role-based credentials" }
      });
    }
    resolveAwsAccountId();
    const roleArn = resolveAwsRoleArn();
    if (!roleArn) {
      throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
        operation,
        category: "configuration",
        retryable: false,
        details: { reason: "AWS_ROLE_ARN is required for role-based credentials" }
      });
    }
    return assumeVercelRole(region, roleArn, operation);
  }

  if (strategy === "static") {
    const accessKeyId = clean(process.env.S3_ACCESS_KEY_ID)!;
    const secretAccessKey = clean(process.env.S3_SECRET_ACCESS_KEY)!;
    if (/\s/.test(accessKeyId) || /\s/.test(secretAccessKey)) {
      throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
        operation,
        category: "configuration",
        retryable: false,
        details: { reason: "static credentials contain whitespace" }
      });
    }
    if (!region) {
      throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
        operation,
        category: "configuration",
        retryable: false,
        details: { reason: "S3_REGION (or AWS_REGION) is required for static credentials" }
      });
    }
    return { accessKeyId, secretAccessKey };
  }

  return null;
}

/**
 * Credentials provider suitable for AWS SDK v3 clients. The SDK calls it per
 * request; role-based credentials are cached and refreshed automatically
 * before expiry by `getAwsCredentials`.
 */
export async function awsCredentialsProvider() {
  const credentials = await getAwsCredentials("aws.credentials-provider");
  if (!credentials) {
    throw new AppError(ERROR_CODES.AWS_CONFIGURATION_ERROR, PUBLIC_MESSAGES.AWS_CONFIGURATION_ERROR, {
      operation: "aws.credentials-provider",
      category: "configuration",
      retryable: false,
      details: { reason: "no AWS credential strategy is configured" }
    });
  }
  return credentials;
}
