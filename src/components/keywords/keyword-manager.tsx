"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Download, LoaderCircle, Plus, RefreshCw, Search, Trash2, TrendingUp } from "lucide-react";
import { csvCell } from "@/lib/csv";

type Project = { id: string; name: string; targetCountry: string | null; targetLanguage: string | null; canManage: boolean };
type Metric = { provider: string; estimatedSearchVolume: number | null; difficulty: number | null; cpc: string | null; organicClicks: number | null; impressions: number | null; averagePosition: number | null; observedAt: string };
type Keyword = { id: string; phrase: string; country: string | null; language: string | null; intent: string | null; groupName: string | null; source: string | null; latestMetric: Metric | null };

export function KeywordManager({ projects: projectList, providerConfigured }: { projects: Project[]; providerConfigured: boolean }) {
  const [projectId, setProjectId] = useState(projectList[0]?.id ?? "");
  const selectedProject = projectList.find((project) => project.id === projectId);
  const [keywords, setKeywords] = useState<Keyword[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/keywords?limit=100&q=${encodeURIComponent(query)}`);
      const data = await response.json() as { keywords?: Keyword[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not load keywords.");
      setKeywords(data.keywords ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load keywords.");
    } finally { setLoading(false); }
  }, [projectId, query]);
  useEffect(() => { void load(); }, [load]);

  async function addKeyword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError(""); setSuccess("");
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const response = await fetch(`/api/projects/${projectId}/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phrase: String(form.get("phrase") ?? ""), country: String(form.get("country") ?? "") || undefined, intent: String(form.get("intent") ?? "unknown"), groupName: String(form.get("groupName") ?? "") || undefined }) });
    const data = await response.json() as { keyword?: Keyword; existed?: boolean; error?: string };
    setBusy(false);
    if (!response.ok || !data.keyword) { setError(data.error ?? "Could not add keyword."); return; }
    setSuccess(data.existed ? "That keyword is already tracked." : "Keyword added. No volume or ranking value has been inferred.");
    formElement.reset();
    await load();
  }
  async function refreshMetrics() {
    setBusy(true); setError(""); setSuccess("");
    const response = await fetch(`/api/projects/${projectId}/seo-data/keywords`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
    const data = await response.json() as { metricsSaved?: number; providerCost?: number | null; error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not refresh provider estimates."); return; }
    setSuccess(`Saved ${data.metricsSaved ?? 0} provider-estimated metric row(s).${data.providerCost === null || data.providerCost === undefined ? " Provider cost was not returned." : ` Provider-reported cost: ${data.providerCost}.`}`);
    await load();
  }

  async function deleteKeyword(keyword: Keyword) {
    if (!window.confirm(`Stop tracking “${keyword.phrase}” and delete its saved metrics?`)) return;
    setBusy(true); setError(""); setSuccess("");
    const response = await fetch(`/api/projects/${projectId}/keywords/${keyword.id}`, { method: "DELETE" });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not remove this keyword."); return; }
    setSuccess("Keyword and its saved observations were removed.");
    await load();
  }

  function exportCsv() {
    const rows = [["keyword","country","language","intent","group","source","observed clicks","observed impressions","observed avg position","estimated volume","difficulty","cpc"], ...keywords.map((keyword) => [keyword.phrase, keyword.country ?? "", keyword.language ?? "", keyword.intent ?? "", keyword.groupName ?? "", keyword.latestMetric?.provider ?? keyword.source ?? "", keyword.latestMetric?.organicClicks ?? "", keyword.latestMetric?.impressions ?? "", keyword.latestMetric?.averagePosition ?? "", keyword.latestMetric?.estimatedSearchVolume ?? "", keyword.latestMetric?.difficulty ?? "", keyword.latestMetric?.cpc ?? ""])];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "seoflow-keywords.csv"; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!projectList.length) return <div className="surface flex min-h-[300px] flex-col items-center justify-center p-8 text-center"><Search size={25} className="text-accent" /><h2 className="mt-4 text-base font-semibold">Add a website to track keywords</h2><p className="mt-2 max-w-sm text-xs leading-5 text-muted">Keyword observations stay tied to a project and a disclosed provider source.</p></div>;

  return <div className="space-y-5">
    <div className="surface grid gap-5 p-5 lg:grid-cols-[250px_1fr] lg:p-6"><div><p className="eyebrow text-accent">Keyword set</p><h2 className="mt-2 text-base font-semibold">Track the topics you care about</h2><p className="mt-2 text-xs leading-5 text-muted">Add phrases manually or connect an approved data source. No search volumes, CPC, difficulty or rank values are fabricated.</p></div>
      <div className="space-y-4"><label className="block text-xs text-muted">Project<select className="field mt-2" value={projectId} onChange={(event) => setProjectId(event.target.value)}>{projectList.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <form onSubmit={addKeyword} className="grid gap-3 md:grid-cols-[1.6fr_1fr_1fr_auto]"><label className="block text-xs text-muted">Keyword phrase<input className="field mt-2" name="phrase" maxLength={200} required placeholder="e.g. technical SEO audit" /></label><label className="block text-xs text-muted">Search intent<select className="field mt-2" name="intent"><option value="unknown">Unknown</option><option value="informational">Informational</option><option value="navigational">Navigational</option><option value="commercial">Commercial</option><option value="transactional">Transactional</option></select></label><label className="block text-xs text-muted">Group<input className="field mt-2" name="groupName" maxLength={100} placeholder="Optional" /></label><div className="flex items-end"><button className="btn-primary w-full md:w-auto" disabled={busy || !selectedProject?.canManage}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}Add</button></div></form>
        {(error || success) && <p role={error ? "alert" : "status"} className={`text-xs ${error ? "text-red-300" : "text-accent"}`}>{error || success}</p>}
      </div>
    </div>
    <section className="surface overflow-hidden"><div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"><div><h2 className="text-sm font-semibold">Tracked keywords</h2><p className="mt-1 text-[10px] text-muted">Search-volume, difficulty and CPC values are provider estimates; clicks and average position are Search Console observations.</p></div><div className="flex flex-wrap gap-2"><label className="relative"><span className="sr-only">Filter keywords</span><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" /><input className="field !w-[210px] !py-2 !pl-9 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search keywords" /></label>{providerConfigured && <button className="btn-secondary !px-3 !py-2 text-xs" disabled={busy || !selectedProject?.canManage || !selectedProject.targetCountry} onClick={() => void refreshMetrics()}>{busy ? <LoaderCircle size={13} className="animate-spin" /> : <RefreshCw size={13} />}Refresh estimates</button>}<button className="btn-secondary !px-3 !py-2 text-xs" onClick={exportCsv}><Download size={14} />CSV</button></div></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[820px] text-left"><thead className="bg-background/40 text-[10px] uppercase tracking-widest text-muted"><tr>{["Keyword","Intent / group","Source","Est. volume","Difficulty","Observed clicks / impressions","Avg. position",""].map((item, index) => <th key={`${item}-${index}`} className="px-5 py-3 font-medium">{item}</th>)}</tr></thead><tbody className="divide-y divide-border">{keywords.map((keyword) => <tr key={keyword.id} className="text-xs"><td className="px-5 py-4"><p className="font-medium">{keyword.phrase}</p><p className="mt-1 text-[10px] text-muted">{keyword.country === "global" ? "All locations" : keyword.country} · {keyword.language ?? "Language not set"}</p></td><td className="px-5 py-4"><span className="capitalize text-muted">{keyword.intent ?? "Unknown"}</span><p className="mt-1 text-[10px] text-muted">{keyword.groupName ?? "Ungrouped"}</p></td><td className="px-5 py-4 text-muted">{keyword.latestMetric?.provider ?? keyword.source ?? "No provider"}</td><td className="px-5 py-4 text-muted">{keyword.latestMetric?.estimatedSearchVolume?.toLocaleString() ?? "—"}</td><td className="px-5 py-4 text-muted">{keyword.latestMetric?.difficulty ?? "—"}</td><td className="px-5 py-4 text-muted">{keyword.latestMetric ? `${keyword.latestMetric.organicClicks ?? "—"} / ${keyword.latestMetric.impressions ?? "—"}` : "—"}</td><td className="px-5 py-4 text-muted">{keyword.latestMetric?.averagePosition ?? "—"}</td><td className="px-4 py-4 text-right">{selectedProject?.canManage && <button type="button" aria-label={`Remove ${keyword.phrase}`} className="rounded-lg p-2 text-muted hover:bg-red-400/10 hover:text-red-300 disabled:opacity-50" disabled={busy} onClick={() => void deleteKeyword(keyword)}><Trash2 size={13} /></button>}</td></tr>)}{keywords.length === 0 && <tr><td colSpan={8} className="px-5 py-14 text-center">{loading ? <span className="inline-flex items-center gap-2 text-xs text-muted"><LoaderCircle size={14} className="animate-spin" />Loading keywords…</span> : <div><TrendingUp size={19} className="mx-auto text-muted" /><p className="mt-3 text-xs font-medium">No matching keywords</p><p className="mt-1 text-[10px] text-muted">Add a phrase or connect a real keyword provider.</p></div>}</td></tr>}</tbody></table></div>
    </section>
  </div>;
}
