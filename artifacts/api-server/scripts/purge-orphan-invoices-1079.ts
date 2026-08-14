/**
 * Task #1079 — purge orphaned invoices whose parent account no longer exists.
 *
 * Context: test scripts (root cause tracked separately in Task #56) deleted
 * whole CRM accounts and left 13 USD 1,000 "issued" test invoices behind
 * (created 2026-07-17, no invoice number, no engagement). Their account_id
 * pointed at atelier_accounts rows that no longer existed, so they polluted
 * the Bookkeeper source scan and Bill & Collect and could never be opened.
 *
 * This script is the committed, reviewable form of that cleanup. It is
 * idempotent and safe to re-run (e.g. on production before go-live):
 *   1. Enumerates invoices whose account_id is set but resolves to no
 *      existing atelier_accounts row (archived/soft-deleted accounts still
 *      count as existing — their invoices are NOT touched).
 *   2. In one transaction, applies an explicit dependency policy and then
 *      deletes the invoices themselves:
 *        DELETE — invoice lines, e-invoice submissions, collections drafts,
 *                 dunning events, promises-to-pay, cash applications, GL
 *                 posting exceptions (source_kind='invoice') and GL journal
 *                 entries + lines posted from these invoices
 *                 (source_kind='invoice'): all of this data is derived from
 *                 the bogus invoices and is equally meaningless without them.
 *                 Journals posted from an orphaned test invoice would
 *                 otherwise overstate AR / deferred revenue.
 *        UNLINK — billing triggers: the trigger row has its own lifecycle
 *                 (milestone/period-end schedule), so it is preserved and
 *                 only its invoice_id reference is cleared.
 *   3. Writes a single system-actor atelier_audit_events row
 *      (action `wallet.invoice.orphan_purged`, see auditContract.ts)
 *      recording ids, per-invoice snapshot and rationale.
 *   4. No-ops (and writes no audit row) when there is nothing to purge.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx scripts/purge-orphan-invoices-1079.ts
 *
 * Executed against the development database on 2026-08-14 (13 rows removed;
 * audit row aud_20260814113856_orphanpurge carries the same payload shape).
 */
