"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BookOpenText, Check, Download, FilePlus2, LoaderCircle, Save, Sparkles } from "lucide-react";
import type { contentDocuments, projects } from "@/db/schema";
import type { SeoRecommendation } from "@/lib/ai/schemas";

type Project = typeof projects.$inferSelect;
type Document = typeof contentDocuments.$inferSelect;
type Revision = { id: string; version: number; title: string; changeSummary: string | null; createdAt: Date };

export function ContentStudio({ projects: projectList, initialDocuments }: { projects: Project[]; initialDocuments: Document[] }) {
  const params = useSearchParams();
  const initialProjectId = params.get("projectId") ?? projectList[0]?.id ?? "";
  const initialDocument = initialDocuments.find((document) => document.projectId === initialProjectId) ?? initialDocuments[0] ?? null;
  const [documents, setDocuments] = useState(initialDocuments);
  const [selectedId, setSelectedId] = useState<string | null>(initialDocument?.id ?? null);
  const [title, setTitle] = useState(initialDocument?.title ?? "");
  const [content, setContent] = useState(initialDocument?.content ?? "");
  const [targetKeyword, setTargetKeyword] = useState(initialDocument?.targetKeyword ?? "");
  const [projectId, setProjectId] = useState(initialDocument?.projectId ?? initialProjectId);
  const [documentType, setDocumentType] = useState("article");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [busyMessage, setBusyMessage] = useState("");
  const [error, setError] = useState("");
  const [recommendation, setRecommendation] = useState<SeoRecommendation | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  const selected = useMemo(() => documents.find((doc) => doc.id === selectedId) ?? null, [documents, selectedId]);
  const project = projectList.find((item) => item.id === projectId);

  async function createDocument(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectId) return;
    setCreating(true); setError("");
    const response = await fetch(`/api/projects/${projectId}/content`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: title || "Untitled draft", content, targetKeyword, documentType }) });
    const data = await response.json() as { document?: Document; error?: string };
    setCreating(false);
    if (!response.ok || !data.document) { setError(data.error ?? "Could not create this draft."); return; }
    setDocuments((current) => [data.document!, ...current]);
    setSelectedId(data.document.id);
    setCreating(false);
    setBusyMessage("Draft created.");
    setRevisions([]);
  }

  function openDocument(document: Document) {
    setSelectedId(document.id);
    setTitle(document.title);
    setContent(document.content);
    setTargetKeyword(document.targetKeyword ?? "");
    setProjectId(document.projectId);
    setRecommendation(null);
    setError("");
    void fetch(`/api/content/${document.id}`).then((response) => response.json()).then((data: { revisions?: Revision[] }) => setRevisions(data.revisions ?? [])).catch(() => setRevisions([]));
  }

  async function saveDocument(status?: "approved") {
    if (!selected) return;
    setSaving(true); setError(""); setBusyMessage("");
    const response = await fetch(`/api/content/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, content, targetKeyword: targetKeyword || null, ...(status ? { status } : {}), changeSummary: status ? "Approved by an authorized workspace member" : "Manual draft update" }) });
    const data = await response.json() as { document?: Document; error?: string };
    setSaving(false);
    if (!response.ok || !data.document) { setError(data.error ?? "Could not save this draft."); return; }
    setDocuments((current) => current.map((doc) => doc.id === data.document!.id ? data.document! : doc));
    setBusyMessage(status ? "Draft approved. No content was published to your site." : "Draft saved; a revision was recorded.");
    const revisionResponse = await fetch(`/api/content/${selected.id}`);
    if (revisionResponse.ok) { const revisionData = await revisionResponse.json() as { revisions?: Revision[] }; setRevisions(revisionData.revisions ?? []); }
  }

  async function getRecommendations() {
    if (!projectId) return;
    setOptimizing(true); setError(""); setBusyMessage(""); setRecommendation(null);
    const response = await fetch(`/api/projects/${projectId}/ai/recommend`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetKeyword: targetKeyword || undefined, content: content || undefined }) });
    const data = await response.json() as { recommendation?: SeoRecommendation; error?: string };
    setOptimizing(false);
    if (!response.ok || !data.recommendation) { setError(data.error ?? "Could not generate recommendations."); return; }
    setRecommendation(data.recommendation);
  }

  function exportDraft() {
    const markdown = `# ${title || "Untitled draft"}\n\nTarget keyword: ${targetKeyword || "Not set"}\n\n${content}`;
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement("a");
    anchor.href = url; anchor.download = `${slug(title || "seo-draft")}.md`; anchor.click(); URL.revokeObjectURL(url);
  }

  if (!projectList.length) return <div className="surface flex min-h-[360px] flex-col items-center justify-center p-8 text-center"><BookOpenText size={28} className="text-accent" /><h2 className="mt-4 text-lg font-semibold">Add a project to get started</h2><p className="mt-2 max-w-sm text-sm leading-6 text-muted">Your content drafts are scoped to a website workspace and can use its latest crawl as evidence.</p></div>;

  return <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
    <aside className="surface h-fit overflow-hidden"><div className="flex items-center justify-between border-b border-border px-4 py-4"><div><h2 className="text-sm font-semibold">Drafts</h2><p className="mt-1 text-[10px] text-muted">Saved to your workspace</p></div><button onClick={() => { setSelectedId(null); setTitle(""); setContent(""); setTargetKeyword(""); setRecommendation(null); setError(""); }} className="rounded-lg border border-border p-2 text-muted hover:text-accent" aria-label="New draft"><FilePlus2 size={15} /></button></div>
      <div className="max-h-[520px] divide-y divide-border overflow-y-auto">{documents.length ? documents.map((doc) => <button key={doc.id} onClick={() => openDocument(doc)} className={`w-full p-4 text-left transition ${selectedId === doc.id ? "bg-accent/[0.06]" : "hover:bg-white/[0.025]"}`}><p className="truncate text-xs font-medium">{doc.title}</p><div className="mt-2 flex items-center justify-between"><span className="text-[10px] capitalize text-muted">{doc.documentType.replaceAll("-", " ")}</span><span className={`rounded px-1.5 py-0.5 text-[9px] capitalize ${doc.status === "approved" ? "bg-accent/10 text-accent" : "bg-background text-muted"}`}>{doc.status}</span></div><p className="mt-2 text-[10px] text-muted">{new Date(doc.updatedAt).toLocaleDateString()}</p></button>) : <div className="p-5 text-xs leading-5 text-muted">No saved drafts yet. Create one to begin.</div>}</div>
    </aside>

    <section className="surface min-h-[620px] p-5 sm:p-7">
      {selected ? <>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><p className="eyebrow text-accent">Content workspace</p><h1 className="mt-1 text-xl font-semibold">Edit your draft</h1><p className="mt-1 text-xs text-muted">Changes are saved as revisions. SEOFlow does not publish to your website.</p></div><div className="flex flex-wrap gap-2"><button onClick={exportDraft} className="btn-secondary !px-3 !py-2 text-xs"><Download size={14} />Export</button>{selected.status !== "approved" && <button onClick={() => void saveDocument("approved")} disabled={saving} className="btn-secondary !px-3 !py-2 text-xs"><Check size={14} />Approve draft</button>}<button onClick={() => void saveDocument()} disabled={saving} className="btn-primary !px-3 !py-2 text-xs">{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}Save</button></div></div>
        <div className="mt-6 grid gap-4 sm:grid-cols-[1fr_220px]"><label className="block text-xs font-medium text-muted">Draft title<input value={title} onChange={(event) => setTitle(event.target.value)} className="field mt-2" maxLength={200} /></label><label className="block text-xs font-medium text-muted">Target keyword<input value={targetKeyword} onChange={(event) => setTargetKeyword(event.target.value)} className="field mt-2" maxLength={200} placeholder="Optional" /></label></div>
        <label className="mt-4 block text-xs font-medium text-muted">Original content<textarea value={content} onChange={(event) => setContent(event.target.value)} className="field mt-2 min-h-[340px] resize-y font-mono text-xs leading-6" maxLength={100_000} placeholder="Write useful content that answers the reader's need. SEOFlow will not encourage keyword stuffing or copied text." /></label>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-[10px] text-muted">{content.trim() ? content.trim().split(/\s+/).length : 0} words · {project?.name ?? "Project"}</p><button onClick={() => void getRecommendations()} disabled={optimizing} className="btn-secondary !px-3 !py-2 text-xs"><Sparkles size={14} className="text-accent" />{optimizing ? "Reviewing crawl evidence…" : "Get AI recommendations"}</button></div>
        {recommendation && <div className="mt-5 rounded-xl border border-accent/20 bg-accent/[0.035] p-5"><div className="flex items-center gap-2"><Sparkles size={15} className="text-accent" /><h2 className="text-sm font-semibold">AI recommendations · proposal only</h2></div><p className="mt-3 text-xs leading-5 text-muted">{recommendation.summary}</p>{recommendation.titleSuggestions.length > 0 && <div className="mt-4 space-y-2">{recommendation.titleSuggestions.map((suggestion, index) => <div key={`${suggestion.title}-${index}`} className="rounded-lg border border-border bg-background/60 p-3"><p className="text-xs font-medium">{suggestion.title}</p><p className="mt-1 text-[10px] leading-4 text-muted">{suggestion.rationale}</p></div>)}</div>}{recommendation.metaDescription && <div className="mt-3 rounded-lg border border-border bg-background/60 p-3"><p className="eyebrow">Suggested meta description</p><p className="mt-2 text-xs leading-5">{recommendation.metaDescription}</p></div>}{recommendation.actions.length > 0 && <ul className="mt-4 space-y-2">{recommendation.actions.map((action, index) => <li key={index} className="flex gap-2 text-xs"><span className="mt-0.5 rounded bg-background px-1.5 py-0.5 text-[9px] uppercase text-accent">{action.priority}</span><span><span className="font-medium">{action.action}</span><span className="mt-1 block text-[10px] text-muted">Evidence: {action.evidence}</span></span></li>)}</ul>}<p className="mt-4 border-t border-border pt-3 text-[10px] text-muted">Suggestions were generated using the latest saved crawl for {project?.websiteUrl}. Review accuracy before applying anything.</p></div>}
        {revisions.length > 0 && <details className="mt-5 rounded-xl border border-border p-4"><summary className="cursor-pointer text-xs font-medium">Revision history <span className="text-muted">({revisions.length})</span></summary><div className="mt-3 space-y-2">{revisions.map((revision) => <div key={revision.id} className="flex justify-between gap-2 text-[10px] text-muted"><span>v{revision.version} · {revision.changeSummary ?? "Saved revision"}</span><span>{new Date(revision.createdAt).toLocaleString()}</span></div>)}</div></details>}
      </> : <>
        <div><p className="eyebrow text-accent">Create content</p><h1 className="mt-1 text-xl font-semibold">Start a useful draft</h1><p className="mt-1 text-xs text-muted">Choose a project, set the page type and save your first revision.</p></div>
        <form onSubmit={createDocument} className="mt-6 space-y-4">
          <label className="block text-xs font-medium text-muted">Project<select className="field mt-2" value={projectId} onChange={(event) => setProjectId(event.target.value)} required>{projectList.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="block text-xs font-medium text-muted">Draft title<input className="field mt-2" value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} placeholder="A useful, specific title" /></label><label className="block text-xs font-medium text-muted">Content type<select className="field mt-2" value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{[["article","Article"],["landing-page","Landing page"],["product-page","Product page"],["category-page","Category page"],["other","Other"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <label className="block text-xs font-medium text-muted">Target keyword<input className="field mt-2" value={targetKeyword} onChange={(event) => setTargetKeyword(event.target.value)} maxLength={200} placeholder="Optional; no volume estimate will be invented" /></label>
          <label className="block text-xs font-medium text-muted">Draft content<textarea className="field mt-2 min-h-[300px] resize-y font-mono text-xs leading-6" value={content} onChange={(event) => setContent(event.target.value)} maxLength={100_000} placeholder="Write for people first. Add evidence, expertise and detail that genuinely help the reader." /></label>
          {error && <p role="alert" className="text-xs text-red-300">{error}</p>}{busyMessage && <p role="status" className="text-xs text-accent">{busyMessage}</p>}
          <div className="flex justify-end"><button className="btn-primary" disabled={creating}>{creating ? <LoaderCircle size={15} className="animate-spin" /> : <FilePlus2 size={15} />}Save draft</button></div>
        </form>
      </>}
      {error && <p role="alert" className="mt-4 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}{busyMessage && selected && <p role="status" className="mt-4 text-xs text-accent">{busyMessage}</p>}
    </section>
  </div>;
}

function slug(value: string) { return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "seo-draft"; }
