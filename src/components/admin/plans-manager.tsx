"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";

type Plan = { id: string; slug: string; name: string; priceMonthly: string; currency: string; crawlPageLimit: number; projectLimit: number; trackedKeywordLimit: number; aiCredits: number; stripePriceId: string | null; paystackPlanCode: string | null; enabled: boolean };

export function PlansManager() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { void fetch("/api/admin/plans", { cache: "no-store" }).then(async (response) => { const data = await response.json() as { plans?: Plan[]; error?: string }; if (!response.ok) throw new Error(data.error ?? "Could not load plans."); setPlans(data.plans ?? []); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load plans.")); }, []);
  function patch(index: number, key: keyof Plan, value: string | number | boolean) { setPlans((current) => current.map((plan, i) => i === index ? { ...plan, [key]: value } : plan)); }
  async function save(plan: Plan) {
    setBusyId(plan.id); setError(""); setMessage("");
    const response = await fetch("/api/admin/plans", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...plan, priceMonthly: Number(plan.priceMonthly) }) });
    const data = await response.json() as { error?: string };
    setBusyId("");
    if (!response.ok) setError(data.error ?? "Could not save this plan."); else setMessage(`${plan.name} plan updated. Limits are enforced on server-side APIs.`);
  }
  return <section className="surface overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Subscription plan configuration</h2><p className="mt-1 text-xs text-muted">Entitlements are server-enforced. Add a provider price ID or plan code before offering paid checkout; verified webhooks activate subscriptions.</p></div>
    {error && <p role="alert" className="px-5 pt-3 text-xs text-red-300">{error}</p>}{message && <p role="status" className="px-5 pt-3 text-xs text-accent">{message}</p>}
    <div className="divide-y divide-border">{plans.map((plan,index) => <div key={plan.id} className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-[1fr_100px_80px_90px_100px_90px_100px_150px_150px_auto] xl:items-end">
      <div><p className="mb-2 text-[10px] uppercase tracking-widest text-muted">Plan · {plan.slug}</p><input className="field !py-2 text-xs" value={plan.name} onChange={(event) => patch(index,"name",event.target.value)} /></div>
      <label className="text-[10px] text-muted">Price / month<input className="field mt-1.5 !py-2 text-xs" type="number" min="0" step="0.01" value={plan.priceMonthly} onChange={(event) => patch(index,"priceMonthly",event.target.value)} /></label>
      <label className="text-[10px] text-muted">Currency<input className="field mt-1.5 !py-2 text-xs uppercase" maxLength={3} value={plan.currency} onChange={(event) => patch(index,"currency",event.target.value.toUpperCase())} /></label>
      <label className="text-[10px] text-muted">Projects<input className="field mt-1.5 !py-2 text-xs" type="number" min="1" value={plan.projectLimit} onChange={(event) => patch(index,"projectLimit",Number(event.target.value))} /></label>
      <label className="text-[10px] text-muted">Pages / crawl<input className="field mt-1.5 !py-2 text-xs" type="number" min="1" max="10000" value={plan.crawlPageLimit} onChange={(event) => patch(index,"crawlPageLimit",Number(event.target.value))} /></label>
      <label className="text-[10px] text-muted">Keywords<input className="field mt-1.5 !py-2 text-xs" type="number" min="0" value={plan.trackedKeywordLimit} onChange={(event) => patch(index,"trackedKeywordLimit",Number(event.target.value))} /></label>
      <label className="text-[10px] text-muted">AI credits<input className="field mt-1.5 !py-2 text-xs" type="number" min="0" value={plan.aiCredits} onChange={(event) => patch(index,"aiCredits",Number(event.target.value))} /></label>
      <label className="text-[10px] text-muted">Stripe monthly price ID<input className="field mt-1.5 !py-2 text-xs" value={plan.stripePriceId ?? ""} onChange={(event) => patch(index,"stripePriceId",event.target.value)} placeholder="price_…" /></label>
      <label className="text-[10px] text-muted">Paystack plan code<input className="field mt-1.5 !py-2 text-xs" value={plan.paystackPlanCode ?? ""} onChange={(event) => patch(index,"paystackPlanCode",event.target.value)} placeholder="PLN_…" /></label>
      <div className="flex items-center justify-between gap-3"><label className="flex items-center gap-1.5 text-[10px] text-muted"><input type="checkbox" className="rounded border-border bg-background text-accent focus:ring-accent" checked={plan.enabled} onChange={(event) => patch(index,"enabled",event.target.checked)} />Enabled</label><button onClick={() => void save(plan)} disabled={busyId === plan.id} className="btn-primary !px-3 !py-2 text-xs">{busyId === plan.id ? <LoaderCircle size={13} className="animate-spin" /> : <Save size={13} />}Save</button></div>
    </div>)}</div>
  </section>;
}
