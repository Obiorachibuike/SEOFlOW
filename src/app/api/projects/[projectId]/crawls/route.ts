import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { auditReports, crawlJobs, projects } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { jsonError, readJson, HttpError } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { getOrganizationPlan } from "@/lib/plans";
import { enqueueCrawl } from "@/lib/jobs/boss";
import { validatePublicDestination } from "@/lib/crawler/ssrf";

const crawlRequestSchema = z.object({ pageLimit: z.number().int().min(1).max(10_000).optional() }).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const rows = await db.select({ crawl: crawlJobs, report: auditReports })
      .from(crawlJobs)
      .leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
      .where(eq(crawlJobs.projectId, projectId))
      .orderBy(desc(crawlJobs.createdAt))
      .limit(30);
    return NextResponse.json({ crawls: rows.map((row) => ({ ...row.crawl, report: row.report })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`crawl:${user.id}`)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    const input = crawlRequestSchema.parse(await readJson(request));
    const [projectRow] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    if (!projectRow) throw new HttpError(404, "Project not found.", "PROJECT_NOT_FOUND");
    const plan = await getOrganizationPlan(project.organizationId);
    const requestedLimit = input.pageLimit ?? projectRow.crawlPageLimit;
    const hardLimit = Math.min(plan.crawlPageLimit, Number(process.env.CRAWL_MAX_PAGES_HARD_LIMIT ?? 10_000));
    if (requestedLimit > hardLimit) {
      throw new HttpError(403, `Your ${plan.planName} plan allows up to ${hardLimit} pages per crawl.`, "CRAWL_LIMIT_REACHED");
    }
    await validatePublicDestination(projectRow.websiteUrl);
    const crawl = await db.transaction(async (tx) => {
      const [lockedProject] = await tx.select({ id: projects.id }).from(projects)
        .where(eq(projects.id, projectId)).for("update").limit(1);
      if (!lockedProject) throw new HttpError(404, "Project not found.", "PROJECT_NOT_FOUND");
      const [activeCrawl] = await tx.select({ id: crawlJobs.id }).from(crawlJobs)
        .where(and(eq(crawlJobs.projectId, projectId), inArray(crawlJobs.status, ["queued", "running"]))).limit(1);
      if (activeCrawl) throw new HttpError(409, "This project already has a queued or running audit.", "CRAWL_ALREADY_ACTIVE");
      const [created] = await tx.insert(crawlJobs).values({
        projectId,
        requestedBy: user.id,
        pageLimit: requestedLimit,
        status: "queued"
      }).returning();
      return created;
    });
    try {
      const queueJobId = await enqueueCrawl({ crawlId: crawl.id, projectId });
      await db.update(crawlJobs).set({ queueJobId }).where(eq(crawlJobs.id, crawl.id));
      return NextResponse.json({ crawl: { ...crawl, queueJobId } }, { status: 202 });
    } catch (error) {
      await db.update(crawlJobs).set({ status: "failed", finishedAt: new Date(), errorMessage: "The persistent queue could not accept this crawl." }).where(eq(crawlJobs.id, crawl.id));
      throw error;
    }
  } catch (error) { return jsonError(error); }
}
