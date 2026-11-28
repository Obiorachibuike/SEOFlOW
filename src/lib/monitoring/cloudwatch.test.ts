import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sendMock, cwDestroyMock } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  cwDestroyMock: vi.fn()
}));

vi.mock("@aws-sdk/client-cloudwatch", () => ({
  CloudWatchClient: class {
    send = sendMock;
    destroy = cwDestroyMock;
  },
  PutMetricDataCommand: class {
    constructor(public input: Record<string, unknown>) {}
  }
}));

import { publishOperationalMetric } from "./cloudwatch";

const KEYS = [
  "AWS_CLOUDWATCH_METRICS", "AWS_CLOUDWATCH_NAMESPACE", "AWS_REGION", "S3_REGION",
  "VERCEL_OIDC_TOKEN", "AWS_ROLE_ARN", "AWS_ACCOUNT_ID",
  "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"
] as const;

const snapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of KEYS) {
    snapshot.set(key, process.env[key]);
    delete process.env[key];
  }
  sendMock.mockReset();
  cwDestroyMock.mockClear();
});

afterEach(() => {
  for (const key of KEYS) {
    const original = snapshot.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  snapshot.clear();
});

describe("publishOperationalMetric", () => {
  it("is disabled by default and performs no network call", async () => {
    const result = await publishOperationalMetric({ name: "EmailDeliveryFailure" });
    expect(result).toEqual({ published: false, reason: "disabled" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("rejects invalid metric names without throwing", async () => {
    process.env.AWS_CLOUDWATCH_METRICS = "true";
    const result = await publishOperationalMetric({ name: "bad name with spaces!" });
    expect(result).toEqual({ published: false, reason: "invalid-metric" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("reports no-credentials when enabled but nothing is configured", async () => {
    process.env.AWS_CLOUDWATCH_METRICS = "true";
    process.env.AWS_REGION = "us-east-1";
    const result = await publishOperationalMetric({ name: "EmailDeliveryFailure" });
    expect(result).toEqual({ published: false, reason: "no-credentials" });
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("publishes with the default namespace when enabled and configured", async () => {
    process.env.AWS_CLOUDWATCH_METRICS = "true";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    sendMock.mockResolvedValue({});
    const result = await publishOperationalMetric({ name: "EmailDeliveryFailure", dimensions: { provider: "ses" } });
    expect(result).toEqual({ published: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0] as { input: { Namespace: string; MetricData: { MetricName: string; Value: number; Unit: string; Dimensions: { Name: string; Value: string }[] }[] } };
    expect(command.input.Namespace).toBe("SEOFlow");
    expect(command.input.MetricData[0]).toMatchObject({ MetricName: "EmailDeliveryFailure", Value: 1, Unit: "Count" });
    expect(command.input.MetricData[0].Dimensions).toEqual([{ Name: "provider", Value: "ses" }]);
  });

  it("honours a custom namespace and never throws when the service fails", async () => {
    process.env.AWS_CLOUDWATCH_METRICS = "true";
    process.env.AWS_CLOUDWATCH_NAMESPACE = "SEOFlow/Prod";
    process.env.AWS_REGION = "us-east-1";
    process.env.S3_ACCESS_KEY_ID = "key";
    process.env.S3_SECRET_ACCESS_KEY = "secret";
    sendMock.mockRejectedValue(new Error("service down"));
    const result = await publishOperationalMetric({ name: "StorageWriteFailure" });
    expect(result).toEqual({ published: false, reason: "error" });
  });
});
