"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Play, Square } from "lucide-react";

type Progress = { id: string; status: string; pagesDiscovered: number; pagesProcessed: number; currentUrl: string | null; errorMessage: string | null; report?: { overallScore: number } | null };

export function CrawlRunner({ projectId, pageLimit, activeCrawlId }: { projectId: string; pageLimit: number; activeCrawlId?: string | null }) {
  const [progress, setProgress] = useState<Progress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [limit, setLimit] = useState(pageLimit);
  useEffect(() => {
    if (!activeCrawlId) return;
    const source = new EventSource(`/api/crawls/${activeCrawlId}/events`);
    source.addEventListener("progress", (event) => {
      const update = JSON.parse((event as MessageEvent<string>).data) as Progress;
      setProgress(update);
      if (["completed", "failed", "cancelled"].includes(update.status)) source.close();
    });
    source.addEventListener("error", () => { if (source.readyState === EventSource.CLOSED) source.close(); });
    return () => source.close();
  }, [activeCrawlId]);
  async function start() {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/projects/${projectId}/crawls`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageLimit: limit }) });
    const data = await response.json() as { crawl?: Progress; error?: string };
    setBusy(false);
    if (!response.ok || !data.crawl) { setError(data.error ?? "Could not start the audit."); return; }
    setProgress(data.crawl);
    window.location.reload();
  }
  async function cancel() {
    if (!progress) return;
    await fetch(`/api/crawls/${progress.id}/cancel`, { method: "POST" });
    setProgress({ ...progress, status: "cancelled" });
  }
  const active = Boolean(progress && ["queued", "running"].includes(progress.status));
  const waitingForExisting = !progress && Boolean(activeCrawlId);
  return <div className="space-y-3">
    {!active && !waitingForExisting && <div className="flex items-center gap-2"><label className="sr-only" htmlFor="crawl-limit">Maximum pages to crawl</label><select id="crawl-limit" className="field !w-auto !py-2 text-xs" value={limit} onChange={(event) => setLimit(Number(event.target.value))}>{[50,100,250,500,1000,2500,5000,10000].filter((value) => value <= pageLimit).map((value) => <option key={value} value={value}>{value} pages</option>)}</select><button onClick={start} disabled={busy} className="btn-primary"><Play size={14} />{busy ? "Starting…" : "Run audit"}</button></div>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {waitingForExisting && <div className="flex items-center gap-2 rounded-xl border border-border bg-background/50 p-3 text-xs text-muted"><LoaderCircle size={14} className="animate-spin text-accent" />Connecting to the active audit…</div>}
    {progress && <div className="rounded-xl border border-border bg-background/50 p-4">
      <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-medium">{active ? <LoaderCircle size={14} className="animate-spin text-accent" /> : <span className={`h-2 w-2 rounded-full ${progress.status === "completed" ? "bg-accent" : "bg-red-400"}`} />}{progress.status === "completed" ? `Audit complete${progress.report ? ` · score ${progress.report.overallScore}` : ""}` : progress.status === "failed" ? "Audit failed" : progress.status === "cancelled" ? "Audit cancelled" : progress.status === "queued" ? "Audit queued" : "Crawling website"}</div>
        {active && <button className="text-muted hover:text-red-300" onClick={cancel} aria-label="Cancel audit"><Square size={14} /></button>}</div>
      <div className="mt-3 flex items-center justify-between text-[10px] text-muted"><span>{progress.pagesProcessed} of {progress.pagesDiscovered || "…"} pages processed</span><span>{progress.pagesDiscovered > 0 ? Math.min(100, Math.round(progress.pagesProcessed / progress.pagesDiscovered * 100)) : 0}%</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress.pagesDiscovered ? Math.min(100, progress.pagesProcessed / progress.pagesDiscovered * 100) : 3}%` }} /></div>
      {progress.currentUrl && active && <p className="mt-3 truncate text-[10px] text-muted">Current URL: <span className="font-mono">{progress.currentUrl}</span></p>}
      {progress.errorMessage && !active && <p className="mt-2 text-[10px] leading-4 text-muted">{progress.errorMessage}</p>}
    </div>}
  </div>;
}
