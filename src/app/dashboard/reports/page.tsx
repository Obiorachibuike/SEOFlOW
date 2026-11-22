import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { Download, FileBarChart2, FileText, Info } from "lucide-react";
import { db } from "@/db";
import { auditReports, crawlJobs, organizationMembers, projects, reportArtifacts } from "@/db/schema";
import { getSession } from "@/lib/authz";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) return null;
  const memberships = await db.select({ project: projects }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).limit(100);
  const projectList = memberships.map((item) => item.project);
  const reportRows = projectList.length ? await db.select({ crawl: crawlJobs, report: auditReports })
    .from(crawlJobs).innerJoin(auditReports, eq(auditReports.crawlId, crawlJobs.id))
    .where(inArray(crawlJobs.projectId, projectList.map((project) => project.id)))
    .orderBy(desc(auditReports.generatedAt)).limit(200) : [];
  const artifactRows = projectList.length ? await db.select({ artifact: reportArtifacts, project: projects })
    .from(reportArtifacts).innerJoin(projects, eq(projects.id, reportArtifacts.projectId))
    .where(inArray(reportArtifacts.projectId, projectList.map((project) => project.id)))
    .orderBy(desc(reportArtifacts.createdAt)).limit(100) : [];
  const projectById = new Map(projectList.map((project) => [project.id, project]));
  return <div className="space-y-7">
    <div><p className="eyebrow text-accent">Evidence you can share</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Reports</h1><p className="mt-2 text-sm text-muted">Export actual audit results with methodology notes and affected URLs.</p></div>
    <div className="grid gap-4 sm:grid-cols-3"><div className="surface p-5"><FileBarChart2 size={18} className="text-accent" /><h2 className="mt-4 text-sm font-semibold">SEO audit PDF</h2><p className="mt-2 text-xs leading-5 text-muted">Score breakdown, crawl details, findings and recommendations.</p></div><div className="surface p-5"><Download size={18} className="text-accent" /><h2 className="mt-4 text-sm font-semibold">CSV findings</h2><p className="mt-2 text-xs leading-5 text-muted">Structured issue rows for spreadsheets and further analysis.</p></div><div className="surface p-5"><Info size={18} className="text-accent" /><h2 className="mt-4 text-sm font-semibold">Honest metrics</h2><p className="mt-2 text-xs leading-5 text-muted">Diagnostic scores are labeled as internal measures—not Google ranking scores.</p></div></div>
    {artifactRows.length > 0 && <section className="surface overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Archived exports</h2><p className="mt-1 text-xs text-muted">Private S3-compatible objects are served through project-authorized downloads and checksum-verified before delivery.</p></div><div className="divide-y divide-border">{artifactRows.map(({ artifact, project }) => <div key={artifact.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{project.name} · {artifact.format.toUpperCase()} audit</p><p className="mt-1 text-xs text-muted">{artifact.createdAt.toLocaleString()} · {(artifact.byteSize / 1024).toFixed(1)} KB · SHA-256 verified on retrieval</p></div><a className="btn-secondary !px-3 !py-2 text-xs" href={`/api/projects/${project.id}/reports/artifacts/${artifact.id}`}><Download size={13} />Download archive</a></div>)}</div></section>}
    <section className="surface overflow-hidden"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">Completed audit reports</h2><p className="mt-1 text-xs text-muted">Each download is tied to the selected completed audit, including historical runs.</p></div>
      {reportRows.length ? <div className="divide-y divide-border">{reportRows.map(({ crawl, report }) => <div key={report.id} className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-background text-accent"><FileText size={18} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{projectById.get(crawl.projectId)?.name ?? "Project audit"}</p><p className="mt-1 truncate text-xs text-muted">{projectById.get(crawl.projectId)?.websiteUrl} · {report.generatedAt.toLocaleString()}</p><p className="mt-1 text-[10px] text-muted">{crawl.pagesProcessed} pages · diagnostic score {report.overallScore}/100 · {report.issueCounts.critical ?? 0} critical</p></div><div className="flex gap-2"><a href={`/api/projects/${crawl.projectId}/reports/pdf?crawlId=${crawl.id}`} className="btn-secondary !px-3 !py-2 text-xs"><Download size={13} />PDF</a><a href={`/api/projects/${crawl.projectId}/reports/csv?crawlId=${crawl.id}`} className="btn-secondary !px-3 !py-2 text-xs"><Download size={13} />CSV</a><Link href={`/dashboard/projects/${crawl.projectId}`} className="btn-primary !px-3 !py-2 text-xs">View</Link></div></div>)}</div> : <div className="flex min-h-[250px] flex-col items-center justify-center p-8 text-center"><FileText size={24} className="text-muted" /><p className="mt-4 text-sm font-medium">No reports to export</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted">Complete an audit to create a report with real findings. SEOFlow does not populate this page with sample reports.</p></div>}
    </section>
  </div>;
}
