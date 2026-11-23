import { and, desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditReports, crawlJobs, projects, seoIssues } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";
import { archiveGeneratedReport } from "@/lib/reports/archive";
import { csvCell } from "@/lib/csv";

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
    const issues = await db.select().from(seoIssues).where(eq(seoIssues.crawlId, latest.crawl.id)).orderBy(desc(seoIssues.detectedAt)).limit(10_000);
    const rows = [
      ["SEOFlow audit export", "Diagnostic metric only; not a Google ranking score"],
      ["Project", project.name], ["Website", project.websiteUrl], ["Crawl completed", latest.crawl.finishedAt?.toISOString() ?? ""],
      ["Overall diagnostic score", latest.report.overallScore], ["Score methodology", latest.report.scoreMethodologyVersion], [],
      ["Issue key", "Severity", "Category", "URL", "Description", "Recommendation", "Evidence", "Rule version", "Detected at"],
      ...issues.map((issue) => [issue.issueKey, issue.severity, issue.category, issue.url, issue.description, issue.recommendation, JSON.stringify(issue.evidence), issue.ruleVersion, issue.detectedAt.toISOString()])
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    const body = Buffer.from(`\uFEFF${csv}`, "utf8");
    await archiveGeneratedReport({ organizationId: project.organizationId, projectId, crawlId: latest.crawl.id, createdBy: user.id, format: "csv", body });
    const name = safeFilename(project.name);
    return new NextResponse(new Uint8Array(body), { headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}-seo-audit.csv"`,
      "Cache-Control": "private, no-store"
    } });
  } catch (error) { return jsonError(error); }
}

function safeFilename(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "website"; }
