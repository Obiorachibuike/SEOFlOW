import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { reportArtifacts } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const artifacts = await db.select({
      id: reportArtifacts.id,
      crawlId: reportArtifacts.crawlId,
      format: reportArtifacts.format,
      contentType: reportArtifacts.contentType,
      byteSize: reportArtifacts.byteSize,
      sha256: reportArtifacts.sha256,
      createdAt: reportArtifacts.createdAt
    }).from(reportArtifacts).where(eq(reportArtifacts.projectId, projectId))
      .orderBy(desc(reportArtifacts.createdAt)).limit(100);
    return NextResponse.json({ artifacts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return jsonError(error); }
}
