import * as React from "react";
import { AlertTriangle, ArrowUpRight, GitBranch, WalletCards } from "lucide-react";
import { Card, Eyebrow, MonoChip, SectionLabel } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAtelierGetMe } from "@workspace/api-client-react";
import {
  useDistributions, useOwnership, useOwnershipEntity, useOwnershipGroup, useOwnershipMutation, useOwnershipPerson,
  type DistributionDeclaration, type OwnershipEntitySummary, type OwnershipStake,
} from "@/lib/v5-hooks";

const pct = (n: number | null | undefined) => n == null ? "—" : `${n}%`;
const today = () => new Date().toISOString().slice(0, 10);
const tone = (s: string) => s === "approved" || s === "snapshotted" || s === "paid" ? "green" : s === "draft" ? undefined : "amber";

function StakeTable({ stakes }: { stakes: OwnershipStake[] }) {
  if (!stakes.length) return <p className="text-xs text-text-faint">No normalized interests recorded for this date.</p>;
  return <div className="overflow-x-auto"><table className="w-full text-xs">
    <thead><tr className="border-b border-border-soft text-left text-text-mute font-mono uppercase tracking-wider">
      <th className="py-2 pr-3">Holder</th><th className="py-2 pr-3">Legal</th><th className="py-2 pr-3">Voting/control</th><th className="py-2 pr-3">Profit</th><th className="py-2 pr-3">Effective</th><th className="py-2">Status</th>
    </tr></thead>
    <tbody>{stakes.map((s) => <tr key={s.id} className="border-b border-border-soft/60">
      <td className="py-2 pr-3 text-text">{s.holderName}{s.shareClass && <span className="block text-[10px] text-text-faint">{s.shareClass}</span>}</td>
      <td className="py-2 pr-3 font-mono">{pct(s.legalOwnershipPct)}</td><td className="py-2 pr-3 font-mono">{pct(s.votingControlPct)}</td><td className="py-2 pr-3 font-mono">{pct(s.profitParticipationPct)}</td>
      <td className="py-2 pr-3 font-mono text-text-faint">{s.effectiveFrom}{s.effectiveTo ? ` → ${s.effectiveTo}` : ""}</td>
      <td className="py-2"><MonoChip tone={s.pendingTerms || s.status === "pending" ? "amber" : undefined}>{s.pendingTerms ? "Terms pending" : s.status ?? "active"}</MonoChip></td>
    </tr>)}</tbody>
  </table></div>;
}

