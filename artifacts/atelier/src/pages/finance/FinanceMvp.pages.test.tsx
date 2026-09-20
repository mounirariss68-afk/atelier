import assert from "node:assert/strict";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import FinanceMvpOverview from "./FinanceMvpOverview";
import FinanceMvpMoneyOut from "./FinanceMvpMoneyOut";
import FinanceMvpMoneyIn, { summarizeMoneyInInvoices } from "./FinanceMvpMoneyIn";
import FinanceMvpReconcile from "./FinanceMvpReconcile";
import FinanceMvpReports from "./FinanceMvpReports";
import FinanceEntities from "./FinanceEntities";

(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () =>
  new Response(JSON.stringify({ items: [], invoices: [], data: { rows: [] } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;

function render(path: string, Page: React.ComponentType) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderToString(
    <QueryClientProvider client={client}>
      <Router ssrPath={path}>
        <Page />
      </Router>
    </QueryClientProvider>,
  );
}

const pages = [
  ["/finance", FinanceMvpOverview, "page-mvp-overview", "Financial overview"],
  ["/finance/entities", FinanceEntities, "Legal-entity registry", "Pre-formation cost pools"],
  ["/finance/money-out", FinanceMvpMoneyOut, "page-mvp-money-out", "Money out"],
  ["/finance/money-in", FinanceMvpMoneyIn, "page-mvp-money-in", "Money in"],
  ["/finance/reconcile", FinanceMvpReconcile, "page-mvp-reconcile", "Bank reconciliation"],
  ["/finance/reports", FinanceMvpReports, "page-mvp-reports", "Performance reports"],
] as const;

for (const [path, Page, marker, heading] of pages) {
  const html = render(path, Page);
  assert.ok(html.includes(marker), `${path} must render its page marker`);
  assert.ok(html.includes(heading), `${path} must render its founder-facing heading`);
  assert.ok(!html.includes("CFO morning view"), `${path} must not render the advanced CFO landing`);
}

const summary = summarizeMoneyInInvoices([
  { status: "draft", total: 900, amountPaid: 0, dueDate: "2026-01-01" },
  { status: "issued", total: 1000, amountPaid: 250, dueDate: "2026-09-10" },
  { status: "issued", total: "500", amountPaid: "0", dueDate: "2026-10-10" },
  { status: "paid", total: 700, amountPaid: 700, dueDate: "2026-08-10" },
  { status: "voided", total: 300, amountPaid: 0, dueDate: "2026-08-10" },
], "2026-09-20");
assert.deepEqual(summary, {
  totalCount: 3,
  openCount: 2,
  overdueCount: 1,
  totalOutstandingUsd: 1250,
  totalPaidUsd: 950,
});

const noTrading = summarizeMoneyInInvoices([
  { status: "draft", total: 1000, amountPaid: 0, dueDate: null },
  { status: "voided", total: 500, amountPaid: 0, dueDate: null },
]);
assert.equal(noTrading.totalCount, 0, "draft and voided invoices must preserve the pre-revenue state");

console.log("finance MVP page probes ✓ — six pages render and invoice states match the API contract");