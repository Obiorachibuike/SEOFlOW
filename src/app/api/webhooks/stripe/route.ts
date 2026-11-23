import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/lib/billing/webhooks";
import { verifyStripeWebhookSignature } from "@/lib/billing/payment";
import { HttpError, jsonError, readTextBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new HttpError(503, "Stripe webhook verification is not configured.", "PAYMENT_WEBHOOK_NOT_CONFIGURED");
    const rawBody = await readTextBody(request, 1_048_576);
    if (!verifyStripeWebhookSignature(rawBody, request.headers.get("stripe-signature"), secret)) {
      throw new HttpError(400, "Stripe webhook signature is invalid or expired.", "PAYMENT_WEBHOOK_SIGNATURE_INVALID");
    }
    const result = await handleStripeWebhook(rawBody);
    return NextResponse.json({ received: true, duplicate: result.duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
