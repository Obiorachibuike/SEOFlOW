import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { organizationMembers, organizations } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { jsonError } from "@/lib/http";

export async function GET() {
  try {
    const user = await requireApiUser();
    const rows = await db.select({ organization: organizations, role: organizationMembers.role })
      .from(organizationMembers).innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
      .where(eq(organizationMembers.userId, user.id)).orderBy(asc(organizations.createdAt));
    return NextResponse.json({ workspaces: rows.map(({ organization, role }) => ({ ...organization, role })) });
  } catch (error) { return jsonError(error); }
}
