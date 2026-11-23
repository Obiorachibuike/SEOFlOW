import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { HttpError } from "@/lib/http";

export type PaymentProviderName = "stripe" | "paystack";

export interface PaidPlanForCheckout {
  id: string;
  slug: string;
  name: string;
  priceMonthly: string;
  currency: string;
  stripePriceId: string | null;
  paystackPlanCode: string | null;
}

export function configuredPaymentProvider(): PaymentProviderName | null {
  const configured = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  if (!configured) return null;
  if (configured === "stripe" || configured === "paystack") return configured;
  throw new HttpError(503, "PAYMENT_PROVIDER must be set to stripe or paystack.", "BILLING_CONFIGURATION_INVALID");
}

export async function createSubscriptionCheckout(input: {
  plan: PaidPlanForCheckout;
  provider: PaymentProviderName;
  organizationId: string;
  userEmail: string;
  reference?: string;
}) {
  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") {
    throw new HttpError(503, "NEXT_PUBLIC_APP_URL must use HTTPS for production billing.", "BILLING_CONFIGURATION_INVALID");
  }
  const successUrl = new URL("/dashboard/settings?billing=success", appUrl).toString();
  const cancelUrl = new URL("/dashboard/settings?billing=cancelled", appUrl).toString();
  const reference = input.reference ?? `seoflow_${cryptoRandomId()}`;
  if (input.provider === "stripe") {
    if (!input.plan.stripePriceId) throw new HttpError(409, "This plan has no Stripe recurring price configured.", "PAYMENT_PRICE_NOT_CONFIGURED");
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) throw new HttpError(503, "Stripe billing credentials are not configured.", "PAYMENT_PROVIDER_NOT_CONFIGURED");
    await assertStripePrice(input.plan, input.plan.stripePriceId, secret);
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": input.plan.stripePriceId,
      "line_items[0][quantity]": "1",
      expires_at: String(Math.floor(Date.now() / 1_000) + 23 * 60 * 60),
      client_reference_id: input.organizationId,
      success_url: `${successUrl}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      "metadata[seoflow_organization_id]": input.organizationId,
      "metadata[seoflow_plan_id]": input.plan.id,
      "metadata[seoflow_reference]": reference,
      "subscription_data[metadata][seoflow_organization_id]": input.organizationId,
      "subscription_data[metadata][seoflow_plan_id]": input.plan.id,
      "subscription_data[metadata][seoflow_reference]": reference
    });
    const payload = await requestProvider("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": reference
      },
      body: form.toString()
    }, "Stripe could not create a subscription checkout.");
    const record = asRecord(payload);
    const url = safeCheckoutUrl(record?.url, "checkout.stripe.com");
    if (!url || typeof record?.id !== "string") throw new HttpError(502, "Stripe returned an invalid checkout session.", "PAYMENT_CHECKOUT_INVALID");
    return { url, providerCheckoutId: record.id, reference };
  }

  if (!input.plan.paystackPlanCode) throw new HttpError(409, "This plan has no Paystack recurring plan configured.", "PAYMENT_PRICE_NOT_CONFIGURED");
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new HttpError(503, "Paystack billing credentials are not configured.", "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const expectedAmount = toMinorUnits(input.plan.priceMonthly, input.plan.currency);
  await assertPaystackPlan(input.plan, input.plan.paystackPlanCode, secret, expectedAmount);
  const payload = await requestProvider("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      email: input.userEmail,
      amount: expectedAmount,
      currency: input.plan.currency.toUpperCase(),
      plan: input.plan.paystackPlanCode,
      reference,
      callback_url: successUrl,
      metadata: {
        seoflow_organization_id: input.organizationId,
        seoflow_plan_id: input.plan.id,
        seoflow_reference: reference
      }
    })
  }, "Paystack could not create a subscription checkout.");
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const url = safeCheckoutUrl(data?.authorization_url, "checkout.paystack.com");
  if (root?.status !== true || !url || typeof data?.reference !== "string") {
    throw new HttpError(502, "Paystack returned an invalid checkout session.", "PAYMENT_CHECKOUT_INVALID");
  }
  const providerCheckoutId = typeof data.access_code === "string" ? data.access_code : data.reference;
  return { url, providerCheckoutId, reference };
}

export async function createStripeBillingPortal(customerId: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new HttpError(503, "Stripe billing credentials are not configured.", "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000");
  if (process.env.NODE_ENV === "production" && appUrl.protocol !== "https:") throw new HttpError(503, "NEXT_PUBLIC_APP_URL must use HTTPS for production billing.", "BILLING_CONFIGURATION_INVALID");
  const payload = await requestProvider("https://api.stripe.com/v1/billing_portal/sessions", {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ customer: customerId, return_url: new URL("/dashboard/settings", appUrl).toString() }).toString()
  }, "Stripe could not create a billing management session.");
  const record = asRecord(payload);
  const url = safeCheckoutUrl(record?.url, "billing.stripe.com");
  if (!url) throw new HttpError(502, "Stripe returned an invalid billing management session.", "PAYMENT_CHECKOUT_INVALID");
  return url;
}

export async function scheduleStripeCancellation(subscriptionId: string) {
  const secret = process.env.STRIPE_SECRET_KEY;
  if (!secret) throw new HttpError(503, "Stripe billing credentials are not configured.", "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const payload = await requestProvider(`https://api.stripe.com/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ cancel_at_period_end: "true" }).toString()
  }, "Stripe could not schedule subscription cancellation.");
  const record = asRecord(payload);
  if (record?.cancel_at_period_end !== true) throw new HttpError(502, "Stripe did not confirm subscription cancellation.", "PAYMENT_CANCELLATION_FAILED");
}

