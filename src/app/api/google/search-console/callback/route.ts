import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { parseTokenResponse, saveGoogleTokens } from "@/lib/google/search-console";
import { requireProject } from "@/lib/authz";

export const runtime = "nodejs";

interface OAuthState { projectId: string; userId: string; expiresAt: number; nonce: string }

export async function GET(request: NextRequest) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const requestUrl = new URL(request.url);
  const fail = (reason: string, projectId?: string) => {
    const destination = new URL(projectId ? `/dashboard/projects/${projectId}` : "/dashboard/settings", appUrl);
    destination.searchParams.set("gsc", "error");
    destination.searchParams.set("reason", reason);
    const response = NextResponse.redirect(destination);
    response.cookies.delete("seoflow-gsc-oauth-state");
    return response;
  };
  const state = requestUrl.searchParams.get("state");
  const storedState = request.cookies.get("seoflow-gsc-oauth-state")?.value;
  const code = requestUrl.searchParams.get("code");
  const oauthError = requestUrl.searchParams.get("error");
  if (!state || !storedState || !safeEqual(state, storedState)) return fail("state");
  const decoded = verifyState(state);
  if (!decoded) return fail("state");
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.id !== decoded.userId || decoded.expiresAt < Date.now()) return fail("session", decoded.projectId);
  try { await requireProject(decoded.projectId, session.user.id, ["owner", "admin", "seo_manager"]); }
  catch { return fail("access", decoded.projectId); }
  if (oauthError || !code) return fail("denied", decoded.projectId);
  const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_SEARCH_CONSOLE_REDIRECT_URI ?? `${appUrl}/api/google/search-console/callback`;
  if (!clientId || !clientSecret) return fail("configuration", decoded.projectId);
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code" }),
      signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) return fail("token", decoded.projectId);
    const tokenSet = parseTokenResponse(await response.json() as unknown);
    await saveGoogleTokens({
      projectId: decoded.projectId,
      accessToken: tokenSet.access_token,
      refreshToken: tokenSet.refresh_token,
      expiresIn: tokenSet.expires_in,
      scope: tokenSet.scope
    });
    const destination = new URL(`/dashboard/projects/${decoded.projectId}`, appUrl);
    destination.searchParams.set("gsc", "connected");
    const result = NextResponse.redirect(destination);
    result.cookies.delete("seoflow-gsc-oauth-state");
    return result;
  } catch (error) {
    console.error("Search Console OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    return fail("token", decoded.projectId);
  }
}

function verifyState(state: string): OAuthState | null {
  const secret = process.env.BETTER_AUTH_SECRET;
  const [payload, signature] = state.split(".");
  if (!secret || !payload || !signature) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(signature, "base64url"); } catch { return null; }
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    if (typeof value.projectId !== "string" || typeof value.userId !== "string" || typeof value.expiresAt !== "number" || typeof value.nonce !== "string") return null;
    return value;
  } catch { return null; }
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