import { sql, inArray, eq, and } from "drizzle-orm";
import {
  db,
  atelierInvoice,
  atelierInvoiceLine,
  atelierEinvoiceSubmission,
  atelierCollectionsDraft,
  atelierDunningEvent,
  atelierPromiseToPay,
  atelierCashApplication,
  atelierBillingTrigger,
  atelierGlPostingException,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierAuditEvents,
} from "@workspace/db";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function main() {
  // 1. Enumerate: invoice references an account id that no longer exists.
  const orphans = await db
    .select()
    .from(atelierInvoice)
    .where(sql`${atelierInvoice.accountId} IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM atelier_accounts a WHERE a.id = ${atelierInvoice.accountId}
    )`);

  const total = (await db.select({ n: sql<number>`count(*)` }).from(atelierInvoice))[0].n;
  console.log(`Invoices total: ${total}; orphaned (missing parent account): ${orphans.length}`);
  if (orphans.length === 0) {
    console.log("Nothing to purge — no invoice references a missing account.");
    return;
  }
  for (const o of orphans) {
    console.log(`  ${o.id} account=${o.accountId} status=${o.status} ${o.currency} ${o.total} created=${o.createdAt?.toISOString()}`);
  }

  const ids = orphans.map((o) => o.id);

  // 2+3. Cascade-safe delete + audit in one transaction.
  await db.transaction(async (tx) => {
    const lines = await tx.delete(atelierInvoiceLine)
      .where(inArray(atelierInvoiceLine.invoiceId, ids)).returning({ id: atelierInvoiceLine.id });
    const subs = await tx.delete(atelierEinvoiceSubmission)
      .where(inArray(atelierEinvoiceSubmission.invoiceId, ids)).returning({ id: atelierEinvoiceSubmission.id });
    const drafts = await tx.delete(atelierCollectionsDraft)
      .where(inArray(atelierCollectionsDraft.invoiceId, ids)).returning({ id: atelierCollectionsDraft.id });
    const dunning = await tx.delete(atelierDunningEvent)
      .where(inArray(atelierDunningEvent.invoiceId, ids)).returning({ id: atelierDunningEvent.id });
    const promises = await tx.delete(atelierPromiseToPay)
      .where(inArray(atelierPromiseToPay.invoiceId, ids)).returning({ id: atelierPromiseToPay.id });
    const cashApps = await tx.delete(atelierCashApplication)
      .where(inArray(atelierCashApplication.invoiceId, ids)).returning({ id: atelierCashApplication.id });
    const glExc = await tx.delete(atelierGlPostingException)
      .where(and(
        eq(atelierGlPostingException.sourceKind, "invoice"),
        inArray(atelierGlPostingException.sourceRef, ids),
      )).returning({ id: atelierGlPostingException.id });
    // GL journals posted from these invoices are equally bogus — remove
    // entry + lines so AR / deferred revenue are not overstated.
    const glEntries = await tx.select({ id: atelierGlJournalEntry.id }).from(atelierGlJournalEntry)
      .where(and(
        eq(atelierGlJournalEntry.sourceKind, "invoice"),
        inArray(atelierGlJournalEntry.sourceRef, ids),
      ));
    const glEntryIds = glEntries.map((e) => e.id);
    const glLines = glEntryIds.length > 0
      ? await tx.delete(atelierGlJournalLine)
          .where(inArray(atelierGlJournalLine.journalEntryId, glEntryIds)).returning({ id: atelierGlJournalLine.id })
      : [];
    if (glEntryIds.length > 0) {
      await tx.delete(atelierGlJournalEntry).where(inArray(atelierGlJournalEntry.id, glEntryIds));
    }
    // Billing triggers keep their own lifecycle — unlink, don't delete.
    const unlinkedTriggers = await tx.update(atelierBillingTrigger)
      .set({ invoiceId: null, updatedAt: new Date() })
      .where(inArray(atelierBillingTrigger.invoiceId, ids)).returning({ id: atelierBillingTrigger.id });
    const deleted = await tx.delete(atelierInvoice)
      .where(inArray(atelierInvoice.id, ids)).returning({ id: atelierInvoice.id });

    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "invoice",
      entityId: `orphan_invoice_purge_${new Date().toISOString().slice(0, 10)}`,
      actorType: "system",
      actorId: "system",
      actorLabel: "System data cleanup",
      action: "wallet.invoice.orphan_purged",
      payload: {
        reason:
          "Task #1079: invoices referencing accounts that no longer exist (leftover test rows). " +
          "Purged so they stop polluting the Bookkeeper source scan and Bill & Collect; " +
          "read surfaces additionally guard via invoiceAccountResolves().",
        count: deleted.length,
        invoiceIds: deleted.map((d) => d.id),
        invoices: orphans.map((o) => ({
          id: o.id, accountId: o.accountId, status: o.status,
          currency: o.currency, total: o.total, createdAt: o.createdAt,
        })),
        children: {
          lines: lines.length, einvoiceSubmissions: subs.length,
          collectionsDrafts: drafts.length, dunningEvents: dunning.length,
          promisesToPay: promises.length, cashApplications: cashApps.length,
          glPostingExceptions: glExc.length, glJournalEntries: glEntryIds.length,
          glJournalLines: glLines.length, billingTriggersUnlinked: unlinkedTriggers.length,
        },
      },
      payloadSummary: `Purged ${deleted.length} orphaned invoice(s) whose parent account no longer exists (plus ${lines.length} lines, ${subs.length} e-invoice submissions, ${drafts.length} collections drafts, ${dunning.length} dunning events, ${promises.length} promises-to-pay, ${cashApps.length} cash applications, ${glExc.length} GL exceptions, ${glEntryIds.length} GL journal entries; ${unlinkedTriggers.length} billing triggers unlinked).`,
    });

    console.log(`Deleted ${deleted.length} invoices; children: ${lines.length} lines, ${subs.length} e-invoice submissions, ${drafts.length} collections drafts, ${dunning.length} dunning events, ${promises.length} promises-to-pay, ${cashApps.length} cash applications, ${glExc.length} GL exceptions, ${glEntryIds.length} GL journal entries (+${glLines.length} lines); ${unlinkedTriggers.length} billing triggers unlinked. Audit row written.`);
  });

  const remaining = await db.select({ n: sql<number>`count(*)` }).from(atelierInvoice)
    .where(sql`${atelierInvoice.accountId} IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM atelier_accounts a WHERE a.id = ${atelierInvoice.accountId}
    )`);
  console.log(`Remaining orphans after purge: ${remaining[0].n}`);
  if (Number(remaining[0].n) !== 0) throw new Error("orphans remain after purge — investigate");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
