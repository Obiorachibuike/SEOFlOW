"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { authClient } from "@/auth/client";
import { describeAuthError } from "@/lib/client-errors";
import { AudioLines, ArrowLeft, LoaderCircle } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<{ message: string; referenceId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authClient.requestPasswordReset({ email: email.trim().toLowerCase(), redirectTo: "/reset-password" });
      if (result.error) setError(describeAuthError(result.error, "We couldn't send a reset link. Please try again shortly."));
      else setMessage("If that email is registered, a password reset link is on its way. In development, check the server logs.");
    } catch {
      setError({ message: "We couldn't reach the authentication service. Please try again shortly." });
    } finally {
      setBusy(false);
    }
  }
  return <main className="flex min-h-screen items-center justify-center px-5 py-12"><div className="surface w-full max-w-md p-8">
    <Link href="/login" className="mb-8 inline-flex items-center gap-2 text-xs text-muted hover:text-foreground"><ArrowLeft size={14} /> Back to sign in</Link>
    <div className="mb-6 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={20} /></span><span className="text-lg font-bold">SEOFlow<span className="text-accent">.</span></span></div>
    <h1 className="text-2xl font-semibold">Reset your password</h1><p className="mt-2 text-sm text-muted">We’ll email a secure link if there’s an account for this address.</p>
    <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-xs text-muted">Email address<input className="field mt-2" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      {error && <div role="alert" className="text-xs leading-5 text-red-300"><p>{error.message}</p>{error.referenceId && <p className="mt-1 font-mono text-[10px] text-red-200/80">Reference ID: {error.referenceId}</p>}</div>}{message && <p role="status" className="text-xs leading-5 text-accent">{message}</p>}
      <button className="btn-primary w-full" disabled={busy}>{busy && <LoaderCircle size={15} className="animate-spin" />}Send reset link</button></form>
  </div></main>;
}
