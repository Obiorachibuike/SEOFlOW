import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { billingCheckoutSessions, organizations, paymentWebhookEvents, plans, subscriptions } from "@/db/schema";
import { addUtcMonth } from "@/lib/billing/payment";
import { encryptSecret } from "@/lib/secrets";

const stripeEnvelopeSchema = z.object({
  id: z.string().min(1).max(255),
  type: z.string().min(1).max(120),
  data: z.object({ object: z.record(z.string(), z.unknown()) })
}).passthrough();

const paystackEnvelopeSchema = z.object({
  event: z.string().min(1).max(120),
  data: z.record(z.string(), z.unknown())
}).passthrough();

const paymentMetadataSchema = z.object({
  seoflow_organization_id: z.string().uuid(),
  seoflow_plan_id: z.string().uuid()
}).passthrough();

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function handleStripeWebhook(rawBody: string) {
  const parsed = stripeEnvelopeSchema.safeParse(parseJson(rawBody));
  if (!parsed.success) throw new Error("Stripe webhook payload did not match the expected event format.");
  const event = parsed.data;
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(paymentWebhookEvents).values({ provider: "stripe", eventId: event.id, eventType: event.type }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
    if (!inserted) return { duplicate: true };
    await applyStripeEvent(tx, event.type, event.data.object);
    return { duplicate: false };
  });
}

export async function handlePaystackWebhook(rawBody: string) {
  const parsed = paystackEnvelopeSchema.safeParse(parseJson(rawBody));
  if (!parsed.success) throw new Error("Paystack webhook payload did not match the expected event format.");
  const event = parsed.data;
  const dataId = getString(event.data.id) ?? getString(event.data.reference) ?? getString(asRecord(event.data.subscription)?.subscription_code);
  const eventId = dataId ? `${event.event}:${dataId}`.slice(0, 255) : createHash("sha256").update(rawBody).digest("hex");
  return db.transaction(async (tx) => {
    const [inserted] = await tx.insert(paymentWebhookEvents).values({ provider: "paystack", eventId, eventType: event.event }).onConflictDoNothing().returning({ id: paymentWebhookEvents.id });
    if (!inserted) return { duplicate: true };
    await applyPaystackEvent(tx, event.event, event.data);
    return { duplicate: false };
  });
}

async function applyStripeEvent(tx: DbTransaction, type: string, data: Record<string, unknown>) {
  if (type === "checkout.session.expired" || type === "checkout.session.async_payment_failed") {
    const reference = getString(asRecord(data.metadata)?.seoflow_reference);
    if (reference) await setCheckoutStatus(tx, reference, type === "checkout.session.expired" ? "expired" : "failed");
    return;
  }

  if (type === "checkout.session.completed") {
    if (data.mode !== "subscription" || data.payment_status !== "paid") return;
    const subscriptionId = objectId(data.subscription);
    if (!subscriptionId) return;
    const metadata = paymentMetadataSchema.safeParse(data.metadata);
    if (!metadata.success) return;
    await lockOrganization(tx, metadata.data.seoflow_organization_id);
    const checkoutReference = getString(asRecord(data.metadata)?.seoflow_reference);
    if (checkoutReference) await setCheckoutStatus(tx, checkoutReference, "completed");
    const customerId = objectId(data.customer);
    const now = new Date();
    await activateSubscription(tx, {
      organizationId: metadata.data.seoflow_organization_id,
      planId: metadata.data.seoflow_plan_id,
      provider: "stripe",
      providerCustomerId: customerId,
      providerSubscriptionId: subscriptionId,
      status: "active",
      periodStart: now,
      periodEnd: addUtcMonth(now)
    });
    return;
  }

  if (type.startsWith("customer.subscription.")) {
    const subscriptionId = getString(data.id);
    if (!subscriptionId) return;
    const metadata = paymentMetadataSchema.safeParse(data.metadata);
    const current = await findSubscription(tx, "stripe", subscriptionId);
    if (!metadata.success && !current) return;
    const rawStatus = type === "customer.subscription.deleted" ? "canceled" : getString(data.status) ?? "incomplete";
    const start = unixDate(data.current_period_start) ?? current?.periodStart ?? new Date();
    const end = unixDate(data.current_period_end) ?? current?.periodEnd ?? addUtcMonth(start);
    await activateSubscription(tx, {
      organizationId: metadata.success ? metadata.data.seoflow_organization_id : current!.organizationId,
      planId: metadata.success ? metadata.data.seoflow_plan_id : current!.planId,
      provider: "stripe",
      providerCustomerId: objectId(data.customer) ?? current?.providerCustomerId ?? null,
      providerSubscriptionId: subscriptionId,
      status: stripeStatus(rawStatus),
      periodStart: start,
      periodEnd: end
    });
    return;
  }

  if (type === "invoice.paid" || type === "invoice.payment_succeeded" || type === "invoice.payment_failed") {
    const subscriptionId = objectId(data.subscription);
    if (!subscriptionId) return;
    const current = await findSubscription(tx, "stripe", subscriptionId);
    if (!current) return;
    const lineData = asRecord(asRecord(data.lines)?.data && Array.isArray(asRecord(data.lines)?.data) ? (asRecord(data.lines)?.data as unknown[])[0] : null);
    const period = asRecord(lineData?.period);
    const periodStart = unixDate(period?.start) ?? current.periodStart ?? new Date();
    const periodEnd = unixDate(period?.end) ?? current.periodEnd ?? addUtcMonth(periodStart);
    await tx.update(subscriptions).set({
      status: type === "invoice.payment_failed" ? "past_due" : "active",
      periodStart,
      periodEnd,
      updatedAt: new Date()
    }).where(and(eq(subscriptions.provider, "stripe"), eq(subscriptions.providerSubscriptionId, subscriptionId)));
  }
}

