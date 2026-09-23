import * as React from "react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Clock3, ExternalLink, Plus, Save, ShieldCheck } from "lucide-react";
import { useAtelierGetMe } from "@workspace/api-client-react";

export type PrototypeRecord = {
  id: string; name: string; status: string; lifecycleStatus?: string; opportunityId?: string | null;
  engagementId?: string | null; ownerName?: string | null; ownerId?: string | null;
  handoffEngagementId?: string | null;
  createdAt?: string; requestedAt?: string; dueAt?: string | null; deliveredAt?: string | null;
  slaOutcome?: "met" | "missed" | "pending" | string | null;
  deadlineChangeReason?: string | null; buildUrl?: string | null; demoUrl?: string | null;
  repositoryUrl?: string | null; brief?: Record<string, unknown>; leadApprovedAt?: string | null;
  partnerApprovedAt?: string | null; approvedCostUsd?: number; pendingCostUsd?: number;
  costsByVendor?: Array<{ vendor: string; approvedUsd: number; pendingUsd: number }>;
};

const API = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;
const STATUSES = ["requested", "scoping", "approved", "building", "ready", "delivered", "cancelled"];
const tone = (s: string): "default" | "amber" | "green" | "red" =>
  s === "delivered" ? "green" : s === "cancelled" ? "red" : s === "ready" || s === "approved" ? "amber" : "default";
