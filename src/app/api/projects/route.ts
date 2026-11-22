import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditReports, crawlJobs, organizationMembers, organizations, projects } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { ensureWorkspace } from "@/lib/organizations";
import { getOrganizationPlan } from "@/lib/plans";
import { createProjectSchema, normalizeWebsiteUrl } from "@/lib/validation/project";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { isPublicIp, parseSafeHttpUrl } from "@/lib/crawler/ssrf";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { isIP } from "node:net";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const user = await requireApiUser();
    const memberships = await db.select({ project: projects })
      .from(organizationMembers)
      .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, user.id))
      .orderBy(desc(projects.updatedAt))
      .limit(100);
    const projectList = memberships.map((item) => item.project);
    if (projectList.length === 0) return NextResponse.json({ projects: [] });
    const projectIds = projectList.map((project) => project.id);
    const crawls = await db.select({ crawl: crawlJobs, report: auditReports })
      .from(crawlJobs)
      .leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
      .where(inArray(crawlJobs.projectId, projectIds))
      .orderBy(desc(crawlJobs.createdAt))
      .limit(500);
    const latestByProject = new Map<string, (typeof crawls)[number]>();
    for (const row of crawls) if (!latestByProject.has(row.crawl.projectId)) latestByProject.set(row.crawl.projectId, row);
    return NextResponse.json({ projects: projectList.map((project) => ({
      ...project,
      latestCrawl: latestByProject.get(project.id) ? {
        ...latestByProject.get(project.id)!.crawl,
        report: latestByProject.get(project.id)!.report
      } : null
    })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`project-create:${user.id}`)) return rateLimitResponse();
    const input = createProjectSchema.parse(await readJson(request));
    const normalized = normalizeWebsiteUrl(input.websiteUrl);
    const safeUrl = parseSafeHttpUrl(normalized.websiteUrl);
    if (isIP(safeUrl.hostname.replace(/^\[|\]$/g, "")) && !isPublicIp(safeUrl.hostname.replace(/^\[|\]$/g, ""))) {
      throw new HttpError(400, "The website host must resolve to a public address.", "UNSAFE_URL");
    }
    const organization = await ensureWorkspace({ id: user.id, name: user.name, email: user.email });
    const [membership] = await db.select().from(organizationMembers).where(and(
      eq(organizationMembers.organizationId, organization.id),
      eq(organizationMembers.userId, user.id)
    )).limit(1);
    if (!membership || !["owner", "admin", "seo_manager"].includes(membership.role)) {
      throw new HttpError(403, "Your workspace role cannot create projects.", "FORBIDDEN");
    }
    const plan = await getOrganizationPlan(organization.id);
    const name = input.name?.trim() || safeUrl.hostname;
    const project = await db.transaction(async (tx) => {
      // Serialize project creation per workspace so concurrent requests cannot pass a
      // count-based entitlement check at the same time.
      const [lockedWorkspace] = await tx.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.id, organization.id)).for("update").limit(1);
      if (!lockedWorkspace) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");
      const [count] = await tx.select({ value: sql<number>`count(*)::int` }).from(projects).where(eq(projects.organizationId, organization.id));
      if ((count?.value ?? 0) >= plan.projectLimit) {
        throw new HttpError(403, `Your ${plan.planName} plan allows ${plan.projectLimit} project(s).`, "PROJECT_LIMIT_REACHED");
      }
      const [created] = await tx.insert(projects).values({
        organizationId: organization.id,
        name,
        websiteUrl: normalized.websiteUrl,
        normalizedHost: normalized.host,
        targetCountry: input.targetCountry || null,
        targetLanguage: input.targetLanguage || null,
        createdBy: user.id,
        crawlPageLimit: Math.min(input.crawlPageLimit ?? 100, plan.crawlPageLimit)
      }).returning();
      return created;
    });
    return NextResponse.json({ project }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
