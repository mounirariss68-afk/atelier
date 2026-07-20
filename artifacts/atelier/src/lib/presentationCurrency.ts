/**
 * Shared presentation-currency selection (Task #296).
 *
 * The finance/CFO surfaces (Finance Home, Plan pages, Reports) present
 * consolidated numbers in a single user-selectable presentation currency.
 * USD is the default. The selection persists per browser via localStorage
 * so it follows the user across pages and sessions.
 */
import * as React from "react";

export const PRESENTATION_CURRENCIES = ["USD", "GBP", "EUR", "AED", "SAR"] as const;
export type PresentationCurrency = (typeof PRESENTATION_CURRENCIES)[number];

export const DEFAULT_PRESENTATION_CURRENCY: PresentationCurrency = "USD";

const STORAGE_KEY = "atelier.finance.presentationCurrency";

export function isPresentationCurrency(v: string | null | undefined): v is PresentationCurrency {
  return !!v && (PRESENTATION_CURRENCIES as readonly string[]).includes(v);
}

export function getStoredPresentationCurrency(): PresentationCurrency {
  if (typeof window === "undefined") return DEFAULT_PRESENTATION_CURRENCY;
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isPresentationCurrency(v) ? v : DEFAULT_PRESENTATION_CURRENCY;
  } catch {
    return DEFAULT_PRESENTATION_CURRENCY;
  }
}

export function setStoredPresentationCurrency(v: string) {
  if (typeof window === "undefined") return;
  try {
    if (isPresentationCurrency(v)) window.localStorage.setItem(STORAGE_KEY, v);
  } catch {
    // storage unavailable (private mode etc.) — selection just won't persist
  }
}

/** Stateful hook: presentation currency with cross-session persistence. */
export function usePresentationCurrency(): [PresentationCurrency, (v: string) => void] {
  const [ccy, setCcy] = React.useState<PresentationCurrency>(() => getStoredPresentationCurrency());
  const update = React.useCallback((v: string) => {
    if (!isPresentationCurrency(v)) return;
    setStoredPresentationCurrency(v);
    setCcy(v);
  }, []);
  return [ccy, update];
}

const SYMBOLS: Record<string, string> = { USD: "$", GBP: "£", EUR: "€" };

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? `${code} `;
}

/** Compact money formatter shared by finance plan pages. */
export function fmtPresentationMoney(n: number | null | undefined, currency: string): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const sym = currencySymbol(currency);
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(2)}m`;
  if (abs >= 1_000) return `${sign}${sym}${(abs / 1_000).toFixed(0)}k`;
  return `${sign}${sym}${abs.toFixed(0)}`;
}
