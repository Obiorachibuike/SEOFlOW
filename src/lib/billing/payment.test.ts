import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { addUtcMonth, toMinorUnits, verifyPaystackWebhookSignature, verifyStripeWebhookSignature } from "@/lib/billing/payment";

describe("payment adapter primitives", () => {
  it("converts plan amounts using the ISO currency minor-unit exponent", () => {
    expect(toMinorUnits("19.00", "USD")).toBe(1900);
    expect(toMinorUnits("2500", "NGN")).toBe(250000);
    expect(toMinorUnits("1200", "JPY")).toBe(1200);
    expect(() => toMinorUnits("-1", "USD")).toThrow();
    expect(() => toMinorUnits("10", "NOT_A_CURRENCY")).toThrow();
  });

  it("advances monthly periods without overflowing short months", () => {
    expect(addUtcMonth(new Date("2025-01-31T12:00:00Z")).toISOString()).toBe("2025-02-28T12:00:00.000Z");
    expect(addUtcMonth(new Date("2024-01-31T12:00:00Z")).toISOString()).toBe("2024-02-29T12:00:00.000Z");
  });

  it("validates Stripe signatures, body binding and timestamp tolerance", () => {
    const secret = "whsec_test_key";
    const body = JSON.stringify({ id: "evt_123", type: "checkout.session.completed" });
    const timestamp = 1_800_000_000;
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    const header = `t=${timestamp},v1=${signature}`;
    expect(verifyStripeWebhookSignature(body, header, secret, timestamp * 1_000)).toBe(true);
    expect(verifyStripeWebhookSignature(`${body} `, header, secret, timestamp * 1_000)).toBe(false);
    expect(verifyStripeWebhookSignature(body, header, secret, (timestamp + 301) * 1_000)).toBe(false);
  });

  it("validates Paystack SHA-512 signatures and rejects malformed headers", () => {
    const secret = "paystack_test_key";
    const body = JSON.stringify({ event: "charge.success", data: { reference: "ref_1" } });
    const signature = createHmac("sha512", secret).update(body).digest("hex");
    expect(verifyPaystackWebhookSignature(body, signature, secret)).toBe(true);
    expect(verifyPaystackWebhookSignature(`${body} `, signature, secret)).toBe(false);
    expect(verifyPaystackWebhookSignature(body, "not-a-signature", secret)).toBe(false);
  });
});
