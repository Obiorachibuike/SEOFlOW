import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, aiModels, aiProviders } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { encryptSecret } from "@/lib/secrets";
import { parseSafeHttpUrl, validatePublicDestination } from "@/lib/crawler/ssrf";
import { HttpError, jsonError, readJson } from "@/lib/http";

const createProviderSchema = z.object({
  slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,48}$/),
  displayName: z.string().trim().min(2).max(100),
  adapter: z.enum(["agnes-openai-compatible", "openai-compatible", "huggingface-chat-compatible"]),
  baseUrl: z.string().url().max(500),
  apiKey: z.string().trim().min(1).max(2_000),
  enabled: z.boolean().default(false)
}).strict();

export async function GET() {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const providers = await db.select().from(aiProviders).orderBy(desc(aiProviders.createdAt));
    const models = await db.select({ id: aiModels.id, providerId: aiModels.providerId, modelId: aiModels.modelId, displayName: aiModels.displayName, capabilities: aiModels.capabilities, enabled: aiModels.enabled })
      .from(aiModels).orderBy(desc(aiModels.createdAt));
    return NextResponse.json({ providers: providers.map(({ secretCiphertext, ...provider }) => ({ ...provider, credentialsConfigured: Boolean(secretCiphertext), secretCiphertext: undefined, models: models.filter((model) => model.providerId === provider.id) })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const input = createProviderSchema.parse(await readJson(request));
    const parsed = parseSafeHttpUrl(input.baseUrl);
    if (parsed.protocol !== "https:") throw new HttpError(400, "AI provider endpoints must use HTTPS.", "INVALID_PROVIDER_URL");
    await validatePublicDestination(parsed);
    const [provider] = await db.insert(aiProviders).values({
      slug: input.slug,
      displayName: input.displayName,
      adapter: input.adapter,
      baseUrl: parsed.toString().replace(/\/$/, ""),
      secretCiphertext: encryptSecret(input.apiKey),
      enabled: input.enabled,
      createdBy: user.id
    }).returning();
    await db.insert(adminAuditLogs).values({ actorId: user.id, action: "ai_provider.created", targetType: "ai_provider", targetId: provider.id, details: { slug: provider.slug, displayName: provider.displayName, adapter: provider.adapter } });
    return NextResponse.json({ provider: { id: provider.id, slug: provider.slug, displayName: provider.displayName, adapter: provider.adapter, baseUrl: provider.baseUrl, enabled: provider.enabled, credentialsConfigured: true } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
