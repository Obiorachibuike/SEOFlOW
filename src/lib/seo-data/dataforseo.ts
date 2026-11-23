import { fetch as undiciFetch } from "undici";
import { z } from "zod";
import { createPinnedDispatcher, validatePublicDestination } from "@/lib/crawler/ssrf";
import { HttpError } from "@/lib/http";

const endpoint = "https://api.dataforseo.com/v3";
const successfulStatus = 20_000;
const responseLimit = 2_000_000;

const resultSchema = z.object({ items: z.array(z.unknown()).optional() }).passthrough();
const taskSchema = z.object({
  id: z.string().max(200).nullable().optional(),
  status_code: z.number().int(),
  status_message: z.string().max(2_000),
  cost: z.number().finite().nonnegative().nullable().optional(),
  result: z.array(resultSchema).nullable().optional()
}).passthrough();
const envelopeSchema = z.object({
  status_code: z.number().int(),
  status_message: z.string().max(2_000),
  tasks: z.array(taskSchema).optional()
}).passthrough();

export interface DataForSeoTaskResult {
  taskId: string | null;
  cost: number | null;
  items: unknown[];
}

export function dataForSeoCredentialsConfigured() {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export async function requestDataForSeo(path: string, task: Record<string, unknown>): Promise<DataForSeoTaskResult> {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new HttpError(503, "DataForSEO credentials are not configured for this deployment.", "SEO_DATA_PROVIDER_NOT_CONFIGURED");
  if (!/^\/[a-z0-9/_-]+$/i.test(path)) throw new HttpError(500, "Unsupported SEO data provider operation.", "SEO_DATA_OPERATION_INVALID");

  const destination = await validatePublicDestination(`${endpoint}${path}`);
  const dispatcher = createPinnedDispatcher(destination.hostname, destination.addresses);
  try {
    let response: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      response = await undiciFetch(destination.url, {
        method: "POST",
        redirect: "error",
        dispatcher,
        signal: AbortSignal.timeout(45_000),
        headers: {
          authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
          "content-type": "application/json",
          accept: "application/json"
        },
        body: JSON.stringify([task])
      });
    } catch {
      throw new HttpError(502, "DataForSEO could not be reached. Try again later.", "SEO_DATA_PROVIDER_UNAVAILABLE");
    }
    const text = await readResponseText(response, responseLimit);
    let parsed: unknown;
    try { parsed = JSON.parse(text) as unknown; }
    catch { throw new HttpError(502, "DataForSEO returned invalid JSON.", "SEO_DATA_PROVIDER_INVALID_RESPONSE"); }
    const validated = envelopeSchema.safeParse(parsed);
    if (!validated.success) throw new HttpError(502, "DataForSEO returned an unexpected response shape.", "SEO_DATA_PROVIDER_INVALID_RESPONSE");
    if (!response.ok) throw new HttpError(502, "DataForSEO rejected the request. Check provider credentials and account access.", "SEO_DATA_PROVIDER_ERROR");
    if (validated.data.status_code !== successfulStatus) throw new HttpError(502, "DataForSEO could not complete this request. Check the target location and provider account.", "SEO_DATA_PROVIDER_ERROR");
    const taskResult = validated.data.tasks?.[0];
    if (!taskResult || taskResult.status_code !== successfulStatus) throw new HttpError(502, "DataForSEO returned no successful task result.", "SEO_DATA_PROVIDER_ERROR");
    return {
      taskId: taskResult.id ?? null,
      cost: taskResult.cost ?? null,
      items: taskResult.result?.flatMap((result) => result.items ?? []) ?? []
    };
  } finally {
    await dispatcher.close().catch(() => undefined);
  }
}

const keywordInfoSchema = z.object({
  search_volume: z.number().int().nonnegative().nullable().optional(),
  cpc: z.number().finite().nonnegative().nullable().optional()
}).passthrough();
const keywordPropertiesSchema = z.object({
  keyword_difficulty: z.number().finite().min(0).max(100).nullable().optional()
}).passthrough();
const normalizedKeywordOverviewItemSchema = z.object({
  keyword_data: z.object({
    keyword: z.string().trim().min(1).max(200),
    keyword_info: keywordInfoSchema.optional(),
    keyword_properties: keywordPropertiesSchema.optional()
  }).passthrough(),
  keyword_properties: keywordPropertiesSchema.optional()
}).passthrough().transform((item) => ({
  keyword_data: item.keyword_data,
  keyword_properties: item.keyword_properties ?? item.keyword_data.keyword_properties
}));
const flatKeywordOverviewItemSchema = z.object({
  keyword: z.string().trim().min(1).max(200),
  keyword_info: keywordInfoSchema.optional(),
  keyword_properties: keywordPropertiesSchema.optional()
}).passthrough().transform((item) => ({
  keyword_data: { keyword: item.keyword, keyword_info: item.keyword_info },
  keyword_properties: item.keyword_properties
}));

// DataForSEO Labs versions have returned both a flat keyword item and a nested keyword_data item.
export const keywordOverviewItemSchema = z.union([normalizedKeywordOverviewItemSchema, flatKeywordOverviewItemSchema]);

export const backlinkSummarySchema = z.object({
  target: z.string().max(2_048).optional(),
  backlinks: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  referring_domains: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  referring_main_domains: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  referring_ips: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  rank: z.number().finite().nonnegative().nullable().optional()
}).passthrough();

const competitorDomainItemSchema = z.object({
  domain: z.string().trim().min(1).max(255),
  intersections: z.number().int().nonnegative().nullable().optional(),
  avg_position: z.number().finite().positive().nullable().optional()
}).passthrough().transform((item) => ({ ...item, competitor_domain: item.domain }));
const legacyCompetitorDomainItemSchema = z.object({
  competitor_domain: z.string().trim().min(1).max(255),
  intersections: z.number().int().nonnegative().nullable().optional(),
  avg_position: z.number().finite().positive().nullable().optional()
}).passthrough();
export const competitorItemSchema = z.union([competitorDomainItemSchema, legacyCompetitorDomainItemSchema]);

export function normalizeSearchLocation(countryCode: string) {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) throw new HttpError(400, "Set a valid two-letter target country on the project before requesting localized SEO metrics.", "SEO_DATA_LOCATION_REQUIRED");
  let location: string | undefined;
  try { location = new Intl.DisplayNames(["en"], { type: "region" }).of(code); }
  catch { /* validated below */ }
  if (!location || location.toUpperCase() === code) throw new HttpError(400, "This target country is not supported for localized SEO data.", "SEO_DATA_LOCATION_INVALID");
  return location;
}

export function normalizeSearchLanguage(language: string | null) {
  const code = (language ?? "en").trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(code)) throw new HttpError(400, "Set a valid language code on the project before requesting SEO metrics.", "SEO_DATA_LANGUAGE_INVALID");
  return code;
}

async function readResponseText(response: Awaited<ReturnType<typeof undiciFetch>>, maxBytes: number) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new HttpError(502, "DataForSEO response exceeded the size limit.", "SEO_DATA_PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, total)); }
  catch { throw new HttpError(502, "DataForSEO returned invalid text encoding.", "SEO_DATA_PROVIDER_INVALID_RESPONSE"); }
}
