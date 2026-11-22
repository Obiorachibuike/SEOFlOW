import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { getMembershipForOrganization } from "@/lib/authz";
import { cancelPaystackSubscription, createStripeBillingPortal } from "@/lib/billing/payment";
import { HttpError, jsonError } from "@/lib/http";
import { decryptSecret } from "@/lib/secrets";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

export async function POST(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!user.emailVerified) throw new HttpError(403, "Verify your email before managing a subscription.", "EMAIL_NOT_VERIFIED");
    if (!await rateLimit(`billing-manage:${user.id}`)) return rateLimitResponse();
    const { organizationId } = await context.params;
    const membership = await getMembershipForOrganization(organizationId, user.id);
    if (!membership) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");
    if (!["owner", "admin"].includes(membership.role)) throw new HttpError(403, "Only workspace owners and admins can manage billing.", "BILLING_FORBIDDEN");
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.organizationId, organizationId)).limit(1);
    if (!subscription || !["stripe", "paystack"].includes(subscription.provider) || !["active", "trialing", "past_due"].includes(subscription.status)) {
      throw new HttpError(409, "No active online subscription is available to manage.", "SUBSCRIPTION_NOT_ACTIVE");
    }
    if (subscription.periodEnd && subscription.periodEnd <= new Date()) throw new HttpError(409, "This subscription period has ended.", "SUBSCRIPTION_EXPIRED");
    if (subscription.provider === "stripe") {
      if (!subscription.providerCustomerId) throw new HttpError(409, "The Stripe customer record is incomplete. Contact the deployment administrator.", "SUBSCRIPTION_CUSTOMER_MISSING");
      const url = await createStripeBillingPortal(subscription.providerCustomerId);
      return NextResponse.json({ url, action: "portal" }, { headers: { "Cache-Control": "no-store" } });
    }
    if (!subscription.providerSubscriptionId || !subscription.providerActionTokenCiphertext) {
      throw new HttpError(409, "Paystack has not supplied the verified subscription cancellation token for this workspace. Contact the workspace billing administrator.", "SUBSCRIPTION_MANAGEMENT_UNAVAILABLE");
    }
    const emailToken = decryptSecret(subscription.providerActionTokenCiphertext);
    await cancelPaystackSubscription(subscription.providerSubscriptionId, emailToken);
    await db.update(subscriptions).set({ status: "cancelled", providerActionTokenCiphertext: null, updatedAt: new Date() })
      .where(and(eq(subscriptions.id, subscription.id), inArray(subscriptions.status, ["active", "trialing", "past_due"])));
    return NextResponse.json({ cancelled: true, action: "cancelled", periodEnd: subscription.periodEnd?.toISOString() ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
