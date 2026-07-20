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
  usePayablesSelfBilling,
  usePayablesBankAccounts,
  useWhtRegister,
  useSubcontractors,
  usePayablesAudit,
  postJson,
  API_BASE,
  type VendorRow2,
  type PoRow,
  type VendorInvoiceRow,
  type PaymentRunRow,
  type SelfBilledInvoiceRow,
} from "@/lib/v5-hooks";

function useInvalidatePayables() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    for (const k of ["pay-vendors", "pay-pos", "pay-invoices", "pay-runs", "pay-selfbilling", "pay-bankaccounts", "pay-wht", "pay-subs", "pay-disb", "pay-stalled", "pay-audit"]) {
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
  { id: "self-billing", label: "Self-billing", href: "/finance/payables/self-billing" },
  { id: "payment-runs", label: "Payment runs", href: "/finance/payables/payment-runs" },
  { id: "run-history", label: "Run history", href: "/finance/payables/run-history" },
  { id: "vendors", label: "Vendors", href: "/finance/payables/vendors" },
  { id: "po", label: "Purchase orders", href: "/finance/payables/po" },
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
// Self-billed invoices (RCTI) — Task #430
// ============================================================
function sbTone(s: SelfBilledInvoiceRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "approved") return "green";
  if (s === "disputed" || s === "rejected") return "red";
  if (s === "draft" || s === "scheduled") return "amber";
  return "default";
}

export function FinancePayablesSelfBilling() {
  const invoices = usePayablesSelfBilling();
  const { busy, error, run } = useMutate();
  const [info, setInfo] = React.useState<string | null>(null);
  const onRunClerk = () =>
    run("clerk", async () => {
      const r = await postJson<{ summary: { invoicesCreated: number; invoicesUpdated: number; invoicesSkipped: number; reconciliationMismatches: number } }>(
        "/finance/payables/self-billing/run",
        {},
      );
      setInfo(
        `Clerk finished: ${r.summary.invoicesCreated} created · ${r.summary.invoicesUpdated} refreshed · ${r.summary.invoicesSkipped} skipped · ${r.summary.reconciliationMismatches} mismatch(es).`,
      );
    });
  const drafts = invoices.filter((i) => i.status === "draft");
  const disputed = invoices.filter((i) => i.status === "disputed");
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Self-billing"
      headline="Self-billed invoices (RCTI)"
      lede="The Self-Billing Clerk drafts one invoice per contractor / partner firm per approved week from logged hours, reconciles each draft against the payment proposals, and holds everything at a partner checkpoint. Approve a draft to make it payable; disputed invoices stay out of payment runs."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <MonoChip>{invoices.length} invoice(s)</MonoChip>
        <MonoChip tone={drafts.length > 0 ? "amber" : "default"}>{drafts.length} awaiting review</MonoChip>
        <MonoChip tone={disputed.length > 0 ? "red" : "default"}>{disputed.length} disputed</MonoChip>
        <div className="ml-auto flex items-center gap-2">
          {info && <span className="text-text-mute normal-case font-sans text-xs">{info}</span>}
          <Button size="sm" onClick={onRunClerk} disabled={!!busy} data-testid="btn-run-clerk">
            {busy === "clerk" ? "Running clerk…" : "Run Self-Billing Clerk"}
          </Button>
        </div>
      </div>
      {error && <div className="text-xs text-danger">⚠ {error}</div>}
      <div className="grid gap-3" data-testid="selfbilling-list">
        {invoices.length === 0 && (
          <EmptyCard testId="selfbilling-empty">
            No self-billed invoices yet. Run the Self-Billing Clerk to draft invoices from approved contractor and partner-firm hours.
          </EmptyCard>
        )}
        {invoices.map((inv) => (
          <SelfBilledInvoiceCard key={inv.id} inv={inv} />
        ))}
      </div>
    </PayablesShell>
  );
}

function emailChip(e: NonNullable<SelfBilledInvoiceRow["emailDelivery"]>[number]) {
  const label = e.kind === "approval" ? "invoice email" : "remittance email";
  if (e.status === "sent") return { tone: "green" as const, text: `${label}: sent` };
  if (e.status === "no_email") return { tone: "red" as const, text: `${label}: no supplier email` };
  if (e.status === "failed") return { tone: "red" as const, text: `${label}: failed` };
  return { tone: "amber" as const, text: `${label}: not delivered (email not configured)` };
}

