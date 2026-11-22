import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { seoIssues } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { jsonError } from "@/lib/http";

const querySchema = z.object({
  crawlId: z.string().uuid().optional(),
  severity: z.enum(["critical", "high", "medium", "low", "info"]).optional(),
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0)
});

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const parsed = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const conditions = [eq(seoIssues.projectId, projectId)];
    if (parsed.crawlId) conditions.push(eq(seoIssues.crawlId, parsed.crawlId));
    if (parsed.severity) conditions.push(eq(seoIssues.severity, parsed.severity));
    if (parsed.q) conditions.push(ilike(seoIssues.description, `%${parsed.q}%`));
    const rows = await db.select().from(seoIssues).where(and(...conditions))
      .orderBy(desc(seoIssues.detectedAt)).limit(parsed.limit).offset(parsed.offset);
    const [total] = await db.select({ value: sql<number>`count(*)::int` }).from(seoIssues).where(and(...conditions));
    return NextResponse.json({ issues: rows, total: total?.value ?? 0, limit: parsed.limit, offset: parsed.offset });
  } catch (error) { return jsonError(error); }
}
