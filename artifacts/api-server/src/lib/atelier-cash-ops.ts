/**
 * Task #431 — live cash operations helpers.
 *
 * autoMatchImport: runs after every bank statement import. Inflow rows
 * (kind=receipt, amount>0) get a cash-receipt row (idempotent) and a
 * persisted Cash Application Matcher proposal; outflow rows (amount<0)
 * get a rule-based source-candidate proposal (contractor payments,
 * partner-firm invoices, approved expenses) for the triage queue.
 *
 * All persistence is deterministic and fail-soft per transaction: a
 * matcher error never rolls back the import itself.
 */

import { and, eq, isNull, inArray, gte, lte } from "drizzle-orm";
import {
  db,
  atelierBankTransaction,
  atelierBankAccount,
  atelierCashReceipt,
  atelierInvoice,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierExpenses,
} from "@workspace/db";
import { runCashApplicationMatcher } from "./atelier-agents/runner.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  if (!a || !b) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const A = norm(a), B = norm(b);
  if (!A || !B) return 0;
  if (A === B) return 1;
  if (A.includes(B) || B.includes(A)) return 0.85;
  const ta = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tb = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  const inter = [...ta].filter((t) => tb.has(t)).length;
  const uni = new Set([...ta, ...tb]).size;
  return uni === 0 ? 0 : inter / uni;
}

/** Entity-scope guard: rows tagged with a different legal entity never match. */
export function entityCompatible(txnEntityId: string | null | undefined, sourceEntityId: string | null | undefined): boolean {
  return !txnEntityId || !sourceEntityId || txnEntityId === sourceEntityId;
}

export interface OutflowCandidate {
  refKind: "contractor_payment" | "partner_firm_invoice" | "expense";
  refId: string;
  label: string;
  amount: number;
  confidence: number;
  rationale: string;
}

/**
 * Rule-based outflow matching: candidate sources whose USD amount is
 * close to the txn's absolute amount, ranked by counterparty-name
 * similarity. Only unpaid/approved rows are considered.
 */
