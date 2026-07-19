/**
 * FinancePayables — Procure-to-pay surfaces (Task #418, Wave 6).
 *
 * Five sub-pages under /finance/payables/*:
 *   - vendors         — vendor master with KYC/BO/sanctions/bank change controls
 *   - po              — purchase orders + lines + GRNs + 3-way match status
 *   - payment-runs    — maker-checker + dual-signatory enforcement + bank-file
 *   - wht             — withholding-tax certificate register + remittance summary
 *   - subcontractors  — pay-when-paid links between subcontractor invoices and AR
 *
 * All data comes from the seed-only API (`/api/atelier/finance/payables/*`)
 * exposed by `financePayablesRoutes.ts`.
 */

import * as React from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";
import {
  usePayablesVendors,
  usePayablesPos,
  usePayablesInvoices,
  usePayablesRuns,
  useWhtRegister,
  useSubcontractors,
  usePayablesAudit,
  postJson,
  type VendorRow2,
  type PoRow,
  type VendorInvoiceRow,
  type PaymentRunRow,
} from "@/lib/v5-hooks";

function useInvalidatePayables() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    for (const k of ["pay-vendors", "pay-pos", "pay-invoices", "pay-runs", "pay-wht", "pay-subs", "pay-disb", "pay-stalled", "pay-audit"]) {
      qc.invalidateQueries({ queryKey: ["atelier-v5", k] });
    }
  }, [qc]);
}

function useMutate() {
  const invalidate = useInvalidatePayables();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useCallback(async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setError(null);
    try { await fn(); invalidate(); } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }, [invalidate]);
  return { busy, error, run };
}

const TABS = [
  { id: "vendors", label: "Vendors", href: "/finance/payables/vendors" },
  { id: "po", label: "Purchase orders", href: "/finance/payables/po" },
  { id: "payment-runs", label: "Payment runs", href: "/finance/payables/payment-runs" },
  { id: "wht", label: "WHT register", href: "/finance/payables/wht" },
  { id: "subcontractors", label: "Subcontractors", href: "/finance/payables/subcontractors" },
];

function fmtUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function EmptyCard({ children, testId }: { children: React.ReactNode; testId: string }) {
  return (
    <Card className="p-6 text-center" data-testid={testId}>
      <p className="text-sm text-text-mute">{children}</p>
    </Card>
  );
}

function PayablesShell({
  eyebrow,
  headline,
  lede,
  children,
}: {
  eyebrow: string;
  headline: string;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-in fade-in">
      <PageHero>
        <SectionHead eyebrow={eyebrow} headline={headline} lede={lede} />
        <div className="mt-6">
          <SubSectionTabs tabs={TABS} data-testid="finance-payables-tabs" />
        </div>
      </PageHero>
      <div className="container-atelier py-10 space-y-6">{children}</div>
    </div>
  );
}

// ============================================================
// Vendors
// ============================================================
function sanctionsTone(r: VendorRow2["sanctions"]["result"]): "default" | "amber" | "red" | "green" {
  if (r === "blocked") return "red";
  if (r === "match_review") return "amber";
  return "green";
}

function statusTone(s: VendorRow2["status"]): "default" | "amber" | "red" | "green" {
  if (s === "blocked") return "red";
  if (s === "on_hold") return "amber";
  return "green";
}

