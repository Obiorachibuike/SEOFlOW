import Link from "next/link";
import { AudioLines, MailCheck } from "lucide-react";

export default function VerifyEmailPage() {
  return <main className="flex min-h-screen items-center justify-center px-5 py-12"><div className="surface w-full max-w-md p-8 text-center">
    <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={20} /></span><span className="text-lg font-bold">SEOFlow<span className="text-accent">.</span></span></Link>
    <MailCheck size={34} className="mx-auto text-accent" /><h1 className="mt-5 text-2xl font-semibold">Check your email</h1><p className="mt-3 text-sm leading-6 text-muted">Open the verification link to confirm your address. If you are developing locally, the link is printed in the application server logs.</p><Link href="/login" className="btn-primary mt-7">Go to sign in</Link>
  </div></main>;
}
