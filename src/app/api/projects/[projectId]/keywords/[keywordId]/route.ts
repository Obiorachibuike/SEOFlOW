import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { keywords } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";

export async function DELETE(_request: Request, context: { params: Promise<{ projectId: string; keywordId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId, keywordId } = await context.params;
    await requireProject(projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const [removed] = await db.delete(keywords).where(and(eq(keywords.id, keywordId), eq(keywords.projectId, projectId))).returning({ id: keywords.id });
    if (!removed) throw new HttpError(404, "Tracked keyword not found.", "KEYWORD_NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
