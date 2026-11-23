import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, aiModels } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { HttpError, jsonError, readJson } from "@/lib/http";

const schema = z.object({
  displayName: z.string().trim().min(1).max(100).optional(),
  capabilities: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
  inputCostPerMillion: z.number().finite().min(0).max(10_000).nullable().optional(),
  outputCostPerMillion: z.number().finite().min(0).max(10_000).nullable().optional(),
  enabled: z.boolean().optional()
}).strict().refine((value) => Object.keys(value).length > 0, "Provide at least one setting to update.");

export async function PATCH(request: Request, context: { params: Promise<{ modelId: string }> }) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const { modelId } = await context.params;
    const [existing] = await db.select().from(aiModels).where(eq(aiModels.id, modelId)).limit(1);
    if (!existing) throw new HttpError(404, "AI model not found.", "MODEL_NOT_FOUND");
    const input = schema.parse(await readJson(request));
    const [model] = await db.update(aiModels).set({
      ...(input.displayName ? { displayName: input.displayName } : {}),
      ...(input.capabilities ? { capabilities: input.capabilities } : {}),
      ...(input.inputCostPerMillion !== undefined ? { inputCostPerMillion: input.inputCostPerMillion?.toFixed(6) ?? null } : {}),
      ...(input.outputCostPerMillion !== undefined ? { outputCostPerMillion: input.outputCostPerMillion?.toFixed(6) ?? null } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {})
    }).where(eq(aiModels.id, modelId)).returning();
    await db.insert(adminAuditLogs).values({ actorId: user.id, action: "ai_model.updated", targetType: "ai_model", targetId: model.id, details: { modelId: model.modelId, enabled: model.enabled } });
    return NextResponse.json({ model });
  } catch (error) { return jsonError(error); }
}
