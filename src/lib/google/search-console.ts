import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { projectIntegrations, projects } from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { HttpError } from "@/lib/http";
import { parseSafeHttpUrl } from "@/lib/crawler/ssrf";

export interface GoogleTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
}

export async function getGoogleSearchConsoleToken(projectId: string): Promise<{ token: string; integration: typeof projectIntegrations.$inferSelect }> {
  const [integration] = await db.select().from(projectIntegrations).where(and(
    eq(projectIntegrations.projectId, projectId),
    eq(projectIntegrations.provider, "google-search-console")
  )).limit(1);
  if (!integration?.credentialsCiphertext) throw new HttpError(409, "Connect a Google account before requesting Search Console data.", "GOOGLE_NOT_CONNECTED");
  const credentials = decodeTokens(integration.credentialsCiphertext);
  if (credentials.expiresAt > Date.now() + 60_000) return { token: credentials.accessToken, integration };
  if (!credentials.refreshToken) throw new HttpError(401, "The Google authorization expired. Reconnect Search Console.", "GOOGLE_REAUTH_REQUIRED");
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new HttpError(503, "Google Search Console OAuth credentials are not configured.", "GOOGLE_CONFIG_MISSING");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new HttpError(502, "Google could not refresh the Search Console authorization. Reconnect the integration.", "GOOGLE_TOKEN_REFRESH_FAILED");
  const refreshed = parseTokenResponse(await response.json() as unknown);
  const savedTokens: GoogleTokenSet = { accessToken: refreshed.access_token, refreshToken: refreshed.refresh_token ?? credentials.refreshToken, expiresAt: Date.now() + refreshed.expires_in * 1_000 };
  const [updated] = await db.update(projectIntegrations).set({ credentialsCiphertext: encodeTokens(savedTokens), updatedAt: new Date() })
    .where(eq(projectIntegrations.id, integration.id)).returning();
  return { token: savedTokens.accessToken, integration: updated };
}

export async function listSearchConsoleProperties(accessToken: string) {
  const response = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(15_000)
  });
  const payload = await response.json().catch(() => ({})) as { siteEntry?: Array<{ siteUrl: string; permissionLevel: string }>; error?: { message?: string } };
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : 502, "Google Search Console could not return your site properties.", "GOOGLE_PROPERTIES_FAILED");
  return (payload.siteEntry ?? []).map((item) => ({ siteUrl: item.siteUrl, permissionLevel: item.permissionLevel }));
}

