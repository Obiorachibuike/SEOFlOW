"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Activity, AudioLines, BookOpenText, CircleHelp, FileBarChart2, FolderKanban, LayoutDashboard, ListChecks, Menu, Moon, Search, Settings2, ShieldCheck, Sun, X, LogOut } from "lucide-react";
import { authClient } from "@/auth/client";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/issues", label: "Issues", icon: ListChecks },
  { href: "/dashboard/studio", label: "Content studio", icon: BookOpenText },
  { href: "/dashboard/keywords", label: "Keywords", icon: Search },
  { href: "/dashboard/reports", label: "Reports", icon: FileBarChart2 }
];

export function AppShell({ children, user, isAdmin }: { children: React.ReactNode; user: { name: string; email: string }; isAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [light, setLight] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const initials = user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "SF";

  function toggleTheme() {
    const nextLight = !light;
    setLight(nextLight);
    document.documentElement.classList.toggle("light", nextLight);
    window.localStorage.setItem("seoflow-theme", nextLight ? "light" : "dark");
  }

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut();
    router.replace("/login");
    router.refresh();
  }

  const sidebar = <div className="flex h-full flex-col">
    <Link href="/dashboard" className="flex h-[76px] items-center gap-3 border-b border-border px-6" onClick={() => setMobileOpen(false)}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-background"><AudioLines size={19} strokeWidth={2.7} /></span>
      <span className="text-base font-bold tracking-tight">SEOFlow<span className="text-accent">.</span></span>
    </Link>
    <div className="px-4 pt-5">
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/60 p-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10 text-xs font-semibold text-accent">{initials}</span>
        <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{user.name}</p><p className="truncate text-[10px] text-muted">Personal workspace</p></div>
        <span className="h-1.5 w-1.5 rounded-full bg-accent" title="Signed in" />
      </div>
    </div>
    <nav className="mt-7 flex-1 px-3" aria-label="Workspace navigation">
      <p className="eyebrow mb-3 px-3">Workspace</p>
      <div className="space-y-1">{navigation.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${active ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-white/[0.035] hover:text-foreground"}`} aria-current={active ? "page" : undefined}>
          <Icon size={17} strokeWidth={active ? 2.1 : 1.8} /><span className="flex-1">{label}</span>{label === "Projects" && <span className="text-[10px] text-muted/80">↗</span>}
        </Link>;
      })}</div>
      <p className="eyebrow mb-3 mt-8 px-3">Manage</p>
      <Link href="/dashboard/settings" onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${pathname.startsWith("/dashboard/settings") ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-white/[0.035] hover:text-foreground"}`}><Settings2 size={17} />Settings</Link>
      {isAdmin && <Link href="/dashboard/admin" onClick={() => setMobileOpen(false)} className={`mt-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${pathname.startsWith("/dashboard/admin") ? "bg-accent/10 font-medium text-accent" : "text-muted hover:bg-white/[0.035] hover:text-foreground"}`}><ShieldCheck size={17} />Admin console</Link>}
    </nav>
    <div className="border-t border-border p-4">
      <Link href="/dashboard/help" className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted hover:text-foreground"><CircleHelp size={15} />Help & documentation</Link>
      <button onClick={signOut} disabled={signingOut} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-xs text-muted transition hover:bg-red-500/5 hover:text-red-300"><LogOut size={15} />{signingOut ? "Signing out…" : "Sign out"}</button>
      <p className="mt-3 px-3 text-[10px] text-muted/70">SEOFlow v0.1 · Diagnostic metrics only</p>
    </div>
  </div>;

  return <div className="min-h-screen bg-background">
    <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] border-r border-border bg-background lg:block">{sidebar}</aside>
    {mobileOpen && <div className="fixed inset-0 z-50 bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)}>
      <aside className="h-full w-[290px] border-r border-border bg-background" onClick={(event) => event.stopPropagation()}>{sidebar}</aside>
      <button className="absolute right-4 top-4 rounded-xl border border-border bg-card p-2" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={18} /></button>
    </div>}
    <div className="lg:pl-[252px]">
      <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-border bg-background/90 px-5 backdrop-blur-xl sm:px-8">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg border border-border p-2 text-muted lg:hidden" aria-label="Open navigation"><Menu size={18} /></button>
          <div className="hidden items-center gap-2 text-xs text-muted sm:flex"><span>SEOFlow</span><span className="text-border">/</span><span className="text-foreground">{navigation.find((item) => item.exact ? pathname === item.href : pathname.startsWith(item.href))?.label ?? (pathname.includes("admin") ? "Admin console" : pathname.split("/").pop()?.replaceAll("-", " "))}</span></div>
          <div className="sm:hidden"><p className="text-sm font-semibold">SEOFlow<span className="text-accent">.</span></p></div>
        </div>
        <div className="flex items-center gap-2.5">
          <div className="hidden items-center gap-2 rounded-full border border-border px-3 py-1.5 text-[10px] text-muted md:flex"><Activity size={12} className="text-accent" /> Evidence mode active</div>
          <button onClick={toggleTheme} className="rounded-xl border border-border p-2 text-muted transition hover:text-foreground" aria-label={light ? "Switch to dark theme" : "Switch to light theme"}>{light ? <Moon size={16} /> : <Sun size={16} />}</button>
          <span className="flex h-8 w-8 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-[10px] font-semibold text-accent" title={user.email}>{initials}</span>
        </div>
      </header>
      <main className="mx-auto max-w-[1440px] px-5 py-7 sm:px-8 sm:py-9">{children}</main>
    </div>
  </div>;
}