export function EntityOwnershipCard({ entity, asOf }: { entity: OwnershipEntitySummary; asOf: string }) {
  const { data } = useOwnershipEntity(entity.id, asOf);
  const detail = data ?? entity;
  return <Card className="p-4 space-y-3" data-testid={`ownership-entity-${entity.id}`}>
    <div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Eyebrow>{detail.lifecycleStatus ?? detail.status}</Eyebrow>{detail.approvalStatus && detail.approvalStatus !== "approved" && <MonoChip tone="amber">{detail.approvalStatus}</MonoChip>}</div><h3 className="text-base text-text mt-1">{detail.name}</h3>{detail.country && <p className="text-xs text-text-faint">{detail.country}</p>}</div><GitBranch className="w-4 h-4 text-gold" /></div>
    <StakeTable stakes={detail.directStakes} />
    {detail.franchise && <div className="rounded border border-border-soft p-3 text-xs"><div className="font-mono uppercase tracking-wider text-text-mute">Franchise territory</div><div className="mt-1 text-text">{detail.franchise.operatorName} · {detail.franchise.territory}</div><div className="text-text-faint">{detail.franchise.agreementFrom ?? "term pending"} → {detail.franchise.agreementTo ?? "open"}{detail.franchise.royaltySharePct != null ? ` · ${detail.franchise.royaltySharePct}% royalty` : ""}</div></div>}
    {!!(detail.warnings.length || detail.pendingTerms.length) && <div className="space-y-1 rounded border border-warning/40 bg-warning/5 p-3 text-xs text-warning"><div className="flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Review items</div>{[...detail.warnings, ...detail.pendingTerms].map((w, i) => <div key={`${w}-${i}`}>• {w}</div>)}</div>}
  </Card>;
}

export function DistributionsPanel({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, refetch } = useDistributions();
  const { toast } = useToast();
  const create = useOwnershipMutation("/finance/distributions");
  const [busyAction, setBusyAction] = React.useState<string | null>(null);
  const [year, setYear] = React.useState(new Date().getFullYear());
  const [profit, setProfit] = React.useState("");
  const [cashReserve, setCashReserve] = React.useState("");
  const [operatingReserve, setOperatingReserve] = React.useState("");
  const items = data?.items ?? [];
  const estimated = Number(profit) || 0;
  const cash = Number(cashReserve) || 0;
  const operating = Number(operatingReserve) || 0;
  const distributable = estimated - cash - operating;
  async function run(m: ReturnType<typeof useOwnershipMutation>, body: Record<string, unknown> = {}) {
    try { await m.mutateAsync(body); await refetch(); toast({ title: "Distribution workflow updated" }); }
    catch (e) { toast({ title: "Distribution update failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" }); }
  }
  async function runAction(id: string, verb: "submit" | "approve") {
    setBusyAction(`${id}:${verb}`);
    try {
      const response = await fetch(`/api/atelier/finance/distributions/${encodeURIComponent(id)}/${verb}`, {
        method: "POST", credentials: "include", headers: { Accept: "application/json", "content-type": "application/json" }, body: "{}",
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? body.error ?? `Request failed (${response.status})`);
      toast({ title: "Distribution workflow updated" });
      await refetch();
    } catch (e) { toast({ title: "Distribution update failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" }); }
    finally { setBusyAction(null); }
  }
  return <section data-testid="ownership-distributions" className="space-y-4">
    <div className="flex items-baseline gap-3"><SectionLabel>Partner distributions</SectionLabel><WalletCards className="w-4 h-4 text-gold" /><span className="text-xs text-text-faint">Outside payroll · snapshot-based</span></div>
    {canWrite && <Card className="p-4"><div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
      <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Year<input className="mt-1 h-9 w-full rounded border border-border glass-surface px-2 text-sm" type="number" value={year} onChange={e => setYear(Number(e.target.value))} /></label>
      <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Estimated profit<input className="mt-1 h-9 w-full rounded border border-border glass-surface px-2 text-sm" type="number" value={profit} onChange={e => setProfit(e.target.value)} placeholder="0.00" /></label>
      <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Cash reserve<input className="mt-1 h-9 w-full rounded border border-border glass-surface px-2 text-sm" type="number" min="0" value={cashReserve} onChange={e => setCashReserve(e.target.value)} placeholder="0.00" /></label>
      <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">Operating capital<input className="mt-1 h-9 w-full rounded border border-border glass-surface px-2 text-sm" type="number" min="0" value={operatingReserve} onChange={e => setOperatingReserve(e.target.value)} placeholder="0.00" /></label>
      <Button disabled={create.isPending || !profit || distributable < 0} onClick={() => void run(create, { year, estimatedProfit: estimated, cashReserve: cash, operatingCapitalReserve: operating, asOf: today() })}>Start draft declaration</Button>
    </div><div className={`text-xs mt-3 ${distributable < 0 ? "text-danger" : "text-text-mute"}`}>Computed distributable: <span className="font-mono">{distributable.toLocaleString()}</span>{distributable < 0 && " — reserves cannot exceed estimated profit."}</div></Card>}
    {isLoading && <Card className="p-4 text-sm text-text-mute">Loading declarations…</Card>}
    {!isLoading && !items.length && <Card className="p-4 text-sm text-text-mute">No annual declarations yet.</Card>}
    {items.map((d: DistributionDeclaration) => <Card key={d.id} className="p-4 space-y-3" data-testid={`distribution-${d.id}`}>
      <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm text-text">FY {d.year}</h3><MonoChip tone={tone(d.status)}>{d.status}</MonoChip><span className="text-xs text-text-faint">{d.currency}</span><span className="ml-auto text-sm font-mono">{d.approvedDistributableProfit == null ? "Awaiting approval" : d.approvedDistributableProfit.toLocaleString()}</span></div>
      <div className="grid grid-cols-3 gap-3 text-xs"><div><span className="text-text-faint block">Estimated profit</span>{d.estimatedProfit.toLocaleString()}</div><div><span className="text-text-faint block">Cash reserve</span>{d.cashReserve.toLocaleString()}</div><div><span className="text-text-faint block">Operating reserve</span>{d.operatingCapitalReserve.toLocaleString()}</div></div>
      {!!d.allocations.length && <div><div className="text-[10px] font-mono uppercase tracking-widest text-text-mute mb-1">Frozen allocations</div>{d.allocations.map(a => <div key={a.id} className="flex justify-between text-xs border-b border-border-soft py-1"><span>{a.holderName} · {a.percentage}%</span><span className="font-mono">{a.amount.toLocaleString()} {a.status ?? ""}</span></div>)}</div>}
      {canWrite && <div className="flex flex-wrap gap-2 pt-1">{d.status === "draft" && <Button size="sm" variant="outline" disabled={!!busyAction} onClick={() => void runAction(d.id, "submit")}>Submit for approval</Button>}{d.status === "submitted" && <Button size="sm" disabled={!!busyAction} onClick={() => void runAction(d.id, "approve")}>Approve & freeze ownership snapshot</Button>}</div>}
    </Card>)}
  </section>;
}

function PendingOwnershipProposals({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, refetch } = useOwnershipGroup();
  const { data: me } = useAtelierGetMe();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState<string | null>(null);
  const pending = (x: { status?: string; approvalStatus?: string }) => (x.approvalStatus ?? x.status) === "pending";
  const groups = [
    ...(data?.structures ?? []).filter(pending).map(x => ({ ...x, kind: "Structure", endpoint: "structures", label: x.name ?? x.id })),
    ...(data?.links ?? []).filter(pending).map(x => ({ ...x, kind: "Structure link", endpoint: "links", label: x.id })),
    ...(data?.interests ?? []).filter(pending).map(x => ({ ...x, kind: "Economic interest", endpoint: "interests", label: String(x.stakeholderId ?? x.id) })),
    ...(data?.commercialRights ?? []).filter(pending).map(x => ({ ...x, kind: "Commercial right", endpoint: "commercial-rights", label: x.id })),
  ];
  async function act(endpoint: string, id: string, verb: "approve" | "reject") {
    setBusy(`${endpoint}:${id}:${verb}`);
    try {
      const response = await fetch(`/api/atelier/finance/ownership/${endpoint}/${encodeURIComponent(id)}/${verb}`, { method: "POST", credentials: "include", headers: { Accept: "application/json" } });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? body.error ?? `Request failed (${response.status})`);
      toast({ title: `Ownership proposal ${verb}d` }); await refetch();
    } catch (e) { toast({ title: `${verb[0].toUpperCase()}${verb.slice(1)} failed`, description: e instanceof Error ? e.message : "Request failed", variant: "destructive" }); }
    finally { setBusy(null); }
  }
  if (isLoading || !groups.length) return null;
  return <section className="space-y-3" data-testid="pending-ownership-proposals"><SectionLabel>Pending economic proposals</SectionLabel>{groups.map(p => {
    const maker = p.proposedBy === me?.id;
    const busyThis = busy?.startsWith(`${p.endpoint}:${p.id}:`);
    return <Card key={`${p.kind}-${p.id}`} className="p-3 flex flex-wrap items-center gap-3 text-xs"><div className="min-w-0 flex-1"><div className="text-text">{p.label}</div><div className="text-text-faint">{p.kind} · {maker ? "Proposed by you" : "Awaiting independent checker"}</div></div><MonoChip tone="amber">approval pending</MonoChip><Button size="sm" variant="outline" disabled={!canWrite || maker || busyThis} onClick={() => void act(p.endpoint, p.id, "approve")}>{maker ? "Approve unavailable (maker)" : "Approve"}</Button><Button size="sm" variant="ghost" disabled={!canWrite || maker || busyThis} onClick={() => void act(p.endpoint, p.id, "reject")}>{maker ? "Reject unavailable (maker)" : "Reject"}</Button></Card>;
  })}</section>;
}

function EconomicChangeProposal({ canWrite }: { canWrite: boolean }) {
  const { data, refetch } = useOwnershipGroup();
  const { toast } = useToast();
  const structures = (data?.structures ?? []).filter(x => (x.approvalStatus ?? x.status) === "approved");
  const stakeholders = data?.stakeholders ?? [];
  const [mode, setMode] = React.useState<"structure" | "link" | "interest" | "right">("structure");
  const [form, setForm] = React.useState<Record<string, string>>({ effectiveFrom: today(), effectiveTo: "" });
  const structureMutation = useOwnershipMutation("/finance/ownership/structures");
  const linkMutation = useOwnershipMutation("/finance/ownership/links");
  const interestMutation = useOwnershipMutation("/finance/ownership/interests");
  const rightMutation = useOwnershipMutation("/finance/ownership/commercial-rights");
  if (!canWrite) return null;
  const set = (key: string, value: string) => setForm(prev => ({ ...prev, [key]: value }));
  const input = (key: string, label: string, type = "text", placeholder?: string) => (
    <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">{label}
      <input className="mt-1 h-8 w-full rounded border border-border glass-surface px-2 text-xs" type={type} value={form[key] ?? ""} placeholder={placeholder} onChange={e => set(key, e.target.value)} />
    </label>
  );
  const select = (key: string, label: string, options: Array<{ value: string; label: string }>) => (
    <label className="text-[10px] font-mono uppercase tracking-widest text-text-mute">{label}
      <select className="mt-1 h-8 w-full rounded border border-border glass-surface px-2 text-xs" value={form[key] ?? ""} onChange={e => set(key, e.target.value)}>
        <option value="">Select…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const commonDates = <>{input("effectiveFrom", "Effective from", "date")}{input("effectiveTo", "Effective to (optional)", "date")}</>;
  async function submit() {
    const number = (key: string) => form[key] === "" || form[key] == null ? undefined : Number(form[key]);
    const pending = form.pendingTerms === "true";
    if (mode === "right" && pending && number("ratePct") != null) {
      toast({ title: "Pending terms cannot include a rate", variant: "destructive" }); return;
    }
    const bodies: Record<string, Record<string, unknown>> = {
      structure: { name: form.name, structureType: form.structureType, status: form.lifecycleStatus || "planned", lifecycleStatus: form.lifecycleStatus || "planned", country: form.country || undefined, jurisdiction: form.jurisdiction || undefined, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || undefined },
      link: { parentStructureId: form.parentStructureId, childStructureId: form.childStructureId, relationship: form.relationship || "owns", effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || undefined },
      interest: { structureId: form.structureId, stakeholderId: form.stakeholderId, legalPct: number("legalPct") ?? 0, votingPct: number("votingPct") ?? 0, profitPct: number("profitPct") ?? 0, shareClass: form.shareClass || undefined, sourceAgreementId: form.sourceAgreementId || undefined, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || undefined, pendingTerms: pending },
      right: { structureId: form.structureId, holderStakeholderId: form.stakeholderId, rightType: form.rightType, ratePct: number("ratePct"), basis: form.basis || undefined, territory: form.territory || undefined, agreementTerm: form.agreementTerm || undefined, effectiveFrom: form.effectiveFrom, effectiveTo: form.effectiveTo || undefined, pendingTerms: pending },
    };
    const mutation = { structure: structureMutation, link: linkMutation, interest: interestMutation, right: rightMutation }[mode];
    try {
      await mutation.mutateAsync(bodies[mode]); await refetch();
      setForm({ effectiveFrom: today(), effectiveTo: "" });
      toast({ title: "Submitted for independent approval" });
    } catch (e) { toast({ title: "Proposal failed", description: e instanceof Error ? e.message : "Request failed", variant: "destructive" }); }
  }
  const structureOptions = structures.map(s => ({ value: s.id, label: s.name ?? s.id }));
  const stakeholderOptions = stakeholders.map(s => ({ value: s.id, label: s.label ?? s.id }));
  return <Card className="p-4 space-y-3" data-testid="economic-change-proposal">
    <div className="flex items-center justify-between gap-2"><div><SectionLabel>Propose economic change</SectionLabel><p className="text-[11px] text-text-faint mt-1">Every amendment creates a new effective-dated version; existing history is never overwritten.</p></div><MonoChip tone="amber">independent approval</MonoChip></div>
    <div className="flex flex-wrap gap-1">{([["structure", "Structure"], ["link", "Structure link / successor"], ["interest", "Ownership interest"], ["right", "Commercial right / franchise"]] as const).map(([value, label]) => <button key={value} type="button" className={`px-2 py-1 rounded border text-[10px] font-mono ${mode === value ? "border-gold text-gold" : "border-border text-text-mute"}`} onClick={() => setMode(value)}>{label}</button>)}</div>
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
      {mode === "structure" && <>{input("name", "Name")}{select("structureType", "Structure type", [{ value: "holding", label: "Holding" }, { value: "entity", label: "Entity" }, { value: "territory", label: "Territory" }, { value: "franchise", label: "Franchise" }])}{select("lifecycleStatus", "Lifecycle status", [{ value: "planned", label: "Planned" }, { value: "incorporated", label: "Incorporated" }, { value: "franchise_operated", label: "Franchise-operated" }])}{input("country", "Country (optional)")}{input("jurisdiction", "Jurisdiction (optional)")} {commonDates}</>}
      {mode === "link" && <>{select("parentStructureId", "Approved parent", structureOptions)}{select("childStructureId", "Approved child", structureOptions)}{input("relationship", "Relationship", "text", "owns / succeeds")} {commonDates}</>}
      {mode === "interest" && <>{select("structureId", "Approved structure", structureOptions)}{select("stakeholderId", "Stakeholder", stakeholderOptions)}{input("legalPct", "Legal %", "number", "0")}{input("votingPct", "Voting/control %", "number", "0")}{input("profitPct", "Profit %", "number", "0")}{input("shareClass", "Share class (optional)")}{input("sourceAgreementId", "Source agreement (optional)")} {commonDates}</>}
      {mode === "right" && <>{select("structureId", "Approved structure", structureOptions)}{select("stakeholderId", "Stakeholder", stakeholderOptions)}{input("rightType", "Right type", "text", "royalty / sponsor")} {input("ratePct", "Rate % (optional)", "number", "0")}{input("basis", "Basis (optional)")}{input("territory", "Territory (optional)")}{input("agreementTerm", "Agreement term (optional)")}{select("pendingTerms", "Terms", [{ value: "false", label: "Terms supplied" }, { value: "true", label: "Terms pending" }])} {commonDates}</>}
    </div>
    <div className="flex justify-end"><Button size="sm" disabled={(["structure", "link", "interest", "right"].some(kind => kind === mode) && ((mode === "structure" && (!form.name || !form.structureType || !form.lifecycleStatus || !form.effectiveFrom)) || (mode === "link" && (!form.parentStructureId || !form.childStructureId || !form.effectiveFrom)) || (mode === "interest" && (!form.structureId || !form.stakeholderId || !form.effectiveFrom)) || (mode === "right" && (!form.structureId || !form.stakeholderId || !form.rightType || !form.effectiveFrom))))} onClick={() => void submit()}>Submit proposal</Button></div>
  </Card>;
}

export default function OwnershipPanel({ canWrite = false }: { canWrite?: boolean }) {
  const [asOf, setAsOf] = React.useState(today);
  const { data, isLoading, isError } = useOwnership(asOf);
  const entities = data?.entities ?? [];
  return <div className="space-y-6" data-testid="ownership-panel">
    <div className="flex flex-wrap items-end gap-3"><div><Eyebrow>Normalized economics</Eyebrow><h2 className="text-lg text-text mt-1">Group ownership & distributions</h2></div><label className="ml-auto text-[10px] font-mono uppercase tracking-widest text-text-mute">As of<input className="ml-2 h-8 rounded border border-border glass-surface px-2 text-xs" type="date" value={asOf} onChange={e => setAsOf(e.target.value)} /></label></div>
    {isLoading && <Card className="p-5 text-sm text-text-mute">Loading group structure…</Card>}
    {isError && <Card className="p-5 text-sm text-warning">Ownership data is unavailable. Confirm Finance access or try again.</Card>}
    {!isLoading && !isError && !entities.length && <Card className="p-5 text-sm text-text-mute">No normalized ownership records for this date.</Card>}
    {(data?.warnings ?? []).length > 0 && <Card className="p-4 border-warning/40 bg-warning/5 text-xs text-warning"><AlertTriangle className="inline w-3 h-3 mr-1" />{data?.warnings.join(" · ")}</Card>}
    <div className="grid lg:grid-cols-2 gap-4">{entities.map(e => <EntityOwnershipCard key={e.id} entity={e} asOf={asOf} />)}</div>
    <EconomicChangeProposal canWrite={canWrite} />
    <PendingOwnershipProposals canWrite={canWrite} />
    <DistributionsPanel canWrite={canWrite} />
  </div>;
}

export function PersonOwnershipSection({ personId }: { personId: string }) {
  const { data, isLoading } = useOwnershipPerson(personId);
  if (isLoading) return <Card className="p-4 text-sm text-text-mute">Loading ownership interests…</Card>;
  if (!data || (!data.directInterests.length && !data.lookThrough.length)) return null;
  return <Card className="p-4 md:col-span-2 space-y-3" data-testid="person-ownership-section"><div className="flex items-center gap-2"><SectionLabel>Ownership & profit rights</SectionLabel><ArrowUpRight className="w-3 h-3 text-gold" /></div><StakeTable stakes={data.directInterests} />{data.lookThrough.length > 0 && <div><div className="text-[10px] font-mono uppercase tracking-widest text-text-mute mb-1">Look-through beneficial interests</div>{data.lookThrough.map((i, n) => <div key={`${i.entityId}-${n}`} className="flex justify-between text-xs py-1 border-b border-border-soft"><span>{i.entityName}</span><span className="font-mono">{pct(i.profitParticipationPct)} profit · {pct(i.votingControlPct)} control</span></div>)}</div>}{data.pendingTerms.map(t => <p key={t} className="text-xs text-warning">{t}</p>)}</Card>;
}