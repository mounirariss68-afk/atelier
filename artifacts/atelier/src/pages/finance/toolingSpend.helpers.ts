/**
 * Task #1251 — pure helpers for the Tooling spend (vendor cost allocation)
 * page. Kept separate from the React page so they can be unit-tested with
 * `tsx` without a DOM (mirrors the deep-link focus helper split).
 *
 *  - vendorKeyFromSupplier: supplier-name → vendorKey detection, matching
 *    the server rule (replit|anthropic|perplexity substring, else null).
 *  - splitsSumTo100 / splitPctError: percentage-row validation for the
 *    vendor split-rule editor (must sum to 100 ±0.01).
 *  - largestRemainderPcts: display-formats a set of raw percentages so the
 *    rounded integers still sum to 100 (largest-remainder / Hamilton).
 *  - parseFocusTarget: interprets the ?focus= deep-link param — "unmapped"
 *    scrolls to the mapping queue, anything else is an invoice id to open.
 *  - bucketNeedsRef: engagement/opportunity buckets require a bucketRef.
 */

export const TOOLING_VENDORS = ["replit", "anthropic", "perplexity", "openai"] as const;
export type VendorKey = (typeof TOOLING_VENDORS)[number];

// Task #1268 adds "account" (client — needs an account ref) and
// "ip_development" (ref-less) bucket types.
export type BucketType =
  | "engagement"
  | "opportunity"
  | "account"
  | "internal"
  | "overhead"
  | "ip_development";

/** Detect the vendorKey from a supplier name (case-insensitive substring).
 *  Returns null when the supplier is not a recognised tooling vendor. */
export function vendorKeyFromSupplier(name: string | null | undefined): VendorKey | null {
  if (!name) return null;
  const hay = name.toLowerCase();
  for (const v of TOOLING_VENDORS) {
    if (hay.includes(v)) return v;
  }
  if (hay.includes("chatgpt")) return "openai"; // mirrors server detectVendorKey
  return null;
}

/** True when a bucket requires an org-scoped bucketRef (engagement /
 *  opportunity / account id). Internal, overhead & IP development take no ref. */
export function bucketNeedsRef(bucketType: BucketType): boolean {
  return bucketType === "engagement" || bucketType === "opportunity" || bucketType === "account";
}

/** Sum of a set of pct values (NaN-safe). */
export function sumPct(pcts: ReadonlyArray<number>): number {
  return pcts.reduce((acc, p) => acc + (Number.isFinite(p) ? p : 0), 0);
}

/** Signed distance from 100 (positive = over-allocated). */
export function splitPctError(pcts: ReadonlyArray<number>): number {
  return sumPct(pcts) - 100;
}

/** Valid when the pcts sum to 100 within ±0.01 (server tolerance). */
export function splitsSumTo100(pcts: ReadonlyArray<number>): boolean {
  return Math.abs(splitPctError(pcts)) <= 0.01;
}

/**
 * Largest-remainder rounding: turn a set of raw percentages (assumed to
 * sum to ~100) into integer display percentages that STILL sum to exactly
 * 100, handing the leftover units to the rows with the largest fractional
 * parts. Used only for display chips; the wire keeps the raw pcts.
 */
export function largestRemainderPcts(pcts: ReadonlyArray<number>): number[] {
  const n = pcts.length;
  if (n === 0) return [];
  const clean = pcts.map((p) => (Number.isFinite(p) && p > 0 ? p : 0));
  const target = Math.round(sumPct(clean));
  const floors = clean.map((p) => Math.floor(p));
  let remaining = target - floors.reduce((a, b) => a + b, 0);
  // Rank rows by fractional part, descending; ties broken by index.
  const order = clean
    .map((p, i) => ({ i, frac: p - Math.floor(p) }))
    .sort((a, b) => (b.frac - a.frac) || (a.i - b.i));
  const out = floors.slice();
  let k = 0;
  while (remaining > 0 && k < order.length) {
    out[order[k].i] += 1;
    remaining -= 1;
    k += 1;
  }
  return out;
}

export type FocusTarget =
  | { kind: "unmapped" }
  | { kind: "invoice"; invoiceId: string }
  | { kind: "none" };

/** Parse the ?focus= deep-link value into a page action.
 *  "unmapped" → scroll to mapping queue; any other non-empty value → open
 *  that invoice's split panel; empty/null → nothing. */
export function parseFocusTarget(focus: string | null | undefined): FocusTarget {
  if (!focus) return { kind: "none" };
  if (focus === "unmapped") return { kind: "unmapped" };
  return { kind: "invoice", invoiceId: focus };
}

/** USD money formatter shared across the page (rounded, thousands sep). */
export function fmtUsd(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString()}`;
}
