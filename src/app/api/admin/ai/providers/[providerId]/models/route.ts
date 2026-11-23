import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, aiModels, aiProviders } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { HttpError, jsonError, readJson } from "@/lib/http";

const modelSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(100),
  capabilities: z.array(z.string().trim().min(1).max(60)).max(50).default([]),
  inputCostPerMillion: z.number().finite().min(0).max(10_000).optional(),
  outputCostPerMillion: z.number().finite().min(0).max(10_000).optional(),
  enabled: z.boolean().default(true)
}).strict();

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const { providerId } = await context.params;
    const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
    if (!provider) throw new HttpError(404, "AI provider not found.", "PROVIDER_NOT_FOUND");
    const input = modelSchema.parse(await readJson(request));
    const [model] = await db.insert(aiModels).values({
      providerId,
      modelId: input.modelId,
      displayName: input.displayName,
      capabilities: input.capabilities,
      inputCostPerMillion: input.inputCostPerMillion?.toFixed(6) ?? null,
      outputCostPerMillion: input.outputCostPerMillion?.toFixed(6) ?? null,
      enabled: input.enabled
    }).returning();
    await db.insert(adminAuditLogs).values({ actorId: user.id, action: "ai_model.created", targetType: "ai_model", targetId: model.id, details: { providerId, modelId: model.modelId, displayName: model.displayName } });
    return NextResponse.json({ model }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
