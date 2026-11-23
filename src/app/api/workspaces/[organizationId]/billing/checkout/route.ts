import { randomUUID } from "node:crypto";
import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { billingCheckoutSessions, organizations, plans, subscriptions } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { getMembershipForOrganization } from "@/lib/authz";
import { configuredPaymentProvider, createSubscriptionCheckout } from "@/lib/billing/payment";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const checkoutSchema = z.object({ planId: z.string().uuid() }).strict();
const checkoutLifetimeMs = 24 * 60 * 60 * 1_000;

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!user.emailVerified) throw new HttpError(403, "Verify your email before starting a subscription.", "EMAIL_NOT_VERIFIED");
    if (!await rateLimit(`billing-checkout:${user.id}`)) return rateLimitResponse();
    const { organizationId } = await context.params;
    const membership = await getMembershipForOrganization(organizationId, user.id);
    if (!membership) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");
    if (!["owner", "admin"].includes(membership.role)) throw new HttpError(403, "Only workspace owners and admins can change billing.", "BILLING_FORBIDDEN");

    const { planId } = checkoutSchema.parse(await readJson(request));
    const [plan] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!plan || !plan.enabled) throw new HttpError(404, "This subscription plan is unavailable.", "PLAN_NOT_FOUND");
    if (Number(plan.priceMonthly) <= 0) throw new HttpError(400, "The free plan does not require checkout.", "FREE_PLAN_CHECKOUT_UNAVAILABLE");
    const provider = configuredPaymentProvider();
    if (!provider) throw new HttpError(503, "Online billing is not configured for this deployment.", "BILLING_NOT_CONFIGURED");

    const now = new Date();
    const reference = `seoflow_${randomUUID()}`;
    const preparation = await db.transaction(async (tx) => {
      const [organization] = await tx.select({ id: organizations.id }).from(organizations)
        .where(eq(organizations.id, organizationId)).for("update").limit(1);
      if (!organization) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");

      const [current] = await tx.select({ subscription: subscriptions, plan: plans }).from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId)).where(eq(subscriptions.organizationId, organizationId)).limit(1);
      if (current && Number(current.plan.priceMonthly) > 0
        && ["active", "trialing", "past_due", "cancelled"].includes(current.subscription.status)
        && (!current.subscription.periodEnd || current.subscription.periodEnd > now)) {
        throw new HttpError(409, "This workspace already has a paid subscription period. Manage or cancel the existing subscription before starting another checkout.", "SUBSCRIPTION_ALREADY_ACTIVE");
      }

      await tx.update(billingCheckoutSessions).set({ status: "expired", updatedAt: now }).where(and(
        eq(billingCheckoutSessions.organizationId, organizationId),
        inArray(billingCheckoutSessions.status, ["creating", "pending"]),
        lte(billingCheckoutSessions.expiresAt, now)
      ));
      const [pending] = await tx.select().from(billingCheckoutSessions).where(and(
        eq(billingCheckoutSessions.organizationId, organizationId),
        inArray(billingCheckoutSessions.status, ["creating", "pending"]),
        gt(billingCheckoutSessions.expiresAt, now)
      )).limit(1);
      if (pending) {
        if (pending.provider === provider && pending.planId === planId && pending.checkoutUrl) {
          return { existingUrl: pending.checkoutUrl, id: null as string | null };
        }
        throw new HttpError(409, "This workspace already has a pending checkout. Complete or wait for it to expire before starting another.", "CHECKOUT_ALREADY_PENDING");
      }
      const [created] = await tx.insert(billingCheckoutSessions).values({
        organizationId,
        planId,
        provider,
        reference,
        status: "creating",
        expiresAt: new Date(now.getTime() + checkoutLifetimeMs)
      }).returning({ id: billingCheckoutSessions.id });
      return { existingUrl: null, id: created.id };
    });
    if (preparation.existingUrl) return NextResponse.json({ url: preparation.existingUrl, provider, reused: true }, { headers: { "Cache-Control": "no-store" } });
    if (!preparation.id) throw new HttpError(500, "The checkout session could not be prepared.", "CHECKOUT_SESSION_FAILED");
    const sessionId = preparation.id;
    try {
      const checkout = await createSubscriptionCheckout({ plan, provider, organizationId, userEmail: user.email, reference });
      await db.update(billingCheckoutSessions).set({
        providerCheckoutId: checkout.providerCheckoutId,
        checkoutUrl: checkout.url,
        status: "pending",
        updatedAt: new Date()
      }).where(and(eq(billingCheckoutSessions.id, sessionId), eq(billingCheckoutSessions.status, "creating")));
      return NextResponse.json({ url: checkout.url, provider, reused: false }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      await db.update(billingCheckoutSessions).set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(billingCheckoutSessions.id, sessionId), eq(billingCheckoutSessions.status, "creating")))
        .catch((updateError: unknown) => console.error("Could not mark failed checkout", updateError instanceof Error ? updateError.message : "database error"));
      throw error;
    }
  } catch (error) { return jsonError(error); }
}
