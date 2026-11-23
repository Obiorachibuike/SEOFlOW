"use client";

import { useEffect, useState } from "react";
import { Check, LoaderCircle, Plus, RefreshCw, ShieldAlert, Sparkles, ToggleLeft, ToggleRight, Waypoints, X } from "lucide-react";

type Model = { id: string; providerId: string; modelId: string; displayName: string; capabilities: string[]; enabled: boolean; inputCostPerMillion?: string | null; outputCostPerMillion?: string | null };
type Provider = { id: string; slug: string; displayName: string; adapter: string; baseUrl: string; enabled: boolean; credentialsConfigured: boolean; models: Model[] };
type Assignment = { task: string; priority: number; enabled: boolean; provider: { id: string; slug: string; displayName: string }; model: { id: string; modelId: string; displayName: string } };

export function AiManager() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerForm, setProviderForm] = useState({ slug: "agnes", displayName: "Agnes AI", adapter: "agnes-openai-compatible", baseUrl: "", apiKey: "", enabled: false });
  const [modelForms, setModelForms] = useState<Record<string, { modelId: string; displayName: string; capabilities: string; inputCost: string; outputCost: string }>>({});
  const [task, setTask] = useState("page-optimization");
  const [selectedModels, setSelectedModels] = useState<string[]>([]);

  async function refresh() {
    setLoading(true); setError("");
    try {
      const [providerResponse, taskResponse] = await Promise.all([fetch("/api/admin/ai/providers", { cache: "no-store" }), fetch("/api/admin/ai/tasks", { cache: "no-store" })]);
      const providerData = await providerResponse.json() as { providers?: Provider[]; error?: string };
      const taskData = await taskResponse.json() as { assignments?: Assignment[]; error?: string };
      if (!providerResponse.ok || !taskResponse.ok) throw new Error(providerData.error ?? taskData.error ?? "Could not load AI settings.");
      setProviders(providerData.providers ?? []); setAssignments(taskData.assignments ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load AI settings."); }
    setLoading(false);
  }
  useEffect(() => { void refresh(); }, []);

  async function createProvider(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/admin/ai/providers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(providerForm) });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not save the provider."); return; }
    setProviderForm({ slug: "", displayName: "", adapter: "agnes-openai-compatible", baseUrl: "", apiKey: "", enabled: false });
    setNotice("Provider credential was encrypted and saved. The key is never returned to the browser."); await refresh();
  }

  async function addModel(event: React.FormEvent<HTMLFormElement>, providerId: string) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = modelForms[providerId] ?? { modelId: "", displayName: "", capabilities: "", inputCost: "", outputCost: "" };
    const response = await fetch(`/api/admin/ai/providers/${providerId}/models`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: form.modelId, displayName: form.displayName, capabilities: form.capabilities.split(",").map((entry) => entry.trim()).filter(Boolean), inputCostPerMillion: form.inputCost ? Number(form.inputCost) : undefined, outputCostPerMillion: form.outputCost ? Number(form.outputCost) : undefined }) });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not register that model."); return; }
    setModelForms((current) => ({ ...current, [providerId]: { modelId: "", displayName: "", capabilities: "", inputCost: "", outputCost: "" } }));
    setNotice("Model registered. It can be assigned to tasks after a successful connection test."); await refresh();
  }

  async function toggleProvider(provider: Provider) {
    setError(""); setNotice("");
    const response = await fetch(`/api/admin/ai/providers/${provider.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !provider.enabled }) });
    const data = await response.json() as { error?: string };
    if (!response.ok) { setError(data.error ?? "Could not update provider."); return; }
    setNotice(`${provider.displayName} ${provider.enabled ? "disabled" : "enabled"}.`); await refresh();
  }

  async function testModel(provider: Provider, model: Model) {
    setBusy(true); setError(""); setNotice("");
    const response = await fetch(`/api/admin/ai/providers/${provider.id}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modelId: model.id }) });
    const data = await response.json() as { ok?: boolean; error?: string; usage?: { inputTokens: number; outputTokens: number } };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Connection test failed."); return; }
    setNotice(`Connection successful · ${data.usage?.inputTokens ?? 0} input / ${data.usage?.outputTokens ?? 0} output tokens reported.`);
  }

  async function saveRouting(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const response = await fetch("/api/admin/ai/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, modelIds: selectedModels }) });
    const data = await response.json() as { error?: string };
    setBusy(false);
    if (!response.ok) { setError(data.error ?? "Could not update task routing."); return; }
    setNotice(`Routing updated for ${task}. Earlier models are attempted first; later selections are fallbacks.`); await refresh();
  }

  function changeModelForm(providerId: string, field: string, value: string) {
    setModelForms((current) => {
      const previous = current[providerId] ?? { modelId: "", displayName: "", capabilities: "", inputCost: "", outputCost: "" };
      return { ...current, [providerId]: { ...previous, [field]: value } };
    });
  }

  const allModels = providers.flatMap((provider) => provider.models.filter((model) => model.enabled).map((model) => ({ ...model, providerName: provider.displayName })));
  const taskNames = [...new Set(assignments.map((assignment) => assignment.task))];

  return <div className="space-y-5">
    {error && <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300"><ShieldAlert size={15} className="mt-0.5 shrink-0" />{error}<button onClick={() => setError("")} className="ml-auto" aria-label="Dismiss"><X size={14} /></button></div>}
    {notice && <div role="status" className="rounded-xl border border-accent/20 bg-accent/5 p-3 text-xs text-accent">{notice}</div>}

    <section className="surface p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Sparkles size={17} /></span><div><h2 className="text-sm font-semibold">Register an AI provider</h2><p className="mt-1 text-xs leading-5 text-muted">Agnes AI is the default fallback when configured. Provider APIs must be public HTTPS, OpenAI-compatible endpoints; model IDs are entered by an administrator, never assumed.</p></div></div>
      <form onSubmit={createProvider} className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <label className="text-[10px] text-muted">Provider slug<input className="field mt-1.5 !py-2 text-xs" value={providerForm.slug} onChange={(event) => setProviderForm({ ...providerForm, slug: event.target.value })} required maxLength={49} placeholder="agnes" /></label>
        <label className="text-[10px] text-muted">Display name<input className="field mt-1.5 !py-2 text-xs" value={providerForm.displayName} onChange={(event) => setProviderForm({ ...providerForm, displayName: event.target.value })} required maxLength={100} placeholder="Agnes AI" /></label>
        <label className="text-[10px] text-muted">Adapter<select className="field mt-1.5 !py-2 text-xs" value={providerForm.adapter} onChange={(event) => setProviderForm({ ...providerForm, adapter: event.target.value })}><option value="agnes-openai-compatible">Agnes AI · compatible chat</option><option value="openai-compatible">OpenAI · compatible chat</option><option value="huggingface-chat-compatible">Hugging Face · compatible chat</option></select></label>
        <label className="text-[10px] text-muted xl:col-span-2">Base URL<input className="field mt-1.5 !py-2 text-xs" type="url" value={providerForm.baseUrl} onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} required placeholder="https://provider.example/v1" /></label>
        <label className="text-[10px] text-muted">API credential<input className="field mt-1.5 !py-2 text-xs" type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} required autoComplete="new-password" placeholder="Stored encrypted" /></label>
        <div className="flex items-center justify-between md:col-span-2 xl:col-span-6"><label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={providerForm.enabled} onChange={(event) => setProviderForm({ ...providerForm, enabled: event.target.checked })} className="rounded border-border bg-background text-accent focus:ring-accent" />Enable after saving</label><button className="btn-primary !px-3 !py-2 text-xs" disabled={busy}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Plus size={14} />}Save provider</button></div>
      </form>
    </section>

    <section className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Configured providers & models</h2><p className="mt-1 text-xs text-muted">Secrets are encrypted at rest and are never shown after saving.</p></div><button className="btn-secondary !px-3 !py-2 text-xs" onClick={() => void refresh()}><RefreshCw size={13} />Refresh</button></div>
      {loading ? <div className="surface flex items-center gap-2 p-6 text-xs text-muted"><LoaderCircle size={14} className="animate-spin" />Loading provider registry…</div> : providers.length === 0 ? <div className="surface p-6 text-center text-xs text-muted">No AI provider is configured. Add Agnes AI or another supported provider above.</div> : providers.map((provider) => <article key={provider.id} className="surface overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div className="min-w-0"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold">{provider.displayName}</h3><span className="rounded bg-background px-2 py-0.5 font-mono text-[9px] text-muted">{provider.slug}</span>{provider.slug === "agnes" && <span className="rounded bg-accent/10 px-2 py-0.5 text-[9px] text-accent">DEFAULT</span>}</div><p className="mt-1 truncate text-[10px] text-muted">{provider.adapter} · {provider.baseUrl} · {provider.credentialsConfigured ? "Credential configured" : "Missing credential"}</p></div><button onClick={() => void toggleProvider(provider)} className={`flex items-center gap-2 text-xs ${provider.enabled ? "text-accent" : "text-muted"}`}>{provider.enabled ? <ToggleRight size={19} /> : <ToggleLeft size={19} />}{provider.enabled ? "Enabled" : "Disabled"}</button></div>
        <div className="p-5">
          {provider.models.length > 0 ? <div className="space-y-2">{provider.models.map((model) => <div key={model.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background/40 p-3"><div className="min-w-0"><p className="text-xs font-medium">{model.displayName} <span className="ml-1 font-mono text-[10px] text-muted">{model.modelId}</span></p><p className="mt-1 text-[10px] text-muted">Capabilities: {model.capabilities.length ? model.capabilities.join(", ") : "Not specified"} · Cost per million tokens: {model.inputCostPerMillion ?? "—"} in / {model.outputCostPerMillion ?? "—"} out</p></div><div className="flex items-center gap-2"><button onClick={() => void testModel(provider, model)} disabled={busy || !provider.enabled} className="btn-secondary !px-2.5 !py-1.5 text-[10px]">Test connection</button><button onClick={async () => { const response = await fetch(`/api/admin/ai/models/${model.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !model.enabled }) }); const data = await response.json() as { error?: string }; if (!response.ok) setError(data.error ?? "Could not update model."); else { setNotice(`Model ${model.enabled ? "disabled" : "enabled"}.`); await refresh(); } }} className={`text-[10px] ${model.enabled ? "text-accent" : "text-muted"}`}>{model.enabled ? "Disable" : "Enable"}</button></div></div>)}</div> : <p className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">No models registered. Add the exact model identifier supplied by this provider.</p>}
          <form onSubmit={(event) => void addModel(event, provider.id)} className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            <input className="field !py-2 text-xs" value={(modelForms[provider.id] ?? { modelId: "" }).modelId} onChange={(event) => changeModelForm(provider.id,"modelId",event.target.value)} placeholder="Exact model ID" required />
            <input className="field !py-2 text-xs" value={(modelForms[provider.id] ?? { displayName: "" }).displayName} onChange={(event) => changeModelForm(provider.id,"displayName",event.target.value)} placeholder="Display name" required />
            <input className="field !py-2 text-xs" value={(modelForms[provider.id] ?? { capabilities: "" }).capabilities} onChange={(event) => changeModelForm(provider.id,"capabilities",event.target.value)} placeholder="Capabilities, comma-separated" />
            <div className="grid grid-cols-2 gap-2"><input className="field !py-2 text-xs" type="number" min="0" step="0.000001" value={(modelForms[provider.id] ?? { inputCost: "" }).inputCost} onChange={(event) => changeModelForm(provider.id,"inputCost",event.target.value)} placeholder="Input $/1M" /><input className="field !py-2 text-xs" type="number" min="0" step="0.000001" value={(modelForms[provider.id] ?? { outputCost: "" }).outputCost} onChange={(event) => changeModelForm(provider.id,"outputCost",event.target.value)} placeholder="Output $/1M" /></div>
            <button className="btn-secondary !py-2 text-xs" disabled={busy}><Plus size={13} />Register model</button>
          </form>
        </div>
      </article>)}
    </section>

    <section className="surface p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Waypoints size={17} /></span><div><h2 className="text-sm font-semibold">Task routing & fallbacks</h2><p className="mt-1 text-xs leading-5 text-muted">Choose the preferred model first, then fallback models in order. If no explicit route exists, an enabled Agnes AI model is tried.</p></div></div>
      <form onSubmit={saveRouting} className="mt-5 grid gap-4 md:grid-cols-[220px_1fr_auto] md:items-end"><label className="text-xs text-muted">Task identifier<input className="field mt-2" list="seoflow-ai-tasks" value={task} onChange={(event) => { setTask(event.target.value); setSelectedModels(assignments.filter((assignment) => assignment.task === event.target.value).sort((a,b) => a.priority-b.priority).map((assignment) => assignment.model.id)); }} required maxLength={100} /><datalist id="seoflow-ai-tasks">{taskNames.map((item) => <option key={item} value={item} />)}<option value="page-optimization" /><option value="content-brief" /><option value="keyword-clustering" /></datalist></label><label className="text-xs text-muted">Models in priority order <select multiple className="field mt-2 min-h-[108px]" value={selectedModels} onChange={(event) => setSelectedModels(Array.from(event.currentTarget.selectedOptions, (option) => option.value))}>{allModels.map((model) => <option key={model.id} value={model.id}>{model.providerName} · {model.displayName} ({model.modelId})</option>)}</select><span className="mt-1 block text-[10px] text-muted">Hold Ctrl/Cmd to select multiple. Order by current selection list is sent to the server.</span></label><button className="btn-primary" disabled={busy || selectedModels.length === 0}>{busy ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}Save routing</button></form>
      {assignments.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="text-xs font-medium">Current routing</p><div className="mt-3 flex flex-wrap gap-2">{assignments.sort((a,b) => a.task.localeCompare(b.task) || a.priority-b.priority).map((assignment) => <span key={`${assignment.task}-${assignment.model.id}`} className="rounded-lg border border-border bg-background/50 px-3 py-2 text-[10px]"><span className="text-accent">{assignment.task}</span><span className="mx-1.5 text-muted">→</span>{assignment.priority + 1}. {assignment.provider.displayName} / {assignment.model.displayName}</span>)}</div></div>}
    </section>
  </div>;
}
