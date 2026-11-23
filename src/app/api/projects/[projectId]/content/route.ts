import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { contentDocuments, contentRevisions } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { jsonError, readJson } from "@/lib/http";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().max(100_000).default(""),
  documentType: z.enum(["article", "landing-page", "product-page", "category-page", "other"]).default("article"),
  targetKeyword: z.string().trim().max(200).optional()
}).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const documents = await db.select().from(contentDocuments).where(eq(contentDocuments.projectId, projectId)).orderBy(desc(contentDocuments.updatedAt)).limit(100);
    return NextResponse.json({ documents });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const input = createSchema.parse(await readJson(request));
    const document = await db.transaction(async (tx) => {
      const [created] = await tx.insert(contentDocuments).values({
        projectId,
        createdBy: user.id,
        title: input.title,
        documentType: input.documentType,
        targetKeyword: input.targetKeyword || null,
        content: input.content,
        status: "draft"
      }).returning();
      await tx.insert(contentRevisions).values({ documentId: created.id, version: 1, title: created.title, content: created.content, changeSummary: "Initial draft", createdBy: user.id });
      return created;
    });
    return NextResponse.json({ document }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
