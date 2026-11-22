import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { keywordMetrics, keywords, organizations, projects } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { getOrganizationPlan } from "@/lib/plans";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const createSchema = z.object({
  phrase: z.string().trim().min(1).max(200),
  country: z.string().trim().length(2).toUpperCase().optional(),
  language: z.string().trim().max(12).optional(),
  intent: z.enum(["informational", "navigational", "commercial", "transactional", "unknown"]).default("unknown"),
  groupName: z.string().trim().max(100).optional()
}).strict();
const listSchema = z.object({ q: z.string().trim().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const input = listSchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const conditions = [eq(keywords.projectId, projectId)];
    if (input.q) conditions.push(ilike(keywords.phrase, `%${input.q}%`));
    const rows = await db.select({ keyword: keywords, metric: keywordMetrics }).from(keywords)
      .leftJoin(keywordMetrics, eq(keywordMetrics.keywordId, keywords.id))
      .where(and(...conditions)).orderBy(desc(keywordMetrics.observedAt), desc(keywords.createdAt)).limit(input.limit * 5);
    const result = new Map<string, { keyword: typeof rows[number]["keyword"]; latestMetric: typeof rows[number]["metric"] }>();
    for (const row of rows) {
      const existing = result.get(row.keyword.id);
      if (!existing || (!existing.latestMetric && row.metric)) result.set(row.keyword.id, { keyword: row.keyword, latestMetric: row.metric });
    }
    return NextResponse.json({ keywords: [...result.values()].slice(0, input.limit).map(({ keyword, latestMetric }) => ({ ...keyword, latestMetric })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`keyword:${user.id}`)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const input = createSchema.parse(await readJson(request));
    const plan = await getOrganizationPlan(project.organizationId);
    const country = input.country ?? project.targetCountry ?? "global";
    const result = await db.transaction(async (tx) => {
      const [lockedWorkspace] = await tx.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.id, project.organizationId)).for("update").limit(1);
      if (!lockedWorkspace) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");
      const [existing] = await tx.select().from(keywords).where(and(
        eq(keywords.projectId, projectId), eq(keywords.phrase, input.phrase), eq(keywords.country, country)
      )).limit(1);
      if (existing) return { keyword: existing, existed: true };
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(keywords)
        .innerJoin(projects, eq(projects.id, keywords.projectId)).where(eq(projects.organizationId, project.organizationId));
      if ((count?.value ?? 0) >= plan.trackedKeywordLimit) {
        throw new HttpError(403, `Your ${plan.planName} plan allows ${plan.trackedKeywordLimit} tracked keywords.`, "KEYWORD_LIMIT_REACHED");
      }
      const [created] = await tx.insert(keywords).values({
        projectId,
        phrase: input.phrase,
        country,
        language: input.language ?? project.targetLanguage,
        intent: input.intent,
        groupName: input.groupName || null,
        source: "manual",
        createdBy: user.id
      }).returning();
      return { keyword: created, existed: false };
    });
    return NextResponse.json({ keyword: result.keyword, ...(result.existed ? { existed: true } : {}) }, { status: result.existed ? 200 : 201 });
  } catch (error) { return jsonError(error); }
}
