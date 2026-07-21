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
