import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { aiModels, aiProviders } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { completeWithProvider } from "@/lib/ai/providers";
import { decryptSecret } from "@/lib/secrets";
import { HttpError, jsonError, readJson } from "@/lib/http";

const testSchema = z.object({ modelId: z.string().uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ providerId: string }> }) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const { providerId } = await context.params;
    const { modelId } = testSchema.parse(await readJson(request));
    const [provider] = await db.select().from(aiProviders).where(eq(aiProviders.id, providerId)).limit(1);
    const [model] = await db.select().from(aiModels).where(eq(aiModels.id, modelId)).limit(1);
    if (!provider || !model || model.providerId !== providerId) throw new HttpError(404, "Provider model not found.", "MODEL_NOT_FOUND");
    if (!provider.secretCiphertext) throw new HttpError(400, "This provider has no credential configured.", "CREDENTIAL_MISSING");
    const result = await completeWithProvider(provider.adapter, {
      baseUrl: provider.baseUrl,
      apiKey: decryptSecret(provider.secretCiphertext),
      modelId: model.modelId,
      system: "Return only the word CONNECTED.",
      user: "Connection test. Reply with CONNECTED.",
      timeoutMs: 20_000
    });
    return NextResponse.json({ ok: true, provider: provider.displayName, model: model.displayName, responseReceived: Boolean(result.content), usage: { inputTokens: result.inputTokens, outputTokens: result.outputTokens } });
  } catch (error) { return jsonError(error); }
}
