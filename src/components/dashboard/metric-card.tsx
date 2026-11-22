import type { LucideIcon } from "lucide-react";

export function MetricCard({ label, value, note, icon: Icon, tone = "default" }: { label: string; value: string | number; note: string; icon: LucideIcon; tone?: "default" | "good" | "warning" }) {
  const toneClass = tone === "good" ? "text-accent" : tone === "warning" ? "text-amber-300" : "text-foreground";
  return <article className="surface p-5">
    <div className="flex items-start justify-between"><p className="text-xs font-medium text-muted">{label}</p><span className={`rounded-lg border border-border bg-background/70 p-2 ${tone === "good" ? "text-accent" : "text-muted"}`}><Icon size={16} /></span></div>
    <p className={`mt-5 text-3xl font-semibold tracking-tight ${toneClass}`}>{value}</p>
    <p className="mt-2 text-[11px] leading-5 text-muted">{note}</p>
  </article>;
}
