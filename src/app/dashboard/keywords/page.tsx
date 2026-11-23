import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers, projects } from "@/db/schema";
import { dataForSeoCredentialsConfigured } from "@/lib/seo-data/dataforseo";
import { getSession } from "@/lib/authz";
import { KeywordManager } from "@/components/keywords/keyword-manager";

export default async function KeywordsPage() {
  const session = await getSession();
  if (!session) return null;
  const rows = await db.select({ project: projects, role: organizationMembers.role }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).limit(100);
  const projectList = rows.map(({ project, role }) => ({ id: project.id, name: project.name, targetCountry: project.targetCountry, targetLanguage: project.targetLanguage, canManage: ["owner", "admin", "seo_manager", "editor"].includes(role) }));
  return <div className="space-y-6"><div><p className="eyebrow text-accent">Research workspace</p><h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Keywords</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Organize target phrases by project and intent. Estimated metrics require a configured data provider; observed Search Console metrics are separate from estimates.</p></div><KeywordManager projects={projectList} providerConfigured={dataForSeoCredentialsConfigured()} /></div>;
}
