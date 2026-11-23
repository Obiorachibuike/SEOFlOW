import Link from "next/link";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { AlertTriangle, ArrowRight, CircleCheck } from "lucide-react";
import { db } from "@/db";
import { crawlJobs, organizationMembers, projects, seoIssues } from "@/db/schema";
import { getSession } from "@/lib/authz";

export default async function IssuesPage({ searchParams }: { searchParams: Promise<{ projectId?: string }> }) {
  const session = await getSession();
  if (!session) return null;
  const params = await searchParams;
  const rows = await db.select({ project: projects }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).limit(100);
  let projectList = rows.map((row) => row.project);
  if (params.projectId) projectList = projectList.filter((project) => project.id === params.projectId);
  const crawlRows = projectList.length ? await db.select().from(crawlJobs)
    .where(inArray(crawlJobs.projectId, projectList.map((project) => project.id))).orderBy(desc(crawlJobs.createdAt)).limit(500) : [];
  const latestByProject = new Map<string, typeof crawlRows[number]>();
  for (const crawl of crawlRows) if (!latestByProject.has(crawl.projectId)) latestByProject.set(crawl.projectId, crawl);
  const latestIds = [...latestByProject.values()].filter((crawl) => crawl.status === "completed").map((crawl) => crawl.id);
  const findings = latestIds.length ? await db.select().from(seoIssues).where(and(inArray(seoIssues.crawlId, latestIds), ne(seoIssues.severity, "info"))).orderBy(desc(seoIssues.detectedAt)).limit(200) : [];
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  const severityStyle: Record<string,string> = { critical: "bg-red-400/10 text-red-300", high: "bg-orange-400/10 text-orange-300", medium: "bg-amber-400/10 text-amber-300", low: "bg-slate-400/10 text-slate-300" };

  return <div className="space-y-7">
    <div><p className="eyebrow text-accent">Audit findings</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Issues</h1><p className="mt-2 text-sm text-muted">Prioritized, deterministic checks from your latest completed crawls.</p></div>
    <div className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">Latest findings</h2><p className="mt-1 text-xs text-muted">Showing up to 200 non-informational checks</p></div><span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted">{findings.length} results</span></div>
      {findings.length ? <div className="divide-y divide-border">{findings.map((issue) => <article key={issue.id} className="grid gap-3 px-5 py-4 md:grid-cols-[100px_1fr_170px] md:items-start">
        <span className={`w-fit rounded-full px-2 py-1 text-[9px] font-semibold uppercase tracking-wide ${severityStyle[issue.severity] ?? "bg-muted/10 text-muted"}`}>{issue.severity}</span>
        <div><div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold">{issue.description}</h3><span className="rounded bg-background px-1.5 py-0.5 text-[9px] text-muted">{issue.category.replaceAll("_", " ")}</span></div><p className="mt-2 break-all font-mono text-[10px] text-muted">{issue.url}</p><p className="mt-2 text-[11px] leading-5 text-muted">{issue.recommendation}</p>{Object.keys(issue.evidence).length > 0 && <details className="mt-2 text-[10px] text-muted"><summary className="cursor-pointer text-accent">View evidence</summary><pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-[10px] leading-5">{JSON.stringify(issue.evidence, null, 2)}</pre></details>}</div>
        <Link href={`/dashboard/projects/${issue.projectId}`} className="flex items-center gap-1 text-[10px] text-muted hover:text-accent">{projectById.get(issue.projectId)?.name ?? "Project"}<ArrowRight size={11} /></Link>
      </article>)}</div> : <div className="flex min-h-[280px] flex-col items-center justify-center p-8 text-center"><CircleCheck size={28} className="text-accent" /><h2 className="mt-4 text-sm font-semibold">Nothing to review here yet</h2><p className="mt-2 max-w-sm text-xs leading-5 text-muted">Add a website and complete an audit. Findings are saved from observed pages; this page never uses sample issues.</p>{projectList.length > 0 && <Link href={`/dashboard/projects/${projectList[0]!.id}`} className="btn-secondary mt-4">Open a project <ArrowRight size={14} /></Link>}</div>}
    </div>
    <div className="flex items-start gap-2 text-[10px] leading-5 text-muted"><AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />The issue list only includes pages reached under the crawl limit and robots policy. External links are recorded but not fetched by the crawler, so external-link status is not inferred.</div>
  </div>;
}
