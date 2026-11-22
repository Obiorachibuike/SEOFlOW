"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, Plus, X } from "lucide-react";

export function CreateProjectForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      websiteUrl: String(form.get("websiteUrl") ?? "").trim(),
      name: String(form.get("name") ?? "").trim() || undefined,
      targetCountry: String(form.get("targetCountry") ?? "") || undefined,
      targetLanguage: String(form.get("targetLanguage") ?? "") || undefined
    };
    const response = await fetch("/api/projects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json() as { error?: string; project?: { id: string } };
    setBusy(false);
    if (!response.ok || !data.project) { setError(data.error ?? "Could not add this website."); return; }
    setOpen(false);
    router.push(`/dashboard/projects/${data.project.id}`);
    router.refresh();
  }
  if (!open) return <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} />Add website</button>;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="project-dialog-title">
    <div className="surface w-full max-w-lg p-6 shadow-2xl sm:p-7">
      <div className="flex items-start justify-between"><div><p className="eyebrow text-accent">New project</p><h2 id="project-dialog-title" className="mt-2 text-xl font-semibold">Add a website</h2><p className="mt-1 text-xs text-muted">Only add sites you own or are authorized to audit.</p></div><button className="rounded-lg p-2 text-muted hover:text-foreground" onClick={() => setOpen(false)} aria-label="Close"><X size={17} /></button></div>
      <form className="mt-6 space-y-4" onSubmit={submit}>
        <label className="block text-xs font-medium text-muted">Website URL<input className="field mt-2" name="websiteUrl" type="url" placeholder="https://example.com" required maxLength={2048} autoFocus /></label>
        <label className="block text-xs font-medium text-muted">Project name <span className="font-normal">(optional)</span><input className="field mt-2" name="name" placeholder="My website" maxLength={100} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-xs font-medium text-muted">Target country <span className="font-normal">(optional)</span><select className="field mt-2" name="targetCountry" defaultValue=""><option value="">Not set</option>{[["US","United States"],["GB","United Kingdom"],["NG","Nigeria"],["CA","Canada"],["AU","Australia"],["IN","India"]].map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="block text-xs font-medium text-muted">Language <span className="font-normal">(optional)</span><input className="field mt-2" name="targetLanguage" placeholder="en" maxLength={12} /></label>
        </div>
        {error && <p role="alert" className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button><button className="btn-primary" disabled={busy}>{busy && <LoaderCircle size={15} className="animate-spin" />}Create project</button></div>
      </form>
    </div>
  </div>;
}
