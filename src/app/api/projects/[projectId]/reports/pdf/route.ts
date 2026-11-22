import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditReports, crawlJobs, projects, seoIssues } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";
import { archiveGeneratedReport } from "@/lib/reports/archive";
import { createAuditPdf } from "@/lib/reports/pdf";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const requestedCrawlId = new URL(request.url).searchParams.get("crawlId");
    if (requestedCrawlId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedCrawlId)) {
      throw new HttpError(400, "The selected audit identifier is invalid.", "INVALID_CRAWL_ID");
    }
    const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
    const [latest] = await db.select({ crawl: crawlJobs, report: auditReports }).from(crawlJobs)
      .innerJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
      .where(and(eq(crawlJobs.projectId, projectId), ...(requestedCrawlId ? [eq(crawlJobs.id, requestedCrawlId)] : [])))
      .orderBy(desc(auditReports.generatedAt)).limit(1);
    if (!project || !latest) throw new HttpError(404, "No completed audit report is available.", "REPORT_NOT_FOUND");
    const issues = await db.select({ severity: seoIssues.severity, category: seoIssues.category, description: seoIssues.description, url: seoIssues.url, recommendation: seoIssues.recommendation })
      .from(seoIssues).where(eq(seoIssues.crawlId, latest.crawl.id)).orderBy(desc(seoIssues.detectedAt)).limit(500);
    const pdf = createAuditPdf({ project, crawl: latest.crawl, report: latest.report, issues });
    await archiveGeneratedReport({ organizationId: project.organizationId, projectId, crawlId: latest.crawl.id, createdBy: user.id, format: "pdf", body: pdf });
    const filename = project.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "website";
    return new NextResponse(new Uint8Array(pdf), { headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}-seo-audit.pdf"`,
      "Content-Length": String(pdf.byteLength),
      "Cache-Control": "private, no-store"
    } });
  } catch (error) { return jsonError(error); }
}
