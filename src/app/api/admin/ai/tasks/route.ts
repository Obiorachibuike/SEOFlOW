import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, aiModels, aiProviders, aiTaskAssignments } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { jsonError, readJson } from "@/lib/http";

const assignmentSchema = z.object({
  task: z.string().trim().min(2).max(100).regex(/^[a-z0-9][a-z0-9_-]+$/),
  modelIds: z.array(z.string().uuid()).min(1).max(10)
}).strict();

export async function GET() {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const rows = await db.select({ assignment: aiTaskAssignments, model: aiModels, provider: aiProviders })
      .from(aiTaskAssignments).innerJoin(aiModels, eq(aiModels.id, aiTaskAssignments.modelId))
      .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
      .orderBy(asc(aiTaskAssignments.task), asc(aiTaskAssignments.priority));
    return NextResponse.json({ assignments: rows.map(({ assignment, model, provider }) => ({
      task: assignment.task, priority: assignment.priority, enabled: assignment.enabled,
      model: { id: model.id, modelId: model.modelId, displayName: model.displayName },
      provider: { id: provider.id, slug: provider.slug, displayName: provider.displayName }
    })) });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const input = assignmentSchema.parse(await readJson(request));
    const registered = await db.select({ id: aiModels.id }).from(aiModels).where(eq(aiModels.enabled, true));
    const registeredIds = new Set(registered.map((model) => model.id));
    if (input.modelIds.some((id) => !registeredIds.has(id))) {
      return NextResponse.json({ error: "Every selected model must exist and be enabled." }, { status: 400 });
    }
    await db.transaction(async (tx) => {
      await tx.delete(aiTaskAssignments).where(eq(aiTaskAssignments.task, input.task));
      await tx.insert(aiTaskAssignments).values(input.modelIds.map((modelId, priority) => ({ task: input.task, modelId, priority, enabled: true })));
      await tx.insert(adminAuditLogs).values({ actorId: user.id, action: "ai_task.routing_updated", targetType: "ai_task", targetId: input.task, details: { modelIds: input.modelIds } });
    });
    return NextResponse.json({ ok: true, task: input.task, modelCount: input.modelIds.length });
  } catch (error) { return jsonError(error); }
}
