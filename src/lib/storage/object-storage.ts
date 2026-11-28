import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { HttpError } from "@/lib/http";
import { AppError, ERROR_CODES, isAppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { publishOperationalMetric } from "@/lib/monitoring/cloudwatch";
import {
  awsCredentialStrategy,
  awsCredentialsProvider,
  resolveAwsRegion,
  resolveS3BucketName,
  type AwsCredentialStrategy
} from "@/lib/aws/config";
import { classifyAwsError } from "@/lib/aws/errors";

const maxArtifactBytes = 50 * 1024 * 1024;

type StorageConfiguration = {
  bucket: string;
  endpoint?: string;
  region: string;
  forcePathStyle: boolean;
  strategy: AwsCredentialStrategy;
};

type ReportFormat = "csv" | "pdf";
type StoredReport = { objectKey: string; sha256: string; byteSize: number; contentType: string };

let cachedClient: S3Client | null = null;
let cachedConfiguration: StorageConfiguration | null = null;

function invalidConfiguration(): HttpError {
  return new HttpError(503, "S3 object storage is configured but the configuration is invalid.", "STORAGE_CONFIGURATION_INVALID");
}

function asStorageConfigurationError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (isAppError(error) && error.code === ERROR_CODES.AWS_CONFIGURATION_ERROR) {
    return invalidConfiguration();
  }
  throw error;
}

/**
 * Resolve storage configuration from either the Vercel AWS integration
 * (`AWS_REGION` / `S3_BUCKET_NAME` / `AWS_ROLE_ARN` + `VERCEL_OIDC_TOKEN`)
 * or static S3-compatible credentials (`S3_REGION` / `S3_BUCKET` /
 * `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` [+ optional `S3_ENDPOINT`]).
 *
 * Returns `null` when nothing storage-related is set (feature disabled →
 * on-demand exports). Throws HttpError(503 STORAGE_CONFIGURATION_INVALID)
 * when configuration is present but incomplete, invalid, or when integration
 * variables exist without a usable credential strategy — never silently
 * downgrades to on-demand exports in those cases.
 */
function storageConfiguration(): StorageConfiguration | null {
  let bucket: string | null = null;
  let region: string | null = null;
  try {
    bucket = resolveS3BucketName();
    region = resolveAwsRegion();
  } catch (error) {
    throw asStorageConfigurationError(error);
  }

  const endpointValue = process.env.S3_ENDPOINT?.trim();
  const forcePathStyleValue = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  const strategy = awsCredentialStrategy();

  const integrationVarsSet = [
    process.env.AWS_ROLE_ARN,
    process.env.AWS_ACCOUNT_ID,
    process.env.AWS_RESOURCE_ARN,
    process.env.AWS_REGION,
    process.env.S3_BUCKET_NAME
  ].some((value) => Boolean(value && value.trim()));

  const hasAny = Boolean(
    bucket || region || endpointValue || forcePathStyleValue || strategy !== "none" || integrationVarsSet
  );
  if (!hasAny) return null;

  if (!bucket) throw invalidConfiguration();
  if (!region) throw invalidConfiguration();

  if (strategy === "none") {
    if (integrationVarsSet) {
      // Fail closed: integration variables exist but no usable credential path.
      throw invalidConfiguration();
    }
    throw invalidConfiguration();
  }

  let endpoint: string | undefined;
  if (endpointValue) {
    let parsed: URL;
    try { parsed = new URL(endpointValue); }
    catch { throw invalidConfiguration(); }
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw invalidConfiguration();
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw invalidConfiguration();
    }
    endpoint = parsed.origin;
  }
  if (forcePathStyleValue && forcePathStyleValue !== "true" && forcePathStyleValue !== "false") {
    throw invalidConfiguration();
  }
  return {
    bucket,
    region,
    endpoint,
    forcePathStyle: forcePathStyleValue ? forcePathStyleValue === "true" : Boolean(endpoint),
    strategy
  };
}

function storageClient(config: StorageConfiguration) {
  if (!cachedClient || !cachedConfiguration || JSON.stringify(config) !== JSON.stringify(cachedConfiguration)) {
    cachedClient?.destroy();
    cachedConfiguration = config;
    cachedClient = new S3Client({
      region: config.region,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
      forcePathStyle: config.forcePathStyle,
      credentials: awsCredentialsProvider
    });
  }
  return cachedClient;
}

/**
 * Classify an unexpected storage failure: emit a CloudWatch metric (opt-in,
 * never throws) and return a stable S3_* AppError carrying the reference ID.
 * The HTTP layer logs the single sanitized failure line for this ID.
 */
