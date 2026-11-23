import { headers } from "next/headers";
import { auth } from "@/auth";
import { HttpError } from "@/lib/http";

export async function requireApiUser() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Sign in to continue.", "UNAUTHENTICATED");
  return session.user;
}
