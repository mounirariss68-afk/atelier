/**
 * FinancePayables — Procure-to-pay surfaces (Task #418, Wave 6).
 *
 * Sub-pages under /finance/payables/*:
 *   - self-billing    — self-billed invoices (RCTI) with approvals
 *   - partner/supplier invoices — intake + review
 *   - payment-runs    — maker-checker + dual-signatory enforcement + bank-file
 *   - wht             — withholding-tax certificate register + remittance summary
 *
 * Task #1091 stub sweep: the vendor master and PO / 3-way-match surfaces
 * were removed here — the server routes were deleted (blueprint §6: the
 * vendor registry folds into counterparty resolution).
 * Task #1106: the Subcontractors pay-when-paid surface was folded into the
 * live invoice tabs — it had no backing data model (empty stubs only).
 */

import * as React from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, Eyebrow, MonoChip } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";
import {
  useAtelierGetFinanceApprovalsInbox,
  getAtelierGetFinanceApprovalsInboxQueryKey,
  ApiError,
  type AtelierApprovalInboxItem,
} from "@workspace/api-client-react";
import { ArrowRight, Bot, Clock, Inbox } from "lucide-react";
import { useDeepLinkFocus, deepLinkFocusClass, scrollFocusIntoView, focusOutcome } from "@/lib/useDeepLinkFocus";
import { vendorKeyFromSupplier } from "./toolingSpend.helpers";
import {
  usePayablesRuns,
  usePayablesSelfBillingState,
  usePayablesBankAccounts,
  useWhtRegister,
  usePayablesAudit,
  useLegalEntities,
  postJson,
  API_BASE,
  type PaymentRunRow,
  type SelfBilledInvoiceRow,
} from "@/lib/v5-hooks";

function useInvalidatePayables() {
  const qc = useQueryClient();
  return React.useCallback(() => {
    for (const k of ["pay-runs", "pay-selfbilling", "pay-bankaccounts", "pay-wht", "pay-disb", "pay-stalled", "pay-audit"]) {
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

export type PayablesTab = { id: string; label: string; href: string; blurb: string };
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
          <PayablesTabStrip />
        </div>
      </PageHero>
      <div className="container-atelier py-10 space-y-6">{children}</div>
    </div>
  );
}

// ------------------------------------------------------------
// Self-billed invoices (RCTI) — Task #430
// ------------------------------------------------------------
function sbTone(s: SelfBilledInvoiceRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "approved") return "green";
  if (s === "disputed" || s === "rejected") return "red";
  if (s === "draft" || s === "scheduled") return "amber";
  return "default";
}

export function FinancePayablesSelfBilling() {
  const { items: invoices, loaded } = usePayablesSelfBillingState();
  const { busy, error, run } = useMutate();
  const [info, setInfo] = React.useState<string | null>(null);
  // Task #1082 — `?focus=<id>` deep-link from GL ledger rows.
  const { focusId, missing, reportMissing, dismissMissing } = useDeepLinkFocus("focus");
  React.useEffect(() => {
    if (focusId && loaded && !invoices.some((i) => i.id === focusId)) reportMissing();
  }, [focusId, loaded, invoices, reportMissing]);
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
      {missing && (
        <div className="flex items-center justify-between text-xs font-mono text-text-mute border border-border-soft rounded px-3 py-2" data-testid="sbi-focus-missing">
          <span>The linked self-billed invoice is not in this list (it may have been removed).</span>
          <button className="text-gold hover:text-gold/80 ml-3" onClick={dismissMissing}>dismiss</button>
        </div>
      )}
      <div className="grid gap-3" data-testid="selfbilling-list">
        {invoices.length === 0 && (
          <EmptyCard testId="selfbilling-empty">
            No self-billed invoices yet. Run the Self-Billing Clerk to draft invoices from approved contractor and partner-firm hours.
          </EmptyCard>
        )}
        {invoices.map((inv) => (
          <SelfBilledInvoiceCard key={inv.id} inv={inv} highlighted={inv.id === focusId} />
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

function SelfBilledInvoiceCard({ inv, highlighted }: { inv: SelfBilledInvoiceRow; highlighted?: boolean }) {
  const cardRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (highlighted) scrollFocusIntoView(cardRef.current);
  }, [highlighted]);
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
    <div ref={cardRef} className={highlighted ? deepLinkFocusClass : undefined}>
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
    </div>
  );
}

// ------------------------------------------------------------
// Payment runs (dual bank signatories) — Task #430
// ------------------------------------------------------------
function runStatusTone(s: PaymentRunRow["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid" || s === "exported" || s === "approved") return "green";
  if (s === "cancelled") return "red";
  if (s === "draft" || s === "pending_signatures") return "amber";
  return "default";
}

// ------------------------------------------------------------
// Task #875 — Partner-submitted invoices (AP review)
// ------------------------------------------------------------

type PartnerInvoiceRow = {
  id: string;
  partnerFirmId: string;
  partnerFirmName: string;
  reference: string | null;
  periodLabel: string | null;
  amount: number;
  currency: string;
  usdAmount: number;
  status: string;
  notes: string | null;
  fileName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedReason: string | null;
  paymentRunId: string | null;
  paidAt: string | null;
  hasBankDetails: boolean;
};

function usePartnerInvoices(): { items: PartnerInvoiceRow[]; loaded: boolean; refetch: () => void } {
  const [items, setItems] = React.useState<PartnerInvoiceRow[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/finance/payables/partner-invoices`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (alive) { setItems(d.items ?? []); setLoaded(true); } })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [tick]);
  return { items, loaded, refetch: () => setTick((t) => t + 1) };
}

function partnerInvoiceTone(s: string): "default" | "amber" | "red" | "green" {
  if (s === "rejected") return "red";
  if (s === "submitted" || s === "under_review") return "amber";
  if (s === "approved" || s === "paid") return "green";
  return "default";
}

export function FinancePayablesPartnerInvoices() {
  const { items, loaded, refetch } = usePartnerInvoices();
  const { busy, error, run } = useMutate();
  // Task #1082 — `?focus=<id>` deep-link from GL ledger rows.
  const { focusId, missing, reportMissing, dismissMissing } = useDeepLinkFocus("focus");
  const focusRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    if (!focusId || !loaded) return;
    if (items.some((i) => i.id === focusId)) scrollFocusIntoView(focusRef.current);
    else reportMissing();
  }, [focusId, loaded, items, reportMissing]);
  const act = (id: string, decision: string, reason?: string) =>
    run(`${decision}:${id}`, async () => {
      await postJson(`/finance/payables/partner-invoices/${id}/review`, { decision, ...(reason ? { reason } : {}) });
      refetch();
    });
  const pending = items.filter((i) => i.status === "submitted" || i.status === "under_review");
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Partner invoices"
      headline="Partner-submitted invoices"
      lede="Invoices partner firms submit through their portal. Review and approve or reject with a reason; approved invoices join the next payment run automatically (firms without finance-approved bank details are held back)."
    >
      <div className="flex flex-wrap gap-2 text-xs font-mono">
        <MonoChip>{items.length} invoice(s)</MonoChip>
        <MonoChip tone={pending.length > 0 ? "amber" : "default"}>{pending.length} awaiting review</MonoChip>
      </div>
      {error && <div className="text-xs text-danger">⚠ {error}</div>}
      {missing && (
        <div className="flex items-center justify-between text-xs font-mono text-text-mute border border-border-soft rounded px-3 py-2" data-testid="partner-invoice-focus-missing">
          <span>The linked partner invoice is not in this list (it may have been removed).</span>
          <button className="text-gold hover:text-gold/80 ml-3" onClick={dismissMissing}>dismiss</button>
        </div>
      )}
      <div className="grid gap-3" data-testid="partner-invoices-list">
        {items.length === 0 && (
          <EmptyCard testId="partner-invoices-empty">
            No partner-submitted invoices yet. They appear here as soon as a partner firm submits one from its portal.
          </EmptyCard>
        )}
        {items.map((inv) => (
          <div key={inv.id} ref={inv.id === focusId ? focusRef : undefined} className={inv.id === focusId ? deepLinkFocusClass : undefined}>
          <Card className="p-4" data-testid={`partner-invoice-${inv.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow>{inv.partnerFirmName}</Eyebrow>
                <div className="text-base font-medium mt-1">
                  {inv.reference ?? inv.id} · {inv.currency} {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-text-mute mt-1">
                  {inv.periodLabel ? `Period ${inv.periodLabel} · ` : ""}
                  {inv.submittedAt ? `Submitted ${inv.submittedAt.slice(0, 10)} · ` : ""}
                  ≈ {fmtUsd(inv.usdAmount)}
                </div>
                {inv.notes && <div className="text-xs text-text-mute mt-1">{inv.notes}</div>}
                {inv.status === "rejected" && inv.rejectedReason && (
                  <div className="text-xs text-danger mt-1">Rejected: {inv.rejectedReason}</div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <MonoChip tone={partnerInvoiceTone(inv.status)}>{inv.status.replace(/_/g, " ")}</MonoChip>
                {!inv.hasBankDetails && <MonoChip tone="amber">no bank details</MonoChip>}
                {inv.fileName && (
                  <a
                    href={`${API_BASE}/finance/payables/partner-invoices/${inv.id}/file`}
                    className="text-xs text-gold hover:text-gold/80"
                    data-testid={`link-partner-invoice-file-${inv.id}`}
                  >
                    download PDF
                  </a>
                )}
              </div>
            </div>
            {(inv.status === "submitted" || inv.status === "under_review") && (
              <div className="flex gap-2 mt-4">
                {inv.status === "submitted" && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(inv.id, "start_review")} data-testid={`btn-start-review-${inv.id}`}>
                    Start review
                  </Button>
                )}
                <Button size="sm" disabled={!!busy || !inv.hasBankDetails} onClick={() => act(inv.id, "approve")} data-testid={`btn-approve-${inv.id}`}>
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!!busy}
                  onClick={() => {
                    const reason = window.prompt(`Reject invoice ${inv.reference ?? inv.id}. Reason?`);
                    if (reason === null || !reason.trim()) return;
                    act(inv.id, "reject", reason.trim());
                  }}
                  data-testid={`btn-reject-${inv.id}`}
                >
                  Reject
                </Button>
              </div>
            )}
          </Card>
          </div>
        ))}
      </div>
    </PayablesShell>
  );
}

