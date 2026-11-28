import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sesSendMock, sesDestroyMock, stsSendMock } = vi.hoisted(() => ({
  sesSendMock: vi.fn(),
  sesDestroyMock: vi.fn(),
  stsSendMock: vi.fn()
}));

vi.mock("@aws-sdk/client-ses", () => ({
  SESClient: class {
    send = sesSendMock;
    destroy = sesDestroyMock;
  },
  SendEmailCommand: class {
    constructor(public input: Record<string, unknown>) {}
  }
}));

vi.mock("@aws-sdk/client-sts", () => ({
  STSClient: class {
    send = stsSendMock;
    destroy = vi.fn();
  },
  AssumeRoleWithWebIdentityCommand: class {
    constructor(public input: Record<string, unknown>) {}
  }
}));

import { sendAccountEmail } from "./email";
import { resetAwsCredentialCacheForTests } from "./aws/config";

const KEYS = [
  "EMAIL_PROVIDER", "SES_FROM_EMAIL", "SMTP_FROM", "SMTP_HOST", "SMTP_PORT",
  "SMTP_USER", "SMTP_PASSWORD", "AWS_REGION", "S3_REGION",
  "AWS_ROLE_ARN", "AWS_ACCOUNT_ID", "AWS_RESOURCE_ARN", "VERCEL_OIDC_TOKEN",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_BUCKET", "S3_BUCKET_NAME",
  "AWS_CLOUDWATCH_METRICS"
] as const;

const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
  sesSendMock.mockReset();
  sesDestroyMock.mockClear();
  stsSendMock.mockReset();
  resetAwsCredentialCacheForTests();
});

afterEach(() => {
  for (const key of KEYS) {
    const original = snapshot.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  snapshot.clear();
  resetAwsCredentialCacheForTests();
});

const message = { to: "user@example.com", subject: "Verify your SEOFlow email", url: "https://app.example.com/verify?token=abc", action: "verify" as const };

describe("sendAccountEmail — provider selection", () => {
  it("fails closed with a stable code for an unsupported provider", async () => {
    process.env.EMAIL_PROVIDER = "carrier-pigeon";
    await expect(sendAccountEmail(message)).rejects.toMatchObject({ code: "EMAIL_DELIVERY_ERROR" });
  });

  it("keeps the development log fallback when no provider is configured outside production", async () => {
    await expect(sendAccountEmail(message)).resolves.toBeUndefined();
    expect(sesSendMock).not.toHaveBeenCalled();
  });
});

describe("sendAccountEmail — Amazon SES", () => {
  function configureStaticSes() {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.SES_FROM_EMAIL = "SEOFlow <no-reply@example.com>";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
  }

  it("sends through SES when EMAIL_PROVIDER=ses and static credentials are set", async () => {
    configureStaticSes();
    sesSendMock.mockResolvedValue({ MessageId: "message-id" });
    await expect(sendAccountEmail(message)).resolves.toBeUndefined();
    expect(sesSendMock).toHaveBeenCalledTimes(1);
    const command = sesSendMock.mock.calls[0][0] as { input: { Source: string; Destination: { ToAddresses: string[] }; Message: { Subject: { Data: string } } } };
    expect(command.input.Source).toBe("SEOFlow <no-reply@example.com>");
    expect(command.input.Destination.ToAddresses).toEqual(["user@example.com"]);
    expect(command.input.Message.Subject.Data).toBe("Verify your SEOFlow email");
  });

  it("supports role-based credentials via Vercel OIDC", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.SES_FROM_EMAIL = "no-reply@example.com";
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_ACCOUNT_ID = "123456789012";
    process.env.VERCEL_OIDC_TOKEN = "oidc-token";
    process.env.AWS_ROLE_ARN = "arn:aws:iam::123456789012:role/seoflow-vercel";
    stsSendMock.mockResolvedValue({
      Credentials: {
        AccessKeyId: "ASIA_EXAMPLE",
        SecretAccessKey: "session-secret",
        SessionToken: "session-token",
        Expiration: new Date(Date.now() + 3600 * 1000)
      }
    });
    sesSendMock.mockResolvedValue({ MessageId: "message-id" });
    await expect(sendAccountEmail(message)).resolves.toBeUndefined();
    expect(stsSendMock).toHaveBeenCalledTimes(1);
    expect(sesSendMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when SES is selected without a sender identity", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    await expect(sendAccountEmail(message)).rejects.toMatchObject({ code: "AWS_CONFIGURATION_ERROR" });
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("fails closed when SES is selected without AWS credentials", async () => {
    process.env.EMAIL_PROVIDER = "ses";
    process.env.SES_FROM_EMAIL = "no-reply@example.com";
    process.env.AWS_REGION = "us-east-1";
    await expect(sendAccountEmail(message)).rejects.toMatchObject({ code: "AWS_CONFIGURATION_ERROR" });
    expect(sesSendMock).not.toHaveBeenCalled();
  });

  it("classifies provider throttling as SES_DELIVERY_ERROR (retryable)", async () => {
    configureStaticSes();
    sesSendMock.mockRejectedValue(Object.assign(new Error("rate exceeded"), { name: "ThrottlingException" }));
    const failure = (await sendAccountEmail(message).catch((error: unknown) => error)) as { code: string; retryable: boolean; referenceId: string };
    expect(failure).toMatchObject({ code: "SES_DELIVERY_ERROR", retryable: true });
    expect(failure.referenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("classifies a rejected/invalid recipient as a non-retryable delivery failure", async () => {
    configureStaticSes();
    sesSendMock.mockRejectedValue(Object.assign(new Error("Email address is not verified"), { name: "MessageRejected" }));
    await expect(sendAccountEmail(message)).rejects.toMatchObject({ code: "SES_DELIVERY_ERROR", retryable: false });
  });

  it("does not fall back to SMTP when SES fails", async () => {
    configureStaticSes();
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASSWORD = "pass";
    sesSendMock.mockRejectedValue(Object.assign(new Error("kaput"), { name: "ServiceUnavailable", $metadata: { httpStatusCode: 503 } }));
    await expect(sendAccountEmail(message)).rejects.toMatchObject({ code: "SES_DELIVERY_ERROR" });
  });
});
