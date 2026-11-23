import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ArrowRight, Globe2, SearchCheck } from "lucide-react";
import { db } from "@/db";
import { auditReports, crawlJobs, organizationMembers, projects } from "@/db/schema";
import { getSession } from "@/lib/authz";
import { CreateProjectForm } from "@/components/projects/create-project-form";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) return null;
  const rows = await db.select({ project: projects }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).orderBy(desc(projects.updatedAt)).limit(100);
  const list = rows.map((row) => row.project);
  const crawlRows = list.length ? await db.select({ crawl: crawlJobs, report: auditReports })
    .from(crawlJobs).leftJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .orderBy(desc(crawlJobs.createdAt)).limit(500) : [];
  const latestByProject = new Map<string, (typeof crawlRows)[number]>();
  for (const row of crawlRows) if (list.some((project) => project.id === row.crawl.projectId) && !latestByProject.has(row.crawl.projectId)) latestByProject.set(row.crawl.projectId, row);

  return <div className="space-y-7">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow text-accent">Your workspace</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Projects</h1><p className="mt-2 text-sm text-muted">Websites you own or are authorized to analyze.</p></div><CreateProjectForm /></div>
    {list.length === 0 ? <section className="surface flex min-h-[320px] flex-col items-center justify-center p-8 text-center"><span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-accent/20 bg-accent/10 text-accent"><Globe2 size={24} /></span><h2 className="mt-5 text-lg font-semibold">No websites added</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted">Create a project to configure your target market, manage audits and review evidence-backed findings.</p><div className="mt-5"><CreateProjectForm /></div></section> : <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{list.map((project) => {
      const latest = latestByProject.get(project.id);
      return <article key={project.id} className="surface group flex min-h-[250px] flex-col p-5 transition hover:border-accent/30">
        <div className="flex items-start justify-between"><span className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-background text-accent"><Globe2 size={18} /></span><span className={`rounded-full px-2.5 py-1 text-[10px] capitalize ${latest?.crawl.status === "running" || latest?.crawl.status === "queued" ? "bg-amber-400/10 text-amber-300" : latest?.crawl.status === "failed" ? "bg-red-400/10 text-red-300" : "bg-background text-muted"}`}>{latest?.crawl.status ?? "not audited"}</span></div>
        <h2 className="mt-5 truncate text-base font-semibold">{project.name}</h2><p className="mt-1 truncate text-xs text-muted">{project.websiteUrl}</p>
        <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl border border-border bg-background/40 p-3"><div><p className="text-[10px] text-muted">Latest score</p><p className="mt-1 text-lg font-semibold">{latest?.report ? <span className="text-accent">{latest.report.overallScore}<small className="ml-1 text-[10px] font-normal text-muted">/ 100</small></span> : "—"}</p></div><div><p className="text-[10px] text-muted">Pages analyzed</p><p className="mt-1 text-lg font-semibold">{latest?.crawl.pagesProcessed ?? "—"}</p></div></div>
        <div className="mt-auto flex items-center justify-between pt-5"><p className="text-[10px] text-muted">{project.targetCountry ? `Target: ${project.targetCountry}` : "Target market not set"}</p><Link href={`/dashboard/projects/${project.id}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-accent">Open project <ArrowRight size={13} className="transition group-hover:translate-x-0.5" /></Link></div>
      </article>;
    })}</div>}
    <div className="flex items-start gap-2 rounded-xl border border-border/70 bg-card/40 p-4 text-[11px] leading-5 text-muted"><SearchCheck size={15} className="mt-0.5 shrink-0 text-accent" />Site health numbers are calculated only from completed SEOFlow audits. They are internal diagnostic metrics, not Google ranking scores.</div>
  </div>;
}
