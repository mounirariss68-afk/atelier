import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LENSES } from "./lens";

const finance = LENSES.find((lens) => lens.id === "finance");
assert.ok(finance, "Finance lens must exist");
assert.deepEqual(
  finance.sections.map(({ id, label, href }) => ({ id, label, href })),
  [
    { id: "overview", label: "Overview", href: "/finance" },
    { id: "entities", label: "Entities", href: "/finance/entities" },
    { id: "money-out", label: "Money out", href: "/finance/money-out" },
    { id: "money-in", label: "Money in", href: "/finance/money-in" },
    { id: "reconcile", label: "Reconcile", href: "/finance/reconcile" },
    { id: "reports", label: "Reports", href: "/finance/reports" },
  ],
  "Finance navigation must expose exactly the six MVP destinations",
);

const appPath = fileURLToPath(new URL("../App.tsx", import.meta.url));
const app = readFileSync(appPath, "utf8");
for (const route of [
  '<Route path="/finance" component={FinanceMvpOverview} />',
  '<Route path="/finance/money-out" component={FinanceMvpMoneyOut} />',
  '<Route path="/finance/money-in" component={FinanceMvpMoneyIn} />',
  '<Route path="/finance/reconcile" component={FinanceMvpReconcile} />',
  '<Route path="/finance/reports" component={FinanceMvpReports} />',
  '<Route path="/wallet">{() => <Redirect to="/finance/money-out" />}</Route>',
  '<Route path="/finance/billing">{() => <Redirect to="/finance/money-in" />}</Route>',
  '<Route path="/finance/payables">{() => <Redirect to="/finance/money-out" />}</Route>',
  '<Route path="/finance/close">{() => <Redirect to="/finance/reconcile" />}</Route>',
]) {
  assert.ok(app.includes(route), `Missing MVP route contract: ${route}`);
}

for (const retainedDetail of [
  '<Route path="/wallet/expenses/:id" component={WalletExpenseDetail} />',
  '<Route path="/wallet/invoices/:id" component={WalletInvoiceDetail} />',
  '<Route path="/finance/entities/:id" component={FinanceEntityDetail} />',
  '<Route path="/finance/reports/pnl" component={FinanceReportsPnl} />',
]) {
  assert.ok(app.includes(retainedDetail), `Legacy detail route was removed: ${retainedDetail}`);
}

console.log("finance MVP routing probe ✓ — six destinations, safe redirects, and detail compatibility");