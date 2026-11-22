import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { reportArtifactContentType, storeReportArtifact } from "@/lib/storage/object-storage";

const keys = ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_FORCE_PATH_STYLE"] as const;
const originalValues = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of keys) {
    originalValues.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of keys) {
    const original = originalValues.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  originalValues.clear();
});

describe("private report object storage", () => {
  it("keeps generated exports on-demand when storage is not configured", async () => {
    await expect(storeReportArtifact({
      organizationId: "org-id",
      projectId: "project-id",
      crawlId: "crawl-id",
      artifactId: "artifact-id",
      createdBy: "user-id",
      format: "pdf",
      body: Buffer.from("private report")
    })).resolves.toBeNull();
  });

  it("rejects partial storage setup without contacting an endpoint", async () => {
    process.env.S3_BUCKET = "private-reports";
    await expect(storeReportArtifact({
      organizationId: "org-id",
      projectId: "project-id",
      crawlId: "crawl-id",
      artifactId: "artifact-id",
      createdBy: "user-id",
      format: "csv",
      body: Buffer.from("private report")
    })).rejects.toMatchObject({ status: 503, code: "STORAGE_CONFIGURATION_INVALID" });
  });

  it("uses fixed content types for allowed archive formats", () => {
    expect(reportArtifactContentType("pdf")).toBe("application/pdf");
    expect(reportArtifactContentType("csv")).toBe("text/csv; charset=utf-8");
  });
});
