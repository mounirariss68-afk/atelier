/**
 * Task #827/#830 — node-safe money aggregation shared by the Expenses
 * month list and ExpenseCharts. Server rows carry a `display` block
 * already converted into the user's display currency; queued offline
 * drafts have no server FX yet, so they only count when already in the
 * display currency and otherwise mark the total as approximate.
 */
import type { AtelierSelfExpense } from "@workspace/api-client-react";

/** Amount of a server expense row in the user's display currency. */
export function displayAmountOf(e: AtelierSelfExpense): number {
  return e.display?.amount ?? (e.currency === "USD" ? e.amount : (e.usdAmount ?? 0));
}

export interface QueuedMoney {
  amount: number;
  currency?: string | null;
}

export interface MonthTotal {
  sum: number;
  approx: boolean;
}

/** Month-header total for a group of server rows + queued drafts. */
export function computeMonthTotal(
  expenses: AtelierSelfExpense[],
  queued: QueuedMoney[],
  displayCurrency: string,
): MonthTotal {
  let sum = 0;
  let approx = false;
  for (const e of expenses) {
    if (e.display) {
      sum += e.display.amount;
      if (e.display.converted) approx = true;
    } else if (e.currency === displayCurrency) {
      sum += e.amount;
    } else {
      approx = true;
    }
  }
  for (const q of queued) {
    if ((q.currency ?? "USD") === displayCurrency) {
      sum += q.amount;
    } else {
      approx = true;
    }
  }
  return { sum, approx };
}
