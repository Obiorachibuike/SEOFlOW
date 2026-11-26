
"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AudioLines,
  ArrowLeft,
  ArrowRight,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import { authClient } from "@/auth/client";

type AuthFormProps = {
  mode: "login" | "signup";
};

export function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");

  const isSignup = mode === "signup";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const formData = new FormData(event.currentTarget);

      const name = String(formData.get("name") ?? "").trim();
      const password = String(formData.get("password") ?? "");
      const normalizedEmail = email.trim().toLowerCase();

      if (!normalizedEmail || !password) {
        setError("Please enter your email address and password.");
        return;
      }

      if (isSignup && name.length < 2) {
        setError("Your name must contain at least 2 characters.");
        return;
      }

      if (isSignup && password.length < 8) {
        setError("Your password must contain at least 8 characters.");
        return;
      }

      const invitationToken = new URLSearchParams(
        window.location.search
      ).get("invite");

      const callbackURL = invitationToken
        ? `/invite?token=${encodeURIComponent(invitationToken)}`
        : "/dashboard";

      const result = isSignup
        ? await authClient.signUp.email({
            name,
            email: normalizedEmail,
            password,
            callbackURL,
          })
        : await authClient.signIn.email({
            email: normalizedEmail,
            password,
            callbackURL,
          });

      if (result.error) {
        console.error("SEOFlow authentication error:", result.error);

        setError(
          result.error.message ||
            (isSignup
              ? "Unable to create your account. Please try again."
              : "Unable to sign in. Please check your credentials.")
        );

        return;
      }

      if (isSignup) {
        setMessage(
          "Your account has been created successfully. Please check your inbox for an email verification link before signing in."
        );

        return;
      }

      router.replace(callbackURL);
      router.refresh();
    } catch (err) {
      console.error("SEOFlow authentication request failed:", err);

      setError(
        "We couldn't connect to the authentication service. Please try again later. If the problem continues, contact support."
      );
    } finally {
      setLoading(false);
    }
  }

  async function signInWithGoogle() {
    if (loading) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const result = await authClient.signIn.social({
        provider: "google",
        callbackURL: "/dashboard",
      });

      if (result.error) {
        console.error("Google authentication error:", result.error);

        setError(
          result.error.message ||
            "Google sign-in is not available right now."
        );

        setLoading(false);
      }
      // Successful social sign-in normally redirects the browser.
    } catch (err) {
      console.error("Google authentication request failed:", err);

      setError(
        "Unable to connect to Google authentication. Please try again."
      );

      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-5 py-12">
      {/* Background effects */}
      <div className="grid-glow pointer-events-none absolute inset-x-0 top-0 h-[500px] opacity-20" />

      <div className="absolute -left-32 top-1/3 h-72 w-72 rounded-full bg-accent/5 blur-[90px]" />

      <div className="relative w-full max-w-[430px]">
        {/* Back navigation */}
        <Link
          href="/"
          className="mb-9 inline-flex items-center gap-2 text-xs text-muted transition hover:text-foreground"
        >
          <ArrowLeft size={14} />
          Back to SEOFlow
        </Link>

        <div className="surface overflow-hidden p-7 sm:p-9">
          {/* Brand */}
          <Link href="/" className="mb-8 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background">
              <AudioLines size={20} strokeWidth={2.6} />
            </span>

            <span className="text-lg font-bold tracking-tight">
              SEOFlow<span className="text-accent">.</span>
            </span>
          </Link>

          {/* Heading */}
          <p className="eyebrow text-accent">
            {isSignup ? "Start with what you know" : "Welcome back"}
          </p>

          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {isSignup
              ? "Create your workspace"
              : "Sign in to your workspace"}
          </h1>

          <p className="mt-2 text-sm leading-6 text-muted">
            {isSignup
              ? "Set up an account, add your site and run your first evidence-based audit."
              : "Pick up where your last SEO session left off."}
          </p>

          {/* Google authentication */}
          {process.env.NEXT_PUBLIC_GOOGLE_OAUTH_ENABLED === "true" && (
            <>
              <button
                onClick={signInWithGoogle}
                disabled={loading}
                className="btn-secondary mt-7 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                type="button"
              >
                {loading && <LoaderCircle size={16} className="animate-spin" />}
                Continue with Google
              </button>

              <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted">
                <span className="h-px flex-1 bg-border" />
                or use email
                <span className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          {/* Email authentication */}
          <form className="space-y-4" onSubmit={submit}>
            {isSignup && (
              <label className="block text-xs font-medium text-muted">
                Your name

                <input
                  name="name"
                  type="text"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={100}
                  disabled={loading}
                  className="field mt-2 w-full disabled:opacity-60"
                  placeholder="Alex Morgan"
                />
              </label>
            )}

            <label className="block text-xs font-medium text-muted">
              Email address

              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={loading}
                className="field mt-2 w-full disabled:opacity-60"
                placeholder="you@company.com"
              />
            </label>

            <label className="block text-xs font-medium text-muted">
              Password

              <input
                name="password"
                type="password"
                autoComplete={
                  isSignup ? "new-password" : "current-password"
                }
                required
                minLength={isSignup ? 8 : 1}
                maxLength={128}
                disabled={loading}
                className="field mt-2 w-full disabled:opacity-60"
                placeholder={
                  isSignup ? "At least 8 characters" : "Your password"
                }
              />
            </label>

            {!isSignup && (
              <div className="text-right">
                <Link
                  href="/forgot-password"
                  className="text-xs text-accent hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            {/* Error feedback */}
            {error && (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs leading-5 text-red-300"
              >
                {error}
              </p>
            )}

            {/* Success feedback */}
            {message && (
              <p
                role="status"
                aria-live="polite"
                className="rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs leading-5 text-accent"
              >
                {message}
              </p>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary mt-1 flex w-full items-center justify-center gap-2 py-3 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? (
                <>
                  <LoaderCircle size={16} className="animate-spin" />
                  {isSignup ? "Creating account..." : "Signing in..."}
                </>
              ) : (
                <>
                  {isSignup ? "Create account" : "Sign in"}
                  <ArrowRight size={15} />
                </>
              )}
            </button>
          </form>

          {/* Account switching */}
          <p className="mt-6 text-center text-xs text-muted">
            {isSignup
              ? "Already have an account?"
              : "New to SEOFlow?"}{" "}

            <Link
              href={isSignup ? "/login" : "/signup"}
              className="font-medium text-foreground hover:text-accent"
            >
              {isSignup ? "Sign in" : "Create an account"}
            </Link>
          </p>

          {/* Security notice */}
          <div className="mt-7 flex items-start gap-2 border-t border-border pt-5 text-[10px] leading-5 text-muted">
            <ShieldCheck
              size={14}
              className="mt-0.5 shrink-0 text-accent"
            />

            Your account is protected with secure sessions. Email verification is required before sign-in.
          </div>
        </div>

        {/* Footer */}
        <p className="mt-5 text-center text-[10px] text-muted">
          By continuing, you agree to use SEOFlow responsibly and only audit
          websites you are authorized to analyze.
        </p>
      </div>
    </main>
  );
}