function SelfBilledInvoiceCard({ inv }: { inv: SelfBilledInvoiceRow }) {
  const { busy, error, run } = useMutate();
  const onApprove = () => run(`ap:${inv.id}`, () => postJson(`/finance/payables/self-billing/${inv.id}/approve`, {}));
  const onReject = () => {
    const reason = window.prompt(`Reject ${inv.invoiceNumber}. Reason?`);
    if (reason === null) return;
    run(`rj:${inv.id}`, () => postJson(`/finance/payables/self-billing/${inv.id}/reject`, { reason }));
  };
  const onResolve = () => {
    const note = window.prompt(`Resolve dispute on ${inv.invoiceNumber}. Resolution note?`);
    if (note === null) return;
    run(`rs:${inv.id}`, () => postJson(`/finance/payables/self-billing/${inv.id}/resolve-dispute`, { note }));
  };
  const recon = inv.reconciliation;
  return (
    <Card className="p-4" data-testid={`sbi-${inv.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Eyebrow>{inv.invoiceNumber} · {inv.weekIso}</Eyebrow>
          <div className="text-base font-medium mt-1">
            {inv.supplierName}
            {inv.supplierType === "partner_firm" && <span className="text-xs text-text-mute ml-2">partner firm</span>}
          </div>
          <div className="text-xs text-text-mute mt-1">
            {inv.currency} {inv.subtotalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} + VAT{" "}
            {inv.vat?.ratePct ? `${inv.vat.ratePct}%` : inv.vat?.treatment ?? "n/a"} ={" "}
            <span className="text-text font-mono">{inv.currency} {inv.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            {" "}· {fmtUsd(inv.totalUsd)}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <MonoChip tone={sbTone(inv.status)} data-testid={`sbi-status-${inv.id}`}>{inv.status}</MonoChip>
          {recon && (
            <MonoChip tone={recon.status === "matched" ? "green" : recon.status === "mismatch" ? "red" : "amber"}>
              reconcile: {recon.status.replace(/_/g, " ")}
            </MonoChip>
          )}
          {(() => {
            // Latest attempt per kind, newest last in the log.
            const latest = new Map<string, NonNullable<SelfBilledInvoiceRow["emailDelivery"]>[number]>();
            for (const e of inv.emailDelivery ?? []) latest.set(e.kind, e);
            return [...latest.values()].map((e) => {
              const c = emailChip(e);
              return (
                <MonoChip key={e.kind} tone={c.tone} data-testid={`sbi-email-${e.kind}-${inv.id}`}>
                  {c.text}
                </MonoChip>
              );
            });
          })()}
        </div>
      </div>
      <div className="mt-3 text-xs">
        <table className="w-full">
          <thead className="text-text-faint">
            <tr><th className="text-left py-1">Engagement</th><th className="text-right">Hours</th><th className="text-right">Rate</th><th className="text-right">Amount</th></tr>
          </thead>
          <tbody>
            {(inv.lines ?? []).map((l, i) => (
              <tr key={`${l.engagementId}-${i}`} className="border-t border-border-soft">
                <td className="py-1.5">{l.engagementName ?? l.engagementId}</td>
                <td className="text-right font-mono">{l.hours.toFixed(1)}</td>
                <td className="text-right font-mono">{l.ratePerHour.toFixed(2)}</td>
                <td className="text-right font-mono">{l.amount.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {recon?.detail && recon.status !== "matched" && (
        <div className="mt-2 text-xs text-amber-600">{recon.detail}</div>
      )}
      {inv.status === "disputed" && (
        <div className="mt-2 border border-danger/40 bg-danger/5 rounded p-2 text-xs">
          <span className="text-danger font-medium">Disputed:</span>{" "}
          <span className="text-text-mute">{inv.disputeReason}</span>
        </div>
      )}
      {inv.status === "paid" && (
        <div className="mt-2 text-xs text-text-mute">
          Paid {inv.paidAt?.slice(0, 10)}{inv.remittanceRef ? ` · remittance ${inv.remittanceRef}` : ""}
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        {inv.status === "draft" && (
          <>
            <Button size="sm" onClick={onApprove} disabled={!!busy} data-testid={`btn-sbi-approve-${inv.id}`}>
              {busy === `ap:${inv.id}` ? "…" : "Approve"}
            </Button>
            <Button size="sm" variant="outline" onClick={onReject} disabled={!!busy} data-testid={`btn-sbi-reject-${inv.id}`}>Reject</Button>
          </>
        )}
        {inv.status === "disputed" && (
          <Button size="sm" variant="outline" onClick={onResolve} disabled={!!busy} data-testid={`btn-sbi-resolve-${inv.id}`}>
            {busy === `rs:${inv.id}` ? "…" : "Resolve dispute"}
          </Button>
        )}
        {inv.status === "approved" && !inv.paymentRunId && (
          <Button size="sm" variant="outline" onClick={onReject} disabled={!!busy} data-testid={`btn-sbi-reject-${inv.id}`}>Reject</Button>
        )}
      </div>
      {error && <div className="text-xs text-danger mt-2">⚠ {error}</div>}
    </Card>
  );
}

// ============================================================
// Payment runs (dual bank signatories) — Task #430
// ============================================================
function runStatusTone(s: PaymentRunRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "exported" || s === "approved") return "green";
  if (s === "cancelled") return "red";
  if (s === "draft" || s === "pending_signatures") return "amber";
  return "default";
}

export function FinancePayablesPaymentRuns() {
  const allRuns = usePayablesRuns();
  const runs = allRuns.filter((r) => r.status !== "paid" && r.status !== "cancelled");
  const settled = allRuns.length - runs.length;
  const bankAccounts = usePayablesBankAccounts();
  const { busy, error, run } = useMutate();
  const [info, setInfo] = React.useState<string | null>(null);
  const [bankAccountId, setBankAccountId] = React.useState("");
  React.useEffect(() => {
    if (!bankAccountId && bankAccounts.length > 0) setBankAccountId(bankAccounts[0].id);
  }, [bankAccounts, bankAccountId]);
  const onBuild = () =>
    run("build", async () => {
      setInfo(null);
      const r = await postJson<{ run: PaymentRunRow }>("/finance/payables/payment-runs/build", { bankAccountId });
      setInfo(`Built ${r.run.runNumber} — ${r.run.itemCount} item(s) · ${fmtUsd(r.run.totalUsd)}. Awaiting two signatures.`);
    });
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Payment runs"
      headline="Payment runs"
      lede="A run gathers approved self-billed invoices and approved unreimbursed expense claims. Two distinct, active bank signatories must sign before the bank file can be exported and the run marked paid; remittance references cascade to every invoice and reimbursement."
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
        <MonoChip>{runs.length} active run(s)</MonoChip>
        <MonoChip tone={runs.some((r) => r.status === "pending_signatures") ? "amber" : "default"}>
          {runs.filter((r) => r.status === "pending_signatures").length} awaiting signatures
        </MonoChip>
        {settled > 0 && (
          <Link href="/finance/payables/run-history" className="text-gold hover:underline normal-case" data-testid="link-run-history">
            {settled} settled run(s) in history →
          </Link>
        )}
        <div className="ml-auto flex items-center gap-2">
          {info && <span className="text-text-mute normal-case font-sans text-xs">{info}</span>}
          <select
            className="border border-border-soft rounded bg-surface px-2 py-1.5 text-xs"
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            data-testid="select-bank-account"
          >
            {bankAccounts.length === 0 && <option value="">No active bank accounts</option>}
            {bankAccounts.map((b) => (
              <option key={b.id} value={b.id}>{b.label} ({b.currency})</option>
            ))}
          </select>
          <Button size="sm" onClick={onBuild} disabled={!!busy || !bankAccountId} data-testid="btn-build-run">
            {busy === "build" ? "Building…" : "Build new run"}
          </Button>
        </div>
      </div>
      {error && <div className="text-xs text-danger">⚠ {error}</div>}
      <div className="grid gap-3" data-testid="runs-list">
        {runs.length === 0 && (
          <EmptyCard testId="runs-empty">
            {settled > 0
              ? "No active payment runs. Settled and cancelled runs live under Run history."
              : "No payment runs yet. Approve self-billed invoices, then build a run."}
          </EmptyCard>
        )}
        {runs.map((r) => (
          <PaymentRunCard key={r.id} runRow={r} />
        ))}
      </div>
    </PayablesShell>
  );
}

function PaymentRunCard({ runRow }: { runRow: PaymentRunRow }) {
  const { busy, error, run } = useMutate();
  const [detail, setDetail] = React.useState<PaymentRunRow | null>(null);
  const loadDetail = React.useCallback(async () => {
    const res = await fetch(`${API_BASE}/finance/payables/payment-runs/${runRow.id}`, { credentials: "include" });
    if (res.ok) {
      const j = (await res.json()) as { run: PaymentRunRow };
      setDetail(j.run);
    }
  }, [runRow.id]);
  React.useEffect(() => { void loadDetail(); }, [loadDetail, runRow.status]);
  const items = detail?.items ?? [];
  const onSign = () => run(`sg:${runRow.id}`, () => postJson(`/finance/payables/payment-runs/${runRow.id}/sign`, {}));
  const onMarkPaid = () => {
    const ref = window.prompt(`Mark ${runRow.runNumber} paid. Remittance reference?`, runRow.runNumber);
    if (ref === null) return;
    run(`mp:${runRow.id}`, () => postJson(`/finance/payables/payment-runs/${runRow.id}/mark-paid`, { remittanceRef: ref }));
  };
  const onCancel = () => {
    const reason = window.prompt(`Cancel ${runRow.runNumber}. Reason?`);
    if (reason === null) return;
    run(`cx:${runRow.id}`, () => postJson(`/finance/payables/payment-runs/${runRow.id}/cancel`, { reason }));
  };
  const onExport = async () => {
    const res = await fetch(`${API_BASE}/finance/payables/payment-runs/${runRow.id}/export`, {
      method: "POST", credentials: "include",
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${runRow.runNumber}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
  return (
    <Card className="p-4" data-testid={`run-${runRow.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Eyebrow>{runRow.runNumber}</Eyebrow>
          <div className="text-base font-medium mt-1">{runRow.itemCount} item(s) · {runRow.bankAccountLabel}</div>
          <div className="text-xs text-text-mute mt-1">
            Maker: {runRow.makerName} · {runRow.createdAt.slice(0, 10)}
            {runRow.cancelReason && <span className="text-danger ml-2">cancelled: {runRow.cancelReason}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <MonoChip tone={runStatusTone(runRow.status)} data-testid={`run-status-${runRow.id}`}>{runRow.status.replace(/_/g, " ")}</MonoChip>
          <span className="font-mono text-sm">{fmtUsd(runRow.totalUsd)}</span>
        </div>
      </div>
      <div className="mt-3 text-xs">
        <Eyebrow>Signatures ({(runRow.signatures ?? []).length}/2 required)</Eyebrow>
        <ul className="mt-1.5 space-y-0.5">
          {(runRow.signatures ?? []).length === 0 && <li className="text-amber-500">No signatures yet.</li>}
          {(runRow.signatures ?? []).map((s) => (
            <li key={s.userId} className="text-text-mute">
              <span className="text-text">{s.name}</span>
              <MonoChip className="ml-1.5">{s.authority.replace(/_/g, " ")}</MonoChip>
              <MonoChip tone="green" className="ml-1">signed {s.signedAt.slice(0, 10)}</MonoChip>
            </li>
          ))}
        </ul>
      </div>
      {items.length > 0 && (
        <div className="mt-3 text-xs">
          <Eyebrow>Items</Eyebrow>
          <table className="w-full mt-1.5">
            <thead className="text-text-faint">
              <tr><th className="text-left py-1">Payee</th><th className="text-left">Detail</th><th className="text-left">Type</th><th className="text-right">Amount</th><th className="text-left">Status</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-t border-border-soft">
                  <td className="py-1.5">{it.payeeName}</td>
                  <td className="text-text-mute">{it.description}</td>
                  <td className="font-mono">{it.itemType === "self_billed_invoice" ? "invoice" : "reimbursement"}</td>
                  <td className="text-right font-mono">{it.currency} {it.amount.toFixed(2)}</td>
                  <td>
                    <MonoChip tone={it.status === "paid" ? "green" : it.status === "removed" ? "red" : "amber"}>
                      {it.status}{it.remittanceRef ? ` · ${it.remittanceRef}` : ""}
                    </MonoChip>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {runRow.status === "pending_signatures" && (
          <>
            <Button size="sm" onClick={onSign} disabled={!!busy} data-testid={`btn-sign-${runRow.id}`}>
              {busy === `sg:${runRow.id}` ? "…" : "Sign"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={!!busy} data-testid={`btn-cancel-${runRow.id}`}>Cancel run</Button>
          </>
        )}
        {(runRow.status === "approved" || runRow.status === "exported") && (
          <>
            <Button size="sm" variant="outline" onClick={onExport} disabled={!!busy} data-testid={`btn-export-${runRow.id}`}>Export bank file</Button>
            <Button size="sm" onClick={onMarkPaid} disabled={!!busy} data-testid={`btn-markpaid-${runRow.id}`}>
              {busy === `mp:${runRow.id}` ? "…" : "Mark paid"}
            </Button>
            <Button size="sm" variant="outline" onClick={onCancel} disabled={!!busy} data-testid={`btn-cancel-${runRow.id}`}>Cancel run</Button>
          </>
        )}
      </div>
      {error && <div className="text-xs text-danger mt-2">⚠ {error}</div>}
    </Card>
  );
}

// ============================================================
// Payment-run history (paid / cancelled) — audit trail view
// ============================================================
interface RunAuditEvent {
  id: string;
  action: string;
  actorLabel: string | null;
  summary: string | null;
  at: string;
}

function fmtTs(iso: string | null): string {
  return iso ? iso.replace("T", " ").slice(0, 16) : "—";
}

export function FinancePayablesRunHistory() {
  const allRuns = usePayablesRuns();
  const runs = allRuns.filter((r) => r.status === "paid" || r.status === "cancelled");
  const paid = runs.filter((r) => r.status === "paid");
  const paidUsd = paid.reduce((n, r) => n + r.totalUsd, 0);
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Run history"
      headline="Payment-run history"
      lede="The permanent record of settled and cancelled payment runs: who signed, when the bank file was exported, when payment was confirmed, remittance references per line, and the full audit trail behind each run."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{runs.length} settled run(s)</MonoChip>
        <MonoChip tone="green">{paid.length} paid · {fmtUsd(paidUsd)}</MonoChip>
        <MonoChip tone={runs.some((r) => r.status === "cancelled") ? "red" : "default"}>
          {runs.filter((r) => r.status === "cancelled").length} cancelled
        </MonoChip>
      </div>
      <div className="grid gap-3" data-testid="run-history-list">
        {runs.length === 0 && (
          <EmptyCard testId="run-history-empty">
            No settled runs yet. Paid and cancelled payment runs will appear here with their signatures, remittance references, and audit trail.
          </EmptyCard>
        )}
        {runs.map((r) => (
          <RunHistoryCard key={r.id} runRow={r} />
        ))}
      </div>
    </PayablesShell>
  );
}

function RunHistoryCard({ runRow }: { runRow: PaymentRunRow }) {
  const [open, setOpen] = React.useState(false);
  const [detail, setDetail] = React.useState<PaymentRunRow | null>(null);
  const [auditEvents, setAuditEvents] = React.useState<RunAuditEvent[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const loadDetail = React.useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch(`${API_BASE}/finance/payables/payment-runs/${runRow.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const j = (await res.json()) as { run: PaymentRunRow; auditEvents?: RunAuditEvent[] };
      setDetail(j.run);
      setAuditEvents(j.auditEvents ?? []);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [runRow.id]);
  React.useEffect(() => {
    if (open && !detail) void loadDetail();
  }, [open, detail, loadDetail]);
  const items = detail?.items ?? [];
  return (
    <Card className="p-4" data-testid={`hist-run-${runRow.id}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <Eyebrow>{runRow.runNumber}</Eyebrow>
          <div className="text-base font-medium mt-1">{runRow.itemCount} item(s) · {runRow.bankAccountLabel}</div>
          <div className="text-xs text-text-mute mt-1">Maker: {runRow.makerName} · created {fmtTs(runRow.createdAt)}</div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <MonoChip tone={runRow.status === "paid" ? "green" : "red"} data-testid={`hist-run-status-${runRow.id}`}>
            {runRow.status}
          </MonoChip>
          <span className="font-mono text-sm">{fmtUsd(runRow.totalUsd)}</span>
        </div>
      </div>
      <div className="grid sm:grid-cols-4 gap-3 mt-3 text-xs">
        <div>
          <Eyebrow>Signatures</Eyebrow>
          <ul className="mt-1.5 space-y-0.5">
            {(runRow.signatures ?? []).length === 0 && <li className="text-text-mute">None recorded.</li>}
            {(runRow.signatures ?? []).map((s) => (
              <li key={s.userId} className="text-text-mute">
                <span className="text-text">{s.name}</span> · {s.authority.replace(/_/g, " ")} · {fmtTs(s.signedAt)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <Eyebrow>Approved</Eyebrow>
          <div className="mt-1.5 font-mono text-text-mute">{fmtTs(runRow.approvedAt)}</div>
        </div>
        <div>
          <Eyebrow>Exported</Eyebrow>
          <div className="mt-1.5 font-mono text-text-mute">{fmtTs(runRow.exportedAt)}</div>
        </div>
        <div>
          <Eyebrow>{runRow.status === "paid" ? "Paid" : "Cancelled"}</Eyebrow>
          <div className="mt-1.5 font-mono text-text-mute">
            {fmtTs(runRow.status === "paid" ? runRow.paidAt : runRow.cancelledAt)}
          </div>
          {runRow.cancelReason && <div className="mt-1 text-danger">{runRow.cancelReason}</div>}
        </div>
      </div>
      <div className="mt-3">
        <Button size="sm" variant="outline" onClick={() => setOpen((o) => !o)} data-testid={`btn-hist-detail-${runRow.id}`}>
          {open ? "Hide detail" : "View items & audit trail"}
        </Button>
      </div>
      {open && (
        <div className="mt-3 space-y-4">
          {loadError && <div className="text-xs text-danger">⚠ Could not load run detail: {loadError}</div>}
          {!loadError && !detail && <div className="text-xs text-text-mute">Loading…</div>}
          {items.length > 0 && (
            <div className="text-xs">
              <Eyebrow>Line items & remittance</Eyebrow>
              <table className="w-full mt-1.5" data-testid={`hist-items-${runRow.id}`}>
                <thead className="text-text-faint">
                  <tr>
                    <th className="text-left py-1">Payee</th>
                    <th className="text-left">Detail</th>
                    <th className="text-left">Type</th>
                    <th className="text-right">Amount</th>
                    <th className="text-left">Status</th>
                    <th className="text-left">Remittance ref</th>
                    <th className="text-left">Paid at</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id} className="border-t border-border-soft">
                      <td className="py-1.5">{it.payeeName}</td>
                      <td className="text-text-mute">{it.description}</td>
                      <td className="font-mono">{it.itemType === "self_billed_invoice" ? "invoice" : "reimbursement"}</td>
                      <td className="text-right font-mono">{it.currency} {it.amount.toFixed(2)}</td>
                      <td>
                        <MonoChip tone={it.status === "paid" ? "green" : it.status === "removed" ? "red" : "amber"}>{it.status}</MonoChip>
                      </td>
                      <td className="font-mono text-text-mute">{it.remittanceRef ?? "—"}</td>
                      <td className="font-mono text-text-mute">{fmtTs(it.paidAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {auditEvents && (
            <div className="text-xs">
              <Eyebrow>Audit trail</Eyebrow>
              {auditEvents.length === 0 && <p className="mt-1.5 text-text-mute">No audit events recorded for this run.</p>}
              <ul className="mt-1.5 divide-y divide-border-soft" data-testid={`hist-audit-${runRow.id}`}>
                {auditEvents.map((a) => (
                  <li key={a.id} className="py-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-text-mute">
                      <span>
                        <span className="text-text font-medium">{a.actorLabel ?? "System"}</span>
                        {" · "}
                        <span className="font-mono">{a.action}</span>
                      </span>
                      <span className="font-mono text-text-faint">{fmtTs(a.at)}</span>
                    </div>
                    {a.summary && <div className="text-text-mute">{a.summary}</div>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
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
