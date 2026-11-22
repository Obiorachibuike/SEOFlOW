import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { HttpError } from "@/lib/http";

const maxArtifactBytes = 50 * 1024 * 1024;

type StorageConfiguration = {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
};

type ReportFormat = "csv" | "pdf";
type StoredReport = { objectKey: string; sha256: string; byteSize: number; contentType: string };

let cachedClient: S3Client | null = null;
let cachedConfiguration: StorageConfiguration | null = null;

function configuration(): StorageConfiguration | null {
  const bucket = process.env.S3_BUCKET?.trim();
  const region = process.env.S3_REGION?.trim();
  const accessKeyId = process.env.S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY?.trim();
  const endpointValue = process.env.S3_ENDPOINT?.trim();
  const forcePathStyleValue = process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase();
  const hasAny = Boolean(bucket || region || accessKeyId || secretAccessKey || endpointValue || forcePathStyleValue);
  if (!hasAny) return null;
  if (!bucket || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes("..")) {
    throw new HttpError(503, "S3-compatible storage configuration has an invalid bucket name.", "STORAGE_CONFIGURATION_INVALID");
  }
  if (!region || !/^[a-z0-9-]{1,64}$/i.test(region)) {
    throw new HttpError(503, "S3-compatible storage requires a valid region.", "STORAGE_CONFIGURATION_INVALID");
  }
  if (!accessKeyId || !secretAccessKey || /\s/.test(accessKeyId) || /\s/.test(secretAccessKey)) {
    throw new HttpError(503, "S3-compatible storage requires both access key credentials.", "STORAGE_CONFIGURATION_INVALID");
  }
  let endpoint: string | undefined;
  if (endpointValue) {
    let parsed: URL;
    try { parsed = new URL(endpointValue); }
    catch { throw new HttpError(503, "S3_ENDPOINT must be a valid absolute URL.", "STORAGE_CONFIGURATION_INVALID"); }
    if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
      throw new HttpError(503, "S3_ENDPOINT must be an HTTP(S) origin without credentials, a path, or query parameters.", "STORAGE_CONFIGURATION_INVALID");
    }
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      throw new HttpError(503, "S3_ENDPOINT must use HTTPS in production.", "STORAGE_CONFIGURATION_INVALID");
    }
    endpoint = parsed.origin;
  }
  if (forcePathStyleValue && forcePathStyleValue !== "true" && forcePathStyleValue !== "false") {
    throw new HttpError(503, "S3_FORCE_PATH_STYLE must be true or false.", "STORAGE_CONFIGURATION_INVALID");
  }
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    endpoint,
    forcePathStyle: forcePathStyleValue ? forcePathStyleValue === "true" : Boolean(endpoint)
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
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }
    });
  }
  return cachedClient;
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
  const config = configuration();
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
  } catch {
    throw new HttpError(502, "The report was generated, but the configured object storage could not archive it.", "STORAGE_WRITE_FAILED");
  }
  return { objectKey, sha256, byteSize: input.body.byteLength, contentType };
}

export async function readReportArtifact(objectKey: string, expected: { sha256: string; byteSize: number }) {
  const config = configuration();
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
  } catch {
    throw new HttpError(502, "The archived report could not be retrieved or failed integrity validation.", "STORAGE_READ_FAILED");
  }
}

export async function deleteReportArtifactObject(objectKey: string) {
  const config = configuration();
  if (!config) return;
  await storageClient(config).send(new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }));
}

export function reportArtifactContentType(format: ReportFormat) {
  return format === "pdf" ? "application/pdf" : "text/csv; charset=utf-8";
}
