import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportArtifacts } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";
import { readReportArtifact, reportArtifactContentType } from "@/lib/storage/object-storage";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string; artifactId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId, artifactId } = await context.params;
    const { project } = await requireProject(projectId, user.id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artifactId)) {
      throw new HttpError(404, "Archived report not found.", "REPORT_ARTIFACT_NOT_FOUND");
    }
    const [artifact] = await db.select().from(reportArtifacts).where(and(
      eq(reportArtifacts.id, artifactId),
      eq(reportArtifacts.projectId, projectId)
    )).limit(1);
    if (!artifact || (artifact.format !== "pdf" && artifact.format !== "csv")) {
      throw new HttpError(404, "Archived report not found.", "REPORT_ARTIFACT_NOT_FOUND");
    }
    const body = await readReportArtifact(artifact.objectKey, { sha256: artifact.sha256, byteSize: artifact.byteSize });
    const extension = artifact.format;
    const filenameBase = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "website";
    const contentType = reportArtifactContentType(artifact.format);
    return new NextResponse(new Uint8Array(body), { headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filenameBase}-seo-audit.${extension}"`,
      "Content-Length": String(body.byteLength),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff"
    } });
  } catch (error) { return jsonError(error); }
}