// ------------------------------------------------------------
// Task #1070 — Internally-uploaded supplier invoices
// ------------------------------------------------------------

type SupplierInvoiceRow = {
  id: string;
  supplierName: string;
  partnerFirmId: string | null;
  reference: string | null;
  periodLabel: string | null;
  invoiceDate: string | null;
  amount: number;
  currency: string;
  usdAmount: number;
  status: string;
  notes: string | null;
  fileName: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedReason: string | null;
  paymentRunId: string | null;
  paidAt: string | null;
  // Task #1250 — chat invoice+receipt pairing: parsed line items and
  // proof-of-payment receipt metadata (download via downloadPath).
  lineItems: { description: string; qty: number | null; unitAmount: number | null; amount: number | null }[] | null;
  paymentReceipt: { fileName: string; sizeBytes: number; attachedAt: string; matchedBy: string; downloadPath: string } | null;
  hasBankDetails: boolean;
  // Task #1075 — recorded one-off supplier bank details (unlinked
  // suppliers). IBAN/holder are server-redacted outside fp/partner/finance.
  hasSupplierBankDetails: boolean;
  supplierBankIban: string | null;
  supplierBankHolder: string | null;
  // Task #1095 — entity allocation lifecycle.
  legalEntityId: string | null;
  allocStatus: string | null;
  allocRuleId: string | null;
  allocJustification: string | null;
  allocConfidence: number | null;
  allocDecidedBy: string | null;
  allocOverrideReason: string | null;
  // Task #1104 — set when the live approval was made by the autopilot.
  autopilot: { agentName: string; agentRunId: string | null; at: string | null } | null;
};

// Task #1095 — entity options for the allocation override select.
type AllocEntityOption = { id: string; shortName: string; legalNameEn: string };
function useAllocEntities(): AllocEntityOption[] {
  const [entities, setEntities] = React.useState<AllocEntityOption[]>([]);
  React.useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/finance/entities`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (alive)
          setEntities(
            (d.items ?? d.entities ?? []).map((e: AllocEntityOption) => ({
              id: e.id,
              shortName: e.shortName || e.legalNameEn,
              legalNameEn: e.legalNameEn,
            })),
          );
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return entities;
}

function useSupplierInvoices(): { items: SupplierInvoiceRow[]; loaded: boolean; refetch: () => void } {
  const [items, setItems] = React.useState<SupplierInvoiceRow[]>([]);
  const [loaded, setLoaded] = React.useState(false);
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/finance/payables/supplier-invoices`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (alive) { setItems(d.items ?? []); setLoaded(true); } })
      .catch(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [tick]);
  return { items, loaded, refetch: () => setTick((t) => t + 1) };
}

const SUPPLIER_STATUS_FILTERS = ["all", "submitted", "under_review", "approved", "scheduled", "paid", "rejected"] as const;

type SupplierFirmOption = { id: string; name: string; hasBankDetails: boolean };

type BankHint = {
  invoiceId: string;
  supplierBankIban: string | null;
  supplierBankHolder: string | null;
  fromDate: string | null;
};

