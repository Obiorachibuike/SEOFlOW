import { notFound } from "next/navigation";
import { desc, eq, sql } from "drizzle-orm";
import { Activity, Bot, Building2, CircleAlert, Coins, FolderKanban, ShieldCheck, Users } from "lucide-react";
import { db } from "@/db";
import { adminAuditLogs, aiModels, aiProviders, aiUsage, crawlJobs, organizations, projects, users } from "@/db/schema";
import { getSession, requireAdmin } from "@/lib/authz";
import { MetricCard } from "@/components/dashboard/metric-card";
import { AiManager } from "@/components/admin/ai-manager";
import { PlansManager } from "@/components/admin/plans-manager";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) return null;
  try { await requireAdmin(session.user.id); } catch { notFound(); }
  const [userCount, organizationCount, projectCount, crawlCount, issueCount, providerCount, modelCount, usageSummary] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(users),
    db.select({ count: sql<number>`count(*)::int` }).from(organizations),
    db.select({ count: sql<number>`count(*)::int` }).from(projects),
    db.select({ count: sql<number>`count(*)::int` }).from(crawlJobs),
    db.select({ count: sql<number>`count(*)::int` }).from(crawlJobs).where(eq(crawlJobs.status, "failed")),
    db.select({ count: sql<number>`count(*)::int` }).from(aiProviders).where(eq(aiProviders.enabled, true)),
    db.select({ count: sql<number>`count(*)::int` }).from(aiModels).where(eq(aiModels.enabled, true)),
    db.select({ requests: sql<number>`count(*)::int`, tokens: sql<number>`coalesce(sum(${aiUsage.inputTokens} + ${aiUsage.outputTokens}), 0)::int`, cost: sql<string>`coalesce(sum(${aiUsage.estimatedCost}), 0)::text` }).from(aiUsage)
  ]);
  const recentLogs = await db.select().from(adminAuditLogs).orderBy(desc(adminAuditLogs.createdAt)).limit(8);
  const count = (rows: Array<{ count: number }>) => rows[0]?.count ?? 0;
  return <div className="space-y-8">
    <div className="flex items-end justify-between gap-4"><div><p className="eyebrow text-accent">Platform control</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Admin console</h1><p className="mt-2 text-sm text-muted">Platform-wide configuration. Access is restricted to super-admin accounts.</p></div><div className="hidden items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.06] px-3 py-2 text-[10px] text-accent sm:flex"><ShieldCheck size={13} /> Super-admin session</div></div>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricCard label="Registered users" value={count(userCount)} note="Database-backed accounts" icon={Users} />
      <MetricCard label="Organizations" value={count(organizationCount)} note="Active workspaces" icon={Building2} />
      <MetricCard label="Projects / crawls" value={`${count(projectCount)} / ${count(crawlCount)}`} note={`${count(issueCount)} failed crawl job(s)`} icon={FolderKanban} tone={count(issueCount) ? "warning" : "default"} />
      <MetricCard label="AI usage recorded" value={usageSummary[0]?.requests ?? 0} note={`${usageSummary[0]?.tokens ?? 0} tokens · estimated cost $${Number(usageSummary[0]?.cost ?? 0).toFixed(4)}`} icon={Coins} />
    </section>
    <section className="grid gap-3 sm:grid-cols-2"><MetricCard label="Enabled AI providers" value={count(providerCount)} note="Credentials are encrypted at rest" icon={Bot} tone={count(providerCount) ? "good" : "warning"} /><MetricCard label="Enabled AI models" value={count(modelCount)} note="Model identifiers are administrator-configured" icon={Activity} /></section>
    <div><div className="mb-4"><p className="eyebrow text-accent">AI intelligence</p><h2 className="mt-1 text-lg font-semibold">Provider and model registry</h2></div><AiManager /></div>
    <PlansManager />
    <section className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Recent admin audit events</h2><p className="mt-1 text-xs text-muted">Credential values are deliberately excluded.</p></div><CircleAlert size={15} className="text-muted" /></div>{recentLogs.length ? <div className="divide-y divide-border">{recentLogs.map((log) => <div key={log.id} className="flex flex-wrap items-center gap-2 px-5 py-3 text-xs"><span className="text-accent">{log.action}</span><span className="text-muted">{log.targetType}{log.targetId ? ` · ${log.targetId}` : ""}</span><span className="ml-auto text-[10px] text-muted">{log.createdAt.toLocaleString()}</span></div>)}</div> : <div className="p-6 text-xs text-muted">No administrative changes recorded yet.</div>}</section>
    <p className="text-[10px] leading-5 text-muted">Plan records are configurable and limits are enforced by server APIs. Paystack/Stripe checkout and webhook adapters, provider-cost ingestion for non-SEOFlow calls, revenue reporting and white-label exports require additional integration credentials and are not represented as live here.</p>
  </div>;
}
