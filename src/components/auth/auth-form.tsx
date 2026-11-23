"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@/auth/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const password = String(data.get("password") ?? "");
    const invitationToken = new URLSearchParams(window.location.search).get("invite");
    const callbackURL = invitationToken ? `/invite?token=${encodeURIComponent(invitationToken)}` : "/dashboard";
    const result = isSignup
      ? await authClient.signUp.email({ name, email, password, callbackURL })
      : await authClient.signIn.email({ email, password, callbackURL });
    setLoading(false);
    if (result.error) {
      setError(result.error.message ?? "Unable to authenticate. Please check your details and try again.");
      return;
    }
    if (isSignup) {
      setMessage("Check your inbox for a verification link. In local development, the link is printed in the server logs.");
      return;
    }
    router.push(invitationToken ? `/invite?token=${encodeURIComponent(invitationToken)}` : "/dashboard");
    router.refresh();
  }

  async function signInWithGoogle() {
    setError("");
    const result = await authClient.signIn.social({ provider: "google", callbackURL: "/dashboard" });
    if (result.error) setError(result.error.message ?? "Google sign-in is not available right now.");
  }

  return <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
    <div className="grid-glow pointer-events-none absolute inset-x-0 top-0 h-[500px] opacity-20" />
    <div className="absolute -left-32 top-1/3 h-72 w-72 rounded-full bg-accent/5 blur-[90px]" />
    <div className="relative w-full max-w-[430px]">
      <Link href="/" className="mb-9 inline-flex items-center gap-2 text-xs text-muted transition hover:text-foreground"><ArrowLeft size={14} /> Back to SEOFlow</Link>
      <div className="surface overflow-hidden p-7 sm:p-9">
        <Link href="/" className="mb-8 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={20} strokeWidth={2.6} /></span>
          <span className="text-lg font-bold tracking-tight">SEOFlow<span className="text-accent">.</span></span>
        </Link>
        <p className="eyebrow text-accent">{isSignup ? "Start with what you know" : "Welcome back"}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">{isSignup ? "Create your workspace" : "Sign in to your workspace"}</h1>
        <p className="mt-2 text-sm leading-6 text-muted">{isSignup ? "Set up an account, add your site and run your first evidence-based audit." : "Pick up where your last SEO session left off."}</p>

        {process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true" && <>
          <button onClick={signInWithGoogle} className="btn-secondary mt-7 w-full" type="button">Continue with Google</button>
          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted"><span className="h-px flex-1 bg-border" />or use email<span className="h-px flex-1 bg-border" /></div>
        </>}

        <form className="space-y-4" onSubmit={submit}>
          {isSignup && <label className="block text-xs font-medium text-muted">Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} className="field mt-2" placeholder="Alex Morgan" /></label>}
          <label className="block text-xs font-medium text-muted">Email address<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-2" placeholder="you@company.com" /></label>
          <label className="block text-xs font-medium text-muted">Password<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 8 : 1} maxLength={128} className="field mt-2" placeholder={isSignup ? "At least 8 characters" : "Your password"} /></label>
          {!isSignup && <div className="text-right"><Link href="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link></div>}
          {error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
          {message && <p role="status" className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-5 text-accent">{message}</p>}
          <button type="submit" disabled={loading} className="btn-primary mt-1 w-full py-3">
            {loading ? <LoaderCircle size={16} className="animate-spin" /> : null}{isSignup ? "Create account" : "Sign in"}{!loading && <ArrowRight size={15} />}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-muted">{isSignup ? "Already have an account?" : "New to SEOFlow?"} <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-foreground hover:text-accent">{isSignup ? "Sign in" : "Create an account"}</Link></p>
        <div className="mt-7 flex items-start gap-2 border-t border-border pt-5 text-[10px] leading-5 text-muted"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-accent" /> Your account is protected with secure sessions. Email verification is required before sign-in.</div>
      </div>
      <p className="mt-5 text-center text-[10px] text-muted">By continuing, you agree to use SEOFlow responsibly and only audit websites you are authorized to analyze.</p>
    </div>
  </main>;
}
