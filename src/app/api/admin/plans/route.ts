import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { adminAuditLogs, plans } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { requireAdmin } from "@/lib/authz";
import { jsonError, readJson } from "@/lib/http";

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  priceMonthly: z.number().finite().min(0).max(100_000),
  currency: z.string().length(3).toUpperCase(),
  crawlPageLimit: z.number().int().min(1).max(10_000),
  projectLimit: z.number().int().min(1).max(100_000),
  trackedKeywordLimit: z.number().int().min(0).max(10_000_000),
  aiCredits: z.number().int().min(0).max(10_000_000),
  stripePriceId: z.string().trim().max(150).transform((value) => value || null).nullable().optional(),
  paystackPlanCode: z.string().trim().max(100).transform((value) => value || null).nullable().optional(),
  enabled: z.boolean()
}).strict();

export async function GET() {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    return NextResponse.json({ plans: await db.select().from(plans).orderBy(asc(plans.priceMonthly)) });
  } catch (error) { return jsonError(error); }
}

export async function PUT(request: Request) {
  try {
    const user = await requireApiUser();
    await requireAdmin(user.id);
    const input = updateSchema.parse(await readJson(request));
    const [plan] = await db.update(plans).set({
      name: input.name,
      priceMonthly: input.priceMonthly.toFixed(2),
      currency: input.currency,
      crawlPageLimit: input.crawlPageLimit,
      projectLimit: input.projectLimit,
      trackedKeywordLimit: input.trackedKeywordLimit,
      aiCredits: input.aiCredits,
      ...(input.stripePriceId !== undefined ? { stripePriceId: input.stripePriceId } : {}),
      ...(input.paystackPlanCode !== undefined ? { paystackPlanCode: input.paystackPlanCode } : {}),
      enabled: input.enabled,
      updatedAt: new Date()
    }).where(eq(plans.id, input.id)).returning();
    if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    await db.insert(adminAuditLogs).values({ actorId: user.id, action: "subscription_plan.updated", targetType: "plan", targetId: plan.id, details: { slug: plan.slug, enabled: plan.enabled } });
    return NextResponse.json({ plan });
  } catch (error) { return jsonError(error); }
}