export function FinancePayablesVendors() {
  const vendors = usePayablesVendors();
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Vendors"
      headline="Vendor master"
      lede="KYC, beneficial ownership, sanctions screen, and bank-detail change controls. Bank-detail changes require maker-checker plus an out-of-band confirmation before the new account is paid."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{vendors.length} vendor(s)</MonoChip>
        <MonoChip tone={vendors.some((v) => v.sanctions.result === "match_review") ? "amber" : "default"}>
          {vendors.filter((v) => v.sanctions.result !== "clear").length} sanctions flag(s)
        </MonoChip>
        <MonoChip tone={vendors.some((v) => v.bankAccounts.some((ba) => ba.pendingChange)) ? "amber" : "default"}>
          {vendors.reduce((n, v) => n + v.bankAccounts.filter((ba) => ba.pendingChange).length, 0)} bank-change pending
        </MonoChip>
      </div>
      <div className="grid gap-3" data-testid="vendors-list">
        {vendors.length === 0 && (
          <EmptyCard testId="vendors-empty">No vendors yet. Vendors will appear here once they are onboarded.</EmptyCard>
        )}
        {vendors.map((v) => (
          <Card key={v.id} className="p-4" data-testid={`vendor-${v.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow>{v.category.replace(/_/g, " ")} · {v.country}</Eyebrow>
                <div className="text-base font-medium mt-1">{v.legalName}</div>
                <div className="text-xs text-text-mute mt-1">{v.jurisdiction} · CR {v.registeredEntityId} · terms net {v.paymentTermsDays}d</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <MonoChip tone={statusTone(v.status)}>{v.status}</MonoChip>
                <MonoChip tone={sanctionsTone(v.sanctions.result)}>
                  sanctions: {v.sanctions.result.replace("_", " ")} ({v.sanctions.list})
                </MonoChip>
                {v.isSubcontractor && <MonoChip>subcontractor</MonoChip>}
              </div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3 mt-4 text-xs">
              <div>
                <Eyebrow>Beneficial ownership</Eyebrow>
                <ul className="mt-1.5 space-y-0.5">
                  {v.beneficialOwners.map((bo) => (
                    <li key={bo.id} className="text-text-mute">
                      <span className="text-text">{bo.name}</span> — {bo.pctOwnership}% · {bo.nationality}
                      {bo.isPep && <span className="ml-1 text-amber-500">PEP</span>}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <Eyebrow>Tax</Eyebrow>
                <div className="mt-1.5 text-text-mute space-y-0.5">
                  <div>VAT: <span className="text-text font-mono">{v.taxIds.vat ?? "—"}</span></div>
                  <div>Corp: <span className="text-text font-mono">{v.taxIds.corporate ?? "—"}</span></div>
                  <div>WHT default: <span className="text-text">{(v.defaultWhtPct * 100).toFixed(0)}%</span></div>
                </div>
              </div>
              <div>
                <Eyebrow>Sanctions</Eyebrow>
                <div className="mt-1.5 text-text-mute">
                  Last checked {v.sanctions.lastCheckedAt}
                  {v.sanctions.notes && <div className="mt-1 text-amber-600">{v.sanctions.notes}</div>}
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <Eyebrow>Bank accounts</Eyebrow>
              {v.bankAccounts.map((ba) => (
                <div key={ba.id} className="border border-border-soft rounded p-3 text-xs">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div>
                      <span className="font-medium">{ba.bank}</span>
                      <span className="text-text-mute ml-2">· {ba.currency}</span>
                      {ba.primary && <MonoChip className="ml-2">primary</MonoChip>}
                    </div>
                    <span className="font-mono text-text-mute">{ba.iban}</span>
                  </div>
                  <div className="text-text-mute mt-1">SWIFT {ba.swift} · holder: {ba.accountHolder}</div>
                  {ba.pendingChange && (
                    <div className="mt-2 border border-amber-500/40 bg-amber-500/5 rounded p-2 space-y-1">
                      <div className="flex items-center gap-2">
                        <MonoChip tone="amber">bank change · {ba.pendingChange.status.replace(/_/g, " ")}</MonoChip>
                        <span className="text-text-mute">{ba.pendingChange.fieldChanged}</span>
                      </div>
                      <div className="text-text-mute">
                        <span className="line-through">{ba.pendingChange.oldValue}</span> → <span className="text-text font-mono">{ba.pendingChange.newValue}</span>
                      </div>
                      <div className="text-text-mute">
                        Requested by {ba.pendingChange.requestedBy} on {ba.pendingChange.requestedAt} · {ba.pendingChange.reason}
                      </div>
                      <div className="text-text-mute">
                        OOB: {ba.pendingChange.oobConfirmation.method.replace(/_/g, " ")} · {ba.pendingChange.oobConfirmation.contactName}
                        {ba.pendingChange.oobConfirmation.confirmedAt
                          ? ` · confirmed ${ba.pendingChange.oobConfirmation.confirmedAt} by ${ba.pendingChange.oobConfirmation.confirmedBy}`
                          : " · awaiting OOB confirmation"}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="text-xs text-text-mute mt-3">{v.notes}</div>
          </Card>
        ))}
      </div>
    </PayablesShell>
  );
}

// ============================================================
// Purchase Orders + 3-way match
// ============================================================
function poStatusTone(s: PoRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "received" || s === "closed") return "green";
  if (s === "partially_received" || s === "approved" || s === "open") return "amber";
  if (s === "cancelled") return "red";
  return "default";
}
function invStatusTone(s: VendorInvoiceRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "approved_for_payment") return "green";
  if (s === "exception" || s === "rejected") return "red";
  if (s === "scheduled" || s === "matched" || s === "on_hold_pwp") return "amber";
  return "default";
}

export function FinancePayablesPo() {
  const pos = usePayablesPos();
  const invoices = usePayablesInvoices();
  const invByPo = React.useMemo(() => {
    const m = new Map<string, VendorInvoiceRow[]>();
    for (const inv of invoices) {
      if (!inv.poId) continue;
      const arr = m.get(inv.poId) ?? [];
      arr.push(inv);
      m.set(inv.poId, arr);
    }
    return m;
  }, [invoices]);
  const nonPo = invoices.filter((i) => !i.poId);
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Purchase orders"
      headline="Purchase orders & 3-way match"
      lede="POs with line items and goods-receipt notes (GRNs). Vendor invoices match against (PO line price) and (cumulative receipted quantity); exceptions surface here for review."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{pos.length} PO(s)</MonoChip>
        <MonoChip tone={invoices.some((i) => i.status === "exception") ? "amber" : "default"}>
          {invoices.filter((i) => i.status === "exception").length} match exception(s)
        </MonoChip>
        <MonoChip>{nonPo.length} non-PO invoice(s)</MonoChip>
      </div>
      <div className="grid gap-3" data-testid="po-list">
        {pos.length === 0 && (
          <EmptyCard testId="po-empty">No purchase orders yet. POs and 3-way match results will appear here.</EmptyCard>
        )}
        {pos.map((po) => {
          const linkedInvs = invByPo.get(po.id) ?? [];
          return (
            <Card key={po.id} className="p-4" data-testid={`po-${po.id}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <Eyebrow>{po.number} · {po.currency}</Eyebrow>
                  <div className="text-base font-medium mt-1">{po.description}</div>
                  <div className="text-xs text-text-mute mt-1">
                    Buyer: {po.buyerEntityId} · created by {po.createdBy} on {po.createdAt}
                    {po.engagementName && <> · engagement: <Link href={`/clients/deliver/engagements/${po.engagementId}`} className="text-gold hover:underline">{po.engagementName}</Link></>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1.5">
                  <MonoChip tone={poStatusTone(po.status)}>{po.status.replace(/_/g, " ")}</MonoChip>
                  <span className="font-mono text-sm">{fmtUsd(po.totalUsd)}</span>
                </div>
              </div>
              <div className="mt-3">
                <table className="w-full text-xs">
                  <thead className="text-text-faint">
                    <tr><th className="text-left py-1">Line</th><th className="text-right">Qty</th><th className="text-right">Recv</th><th className="text-right">Inv</th><th className="text-right">Unit USD</th></tr>
                  </thead>
                  <tbody>
                    {po.lines.map((l) => (
                      <tr key={l.id} className="border-t border-border-soft">
                        <td className="py-1.5">{l.description} <span className="text-text-faint">({l.uom})</span></td>
                        <td className="text-right font-mono">{l.quantity}</td>
                        <td className={`text-right font-mono ${l.receivedQuantity < l.quantity ? "text-amber-500" : ""}`}>{l.receivedQuantity}</td>
                        <td className="text-right font-mono">{l.invoicedQuantity}</td>
                        <td className="text-right font-mono">{fmtUsd(l.unitPriceUsd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {po.goodsReceipts.length > 0 && (
                <div className="mt-3 text-xs">
                  <Eyebrow>Goods receipts</Eyebrow>
                  <ul className="mt-1.5 space-y-1">
                    {po.goodsReceipts.map((g) => (
                      <li key={g.id} className="text-text-mute">
                        <span className="font-mono">{g.id}</span> · {g.receivedAt} · {g.receivedBy}
                        {g.notes && <span className="ml-2 text-text-faint">— {g.notes}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {linkedInvs.length > 0 && (
                <div className="mt-3 text-xs">
                  <Eyebrow>Invoices · 3-way match</Eyebrow>
                  <div className="mt-1.5 space-y-1.5">
                    {linkedInvs.map((inv) => (
                      <InvoiceMatchRow key={inv.id} inv={inv} />
                    ))}
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
      {nonPo.length > 0 && (
        <Card className="p-4">
          <Eyebrow>Non-PO invoices</Eyebrow>
          <p className="text-xs text-text-mute mt-1">No PO matched. Higher scrutiny required before approval.</p>
          <div className="mt-3 space-y-1.5 text-xs">
            {nonPo.map((inv) => (
              <InvoiceMatchRow key={inv.id} inv={inv} />
            ))}
          </div>
        </Card>
      )}
      <AuditTrailPanel />
    </PayablesShell>
  );
}

function InvoiceMatchRow({ inv }: { inv: VendorInvoiceRow }) {
  const { busy, error, run } = useMutate();
  const onMatch = () => run(`m:${inv.id}`, () => postJson(`/finance/payables/invoices/${inv.id}/match`, {}));
  const onApprove = () => run(`a:${inv.id}`, () => postJson(`/finance/payables/invoices/${inv.id}/approve`, {}));
  const onOverride = () => {
    const reason = window.prompt(`Tolerance override for ${inv.number}. Reason?`);
    if (!reason) return;
    run(`o:${inv.id}`, () => postJson(`/finance/payables/invoices/${inv.id}/override`, { reason }));
  };
  return (
    <div className="border border-border-soft rounded px-2 py-1.5" data-testid={`inv-row-${inv.id}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono">{inv.number}</span>
          <MonoChip tone={invStatusTone(inv.status)}>{inv.status.replace(/_/g, " ")}</MonoChip>
          <span className="text-text-mute">match: {inv.match.outcome.replace(/_/g, " ")}</span>
          {inv.match.notes && <span className="text-text-faint italic">— {inv.match.notes}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onMatch} disabled={!!busy} data-testid={`btn-match-${inv.id}`}>
            {busy === `m:${inv.id}` ? "…" : "Run match"}
          </Button>
          {inv.status === "exception" && (
            <Button size="sm" variant="outline" onClick={onOverride} disabled={!!busy} data-testid={`btn-override-${inv.id}`}>Override</Button>
          )}
          {(inv.status === "matched" || inv.status === "exception") && (
            <Button size="sm" onClick={onApprove} disabled={!!busy} data-testid={`btn-approve-${inv.id}`}>Approve</Button>
          )}
          <span className="font-mono ml-2">{fmtUsd(inv.netPayableUsd)}</span>
        </div>
      </div>
      {error && <div className="text-xs text-danger mt-1">⚠ {error}</div>}
    </div>
  );
}

// ============================================================
// Payment runs (maker-checker + dual signatories)
// ============================================================
function runStatusTone(s: PaymentRunRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "exported") return "green";
  if (s === "rejected") return "red";
  if (s === "draft" || s === "pending_checker" || s === "pending_signatories" || s === "approved") return "amber";
  return "default";
}

export function FinancePayablesPaymentRuns() {
  const runs = usePayablesRuns();
  const { busy, error, run } = useMutate();
  const [info, setInfo] = React.useState<string | null>(null);
  const onBuild = async () => {
    setInfo(null);
    await run("build", async () => {
      const r = await postJson<{ run: { number: string; invoiceCount: number; totalUsd: number }; eligibleCount: number; excluded: Array<{ invoiceId: string; reason: string }> }>(
        "/finance/payables/payment-runs/build",
        {},
      );
      setInfo(`Built ${r.run.number} — ${r.run.invoiceCount} invoice(s) · $${r.run.totalUsd.toLocaleString()} (excluded ${r.excluded.length}).`);
    });
  };
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Payment runs"
      headline="Payment runs"
      lede="Maker proposes the run; an independent checker (Finance leader, not the maker) approves it; then each required bank signatory signs in turn before a bank-file is generated for export."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <MonoChip>{runs.length} run(s)</MonoChip>
        <MonoChip tone={runs.some((r) => r.status === "pending_signatories") ? "amber" : "default"}>
          {runs.filter((r) => r.status === "pending_signatories").length} awaiting signatures
        </MonoChip>
        <div className="ml-auto flex items-center gap-2">
          {info && <span className="text-text-mute normal-case font-sans text-xs">{info}</span>}
          <Button size="sm" onClick={onBuild} disabled={!!busy} data-testid="btn-build-run">
            {busy === "build" ? "Building…" : "Build new run"}
          </Button>
        </div>
      </div>
      {error && <div className="text-xs text-danger">⚠ {error}</div>}
      <div className="grid gap-3" data-testid="runs-list">
        {runs.length === 0 && (
          <EmptyCard testId="runs-empty">No payment runs yet. Build a run once there are approved invoices to pay.</EmptyCard>
        )}
        {runs.map((run) => (
          <Card key={run.id} className="p-4" data-testid={`run-${run.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow>{run.number}</Eyebrow>
                <div className="text-base font-medium mt-1">Scheduled {run.scheduledFor} · {run.invoiceCount} invoice(s)</div>
                <div className="text-xs text-text-mute mt-1">{run.notes}</div>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <MonoChip tone={runStatusTone(run.status)}>{run.status.replace(/_/g, " ")}</MonoChip>
                <span className="font-mono text-sm">{fmtUsd(run.totalUsd)}</span>
              </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4 mt-4 text-xs">
              <div>
                <Eyebrow>Maker / Checker</Eyebrow>
                <div className="mt-1.5 space-y-0.5 text-text-mute">
                  <div>Maker: <span className="text-text">{run.makerName}</span> · {run.createdAt}</div>
                  <div>
                    Checker:{" "}
                    {run.checkerName ? (
                      <span className="text-text">{run.checkerName}</span>
                    ) : (
                      <span className="text-amber-500">awaiting checker</span>
                    )}
                    {run.checkedAt && ` · ${run.checkedAt}`}
                  </div>
                  {run.makerName === run.checkerName && run.checkerName && (
                    <div className="text-danger">⚠ maker = checker (segregation breach)</div>
                  )}
                </div>
              </div>
              <div>
                <Eyebrow>Required signatories ({run.requiredSignatures.filter((s) => s.signedAt).length}/{run.requiredSignatures.length})</Eyebrow>
                <ul className="mt-1.5 space-y-0.5">
                  {run.requiredSignatures.map((s) => (
                    <li key={s.signatoryId} className="text-text-mute">
                      <span className="text-text">{s.signatoryName}</span>
                      <MonoChip className="ml-1.5">authority {s.authorityLevel}</MonoChip>
                      {s.signedAt ? (
                        <MonoChip tone="green" className="ml-1">signed {s.signedAt}</MonoChip>
                      ) : (
                        <MonoChip tone="amber" className="ml-1">pending</MonoChip>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="mt-4 text-xs">
              <Eyebrow>Batches (entity · bank · currency)</Eyebrow>
              <table className="w-full mt-1.5">
                <thead className="text-text-faint">
                  <tr><th className="text-left py-1">Batch</th><th className="text-left">Entity</th><th className="text-left">Bank account</th><th className="text-left">Ccy</th><th className="text-right">Count</th><th className="text-right">Total USD</th></tr>
                </thead>
                <tbody>
                  {run.batches.map((b) => (
                    <tr key={b.id} className="border-t border-border-soft">
                      <td className="py-1.5 font-mono">{b.id}</td>
                      <td>{b.entityId}</td>
                      <td className="font-mono">{b.bankAccountId}</td>
                      <td>{b.currency}</td>
                      <td className="text-right font-mono">{b.count}</td>
                      <td className="text-right font-mono">{fmtUsd(b.totalUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {run.bankFile && (
              <div className="mt-3 text-xs">
                <Eyebrow>Bank file</Eyebrow>
                <div className="mt-1 font-mono text-text-mute">
                  {run.bankFile.filename} · {run.bankFile.format} · {run.bankFile.lines} lines
                </div>
                <pre className="mt-1 p-2 bg-surface-2 rounded font-mono text-[10px] text-text-mute overflow-x-auto">{run.bankFile.previewBytes}</pre>
              </div>
            )}
          </Card>
        ))}
      </div>
    </PayablesShell>
  );
}

// ============================================================
// WHT register
// ============================================================
function whtTone(s: string): "default" | "amber" | "green" | "red" {
  if (s === "acknowledged") return "green";
  if (s === "pending") return "amber";
  return "default";
}

export function FinancePayablesWht() {
  const { items, remittance } = useWhtRegister();
  const totalPending = items.filter((c) => c.status === "pending").reduce((n, c) => n + c.whtUsd, 0);
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · WHT register"
      headline="Withholding-tax register"
      lede="Each subcontractor / non-resident invoice withheld at source is tracked from accrual through certificate issue, vendor-send, vendor-acknowledge, and remittance to the relevant tax authority."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{items.length} certificate(s)</MonoChip>
        <MonoChip tone={totalPending > 0 ? "amber" : "default"}>
          {fmtUsd(totalPending)} pending issuance
        </MonoChip>
      </div>
      <Card className="p-4">
        <Eyebrow>Per-jurisdiction remittance</Eyebrow>
        <table className="w-full mt-3 text-xs" data-testid="wht-remittance">
          <thead className="text-text-faint">
            <tr><th className="text-left py-1">Jurisdiction</th><th className="text-left">Period</th><th className="text-left">Due</th><th className="text-right">Certs</th><th className="text-right">Total USD</th></tr>
          </thead>
          <tbody>
            {remittance.length === 0 && (
              <tr className="border-t border-border-soft" data-testid="wht-remittance-empty">
                <td colSpan={5} className="py-3 text-center text-text-mute">No remittance obligations yet.</td>
              </tr>
            )}
            {remittance.map((r) => (
              <tr key={`${r.jurisdiction}-${r.period}`} className="border-t border-border-soft">
                <td className="py-1.5">{r.jurisdiction}</td>
                <td className="font-mono">{r.period}</td>
                <td className="font-mono">{r.dueAt}</td>
                <td className="text-right font-mono">{r.certCount}</td>
                <td className="text-right font-mono">{fmtUsd(r.whtUsd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <Eyebrow>Certificates</Eyebrow>
        <table className="w-full mt-3 text-xs" data-testid="wht-list">
          <thead className="text-text-faint">
            <tr><th className="text-left py-1">Vendor</th><th className="text-left">Invoice</th><th className="text-left">Jurisdiction</th><th className="text-right">Gross USD</th><th className="text-right">Rate</th><th className="text-right">WHT USD</th><th className="text-left">Status</th><th className="text-left">Cert #</th></tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr className="border-t border-border-soft" data-testid="wht-empty">
                <td colSpan={8} className="py-3 text-center text-text-mute">No withholding-tax certificates yet.</td>
              </tr>
            )}
            {items.map((c) => (
              <tr key={c.id} className="border-t border-border-soft" data-testid={`wht-${c.id}`}>
                <td className="py-1.5">{c.vendorName}</td>
                <td className="font-mono">{c.invoiceNumber}</td>
                <td>{c.jurisdiction}</td>
                <td className="text-right font-mono">{fmtUsd(c.grossUsd)}</td>
                <td className="text-right font-mono">{(c.whtPct * 100).toFixed(0)}%</td>
                <td className="text-right font-mono">{fmtUsd(c.whtUsd)}</td>
                <td><MonoChip tone={whtTone(c.status)}>{c.status.replace(/_/g, " ")}</MonoChip></td>
                <td className="font-mono text-text-mute">{c.certificateNumber ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </PayablesShell>
  );
}

// ============================================================
// Subcontractors (pay-when-paid)
// ============================================================
export function FinancePayablesSubcontractors() {
  const { vendors, links } = useSubcontractors();
  const invoices = usePayablesInvoices();
  const heldUsd = invoices.filter((i) => i.status === "on_hold_pwp").reduce((n, i) => n + i.netPayableUsd, 0);
  const releasable = invoices.filter((i) => i.status === "approved_for_payment" && i.subcontractorLinkId);
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Subcontractors"
      headline="Subcontractor pay-when-paid"
      lede="Subcontractor invoices are linked to a client AR receipt. Until that receipt is recorded the invoice sits on `on_hold_pwp` and is excluded from payment runs; once the AR receipt clears the invoice is released for the next run."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{vendors.length} subcontractor(s)</MonoChip>
        <MonoChip tone="amber">{fmtUsd(heldUsd)} held (pay-when-paid)</MonoChip>
        <MonoChip tone={releasable.length > 0 ? "green" : "default"}>{releasable.length} ready to release</MonoChip>
      </div>
      <Card className="p-4">
        <Eyebrow>Pay-when-paid links</Eyebrow>
        <table className="w-full mt-3 text-xs" data-testid="pwp-list">
          <thead className="text-text-faint">
            <tr><th className="text-left py-1">Subcontractor</th><th className="text-left">Engagement</th><th className="text-left">Milestone</th><th className="text-right">Day-rate USD</th><th className="text-left">Linked AR</th><th className="text-left">Receipt status</th><th className="text-right">Action</th></tr>
          </thead>
          <tbody>
            {links.length === 0 && (
              <tr className="border-t border-border-soft" data-testid="pwp-empty">
                <td colSpan={7} className="py-3 text-center text-text-mute">No pay-when-paid links yet.</td>
              </tr>
            )}
            {links.map((l) => {
              const v = vendors.find((vv) => vv.id === l.vendorId);
              return (
                <PwpRow key={l.id} link={l} vendorName={v?.shortName ?? l.vendorId} />
              );
            })}
          </tbody>
        </table>
      </Card>
      <Card className="p-4">
        <Eyebrow>Held subcontractor invoices</Eyebrow>
        <div className="mt-3 space-y-1.5 text-xs">
          {invoices.filter((i) => i.subcontractorLinkId).length === 0 && (
            <p className="py-2 text-center text-text-mute" data-testid="held-invoices-empty">No held subcontractor invoices.</p>
          )}
          {invoices.filter((i) => i.subcontractorLinkId).map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 border border-border-soft rounded px-2 py-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{inv.number}</span>
                <MonoChip tone={invStatusTone(inv.status)}>{inv.status.replace(/_/g, " ")}</MonoChip>
                <span className="text-text-mute">{inv.description}</span>
              </div>
              <span className="font-mono">{fmtUsd(inv.netPayableUsd)}</span>
            </div>
          ))}
        </div>
      </Card>
    </PayablesShell>
  );
}

function PwpRow({ link, vendorName }: { link: { id: string; engagementName: string; milestoneLabel: string; ratePerDayUsd: number; payWhenPaidArInvoiceId: string; arReceiptStatus: "open" | "received" | "partial"; arReceivedAt: string | null }; vendorName: string }) {
  const { busy, error, run } = useMutate();
  const onReceived = () => run(`r:${link.id}`, () => postJson(`/finance/payables/subcontractors/links/${link.id}/ar-receipt`, { status: "received" }));
  return (
    <>
      <tr className="border-t border-border-soft" data-testid={`pwp-${link.id}`}>
        <td className="py-1.5">{vendorName}</td>
        <td>{link.engagementName}</td>
        <td>{link.milestoneLabel}</td>
        <td className="text-right font-mono">{fmtUsd(link.ratePerDayUsd)}</td>
        <td className="font-mono">{link.payWhenPaidArInvoiceId}</td>
        <td>
          <MonoChip tone={link.arReceiptStatus === "received" ? "green" : link.arReceiptStatus === "partial" ? "amber" : "default"}>
            {link.arReceiptStatus}{link.arReceivedAt ? ` · ${link.arReceivedAt}` : ""}
          </MonoChip>
        </td>
        <td className="text-right">
          {link.arReceiptStatus !== "received" && (
            <Button size="sm" variant="outline" onClick={onReceived} disabled={!!busy} data-testid={`btn-ar-${link.id}`}>
              {busy === `r:${link.id}` ? "…" : "Mark AR received"}
            </Button>
          )}
        </td>
      </tr>
      {error && <tr><td colSpan={7} className="text-xs text-danger px-2">⚠ {error}</td></tr>}
    </>
  );
}

function AuditTrailPanel() {
  const audit = usePayablesAudit();
  if (audit.length === 0) return null;
  return (
    <Card className="p-4" data-testid="audit-trail">
      <Eyebrow>Audit trail (latest {Math.min(audit.length, 20)})</Eyebrow>
      <ul className="mt-2 divide-y divide-border-soft text-xs">
        {audit.slice(0, 20).map((a) => (
          <li key={a.id} className="py-1.5">
            <div className="flex items-baseline justify-between gap-2 text-text-mute">
              <span><span className="text-text font-medium">{a.actor}</span> · <span className="font-mono">{a.kind}</span> · <span className="font-mono text-text-faint">{a.subjectId}</span></span>
              <span className="font-mono text-text-faint">{a.at.replace("T", " ").slice(0, 19)}</span>
            </div>
            <div className="text-text-mute">{a.detail}</div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
