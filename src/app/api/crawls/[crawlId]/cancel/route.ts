import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { crawlJobs } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";

export async function POST(_request: Request, context: { params: Promise<{ crawlId: string }> }) {
  try {
    const user = await requireApiUser();
    const { crawlId } = await context.params;
    const [crawl] = await db.select().from(crawlJobs).where(eq(crawlJobs.id, crawlId)).limit(1);
    if (!crawl) throw new HttpError(404, "Crawl not found.", "CRAWL_NOT_FOUND");
    await requireProject(crawl.projectId, user.id, ["owner", "admin", "seo_manager"]);
    if (!["queued", "running"].includes(crawl.status)) throw new HttpError(409, "This crawl is already finished.", "CRAWL_NOT_ACTIVE");
    await db.update(crawlJobs).set({ status: "cancelled", finishedAt: new Date(), currentUrl: null, errorMessage: "Cancelled by a workspace member." })
      .where(and(eq(crawlJobs.id, crawl.id), inArray(crawlJobs.status, ["queued", "running"])));
    return NextResponse.json({ ok: true });
  } catch (error) { return jsonError(error); }
}
