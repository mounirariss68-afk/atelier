/**
 * Task #830 — regression probe for the mobile Settings → Expenses display
 * currency flow. Changing the preference must instantly re-render expense
 * month totals/charts in the new currency (no app restart), which relies
 * on changeDisplayCurrency() invalidating the cached expense list query.
 *
 *   1. Live query cache: a QueryObserver on the real expense-list query
 *      key sees a refetch (with EUR-converted rows) after
 *      changeDisplayCurrency("EUR"), and the recomputed month header /
 *      chart totals flip from "$" to "€" formatting.
 *   2. Ordering: the PATCH lands before the invalidation, so the refetch
 *      always reads the new preference.
 *   3. Failure: a failed PATCH throws and does NOT invalidate — the
 *      caller reverts optimistic state, cache stays coherent.
 *   4. Wiring guards: settings.tsx uses the shared hook, expenses.tsx and
 *      ExpenseCharts.tsx use the shared aggregation helpers, so a
 *      refactor can't silently bypass the tested path.
 *
 * Run: pnpm --filter @workspace/atelier-mobile run test:display-currency-client
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  getAtelierListMyExpensesQueryKey,
  type AtelierSelfExpense,
} from "@workspace/api-client-react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  changeDisplayCurrency,
  fetchDisplayCurrency,
  PREFERENCES_PATH,
  type PreferencesApi,
} from "../lib/displayCurrencyCore";
import { computeMonthTotal, displayAmountOf } from "../lib/expenseTotals";
import { formatMoney } from "../lib/format";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

// ---------------------------------------------------------------------------
// Fake server: preference state + expense rows converted like the API does.
// ---------------------------------------------------------------------------
const EUR_PER_USD = 0.9;
let serverCurrency = "USD";
let failNextPatch = false;
const calls: string[] = [];

// Two claims in the same month: one native-USD, one AED (always converted).
const baseRows = [
  { id: "e1", usd: 100, currency: "USD", amount: 100 },
  { id: "e2", usd: 50, currency: "AED", amount: 183.65 },
];

function serverRows(): AtelierSelfExpense[] {
  return baseRows.map((r) => {
    const converted = r.currency !== serverCurrency;
    const amount =
      serverCurrency === "USD" ? r.usd : Math.round(r.usd * EUR_PER_USD * 100) / 100;
    return {
      id: r.id,
      status: "submitted",
      category: "travel",
      currency: r.currency,
      amount: r.amount,
      usdAmount: r.usd,
      expenseDate: "2026-08-03",
      createdAt: "2026-08-03T09:00:00Z",
      display: { amount, currency: serverCurrency, converted },
    } as unknown as AtelierSelfExpense;
  });
}

const fakeApi: PreferencesApi = async <T,>(
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<T> => {
  const method = opts?.method ?? "GET";
  calls.push(`${method} ${path}`);
  if (path === PREFERENCES_PATH && method === "GET") {
    return {
      displayCurrency: serverCurrency,
      supportedCurrencies: ["USD", "EUR", "AED"],
    } as T;
  }
  if (path === PREFERENCES_PATH && method === "PATCH") {
    if (failNextPatch) {
      failNextPatch = false;
      throw new Error("HTTP 500");
    }
    serverCurrency = (opts?.body as { displayCurrency: string }).displayCurrency;
    return {} as T;
  }
  throw new Error(`unexpected ${method} ${path}`);
};

// ---------------------------------------------------------------------------
// The screen-shaped derivation: what the Expenses month header / charts show.
// ---------------------------------------------------------------------------
function renderedTotals(data: { expenses: AtelierSelfExpense[]; displayCurrency: string }) {
  const { sum } = computeMonthTotal(data.expenses, [], data.displayCurrency);
  const chartSum = data.expenses.reduce((a, e) => a + displayAmountOf(e), 0);
  return {
    header: formatMoney(sum, data.displayCurrency, "en"),
    chart: formatMoney(chartSum, data.displayCurrency, "en"),
  };
}

async function main() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const queryKey = getAtelierListMyExpensesQueryKey();
  // Mirrors useAtelierListMyExpenses(): same key, list endpoint fetch.
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: async () => {
      calls.push("GET /api/atelier/me/expenses");
      return { expenses: serverRows(), displayCurrency: serverCurrency };
    },
  });
  const snapshots: { expenses: AtelierSelfExpense[]; displayCurrency: string }[] = [];
  const unsubscribe = observer.subscribe((res) => {
    if (res.data) snapshots.push(res.data as (typeof snapshots)[number]);
  });

  // Initial load in USD.
  await new Promise((r) => setTimeout(r, 50));
  const prefs = await fetchDisplayCurrency(fakeApi);
  check("initial preference is USD", prefs.displayCurrency === "USD");
  const initial = snapshots.at(-1);
  check("initial list loaded", !!initial && initial.displayCurrency === "USD");
  const before = renderedTotals(initial!);
  check("month header renders in USD", before.header.includes("$"), before.header);
  check("charts render in USD", before.chart === before.header, before);

  // 1+2. Change to EUR — the cache observer must see EUR rows immediately.
  calls.length = 0;
  await changeDisplayCurrency(fakeApi, queryClient, "EUR");
  await new Promise((r) => setTimeout(r, 100));
  const after = snapshots.at(-1);
  check(
    "expense list refetched after currency change",
    calls.includes("GET /api/atelier/me/expenses"),
    calls,
  );
  check(
    "PATCH lands before the list refetch",
    calls.indexOf(`PATCH ${PREFERENCES_PATH}`) < calls.indexOf("GET /api/atelier/me/expenses"),
    calls,
  );
  check("observer sees new displayCurrency", after?.displayCurrency === "EUR", after);
  const totals = renderedTotals(after!);
  check("month header re-renders in EUR", totals.header.includes("€"), totals.header);
  check(
    "EUR total uses server-converted amounts",
    Math.abs(after!.expenses.reduce((a, e) => a + displayAmountOf(e), 0) - 135) < 0.01,
    totals,
  );
  check("charts re-render in EUR", totals.chart === totals.header, totals);
  check(
    "AED row marks total approximate",
    computeMonthTotal(after!.expenses, [], "EUR").approx === true,
  );

  // Queued offline drafts: only counted when already in the display currency.
  const q = computeMonthTotal([], [{ amount: 10, currency: "USD" }], "EUR");
  check("foreign queued draft excluded + approx", q.sum === 0 && q.approx === true, q);

  // 3. Failed PATCH: throws, no invalidation, cache untouched.
  calls.length = 0;
  failNextPatch = true;
  let threw = false;
  try {
    await changeDisplayCurrency(fakeApi, queryClient, "AED");
  } catch {
    threw = true;
  }
  await new Promise((r) => setTimeout(r, 100));
  check("failed PATCH throws (caller reverts optimistic state)", threw);
  check(
    "failed PATCH does not refetch the list",
    !calls.includes("GET /api/atelier/me/expenses"),
    calls,
  );
  check("cache still EUR after failed PATCH", snapshots.at(-1)?.displayCurrency === "EUR");

  unsubscribe();
  queryClient.clear();

  // 4. Wiring guards — the screens must keep using the tested modules.
  const read = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
  const settings = read("app/(tabs)/settings.tsx");
  check(
    "settings.tsx uses the shared useDisplayCurrency hook",
    settings.includes(`import { useDisplayCurrency } from "@/lib/displayCurrency"`) &&
      settings.includes("useDisplayCurrency()"),
  );
  const hook = read("lib/displayCurrency.ts");
  check(
    "useDisplayCurrency delegates to changeDisplayCurrency (invalidation path)",
    hook.includes("changeDisplayCurrency(apiJson, queryClient, next)"),
  );
  const expensesSrc = read("app/(tabs)/expenses.tsx");
  check(
    "expenses.tsx month headers use computeMonthTotal + query displayCurrency",
    expensesSrc.includes("computeMonthTotal(") &&
      expensesSrc.includes("query.data?.displayCurrency"),
  );
  const charts = read("components/ExpenseCharts.tsx");
  check(
    "ExpenseCharts uses shared displayAmountOf",
    charts.includes(`import { displayAmountOf } from "@/lib/expenseTotals"`),
  );

  if (failures > 0) {
    console.error(`\n${failures} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll display-currency client checks passed.");
}

main().catch((e) => {
  console.error("probe crashed:", e);
  process.exit(1);
});
