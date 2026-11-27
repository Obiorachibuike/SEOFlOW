"use client";

import { FormEvent, Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { authClient } from "@/auth/client";
import { describeAuthError } from "@/lib/client-errors";
import { AudioLines, LoaderCircle } from "lucide-react";

function ResetForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<{ message: string; referenceId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const password = String(data.get("password") ?? "");
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) setError(describeAuthError(result.error, "This password reset link could not be used. Please request a new one."));
      else router.push("/login?reset=1");
    } catch {
      setError({ message: "We couldn't reach the authentication service. Please try again shortly." });
    } finally {
      setBusy(false);
    }
  }
  return <main className="flex min-h-screen items-center justify-center px-5 py-12"><div className="surface w-full max-w-md p-8">
    <div className="mb-8 flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={20} /></span><span className="text-lg font-bold">SEOFlow<span className="text-accent">.</span></span></div>
    <h1 className="text-2xl font-semibold">Choose a new password</h1><p className="mt-2 text-sm text-muted">Use at least eight characters. Reset links expire.</p>
    {!token ? <p className="mt-5 text-sm text-red-300">This link is missing or invalid. Request a new reset link.</p> : <form onSubmit={submit} className="mt-7 space-y-4"><label className="block text-xs text-muted">New password<input className="field mt-2" type="password" name="password" minLength={8} maxLength={128} required autoComplete="new-password" /></label>{error && <div role="alert" className="text-xs leading-5 text-red-300"><p>{error.message}</p>{error.referenceId && <p className="mt-1 font-mono text-[10px] text-red-200/80">Reference ID: {error.referenceId}</p>}</div>}<button className="btn-primary w-full" disabled={busy}>{busy && <LoaderCircle size={15} className="animate-spin" />}Update password</button></form>}
    <Link href="/login" className="mt-6 block text-center text-xs text-accent hover:underline">Return to sign in</Link>
  </div></main>;
}

export default function ResetPasswordPage() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-muted">Loading reset link…</div>}><ResetForm /></Suspense>;
}
