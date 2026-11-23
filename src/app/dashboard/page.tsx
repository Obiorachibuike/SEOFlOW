import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { Activity, ArrowRight, CircleAlert, Clock3, ExternalLink, FolderOpen, Gauge, SearchCheck } from "lucide-react";
import { db } from "@/db";
import { auditReports, crawlJobs, organizationMembers, projects, seoIssues } from "@/db/schema";
import { getSession } from "@/lib/authz";
import { MetricCard } from "@/components/dashboard/metric-card";
import { ScoreChart } from "@/components/dashboard/score-chart";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) return null;
  const membershipRows = await db.select({ project: projects })
    .from(organizationMembers).innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).orderBy(desc(projects.updatedAt)).limit(100);
  const projectList = membershipRows.map((row) => row.project);
  const projectIds = projectList.map((project) => project.id);
  const allCrawls = projectIds.length ? await db.select({ crawl: crawlJobs, report: auditReports })
    .from(crawlJobs).leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .where(inArray(crawlJobs.projectId, projectIds)).orderBy(desc(crawlJobs.createdAt)).limit(500) : [];
  const latestByProject = new Map<string, (typeof allCrawls)[number]>();
  const latestCompletedByProject = new Map<string, (typeof allCrawls)[number]>();
  for (const row of allCrawls) {
    if (!latestByProject.has(row.crawl.projectId)) latestByProject.set(row.crawl.projectId, row);
    if (row.report && !latestCompletedByProject.has(row.crawl.projectId)) latestCompletedByProject.set(row.crawl.projectId, row);
  }
  const activeCrawls = allCrawls.filter((row) => row.crawl.status === "queued" || row.crawl.status === "running").length;
  const scored = [...latestCompletedByProject.values()];
  const averageScore = scored.length ? Math.round(scored.reduce((sum, row) => sum + (row.report?.overallScore ?? 0), 0) / scored.length) : null;
  const analyzedPages = scored.reduce((sum, row) => sum + row.crawl.pagesProcessed, 0);
  const latestCrawlIds = scored.map((row) => row.crawl.id);
  const visibleIssues = latestCrawlIds.length ? await db.select({ severity: seoIssues.severity }).from(seoIssues).where(and(inArray(seoIssues.crawlId, latestCrawlIds), ne(seoIssues.severity, "info"))) : [];
  const historyProject = projectList[0];
  const historyRows = historyProject ? await db.select({ crawl: crawlJobs, report: auditReports })
    .from(crawlJobs).innerJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .where(eq(crawlJobs.projectId, historyProject.id)).orderBy(desc(auditReports.generatedAt)).limit(12) : [];
  const chartData = historyRows.reverse().map(({ crawl, report }) => ({
    label: report.generatedAt.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    score: report.overallScore,
    pages: crawl.pagesProcessed
  }));
  const recentProjects = projectList.slice(0, 5);

  return <div className="space-y-8">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="eyebrow text-accent">Workspace overview</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Welcome back, {session.user.name.split(" ")[0]}.</h1><p className="mt-2 text-sm text-muted">A clear view of what has been observed across your websites.</p></div>
      <Link href="/dashboard/projects" className="btn-primary w-fit"><SearchCheck size={16} />Manage websites</Link>
    </div>

    {projectList.length === 0 ? <section className="surface relative overflow-hidden p-7 sm:p-10">
      <div className="absolute -right-16 -top-20 h-72 w-72 rounded-full bg-accent/5 blur-[90px]" />
      <div className="relative max-w-xl"><div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"><FolderOpen size={21} /></div><p className="eyebrow mt-7 text-accent">Start with a real website</p><h2 className="mt-2 text-2xl font-semibold tracking-tight">Your workspace is ready for its first project.</h2><p className="mt-3 text-sm leading-6 text-muted">Add a site you own or manage. SEOFlow will check robots.txt, discover pages and save deterministic technical findings—without filling your dashboard with sample metrics.</p><Link href="/dashboard/projects" className="btn-primary mt-6">Add your first website <ArrowRight size={15} /></Link></div>
    </section> : <>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Websites" value={projectList.length} note="Projects in your workspace" icon={FolderOpen} />
        <MetricCard label="Diagnostic score" value={averageScore === null ? "—" : `${averageScore}/100`} note={averageScore === null ? "Complete an audit to calculate a score" : "Average of each site's latest completed audit"} icon={Gauge} tone={averageScore !== null && averageScore >= 80 ? "good" : "default"} />
        <MetricCard label="Pages analyzed" value={analyzedPages.toLocaleString()} note="Pages in latest completed audits" icon={Activity} />
        <MetricCard label="Open findings" value={visibleIssues.length.toLocaleString()} note="Non-informational findings in latest audits" icon={CircleAlert} tone={visibleIssues.length > 0 ? "warning" : "good"} />
      </section>
      <section className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
        <article className="surface p-5 sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><div><h2 className="text-sm font-semibold">Diagnostic score history</h2><p className="mt-1 text-xs text-muted">{historyProject ? `Latest completed audits · ${historyProject.name}` : "Score history"}</p></div><span className="rounded-lg border border-border px-2.5 py-1 text-[10px] text-muted">INTERNAL METRIC</span></div><ScoreChart data={chartData} /><p className="mt-2 text-[10px] leading-5 text-muted">This score is SEOFlow’s diagnostic summary of observed checks. It is not a Google ranking score or a prediction of search position.</p></article>
        <article className="surface p-5 sm:p-6"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Crawl activity</h2><p className="mt-1 text-xs text-muted">Recent jobs across your projects</p></div><span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted">{activeCrawls} active</span></div>
          <div className="mt-5 space-y-3">{allCrawls.slice(0, 5).map(({ crawl, report }) => <Link href={`/dashboard/projects/${crawl.projectId}`} key={crawl.id} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 p-3 transition hover:border-accent/30">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${crawl.status === "completed" ? "bg-accent/10 text-accent" : crawl.status === "failed" ? "bg-red-400/10 text-red-300" : "bg-background text-muted"}`}><Activity size={15} /></span>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{projectList.find((project) => project.id === crawl.projectId)?.name ?? "Website"}</p><p className="mt-1 text-[10px] text-muted">{crawl.pagesProcessed} pages · {crawl.createdAt.toLocaleDateString()}</p></div>
            <div className="text-right"><p className="text-[10px] capitalize text-muted">{crawl.status}</p>{report && <p className="mt-1 text-xs font-semibold text-accent">{report.overallScore}</p>}</div><ArrowRight size={13} className="text-muted" />
          </Link>)}{allCrawls.length === 0 && <div className="rounded-xl border border-dashed border-border p-6 text-center"><Clock3 size={18} className="mx-auto text-muted" /><p className="mt-3 text-xs font-medium">No audits run yet</p><p className="mt-1 text-[10px] text-muted">Start a crawl from any project.</p></div>}</div>
        </article>
      </section>
      <section className="surface overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-6"><div><h2 className="text-sm font-semibold">Your websites</h2><p className="mt-1 text-xs text-muted">Latest known status for each project</p></div><Link href="/dashboard/projects" className="flex items-center gap-1 text-xs text-accent hover:underline">All projects <ArrowRight size={13} /></Link></div>
        <div className="divide-y divide-border">{recentProjects.map((project) => { const latest = latestByProject.get(project.id); const latestAudit = latestCompletedByProject.get(project.id); return <Link key={project.id} href={`/dashboard/projects/${project.id}`} className="flex items-center gap-4 px-5 py-4 transition hover:bg-white/[0.02] sm:px-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-accent"><FolderOpen size={16} /></span>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-1 flex items-center gap-1 truncate text-xs text-muted">{project.websiteUrl}<ExternalLink size={11} /></p></div>
          {latestAudit?.report ? <div className="hidden text-right sm:block"><p className="text-xs font-semibold text-accent">{latestAudit.report.overallScore}/100</p><p className="mt-1 text-[10px] text-muted">latest completed audit</p></div> : <p className="hidden text-xs text-muted sm:block">No completed audit</p>}
          <span className={`rounded-full px-2.5 py-1 text-[10px] capitalize ${latest?.crawl.status === "running" || latest?.crawl.status === "queued" ? "bg-amber-400/10 text-amber-300" : latest?.crawl.status === "failed" ? "bg-red-400/10 text-red-300" : "bg-accent/10 text-accent"}`}>{latest?.crawl.status ?? "new"}</span><ArrowRight size={14} className="text-muted" />
        </Link>;})}</div>
      </section>
    </>}
    <p className="text-[10px] leading-5 text-muted">SEOFlow scores are internal diagnostic metrics based on observed crawl checks, not Google ranking scores. Performance and provider-based data appear only after a relevant integration is configured.</p>
  </div>;
}
