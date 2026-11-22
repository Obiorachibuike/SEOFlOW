import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { reportArtifacts } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { deleteReportArtifactObject, storeReportArtifact } from "@/lib/storage/object-storage";

export async function archiveGeneratedReport(input: {
  organizationId: string;
  projectId: string;
  crawlId: string;
  createdBy: string;
  format: "csv" | "pdf";
  body: Buffer;
}) {
  const id = randomUUID();
  const stored = await storeReportArtifact({ ...input, artifactId: id });
  if (!stored) return null;

  try {
    const [artifact] = await db.insert(reportArtifacts).values({
      id,
      organizationId: input.organizationId,
      projectId: input.projectId,
      crawlId: input.crawlId,
      createdBy: input.createdBy,
      format: input.format,
      objectKey: stored.objectKey,
      contentType: stored.contentType,
      byteSize: stored.byteSize,
      sha256: stored.sha256
    }).returning({ id: reportArtifacts.id });
    return artifact;
  } catch {
    await deleteReportArtifactObject(stored.objectKey).catch(() => undefined);
    throw new HttpError(503, "The report archive index could not be saved. Check database availability and retry the download.", "STORAGE_INDEX_FAILED");
  }
}