async function applyPaystackEvent(tx: DbTransaction, type: string, data: Record<string, unknown>) {
  if (type === "charge.failed") {
    const reference = getString(asRecord(data.metadata)?.seoflow_reference) ?? getString(data.reference);
    if (reference) await setCheckoutStatus(tx, reference, "failed");
    return;
  }

  if (type === "subscription.create") {
    const subscriptionData = asRecord(data.subscription) ?? data;
    const subscriptionCode = getString(subscriptionData.subscription_code) ?? getString(data.subscription_code);
    const customerCode = getString(asRecord(data.customer)?.customer_code) ?? getString(asRecord(subscriptionData.customer)?.customer_code);
    const emailToken = getString(data.email_token) ?? getString(subscriptionData.email_token);
    if (subscriptionCode && customerCode) {
      await tx.update(subscriptions).set({
        providerSubscriptionId: subscriptionCode,
        ...(emailToken ? { providerActionTokenCiphertext: encryptSecret(emailToken) } : {}),
        updatedAt: new Date()
      }).where(and(eq(subscriptions.provider, "paystack"), eq(subscriptions.providerCustomerId, customerCode)));
    }
    return;
  }

  if (type === "charge.success") {
    if (getString(data.status) !== "success") return;
    const metadata = paymentMetadataSchema.safeParse(data.metadata);
    if (!metadata.success) return;
    const checkoutReference = getString(asRecord(data.metadata)?.seoflow_reference) ?? getString(data.reference);
    if (checkoutReference) await setCheckoutStatus(tx, checkoutReference, "completed");
    const subscriptionData = asRecord(data.subscription);
    const customer = asRecord(data.customer);
    const start = new Date();
    const requestedEnd = parseDate(subscriptionData?.next_payment_date);
    await activateSubscription(tx, {
      organizationId: metadata.data.seoflow_organization_id,
      planId: metadata.data.seoflow_plan_id,
      provider: "paystack",
      providerCustomerId: getString(customer?.customer_code),
      providerSubscriptionId: getString(subscriptionData?.subscription_code) ?? getString(data.subscription_code),
      ...(getString(data.email_token) ?? getString(subscriptionData?.email_token)
        ? { providerActionTokenCiphertext: encryptSecret((getString(data.email_token) ?? getString(subscriptionData?.email_token))!) }
        : {}),
      status: "active",
      periodStart: start,
      periodEnd: requestedEnd && requestedEnd > start ? requestedEnd : addUtcMonth(start)
    });
    return;
  }

  if (["subscription.disable", "subscription.not_renew", "subscription.enable", "invoice.payment_failed"].includes(type)) {
    const subscriptionData = asRecord(data.subscription);
    const subscriptionId = getString(data.subscription_code) ?? getString(subscriptionData?.subscription_code);
    if (!subscriptionId) return;
    const current = await findSubscription(tx, "paystack", subscriptionId);
    if (!current) return;
    const nextPayment = parseDate(subscriptionData?.next_payment_date ?? data.next_payment_date);
    const status = type === "subscription.enable" ? "active" : type === "invoice.payment_failed" ? "past_due" : "cancelled";
    await tx.update(subscriptions).set({
      status,
      periodEnd: nextPayment && nextPayment > new Date() ? nextPayment : current.periodEnd,
      updatedAt: new Date()
    }).where(and(eq(subscriptions.provider, "paystack"), eq(subscriptions.providerSubscriptionId, subscriptionId)));
  }
}

