import { headers } from "next/headers";
import { auth } from "@/auth";
import { HttpError } from "@/lib/http";
import { classifyAuthError, ERROR_CODES } from "@/lib/errors";

/**
 * Require an authenticated user for an API route.
 *
 * A missing session produces 401. An unexpected failure while validating the
 * session (typically a database outage) is classified and thrown as an
 * AppError carrying a reference ID.
 */
export async function requireApiUser() {
  let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
  try {
    session = await auth.api.getSession({ headers: await headers() });
  } catch (error) {
    throw classifyAuthError(error, "auth.session", ERROR_CODES.AUTH_SESSION_ERROR);
  }
  if (!session) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  return session.user;
}
