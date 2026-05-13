import * as React from "react";
import { Card, MonoChip, PageHero, PillButton, SectionHead, TabNav, TabNavLink } from "@/components/ui/primitives";

interface ContractorPayment {
  id: string;
  payeeUserId: string;
  payeeName: string;
  payeePersonType: string;
  engagementId: string;
  weekIso: string;
  hours: number;
  ratePerHour: number;
  rateCurrency: string;
  costAmount: number;
  costCurrency: string;
  usdAmount: number;
  status: string;
  requiresPartnerApproval: boolean;
  evidenceEntryIds: string[];
}
interface PartnerFirmInvoice {
  id: string;
  partnerFirmId: string;
  partnerFirmName: string;
  engagementId: string;
  weekIso: string;
  hours: number;
  costAmount: number;
  costCurrency: string;
  usdAmount: number;
  status: string;
  evidenceFirmHourIds: string[];
}
interface ContractorPayeeGroup {
  payeeUserId: string;
  payeeName: string;
  totalUsd: number;
  weekCount: number;
  rows: ContractorPayment[];
}
interface PartnerFirmGroup {
  partnerFirmId: string;
  partnerFirmName: string;
  totalUsd: number;
  weekCount: number;
  rows: PartnerFirmInvoice[];
}
interface ApprovalsResp {
  contractorPayments: ContractorPayment[];
  partnerFirmInvoices: PartnerFirmInvoice[];
  contractorPayeeGroups: ContractorPayeeGroup[];
  partnerFirmGroups: PartnerFirmGroup[];
  totals: {
    contractorCount: number;
    partnerFirmCount: number;
    contractorPayeeCount: number;
    partnerFirmPayeeCount: number;
    contractorUsd: number;
    partnerFirmUsd: number;
  };
}
interface Me { id: string; name: string; role: string }

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export default function WalletApprovals() {
  const [me, setMe] = React.useState<Me | null>(null);
  const [data, setData] = React.useState<ApprovalsResp | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [statusFilter, setStatusFilter] = React.useState<string>("proposed");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [msg, setMsg] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const meR = await fetch("/api/atelier/me", { credentials: "include" }).then((r) => r.json());
      setMe(meR);
      const r = await fetch(`/api/atelier/wallet/approvals?status=${statusFilter}`, { credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  React.useEffect(() => { void load(); }, [load]);

  async function runProposer() {
    setBusy("run");
    setMsg(null);
    try {
      const r = await fetch("/api/atelier/wallet/approvals/run", { method: "POST", credentials: "include" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`Composer: ${j.summary.contractorProposals.created} contractor + ${j.summary.partnerFirmProposals.created} partner-firm proposal(s).`);
      await load();
    } catch (e) {
      setMsg(`Run failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function decide(kind: "contractor" | "partner-firm", id: string, action: "approve" | "reject") {
    const rationale = action === "approve" ? prompt("Approval rationale (optional):") || "" : "";
    const reason = action === "reject" ? prompt("Rejection reason:") || "rejected" : "";
    setBusy(`${id}-${action}`);
    setMsg(null);
    try {
      const r = await fetch(
        `/api/atelier/wallet/approvals/${kind}/${id}/${action}`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "approve" ? { rationale } : { reason }),
        },
      );
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const isPartner = me?.role === "partner";

  return (
    <div className="min-h-screen bg-bg text-text">
      <PageHero>
        <SectionHead
          eyebrow={<MonoChip tone="gold">WALLET</MonoChip>}
          headline="Payment approvals"
          lede="Weekly contractor and partner-firm payment proposals composed by the Payment Proposer agent. Partner sign-off required for amounts over $250 and for all partner-firm invoices."
        />
      </PageHero>
      <TabNav>
        <TabNavLink href="/wallet" active={false}>Expenses</TabNavLink>
        <TabNavLink href="/wallet/approvals" active>Approvals</TabNavLink>
        <TabNavLink href="/wallet/cards" active={false}>Cards</TabNavLink>
      </TabNav>

      <div className="px-6 py-4 max-w-7xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-bg-elevate border border-border rounded px-2 py-1"
            data-testid="select-status"
          >
            <option value="proposed">Proposed</option>
            <option value="partner_approved">Partner-approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Rejected</option>
          </select>
          {isPartner && (
            <PillButton onClick={runProposer} disabled={busy === "run"} data-testid="btn-run-proposer">
              {busy === "run" ? "Running…" : "Run Payment Proposer"}
            </PillButton>
          )}
          {data && (
            <span className="text-text-mute">
              {data.totals.contractorCount} contractor ({fmtUsd(data.totals.contractorUsd)}) ·{" "}
              {data.totals.partnerFirmCount} partner-firm ({fmtUsd(data.totals.partnerFirmUsd)})
            </span>
          )}
        </div>

        {msg && <Card className="p-3 text-sm border-gold/40 text-gold">{msg}</Card>}
        {loading && <Card className="p-4 text-text-mute">Loading…</Card>}

        {data && data.contractorPayeeGroups.length > 0 && (
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-text-mute">
              Contractor payments · {data.totals.contractorPayeeCount} payee(s)
            </h3>
            {data.contractorPayeeGroups.map((g) => (
              <div key={g.payeeUserId} className="border-t border-border/50 pt-3 space-y-2" data-testid={`group-cp-${g.payeeUserId}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{g.payeeName}</div>
                    <div className="text-xs font-mono text-text-mute">{g.weekCount} week(s) · contractor</div>
                  </div>
                  <div className="font-mono text-text text-right">{fmtUsd(g.totalUsd)}</div>
                </div>
                <div className="pl-3 space-y-1">
                  {g.rows.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`row-cp-${p.id}`}>
                      <div className="text-xs font-mono text-text-mute">
                        {p.weekIso} · {p.hours.toFixed(1)} hrs × {fmtUsd(p.ratePerHour)}/hr · eng {p.engagementId.slice(0, 12)}…
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <div className="font-mono">{fmtUsd(p.usdAmount)}</div>
                        <div className="flex gap-1 justify-end">
                          <MonoChip tone={p.status === "proposed" ? "gold" : p.status === "partner_approved" ? "green" : p.status === "rejected" ? "red" : undefined}>{p.status}</MonoChip>
                          {p.requiresPartnerApproval && p.status === "proposed" && <MonoChip tone="gold">partner-required</MonoChip>}
                        </div>
                        {isPartner && p.status === "proposed" && (
                          <div className="flex gap-2 justify-end">
                            <PillButton onClick={() => decide("contractor", p.id, "approve")} disabled={!!busy} data-testid={`btn-approve-${p.id}`}>Approve</PillButton>
                            <PillButton onClick={() => decide("contractor", p.id, "reject")} disabled={!!busy} data-testid={`btn-reject-${p.id}`}>Reject</PillButton>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        {data && data.partnerFirmGroups.length > 0 && (
          <Card className="p-4 space-y-4">
            <h3 className="text-sm font-semibold text-text-mute">
              Partner-firm invoices · {data.totals.partnerFirmPayeeCount} firm(s)
            </h3>
            {data.partnerFirmGroups.map((g) => (
              <div key={g.partnerFirmId} className="border-t border-border/50 pt-3 space-y-2" data-testid={`group-pfi-${g.partnerFirmId}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{g.partnerFirmName}</div>
                    <div className="text-xs font-mono text-text-mute">{g.weekCount} week(s)</div>
                  </div>
                  <div className="font-mono text-text text-right">{fmtUsd(g.totalUsd)}</div>
                </div>
                <div className="pl-3 space-y-1">
                  {g.rows.map((p) => (
                    <div key={p.id} className="flex items-start justify-between gap-3 text-sm" data-testid={`row-pfi-${p.id}`}>
                      <div className="text-xs font-mono text-text-mute">
                        {p.weekIso} · {p.hours.toFixed(1)} hrs · eng {p.engagementId.slice(0, 12)}…
                      </div>
                      <div className="text-right shrink-0 space-y-1">
                        <div className="font-mono">{fmtUsd(p.usdAmount)} <span className="text-xs text-text-mute">({p.costCurrency} {p.costAmount.toFixed(2)})</span></div>
                        <div className="flex gap-1 justify-end">
                          <MonoChip tone={p.status === "proposed" ? "gold" : p.status === "partner_approved" ? "green" : p.status === "rejected" ? "red" : undefined}>{p.status}</MonoChip>
                          <MonoChip tone="gold">partner-required</MonoChip>
                        </div>
                        {isPartner && p.status === "proposed" && (
                          <div className="flex gap-2 justify-end">
                            <PillButton onClick={() => decide("partner-firm", p.id, "approve")} disabled={!!busy} data-testid={`btn-approve-pfi-${p.id}`}>Approve</PillButton>
                            <PillButton onClick={() => decide("partner-firm", p.id, "reject")} disabled={!!busy} data-testid={`btn-reject-pfi-${p.id}`}>Reject</PillButton>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        )}

        {data && data.contractorPayments.length === 0 && data.partnerFirmInvoices.length === 0 && !loading && (
          <Card className="p-8 text-center text-text-mute border-dashed">
            No proposals at status <span className="font-mono">{statusFilter}</span>.
          </Card>
        )}
      </div>
    </div>
  );
}
