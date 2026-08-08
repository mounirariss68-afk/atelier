// Task #789 — shared name → entity resolution for the finance chat verbs.
// Dunning/invoice/renewal tools historically demanded raw invoiceId /
// accountId; these helpers resolve free text ("the overdue invoice for
// Acme") against org-scoped pools and hand back the standard ranked
// disambiguation / friendly-miss contract used everywhere else in chat.

import { and, eq, isNull } from "drizzle-orm";
import { db, atelierAccounts, atelierInvoice, atelierOpportunities } from "@workspace/db";
import { foldRosterName } from "./chat-normalizers.js";
import { rankNearestNames } from "./nearest-suggestions.js";

export type FinanceResolveOption = { id: string; label: string; secondary?: string };

export type FinanceResolution<T> =
  | { outcome: "match"; row: T }
  | { outcome: "ambiguous"; prompt: string; options: FinanceResolveOption[] }
  | { outcome: "not_found"; message: string; options?: FinanceResolveOption[] };

const fold = (s: string | null | undefined) => foldRosterName(String(s ?? ""));

function pick<T extends { id: string }>(
  q: string,
  pool: T[],
  names: (row: T) => Array<string | null | undefined>,
  toOption: (row: T) => FinanceResolveOption,
  labels: { thing: string; hint: string },
): FinanceResolution<T> {
  const needle = fold(q);
  const hits = needle.length >= 2
    ? pool.filter((r) => names(r).some((n) => n && fold(n).includes(needle)))
    : [];
  if (hits.length === 1) return { outcome: "match", row: hits[0] };
  if (hits.length > 1) {
    return {
      outcome: "ambiguous",
      prompt: `I found ${hits.length} ${labels.thing}s matching "${q}" — which one?`,
      options: rankOptions(q, hits, names, toOption, true),
    };
  }
  const near = rankOptions(q, pool, names, toOption, false).slice(0, 3);
  if (near.length > 0) {
    return {
      outcome: "not_found",
      message: `No ${labels.thing} matches "${q}" exactly — did you mean one of these?`,
      options: near,
    };
  }
  if (pool.length > 0) {
    const sample = pool.slice(0, 5).map((r) => toOption(r).label).join(", ");
    return {
      outcome: "not_found",
      message: `No ${labels.thing} matches "${q}". ${labels.hint} include: ${sample}.`,
    };
  }
  return {
    outcome: "not_found",
    message: `No ${labels.thing} matches "${q}" — there are none to pick from right now.`,
  };
}

function rankOptions<T extends { id: string }>(
  q: string,
  pool: T[],
  names: (row: T) => Array<string | null | undefined>,
  toOption: (row: T) => FinanceResolveOption,
  // Only exact (ambiguous) hits may fall back to pool order — a total
  // miss must yield NO options so callers show friendly copy instead.
  fallbackToPoolOrder: boolean,
): FinanceResolveOption[] {
  const ranked = rankNearestNames(
    q,
    pool.flatMap((r) =>
      names(r)
        .filter((n): n is string => !!n)
        .map((n) => ({ id: r.id, label: n })),
    ),
    10,
  );
  const byId = new Map(pool.map((r) => [r.id, r]));
  const seen = new Set<string>();
  const out: FinanceResolveOption[] = [];
  for (const r of ranked) {
    if (seen.has(r.id)) continue;
    const row = byId.get(r.id);
    if (!row) continue;
    seen.add(r.id);
    out.push(toOption(row));
    if (out.length >= 5) break;
  }
  // Ambiguous exact hits must always yield options even if the ranker is
  // conservative — fall back to pool order.
  if (out.length === 0 && fallbackToPoolOrder) {
    for (const row of pool.slice(0, 5)) out.push(toOption(row));
  }
  return out;
}

// ---------------------------------------------------------------------
// Accounts by name
// ---------------------------------------------------------------------
export async function resolveAccountRefByName(
  q: string,
  orgId: string,
): Promise<FinanceResolution<{ id: string; name: string }>> {
  const pool = await db
    .select({ id: atelierAccounts.id, name: atelierAccounts.name })
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)));
  return pick(
    q,
    pool,
    (a) => [a.name],
    (a) => ({ id: a.id, label: a.name }),
    { thing: "account", hint: "Accounts" },
  );
}

// ---------------------------------------------------------------------
// Dunnable invoices by free text (invoice number, account or bill-to name)
// ---------------------------------------------------------------------
export type DunnableInvoiceRef = {
  id: string;
  invoiceNumber: string | null;
  customerName: string | null;
  billToName: string | null;
  outstanding: number;
};

export async function resolveDunnableInvoiceByText(
  q: string,
  orgId: string,
): Promise<FinanceResolution<DunnableInvoiceRef>> {
  const rows = await db
    .select({ inv: atelierInvoice, accountName: atelierAccounts.name })
    .from(atelierInvoice)
    .leftJoin(
      atelierAccounts,
      and(
        eq(atelierInvoice.accountId, atelierAccounts.id),
        eq(atelierAccounts.orgId, orgId),
        isNull(atelierAccounts.deletedAt),
      ),
    )
    .where(
      and(
        eq(atelierInvoice.orgId, orgId),
        eq(atelierInvoice.status, "issued"),
        isNull(atelierInvoice.deletedAt),
      ),
    );
  const pool = rows
    .map(({ inv, accountName }) => {
      const billTo = inv.billTo as { name?: string } | null;
      return {
        id: inv.id,
        invoiceNumber: inv.invoiceNumber ?? null,
        customerName: accountName ?? billTo?.name ?? null,
        billToName: billTo?.name ?? null,
        outstanding: Math.round((inv.total - inv.amountPaid) * 100) / 100,
      };
    })
    .filter((r) => r.outstanding > 0);
  return pick(
    q,
    pool,
    // Match/rank over ALL of the row's names: invoice number, live account
    // name, AND bill-to name (they can differ, e.g. billing entity).
    (r) => [r.invoiceNumber, r.customerName, r.billToName],
    (r) => ({
      id: r.id,
      label: r.invoiceNumber ?? r.id,
      secondary: r.customerName
        ? `${r.customerName} — ${r.outstanding} outstanding`
        : `${r.outstanding} outstanding`,
    }),
    { thing: "open invoice", hint: "Open invoices" },
  );
}

// ---------------------------------------------------------------------
// Opportunities by name (win/loss debrief lookup)
// ---------------------------------------------------------------------
export async function resolveOpportunityByName(
  q: string,
  orgId: string,
): Promise<FinanceResolution<{ id: string; name: string; accountId: string | null }>> {
  const pool = await db
    .select({
      id: atelierOpportunities.id,
      name: atelierOpportunities.name,
      accountId: atelierOpportunities.accountId,
    })
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.orgId, orgId), isNull(atelierOpportunities.deletedAt)));
  const byId = pool.find((o) => o.id === q);
  if (byId) return { outcome: "match", row: byId };
  return pick(
    q,
    pool,
    (o) => [o.name],
    (o) => ({ id: o.id, label: o.name }),
    { thing: "opportunity", hint: "Opportunities" },
  );
}
