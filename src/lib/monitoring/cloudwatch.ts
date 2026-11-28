/**
 * Optional CloudWatch operational-metrics publisher.
 *
 * Vercel Runtime Logs do not automatically appear in CloudWatch — this is an
 * explicit, opt-in integration for the handful of operational events that
 * matter (AWS integration failures, email delivery failures). It:
 *
 * - is disabled unless `AWS_CLOUDWATCH_METRICS=true`;
 * - reuses the shared AWS credential resolution (Vercel OIDC role or static);
 * - never throws and never logs credentials — a metrics failure must not
 *   affect the request path;
 * - batches nothing (one PutMetricData call per event) to stay simple and
 *   deterministic.
 */

import { CloudWatchClient, PutMetricDataCommand, type StandardUnit } from "@aws-sdk/client-cloudwatch";
import { getAwsCredentials, resolveAwsRegion } from "@/lib/aws/config";
import { logger, errorDiagnostics } from "@/lib/logger";

export type OperationalMetric = {
  /** CloudWatch metric name, e.g. "EmailDeliveryFailure". */
  name: string;
  /** Defaults to 1 (a counter event). */
  value?: number;
  /** Defaults to "Count". */
  unit?: StandardUnit;
  /** Up to 6 low-cardinality dimensions (no user data). */
  dimensions?: Record<string, string>;
};

const METRIC_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,255}$/;
const DIMENSION_NAME_PATTERN = /^[A-Za-z0-9_.\-/]{1,255}$/;
const MAX_DIMENSIONS = 6;
const MAX_DIMENSION_VALUE = 255;

function sanitizeDimensions(dimensions: Record<string, string> | undefined): { Name: string; Value: string }[] {
  if (!dimensions) return [];
  const entries: { Name: string; Value: string }[] = [];
  for (const [rawName, rawValue] of Object.entries(dimensions)) {
    if (entries.length >= MAX_DIMENSIONS) break;
    const name = rawName.trim();
    const value = String(rawValue ?? "").trim();
    if (!DIMENSION_NAME_PATTERN.test(name) || !value) continue;
    // Strip anything that looks like user data or a credential; keep low-cardinality labels.
    const safeValue = value.slice(0, MAX_DIMENSION_VALUE).replace(/([a-z0-9._%+-]+)@([a-z0-9.-]+)/gi, "[redacted]").replace(/[\r\n\t]/g, " ");
    entries.push({ Name: name, Value: safeValue });
  }
  return entries;
}

export type PublishMetricResult = { published: boolean; reason?: "disabled" | "no-region" | "no-credentials" | "invalid-metric" | "error" };

/**
 * Publish one operational metric. Best-effort: returns a result descriptor
 * instead of throwing, and logs a sanitized warning on failure.
 */
export async function publishOperationalMetric(metric: OperationalMetric): Promise<PublishMetricResult> {
  if ((process.env.AWS_CLOUDWATCH_METRICS ?? "").trim().toLowerCase() !== "true") {
    return { published: false, reason: "disabled" };
  }
  const name = (metric.name ?? "").trim();
  if (!METRIC_NAME_PATTERN.test(name)) {
    logger.warn("CLOUDWATCH_METRIC_REJECTED", { operation: "monitoring.cloudwatch-metric", reason: "invalid-metric-name" });
    return { published: false, reason: "invalid-metric" };
  }
  const namespace = (process.env.AWS_CLOUDWATCH_NAMESPACE ?? "SEOFlow").trim().slice(0, 255) || "SEOFlow";
  try {
    const region = resolveAwsRegion();
    if (!region) return { published: false, reason: "no-region" };
    const credentials = await getAwsCredentials("monitoring.cloudwatch-metric");
    if (!credentials) return { published: false, reason: "no-credentials" };

    const value = typeof metric.value === "number" && Number.isFinite(metric.value) ? metric.value : 1;
    const client = new CloudWatchClient({ region, credentials });
    try {
      await client.send(new PutMetricDataCommand({
        Namespace: namespace,
        MetricData: [{
          MetricName: name,
          Value: value,
          Unit: metric.unit ?? "Count",
          Timestamp: new Date(),
          Dimensions: sanitizeDimensions(metric.dimensions)
        }]
      }));
    } finally {
      client.destroy();
    }
    return { published: true };
  } catch (error) {
    logger.warn("CLOUDWATCH_METRIC_FAILED", {
      operation: "monitoring.cloudwatch-metric",
      metric: name,
      ...errorDiagnostics(error)
    });
    return { published: false, reason: "error" };
  }
}
