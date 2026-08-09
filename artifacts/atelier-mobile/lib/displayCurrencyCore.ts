/**
 * Task #827/#830 — node-safe core of the display-currency preference flow.
 *
 * The Expenses screen renders month totals/charts straight out of the
 * cached `useAtelierListMyExpenses` data, so changing the preference MUST
 * invalidate that query or totals stay in the old currency until an app
 * restart. Keeping the PATCH + invalidation pair here (no react-native
 * imports) lets tests/display-currency-probe.ts pin the behaviour.
 */
import type { QueryClient } from "@tanstack/react-query";
import { getAtelierListMyExpensesQueryKey } from "@workspace/api-client-react";

/** Minimal shape of lib/api's apiJson that this flow needs. */
export type PreferencesApi = <T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown },
) => Promise<T>;

export const PREFERENCES_PATH = "/api/atelier/me/preferences";

export interface PreferencesResponse {
  displayCurrency: string;
  supportedCurrencies: string[];
}

export function fetchDisplayCurrency(api: PreferencesApi): Promise<PreferencesResponse> {
  return api<PreferencesResponse>(PREFERENCES_PATH);
}

/**
 * Persist the new display currency, then invalidate the cached expense
 * list so month headers/charts refetch in the new currency immediately.
 * Throws (without invalidating) when the PATCH fails so callers can
 * revert their optimistic state.
 */
export async function changeDisplayCurrency(
  api: PreferencesApi,
  queryClient: QueryClient,
  next: string,
): Promise<void> {
  await api(PREFERENCES_PATH, { method: "PATCH", body: { displayCurrency: next } });
  // Expenses totals/charts are derived from the cached expense list —
  // refetch it so the new currency applies immediately.
  await queryClient.invalidateQueries({ queryKey: getAtelierListMyExpensesQueryKey() });
}
