import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projectIntegrations } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { jsonError } from "@/lib/http";

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    await db.delete(projectIntegrations).where(and(
      eq(projectIntegrations.projectId, projectId),
      eq(projectIntegrations.provider, "google-search-console")
    ));
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
