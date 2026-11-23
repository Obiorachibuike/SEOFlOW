import { desc, eq, inArray } from "drizzle-orm";
import { Sparkles } from "lucide-react";
import { db } from "@/db";
import { contentDocuments, organizationMembers, projects } from "@/db/schema";
import { getSession } from "@/lib/authz";
import { ContentStudio } from "@/components/studio/content-studio";

export default async function StudioPage() {
  const session = await getSession();
  if (!session) return null;
  const memberships = await db.select({ project: projects }).from(organizationMembers)
    .innerJoin(projects, eq(projects.organizationId, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, session.user.id)).limit(100);
  const projectList = memberships.map((row) => row.project);
  const initialDocuments = projectList.length ? await db.select().from(contentDocuments)
    .where(inArray(contentDocuments.projectId, projectList.map((project) => project.id)))
    .orderBy(desc(contentDocuments.updatedAt)).limit(100) : [];
  return <div className="space-y-6"><div><p className="eyebrow text-accent">Create with intention</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">Content studio <Sparkles size={21} className="text-accent" /></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Edit, save and approve drafts without publishing automatically. AI suggestions use evidence from the latest completed crawl and remain proposals.</p></div><ContentStudio projects={projectList} initialDocuments={initialDocuments} /></div>;
}
