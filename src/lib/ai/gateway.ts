import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { aiModels, aiProviders, aiTaskAssignments } from "@/db/schema";
import { completeWithProvider } from "@/lib/ai/providers";
import { decryptSecret } from "@/lib/secrets";

export async function runAiTask(task: string, prompt: { system: string; user: string }) {
  const candidates = await db.select({
    assignment: aiTaskAssignments,
    model: aiModels,
    provider: aiProviders
  }).from(aiTaskAssignments)
    .innerJoin(aiModels, eq(aiModels.id, aiTaskAssignments.modelId))
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .where(and(
      eq(aiTaskAssignments.task, task),
      eq(aiTaskAssignments.enabled, true),
      eq(aiModels.enabled, true),
      eq(aiProviders.enabled, true)
    ))
    .orderBy(asc(aiTaskAssignments.priority));

  const eligibleCandidates = candidates.length ? candidates : await db.select({
    assignment: aiTaskAssignments,
    model: aiModels,
    provider: aiProviders
  }).from(aiModels)
    .innerJoin(aiProviders, eq(aiProviders.id, aiModels.providerId))
    .leftJoin(aiTaskAssignments, and(eq(aiTaskAssignments.modelId, aiModels.id), eq(aiTaskAssignments.task, task)))
    .where(and(eq(aiProviders.slug, "agnes"), eq(aiModels.enabled, true), eq(aiProviders.enabled, true)))
    .orderBy(asc(aiModels.createdAt));

  if (eligibleCandidates.length === 0) throw new Error("No enabled AI model is assigned to this task. Ask an administrator to configure an Agnes AI model or set task routing.");
  const failures: string[] = [];
  for (const candidate of eligibleCandidates) {
    try {
      if (!candidate.provider.secretCiphertext) throw new Error("Provider credential is not configured.");
      const apiKey = decryptSecret(candidate.provider.secretCiphertext);
      const completion = await completeWithProvider(candidate.provider.adapter, {
        baseUrl: candidate.provider.baseUrl,
        apiKey,
        modelId: candidate.model.modelId,
        ...prompt
      });
      return { ...completion, provider: candidate.provider, model: candidate.model };
    } catch (error) {
      const message = error instanceof Error ? error.message : "provider request failed";
      console.warn("AI provider attempt failed", { provider: candidate.provider.slug, modelId: candidate.model.modelId, task, message });
      failures.push(`${candidate.provider.displayName}: ${message}`);
    }
  }
  throw new Error(`All configured AI models failed. ${failures.join("; ")}`);
}
