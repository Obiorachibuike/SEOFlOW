import { createHmac, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/api-auth";
import { requireProject } from "@/lib/authz";
import { HttpError, jsonError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireApiUser();
    const { projectId } = await context.params;
    await requireProject(projectId, user.id, ["owner", "admin", "seo_manager"]);
    const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
    const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/api/google/search-console/callback`;
    if (!clientId || !process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET) throw new HttpError(503, "Google Search Console OAuth is not configured for this deployment.", "GOOGLE_CONFIG_MISSING");
    const secret = process.env.BETTER_AUTH_SECRET;
    if (!secret) throw new HttpError(503, "OAuth state signing is not configured.", "OAUTH_CONFIG_MISSING");
    const payload = Buffer.from(JSON.stringify({ projectId, userId: user.id, expiresAt: Date.now() + 10 * 60_000, nonce: randomBytes(24).toString("base64url") })).toString("base64url");
    const signature = createHmac("sha256", secret).update(payload).digest("base64url");
    const state = `${payload}.${signature}`;
    const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorization.search = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "https://www.googleapis.com/auth/webmasters.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      state
    }).toString();
    const response = NextResponse.redirect(authorization);
    response.cookies.set("seoflow-gsc-oauth-state", state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/api/google/search-console/callback",
      maxAge: 600
    });
    return response;
  } catch (error) { return jsonError(error); }
}
