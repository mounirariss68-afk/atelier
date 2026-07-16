import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Known currency symbols that hug the number; every other ISO code
// (AED, SAR, TRY, …) gets a trailing code so the currency is never
// silently mis-shown as dollars.
const MONEY_SYMBOL: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

/**
 * Currency-aware compact money formatter. Large values collapse to k/M so
 * pipeline cards stay compact. Unknown currency codes are suffixed rather
 * than fabricated into a dollar symbol.
 *
 * NB: opportunity deal sizes are stored normalised in USD (`dealSizeUsd`).
 * When an account's `primaryCurrency` differs we still pass USD here and
 * label it USD — we never fabricate an FX conversion. Callers that have an
 * account currency to display should pass it explicitly.
 */
export function fmtMoney(n: number, currency: string = "USD"): string {
  const cur = (currency || "USD").toUpperCase();
  const sym = MONEY_SYMBOL[cur];
  const abs = Math.abs(n);
  let body: string;
  if (abs >= 1_000_000) body = `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  else if (abs >= 1_000) body = `${(n / 1_000).toFixed(0)}k`;
  else body = `${Math.round(n)}`;
  return sym ? `${sym}${body}` : `${body} ${cur}`;
}

/** Exact, locale-grouped money string for tooltips (e.g. "$250,000"). */
export function fmtMoneyExact(n: number, currency: string = "USD"): string {
  const cur = (currency || "USD").toUpperCase();
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${Math.round(n)} ${cur}`;
  }
}