function storageFailure(error: unknown, operation: string, code: "S3_UPLOAD_ERROR" | "S3_DOWNLOAD_ERROR"): AppError {
  const awsError = classifyAwsError(error, operation);
  const appError = new AppError(
    code === "S3_UPLOAD_ERROR" ? ERROR_CODES.S3_UPLOAD_ERROR : ERROR_CODES.S3_DOWNLOAD_ERROR,
    code === "S3_UPLOAD_ERROR"
      ? "The report was generated, but the configured object storage could not archive it."
      : "The archived report could not be retrieved or failed integrity validation.",
    {
      operation,
      cause: awsError,
      retryable: awsError.retryable,
      referenceId: awsError.referenceId,
      details: { providerCode: awsError.code }
    });
  void publishOperationalMetric({
    name: code === "S3_UPLOAD_ERROR" ? "StorageWriteFailure" : "StorageReadFailure",
    dimensions: { operation }
  });
  return appError;
}

export async function storeReportArtifact(input: {
  organizationId: string;
  projectId: string;
  crawlId: string;
  artifactId: string;
  createdBy: string;
  format: ReportFormat;
  body: Buffer;
}): Promise<StoredReport | null> {
  const config = storageConfiguration();
  if (!config) return null;
  if (!input.body.byteLength || input.body.byteLength > maxArtifactBytes) {
    throw new HttpError(413, "This report is too large to archive in object storage.", "REPORT_ARCHIVE_TOO_LARGE");
  }
  const objectKey = `organizations/${input.organizationId}/projects/${input.projectId}/reports/${input.crawlId}/${input.artifactId}.${input.format}`;
  const contentType = input.format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8";
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  try {
    await storageClient(config).send(new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
      Body: input.body,
      ContentLength: input.body.byteLength,
      ContentType: contentType,
      CacheControl: "private, no-store",
      Metadata: {
        sha256,
        "organization-id": input.organizationId,
        "project-id": input.projectId,
        "crawl-id": input.crawlId,
        "created-by": input.createdBy
      }
    }));
  } catch (error) {
    throw storageFailure(error, "storage.put-report-artifact", "S3_UPLOAD_ERROR");
  }
  return { objectKey, sha256, byteSize: input.body.byteLength, contentType };
}

export async function readReportArtifact(objectKey: string, expected: { sha256: string; byteSize: number }) {
  const config = storageConfiguration();
  if (!config) throw new HttpError(503, "S3-compatible storage is not configured on this deployment.", "STORAGE_NOT_CONFIGURED");
  if (!Number.isSafeInteger(expected.byteSize) || expected.byteSize <= 0 || expected.byteSize > maxArtifactBytes) {
    throw new HttpError(502, "The stored report metadata is invalid.", "STORAGE_OBJECT_INVALID");
  }
  try {
    const response = await storageClient(config).send(new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }));
    if (!response.Body) throw new Error("Missing object body");
    if (response.ContentLength !== undefined && response.ContentLength !== expected.byteSize) throw new Error("Stored object size mismatch");
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      const bytes = Buffer.from(chunk);
      total += bytes.byteLength;
      if (total > maxArtifactBytes || total > expected.byteSize) throw new Error("Stored object size limit exceeded");
      chunks.push(bytes);
    }
    if (total !== expected.byteSize) throw new Error("Stored object size mismatch");
    const body = Buffer.concat(chunks, total);
    if (createHash("sha256").update(body).digest("hex") !== expected.sha256) throw new Error("Stored object checksum mismatch");
    return body;
  } catch (error) {
    if (error instanceof AppError || error instanceof HttpError) {
      // Our own classified failure from a nested call — keep the reference ID.
      throw error;
    }
    throw storageFailure(error, "storage.get-report-artifact", "S3_DOWNLOAD_ERROR");
  }
}

export async function deleteReportArtifactObject(objectKey: string) {
  const config = storageConfiguration();
  if (!config) return;
  try {
    await storageClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
  } catch (error) {
    const awsError = classifyAwsError(error, "storage.delete-report-artifact");
    logger.warn("STORAGE_DELETE_FAILED", {
      operation: "storage.delete-report-artifact",
      code: awsError.code,
      referenceId: awsError.referenceId
    });
    void publishOperationalMetric({ name: "StorageDeleteFailure", dimensions: { operation: "storage.delete-report-artifact" } });
    throw awsError;
  }
}

export function reportArtifactContentType(format: ReportFormat) {
  return format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8";
}
