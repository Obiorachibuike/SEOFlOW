import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { auditReports, crawlJobs } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";

export async function GET(_request: Request, context: { params: Promise<{ crawlId: string }> }) {
  try {
    const user = await requireApiUser();
    const { crawlId } = await context.params;
    const [row] = await db.select({ crawl: crawlJobs, report: auditReports })
      .from(crawlJobs)
      .leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
      .where(eq(crawlJobs.id, crawlId)).limit(1);
    if (!row) throw new HttpError(404, "Crawl not found.", "CRAWL_NOT_FOUND");
    await requireProject(row.crawl.projectId, user.id);
    return NextResponse.json({ crawl: { ...row.crawl, report: row.report } });
  } catch (error) { return jsonError(error); }
}
