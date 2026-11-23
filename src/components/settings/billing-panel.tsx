"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LoaderCircle, LockKeyhole, ReceiptText } from "lucide-react";

type PlanOffer = { id: string; slug: string; name: string; priceMonthly: string; currency: string; features: string[] };
type SubscriptionSummary = { provider: string; status: string; periodEnd: string | null };

export function BillingPanel({
  organizationId,
  role,
  plans,
  paymentProvider,
  subscription
}: {
  organizationId: string;
  role: string;
  plans: PlanOffer[];
  paymentProvider: string | null;
  subscription: SubscriptionSummary | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const canManage = role === "owner" || role === "admin";
  const paidPlans = plans.filter((plan) => Number(plan.priceMonthly) > 0);

  async function checkout(plan: PlanOffer) {
    setBusyId(plan.id);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${organizationId}/billing/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId: plan.id })
      });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "Could not start secure checkout.");
      window.location.assign(data.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not start secure checkout.");
      setBusyId("");
    }
  }

  async function manage() {
    setBusyId("manage");
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/workspaces/${organizationId}/billing/manage`, { method: "POST" });
      const data = await response.json() as { url?: string; action?: string; periodEnd?: string | null; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not manage this subscription.");
      if (data.url) { window.location.assign(data.url); return; }
      if (data.action === "cancelled") {
        setMessage(data.periodEnd ? `Auto-renewal is disabled. Your paid plan remains available until ${new Date(data.periodEnd).toLocaleDateString()}.` : "Auto-renewal is disabled. The billing provider will confirm the final access date.");
        router.refresh();
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not manage this subscription.");
    } finally { setBusyId(""); }
  }

  const activeSubscription = subscription && ["active", "trialing", "past_due"].includes(subscription.status);
  const cancelledSubscription = subscription?.status === "cancelled";

  return <section className="surface overflow-hidden">
    <div className="flex items-start gap-3 border-b border-border px-5 py-4">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent"><ReceiptText size={15} /></span>
      <div><h3 className="text-sm font-semibold">Workspace billing</h3><p className="mt-1 text-xs leading-5 text-muted">Monthly subscriptions are activated or changed only after a provider-signed webhook confirms payment.</p></div>
    </div>
    {activeSubscription ? <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><p className="text-xs font-semibold">Paid subscription · {subscription.provider}</p><p className="mt-1 text-[10px] leading-5 text-muted">Manage billing or cancel renewal through the payment provider. Your current plan remains in effect through its paid period.</p></div>
      <button type="button" className="btn-secondary shrink-0 !py-2 text-xs" disabled={!canManage || Boolean(busyId)} onClick={() => void manage()}>
        {busyId === "manage" ? <><LoaderCircle size={13} className="animate-spin" />Opening…</> : subscription.provider === "stripe" ? "Manage Stripe subscription" : "Cancel Paystack renewal"}
      </button>
    </div> : cancelledSubscription ? <p className="px-5 py-4 text-xs leading-5 text-muted">Auto-renewal is cancelled. Existing paid access continues until {subscription.periodEnd ? new Date(subscription.periodEnd).toLocaleDateString() : "the provider period ends"}; a new checkout is available after that period.</p>
      : !paymentProvider ? <p className="px-5 py-4 text-xs leading-5 text-muted">Online billing is not configured. A deployment administrator must select a payment provider and configure matching recurring plan IDs.</p>
        : !paidPlans.length ? <p className="px-5 py-4 text-xs text-muted">No enabled paid plans are available.</p>
          : <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">{paidPlans.map((plan) => <article key={plan.id} className="rounded-xl border border-border bg-background/35 p-4">
            <div className="flex items-start justify-between gap-3"><div><h4 className="text-sm font-semibold">{plan.name}</h4><p className="mt-1 text-xs text-muted">{formatPrice(plan.priceMonthly, plan.currency)} <span className="text-[10px]">/ month</span></p></div><LockKeyhole size={14} className="text-muted" /></div>
            {plan.features.length > 0 && <ul className="mt-3 space-y-1">{plan.features.slice(0, 4).map((feature) => <li key={feature} className="text-[10px] leading-4 text-muted">· {feature}</li>)}</ul>}
            <button type="button" className="btn-secondary mt-4 w-full !py-2 text-xs" disabled={!canManage || Boolean(busyId)} onClick={() => void checkout(plan)}>
              {busyId === plan.id ? <><LoaderCircle size={13} className="animate-spin" />Opening checkout…</> : canManage ? `Continue with ${paymentProvider}` : "Owner or admin required"}
            </button>
          </article>)}</div>}
    {message && <p role="status" className="px-5 pb-4 text-xs text-accent">{message}</p>}
    {error && <p role="alert" className="px-5 pb-4 text-xs text-red-300">{error}</p>}
  </section>;
}

function formatPrice(amount: string, currency: string) {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(amount)); }
  catch { return `${currency.toUpperCase()} ${amount}`; }
}
