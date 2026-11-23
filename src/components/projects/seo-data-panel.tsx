"use client";

import { useEffect, useState } from "react";
import { ArrowDownToLine, ExternalLink, LoaderCircle, Radar, RefreshCw } from "lucide-react";

type BacklinkSnapshot = {
  target: string;
  totalBacklinks: string | null;
  referringDomains: string | null;
  referringMainDomains: string | null;
  referringIps: string | null;
  domainRank: number | null;
  provider: string;
  observedAt: string;
};
type Competitor = { competitorDomain: string; intersections: number | null; averagePosition: number | null; provider: string; observedAt: string };

export function SeoDataPanel({ projectId, canManage, providerConfigured }: { projectId: string; canManage: boolean; providerConfigured: boolean }) {
  const [backlink, setBacklink] = useState<BacklinkSnapshot | null>(null);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch(`/api/projects/${projectId}/seo-data/backlinks`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { snapshot?: BacklinkSnapshot | null };
        if (!response.ok) throw new Error("Could not load backlink observations.");
        return data.snapshot ?? null;
      }),
      fetch(`/api/projects/${projectId}/seo-data/competitors`, { cache: "no-store" }).then(async (response) => {
        const data = await response.json() as { competitors?: Competitor[] };
        if (!response.ok) throw new Error("Could not load competitor observations.");
        return data.competitors ?? [];
      })
    ]).then(([savedBacklink, savedCompetitors]) => {
      if (!active) return;
      setBacklink(savedBacklink);
      setCompetitors(savedCompetitors);
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : "Could not load SEO data.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId]);

  async function refresh(kind: "backlinks" | "competitors") {
    setBusy(kind);
    setError("");
    setSuccess("");
    try {
      const response = await fetch(`/api/projects/${projectId}/seo-data/${kind}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "backlinks" ? {} : { limit: 10 })
      });
      const data = await response.json() as { snapshot?: BacklinkSnapshot; competitors?: Competitor[]; error?: string; metricsSaved?: number };
      if (!response.ok) throw new Error(data.error ?? "Could not refresh provider data.");
      if (kind === "backlinks" && data.snapshot) setBacklink(data.snapshot);
      if (kind === "competitors") setCompetitors(data.competitors ?? []);
      setSuccess(kind === "backlinks" ? "Backlink summary refreshed from DataForSEO." : "Competitor observations refreshed from DataForSEO.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not refresh provider data.");
    } finally { setBusy(""); }
  }

  return <section className="surface overflow-hidden">
    <div className="flex flex-col gap-3 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Radar size={17} /></span><div><h2 className="text-sm font-semibold">Competitors & backlinks</h2><p className="mt-1 text-[10px] text-muted">Provider-reported estimates; not observed Google ranking signals.</p></div></div>
      {!providerConfigured && <span className="w-fit rounded-lg border border-border px-2.5 py-1 text-[9px] text-muted">SETUP REQUIRED</span>}
    </div>
    {!providerConfigured ? <div className="p-5 text-xs leading-5 text-muted">Configure <code>DATAFORSEO_LOGIN</code> and <code>DATAFORSEO_PASSWORD</code> to activate these provider-backed reports. No competitor or backlink metrics are synthesized.</div> : <div className="grid gap-4 p-4 lg:grid-cols-2">
      <article className="rounded-xl border border-border bg-background/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-semibold">Backlink summary</h3><p className="mt-1 text-[10px] text-muted">Source: DataForSEO</p></div><button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void refresh("backlinks")} className="btn-secondary !px-3 !py-2 text-[10px]">{busy === "backlinks" ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}Refresh</button></div>
        {backlink ? <><div className="mt-4 grid grid-cols-2 gap-3">{[["Backlinks", backlink.totalBacklinks], ["Referring domains", backlink.referringDomains], ["Main domains", backlink.referringMainDomains], ["Referring IPs", backlink.referringIps]].map(([label, value]) => <div key={label} className="rounded-lg border border-border/70 bg-card/60 p-3"><p className="text-[9px] uppercase tracking-wide text-muted">{label}</p><p className="mt-1 text-sm font-semibold">{formatCount(value)}</p></div>)}</div><p className="mt-3 text-[9px] text-muted">Observed {new Date(backlink.observedAt).toLocaleString()} · provider-reported</p></> : <div className="mt-4 rounded-lg border border-dashed border-border p-5 text-center text-[10px] text-muted">No saved backlink summary. Run a provider refresh to request one.</div>}
      </article>
      <article className="rounded-xl border border-border bg-background/35 p-4">
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xs font-semibold">Organic search competitors</h3><p className="mt-1 text-[10px] text-muted">Based on shared organic keyword observations</p></div><button type="button" disabled={!canManage || Boolean(busy)} onClick={() => void refresh("competitors")} className="btn-secondary !px-3 !py-2 text-[10px]">{busy === "competitors" ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}Refresh</button></div>
        {competitors.length ? <div className="mt-4 divide-y divide-border">{competitors.slice(0, 8).map((competitor) => <div key={`${competitor.competitorDomain}-${competitor.observedAt}`} className="flex items-center gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{competitor.competitorDomain}</p><p className="mt-1 text-[9px] text-muted">{competitor.intersections ?? "—"} shared keywords</p></div><span className="whitespace-nowrap text-[10px] text-muted">Avg. position {competitor.averagePosition ?? "—"}</span><a href={`https://${encodeURIComponent(competitor.competitorDomain)}`} target="_blank" rel="noreferrer" aria-label={`Open ${competitor.competitorDomain}`} className="text-muted hover:text-accent"><ExternalLink size={13} /></a></div>)}</div> : <div className="mt-4 rounded-lg border border-dashed border-border p-5 text-center text-[10px] text-muted">No saved competitor observations. Run a provider refresh to request them.</div>}
      </article>
    </div>}
    {loading && <p className="border-t border-border px-5 py-3 text-[10px] text-muted">Loading saved provider observations…</p>}
    {error && <p role="alert" className="border-t border-border px-5 py-3 text-xs text-red-300">{error}</p>}
    {success && <p role="status" className="border-t border-border px-5 py-3 text-xs text-accent">{success}</p>}
    {providerConfigured && <p className="border-t border-border px-5 py-3 text-[9px] leading-4 text-muted"><ArrowDownToLine size={11} className="mr-1 inline" />Refreshes send billable requests to DataForSEO; results are recorded with provider, task ID and provider-reported cost when supplied.</p>}
  </section>;
}

function formatCount(value: string | null) {
  if (value === null) return "—";
  try { return BigInt(value).toLocaleString(); }
  catch { return "—"; }
}
