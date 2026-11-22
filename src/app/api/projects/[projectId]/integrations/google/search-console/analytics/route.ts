import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { keywordMetrics, keywords } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { getGoogleSearchConsoleToken, fetchSearchAnalytics } from "@/lib/google/search-console";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const querySchema = z.object({
  startDate: z.string().date(),
  endDate: z.string().date(),
  dimensions: z.array(z.enum(["query", "page", "device", "country", "searchAppearance"])).min(1).max(5).default(["query"]),
  country: z.string().regex(/^[a-zA-Z]{3}$/).optional(),
  device: z.enum(["DESKTOP", "MOBILE", "TABLET"]).optional(),
  rowLimit: z.number().int().min(1).max(2_500).default(250)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`gsc:${user.id}`)) return rateLimitResponse();
    const { projectId } = await context.params;
    const { project } = await requireProject(projectId, user.id, ["owner", "admin", "seo_manager", "editor"]);
    const input = querySchema.parse(await readJson(request));
    if (input.endDate < input.startDate) throw new HttpError(400, "End date must not be earlier than start date.", "INVALID_DATE_RANGE");
    if (new Date(`${input.endDate}T00:00:00Z`).getTime() > Date.now() - 24 * 60 * 60_000) {
      throw new HttpError(400, "Search Console data is delayed; choose an end date at least one day in the past.", "GSC_DATA_DELAY");
    }
    const { token, integration } = await getGoogleSearchConsoleToken(projectId);
    if (!integration.externalPropertyId) throw new HttpError(409, "Select a Search Console property for this project first.", "GOOGLE_PROPERTY_NOT_SELECTED");
    const rows = await fetchSearchAnalytics({
      projectId,
      accessToken: token,
      propertyUrl: integration.externalPropertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      country: input.country?.toLowerCase(),
      device: input.device,
      rowLimit: input.rowLimit
    });

    const matchedMetrics = await persistTrackedQueryMetrics({ projectId, projectCountry: project.targetCountry, userId: user.id, rows, dimensions: input.dimensions, startDate: input.startDate, endDate: input.endDate });
    return NextResponse.json({
      source: "Google Search Console",
      property: integration.externalPropertyId,
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      rowCount: rows.length,
      savedTrackedKeywordMetrics: matchedMetrics,
      rows
    });
  } catch (error) { return jsonError(error); }
}

async function persistTrackedQueryMetrics(input: {
  projectId: string;
  projectCountry: string | null;
  userId: string;
  rows: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
  dimensions: string[];
  startDate: string;
  endDate: string;
}) {
  const queryIndex = input.dimensions.indexOf("query");
  if (queryIndex === -1) return 0;
  const tracked = await db.select().from(keywords).where(eq(keywords.projectId, input.projectId));
  const byPhrase = new Map(tracked.map((keyword) => [`${keyword.phrase.toLocaleLowerCase()}|${keyword.country ?? "global"}`, keyword]));
  const countryIndex = input.dimensions.indexOf("country");
  const rows = input.rows.flatMap((row) => {
    const phrase = row.keys?.[queryIndex];
    if (!phrase) return [];
    const country = countryIndex >= 0 ? row.keys?.[countryIndex] ?? input.projectCountry ?? "global" : input.projectCountry ?? "global";
    const keyword = byPhrase.get(`${phrase.toLocaleLowerCase()}|${country}`) ?? byPhrase.get(`${phrase.toLocaleLowerCase()}|global`);
    if (!keyword) return [];
    return [{
      keywordId: keyword.id,
      provider: "google-search-console",
      organicClicks: safeInteger(row.clicks),
      impressions: safeInteger(row.impressions),
      averagePosition: safeFloat(row.position),
      sourcePayload: { ctr: safeFloat(row.ctr), dimensions: input.dimensions, startDate: input.startDate, endDate: input.endDate }
    }];
  });
  for (let offset = 0; offset < rows.length; offset += 500) await db.insert(keywordMetrics).values(rows.slice(offset, offset + 500));
  return rows.length;
}

function safeInteger(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null; }
function safeFloat(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
