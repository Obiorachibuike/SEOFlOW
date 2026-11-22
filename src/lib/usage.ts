import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { usageRecords } from "@/db/schema";
import { HttpError } from "@/lib/http";

export function currentUsagePeriod(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { periodStart, periodEnd };
}

/** Atomically reserve one monthly AI request credit across all application instances. */
export async function reserveAiCredit(organizationId: string, allowance: number, now = new Date()) {
  if (allowance <= 0) throw new HttpError(403, "Your current plan does not include AI credits.", "AI_CREDIT_LIMIT_REACHED");
  const { periodStart, periodEnd } = currentUsagePeriod(now);
  const [usage] = await db.insert(usageRecords).values({
    organizationId,
    metric: "ai_credits",
    quantity: 1,
    periodStart,
    periodEnd
  }).onConflictDoUpdate({
    target: [usageRecords.organizationId, usageRecords.metric, usageRecords.periodStart],
    set: { quantity: sql`${usageRecords.quantity} + 1`, periodEnd },
    setWhere: sql`${usageRecords.quantity} < ${allowance}`
  }).returning({ quantity: usageRecords.quantity });
  if (!usage) throw new HttpError(403, "Your workspace has used all AI credits for this billing month.", "AI_CREDIT_LIMIT_REACHED");
  return { ...usage, periodStart, periodEnd };
}

/** Release a reserved credit when no model returned a successful completion. */
export async function releaseAiCredit(organizationId: string, periodStart: Date) {
  await db.update(usageRecords).set({ quantity: sql`GREATEST(${usageRecords.quantity} - 1, 0)` })
    .where(and(
      eq(usageRecords.organizationId, organizationId),
      eq(usageRecords.metric, "ai_credits"),
      eq(usageRecords.periodStart, periodStart)
    ));
}

export async function getOrganizationUsage(organizationId: string, now = new Date()) {
  const { periodStart, periodEnd } = currentUsagePeriod(now);
  const records = await db.select({ metric: usageRecords.metric, quantity: usageRecords.quantity }).from(usageRecords)
    .where(and(eq(usageRecords.organizationId, organizationId), eq(usageRecords.periodStart, periodStart)));
  return {
    periodStart,
    periodEnd,
    aiCredits: records.find((record) => record.metric === "ai_credits")?.quantity ?? 0,
    crawledPages: records.find((record) => record.metric === "crawled_pages")?.quantity ?? 0
  };
}
