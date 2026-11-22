"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AudioLines, LoaderCircle, MailCheck, Users } from "lucide-react";

function InviteContent() {
  const params = useSearchParams();
  const token = params.get("token") ?? "";
  const [status, setStatus] = useState<"loading" | "accepted" | "login" | "error">(token ? "loading" : "error");
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void fetch("/api/invitations/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) })
      .then(async (response) => ({ response, data: await response.json() as { workspace?: { name: string }; error?: string } }))
      .then(({ response, data }) => {
        if (cancelled) return;
        if (response.ok) { setStatus("accepted"); setMessage(`You joined ${data.workspace?.name ?? "the workspace"}.`); }
        else if (response.status === 401) setStatus("login");
        else if (data.error?.toLowerCase().includes("verify your email")) { setStatus("login"); setMessage("Verify your email first, then return to this invitation link."); }
        else { setStatus("error"); setMessage(data.error ?? "This invitation could not be accepted."); }
      }).catch(() => { if (!cancelled) { setStatus("error"); setMessage("The invitation service is temporarily unavailable."); } });
    return () => { cancelled = true; };
  }, [token]);
  return <main className="flex min-h-screen items-center justify-center px-5 py-12"><div className="surface w-full max-w-md p-8 text-center">
    <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={20} /></span><span className="text-lg font-bold">SEOFlow<span className="text-accent">.</span></span></Link>
    {status === "loading" && <><LoaderCircle size={30} className="mx-auto animate-spin text-accent" /><h1 className="mt-5 text-xl font-semibold">Checking invitation</h1><p className="mt-2 text-sm text-muted">Verifying the secure invitation token…</p></>}
    {status === "accepted" && <><MailCheck size={30} className="mx-auto text-accent" /><h1 className="mt-5 text-xl font-semibold">You’re in</h1><p className="mt-2 text-sm text-muted">{message}</p><Link href="/dashboard" className="btn-primary mt-6">Open workspace</Link></>}
    {status === "login" && <><Users size={30} className="mx-auto text-accent" /><h1 className="mt-5 text-xl font-semibold">Accept your invitation</h1><p className="mt-2 text-sm leading-6 text-muted">{message || "Sign in or create a verified account with the email address this invitation was sent to."}</p><div className="mt-6 flex justify-center gap-2"><Link href={`/login?invite=${encodeURIComponent(token)}`} className="btn-secondary">Sign in</Link><Link href={`/signup?invite=${encodeURIComponent(token)}`} className="btn-primary">Create account</Link></div></>}
    {status === "error" && <><Users size={30} className="mx-auto text-red-300" /><h1 className="mt-5 text-xl font-semibold">Invitation unavailable</h1><p className="mt-2 text-sm text-muted">{message || "This link is missing, expired, or already used."}</p></>}
    {status !== "accepted" && status !== "login" && <Link href="/" className="mt-6 block text-xs text-muted hover:text-foreground">Return to SEOFlow</Link>}
  </div></main>;
}

export default function InvitePage() { return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted">Loading invitation…</div>}><InviteContent /></Suspense>; }
