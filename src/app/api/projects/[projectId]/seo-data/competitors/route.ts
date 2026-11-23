import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { competitorSnapshots, seoDataUsage } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { competitorItemSchema, normalizeSearchLanguage, normalizeSearchLocation, requestDataForSeo } from "@/lib/seo-data/dataforseo";
import { jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const requestSchema = z.object({ limit: z.number().int().min(1).max(20).default(10) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const rows = await db.select().from(competitorSnapshots).where(eq(competitorSnapshots.projectId, projectId))
      .orderBy(desc(competitorSnapshots.observedAt)).limit(100);
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) if (!latest.has(row.competitorDomain)) latest.set(row.competitorDomain, row);
    return NextResponse.json({ competitors: [...latest.values()].slice(0, 20), observedAt: rows[0]?.observedAt ?? null, source: rows[0]?.provider ?? null, dataType: "provider-reported organic competitor overlap" });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`seo-data:${user.id}`, 5)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    const { limit } = requestSchema.parse(await readJson(request));
    const locationName = normalizeSearchLocation(project.targetCountry ?? "");
    const languageCode = normalizeSearchLanguage(project.targetLanguage);
    const task = await requestDataForSeo("/dataforseo_labs/google/competitors_domain/live", {
      target: project.normalizedHost,
      location_name: locationName,
      language_code: languageCode,
      limit
    });
    const competitorRows = task.items.flatMap((item) => {
      const parsed = competitorItemSchema.safeParse(item);
      if (!parsed.success) return [];
      const competitorDomain = normalizeDomain(parsed.data.competitor_domain);
      if (!competitorDomain || competitorDomain === project.normalizedHost.toLowerCase()) return [];
      return [{
        projectId,
        provider: "dataforseo",
        competitorDomain,
        intersections: parsed.data.intersections ?? null,
        averagePosition: parsed.data.avg_position ?? null,
        sourceTaskId: task.taskId
      }];
    });

    await db.transaction(async (tx) => {
      if (competitorRows.length) await tx.insert(competitorSnapshots).values(competitorRows);
      await tx.insert(seoDataUsage).values({
        organizationId: project.organizationId,
        projectId,
        userId: user.id,
        provider: "dataforseo",
        operation: "organic-competitors",
        externalTaskId: task.taskId,
        estimatedCost: task.cost?.toFixed(8) ?? null
      });
    });
    return NextResponse.json({
      competitors: competitorRows,
      source: "DataForSEO",
      dataType: "provider-reported organic competitor overlap",
      locationName,
      languageCode,
      providerTaskId: task.taskId,
      providerCost: task.cost
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

function normalizeDomain(value: string) {
  try {
    const url = new URL(`https://${value}`);
    if (url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash) return null;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    if (!hostname || !hostname.includes(".") || hostname.length > 253) return null;
    return hostname;
  } catch { return null; }
}
