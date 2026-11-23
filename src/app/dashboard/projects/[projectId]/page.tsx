import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { ArrowLeft, CircleAlert, Clock3, ExternalLink, FileBarChart2, Gauge, Globe2, Sparkles } from "lucide-react";
import { db } from "@/db";
import { auditReports, crawlJobs, crawledPages, projectIntegrations, seoIssues } from "@/db/schema";
import { getSession, requireProject } from "@/lib/authz";
import { CrawlRunner } from "@/components/projects/crawl-runner";
import { SearchConsoleCard } from "@/components/projects/search-console-card";
import { SeoDataPanel } from "@/components/projects/seo-data-panel";
import { dataForSeoCredentialsConfigured } from "@/lib/seo-data/dataforseo";

export default async function ProjectPage({ params }: { params: Promise<{ projectId: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const { projectId } = await params;
  let membership;
  try { membership = await requireProject(projectId, session.user.id); } catch { notFound(); }
  const project = membership.project;
  const crawlRows = await db.select({ crawl: crawlJobs, report: auditReports })
    .from(crawlJobs).leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .where(eq(crawlJobs.projectId, projectId)).orderBy(desc(crawlJobs.createdAt)).limit(20);
  const latestRun = crawlRows[0] ?? null;
  const [latestAudit] = await db.select({ crawl: crawlJobs, report: auditReports }).from(crawlJobs)
    .innerJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .where(eq(crawlJobs.projectId, projectId)).orderBy(desc(auditReports.generatedAt)).limit(1);
  const [searchConsole] = await db.select().from(projectIntegrations).where(and(eq(projectIntegrations.projectId, projectId), eq(projectIntegrations.provider, "google-search-console"))).limit(1);
  const issues = latestAudit ? await db.select().from(seoIssues).where(eq(seoIssues.crawlId, latestAudit.crawl.id)).orderBy(desc(seoIssues.detectedAt)).limit(100) : [];
  const topIssues = issues.filter((issue) => issue.severity !== "info").slice(0, 6);
  const pages = latestAudit ? await db.select().from(crawledPages).where(eq(crawledPages.crawlId, latestAudit.crawl.id)).orderBy(crawledPages.depth).limit(8) : [];
  const categoryScores = latestAudit?.report.categoryScores ?? {};
  const runningId = latestRun?.crawl.id ?? null;
  const score = latestAudit?.report.overallScore;

  return <div className="space-y-7">
    <div className="flex items-center gap-2 text-xs text-muted"><Link href="/dashboard/projects" className="inline-flex items-center gap-1 hover:text-foreground"><ArrowLeft size={13} /> Projects</Link><span>/</span><span className="truncate text-foreground">{project.name}</span></div>
    <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div className="min-w-0"><p className="eyebrow text-accent">Website project</p><h1 className="mt-2 truncate text-2xl font-semibold tracking-tight sm:text-3xl">{project.name}</h1><a href={project.websiteUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent">{project.websiteUrl}<ExternalLink size={13} /></a><p className="mt-2 text-xs text-muted">{project.targetCountry ? `Target country ${project.targetCountry}` : "No target country set"}{project.targetLanguage ? ` · Language ${project.targetLanguage}` : ""}</p></div><CrawlRunner projectId={project.id} pageLimit={project.crawlPageLimit} activeCrawlId={runningId} /></div>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <div className="surface p-5"><div className="flex items-center justify-between"><p className="text-xs text-muted">Latest diagnostic score</p><Gauge size={16} className="text-accent" /></div><p className="mt-5 text-3xl font-semibold">{score === undefined ? "—" : <span className="text-accent">{score}<small className="ml-1 text-xs font-normal text-muted">/ 100</small></span>}</p><p className="mt-2 text-[10px] leading-4 text-muted">{score === undefined ? "Run an audit to calculate" : "Internal diagnostic metric, not a ranking score"}</p></div>
      <div className="surface p-5"><div className="flex items-center justify-between"><p className="text-xs text-muted">Pages analyzed</p><Globe2 size={16} className="text-muted" /></div><p className="mt-5 text-3xl font-semibold">{latestAudit?.crawl.pagesProcessed ?? "—"}</p><p className="mt-2 text-[10px] text-muted">{latestAudit?.crawl.finishedAt ? `Completed ${latestAudit.crawl.finishedAt.toLocaleString()}` : "No completed crawl"}</p></div>
      <div className="surface p-5"><div className="flex items-center justify-between"><p className="text-xs text-muted">Critical findings</p><CircleAlert size={16} className="text-amber-300" /></div><p className="mt-5 text-3xl font-semibold">{latestAudit ? (latestAudit.report.issueCounts.critical ?? 0) + (latestAudit.report.issueCounts.high ?? 0) : "—"}</p><p className="mt-2 text-[10px] text-muted">Critical and high severity in latest audit</p></div>
      <div className="surface p-5"><div className="flex items-center justify-between"><p className="text-xs text-muted">Audit history</p><Clock3 size={16} className="text-muted" /></div><p className="mt-5 text-3xl font-semibold">{crawlRows.length}</p><p className="mt-2 text-[10px] text-muted">Saved crawl jobs</p></div>
    </section>

    {latestAudit && <section className="grid gap-5 xl:grid-cols-[1.15fr_.85fr]">
      <article className="surface p-5 sm:p-6"><div className="flex items-start justify-between"><div><h2 className="text-sm font-semibold">Score breakdown</h2><p className="mt-1 text-xs text-muted">Signals from this audit, normalized to an internal 0–100 diagnostic scale.</p></div><span className="rounded-lg border border-border px-2 py-1 text-[9px] text-muted">NOT A GOOGLE SCORE</span></div>
        <div className="mt-6 space-y-4">{[["Technical SEO", "technical"],["On-page SEO", "on_page"],["Content", "content"],["Internal links", "internal_links"],["Structured data", "structured_data"],["Performance", "performance"]].map(([label,key]) => {const value = categoryScores[key]; return <div key={key}><div className="mb-1.5 flex justify-between text-xs"><span className="text-muted">{label}</span><span className={value === null || value === undefined ? "text-muted" : "text-foreground"}>{value === null || value === undefined ? "Not measured" : `${value}/100`}</span></div><div className="h-1.5 overflow-hidden rounded-full bg-border">{value !== null && value !== undefined && <div className="h-full rounded-full bg-accent" style={{ width: `${value}%` }} />}</div></div>;})}</div>
        <p className="mt-5 text-[10px] leading-5 text-muted">Performance is shown as unmeasured until a supported field-data or Lighthouse integration is configured; it is not inferred from crawler checks.</p>
      </article>
      <article className="surface p-5 sm:p-6"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Next steps</h2><p className="mt-1 text-xs text-muted">Recommendations derived from saved findings.</p></div><Sparkles size={16} className="text-accent" /></div>
        {topIssues.length ? <div className="mt-5 space-y-3">{topIssues.slice(0,4).map((issue) => <div key={issue.id} className="rounded-xl border border-border bg-background/50 p-3"><div className="flex items-center gap-2"><span className={`rounded px-1.5 py-0.5 text-[9px] uppercase ${issue.severity === "critical" || issue.severity === "high" ? "bg-red-400/10 text-red-300" : "bg-amber-400/10 text-amber-300"}`}>{issue.severity}</span><p className="text-xs font-medium">{issue.description}</p></div><p className="mt-2 text-[10px] leading-5 text-muted">{issue.recommendation}</p></div>)}</div> : <div className="mt-5 rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted">No high-priority findings in this audit.</div>}
        <Link href={`/dashboard/studio?projectId=${project.id}`} className="btn-secondary mt-4 w-full"><Sparkles size={14} />Open content studio</Link>
      </article>
    </section>}

    <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
      <article className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Latest crawl pages</h2><p className="mt-1 text-xs text-muted">Observed URLs and page-level signals</p></div><Link href={`/dashboard/issues?projectId=${project.id}`} className="text-xs text-accent hover:underline">All findings</Link></div>
        {pages.length ? <div className="divide-y divide-border">{pages.map((page) => <div key={page.id} className="flex items-center gap-3 px-5 py-3.5"><span className={`h-2 w-2 rounded-full ${page.statusCode && page.statusCode >= 400 ? "bg-red-400" : "bg-accent"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{page.title ?? "Untitled page"}</p><p className="mt-1 truncate font-mono text-[10px] text-muted">{page.url}</p></div><div className="hidden text-right text-[10px] text-muted sm:block"><p>{page.statusCode ?? "—"} · {page.wordCount} words</p><p className="mt-1">Depth {page.depth}</p></div></div>)}</div> : <div className="p-8 text-center"><Globe2 size={20} className="mx-auto text-muted" /><p className="mt-3 text-xs text-muted">Run an audit to populate real crawl observations.</p></div>}
      </article>
      <article className="surface overflow-hidden"><div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Audit history</h2><p className="mt-1 text-xs text-muted">Most recent 20 jobs</p></div><FileBarChart2 size={16} className="text-muted" /></div>
        <div className="divide-y divide-border">{crawlRows.map(({ crawl, report }) => <div key={crawl.id} className="flex items-center gap-3 px-5 py-3.5"><span className={`h-2 w-2 rounded-full ${crawl.status === "completed" ? "bg-accent" : crawl.status === "failed" ? "bg-red-400" : crawl.status === "cancelled" ? "bg-muted" : "animate-pulse bg-amber-300"}`} /><div className="min-w-0 flex-1"><p className="text-xs font-medium capitalize">{crawl.status} crawl</p><p className="mt-1 text-[10px] text-muted">{crawl.createdAt.toLocaleString()} · {crawl.pagesProcessed} pages</p></div>{report && <span className="text-xs font-semibold text-accent">{report.overallScore}</span>}</div>)}{crawlRows.length === 0 && <div className="p-8 text-center text-xs text-muted">No crawl jobs yet.</div>}</div>
      </article>
    </section>
    <SearchConsoleCard projectId={project.id} connected={Boolean(searchConsole)} selectedProperty={searchConsole?.externalPropertyId ?? null} canManage={["owner", "admin", "seo_manager"].includes(membership.role)} />
    <SeoDataPanel projectId={project.id} canManage={["owner", "admin", "seo_manager"].includes(membership.role)} providerConfigured={dataForSeoCredentialsConfigured()} />
    <div className="flex items-start gap-2 text-[10px] leading-5 text-muted"><FileBarChart2 size={13} className="mt-0.5 shrink-0" /> Scores are versioned internal diagnostics. Crawl findings represent the pages SEOFlow could fetch under your robots.txt and crawl-limit settings; they may not describe every page on the site.</div>
  </div>;
}
