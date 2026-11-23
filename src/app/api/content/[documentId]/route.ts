import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { contentDocuments, contentRevisions } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError, readJson } from "@/lib/http";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  content: z.string().max(100_000).optional(),
  targetKeyword: z.string().trim().max(200).nullable().optional(),
  status: z.enum(["draft", "proposed", "approved"]).optional(),
  changeSummary: z.string().trim().max(500).optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one field to update.");

export async function GET(_request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser();
    const { documentId } = await context.params;
    const [document] = await db.select().from(contentDocuments).where(eq(contentDocuments.id, documentId)).limit(1);
    if (!document) throw new HttpError(404, "Content draft not found.", "DOCUMENT_NOT_FOUND");
    await requireProject(document.projectId, user.id);
    const revisions = await db.select().from(contentRevisions).where(eq(contentRevisions.documentId, documentId)).orderBy(desc(contentRevisions.version)).limit(50);
    return NextResponse.json({ document, revisions });
  } catch (error) { return jsonError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ documentId: string }> }) {
  try {
    const user = await requireApiUser();
    const { documentId } = await context.params;
    const [document] = await db.select().from(contentDocuments).where(eq(contentDocuments.id, documentId)).limit(1);
    if (!document) throw new HttpError(404, "Content draft not found.", "DOCUMENT_NOT_FOUND");
    const membership = await requireProject(document.projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const input = updateSchema.parse(await readJson(request));
    if (input.status === "approved" && !["owner", "admin", "seo_manager"].includes(membership.role)) {
      throw new HttpError(403, "Only workspace managers can approve content.", "APPROVAL_FORBIDDEN");
    }
    const changesContent = input.content !== undefined || input.title !== undefined;
    const result = await db.transaction(async (tx) => {
      const [updated] = await tx.update(contentDocuments).set({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.targetKeyword !== undefined ? { targetKeyword: input.targetKeyword || null } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        updatedAt: new Date()
      }).where(eq(contentDocuments.id, documentId)).returning();
      if (changesContent) {
        const [latest] = await tx.select({ version: contentRevisions.version }).from(contentRevisions)
          .where(eq(contentRevisions.documentId, documentId)).orderBy(desc(contentRevisions.version)).limit(1);
        await tx.insert(contentRevisions).values({
          documentId,
          version: (latest?.version ?? 0) + 1,
          title: updated.title,
          content: updated.content,
          changeSummary: input.changeSummary ?? "Draft saved",
          createdBy: user.id
        });
      }
      return updated;
    });
    return NextResponse.json({ document: result });
  } catch (error) { return jsonError(error); }
}
