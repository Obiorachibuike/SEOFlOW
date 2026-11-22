import { headers } from "next/headers";
import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db } from "@/db";
import { organizationMembers, projects, users } from "@/db/schema";
import { HttpError } from "@/lib/http";

export type Session = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;
export type OrganizationRole = "owner" | "admin" | "seo_manager" | "editor" | "viewer";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireSession() {
  const session = await getSession();
  if (!session) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  return session;
}

export async function requireAdmin(userId: string) {
  const [user] = await db.select({ role: users.platformRole }).from(users).where(eq(users.id, userId)).limit(1);
  if (user?.role !== "super_admin") throw new HttpError(403, "Administrator access is required.", "FORBIDDEN");
}

export async function getProjectMembership(projectId: string, userId: string) {
  const [result] = await db.select({
    project: projects,
    role: organizationMembers.role
  }).from(projects)
    .innerJoin(organizationMembers, and(
      eq(organizationMembers.organizationId, projects.organizationId),
      eq(organizationMembers.userId, userId)
    ))
    .where(eq(projects.id, projectId)).limit(1);
  return result ?? null;
}

export async function requireProject(projectId: string, userId: string, allowedRoles?: OrganizationRole[]) {
  const membership = await getProjectMembership(projectId, userId);
  if (!membership) throw new HttpError(404, "Project not found.", "PROJECT_NOT_FOUND");
  if (allowedRoles && !allowedRoles.includes(membership.role)) {
    throw new HttpError(403, "Your workspace role does not allow this action.", "FORBIDDEN");
  }
  return membership;
}

export async function getMembershipForOrganization(organizationId: string, userId: string) {
  const [membership] = await db.select().from(organizationMembers).where(and(
    eq(organizationMembers.organizationId, organizationId),
    eq(organizationMembers.userId, userId)
  )).limit(1);
  return membership ?? null;
}
