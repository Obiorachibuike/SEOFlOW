import { and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { plans, subscriptions } from "@/db/schema";

export interface PlanLimits {
  projectLimit: number;
  crawlPageLimit: number;
  trackedKeywordLimit: number;
  aiCredits: number;
  planName: string;
}

const freeLimits: PlanLimits = { projectLimit: 1, crawlPageLimit: 100, trackedKeywordLimit: 25, aiCredits: 20, planName: "Free" };

export async function getOrganizationPlan(organizationId: string, now = new Date()): Promise<PlanLimits> {
  const entitledStatus = or(
    and(inArray(subscriptions.status, ["active", "trialing"]), or(isNull(subscriptions.periodEnd), gt(subscriptions.periodEnd, now))),
    and(inArray(subscriptions.status, ["past_due", "cancelled"]), gt(subscriptions.periodEnd, now))
  );
  const [record] = await db.select({ plan: plans }).from(subscriptions)
    .innerJoin(plans, and(eq(plans.id, subscriptions.planId), eq(plans.enabled, true)))
    .where(and(eq(subscriptions.organizationId, organizationId), entitledStatus))
    .limit(1);
  return record?.plan ? {
    projectLimit: record.plan.projectLimit,
    crawlPageLimit: record.plan.crawlPageLimit,
    trackedKeywordLimit: record.plan.trackedKeywordLimit,
    aiCredits: record.plan.aiCredits,
    planName: record.plan.name
  } : freeLimits;
}