export async function cancelPaystackSubscription(subscriptionCode: string, emailToken: string) {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) throw new HttpError(503, "Paystack billing credentials are not configured.", "PAYMENT_PROVIDER_NOT_CONFIGURED");
  const payload = await requestProvider("https://api.paystack.co/subscription/disable", {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code: subscriptionCode, token: emailToken })
  }, "Paystack could not disable subscription renewal.");
  if (asRecord(payload)?.status !== true) throw new HttpError(502, "Paystack did not confirm subscription cancellation.", "PAYMENT_CANCELLATION_FAILED");
}

async function assertStripePrice(plan: PaidPlanForCheckout, priceId: string, secret: string) {
  const payload = await requestProvider(`https://api.stripe.com/v1/prices/${encodeURIComponent(priceId)}`, {
    headers: { authorization: `Basic ${Buffer.from(`${secret}:`).toString("base64")}`, accept: "application/json" }
  }, "Stripe could not verify this plan's configured price.");
  const price = asRecord(payload);
  const recurring = asRecord(price?.recurring);
  if (price?.active !== true || recurring?.interval !== "month" || Number(recurring.interval_count ?? 1) !== 1) {
    throw new HttpError(409, "The configured Stripe price must be active and billed monthly.", "PAYMENT_PRICE_INVALID");
  }
  const expectedAmount = toMinorUnits(plan.priceMonthly, plan.currency);
  if (price?.currency !== plan.currency.toLowerCase() || price?.unit_amount !== expectedAmount) {
    throw new HttpError(409, "The configured Stripe price currency or amount does not match this plan. Update the plan before offering checkout.", "PAYMENT_PRICE_MISMATCH");
  }
}

async function assertPaystackPlan(plan: PaidPlanForCheckout, planCode: string, secret: string, expectedAmount: number) {
  const payload = await requestProvider(`https://api.paystack.co/plan/${encodeURIComponent(planCode)}`, {
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" }
  }, "Paystack could not verify this plan's configured price.");
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (root?.status !== true || data?.is_archived === true || data?.interval !== "monthly" || Number(data?.amount) !== expectedAmount || String(data?.currency).toUpperCase() !== plan.currency.toUpperCase()) {
    throw new HttpError(409, "The configured Paystack plan must be active, monthly, and match this plan's amount and currency.", "PAYMENT_PRICE_MISMATCH");
  }
}

async function requestProvider(url: string, init: RequestInit, failureMessage: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(20_000) });
  } catch {
    throw new HttpError(502, "The payment provider could not be reached safely. Try again later.", "PAYMENT_PROVIDER_UNAVAILABLE");
  }
  let text: string;
  try { text = await response.text(); }
  catch { throw new HttpError(502, failureMessage, "PAYMENT_PROVIDER_ERROR"); }
  if (text.length > 1_000_000) throw new HttpError(502, "The payment provider response exceeded the size limit.", "PAYMENT_RESPONSE_TOO_LARGE");
  let payload: unknown;
  try { payload = JSON.parse(text) as unknown; }
  catch { throw new HttpError(502, failureMessage, "PAYMENT_PROVIDER_ERROR"); }
  if (!response.ok) throw new HttpError(502, failureMessage, "PAYMENT_PROVIDER_ERROR");
  return payload;
}

function safeCheckoutUrl(value: unknown, expectedHost: string) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== expectedHost || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function toMinorUnits(amount: string | number, currency: string) {
  let digits: number;
  try { digits = new Intl.NumberFormat("en", { style: "currency", currency: currency.toUpperCase() }).resolvedOptions().maximumFractionDigits ?? 2; }
  catch { throw new HttpError(400, "The plan currency is not a valid ISO currency code.", "INVALID_PLAN_CURRENCY"); }
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) throw new HttpError(400, "Paid plan prices must be greater than zero.", "INVALID_PLAN_PRICE");
  const minor = Math.round(value * 10 ** digits);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new HttpError(400, "The plan price cannot be represented in the provider's currency units.", "INVALID_PLAN_PRICE");
  return minor;
}

export function verifyStripeWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string, nowMs = Date.now()) {
  if (!signatureHeader || !secret || signatureHeader.length > 2_000) return false;
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of signatureHeader.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "t") timestamp = value;
    else if (key === "v1" && /^[a-f0-9]{64}$/i.test(value)) signatures.push(value);
  }
  if (!/^\d{1,12}$/.test(timestamp) || !signatures.length) return false;
  const timestampSeconds = Number(timestamp);
  if (!Number.isSafeInteger(timestampSeconds) || Math.abs(nowMs / 1_000 - timestampSeconds) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`, "utf8").digest();
  return signatures.some((signature) => {
    const supplied = Buffer.from(signature, "hex");
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  });
}

export function verifyPaystackWebhookSignature(rawBody: string, signatureHeader: string | null, secret: string) {
  if (!signatureHeader || !secret || !/^[a-f0-9]{128}$/i.test(signatureHeader)) return false;
  const expected = createHmac("sha512", secret).update(rawBody, "utf8").digest();
  const supplied = Buffer.from(signatureHeader, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function addUtcMonth(date: Date) {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + 1);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

function cryptoRandomId() {
  return randomUUID();
}
