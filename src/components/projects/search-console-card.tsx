"use client";

import { useCallback, useEffect, useState } from "react";
import { BarChart3, ExternalLink, LoaderCircle, RefreshCw, ShieldCheck, Unplug } from "lucide-react";

type Property = { siteUrl: string; permissionLevel: string; matchesProject: boolean };
type SearchRow = { keys?: string[]; clicks?: number; impressions?: number; ctr?: number; position?: number };

export function SearchConsoleCard({ projectId, connected, selectedProperty, canManage = true }: { projectId: string; connected: boolean; selectedProperty: string | null; canManage?: boolean }) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [selected, setSelected] = useState(selectedProperty ?? "");
  const [propertySelected, setPropertySelected] = useState(Boolean(selectedProperty));
  const [rows, setRows] = useState<SearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [querying, setQuerying] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [startDate, setStartDate] = useState(defaultStart());
  const [endDate, setEndDate] = useState(defaultEnd());

  const loadProperties = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/projects/${projectId}/integrations/google/search-console/properties`, { cache: "no-store" });
    const data = await response.json() as { properties?: Property[]; selectedProperty?: string | null; error?: string };
    setLoading(false);
    if (!response.ok) { setError(data.error ?? "Could not load Google properties."); return; }
    setProperties(data.properties ?? []);
    if (data.selectedProperty) { setSelected(data.selectedProperty); setPropertySelected(true); }
  }, [projectId]);
  useEffect(() => { if (connected) void loadProperties(); }, [connected, loadProperties]);

  async function chooseProperty() {
    setLoading(true); setError(""); setNotice("");
    const response = await fetch(`/api/projects/${projectId}/integrations/google/search-console/properties`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteUrl: selected }) });
    const data = await response.json() as { error?: string; selectedProperty?: string };
    setLoading(false);
    if (!response.ok) { setError(data.error ?? "Could not select this property."); return; }
    setSelected(data.selectedProperty ?? selected);
    setPropertySelected(true);
    setNotice(`Selected verified property ${data.selectedProperty}.`);
  }

  async function querySearchConsole() {
    setQuerying(true); setError(""); setNotice(""); setRows([]);
    const response = await fetch(`/api/projects/${projectId}/integrations/google/search-console/analytics`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate, endDate, dimensions: ["query"], rowLimit: 100 }) });
    const data = await response.json() as { rows?: SearchRow[]; rowCount?: number; savedTrackedKeywordMetrics?: number; error?: string };
    setQuerying(false);
    if (!response.ok) { setError(data.error ?? "Search Console data could not be loaded."); return; }
    setRows(data.rows ?? []);
    setNotice(`${data.rowCount ?? 0} query row(s) returned from Google Search Console. ${data.savedTrackedKeywordMetrics ?? 0} tracked-keyword observations were stored.`);
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Google Search Console from this project? Stored OAuth credentials will be deleted.")) return;
    const response = await fetch(`/api/projects/${projectId}/integrations/google/search-console`, { method: "DELETE" });
    if (!response.ok) { const data = await response.json() as { error?: string }; setError(data.error ?? "Could not disconnect."); return; }
    window.location.reload();
  }

  return <section className="surface overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><BarChart3 size={17} /></span><div><h2 className="text-sm font-semibold">Google Search Console</h2><p className="mt-1 text-[10px] text-muted">OAuth-authorized search clicks, impressions, CTR and average position.</p></div></div>{connected ? canManage ? <button onClick={disconnect} className="btn-secondary !px-3 !py-2 text-[10px]"><Unplug size={13} />Disconnect</button> : null : canManage ? <a href={`/api/projects/${projectId}/integrations/google/search-console/start`} className="btn-primary !px-3 !py-2 text-xs"><ExternalLink size={13} />Connect Google</a> : null}</div>
    <div className="p-5">
      {!connected ? <div className="flex items-start gap-2 rounded-xl border border-dashed border-border p-4 text-xs leading-5 text-muted"><ShieldCheck size={15} className="mt-0.5 shrink-0 text-accent" />No Search Console data is available until an authorized Google account grants access to the matching property. Google API credentials are required in the deployment environment.</div> : <>
        {error && <p role="alert" className="mb-3 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}{notice && <p role="status" className="mb-3 rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-xs text-accent">{notice}</p>}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end"><label className="text-xs text-muted">Verified Search Console property<select className="field mt-2" value={selected} disabled={!canManage} onChange={(event) => setSelected(event.target.value)}><option value="">Choose a property</option>{properties.map((property) => <option key={property.siteUrl} value={property.siteUrl} disabled={!property.matchesProject}>{property.siteUrl} · {property.permissionLevel}{property.matchesProject ? "" : " · domain mismatch"}</option>)}</select></label>{canManage && <button onClick={() => void chooseProperty()} disabled={!selected || loading} className="btn-secondary !py-3 text-xs">{loading ? <LoaderCircle size={14} className="animate-spin" /> : <ShieldCheck size={14} />}Use property</button>}<button onClick={() => void loadProperties()} disabled={loading} className="btn-secondary !py-3 text-xs"><RefreshCw size={14} />Refresh properties</button></div>
        {propertySelected && <><div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs text-muted">Start date<input className="field mt-2" type="date" value={startDate} max={defaultEnd()} onChange={(event) => setStartDate(event.target.value)} /></label><label className="text-xs text-muted">End date<input className="field mt-2" type="date" value={endDate} max={defaultEnd()} onChange={(event) => setEndDate(event.target.value)} /></label><button onClick={() => void querySearchConsole()} disabled={querying} className="btn-primary">{querying ? <LoaderCircle size={14} className="animate-spin" /> : <BarChart3 size={14} />}Load query data</button></div>
          {rows.length > 0 && <div className="mt-5 overflow-x-auto rounded-xl border border-border"><table className="w-full min-w-[560px] text-left"><thead className="bg-background/50 text-[9px] uppercase tracking-widest text-muted"><tr>{["Search query","Clicks","Impressions","CTR","Avg. position"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y divide-border">{rows.map((row,index) => <tr key={`${row.keys?.[0] ?? "query"}-${index}`} className="text-xs"><td className="max-w-[360px] truncate px-4 py-3 font-medium">{row.keys?.[0] ?? "(not provided)"}</td><td className="px-4 py-3">{row.clicks ?? "—"}</td><td className="px-4 py-3">{row.impressions ?? "—"}</td><td className="px-4 py-3">{row.ctr === undefined ? "—" : `${(row.ctr * 100).toFixed(1)}%`}</td><td className="px-4 py-3">{row.position?.toFixed(1) ?? "—"}</td></tr>)}</tbody></table></div>}
        </>}
      </>}
    </div>
  </section>;
}

function defaultEnd() { const date = new Date(Date.now() - 2 * 24 * 60 * 60_000); return date.toISOString().slice(0,10); }
function defaultStart() { const date = new Date(Date.now() - 30 * 24 * 60 * 60_000); return date.toISOString().slice(0,10); }