export async function fetchSearchAnalytics(input: {
  projectId: string;
  accessToken: string;
  propertyUrl: string;
  startDate: string;
  endDate: string;
  dimensions: Array<"query" | "page" | "device" | "country" | "searchAppearance">;
  country?: string;
  device?: "DESKTOP" | "MOBILE" | "TABLET";
  rowLimit: number;
}) {
  const [projectProperty] = await db.select({ project: projects }).from(projectIntegrations)
    .innerJoin(projects, eq(projects.id, projectIntegrations.projectId))
    .where(and(eq(projectIntegrations.projectId, input.projectId), eq(projectIntegrations.externalPropertyId, input.propertyUrl), eq(projectIntegrations.provider, "google-search-console"))).limit(1);
  if (!projectProperty) throw new HttpError(404, "The selected Search Console property is not connected to this project.", "GOOGLE_PROPERTY_NOT_SELECTED");
  const url = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.propertyUrl)}/searchAnalytics/query`;
  const filterGroups: Array<{ groupType: "and"; filters: Array<{ dimension: string; operator: "equals"; expression: string }> }> = [];
  const filters: Array<{ dimension: string; operator: "equals"; expression: string }> = [];
  if (input.country) filters.push({ dimension: "country", operator: "equals", expression: input.country.toLowerCase() });
  if (input.device) filters.push({ dimension: "device", operator: "equals", expression: input.device });
  if (filters.length) filterGroups.push({ groupType: "and", filters });
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${input.accessToken}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      startDate: input.startDate,
      endDate: input.endDate,
      dimensions: input.dimensions,
      searchType: "web",
      aggregationType: "auto",
      rowLimit: input.rowLimit,
      startRow: 0,
      ...(filterGroups.length ? { dimensionFilterGroups: filterGroups } : {})
    }),
    signal: AbortSignal.timeout(30_000)
  });
  const payload = await response.json().catch(() => ({})) as {
    rows?: Array<{ keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number }>;
    error?: { message?: string };
  };
  if (!response.ok) throw new HttpError(response.status === 401 ? 401 : response.status === 429 ? 429 : 502, response.status === 429 ? "Google Search Console quota reached. Try again later." : "Google Search Console could not return search analytics.", "GOOGLE_ANALYTICS_FAILED");
  return payload.rows ?? [];
}

export async function verifyPropertyMatchesProject(projectId: string, propertyUrl: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return false;
  let projectHost: string;
  try { projectHost = parseSafeHttpUrl(project.websiteUrl).hostname.replace(/^www\./i, "").toLowerCase(); }
  catch { return false; }
  if (propertyUrl.startsWith("sc-domain:")) return propertyUrl.slice("sc-domain:".length).replace(/^www\./i, "").toLowerCase() === projectHost;
  try {
    const propertyHost = new URL(propertyUrl).hostname.replace(/^www\./i, "").toLowerCase();
    return propertyHost === projectHost;
  } catch { return false; }
}

export async function saveGoogleTokens(input: { projectId: string; accessToken: string; refreshToken?: string; expiresIn: number; scope?: string }) {
  const credentials: GoogleTokenSet = { accessToken: input.accessToken, refreshToken: input.refreshToken ?? null, expiresAt: Date.now() + input.expiresIn * 1_000 };
  const [integration] = await db.insert(projectIntegrations).values({
    projectId: input.projectId,
    provider: "google-search-console",
    credentialsCiphertext: encodeTokens(credentials),
    settings: { scopes: input.scope?.split(" ") ?? [] },
    connectedAt: new Date()
  }).onConflictDoUpdate({
    target: [projectIntegrations.projectId, projectIntegrations.provider],
    set: { credentialsCiphertext: encodeTokens(credentials), settings: { scopes: input.scope?.split(" ") ?? [] }, connectedAt: new Date(), updatedAt: new Date() }
  }).returning();
  return integration;
}

export function parseTokenResponse(value: unknown): GoogleTokenResponse {
  if (!value || typeof value !== "object") throw new HttpError(502, "Google returned an invalid authorization response.", "GOOGLE_TOKEN_INVALID");
  const record = value as Record<string, unknown>;
  if (typeof record.access_token !== "string" || !record.access_token || typeof record.expires_in !== "number" || record.expires_in <= 0) {
    throw new HttpError(502, "Google returned an incomplete authorization response.", "GOOGLE_TOKEN_INVALID");
  }
  return { access_token: record.access_token, expires_in: record.expires_in, ...(typeof record.refresh_token === "string" ? { refresh_token: record.refresh_token } : {}), ...(typeof record.token_type === "string" ? { token_type: record.token_type } : {}), ...(typeof record.scope === "string" ? { scope: record.scope } : {}) };
}

function encodeTokens(tokens: GoogleTokenSet) { return encryptSecret(JSON.stringify(tokens)); }
function decodeTokens(ciphertext: string): GoogleTokenSet {
  let value: unknown;
  try { value = JSON.parse(decryptSecret(ciphertext)); } catch { throw new HttpError(500, "Stored Google authorization could not be decrypted.", "GOOGLE_CREDENTIAL_DECRYPTION_FAILED"); }
  if (!value || typeof value !== "object" || typeof (value as GoogleTokenSet).accessToken !== "string" || typeof (value as GoogleTokenSet).expiresAt !== "number") {
    throw new HttpError(500, "Stored Google authorization is invalid.", "GOOGLE_CREDENTIAL_INVALID");
  }
  return value as GoogleTokenSet;
}
