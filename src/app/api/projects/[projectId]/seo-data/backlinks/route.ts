import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { backlinkSnapshots, seoDataUsage } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { backlinkSummarySchema, requestDataForSeo } from "@/lib/seo-data/dataforseo";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const emptySchema = z.object({}).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const [snapshot] = await db.select().from(backlinkSnapshots).where(eq(backlinkSnapshots.projectId, projectId))
      .orderBy(desc(backlinkSnapshots.observedAt)).limit(1);
    return NextResponse.json({ snapshot: snapshot ?? null, source: snapshot?.provider ?? null, dataType: "provider-reported backlink summary" });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`seo-data:${user.id}`, 5)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    emptySchema.parse(await readJson(request));
    const task = await requestDataForSeo("/backlinks/summary/live", {
      target: project.normalizedHost,
      include_subdomains: true,
      backlinks_status_type: "live"
    });
    const parsed = task.items[0] === undefined ? null : backlinkSummarySchema.safeParse(task.items[0]);
    if (!parsed || !parsed.success) throw new HttpError(502, "DataForSEO returned no valid backlink summary for this target.", "SEO_DATA_PROVIDER_INVALID_RESPONSE");
    const summary = parsed.data;
    const toCount = (value: number | null | undefined) => value === null || value === undefined ? null : String(value);
    if ([summary.backlinks, summary.referring_domains, summary.referring_main_domains, summary.referring_ips, summary.rank].every((value) => value === null || value === undefined)) {
      throw new HttpError(502, "DataForSEO returned no backlink metrics for this target.", "SEO_DATA_NOT_FOUND");
    }
    const [snapshot] = await db.transaction(async (tx) => {
      const [saved] = await tx.insert(backlinkSnapshots).values({
        projectId,
        provider: "dataforseo",
        target: project.normalizedHost,
        totalBacklinks: toCount(summary.backlinks),
        referringDomains: toCount(summary.referring_domains),
        referringMainDomains: toCount(summary.referring_main_domains),
        referringIps: toCount(summary.referring_ips),
        domainRank: summary.rank ?? null,
        sourceTaskId: task.taskId
      }).returning();
      await tx.insert(seoDataUsage).values({
        organizationId: project.organizationId,
        projectId,
        userId: user.id,
        provider: "dataforseo",
        operation: "backlink-summary",
        externalTaskId: task.taskId,
        estimatedCost: task.cost?.toFixed(8) ?? null
      });
      return [saved];
    });
    return NextResponse.json({ snapshot, dataType: "provider-reported backlink summary", providerTaskId: task.taskId, providerCost: task.cost }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
