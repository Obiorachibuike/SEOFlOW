import { NextResponse } from "next/server";
import { handlePaystackWebhook } from "@/lib/billing/webhooks";
import { verifyPaystackWebhookSignature } from "@/lib/billing/payment";
import { HttpError, jsonError, readTextBody } from "@/lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const secret = process.env.PAYSTACK_WEBHOOK_SECRET?.trim() || process.env.PAYSTACK_SECRET_KEY?.trim();
    if (!secret) throw new HttpError(503, "Paystack webhook verification is not configured.", "PAYMENT_WEBHOOK_NOT_CONFIGURED");
    const rawBody = await readTextBody(request, 1_048_576);
    if (!verifyPaystackWebhookSignature(rawBody, request.headers.get("x-paystack-signature"), secret)) {
      throw new HttpError(400, "Paystack webhook signature is invalid.", "PAYMENT_WEBHOOK_SIGNATURE_INVALID");
    }
    const result = await handlePaystackWebhook(rawBody);
    return NextResponse.json({ received: true, duplicate: result.duplicate }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return jsonError(error); }
}
