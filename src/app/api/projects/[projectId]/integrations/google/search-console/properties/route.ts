import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { projectIntegrations } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { getGoogleSearchConsoleToken, listSearchConsoleProperties, verifyPropertyMatchesProject } from "@/lib/google/search-console";
import { HttpError, jsonError, readJson } from "@/lib/http";

const selectSchema = z.object({ siteUrl: z.string().trim().min(1).max(2048) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id);
    const { token, integration } = await getGoogleSearchConsoleToken(projectId);
    const properties = await listSearchConsoleProperties(token);
    const allowed = await Promise.all(properties.map(async (property) => ({ ...property, matchesProject: await verifyPropertyMatchesProject(projectId, property.siteUrl) })));
    return NextResponse.json({ properties: allowed, selectedProperty: integration.externalPropertyId });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    const { siteUrl } = selectSchema.parse(await readJson(request));
    const { token, integration } = await getGoogleSearchConsoleToken(projectId);
    const properties = await listSearchConsoleProperties(token);
    if (!properties.some((property) => property.siteUrl === siteUrl)) throw new HttpError(403, "This Google account does not have access to the selected Search Console property.", "GOOGLE_PROPERTY_FORBIDDEN");
    if (!await verifyPropertyMatchesProject(projectId, siteUrl)) throw new HttpError(400, "Choose a Search Console property whose domain matches this project.", "GOOGLE_PROPERTY_DOMAIN_MISMATCH");
    const [updated] = await db.update(projectIntegrations).set({ externalPropertyId: siteUrl, accountLabel: siteUrl, updatedAt: new Date() })
      .where(and(eq(projectIntegrations.id, integration.id), eq(projectIntegrations.projectId, projectId))).returning();
    return NextResponse.json({ selectedProperty: updated.externalPropertyId });
  } catch (error) { return jsonError(error); }
}
