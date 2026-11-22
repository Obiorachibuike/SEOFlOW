import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { keywordMetrics, keywords, seoDataUsage } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { keywordOverviewItemSchema, normalizeSearchLanguage, normalizeSearchLocation, requestDataForSeo } from "@/lib/seo-data/dataforseo";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const requestSchema = z.object({ keywordIds: z.array(z.string().uuid()).min(1).max(100).refine((ids) => new Set(ids).size === ids.length).optional() }).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`seo-data:${user.id}`, 5)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const input = requestSchema.parse(await readJson(request));
    const keywordRows = await db.select().from(keywords).where(and(
      eq(keywords.projectId, projectId),
      ...(input.keywordIds ? [inArray(keywords.id, input.keywordIds)] : [])
    )).orderBy(keywords.createdAt).limit(100);
    if (input.keywordIds && keywordRows.length !== input.keywordIds.length) throw new HttpError(404, "One or more selected keywords do not belong to this project.", "KEYWORD_NOT_FOUND");
    if (!keywordRows.length) throw new HttpError(409, "Track one or more keywords before requesting provider metrics.", "KEYWORDS_REQUIRED");

    const locationName = normalizeSearchLocation(project.targetCountry ?? "");
    const languageCode = normalizeSearchLanguage(project.targetLanguage);
    const task = await requestDataForSeo("/dataforseo_labs/google/keyword_overview/live", {
      keywords: keywordRows.map((keyword) => keyword.phrase),
      location_name: locationName,
      language_code: languageCode
    });
    const tracked = new Map(keywordRows.map((keyword) => [normalize(keyword.phrase), keyword]));
    const metricRows = task.items.flatMap((item) => {
      const parsed = keywordOverviewItemSchema.safeParse(item);
      if (!parsed.success) return [];
      const record = parsed.data;
      const keyword = tracked.get(normalize(record.keyword_data.keyword));
      if (!keyword) return [];
      const searchVolume = record.keyword_data.keyword_info?.search_volume ?? null;
      const cpc = record.keyword_data.keyword_info?.cpc;
      const difficulty = record.keyword_properties?.keyword_difficulty ?? null;
      if (searchVolume === null && cpc === undefined && difficulty === null) return [];
      return [{
        keywordId: keyword.id,
        provider: "dataforseo",
        estimatedSearchVolume: searchVolume,
        difficulty,
        cpc: cpc === null || cpc === undefined ? null : cpc.toFixed(4),
        sourcePayload: {
          taskId: task.taskId,
          locationName,
          languageCode,
          retrievedAt: new Date().toISOString(),
          dataType: "provider-estimated keyword metrics"
        }
      }];
    });

    await db.transaction(async (tx) => {
      for (let offset = 0; offset < metricRows.length; offset += 500) {
        await tx.insert(keywordMetrics).values(metricRows.slice(offset, offset + 500));
      }
      await tx.insert(seoDataUsage).values({
        organizationId: project.organizationId,
        projectId,
        userId: user.id,
        provider: "dataforseo",
        operation: "keyword-overview",
        externalTaskId: task.taskId,
        estimatedCost: task.cost?.toFixed(8) ?? null
      });
    });
    return NextResponse.json({
      source: "DataForSEO",
      dataType: "provider-estimated search volume, difficulty and CPC",
      locationName,
      languageCode,
      trackedKeywords: keywordRows.length,
      metricsSaved: metricRows.length,
      providerTaskId: task.taskId,
      providerCost: task.cost
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}

function normalize(value: string) { return value.trim().toLocaleLowerCase(); }
