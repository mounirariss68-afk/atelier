import * as React from "react";
import { useLocation } from "wouter";
import { PageHero, SectionHead, Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { ExternalLink, Search } from "lucide-react";
import type { PrototypeRecord } from "@/components/tabs/PrototypesTab";

type PortfolioRecord = PrototypeRecord & { opportunityName?: string; accountName?: string; ownerName?: string | null };
const API = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;
async function load(): Promise<PortfolioRecord[]> {
  const r = await fetch(`${API}/prototypes`, { credentials: "include" });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const b = await r.json() as PortfolioRecord[] | { items?: PortfolioRecord[]; data?: PortfolioRecord[] };
  const rows = Array.isArray(b) ? b : b.items ?? b.data ?? [];
  return rows.map(r => ({ ...r, status: r.lifecycleStatus ?? r.status }));
}
const statusTone = (s: string): "default" | "amber" | "green" | "red" => s === "delivered" ? "green" : s === "cancelled" ? "red" : s === "ready" || s === "approved" ? "amber" : "default";
export default function Prototypes() {
  const [, navigate] = useLocation();
  const [rows, setRows] = React.useState<PortfolioRecord[]>([]);
  const [error, setError] = React.useState(false);
  const [status, setStatus] = React.useState("all");
  const [client, setClient] = React.useState("");
  const [owner, setOwner] = React.useState("");
  const [deadline, setDeadline] = React.useState("all");
  React.useEffect(() => { void load().then(setRows).catch(() => setError(true)); }, []);
  const clients = [...new Set(rows.map(r => r.accountName).filter(Boolean) as string[])].sort();
  const owners = [...new Set(rows.map(r => r.ownerName).filter(Boolean) as string[])].sort();
  const now = Date.now();
  const visible = rows.filter(r => status === "all" || r.status === status).filter(r => !client || r.accountName === client).filter(r => !owner || r.ownerName === owner).filter(r => deadline === "all" || (deadline === "overdue" ? !!r.dueAt && !r.deliveredAt && new Date(r.dueAt).getTime() < now : deadline === "soon" ? !!r.dueAt && !r.deliveredAt && new Date(r.dueAt).getTime() >= now && new Date(r.dueAt).getTime() < now + 48 * 36e5 : deadline === "delivered" ? r.status === "delivered" : true));
  return <div className="animate-in fade-in"><PageHero><SectionHead eyebrow="Clients · Delivery promise" headline="Prototype portfolio" lede="A cross-client view of every 48-hour prototype request, its owner, evidence, SLA, and approved tooling spend." /></PageHero><div className="container-atelier py-8 space-y-5">
    <Card className="p-4"><div className="flex flex-wrap items-center gap-2"><Search className="w-4 h-4 text-text-faint" /><select value={status} onChange={e => setStatus(e.target.value)} className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"><option value="all">All statuses</option>{["requested", "scoping", "approved", "building", "ready", "delivered", "cancelled"].map(s => <option key={s}>{s}</option>)}</select><select value={client} onChange={e => setClient(e.target.value)} className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"><option value="">All clients</option>{clients.map(c => <option key={c}>{c}</option>)}</select><select value={owner} onChange={e => setOwner(e.target.value)} className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"><option value="">All owners</option>{owners.map(o => <option key={o}>{o}</option>)}</select><select value={deadline} onChange={e => setDeadline(e.target.value)} className="rounded border border-border-soft bg-bg-deep px-2 py-1 text-xs"><option value="all">Any deadline</option><option value="soon">Due within 48h</option><option value="overdue">Overdue</option><option value="delivered">Delivered</option></select><span className="ml-auto text-xs font-mono text-text-faint">{visible.length} shown</span></div></Card>
    {error ? <Card className="p-10 text-center text-danger">Could not load the prototype portfolio.</Card> : visible.length === 0 ? <Card className="p-12 text-center border-dashed"><p className="text-text-mute">No prototypes match these filters.</p><PillButton variant="ghost" onClick={() => { setStatus("all"); setClient(""); setOwner(""); setDeadline("all"); }}>Clear filters</PillButton></Card> : <div className="grid gap-3">{visible.map(p => <button type="button" key={p.id} onClick={() => navigate(`/opportunities/${p.opportunityId}?tab=prototypes`)} className="text-left"><Card className="p-4 hover:border-gold/50 transition-colors"><div className="flex flex-wrap justify-between gap-2"><div><div className="font-medium">{p.name}</div><div className="text-xs text-text-faint mt-1">{p.accountName ?? "Client"} · {p.opportunityName ?? "Opportunity"} · {p.ownerName ?? "Unassigned"}</div></div><MonoChip tone={statusTone(p.status)}>{p.status}</MonoChip></div><div className="mt-3 flex flex-wrap gap-4 text-xs font-mono"><span>Due {p.dueAt ? new Date(p.dueAt).toLocaleString() : "—"}</span><span className="text-green-400">Approved ${((p.approvedCostUsd ?? 0)).toLocaleString()}</span><span className="text-amber">Pending ${((p.pendingCostUsd ?? 0)).toLocaleString()}</span>{p.buildUrl && <ExternalLink className="w-3 h-3 text-gold" />}</div></Card></button>)}</div>}
  </div></div>;
}