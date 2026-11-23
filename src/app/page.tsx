import Link from "next/link";
import { ArrowDownRight, ArrowRight, AudioLines, CircleCheck, Globe2, LayoutDashboard, ScanSearch, ShieldCheck, Sparkles, TrendingUp } from "lucide-react";

const steps = [
  { number: "01", title: "Discover", text: "Crawl the pages you own. Surface technical issues with URLs, evidence and rule-versioned checks." },
  { number: "02", title: "Optimize", text: "Turn findings into practical next steps. AI suggestions stay grounded in your audit and yours to approve." },
  { number: "03", title: "Rank", text: "Connect search data when you authorize it. Compare real observations over time, without invented metrics." }
];

export default function HomePage() {
  return <main className="relative isolate min-h-screen overflow-hidden">
    <div className="grid-glow pointer-events-none absolute inset-x-0 top-0 -z-10 h-[760px] opacity-30" />
    <div className="pointer-events-none absolute -top-48 left-1/2 -z-10 h-[620px] w-[800px] -translate-x-1/2 rounded-full bg-accent/5 blur-[110px]" />
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-6 lg:px-10">
      <Link href="/" className="flex items-center gap-3" aria-label="SEOFlow home">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={19} strokeWidth={2.7} /></span>
        <span className="text-lg font-bold tracking-tight">SEOFlow<span className="ml-1 text-accent">.</span></span>
      </Link>
      <nav className="hidden items-center gap-8 text-sm text-muted md:flex" aria-label="Main navigation">
        <a href="#how-it-works" className="transition hover:text-foreground">How it works</a>
        <a href="#principles" className="transition hover:text-foreground">Our approach</a>
        <Link href="/login" className="transition hover:text-foreground">Sign in</Link>
      </nav>
      <Link href="/signup" className="btn-primary !px-4 !py-2">Start free <ArrowRight size={15} /></Link>
    </header>

    <section className="mx-auto grid max-w-7xl items-center gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1fr_1.02fr] lg:px-10 lg:pb-32 lg:pt-20">
      <div className="animate-rise max-w-2xl">
        <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-accent/20 bg-accent/[0.06] px-3.5 py-2 text-xs font-medium text-accent">
          <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_10px_#39ff14]" /> Evidence-first SEO workspace
        </div>
        <h1 className="text-5xl font-semibold leading-[1.06] tracking-[-0.055em] sm:text-6xl lg:text-[4.4rem]">Make every SEO move <span className="text-accent">count.</span></h1>
        <p className="mt-7 max-w-xl text-lg leading-8 text-muted">Find what is holding your site back, understand why it matters, and turn real evidence into a clearer next step.</p>
        <div className="mt-9 flex flex-wrap gap-3">
          <Link href="/signup" className="btn-primary px-5 py-3">Start your first audit <ArrowRight size={16} /></Link>
          <a href="#how-it-works" className="btn-secondary px-5 py-3">Explore the workflow <ArrowDownRight size={16} /></a>
        </div>
        <p className="mt-5 text-xs text-muted">Free workspace · No card required · You control every AI suggestion</p>
      </div>

      <div className="animate-rise [animation-delay:140ms]">
        <div className="surface relative overflow-hidden p-4 shadow-glow sm:p-6">
          <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
            <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl border border-border bg-background text-accent"><Globe2 size={17} /></span><div><p className="text-sm font-medium">Your next opportunity</p><p className="text-xs text-muted">A live workspace preview</p></div></div>
            <span className="rounded-full border border-border px-2.5 py-1 text-[10px] font-medium text-muted">NO DATA YET</span>
          </div>
          <div className="grid grid-cols-[1fr_auto] items-end gap-4">
            <div><p className="eyebrow">Site health</p><div className="mt-2 flex items-end gap-2"><span className="text-5xl font-semibold tracking-tight">—</span><span className="pb-2 text-xs text-muted">Run an audit to measure</span></div></div>
            <div className="flex h-[94px] w-[94px] items-center justify-center rounded-full border-[5px] border-border text-center"><div><p className="text-xl font-semibold">—</p><p className="text-[9px] uppercase tracking-widest text-muted">pages</p></div></div>
          </div>
          <div className="mt-7 h-[130px] overflow-hidden rounded-xl border border-border bg-background/70 p-3">
            <div className="mb-2 flex items-center justify-between"><span className="text-xs font-medium">Audit activity</span><span className="text-[10px] text-muted">Awaiting first crawl</span></div>
            <div className="flex h-[78px] items-center justify-center rounded-lg border border-dashed border-border/70 bg-card/30"><span className="text-[10px] text-muted">No crawl observations saved yet</span></div>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[{ icon: ScanSearch, label: "Technical audit" }, { icon: Sparkles, label: "Evidence-led AI" }, { icon: TrendingUp, label: "Real search data" }].map(({ icon: Icon, label }) => <div key={label} className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-2.5 py-2 text-[10px] text-muted sm:text-xs"><Icon size={13} className="shrink-0 text-accent" />{label}</div>)}
          </div>
          <div className="absolute -right-16 -top-16 -z-10 h-60 w-60 rounded-full bg-accent/5 blur-3xl" />
        </div>
        <div className="mt-3 flex items-center justify-center gap-2 text-[11px] text-muted"><ShieldCheck size={13} className="text-accent" /> No production metrics are shown until you connect your site.</div>
      </div>
    </section>

    <section id="how-it-works" className="border-y border-border/70 bg-card/40">
      <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10 lg:py-24">
        <div className="max-w-xl"><p className="eyebrow text-accent">From signal to action</p><h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">SEO work, with the evidence attached.</h2><p className="mt-4 leading-7 text-muted">A focused loop that keeps audits, recommendations and measurement in the same workspace.</p></div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">{steps.map((step) => <article key={step.number} className="surface group p-6 transition hover:-translate-y-1 hover:border-accent/30"><p className="font-mono text-xs text-accent">{step.number}</p><h3 className="mt-7 text-xl font-semibold">{step.title}</h3><p className="mt-3 text-sm leading-6 text-muted">{step.text}</p></article>)}</div>
      </div>
    </section>

    <section id="principles" className="mx-auto grid max-w-7xl gap-12 px-6 py-20 lg:grid-cols-2 lg:px-10 lg:py-24">
      <div><p className="eyebrow text-accent">Built for trust</p><h2 className="mt-4 max-w-lg text-3xl font-semibold tracking-tight sm:text-4xl">Useful recommendations. Honest measurement.</h2><p className="mt-4 max-w-lg leading-7 text-muted">SEOFlow separates what it observes from what a provider estimates. It never invents your traffic, search volumes, backlinks or rankings.</p></div>
      <div className="grid gap-3 sm:grid-cols-2">{[
        [CircleCheck, "Findings with receipts", "Every technical issue points to the affected URL, evidence and a deterministic rule."],
        [ShieldCheck, "Your data stays yours", "Workspace roles and server-side access checks protect project data."],
        [Sparkles, "AI as an assistant", "Suggestions are proposals, grounded in your crawl—not changes silently pushed to your site."],
        [LayoutDashboard, "One connected workflow", "Crawls, content drafts and authorized search data live together."]
      ].map(([Icon, title, text]) => {
        const FeatureIcon = Icon as typeof CircleCheck;
        return <div key={title as string} className="surface p-5"><FeatureIcon size={18} className="text-accent" /><h3 className="mt-4 text-sm font-semibold">{title as string}</h3><p className="mt-2 text-xs leading-5 text-muted">{text as string}</p></div>;
      })}</div>
    </section>

    <footer className="border-t border-border"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-6 py-7 text-xs text-muted sm:flex-row sm:items-center sm:justify-between lg:px-10"><p>© {new Date().getFullYear()} SEOFlow. Discover. Optimize. Rank.</p><p>Diagnostic scores are internal SEO indicators—not Google ranking scores.</p></div></footer>
  </main>;
}
