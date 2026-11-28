import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, stsDestroyMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  stsDestroyMock: vi.fn()
}));

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class {
    send = sendMock;
    destroy = stsDestroyMock;
  },
  AssumeRoleWithWebIdentityCommand: class {
    constructor(public input: Record<string, unknown>) {}
  }
}));

import {
  awsCredentialStrategy,
  getAwsCredentials,
  hasStaticS3Credentials,
  isAwsConfigured,
  isVercelOidcRoleConfigured,
  resetAwsCredentialCacheForTests,
  resolveAwsAccountId,
  resolveAwsRegion,
  resolveAwsRoleArn,
  resolveS3BucketName
} from "./config";

const AWS_KEYS = [
  "AWS_REGION", "S3_REGION", "S3_BUCKET", "S3_BUCKET_NAME", "AWS_ROLE_ARN",
  "AWS_ACCOUNT_ID", "AWS_RESOURCE_ARN", "VERCEL_OIDC_TOKEN",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"
] as const;

const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of AWS_KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
  sendMock.mockReset();
  stsDestroyMock.mockClear();
  resetAwsCredentialCacheForTests();
});

afterEach(() => {
  for (const key of AWS_KEYS) {
    const original = snapshot.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  snapshot.clear();
  resetAwsCredentialCacheForTests();
});

const validRoleArn = "arn:aws:iam::123456789012:role/seoflow-vercel";

describe("region and bucket resolution", () => {
  it("returns null when nothing is configured", () => {
    expect(resolveAwsRegion()).toBeNull();
    expect(resolveS3BucketName()).toBeNull();
    expect(awsCredentialStrategy()).toBe("none");
    expect(isAwsConfigured()).toBe(false);
  });

  it("prefers the Vercel integration region/bucket over the static ones", () => {
    process.env.AWS_REGION = "eu-west-1";
    process.env.S3_REGION = "us-east-1";
    process.env.S3_BUCKET_NAME = "integration-bucket";
    process.env.S3_BUCKET = "static-bucket";
    expect(resolveAwsRegion()).toBe("eu-west-1");
    expect(resolveS3BucketName()).toBe("integration-bucket");
  });

  it("rejects malformed regions and buckets with AWS_CONFIGURATION_ERROR", () => {
    process.env.AWS_REGION = "not a region!";
    expect(() => resolveAwsRegion()).toThrowError(expect.objectContaining({ code: "AWS_CONFIGURATION_ERROR" }));
    delete process.env.AWS_REGION;
    process.env.S3_BUCKET = "INVALID_BUCKET";
    expect(() => resolveS3BucketName()).toThrowError(expect.objectContaining({ code: "AWS_CONFIGURATION_ERROR" }));
  });

  it("rejects malformed role ARNs and account ids", () => {
    process.env.AWS_ROLE_ARN = "role/not-an-arn";
    expect(() => resolveAwsRoleArn()).toThrowError(expect.objectContaining({ code: "AWS_CONFIGURATION_ERROR" }));
    delete process.env.AWS_ROLE_ARN;
    process.env.AWS_ACCOUNT_ID = "123";
    expect(() => resolveAwsAccountId()).toThrowError(expect.objectContaining({ code: "AWS_CONFIGURATION_ERROR" }));
  });
});

describe("credential strategy selection", () => {
  it("detects static credentials", () => {
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    expect(hasStaticS3Credentials()).toBe(true);
    expect(awsCredentialStrategy()).toBe("static");
  });

  it("prefers the Vercel OIDC role over static credentials", () => {
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    process.env.VERCEL_OIDC_TOKEN = "token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    expect(isVercelOidcRoleConfigured()).toBe(true);
    expect(awsCredentialStrategy()).toBe("vercel-oidc-role");
  });

  it("treats a role ARN without an OIDC token as unconfigured (fail closed, not static)", () => {
    process.env.AWS_ROLE_ARN = validRoleArn;
    expect(awsCredentialStrategy()).toBe("none");
  });
});

describe("getAwsCredentials", () => {
  it("returns null when no strategy is configured", async () => {
    await expect(getAwsCredentials()).resolves.toBeNull();
  });

  it("returns static credentials when region is set", async () => {
    process.env.S3_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await expect(getAwsCredentials()).resolves.toEqual({ accessKeyId: "key", secretAccessKey: "secret" });
  });

  it("fails closed when static credentials have no region", async () => {
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: "AWS_CONFIGURATION_ERROR" });
  });

  it("fails closed when role-based configuration has no region", async () => {
    process.env.VERCEL_OIDC_TOKEN = "token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: "AWS_CONFIGURATION_ERROR" });
  });

  it("assumes the Vercel role with the OIDC token and caches the result", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCOUNT_ID = "123456789012";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    sendMock.mockResolvedValue({
      Credentials: {
        AccessKeyId: "ASIA_EXAMPLE",
        SecretAccessKey: "session-secret",
        SessionToken: "session-token",
        Expiration: new Date(Date.now() + 3600 * 1000)
      }
    });
    const first = await getAwsCredentials("test.sts");
    expect(first).toMatchObject({ accessKeyId: "ASIA_EXAMPLE", sessionToken: "session-token" });
    const second = await getAwsCredentials("test.sts");
    expect(second).toEqual(first);
    expect(sendMock).toHaveBeenCalledTimes(1);
    const commandInput = sendMock.mock.calls[0][0].input;
    expect(commandInput).toMatchObject({ RoleArn: validRoleArn, WebIdentityToken: "oidc-token" });
    expect(commandInput.RoleSessionName).toMatch(/^seoflow-\d+$/);
  });

  it("classifies STS access denied failures as AWS_ACCESS_DENIED", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    sendMock.mockRejectedValue(Object.assign(new Error("not authorized"), { name: "AccessDenied" }));
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: "AWS_ACCESS_DENIED" });
  });

  it("classifies STS network failures as AWS_SERVICE_UNAVAILABLE", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    sendMock.mockRejectedValue(Object.assign(new Error("socket hang up"), { name: "NetworkingError" }));
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: "AWS_SERVICE_UNAVAILABLE" });
  });

  it("fails closed when STS returns incomplete credentials", async () => {
    process.env.AWS_REGION = "us-east-1";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AWS_ROLE_ARN = validRoleArn;
    sendMock.mockResolvedValue({ Credentials: { AccessKeyId: "only-key" } });
    await expect(getAwsCredentials()).rejects.toMatchObject({ code: "AWS_CONFIGURATION_ERROR" });
  });
});
