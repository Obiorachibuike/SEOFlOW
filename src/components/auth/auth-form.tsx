"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AudioLines, ArrowLeft, ArrowRight, LoaderCircle, ShieldCheck } from "lucide-react";
import { authClient } from "@/auth/client";
import { AuthErrorAlert } from "@/components/auth/auth-error-alert";
import { getAuthErrorDetails, getOAuthErrorDetails, type AuthErrorDetails } from "@/lib/auth-errors";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<AuthErrorDetails | null>(null);
  const [email, setEmail] = useState("");
  const isSignup = mode === "signup";

  useEffect(() => {
    const url = new URL(window.location.href);
    const oauthError = url.searchParams.get("error");
    if (!oauthError) return;

    setError(getOAuthErrorDetails(oauthError));
    url.searchParams.delete("error");
    url.searchParams.delete("error_description");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage("");
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "");
    const password = String(data.get("password") ?? "");
    const invitationToken = new URLSearchParams(window.location.search).get("invite");
    const callbackURL = invitationToken ? `/invite?token=${encodeURIComponent(invitationToken)}` : "/dashboard";

    try {
      const result = isSignup
        ? await authClient.signUp.email({ name, email, password, callbackURL })
        : await authClient.signIn.email({ email, password, callbackURL });
      if (result.error) {
        setError(getAuthErrorDetails(result.error, {
          fallbackMessage: isSignup ? "We could not create your account. Please try again." : "We could not sign you in. Check your details and try again."
        }));
        return;
      }
      if (isSignup) {
        setMessage("Check your inbox, including spam, for a verification link. You must verify your email before signing in.");
        return;
      }
      router.push(invitationToken ? `/invite?token=${encodeURIComponent(invitationToken)}` : "/dashboard");
      router.refresh();
    } catch (cause) {
      setError(getAuthErrorDetails(cause, {
        fallbackMessage: isSignup ? "We could not create your account. Please try again." : "We could not sign you in. Check your details and try again."
      }));
    } finally {
      setLoading(false);
    }
  }

  async function resendVerification() {
    if (!email) {
      setError({ message: "Enter the email address for your account, then request a new verification link.", code: "AUTH_EMAIL_REQUIRED" });
      return;
    }
    setError(null);
    setMessage("");
    setResendingVerification(true);
    try {
      const result = await authClient.sendVerificationEmail({ email, callbackURL: "/login" });
      if (result.error) {
        setError(getAuthErrorDetails(result.error, { fallbackMessage: "We could not send a verification link. Please try again." }));
      } else {
        setMessage("If this address has an unverified account, a new verification link has been sent. Check your inbox and spam folder.");
      }
    } catch (cause) {
      setError(getAuthErrorDetails(cause, { fallbackMessage: "We could not send a verification link. Please try again." }));
    } finally {
      setResendingVerification(false);
    }
  }

  async function signInWithGoogle() {
    setError(null);
    setMessage("");
    setGoogleLoading(true);
    const errorCallbackURL = new URL(window.location.href);
    errorCallbackURL.searchParams.delete("error");
    errorCallbackURL.searchParams.delete("error_description");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
        errorCallbackURL: `${errorCallbackURL.pathname}${errorCallbackURL.search}`
      });
      if (result.error) {
        setError(getAuthErrorDetails(result.error, { fallbackMessage: "Google sign-in could not be started. Please try again or use email and password." }));
      }
    } catch (cause) {
      setError(getAuthErrorDetails(cause, { fallbackMessage: "Google sign-in could not be started. Please try again or use email and password." }));
    } finally {
      setGoogleLoading(false);
    }
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
          <button onClick={signInWithGoogle} disabled={googleLoading || loading} className="btn-secondary mt-7 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60" type="button">
            {googleLoading && <LoaderCircle size={15} className="animate-spin" />}{googleLoading ? "Connecting to Google…" : "Continue with Google"}
          </button>
          <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted"><span className="h-px flex-1 bg-border" />or use email<span className="h-px flex-1 bg-border" /></div>
        </>}

        <form className="space-y-4" onSubmit={submit}>
          {isSignup && <label className="block text-xs font-medium text-muted">Your name<input name="name" autoComplete="name" required minLength={2} maxLength={100} className="field mt-2" placeholder="Alex Morgan" /></label>}
          <label className="block text-xs font-medium text-muted">Email address<input name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="field mt-2" placeholder="you@company.com" /></label>
          <label className="block text-xs font-medium text-muted">Password<input name="password" type="password" autoComplete={isSignup ? "new-password" : "current-password"} required minLength={isSignup ? 8 : 1} maxLength={128} className="field mt-2" placeholder={isSignup ? "At least 8 characters" : "Your password"} /></label>
          {!isSignup && <div className="text-right"><Link href="/forgot-password" className="text-xs text-accent hover:underline">Forgot password?</Link></div>}
          {error && <AuthErrorAlert error={error} />}
          {!isSignup && error?.code === "AUTH_EMAIL_NOT_VERIFIED" && <button type="button" onClick={resendVerification} disabled={resendingVerification} className="text-left text-xs text-accent hover:underline disabled:opacity-60">
            {resendingVerification ? "Sending verification link…" : "Resend verification email"}
          </button>}
          {message && <p role="status" className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-5 text-accent">{message}</p>}
          <button type="submit" disabled={loading || googleLoading} className="btn-primary mt-1 w-full py-3">
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