async function activateSubscription(tx: DbTransaction, input: {
  organizationId: string;
  planId: string;
  provider: "stripe" | "paystack";
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  providerActionTokenCiphertext?: string;
  status: "trialing" | "active" | "past_due" | "cancelled" | "incomplete";
  periodStart: Date | null;
  periodEnd: Date | null;
}) {
  await lockOrganization(tx, input.organizationId);
  const [plan] = await tx.select({ id: plans.id }).from(plans).where(eq(plans.id, input.planId)).limit(1);
  if (!plan) return;
  await tx.insert(subscriptions).values(input).onConflictDoUpdate({
    target: subscriptions.organizationId,
    set: {
      planId: input.planId,
      provider: input.provider,
      providerCustomerId: input.providerCustomerId,
      providerSubscriptionId: input.providerSubscriptionId,
      ...(input.providerActionTokenCiphertext !== undefined ? { providerActionTokenCiphertext: input.providerActionTokenCiphertext } : {}),
      status: input.status,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      updatedAt: new Date()
    }
  });
}

async function findSubscription(tx: DbTransaction, provider: string, providerSubscriptionId: string) {
  const [row] = await tx.select().from(subscriptions).where(and(
    eq(subscriptions.provider, provider), eq(subscriptions.providerSubscriptionId, providerSubscriptionId)
  )).limit(1);
  return row ?? null;
}

async function setCheckoutStatus(tx: DbTransaction, reference: string, status: "completed" | "expired" | "failed") {
  const [session] = await tx.select({ organizationId: billingCheckoutSessions.organizationId }).from(billingCheckoutSessions)
    .where(eq(billingCheckoutSessions.reference, reference)).limit(1);
  if (session) await lockOrganization(tx, session.organizationId);
  await tx.update(billingCheckoutSessions).set({ status, updatedAt: new Date() })
    .where(eq(billingCheckoutSessions.reference, reference));
}

async function lockOrganization(tx: DbTransaction, organizationId: string) {
  await tx.select({ id: organizations.id }).from(organizations)
    .where(eq(organizations.id, organizationId)).for("update").limit(1);
}

function stripeStatus(status: string): "trialing" | "active" | "past_due" | "cancelled" | "incomplete" {
  if (status === "active") return "active";
  if (status === "trialing") return "trialing";
  if (status === "past_due" || status === "unpaid") return "past_due";
  if (status === "canceled") return "cancelled";
  return "incomplete";
}

function parseJson(rawBody: string): unknown {
  try { return JSON.parse(rawBody) as unknown; }
  catch { throw new Error("Payment webhook body is not valid JSON."); }
}

function objectId(value: unknown) {
  if (typeof value === "string") return value;
  return getString(asRecord(value)?.id);
}

function getString(value: unknown) { return typeof value === "string" && value.length > 0 ? value : null; }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function unixDate(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? new Date(value * 1_000) : null; }
function parseDate(value: unknown) { if (typeof value !== "string") return null; const result = new Date(value); return Number.isNaN(result.getTime()) ? null : result; }
