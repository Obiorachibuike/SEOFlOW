import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { organizationMembers, organizations, plans, subscriptions, users } from "@/db/schema";

export async function ensureWorkspace(user: { id: string; name: string; email: string }) {
  const [existing] = await db.select({ organization: organizations })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, user.id))
    .orderBy(asc(organizations.createdAt))
    .limit(1);
  if (existing) return existing.organization;

  return db.transaction(async (tx) => {
    // Serialize first-workspace creation for this user; a concurrent request may have
    // created their workspace while this transaction was waiting on the user row.
    await tx.select({ id: users.id }).from(users).where(eq(users.id, user.id)).for("update");
    const [createdByAnotherRequest] = await tx.select({ organization: organizations })
      .from(organizationMembers)
      .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, user.id))
      .orderBy(asc(organizations.createdAt))
      .limit(1);
    if (createdByAnotherRequest) return createdByAnotherRequest.organization;

    const slug = `workspace-${randomUUID().slice(0, 8)}`;
    const [organization] = await tx.insert(organizations).values({
      name: `${user.name.trim() || user.email.split("@")[0]}'s workspace`,
      slug,
      createdBy: user.id
    }).returning();
    await tx.insert(organizationMembers).values({ organizationId: organization.id, userId: user.id, role: "owner" });
    const [freePlan] = await tx.select({ id: plans.id }).from(plans).where(and(eq(plans.slug, "free"), eq(plans.enabled, true))).limit(1);
    if (freePlan) {
      await tx.insert(subscriptions).values({ organizationId: organization.id, planId: freePlan.id, provider: "internal", status: "active" });
    }
    return organization;
  });
}
