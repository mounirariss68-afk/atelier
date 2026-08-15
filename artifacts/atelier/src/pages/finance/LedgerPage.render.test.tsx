/**
 * Render probe for the merged GL "Needs attention" tab (Task #1199).
 *
 * Prefills the react-query cache (SSR can't await fetches or click) and
 * asserts:
 *  1. LedgerPage renders the merged tab with a combined open-items count
 *     (exceptions + untagged) and no separate Exceptions/Untagged tabs.
 *  2. NeedsAttentionTab renders BOTH labeled sections — exceptions with
 *     resolve action, untagged with proposal approve/change UI.
 *  3. A proposed row shows entity + confidence + justification and an
 *     Approve button; a needs_input row shows the plain picker chip.
 *  4. All-clear state when both feeds are empty.
 *
 * Run: npx tsx --tsconfig tsconfig.test.json src/pages/finance/LedgerPage.render.test.tsx
 */
import * as React from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";

// Stub fetch before importing the page: anything uncached resolves empty.
(globalThis as unknown as { fetch: typeof fetch }).fetch = (async () => {
  return new Response(JSON.stringify({ ok: true, data: { rows: [] }, items: [] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

const { default: LedgerPage, NeedsAttentionTab } = await import("./LedgerPage");

const ENTITIES = [
  { id: "ent_ae", shortName: "AE Entity" },
  { id: "ent_sa", shortName: "SA Entity" },
];
const EXCEPTION_ROWS = [{
  id: "exc1", code: "allocation_pending", sourceKind: "expense", periodLabel: "2026-08",
  message: "Allocation is proposed but not yet approved.", status: "open",
  updatedAt: new Date().toISOString(), sourceLabel: null, sourceHref: null,
}];
const UNTAGGED_ROWS = [
  {
    kind: "invoice", id: "inv1", label: "INV-100", amount: 1000, currency: "SAR",
    date: "2026-08-01", sourceHref: null,
    allocStatus: "proposed", allocRuleId: "engagement_entity",
    allocJustification: "Invoice issued under an engagement contracted by SA Entity.",
    allocConfidence: 0.95, allocDecidedBy: "deterministic", proposedEntityId: "ent_sa",
  },
  {
    kind: "bank_transaction", id: "bt1", label: "Mystery Inc · 2026-08-06",
    amount: 999, currency: "USD", date: "2026-08-06", sourceHref: null,
    allocStatus: "needs_input", allocRuleId: null,
    allocJustification: null, allocConfidence: null, allocDecidedBy: null,
    proposedEntityId: null,
  },
];

function makeClient(withRows: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["atelier-gl-exceptions", "open"],
    { ok: true, data: { rows: withRows ? EXCEPTION_ROWS : [] } });
  client.setQueryData(["atelier-gl-untagged"],
    { ok: true, data: { rows: withRows ? UNTAGGED_ROWS : [] } });
  client.setQueryData(["atelier-v5", "legal-entities", false],
    { items: ENTITIES.map((e) => ({ ...e, legalNameEn: e.shortName, country: "AE", status: "active" })) });
  return client;
}

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`ok  - ${name}`);
  else { failures++; console.error(`FAIL - ${name}`); }
}

// ---- 1. Full page: merged tab + combined count ----
const pageHtml = renderToString(
  <QueryClientProvider client={makeClient(true)}>
    <Router ssrPath="/finance/ledger">
      <LedgerPage />
    </Router>
  </QueryClientProvider>,
);
check("page renders", pageHtml.includes("page-finance-ledger"));
check("merged Needs attention tab present", pageHtml.includes("tab-needs-attention"));
check("old Exceptions tab removed", !pageHtml.includes('data-testid="tab-exceptions"'));
check("old Untagged tab removed", !pageHtml.includes('data-testid="tab-untagged"'));
check("combined open count = 3 (1 exception + 2 untagged)",
  /data-testid="count-needs-attention"[^>]*>3</.test(pageHtml));

// ---- 2. Tab content: both sections, proposal UI ----
const tabHtml = renderToString(
  <QueryClientProvider client={makeClient(true)}>
    <Router ssrPath="/finance/ledger">
      <NeedsAttentionTab entities={ENTITIES} onChanged={() => {}} />
    </Router>
  </QueryClientProvider>,
);
check("exceptions section rendered", tabHtml.includes("section-exceptions") && tabHtml.includes("Posting exceptions"));
check("untagged section rendered", tabHtml.includes("section-untagged") && tabHtml.includes("Untagged items"));
check("exception row + resolve action", tabHtml.includes("exception-exc1") && tabHtml.includes("button-resolve-exc1"));
check("proposed row shows entity + confidence chip",
  tabHtml.includes("chip-proposed-inv1") && tabHtml.includes("SA Entity") && tabHtml.includes("95%"));
check("proposed row shows rule + justification",
  tabHtml.includes("engagement_entity") && tabHtml.includes("Invoice issued under an engagement"));
check("proposed row has one-click Approve", /data-testid="button-approve-inv1"[^>]*>Approve</.test(tabHtml));
check("needs_input row flagged with plain picker",
  tabHtml.includes("chip-needs-input-bt1") && tabHtml.includes("select-tag-bt1") &&
  /data-testid="button-approve-bt1"[^>]*>Assign</.test(tabHtml));
check("entity select offered on proposed row too", tabHtml.includes("select-tag-inv1"));

// ---- 3. All-clear when both feeds are empty ----
const emptyHtml = renderToString(
  <QueryClientProvider client={makeClient(false)}>
    <Router ssrPath="/finance/ledger">
      <NeedsAttentionTab entities={ENTITIES} onChanged={() => {}} />
    </Router>
  </QueryClientProvider>,
);
check("single all-clear state when both empty", emptyHtml.includes("needs-attention-all-clear"));
check("no count badge when nothing open", !renderToString(
  <QueryClientProvider client={makeClient(false)}>
    <Router ssrPath="/finance/ledger"><LedgerPage /></Router>
  </QueryClientProvider>,
).includes("count-needs-attention"));

if (failures > 0) {
  console.error(`${failures} check(s) failed`);
  process.exit(1);
}
console.log("All render checks passed.");
