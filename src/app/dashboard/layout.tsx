import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getSession } from "@/lib/authz";
import { AppShell } from "@/components/dashboard/app-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  const [account] = await db.select({ role: users.platformRole }).from(users).where(eq(users.id, session.user.id)).limit(1);
  return <AppShell user={{ name: session.user.name, email: session.user.email }} isAdmin={account?.role === "super_admin"}>{children}</AppShell>;
}
