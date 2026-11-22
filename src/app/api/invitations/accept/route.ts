import { createHash } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { organizationInvitations, organizationMembers, organizations } from "@/db/schema";
import { requireApiUser } from "@/lib/api-auth";
import { HttpError, jsonError, readJson } from "@/lib/http";

const schema = z.object({ token: z.string().min(20).max(200) }).strict();

export async function POST(request: Request) {
  try {
    const user = await requireApiUser();
    if (!user.emailVerified) throw new HttpError(403, "Verify your email before accepting a workspace invitation.", "EMAIL_NOT_VERIFIED");
    const { token } = schema.parse(await readJson(request));
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const [invitation] = await db.select().from(organizationInvitations).where(and(
      eq(organizationInvitations.tokenHash, tokenHash),
      isNull(organizationInvitations.acceptedAt),
      gt(organizationInvitations.expiresAt, new Date())
    )).limit(1);
    if (!invitation) throw new HttpError(404, "This invitation is invalid, expired or already used.", "INVITATION_INVALID");
    if (invitation.email.toLowerCase() !== user.email.toLowerCase()) throw new HttpError(403, "Sign in with the email address this invitation was sent to.", "INVITATION_EMAIL_MISMATCH");
    await db.transaction(async (tx) => {
      await tx.insert(organizationMembers).values({ organizationId: invitation.organizationId, userId: user.id, role: invitation.role }).onConflictDoNothing();
      await tx.update(organizationInvitations).set({ acceptedAt: new Date() }).where(and(eq(organizationInvitations.id, invitation.id), isNull(organizationInvitations.acceptedAt)));
    });
    const [organization] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, invitation.organizationId)).limit(1);
    return NextResponse.json({ ok: true, workspace: organization });
  } catch (error) { return jsonError(error); }
}
