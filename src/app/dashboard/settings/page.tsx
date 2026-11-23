import Link from "next/link";
import { asc, eq, inArray } from "drizzle-orm";
import { ArrowRight, KeyRound, Mail, Settings2, ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { organizationMembers, organizations, plans, projectIntegrations, projects, subscriptions } from "@/db/schema";
import { getSession } from "@/lib/authz";
import { getOrganizationPlan } from "@/lib/plans";
import { getOrganizationUsage } from "@/lib/usage";
import { WorkspaceMembers } from "@/components/settings/workspace-members";
import { BillingPanel } from "@/components/settings/billing-panel";

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) return null;
  const workspaces = await db.select({ organization: organizations, role: organizationMembers.role })
    .from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id));
  const availablePlans = await db.select({ id: plans.id, slug: plans.slug, name: plans.name, priceMonthly: plans.priceMonthly, currency: plans.currency, features: plans.features })
    .from(plans).where(eq(plans.enabled, true)).orderBy(asc(plans.priceMonthly));
  const paymentProviderValue = process.env.PAYMENT_PROVIDER?.trim().toLowerCase();
  const paymentProvider = paymentProviderValue === "stripe" || paymentProviderValue === "paystack" ? paymentProviderValue : null;
  const projectIds = await db.select({ id: projects.id }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id));
  const integrationRows = projectIds.length ? await db.select({ integration: projectIntegrations, project: projects })
    .from(projectIntegrations).innerJoin(projects, eq(projects.id, projectIntegrations.projectId))
    .where(inArray(projectIntegrations.projectId, projectIds.map((project) => project.id))) : [];
  const planRows = await Promise.all(workspaces.map(async ({ organization }) => {
    const [subscription] = await db.select({ status: subscriptions.status, provider: subscriptions.provider, periodEnd: subscriptions.periodEnd }).from(subscriptions)
      .where(eq(subscriptions.organizationId, organization.id)).limit(1);
    const [plan, usage] = await Promise.all([
      getOrganizationPlan(organization.id),
      getOrganizationUsage(organization.id)
    ]);
    const hasCurrentPaidPeriod = Boolean(subscription && subscription.provider !== "internal"
      && ["active", "trialing", "past_due", "cancelled"].includes(subscription.status)
      && (!subscription.periodEnd || subscription.periodEnd > new Date()));
    return { organizationId: organization.id, plan, usage, subscription: hasCurrentPaidPeriod ? { provider: subscription?.provider ?? "", status: subscription?.status ?? "", periodEnd: subscription?.periodEnd?.toISOString() ?? null } : null };
  }));
  return <div className="space-y-7">
    <div><p className="eyebrow text-accent">Workspace preferences</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Settings</h1><p className="mt-2 text-sm text-muted">Manage your identity, team access and configured project integrations.</p></div>
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="surface p-5 sm:p-6"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><KeyRound size={17} /></span><div><h2 className="text-sm font-semibold">Account security</h2><p className="mt-1 text-[10px] text-muted">Better Auth · secure, HTTP-only sessions</p></div></div><div className="mt-5 space-y-3 rounded-xl border border-border bg-background/40 p-4"><div className="flex items-center gap-2"><Mail size={14} className="text-muted" /><span className="text-xs">{session.user.email}</span><span className={`ml-auto rounded-full px-2 py-0.5 text-[9px] ${session.user.emailVerified ? "bg-accent/10 text-accent" : "bg-amber-400/10 text-amber-300"}`}>{session.user.emailVerified ? "verified" : "unverified"}</span></div><p className="text-xs text-muted">{session.user.name}</p></div><Link href="/forgot-password" className="mt-4 inline-flex items-center gap-1 text-xs text-accent hover:underline">Reset password <ArrowRight size={13} /></Link></article>
      <article className="surface p-5 sm:p-6"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Settings2 size={17} /></span><div><h2 className="text-sm font-semibold">Data integrations</h2><p className="mt-1 text-[10px] text-muted">Project-scoped, user-authorized connections</p></div></div>{integrationRows.length ? <div className="mt-5 space-y-2">{integrationRows.map(({ integration, project }) => <div key={integration.id} className="flex items-center gap-3 rounded-xl border border-border bg-background/40 p-3"><span className="h-2 w-2 rounded-full bg-accent" /><div className="min-w-0 flex-1"><p className="text-xs font-medium">{project.name} · {integration.provider}</p><p className="mt-1 truncate text-[10px] text-muted">{integration.accountLabel ?? integration.externalPropertyId ?? "Connected"}</p></div><span className="text-[9px] text-accent">connected</span></div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-border p-4 text-xs leading-5 text-muted">No Google Search Console or Analytics properties are connected. Data will not appear until you explicitly authorize an integration.</div>}<p className="mt-3 text-[10px] text-muted">Google OAuth credentials are configured by the deployment administrator.</p></article>
    </section>
    {workspaces.length ? <div className="space-y-5">{workspaces.map(({ organization, role }) => { const usage = planRows.find((item) => item.organizationId === organization.id); return <div key={organization.id} className="space-y-4"><div className="surface flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="eyebrow text-accent">Workspace</p><h2 className="mt-1 text-base font-semibold">{organization.name}</h2><p className="mt-1 text-[10px] text-muted">Role: {role.replaceAll("_", " ")} · Created {organization.createdAt.toLocaleDateString()}</p></div><div className="rounded-xl border border-border bg-background/40 px-4 py-3 text-right"><p className="text-[10px] text-muted">Current plan</p><p className="mt-1 text-sm font-semibold">{usage?.plan.planName ?? "Free"}</p></div><div className="min-w-[200px] rounded-xl border border-border bg-background/40 px-4 py-3"><div className="flex justify-between gap-3 text-[10px]"><span className="text-muted">AI credits this month</span><span className="font-semibold">{usage?.usage.aiCredits ?? 0} / {usage?.plan.aiCredits ?? 20}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, ((usage?.usage.aiCredits ?? 0) / Math.max(1, usage?.plan.aiCredits ?? 20)) * 100)}%` }} /></div><p className="mt-1.5 text-[9px] text-muted">Calendar month, UTC · each successful request uses one credit</p></div></div><BillingPanel organizationId={organization.id} role={role} plans={availablePlans} paymentProvider={paymentProvider} subscription={usage?.subscription ?? null} /><WorkspaceMembers organizationId={organization.id} role={role} /></div>;})}</div> : <div className="surface p-6 text-xs text-muted">Create your first project to create a personal workspace.</div>}
    <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-card/40 p-4 text-[10px] leading-5 text-muted"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" />Sensitive provider credentials are encrypted with AES-256-GCM using the deployment’s SECRETS_ENCRYPTION_KEY. This key must be backed up securely; rotating it requires re-encrypting stored credentials.</div>
  </div>;
}
