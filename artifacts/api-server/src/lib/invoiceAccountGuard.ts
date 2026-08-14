/**
 * Task #1079 — orphaned-invoice guard.
 *
 * Test scripts once deleted whole accounts and left invoices behind that
 * referenced accounts which no longer existed. Those rows polluted the
 * Bookkeeper source scan and Bill & Collect and could never be opened.
 * The leftovers were purged (see audit action wallet.invoice.orphan_purged);
 * this predicate keeps any future orphan out of invoice read surfaces.
 *
 * Semantics: an invoice is visible when it has no account reference at all
 * (legacy/manual rows) or its account row still EXISTS. Archived (soft-
 * deleted) accounts still count as existing — archive is reversible and
 * their invoices must remain reachable.
 */
import { sql, type SQL } from "drizzle-orm";
import { atelierInvoice, atelierAccounts } from "@workspace/db";

/** WHERE fragment: the invoice's parent account reference resolves (or is absent). */
export function invoiceAccountResolves(): SQL {
  return sql`(${atelierInvoice.accountId} IS NULL OR EXISTS (
    SELECT 1 FROM ${atelierAccounts}
    WHERE ${atelierAccounts.id} = ${atelierInvoice.accountId}
  ))`;
}