const fmtDate = (v?: string | null) => v ? new Date(v).toLocaleString() : "—";
const remaining = (due?: string | null) => {
  if (!due) return null;
  const hours = (new Date(due).getTime() - Date.now()) / 36e5;
  return hours < 0 ? `${Math.abs(Math.round(hours))}h overdue` : `${Math.round(hours)}h remaining`;
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}${path}`, { credentials: "include", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => null) as { error?: string; message?: string } | null)?.message ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

export function PrototypesTab({ oppId, oppName }: { oppId: string; oppName: string }) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<PrototypeRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [showCreate, setShowCreate] = React.useState(false);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [name, setName] = React.useState(`Prototype — ${oppName}`);
  const [busy, setBusy] = React.useState(false);
  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const body = await request<PrototypeRecord[] | { items?: PrototypeRecord[]; data?: PrototypeRecord[] }>(`/opportunities/${oppId}/prototypes`);
      const raw = Array.isArray(body) ? body : body.items ?? body.data ?? [];
      setRows(raw.map(p => ({ ...p, status: p.lifecycleStatus ?? p.status })));
    } catch { toast({ title: "Could not load prototypes", variant: "destructive" }); }
    finally { setLoading(false); }
  }, [oppId, toast]);
  React.useEffect(() => { void load(); }, [load]);
  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await request(`/opportunities/${oppId}/prototype`, { method: "POST", body: JSON.stringify({ name: name.trim(), audience: "Client decision-maker", problem: "Demonstrate agentic feasibility within 48 hours.", agenticThesis: "An agent assists; a human always decides.", demos: ["Headline workflow", "Audit and override"], constraints: ["bilingual-aware", "audit trail"], partnerDataApproved: false }) });
      setShowCreate(false); setName(`Prototype — ${oppName}`); await load(); toast({ title: "Prototype request created", description: "The 48-hour SLA clock has started." });
    } catch (e) { toast({ title: "Could not create prototype", description: String(e), variant: "destructive" }); }
    finally { setBusy(false); }
  };
  return <div className="space-y-4" data-testid="prototypes-tab">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="text-[10px] font-mono uppercase tracking-widest text-text-faint">Prototype promise</div><h3 className="text-lg font-semibold">Client prototypes <span className="text-text-faint font-mono text-xs">· {rows.length}</span></h3></div>
      <PillButton variant="primary" onClick={() => setShowCreate(v => !v)} data-testid="button-create-prototype"><Plus className="w-3.5 h-3.5 mr-1" /> Request prototype</PillButton>
    </div>
    {showCreate && <Card className="p-4 space-y-3 bg-bg-deep"><label className="block text-xs font-mono uppercase text-text-faint">Request name<input value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded border border-border-soft bg-bg-elevate px-3 py-2 text-sm text-text" data-testid="input-prototype-name" /></label><div className="flex justify-end gap-2"><PillButton variant="ghost" onClick={() => setShowCreate(false)}>Cancel</PillButton><PillButton variant="primary" onClick={() => void create()} disabled={busy}>{busy ? "Creating…" : "Start 48-hour request"}</PillButton></div></Card>}
    {loading ? <div className="text-sm text-text-mute">Loading prototypes…</div> : rows.length === 0 ? <Card className="p-10 text-center border-dashed"><p className="text-text-mute">No prototype requests yet.</p><p className="text-xs text-text-faint mt-1">Create one to start the delivery clock and keep build evidence with this opportunity.</p></Card> : <div className="grid gap-3">{rows.map(p => <PrototypeCard key={p.id} prototype={p} open={selected === p.id} onOpen={() => setSelected(selected === p.id ? null : p.id)} onChanged={load} />)}</div>}
  </div>;
}

function PrototypeCard({ prototype: p, open, onOpen, onChanged }: { prototype: PrototypeRecord; open: boolean; onOpen: () => void; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const { data: me } = useAtelierGetMe();
  const [status, setStatus] = React.useState(p.status);
  const [dueAt, setDueAt] = React.useState(p.dueAt?.slice(0, 16) ?? "");
  const [reason, setReason] = React.useState("");
  const [links, setLinks] = React.useState({ buildUrl: p.buildUrl ?? "", demoUrl: p.demoUrl ?? "", repositoryUrl: p.repositoryUrl ?? "" });
  const [busy, setBusy] = React.useState(false);
  const [engagements, setEngagements] = React.useState<Array<{ id: string; name: string; opportunityId?: string | null }>>([]);
  const leadCanApprove = me?.role === "founding_partner" || me?.role === "partner" || me?.role === "senior_manager";
  const partnerCanApprove = me?.role === "founding_partner" || me?.role === "partner";
  React.useEffect(() => {
    if (!open || p.engagementId || p.handoffEngagementId) return;
    void request<Array<{ id: string; name: string; opportunityId?: string | null }> | { items?: Array<{ id: string; name: string; opportunityId?: string | null }> }>("/engagements")
      .then(body => setEngagements(Array.isArray(body) ? body : body.items ?? []))
      .catch(() => setEngagements([]));
  }, [open, p.engagementId, p.handoffEngagementId, p.opportunityId]);
  const save = async (path: string, body: unknown, message: string, method: "PATCH" | "POST" = "PATCH") => { setBusy(true); try { await request(path, { method, body: JSON.stringify(body) }); await onChanged(); toast({ title: message }); } catch (e) { toast({ title: "Prototype update failed", description: String(e), variant: "destructive" }); } finally { setBusy(false); } };
  return <Card className="p-4 space-y-3" data-testid={`prototype-card-${p.id}`}>
    <button type="button" className="w-full text-left" onClick={onOpen}><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="font-medium">{p.name}</div><div className="mt-1 text-xs text-text-faint font-mono">Requested {fmtDate(p.requestedAt ?? p.createdAt)} · Owner {p.ownerName ?? "Unassigned"}</div></div><MonoChip tone={tone(p.status)}>{p.status}</MonoChip></div></button>
     <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs"><div className="rounded border border-border-soft p-2"><span className="text-text-faint block">Deadline</span><span className={remaining(p.dueAt)?.includes("overdue") ? "text-danger" : "text-text"}>{fmtDate(p.dueAt)}<br />{remaining(p.dueAt) ?? "No deadline"}</span></div><div className="rounded border border-border-soft p-2"><span className="text-text-faint block">SLA</span><span>{p.deliveredAt ? (p.slaOutcome ?? "Recorded") : "In progress"}</span></div><div className="rounded border border-border-soft p-2"><span className="text-text-faint block">Approved cost</span><span className="font-mono text-green-400">${(p.approvedCostUsd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div><div className="rounded border border-border-soft p-2"><span className="text-text-faint block">Pending cost</span><span className="font-mono text-amber">${(p.pendingCostUsd ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div></div>
    {open && <div className="border-t border-border-soft pt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs"><ShieldCheck className="w-3.5 h-3.5 text-gold" /> Brief {p.leadApprovedAt ? "approved" : "awaiting lead"} · Prompt {p.partnerApprovedAt ? "approved" : "awaiting partner"}</div>
       <div className="flex flex-wrap gap-2">
         <PillButton variant="ghost" disabled={busy || !!p.leadApprovedAt || !leadCanApprove} onClick={() => void save(`/prototypes/${p.id}/approve-brief`, {}, "Brief approved", "POST")}> {p.leadApprovedAt ? "Brief approved" : "Approve brief"} </PillButton>
         <PillButton variant="ghost" disabled={busy || !!p.partnerApprovedAt || !p.leadApprovedAt || !partnerCanApprove} onClick={() => void save(`/prototypes/${p.id}/approve-prompt`, {}, "Prompt approved", "POST")}> {p.partnerApprovedAt ? "Prompt approved" : "Approve prompt"} </PillButton>
       </div>
      <div className="flex flex-wrap gap-1">{STATUSES.map(s => <button key={s} type="button" onClick={() => { setStatus(s); void save(`/prototypes/${p.id}/transition`, { status: s }, `Status moved to ${s}`, "POST"); }} disabled={busy || status === s} className={`rounded border px-2 py-1 text-[10px] font-mono uppercase ${status === s ? "border-gold text-gold" : "border-border-soft text-text-mute"}`}>{s}</button>)}</div>
       {p.status === "delivered" || p.status === "cancelled" ? <div className="text-xs text-text-faint border border-border-soft rounded p-2">Deadline evidence is immutable after {p.status}; the persisted SLA outcome is retained for audit.</div> : <><div className="grid md:grid-cols-2 gap-3"><label className="text-xs text-text-faint">Deadline<input type="datetime-local" value={dueAt} onChange={e => setDueAt(e.target.value)} className="mt-1 w-full rounded border border-border-soft bg-bg-elevate px-2 py-1 text-text" /></label><label className="text-xs text-text-faint">Reason for deadline change<input value={reason} onChange={e => setReason(e.target.value)} placeholder="Required when changing the promise" className="mt-1 w-full rounded border border-border-soft bg-bg-elevate px-2 py-1 text-text" /></label></div>
       <PillButton variant="ghost" disabled={busy || !dueAt || !reason.trim()} onClick={() => void save(`/prototypes/${p.id}/deadline`, { dueAt: new Date(dueAt).toISOString(), reason }, "Deadline updated", "POST")}><Clock3 className="w-3 h-3 mr-1" /> Save deadline</PillButton></>}
      <div className="grid md:grid-cols-3 gap-2">{(["buildUrl", "demoUrl", "repositoryUrl"] as const).map(k => <label key={k} className="text-xs text-text-faint">{k === "buildUrl" ? "Build link" : k === "demoUrl" ? "Demo link" : "Repository"}<input value={links[k]} onChange={e => setLinks({ ...links, [k]: e.target.value })} className="mt-1 w-full rounded border border-border-soft bg-bg-elevate px-2 py-1 text-text" placeholder="https://" /></label>)}</div>
      <PillButton variant="ghost" disabled={busy} onClick={() => void save(`/prototypes/${p.id}/links`, links, "Links saved")}><Save className="w-3 h-3 mr-1" /> Save links</PillButton>
       {!p.engagementId && !p.handoffEngagementId && engagements.filter(e => !e.opportunityId || e.opportunityId === p.opportunityId).length > 0 && (
         <div className="flex flex-wrap items-center gap-2">
           <select className="rounded border border-border-soft bg-bg-elevate px-2 py-1 text-xs text-text" defaultValue="" id={`handoff-${p.id}`}>
             <option value="">Select engagement for handoff…</option>
             {engagements.filter(e => !e.opportunityId || e.opportunityId === p.opportunityId).map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
           </select>
           <PillButton variant="ghost" disabled={busy} onClick={() => {
             const el = document.getElementById(`handoff-${p.id}`) as HTMLSelectElement | null;
             if (el?.value) void save(`/prototypes/${p.id}/handoff`, { engagementId: el.value }, "Prototype handed off", "POST");
           }}>Handoff</PillButton>
         </div>
       )}
      <div className="flex flex-wrap gap-3 text-xs">{Object.entries(links).filter(([, v]) => v).map(([k, v]) => <a key={k} href={v} target="_blank" rel="noreferrer" className="text-gold hover:underline inline-flex items-center gap-1">{k.replace("Url", "")}<ExternalLink className="w-3 h-3" /></a>)}</div>
      <div className="text-xs text-text-faint">Delivered {fmtDate(p.deliveredAt)} · Costs are counted only after finance approval; unmapped and proposed spend stays pending.</div>
    </div>}
  </Card>;
}