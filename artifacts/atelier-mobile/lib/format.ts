/**
 * Locale-aware value formatting shared across screens.
 */

const LOCALE_MAP: Record<string, string> = {
  en: "en-US",
  tr: "tr-TR",
  ar: "ar",
};

/** Currency-aware money formatter (e.g. "$1,234.50", "1.234,50 ₺"). */
export function formatMoney(
  amount: number,
  currency: string,
  lang: string = "en",
): string {
  const locale = LOCALE_MAP[lang] ?? lang;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency || "USD",
      currencyDisplay: "narrowSymbol",
    }).format(amount);
  } catch {
    try {
      return `${currency} ${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount)}`;
    } catch {
      return `${currency} ${amount.toFixed(2)}`;
    }
  }
}

/** Compact number: 1.2M / 3.4k / 12. */
export function formatCompact(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (!Number.isInteger(n)) return n.toFixed(1);
  return String(n);
}

/** Compact money: $1.2M / AED 3.4k. */
export function formatCompactMoney(n: number, currency?: string | null): string {
  const sym: Record<string, string> = { USD: "$", EUR: "€", GBP: "£" };
  const cur = (currency ?? "USD").toUpperCase();
  const compact = formatCompact(n);
  if (sym[cur]) return `${sym[cur]}${compact}`;
  return `${compact} ${cur}`;
}

/** ISO/date-ish string → localized short date; returns input when unparseable. */
export function formatDate(value: string, lang: string = "en"): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const locale = LOCALE_MAP[lang] ?? lang;
  try {
    return new Intl.DateTimeFormat(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(t));
  } catch {
    return value;
  }
}

export function looksLikeDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(s);
}
