import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, ilike, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { organizationInvitations, organizationMembers, organizations, users } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { getMembershipForOrganization } from "@/lib/authz";
import { sendAccountEmail } from "@/lib/email";
import { HttpError, jsonError, readJson } from "@/lib/http";
import { rateLimit, rateLimitResponse } from "@/lib/rate-limit";

const invitationSchema = z.object({ email: z.string().trim().email().max(320), role: z.enum(["admin", "seo_manager", "editor", "viewer"]) }).strict();

export async function GET(_request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireApiUser();
    const { organizationId } = await context.params;
    const membership = await getMembershipForOrganization(organizationId, user.id);
    if (!membership) throw new HttpError(404, "Workspace not found.", "WORKSPACE_NOT_FOUND");
    const members = await db.select({ member: organizationMembers, user: { id: users.id, name: users.name, email: users.email } })
      .from(organizationMembers).innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(eq(organizationMembers.organizationId, organizationId)).orderBy(asc(organizationMembers.createdAt));
    const pendingInvitations = ["owner", "admin"].includes(membership.role)
      ? await db.select({ id: organizationInvitations.id, email: organizationInvitations.email, role: organizationInvitations.role, expiresAt: organizationInvitations.expiresAt, createdAt: organizationInvitations.createdAt })
        .from(organizationInvitations).where(and(eq(organizationInvitations.organizationId, organizationId), isNull(organizationInvitations.acceptedAt), gt(organizationInvitations.expiresAt, new Date())))
      : [];
    return NextResponse.json({ members: members.map(({ member, user: memberUser }) => ({ id: member.id, role: member.role, createdAt: member.createdAt, user: memberUser })), pendingInvitations });
  } catch (error) { return jsonError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ organizationId: string }> }) {
  try {
    const user = await requireApiUser();
    if (!await rateLimit(`invite:${user.id}`)) return rateLimitResponse();
    const { organizationId } = await context.params;
    const membership = await getMembershipForOrganization(organizationId, user.id);
    if (!membership || !["owner", "admin"].includes(membership.role)) throw new HttpError(403, "Only workspace owners and admins can invite members.", "FORBIDDEN");
    const input = invitationSchema.parse(await readJson(request));
    const email = input.email.toLowerCase();
    const [existingMember] = await db.select({ id: organizationMembers.id }).from(organizationMembers)
      .innerJoin(users, eq(users.id, organizationMembers.userId))
      .where(and(eq(organizationMembers.organizationId, organizationId), ilike(users.email, email))).limit(1);
    if (existingMember) throw new HttpError(409, "That person is already a workspace member.", "ALREADY_MEMBER");
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [invitation] = await db.insert(organizationInvitations).values({
      organizationId,
      email,
      role: input.role,
      tokenHash,
      invitedBy: user.id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000)
    }).returning({ id: organizationInvitations.id });
    const [organization] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, organizationId)).limit(1);
    const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/invite?token=${encodeURIComponent(token)}`;
    try {
      await sendAccountEmail({ to: email, subject: `Join ${organization?.name ?? "a workspace"} on SEOFlow`, url: inviteUrl, action: "invite" });
    } catch (error) {
      await db.delete(organizationInvitations).where(eq(organizationInvitations.id, invitation.id));
      throw error;
    }
    return NextResponse.json({ invitation: { email, role: input.role, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000) } }, { status: 201 });
  } catch (error) { return jsonError(error); }
}
