"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { LoaderCircle, MailPlus, RefreshCw, Users } from "lucide-react";

type Member = { id: string; role: string; createdAt: string; user: { id: string; name: string; email: string } };
type Invitation = { id: string; email: string; role: string; expiresAt: string; createdAt: string };

export function WorkspaceMembers({ organizationId, role }: { organizationId: string; role: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    const response = await fetch(`/api/workspaces/${organizationId}/members`, { cache: "no-store" });
    const data = await response.json() as { members?: Member[]; pendingInvitations?: Invitation[]; error?: string };
    setLoading(false);
    if (!response.ok) { setError(data.error ?? "Could not load workspace members."); return; }
    setMembers(data.members ?? []); setInvitations(data.pendingInvitations ?? []);
  }, [organizationId]);
  useEffect(() => { void refresh(); }, [refresh]);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch(`/api/workspaces/${organizationId}/members`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: String(form.get("email") ?? ""), role: String(form.get("role") ?? "viewer") }) });
    const data = await response.json() as { invitation?: { email: string; role: string }; error?: string };
    setBusy(false);
    if (!response.ok || !data.invitation) { setError(data.error ?? "Could not send invitation."); return; }
    setNotice(`Invitation sent to ${data.invitation.email}. The link expires in seven days.`); event.currentTarget.reset(); await refresh();
  }
  return <section className="surface overflow-hidden">
    <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/10 text-accent"><Users size={17} /></span><div><h2 className="text-sm font-semibold">Workspace members</h2><p className="mt-1 text-[10px] text-muted">Roles apply across projects in this workspace.</p></div></div><button onClick={() => void refresh()} className="rounded-lg border border-border p-2 text-muted hover:text-foreground" aria-label="Refresh members"><RefreshCw size={14} /></button></div>
    {error && <p role="alert" className="px-5 pt-4 text-xs text-red-300">{error}</p>}{notice && <p role="status" className="px-5 pt-4 text-xs text-accent">{notice}</p>}
    {role === "owner" || role === "admin" ? <form onSubmit={invite} className="grid gap-3 border-b border-border bg-background/30 p-5 sm:grid-cols-[1fr_180px_auto] sm:items-end"><label className="text-xs text-muted">Invite by email<input className="field mt-2" type="email" name="email" required placeholder="teammate@company.com" /></label><label className="text-xs text-muted">Workspace role<select className="field mt-2" name="role"><option value="seo_manager">SEO Manager</option><option value="editor">Editor</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><button disabled={busy} className="btn-primary">{busy ? <LoaderCircle size={14} className="animate-spin" /> : <MailPlus size={14} />}Send invite</button></form> : <p className="border-b border-border px-5 py-4 text-xs text-muted">Only workspace owners and admins can invite members.</p>}
    <div className="divide-y divide-border">{loading ? <div className="p-5 text-xs text-muted">Loading members…</div> : members.map((member) => <div key={member.id} className="flex items-center gap-3 px-5 py-4"><span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-[10px] font-semibold text-accent">{member.user.name.split(/\s+/).map((part) => part[0]).join("").slice(0,2).toUpperCase()}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{member.user.name}</p><p className="truncate text-[10px] text-muted">{member.user.email}</p></div><span className="rounded-full border border-border px-2.5 py-1 text-[10px] capitalize text-muted">{member.role.replaceAll("_", " ")}</span></div>)}{invitations.map((invitation) => <div key={invitation.id} className="flex items-center gap-3 px-5 py-4"><span className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted"><MailPlus size={13} /></span><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{invitation.email}</p><p className="mt-1 text-[10px] text-muted">Invitation expires {new Date(invitation.expiresAt).toLocaleDateString()}</p></div><span className="rounded-full bg-amber-400/10 px-2.5 py-1 text-[10px] capitalize text-amber-300">pending · {invitation.role.replaceAll("_", " ")}</span></div>)}{!loading && members.length === 0 && <p className="p-5 text-xs text-muted">This workspace has no members.</p>}</div>
  </section>;
}