export async function proposeOutflowCandidates(args: {
  orgId: string;
  counterpartyNameRaw: string | null;
  amountAbs: number;
  /** Legal entity of the bank transaction (or its account); entity-tagged sources from other entities are excluded. */
  entityId?: string | null;
}): Promise<OutflowCandidate[]> {
  const { orgId, counterpartyNameRaw, amountAbs } = args;
  const entityId = args.entityId ?? null;
  const candidates: OutflowCandidate[] = [];
  const amountClose = (v: number) => Math.abs(v - amountAbs) <= Math.max(1, amountAbs * 0.02);

  const cps = await db.select().from(atelierContractorPayments).where(and(
    eq(atelierContractorPayments.orgId, orgId),
    isNull(atelierContractorPayments.deletedAt),
    inArray(atelierContractorPayments.status, ["partner_approved", "paid"]),
  ));
  for (const cp of cps) {
    if (!entityCompatible(entityId, cp.legalEntityId)) continue;
    const sim = nameSimilarity(counterpartyNameRaw, cp.payeeName);
    const amt = amountClose(cp.usdAmount);
    if (!amt && sim < 0.7) continue;
    candidates.push({
      refKind: "contractor_payment", refId: cp.id,
      label: `${cp.payeeName} · ${cp.weekIso} · $${cp.usdAmount.toFixed(2)}`,
      amount: cp.usdAmount,
      confidence: amt && sim >= 0.7 ? 0.9 : amt ? 0.55 : 0.45,
      rationale: amt && sim >= 0.7 ? "Payee name + amount match" : amt ? "Amount matches approved payment" : "Payee name matches",
    });
  }

  const pfis = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
    inArray(atelierPartnerFirmInvoices.status, ["partner_approved", "paid"]),
  ));
  for (const pf of pfis) {
    if (!entityCompatible(entityId, pf.legalEntityId)) continue;
    const sim = nameSimilarity(counterpartyNameRaw, pf.partnerFirmName);
    const amt = amountClose(pf.usdAmount);
    if (!amt && sim < 0.7) continue;
    candidates.push({
      refKind: "partner_firm_invoice", refId: pf.id,
      label: `${pf.partnerFirmName} · ${pf.weekIso} · $${pf.usdAmount.toFixed(2)}`,
      amount: pf.usdAmount,
      confidence: amt && sim >= 0.7 ? 0.9 : amt ? 0.55 : 0.45,
      rationale: amt && sim >= 0.7 ? "Firm name + amount match" : amt ? "Amount matches approved invoice" : "Firm name matches",
    });
  }

  const exps = await db.select().from(atelierExpenses).where(and(
    eq(atelierExpenses.orgId, orgId),
    isNull(atelierExpenses.deletedAt),
    inArray(atelierExpenses.status, ["approved", "reimbursed"]),
  ));
  for (const ex of exps) {
    const sim = nameSimilarity(counterpartyNameRaw, ex.merchant);
    const amt = amountClose(ex.usdAmount);
    if (!amt || sim < 0.5) continue; // expenses need both signals
    candidates.push({
      refKind: "expense", refId: ex.id,
      label: `${ex.merchant ?? "expense"} · ${ex.expenseDate} · $${ex.usdAmount.toFixed(2)}`,
      amount: ex.usdAmount,
      confidence: 0.75,
      rationale: "Merchant + amount match approved expense",
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates.slice(0, 5);
}

export interface AutoMatchSummary {
  receiptsCreated: number;
  inflowProposals: number;
  outflowProposals: number;
  skipped: number;
  errors: string[];
}

// ════════════════ Task #1071 — statement exceptions derivation ════════════════

export type StatementExceptionReason =
  | "no_match"           // no invoice/source candidate at all
  | "amount_mismatch"    // proposed match differs from the bank amount
  | "duplicate"          // another txn with same account/date/amount/counterparty
  | "flagged"            // explicitly parked with a reason
  | "unreviewed_proposal"; // candidates exist but nobody confirmed yet

export interface StatementExceptionRow {
  txn: typeof atelierBankTransaction.$inferSelect;
  reasons: StatementExceptionReason[];
  /** Human-readable detail per reason (parked reason, mismatch delta, …). */
  detail: string | null;
}

export interface ReconTxnSummary {
  txnCount: number;
  matchedCount: number;
  unmatchedCount: number;
  matchedTotal: number;
  unmatchedTotal: number;
  openExceptions: number;
}

const RESOLVED_STATES = new Set(["matched", "journaled"]);

function dupKey(t: typeof atelierBankTransaction.$inferSelect): string {
  return [
    t.bankAccountId,
    t.postedDate,
    t.amount.toFixed(2),
    (t.counterpartyNameRaw ?? "").toLowerCase().replace(/\s+/g, " ").trim(),
  ].join("|");
}

/**
 * Derive actionable exceptions from a set of bank transactions
 * (deterministic, read-time — nothing is persisted). A txn is an
 * exception while it is not matched/journaled; the reasons explain why.
 * Duplicate detection compares account+date+amount+counterparty across
 * the provided rows and flags every row after the first.
 */
export function deriveStatementExceptions(
  txns: Array<typeof atelierBankTransaction.$inferSelect>,
): StatementExceptionRow[] {
  const seen = new Map<string, string>(); // dupKey -> first txn id
  const sorted = [...txns].sort((a, b) =>
    (a.createdAt?.getTime?.() ?? 0) - (b.createdAt?.getTime?.() ?? 0) || a.id.localeCompare(b.id));
  const dupIds = new Set<string>();
  for (const t of sorted) {
    if (t.deletedAt) continue;
    const k = dupKey(t);
    if (seen.has(k)) dupIds.add(t.id);
    else seen.set(k, t.id);
  }
  const out: StatementExceptionRow[] = [];
  for (const t of sorted) {
    if (t.deletedAt || RESOLVED_STATES.has(t.matchedState)) continue;
    const reasons: StatementExceptionReason[] = [];
    const details: string[] = [];
    if (t.matchedState === "parked") {
      reasons.push("flagged");
      if (t.parkedReason) details.push(`Parked: ${t.parkedReason}`);
    }
    const p = t.matchProposal as {
      type?: string;
      candidates?: Array<{ appliedAmount?: number; amount?: number; invoiceOutstanding?: number }>;
    } | null;
    const candidates = p?.candidates ?? [];
    if (candidates.length === 0) {
      reasons.push("no_match");
      details.push(t.amount > 0 ? "No open invoice candidate" : "No payment-source candidate");
    } else if (t.matchedState === "proposed") {
      const top = candidates[0];
      const candAmt = typeof top.appliedAmount === "number" ? top.appliedAmount
        : typeof top.amount === "number" ? top.amount : null;
      const outstanding = typeof top.invoiceOutstanding === "number" ? top.invoiceOutstanding : null;
      if (candAmt !== null && Math.abs(Math.abs(t.amount) - candAmt) > 0.01) {
        reasons.push("amount_mismatch");
        details.push(`Bank ${Math.abs(t.amount).toFixed(2)} vs candidate ${candAmt.toFixed(2)}`);
      } else if (outstanding !== null && Math.abs(Math.abs(t.amount) - outstanding) > 0.01) {
        reasons.push("amount_mismatch");
        details.push(`Bank ${Math.abs(t.amount).toFixed(2)} vs invoice outstanding ${outstanding.toFixed(2)}`);
      } else {
        reasons.push("unreviewed_proposal");
        details.push("Match proposed — awaiting confirmation");
      }
    }
    if (dupIds.has(t.id)) {
      reasons.push("duplicate");
      details.push("Same account/date/amount/counterparty as another row");
    }
    if (reasons.length === 0) reasons.push("no_match");
    out.push({ txn: t, reasons, detail: details.join(" · ") || null });
  }
  return out;
}

/** Matched vs unmatched roll-up for a reconciliation period's txns. */
export function summarizeReconTxns(
  txns: Array<typeof atelierBankTransaction.$inferSelect>,
): ReconTxnSummary {
  const live = txns.filter((t) => !t.deletedAt);
  const matched = live.filter((t) => RESOLVED_STATES.has(t.matchedState));
  const unmatched = live.filter((t) => !RESOLVED_STATES.has(t.matchedState));
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return {
    txnCount: live.length,
    matchedCount: matched.length,
    unmatchedCount: unmatched.length,
    matchedTotal: r2(matched.reduce((s, t) => s + Math.abs(t.amount), 0)),
    unmatchedTotal: r2(unmatched.reduce((s, t) => s + Math.abs(t.amount), 0)),
    openExceptions: deriveStatementExceptions(live).length,
  };
}

/** Auto-run the matcher across every unmatched txn of one statement import. */
export async function autoMatchImport(args: {
  orgId: string;
  statementImportId: string;
  triggeredByUserId: string | null;
  actorLabel: string;
}): Promise<AutoMatchSummary> {
  const { orgId, statementImportId } = args;
  const summary: AutoMatchSummary = {
    receiptsCreated: 0, inflowProposals: 0, outflowProposals: 0, skipped: 0, errors: [],
  };
  const txns = await db.select().from(atelierBankTransaction).where(and(
    eq(atelierBankTransaction.orgId, orgId),
    eq(atelierBankTransaction.statementImportId, statementImportId),
    eq(atelierBankTransaction.matchedState, "unmatched"),
    isNull(atelierBankTransaction.deletedAt),
  ));
  // Backfill entity tags from the bank account once per import.
  const acctIds = [...new Set(txns.map((t) => t.bankAccountId))];
  const accts = acctIds.length > 0
    ? await db.select().from(atelierBankAccount).where(inArray(atelierBankAccount.id, acctIds))
    : [];
  const acctEntity = new Map(accts.map((a) => [a.id, a.legalEntityId]));

  const openInvoices = (await db.select().from(atelierInvoice)
    .where(and(eq(atelierInvoice.orgId, orgId), isNull(atelierInvoice.deletedAt))))
    .filter((i) => i.total - i.amountPaid > 0.01);

  for (const txn of txns) {
    try {
      const entityId = txn.legalEntityId ?? acctEntity.get(txn.bankAccountId) ?? null;
      if (!txn.legalEntityId && entityId) {
        await db.update(atelierBankTransaction).set({ legalEntityId: entityId, updatedAt: new Date() })
          .where(eq(atelierBankTransaction.id, txn.id));
      }
      if (txn.kind === "receipt" && txn.amount > 0) {
        // Ensure a cash receipt exists (idempotent via unique index).
        let receiptId: string;
        const existing = await db.select({ id: atelierCashReceipt.id }).from(atelierCashReceipt)
          .where(and(eq(atelierCashReceipt.orgId, orgId), eq(atelierCashReceipt.bankTransactionId, txn.id)));
        if (existing.length > 0) {
          receiptId = existing[0].id;
        } else {
          receiptId = rid("rcpt");
          await db.insert(atelierCashReceipt).values({
            id: receiptId, orgId, bankTransactionId: txn.id,
            totalAmount: txn.amount, appliedAmount: 0, currency: txn.currency,
            receivedAt: txn.postedDate, createdByUserId: args.triggeredByUserId,
            notes: "Auto-created on statement import (Cash Application Matcher)",
          });
          summary.receiptsCreated++;
        }
        const out = await runCashApplicationMatcher({
          receipt: {
            id: receiptId, totalAmount: txn.amount, currency: txn.currency,
            counterpartyNameRaw: txn.counterpartyNameRaw, referenceRaw: txn.referenceRaw,
            postedDate: txn.postedDate,
          },
          openInvoices: openInvoices.filter((i) => entityCompatible(entityId, i.legalEntityId)).map((i) => ({
            id: i.id, invoiceNumber: i.invoiceNumber,
            billToName: (i.billTo as { name?: string } | null)?.name ?? null,
            currency: i.currency, total: i.total, amountPaid: i.amountPaid, dueDate: i.dueDate,
          })),
          triggeredByUserId: args.triggeredByUserId, actorLabel: args.actorLabel,
        });
        await db.update(atelierBankTransaction).set({
          matchProposal: {
            type: "inflow", cashReceiptId: receiptId,
            recommended: out.output.recommended,
            candidates: out.output.candidates,
            rationaleSummary: out.output.rationaleSummary,
            proposedAt: new Date().toISOString(),
          },
          matchedState: out.output.candidates.length > 0 ? "proposed" : "unmatched",
          matchRunId: out.runId,
          updatedAt: new Date(),
        }).where(eq(atelierBankTransaction.id, txn.id));
        if (out.output.candidates.length > 0) summary.inflowProposals++;
        else summary.skipped++;
      } else if (txn.amount < 0) {
        const candidates = await proposeOutflowCandidates({
          orgId, counterpartyNameRaw: txn.counterpartyNameRaw, amountAbs: Math.abs(txn.amount),
          entityId,
        });
        await db.update(atelierBankTransaction).set({
          matchProposal: {
            type: "outflow", candidates, proposedAt: new Date().toISOString(),
          },
          matchedState: candidates.length > 0 ? "proposed" : "unmatched",
          updatedAt: new Date(),
        }).where(eq(atelierBankTransaction.id, txn.id));
        if (candidates.length > 0) summary.outflowProposals++;
        else summary.skipped++;
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors.push(`${txn.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return summary;
}
