import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, aiProviders } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/secrets";
import { parseSafeHttpUrl, validatePublicDestination } from "@/lib/crawler/ssrf";
import { HttpError, jsonError, readJson } from "@/lib/http";

const schema = z.object({
  displayName: z.string().trim().min(2).max(100).optional(),
  adapter: z.enum(["agnes-openai-compatible", "openai-compatible", "huggingface-chat-compatible"]).optional(),
  baseUrl: z.string().url().max(500).optional(),
  apiKey: z.string().trim().min(1).max(2_000).optional(),
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one setting to update.");

export async function PATCH(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const { providerId } = await context.params;
    const [existing] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
    if (!existing) throw new HttpError(404, "AI provider not found.", "PROVIDER_NOT_FOUND");
    const input = schema.parse(await readJson(request));
    const baseUrl = input.baseUrl ? parseSafeHttpUrl(input.baseUrl) : new URL(existing.baseUrl);
    if (baseUrl.protocol !== "https:") throw new HttpError(400, "AI provider endpoints must use HTTPS.", "INVALID_PROVIDER_URL");
    if (input.baseUrl) await validatePublicDestination(baseUrl);
    const secretCiphertext = input.apiKey ? encryptSecret(input.apiKey) : existing.secretCiphertext;
    if (input.enabled === true && !secretCiphertext) throw new HttpError(400, "Add a credential before enabling this provider.", "CREDENTIAL_MISSING");
    const [provider] = await db.update(aiProviders).set({
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.adapter ? { adapter: input.adapter } : {}),
      ...(input.baseUrl ? { baseUrl: baseUrl.toString().replace(/\/$/, "") } : {}),
      ...(input.apiKey ? { secretCiphertext } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      updatedAt: new Date()
    }).where(eq(aiProviders.id, providerId)).returning();
    await db.insert(adminAuditLogs).values({ actorId: user.id, action: "ai_provider.updated", targetType: "ai_provider", targetId: provider.id, details: { slug: provider.slug, enabled: provider.enabled, credentialsRotated: Boolean(input.apiKey) } });
    return NextResponse.json({ provider: { id: provider.id, slug: provider.slug, displayName: provider.displayName, adapter: provider.adapter, baseUrl: provider.baseUrl, enabled: provider.enabled, credentialsConfigured: Boolean(secretCiphertext) } });
  } catch (error) { return jsonError(error); }
}