function SupplierInvoiceUploadForm({ onUploaded }: { onUploaded: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [supplierName, setSupplierName] = React.useState("");
  const [firms, setFirms] = React.useState<SupplierFirmOption[]>([]);
  const [firmId, setFirmId] = React.useState("");
  React.useEffect(() => {
    let alive = true;
    void fetch(`${API_BASE}/finance/payables/supplier-invoices/firms`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => { if (alive) setFirms(d.items ?? []); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  const selectedFirm = firms.find((f) => f.id === firmId) ?? null;
  // Task #1092 — optional legal-entity attribution (incl. pre-formation
  // entities, so market-entry invoices land in their cost pool).
  const { entities } = useLegalEntities();
  const [legalEntityId, setLegalEntityId] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [currency, setCurrency] = React.useState("USD");
  const [reference, setReference] = React.useState("");
  const [periodLabel, setPeriodLabel] = React.useState("");
  const [notes, setNotes] = React.useState("");
  // Task #1075 — optional one-off supplier bank details (unlinked only).
  const [bankIban, setBankIban] = React.useState("");
  const [bankHolder, setBankHolder] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Task #1145 — bank-detail hint from previous invoice for the same supplier.
  const [bankHint, setBankHint] = React.useState<BankHint | null>(null);
  const [hintDismissed, setHintDismissed] = React.useState(false);
  const hintTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Fetch hint whenever supplier name changes (debounced; only for unlinked).
  React.useEffect(() => {
    const name = supplierName.trim();
    setBankHint(null);
    setHintDismissed(false);
    if (!name || selectedFirm) return;
    if (hintTimerRef.current) clearTimeout(hintTimerRef.current);
    hintTimerRef.current = setTimeout(() => {
      void fetch(
        `${API_BASE}/finance/payables/supplier-invoices/bank-hint?supplierName=${encodeURIComponent(name)}`,
        { credentials: "include" },
      )
        .then((r) => (r.ok ? r.json() : { hint: null }))
        .then((d) => { if (d.hint?.supplierBankIban) setBankHint(d.hint as BankHint); })
        .catch(() => undefined);
    }, 500);
    return () => { if (hintTimerRef.current) clearTimeout(hintTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierName, selectedFirm]);

  // When user picks a different firm / clears firm, reset hint too.
  React.useEffect(() => {
    setBankHint(null);
    setHintDismissed(false);
  }, [firmId]);

  const applyBankHint = () => {
    if (!bankHint) return;
    setBankIban(bankHint.supplierBankIban ?? "");
    setBankHolder(bankHint.supplierBankHolder ?? "");
    setHintDismissed(true); // banner goes away once applied
  };

  // Bank details are optional, but IBAN and holder come together.
  const bankOk = selectedFirm ? true : (!bankIban.trim() && !bankHolder.trim()) || (!!bankIban.trim() && !!bankHolder.trim());
  const canSubmit = !!file && (selectedFirm || supplierName.trim()) && reference.trim() && Number(amount) > 0 && /^[A-Za-z]{3}$/.test(currency) && bankOk;

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setBusy(true); setError(null); setInfo(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("supplierName", selectedFirm ? selectedFirm.name : supplierName.trim());
      if (selectedFirm) form.append("partnerFirmId", selectedFirm.id);
      if (legalEntityId) form.append("legalEntityId", legalEntityId);
      form.append("amount", amount);
      form.append("currency", currency.toUpperCase());
      form.append("reference", reference.trim());
      if (periodLabel.trim()) form.append("periodLabel", periodLabel.trim());
      if (notes.trim()) form.append("notes", notes.trim());
      if (!selectedFirm && bankIban.trim()) {
        form.append("supplierBankIban", bankIban.trim());
        form.append("supplierBankHolder", bankHolder.trim());
      }
      const res = await fetch(`${API_BASE}/finance/payables/supplier-invoices`, {
        method: "POST", credentials: "include", body: form,
      });
      const body = await res.json().catch(() => null);
      if (res.status === 409 && body?.error === "duplicate-invoice") {
        setError(body.message ?? "Duplicate invoice — an identical file or reference already exists.");
        return;
      }
      if (!res.ok) {
        setError(body?.message ?? body?.error ?? `Upload failed (${res.status})`);
        return;
      }
      setInfo(`Uploaded ${reference.trim()} — awaiting review.`);
      setFile(null); setSupplierName(""); setFirmId(""); setLegalEntityId(""); setAmount(""); setReference(""); setPeriodLabel(""); setNotes(""); setBankIban(""); setBankHolder(""); setBankHint(null); setHintDismissed(false);
      if (fileRef.current) fileRef.current.value = "";
      onUploaded();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };

  const input = "border border-border-soft rounded bg-surface px-2 py-1.5 text-xs w-full";
  return (
    <Card className="p-4" data-testid="supplier-invoice-upload">
      <Eyebrow>Upload a supplier invoice</Eyebrow>
      <form onSubmit={onSubmit} className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="text-text-mute">Invoice PDF</span>
          <input ref={fileRef} type="file" accept="application/pdf,.pdf" className={input} data-testid="input-supplier-file"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Registered partner firm (optional)</span>
          <select className={input} value={firmId} onChange={(e) => setFirmId(e.target.value)} data-testid="select-supplier-firm">
            <option value="">Not a registered partner firm</option>
            {firms.map((f) => (
              <option key={f.id} value={f.id}>{f.name}{f.hasBankDetails ? "" : " (no bank details)"}</option>
            ))}
          </select>
          {selectedFirm && !selectedFirm.hasBankDetails && (
            <span className="text-warn block" data-testid="supplier-firm-bank-warning">
              ⚠ This firm has no finance-approved bank details — approval will be held until onboarding records them.
            </span>
          )}
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Supplier name</span>
          <input
            className={input}
            value={selectedFirm ? selectedFirm.name : supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            disabled={!!selectedFirm}
            placeholder="Acme Cloud FZ-LLC"
            data-testid="input-supplier-name"
          />
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Attribute to entity (optional)</span>
          <select
            className={input}
            value={legalEntityId}
            onChange={(e) => setLegalEntityId(e.target.value)}
            data-testid="select-supplier-entity"
          >
            <option value="">No entity attribution</option>
            {entities.map((en) => (
              <option key={en.id} value={en.id}>
                {(en.shortName || en.legalNameEn) + (en.status === "in_formation" ? " \u2014 pre-formation" : "")}
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Amount</span>
          <input className={input} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" placeholder="1250.00" data-testid="input-supplier-amount" />
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Currency (3-letter)</span>
          <input className={input} value={currency} onChange={(e) => setCurrency(e.target.value)} maxLength={3} placeholder="USD" data-testid="input-supplier-currency" />
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Invoice reference</span>
          <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="INV-2026-014" data-testid="input-supplier-reference" />
        </label>
        <label className="space-y-1">
          <span className="text-text-mute">Billing period (optional)</span>
          <input className={input} value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} placeholder="July 2026" data-testid="input-supplier-period" />
        </label>
        <label className="space-y-1 sm:col-span-2">
          <span className="text-text-mute">Notes (optional)</span>
          <input className={input} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What is this invoice for?" data-testid="input-supplier-notes" />
        </label>
        {/* Task #1075 — one-off suppliers: record verified bank details so the
            payment-run bank file carries them instead of manual keying. */}
        {!selectedFirm && (
          <>
            {/* Task #1145 — bank-detail hint from the most recent previous invoice
                for the same supplier name. Finance must confirm — never silent. */}
            {bankHint && !hintDismissed && (
              <div className="sm:col-span-2 flex items-start gap-3 border border-gold/40 bg-gold/5 rounded px-3 py-2 text-xs" data-testid="supplier-bank-hint">
                <div className="flex-1">
                  <span className="font-medium text-gold">Bank details from previous invoice</span>
                  {bankHint.fromDate && <span className="text-text-mute ml-1">({bankHint.fromDate})</span>}
                  <div className="mt-1 font-mono text-text-mute">
                    {bankHint.supplierBankIban}
                    {bankHint.supplierBankHolder && <span className="ml-2">· {bankHint.supplierBankHolder}</span>}
                  </div>
                  <div className="mt-1 text-text-mute">Confirm these are still correct before applying.</div>
                </div>
                <div className="flex gap-2 shrink-0 mt-0.5">
                  <button
                    type="button"
                    onClick={applyBankHint}
                    className="px-2 py-1 rounded border border-gold text-gold hover:bg-gold/10"
                    data-testid="btn-apply-bank-hint"
                  >
                    Apply
                  </button>
                  <button
                    type="button"
                    onClick={() => setHintDismissed(true)}
                    className="px-2 py-1 rounded border border-border-soft text-text-mute hover:text-text"
                    data-testid="btn-dismiss-bank-hint"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}
            <label className="space-y-1">
              <span className="text-text-mute">Supplier IBAN (optional)</span>
              <input className={input} value={bankIban} onChange={(e) => setBankIban(e.target.value)} placeholder="AE07 0331 2345 6789 0123 456" data-testid="input-supplier-bank-iban" />
            </label>
            <label className="space-y-1">
              <span className="text-text-mute">Account holder {bankIban.trim() ? "" : "(with IBAN)"}</span>
              <input className={input} value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} placeholder="Acme Cloud FZ-LLC" data-testid="input-supplier-bank-holder" />
              {!bankOk && <span className="text-warn block">⚠ IBAN and account holder must be provided together.</span>}
            </label>
          </>
        )}
        <div className="sm:col-span-2 flex items-center gap-3">
          <Button size="sm" type="submit" disabled={busy || !canSubmit} data-testid="btn-upload-supplier-invoice">
            {busy ? "Uploading…" : "Upload invoice"}
          </Button>
          {info && <span className="text-text-mute">{info}</span>}
          {error && <span className="text-danger" data-testid="supplier-upload-error">⚠ {error}</span>}
        </div>
      </form>
    </Card>
  );
}

// Task #1251 — compact, defensive "Project cost split" block for supplier
// invoices from a recognised tooling vendor (Replit / Anthropic /
// Perplexity). Fetched lazily only when the row is expanded; any non-ok
// fetch renders a quiet one-line notice and never breaks the page.
type ToolingSplitState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error" }
  | {
      phase: "ok";
      extraction:
        | null
        | {
            status: "ok" | "unreconciled" | "failed";
            currency: string;
            items: Array<{ projectLabel: string; category: string; amount: number }>;
          };
    };

function ToolingCostSplitBlock({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = React.useState(false);
  const [state, setState] = React.useState<ToolingSplitState>({ phase: "idle" });

  const load = React.useCallback(() => {
    setState({ phase: "loading" });
    void fetch(`${API_BASE}/finance/tooling/invoices/${encodeURIComponent(invoiceId)}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (!body || !body.ok || !body.data) {
          setState({ phase: "error" });
          return;
        }
        setState({ phase: "ok", extraction: body.data.extraction ?? null });
      })
      .catch(() => setState({ phase: "error" }));
  }, [invoiceId]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && state.phase === "idle") load();
  };

  return (
    <div className="mt-3 border-t border-border-soft pt-3" data-testid={`tooling-split-block-${invoiceId}`}>
      <button
        type="button"
        onClick={toggle}
        className="text-xs font-mono text-text-mute hover:text-text"
        data-testid={`tooling-split-toggle-${invoiceId}`}
      >
        {open ? "▾" : "▸"} Project cost split
      </button>
      {open && (
        <div className="mt-2 text-xs">
          {state.phase === "loading" && <div className="text-text-mute">Loading cost split…</div>}
          {state.phase === "error" && (
            <div className="text-text-mute" data-testid={`tooling-split-notice-${invoiceId}`}>
              Project cost split is unavailable right now.
            </div>
          )}
          {state.phase === "ok" && (
            <div>
              <div className="flex items-center gap-2">
                {state.extraction ? (
                  <MonoChip
                    tone={
                      state.extraction.status === "ok"
                        ? "green"
                        : state.extraction.status === "unreconciled"
                        ? "amber"
                        : "red"
                    }
                    data-testid={`tooling-split-status-${invoiceId}`}
                  >
                    {state.extraction.status}
                  </MonoChip>
                ) : (
                  <MonoChip data-testid={`tooling-split-status-${invoiceId}`}>not extracted</MonoChip>
                )}
              </div>
              {state.extraction && state.extraction.items.length > 0 && (
                <table className="w-full mt-2" data-testid={`tooling-split-items-${invoiceId}`}>
                  <thead>
                    <tr className="text-left font-mono text-[10px] uppercase text-text-faint">
                      <th className="py-1 pr-3">Project</th>
                      <th className="py-1 pr-3">Category</th>
                      <th className="py-1 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.extraction.items.map((it, i) => (
                      <tr key={i} className="border-t border-border-soft/50">
                        <td className="py-1 pr-3">{it.projectLabel}</td>
                        <td className="py-1 pr-3 text-text-mute">{it.category}</td>
                        <td className="py-1 text-right font-mono">
                          {state.extraction!.currency}{" "}
                          {it.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <Link
                href={`/finance/tooling?focus=${encodeURIComponent(invoiceId)}`}
                className="inline-block mt-2 text-gold hover:text-gold/80"
                data-testid={`tooling-split-open-${invoiceId}`}
              >
                Open in Tooling spend →
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function FinancePayablesSupplierInvoices() {
  const { items, loaded, refetch } = useSupplierInvoices();
  const { busy, error, run } = useMutate();
  const [filter, setFilter] = React.useState<(typeof SUPPLIER_STATUS_FILTERS)[number]>("all");
  // Task #1103 — `?focus=<id>` deep-link from the payables action inbox.
  const { focusId, missing, reportMissing, dismissMissing } = useDeepLinkFocus("focus");
  const focusRef = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    const outcome = focusOutcome(loaded, items.map((i) => i.id), focusId);
    if (outcome === "scroll") scrollFocusIntoView(focusRef.current);
    else if (outcome === "missing") reportMissing();
  }, [focusId, loaded, items, reportMissing]);
  const entities = useAllocEntities();
  // Task #1095 — per-invoice entity override pick ("" = keep proposal).
  const [allocPick, setAllocPick] = React.useState<Record<string, string>>({});
  const entityName = (id: string | null) => entities.find((e) => e.id === id)?.shortName ?? id ?? "—";
  const act = (id: string, decision: string, reason?: string, extra?: Record<string, unknown>) =>
    run(`${decision}:${id}`, async () => {
      await postJson(`/finance/payables/supplier-invoices/${id}/review`, { decision, ...(reason ? { reason } : {}), ...(extra ?? {}) });
      refetch();
    });
  // Task #1075 — record/update one-off supplier bank details on the row.
  const recordBank = (inv: SupplierInvoiceRow) => {
    const iban = window.prompt(`Supplier IBAN for ${inv.supplierName} (payment runs pay to this account):`, inv.supplierBankIban ?? "");
    if (iban === null || !iban.trim()) return;
    const holder = window.prompt("Account holder name (as on the bank account):", inv.supplierBankHolder ?? inv.supplierName);
    if (holder === null || !holder.trim()) return;
    run(`bank:${inv.id}`, async () => {
      const res = await fetch(`${API_BASE}/finance/payables/supplier-invoices/${inv.id}/bank-details`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ iban: iban.trim(), holder: holder.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message ?? body?.error ?? `Failed (${res.status})`);
      }
      refetch();
    });
  };
  const pending = items.filter((i) => i.status === "submitted" || i.status === "under_review");
  const shown = filter === "all" ? items : items.filter((i) => i.status === filter);
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay · Supplier invoices"
      headline="Supplier invoices"
      lede="Upload supplier invoices you receive as PDFs so they enter payables. Uploads are reviewed and approved or rejected with a reason; approved invoices join the next payment run. Duplicate files or references are flagged instead of creating a second payable."
    >
      <SupplierInvoiceUploadForm onUploaded={refetch} />
      <div className="flex flex-wrap gap-2 text-xs font-mono items-center">
        <MonoChip>{items.length} invoice(s)</MonoChip>
        <MonoChip tone={pending.length > 0 ? "amber" : "default"}>{pending.length} awaiting review</MonoChip>
        <div className="ml-auto flex gap-1">
          {SUPPLIER_STATUS_FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded border text-[11px] ${filter === f ? "border-gold text-gold" : "border-border-soft text-text-mute hover:text-text"}`}
              data-testid={`filter-supplier-${f}`}
            >
              {f.replace(/_/g, " ")}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="text-xs text-danger">⚠ {error}</div>}
      {missing && (
        <div className="flex items-center justify-between text-xs font-mono text-text-mute border border-border-soft rounded px-3 py-2" data-testid="supplier-invoice-focus-missing">
          <span>The linked supplier invoice is not in this list (it may have been removed).</span>
          <button className="text-gold hover:text-gold/80 ml-3" onClick={dismissMissing}>dismiss</button>
        </div>
      )}
      <div className="grid gap-3" data-testid="supplier-invoices-list">
        {shown.length === 0 && (
          <EmptyCard testId="supplier-invoices-empty">
            {items.length === 0
              ? "No supplier invoices yet. Upload one above to enter it into payables."
              : "No supplier invoices match this filter."}
          </EmptyCard>
        )}
        {shown.map((inv) => (
          <div key={inv.id} ref={inv.id === focusId ? focusRef : undefined} className={inv.id === focusId ? deepLinkFocusClass : undefined}>
          <Card className="p-4" data-testid={`supplier-invoice-${inv.id}`}>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <Eyebrow>{inv.supplierName}{inv.partnerFirmId ? " · partner firm" : ""}</Eyebrow>
                <div className="text-base font-medium mt-1">
                  {inv.reference ?? inv.id} · {inv.currency} {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </div>
                <div className="text-xs text-text-mute mt-1">
                  {inv.periodLabel ? `Period ${inv.periodLabel} · ` : ""}
                  {inv.submittedAt ? `Uploaded ${inv.submittedAt.slice(0, 10)} · ` : ""}
                  ≈ {fmtUsd(inv.usdAmount)}
                </div>
                {inv.notes && <div className="text-xs text-text-mute mt-1">{inv.notes}</div>}
                {/* Task #1095 — entity allocation + justification */}
                {(inv.allocStatus || inv.legalEntityId) && (
                  <div className="text-xs mt-1" data-testid={`supplier-invoice-alloc-${inv.id}`}>
                    <span className="text-text-mute">Entity: </span>
                    {entityName(inv.legalEntityId)}
                    {inv.allocStatus && <MonoChip tone={inv.allocStatus === "needs_input" ? "amber" : inv.allocStatus === "proposed" ? "default" : "green"}>{inv.allocStatus.replace(/_/g, " ")}</MonoChip>}
                    {inv.allocJustification && <div className="text-text-mute mt-0.5">{inv.allocJustification}</div>}
                    {inv.allocOverrideReason && <div className="italic text-text-mute mt-0.5">Override: {inv.allocOverrideReason}</div>}
                  </div>
                )}
                {/* Task #1075 — recorded one-off supplier bank details
                    (server redacts IBAN/holder outside fp/partner/finance). */}
                {!inv.partnerFirmId && inv.hasSupplierBankDetails && inv.supplierBankIban && (
                  <div className="text-xs text-text-mute mt-1 font-mono" data-testid={`supplier-bank-details-${inv.id}`}>
                    Pays to {inv.supplierBankHolder} · {inv.supplierBankIban}
                  </div>
                )}
                {inv.status === "rejected" && inv.rejectedReason && (
                  <div className="text-xs text-danger mt-1">Rejected: {inv.rejectedReason}</div>
                )}
                {/* Task #1250 — printed line items captured at ingest */}
                {inv.lineItems && inv.lineItems.length > 0 && (
                  <div className="text-xs mt-2 font-mono" data-testid={`supplier-invoice-items-${inv.id}`}>
                    <div className="text-text-mute mb-0.5">Line items</div>
                    {inv.lineItems.map((li, i) => (
                      <div key={i} className="flex justify-between gap-4">
                        <span>{li.description}{li.qty != null && li.qty !== 1 ? ` ×${li.qty}` : ""}</span>
                        {li.amount != null && <span>{inv.currency} {li.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <MonoChip tone={partnerInvoiceTone(inv.status)} data-testid={`supplier-invoice-status-${inv.id}`}>{inv.status.replace(/_/g, " ")}</MonoChip>
                {/* Task #1104 — autopilot attribution so founders spot auto-approvals */}
                {inv.autopilot && (
                  <MonoChip tone="amber" data-testid={`supplier-invoice-autopilot-${inv.id}`}>
                    auto-approved · {inv.autopilot.agentName}
                  </MonoChip>
                )}
                {inv.partnerFirmId && !inv.hasBankDetails && <MonoChip tone="amber">no bank details</MonoChip>}
                {/* Task #1075 — one-off supplier bank details status */}
                {!inv.partnerFirmId && (inv.hasSupplierBankDetails ? (
                  <MonoChip tone="green" data-testid={`supplier-bank-chip-${inv.id}`}>bank details recorded</MonoChip>
                ) : (
                  <MonoChip tone="amber" data-testid={`supplier-bank-chip-${inv.id}`}>no supplier bank on file</MonoChip>
                ))}
                {inv.fileName && (
                  <a
                    href={`${API_BASE}/finance/payables/supplier-invoices/${inv.id}/file`}
                    className="text-xs text-gold hover:text-gold/80"
                    data-testid={`link-supplier-invoice-file-${inv.id}`}
                  >
                    download PDF
                  </a>
                )}
                {/* Task #1250 — proof-of-payment receipt attached at ingest */}
                {inv.paymentReceipt && (
                  <>
                    <MonoChip tone="green" data-testid={`supplier-receipt-chip-${inv.id}`}>
                      paid · receipt attached ({inv.paymentReceipt.matchedBy} match)
                    </MonoChip>
                    <a
                      href={`${API_BASE}${inv.paymentReceipt.downloadPath}`}
                      className="text-xs text-gold hover:text-gold/80"
                      data-testid={`link-supplier-receipt-${inv.id}`}
                    >
                      download receipt
                    </a>
                  </>
                )}
              </div>
            </div>
            {(inv.status === "submitted" || inv.status === "under_review") && (
              <div className="flex gap-2 mt-4 items-center flex-wrap">
                {inv.status === "submitted" && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => act(inv.id, "start_review")} data-testid={`btn-supplier-start-review-${inv.id}`}>
                    Start review
                  </Button>
                )}
                {/* Task #1095 — entity override select; approving decides the allocation in the same act */}
                {(inv.allocStatus === "proposed" || inv.allocStatus === "needs_input") && entities.length > 0 && (
                  <select
                    className="bg-bg-deep border border-border-soft rounded px-2 py-1 text-xs"
                    value={allocPick[inv.id] ?? ""}
                    onChange={(e) => setAllocPick((m) => ({ ...m, [inv.id]: e.target.value }))}
                    data-testid={`select-supplier-alloc-${inv.id}`}
                  >
                    <option value="">{inv.legalEntityId ? `Entity: keep proposal (${entityName(inv.legalEntityId)})` : "Entity: pick…"}</option>
                    {entities.map((e) => (
                      <option key={e.id} value={e.id}>{e.shortName}</option>
                    ))}
                  </select>
                )}
                <Button
                  size="sm"
                  disabled={!!busy || (!!inv.partnerFirmId && !inv.hasBankDetails)}
                  onClick={() => {
                    const pick = allocPick[inv.id] ?? "";
                    const overriding = pick && pick !== (inv.legalEntityId ?? "");
                    let overrideReason: string | undefined;
                    if (overriding) {
                      const r = window.prompt(`Overriding entity allocation to ${entityName(pick)} — reason?`);
                      if (r === null || !r.trim()) return;
                      overrideReason = r.trim();
                    }
                    act(inv.id, "approve", undefined, {
                      ...(pick ? { legalEntityId: pick } : {}),
                      ...(overrideReason ? { allocationOverrideReason: overrideReason } : {}),
                    });
                  }}
                  data-testid={`btn-supplier-approve-${inv.id}`}
                >
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={!!busy}
                  onClick={() => {
                    const reason = window.prompt(`Reject invoice ${inv.reference ?? inv.id}. Reason?`);
                    if (reason === null || !reason.trim()) return;
                    act(inv.id, "reject", reason.trim());
                  }}
                  data-testid={`btn-supplier-reject-${inv.id}`}
                >
                  Reject
                </Button>
                {/* Task #1075 — record/update one-off supplier bank details before approval */}
                {!inv.partnerFirmId && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => recordBank(inv)}
                    data-testid={`btn-supplier-bank-${inv.id}`}
                  >
                    {inv.hasSupplierBankDetails ? "Update bank details" : "Record bank details"}
                  </Button>
                )}
              </div>
            )}
            {/* Task #1104 — pull an approved (autopilot) invoice back to
                review before a payment run picks it up. Once scheduled the
                server blocks it — the run must be cancelled instead. */}
            {inv.status === "approved" && !inv.paymentRunId && (
              <div className="flex gap-2 mt-4 items-center flex-wrap">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy}
                  onClick={() => {
                    if (!window.confirm(`Un-approve invoice ${inv.reference ?? inv.id} and return it to review? It will drop out of the next payment run until re-approved.`)) return;
                    act(inv.id, "unapprove");
                  }}
                  data-testid={`btn-supplier-unapprove-${inv.id}`}
                >
                  Un-approve
                </Button>
                {/* Task #1075 — details stay editable until a run claims the invoice */}
                {!inv.partnerFirmId && (
                  <Button size="sm" variant="outline" disabled={!!busy} onClick={() => recordBank(inv)} data-testid={`btn-supplier-bank-${inv.id}`}>
                    {inv.hasSupplierBankDetails ? "Update bank details" : "Record bank details"}
                  </Button>
                )}
                <span className="text-[11px] text-text-mute">
                  {inv.autopilot ? "Auto-approved — returns it to review before the next payment run." : "Returns it to review before the next payment run."}
                </span>
              </div>
            )}
            {inv.status === "scheduled" && inv.autopilot && (
              <div className="text-[11px] text-text-mute mt-3" data-testid={`supplier-invoice-in-run-note-${inv.id}`}>
                In a payment run — un-approve is no longer available; cancel the run to pull it back.
              </div>
            )}
            {/* Task #1251 — tooling-vendor invoices (Replit / Anthropic /
                Perplexity) show a lazy, defensive project cost-split block. */}
            {vendorKeyFromSupplier(inv.supplierName) && (
              <ToolingCostSplitBlock invoiceId={inv.id} />
            )}
          </Card>
          </div>
        ))}
      </div>
    </PayablesShell>
  );
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
  const onExportWio = async () => {
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const res = await fetch(`${API_BASE}/finance/payables/payment-runs/${runRow.id}/export-wio`, {
      method: "POST", credentials: "include",
    });
    if (res.ok) {
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `WIO-${runRow.runNumber}-${today}.csv`;
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
      {/* Task #1144 — warn when any item in this run will export with blank
          bank details so signatories can act before approving. */}
      {items.some((it) => it.missingBank) && (
        <div className="mt-3 flex items-start gap-2 rounded border border-amber-400/40 bg-amber-400/5 px-3 py-2 text-xs" data-testid={`run-missing-bank-warning-${runRow.id}`}>
          <span className="text-amber-500 font-medium shrink-0">⚠ Missing bank details</span>
          <span className="text-text-mute">
            {items.filter((it) => it.missingBank).length} item(s) below have no recorded IBAN and will export with blank bank cells.
            Finance must key them into the bank file manually or record bank details on the supplier invoice before signing.
          </span>
        </div>
      )}
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
                  <td className="py-1.5">
                    {it.payeeName}
                    {it.missingBank && (
                      <MonoChip tone="amber" className="ml-1.5" data-testid={`item-missing-bank-${it.id}`}>no bank</MonoChip>
                    )}
                  </td>
                  <td className="text-text-mute">{it.description}</td>
                  <td className="font-mono">{it.itemType === "self_billed_invoice" ? "invoice" : it.itemType === "partner_firm_invoice" ? "supplier" : "reimbursement"}</td>
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
            <Button size="sm" variant="outline" onClick={onExportWio} disabled={!!busy} data-testid={`btn-export-wio-${runRow.id}`}>Download Wio file</Button>
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

// ------------------------------------------------------------
// Payment-run history (paid / cancelled) — audit trail view
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// WHT register
// ------------------------------------------------------------
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

// ------------------------------------------------------------
// Subcontractors (pay-when-paid) — REMOVED (Task #1106)
// ------------------------------------------------------------
// The pay-when-paid surface had no backing data model (its endpoints were
// live-but-empty stubs). Real invoices live in the Partner invoices,
// Supplier invoices and Self-billing tabs.

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

/** Inbox kinds that belong to procure-to-pay (subset of the unified
 *  /finance/approvals inbox from Task #1091). */
const PAYABLES_INBOX_KINDS: Record<string, string> = {
  supplier_invoice: "Invoices to review",
  self_billing_draft: "Self-billing checkpoints",
  payment_run: "Runs awaiting signature",
};

export const PAYABLES_TAB_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  href: string;
  tabs: PayablesTab[];
}> = [
  { id: "overview", label: "Overview", href: "/finance/payables", tabs: [] },
  {
    id: "invoices-in",
    label: "Invoices in",
    href: "/finance/payables/partner-invoices",
    tabs: [
      { id: "partner-invoices", label: "Partner invoices", href: "/finance/payables/partner-invoices", blurb: "Invoices partner firms submit through their portal — review, approve or reject." },
      { id: "supplier-invoices", label: "Supplier invoices", href: "/finance/payables/supplier-invoices", blurb: "Internally-uploaded supplier invoices with entity allocation and review." },
      { id: "self-billing", label: "Self-billing", href: "/finance/payables/self-billing", blurb: "Self-billed (RCTI) invoices drafted by the clerk from approved hours; partner checkpoint before payment." },
    ],
  },
  {
    id: "pay",
    label: "Pay",
    href: "/finance/payables/payment-runs",
    tabs: [
      { id: "payment-runs", label: "Payment runs", href: "/finance/payables/payment-runs", blurb: "Maker-checker + dual-signatory payment runs with bank-file output." },
    ],
  },
  {
    id: "registers",
    label: "Registers",
    href: "/finance/payables/run-history",
    tabs: [
      { id: "run-history", label: "Run history", href: "/finance/payables/run-history", blurb: "Settled and cancelled runs with signatures, remittance references, and audit trail." },
      { id: "wht", label: "WHT register", href: "/finance/payables/wht", blurb: "Withholding-tax certificate tracking and per-jurisdiction remittance." },
    ],
  },
];

function NeedsActionRow({
  title,
  subtitle,
  href,
  when,
  amount,
  actionable,
  agent,
  testId,
}: {
  title: string;
  subtitle?: string | null;
  href: string;
  when?: string | null;
  amount?: string | null;
  actionable: boolean;
  /** Task #1104 — agent/autopilot attribution badge. */
  agent?: { name: string } | null;
  testId: string;
}) {
  return (
    <div
      className={`flex items-center justify-between gap-3 py-2 px-1 border-b border-border-soft/60 last:border-b-0 ${actionable ? "" : "opacity-60"}`}
      data-testid={testId}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="truncate text-sm text-text">{title}</span>
          {agent && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-gold/10 px-1.5 py-0.5 font-mono text-[10px] text-gold"
              title={`Posted by ${agent.name}`}
              data-testid={`${testId}-agent`}
            >
              <Bot className="w-3 h-3" /> {agent.name}
            </span>
          )}
          {!actionable && <MonoChip tone="amber">Partner approval</MonoChip>}
        </div>
        {subtitle && <div className="text-[11px] text-text-mute truncate">{subtitle}</div>}
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {amount && <span className="font-mono text-xs text-text whitespace-nowrap">{amount}</span>}
        {when !== undefined && (
          <span className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-text-faint">
            <Clock className="w-3 h-3" /> {inboxTimeAgo(when)}
          </span>
        )}
        <Link href={href} className={`text-xs whitespace-nowrap ${actionable ? "text-gold hover:underline" : "text-text-faint hover:text-text-mute"}`}>
          {actionable ? "Review →" : "View →"}
        </Link>
      </div>
    </div>
  );
}

export function FinancePayablesOverview() {
  const stageGroups = PAYABLES_TAB_GROUPS.filter((g) => g.id === "invoices-in" || g.id === "pay");
  const registers = PAYABLES_TAB_GROUPS.find((g) => g.id === "registers")!;
  return (
    <PayablesShell
      eyebrow="Manage · Finance · Pay"
      headline="Procure-to-pay"
      lede="Invoices in (partner, supplier, self-billed), payment runs with maker-checker and dual signatures, and the supporting registers. Everything waiting on you is at the top."
    >
      <NeedsYourActionPanel />
      {stageGroups.map((g) => (
        <div key={g.id} className="space-y-3">
          <SectionHead
            eyebrow={g.id === "invoices-in" ? "Capture & approve" : "Settle"}
            headline={g.id === "invoices-in" ? "Invoices in" : "Pay"}
          />
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid={`payables-group-${g.id}`}>
            {g.tabs.map((t) => (
              <LandingLinkCard key={t.id} tab={t} testId={`payables-landing-${t.id}`} />
            ))}
          </div>
        </div>
      ))}
      <div className="space-y-3">
        <SectionHead eyebrow="Reference" headline="Registers & related" />
        <p className="text-xs text-text-mute -mt-2">Reference registers and the Wallet expense surfaces (expense approvals stay in Wallet).</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="payables-group-registers">
          {[...registers.tabs, ...RELATED_WALLET_LINKS].map((t) => (
            <LandingLinkCard key={t.id} tab={t} testId={`payables-landing-${t.id}`} />
          ))}
        </div>
      </div>
    </PayablesShell>
  );
}

function activePayablesGroupId(pathname: string): string {
  for (const g of PAYABLES_TAB_GROUPS) {
    if (g.tabs.some((t) => pathname === t.href || pathname.startsWith(t.href + "/"))) return g.id;
  }
  return "overview";
}

/** "Needs your action" — pending payables actions for the current user,
 *  aggregated from the unified approvals inbox (payables kinds only).
 *  3-way-match exceptions are NOT listed: the PO / 3-way-match surfaces
 *  (and their data) were retired in the Task #1091 stub sweep, so there
 *  is no live match-exception source to aggregate.
 *
 *  Visibility (deliberate, mirrors the server): GET /finance/approvals/inbox
 *  is gated to finance leadership (founding_partner | partner | finance) and
 *  we intentionally do NOT widen that read — payables approve/decide writes
 *  are leadership-tier too, so a wider read would only surface items the
 *  viewer can't act on. Non-leadership viewers of this landing get an
 *  explicit "not visible for your role" card instead of a silently hidden
 *  panel; genuine load failures render a separate error state. */
function NeedsYourActionPanel() {
  const { data, isLoading, isError, error } = useAtelierGetFinanceApprovalsInbox({
    query: {
      queryKey: getAtelierGetFinanceApprovalsInboxQueryKey(),
      // A 403 is a stable role verdict, not a transient failure — don't retry.
      retry: (failureCount, err) =>
        !(err instanceof ApiError && err.status === 403) && failureCount < 2,
    },
  });
  const inbox = data?.data;
  const items = (inbox?.items ?? []).filter((it) => it.kind in PAYABLES_INBOX_KINDS);
  const forbidden = isError && error instanceof ApiError && error.status === 403;
  if (forbidden) {
    return (
      <Card className="p-5" data-testid="payables-needs-action-forbidden">
        <SectionHead eyebrow="Approvals" headline="Needs your action" />
        <p className="mt-3 text-sm text-text-mute">
          No pending actions are visible for your role. The payables approvals
          inbox (invoice approvals, payment-run checks and match exceptions) is
          limited to finance leadership — founding partners, partners and
          finance. If you take on payables duties, ask a founding partner to
          update your role.
        </p>
      </Card>
    );
  }
  if (isError) {
    return (
      <Card className="p-5" data-testid="payables-needs-action-error">
        <SectionHead eyebrow="Approvals" headline="Needs your action" />
        <p className="mt-3 text-sm text-text-mute">
          Couldn&apos;t load pending payables actions. Reload the page to try
          again, or open the{" "}
          <Link href="/finance/approvals" className="text-gold hover:underline">
            full approvals inbox
          </Link>
          .
        </p>
      </Card>
    );
  }
  const groups: Array<{ label: string; items: AtelierApprovalInboxItem[] }> = [];
  for (const [kind, label] of Object.entries(PAYABLES_INBOX_KINDS)) {
    const ofKind = items.filter((i) => i.kind === kind);
    if (ofKind.length > 0) groups.push({ label, items: ofKind });
  }
  const total = items.length;
  return (
    <Card className="p-5" data-testid="payables-needs-action">
      <div className="flex items-start justify-between gap-2">
        <SectionHead eyebrow="Approvals" headline="Needs your action" />
        <MonoChip tone={total > 0 ? "amber" : "default"} data-testid="payables-needs-action-count">
          {total} pending
        </MonoChip>
      </div>
      {isLoading && <p className="text-sm text-text-mute mt-3">Loading pending actions…</p>}
      {!isLoading && total === 0 && (
        <div className="mt-4 text-center py-4" data-testid="payables-needs-action-empty">
          <Inbox className="w-6 h-6 mx-auto text-text-faint" />
          <p className="mt-2 text-sm text-text-mute">Nothing in payables is waiting on you.</p>
        </div>
      )}
      <div className="mt-2 space-y-4">
        {groups.map((g) => (
          <div key={g.label}>
            <Eyebrow>{g.label}</Eyebrow>
            <div className="mt-1">
              {g.items.map((it) => (
                <NeedsActionRow
                  key={`${it.kind}-${it.id}`}
                  title={it.title}
                  subtitle={it.subtitle}
                  href={it.href}
                  when={it.submittedAt}
                  amount={it.amount ? `${it.amount.currency} ${it.amount.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : null}
                  actionable={it.actionable}
                  agent={it.agent}
                  testId={`payables-action-${it.id}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 pt-3 border-t border-border-soft/60 text-xs">
        <Link href="/finance/approvals" className="text-gold hover:underline">
          Full approvals inbox (all of finance) →
        </Link>
      </div>
    </Card>
  );
}

function LandingLinkCard({ tab, testId }: { tab: PayablesTab; testId: string }) {
  return (
    <Link href={tab.href}>
      <Card className="p-4 h-full flex flex-col gap-2 hover:border-gold/40 cursor-pointer transition-colors" data-testid={testId}>
        <div className="flex items-center justify-between">
          <Eyebrow>{tab.label}</Eyebrow>
          <ArrowRight className="w-3.5 h-3.5 text-text-faint" />
        </div>
        <p className="text-sm text-text-mute leading-snug">{tab.blurb}</p>
      </Card>
    </Link>
  );
}

function PayablesTabStrip() {
  const [loc] = useLocation();
  const activeGroup = activePayablesGroupId(loc);
  const group = PAYABLES_TAB_GROUPS.find((g) => g.id === activeGroup);
  return (
    <div className="space-y-1.5">
      <SubSectionTabs
        tabs={PAYABLES_TAB_GROUPS.map((g) => ({
          id: g.id,
          label: g.label,
          href: g.href,
          isActive: () => g.id === activeGroup,
        }))}
        data-testid="finance-payables-tabs"
      />
      {group && group.tabs.length > 1 && (
        <SubSectionTabs
          className="border-b-0"
          tabs={group.tabs.map((t) => ({ id: t.id, label: t.label, href: t.href }))}
          data-testid="finance-payables-subtabs"
        />
      )}
    </div>
  );
}

function inboxTimeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

const RELATED_WALLET_LINKS: PayablesTab[] = [
  { id: "expenses", label: "Expenses", href: "/wallet/expenses", blurb: "Submitted, approved, and paid expense reports." },
  { id: "policy", label: "Expense policy", href: "/wallet/policy", blurb: "Per-diem caps, receipt thresholds, VAT recovery rules." },
  { id: "approvals", label: "Approvals queue", href: "/wallet/approvals", blurb: "Manager / partner expense approvals." },
  { id: "cards", label: "Corporate cards", href: "/wallet/cards", blurb: "Card register, statements, dispute tracker." },
  { id: "vat", label: "VAT / WHT (legacy)", href: "/wallet/vat", blurb: "Input VAT recovery and legacy WHT view." },
  { id: "treasury", label: "Treasury", href: "/wallet/treasury", blurb: "Cash position, FX exposure, payment runs." },
];
