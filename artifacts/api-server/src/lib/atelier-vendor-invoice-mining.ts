/**
 * Task #1251 — vendor invoice line-item mining + project cost allocation.
 *
 * A UAE consulting firm's tooling spend arrives on three vendors:
 *   - Replit   — invoices itemize spend PER Replit project.
 *   - Anthropic / Perplexity — invoices are FLAT (no per-project lines).
 *
 * This module:
 *   1. Detects the tooling vendor from the supplier name (substring, ci).
 *   2. Extracts PDF text (text-layer first, OCR fallback — same pipeline
 *      the receipt/attachment pipeline uses) from the stored blob.
 *   3. Runs a strict-JSON Anthropic import (claude-sonnet-4-5, 90s abort)
 *      to mine line items, subtotal, VAT, credits and currency.
 *      (Deliberately NOT CogniDocs — Task #1316 kept mining on the text
 *      pipeline because it needs credits/discount semantics CogniDocs
 *      does not expose.)
 *   4. Applies a HARD reconciliation gate: sum(items) == subtotal AND
 *      subtotal - credits + vat ≈ invoice total (both within 0.05). If it
 *      fails, the extraction is stored with status "unreconciled" and NO
 *      splits are created — we never guess or scale amounts.
 *   5. Proposes cost splits: each item resolves through the project map
 *      (exact projectKey, never fuzzy); flat "__vendor_default__" resolves
 *      through the vendor percentage rule. When ALL items resolve, prior
 *      proposed splits are replaced with fresh "proposed" rows, pro-rating
 *      credits + VAT by item gross share with largest-remainder rounding so
 *      split figures sum EXACTLY to the invoice figures to the cent.
 *
 * Splits NEVER auto-approve — evaluateAutoPost stays the only auto
 * authority. Approval happens explicitly on the finance-tooling route.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierPartnerFirmInvoices,
  atelierVendorProjectMap,
  atelierVendorAllocRules,
  atelierVendorCostSplits,
  atelierEngagements,
  atelierOpportunities,
  atelierAccounts,
  atelierAuditEvents,
  type VendorInvoiceExtraction,
  type VendorInvoiceExtractionItem,
  type VendorCostBucketType,
  type VendorAllocSplit, DEFAULT_ORG_ID } from "@workspace/db";
import { extractFirstJsonObject } from "./atelier-agents/runner.js";
import { extractPdfText } from "./atelier-merchant/pdf.js";
import { loadContractBytes } from "./atelier-contracts.js";
import { convertToUsd } from "./atelier-fx.js";

export const VENDOR_DEFAULT_KEY = "__vendor_default__";
const RECON_TOLERANCE = 0.05;

export type VendorKey = "replit" | "anthropic" | "perplexity" | "openai";

const VENDOR_LABELS: Record<VendorKey, string> = {
  replit: "Replit",
  anthropic: "Anthropic",
  perplexity: "Perplexity",
  openai: "OpenAI",
};

/**
 * Vendors whose invoices are a single FLAT charge with no per-project
 * breakdown (Anthropic, Perplexity). Their spend is allocated through a
 * percentage vendor-alloc rule keyed on VENDOR_DEFAULT_KEY, so the extraction
 * for these vendors always resolves through the sentinel — never a
 * description-derived key (which no rule/map would ever match).
 *
 * Replit is per-project; it is included in the vendor-rules listing as a
 * FALLBACK so a rule can catch a Replit invoice that has no project rows.
 */
const FLAT_VENDORS: readonly VendorKey[] = ["anthropic", "perplexity", "openai"] as const;

/** Vendors surfaced by GET /vendor-rules (flat vendors + replit fallback). */
export const RULE_VENDOR_KEYS: readonly VendorKey[] = [
  "anthropic",
  "perplexity",
  "openai",
  "replit",
] as const;

export function isFlatVendor(vendorKey: string): boolean {
  return (FLAT_VENDORS as readonly string[]).includes(vendorKey);
}

export function vendorLabel(vendorKey: string): string {
  return VENDOR_LABELS[vendorKey as VendorKey] ?? vendorKey;
}

/**
 * Detect the tooling vendor from a supplier name (case-insensitive
 * substring). Returns null when the supplier is not a tooling vendor —
 * those invoices get NO extraction.
 */
export function detectVendorKey(supplierName: string | null | undefined): VendorKey | null {
  const s = (supplierName ?? "").toLowerCase();
  if (s.includes("replit")) return "replit";
  if (s.includes("anthropic")) return "anthropic";
  if (s.includes("perplexity")) return "perplexity";
  if (s.includes("openai") || s.includes("chatgpt")) return "openai";
  return null;
}

/** projectKey = lowercased / trimmed / whitespace-squashed projectLabel. */
export function projectKeyFromLabel(label: string): string {
  return label.trim().toLowerCase().replace(/\s+/g, " ");
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

const EXTRACTION_SYSTEM = `You are an accounts-payable analyst mining SaaS/tooling supplier invoices (Replit, Anthropic, Perplexity). Some invoices itemize spend per project/line; others are a single flat charge.

Extract ONLY facts present in the invoice text. Never invent, scale, or reconcile amounts — report exactly what is printed. Use null for anything not stated.

Return a single JSON object with this exact shape (all keys present):
{
  "items": [ { "projectLabel": string, "category": string|null, "amount": number } ],
  "subtotal": number,        // sum of line items before VAT, as printed (the invoice subtotal)
  "vatAmount": number,       // VAT/tax amount, 0 if none
  "creditsTotal": number,    // credits/discounts as a POSITIVE number, 0 if none
  "currency": string         // ISO 4217 3-letter code (e.g. USD)
}

Rules:
- amounts are numeric (no currency symbols, no thousands separators).
- Replit invoices have columns "Description | Quantity | Rate (excl. tax) | Tax | Amount (excl. tax)". Usage is grouped into category SECTIONS (e.g. "Agent Usage", "Autoscale Compute Units", "Neon Compute Time", "Replit AI Integrations", "Reserved VM Compute Time"). Each section is laid out as:
    (1) a SECTION HEADER row: "<Category>  <date range>  <tax%>   $<section gross>" — this $ figure is the sum of the project rows below it (BEFORE that section's credits).
    (2) one or more PROJECT rows: "<project name>  <Quantity>  <Rate>   $<amount>" — take ONLY the last money column (Amount) as the project's gross; NEVER the Quantity or Rate.
    (3) zero or more CREDIT rows directly under that section: "Pre-purchase applied" / "Previously invoiced amount" / "Discount ..." / "100% Discount"  -$<x>. These credits belong to THAT section only.
- Compute each section's NET = (section gross) − (sum of that section's credit rows). Then split the section NET across that section's project rows in proportion to each project's gross Amount, rounding to the cent so the split sums EXACTLY to the section NET.
- AGGREGATE by project across ALL sections: sum each project's per-section NET contributions into ONE item. projectLabel is the project name (e.g. "Ministry Operations Hub"), NOT the category name.
- The sum of your emitted item amounts MUST equal the invoice "Subtotal" (the printed Total excluding tax, AFTER all credits). If your item sum is much larger than the Subtotal you emitted GROSS amounts and forgot to subtract the per-section credits — redo the NET allocation. If it is larger still, you are reading the Rate/Quantity column — use the Amount column only.
- creditsTotal = the sum of the absolute values of ALL credit rows across every section (a POSITIVE number). Credit rows are NEVER emitted as items and item amounts are NEVER negative.
- For a FLAT invoice (e.g. Anthropic "Auto recharge extra usage, Team plan"), emit a SINGLE item whose projectLabel is the charge description printed on the invoice and amount = the pre-VAT subtotal.`;

export interface MinedExtraction {
  items: { projectLabel: string; category: string | null; amount: number }[];
  subtotal: number;
  vatAmount: number;
  creditsTotal: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Deterministic Replit-invoice parser.
//
// Replit invoices are machine-generated PDFs with a stable structure:
//   Description | Quantity | Rate (excl. tax) | Tax | Amount (excl. tax)
// Usage is grouped into category SECTIONS. Each section has:
//   - a header row: "<Category>  <date range>  <tax%>   $<sectionGross>"
//   - one or more PROJECT rows: "<project>  <qty>  <rate>   $<amount>"
//   - zero or more credit rows: "Pre-purchase applied / Previously invoiced
//     amount / Discount / 100% Discount   -$<x>"
// The invoice identity is: subtotal = Σ (sectionGross − sectionCredits),
// and total = subtotal + VAT. We distribute each section's NET across its
// project rows by their printed gross (largest-remainder, exact to the cent),
// then aggregate by project. Amounts are only ever read or apportioned —
// never invented or scaled. Returns null when the text does not parse into a
// figure set that reconciles EXACTLY; the caller then falls back to the LLM.
// ---------------------------------------------------------------------------
const REPLIT_MONEY_G = /(-?)\$([\d,]+\.\d{2})(?!\d)/g;
const REPLIT_CREDIT_PHRASES = [
  "Pre-purchase applied",
  "Previously invoiced amount",
  "Discount",
  "100% Discount",
];
// A project row's label ends with "<qty> <rate>" (two trailing numeric
// tokens, rate optionally $-prefixed). A section header ends with a tax% or
// a bare "..., <year>" date (page-split headers can lose their tax column).
const REPLIT_PROJ_TAIL = /\s[\d,]+(?:\.\d+)?\s+\$?[\d.]+\s*$/;
const REPLIT_HEADER_TAIL = /(?:\d+%|,\s*\d{4})\s*$/;
const REPLIT_DATE_TAIL = /[A-Z][a-z]{2} \d{1,2}(?: ?[–-] ?\d{1,2})?,?\s*\d{0,4}\s*$/;

export function parseReplitInvoice(text: string): MinedExtraction | null {
  const t = text
    .replace(
      /\bDescription\s+Quantity\s+Rate \(excl\. tax\)\s+Tax\s+Amount \(excl\. tax\)\s*/g,
      " || ",
    )
    .replace(/\b\d+ of \d+\b/g, " || ");
  const subM = t.match(
    /Subtotal\s+\$([\d,]+\.\d{2})\s+VAT \((\d+)%\)\s+\$([\d,]+\.\d{2})\s+Amount due\s+\$([\d,]+\.\d{2})/,
  );
  if (!subM) return null;
  const numOf = (s: string) => Number(s.replace(/,/g, ""));
  const subtotal = numOf(subM[1]);
  const vatAmount = numOf(subM[3]);
  const total = numOf(subM[4]);

  const bodyStart = t.indexOf("||");
  const subIdx = t.indexOf("Subtotal ");
  if (bodyStart < 0 || subIdx < 0) return null;
  const body = t.slice(bodyStart, subIdx).replace(/\|\|/g, " ");

  // Tokenize into (label, money) pairs. Some project rows carry a $-prefixed
  // RATE column immediately before the AMOUNT column (e.g. "Attached Assets
  // 0.00016  $0.05  $0.00"): two money tokens separated only by whitespace.
  // In that case the FIRST is the rate — collapse it so only the trailing
  // AMOUNT is kept, attributed to the row's label.
  const rawToks: { label: string; amt: number; neg: boolean }[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  REPLIT_MONEY_G.lastIndex = 0;
  while ((m = REPLIT_MONEY_G.exec(body))) {
    rawToks.push({
      label: body.slice(last, m.index).trim(),
      amt: numOf(m[2]),
      neg: m[1] === "-",
    });
    last = m.index + m[0].length;
  }
  const toks: { label: string; amt: number; neg: boolean }[] = [];
  for (let i = 0; i < rawToks.length; i++) {
    const cur = rawToks[i];
    const next = rawToks[i + 1];
    // If the NEXT token has an empty label, it directly abuts this one — this
    // token is the rate column; skip it and let `next` (the amount) carry the
    // row's label from `cur`.
    if (next && next.label.trim() === "" && !cur.neg && !next.neg) {
      toks.push({ label: cur.label, amt: next.amt, neg: false });
      i++; // consume the amount token too
      continue;
    }
    toks.push(cur);
  }
  if (toks.length === 0) return null;

  const projects = new Map<string, { amount: number; category: string | null }>();
  let creditsTotal = 0;
  let curProjects: { name: string; gross: number; category: string | null }[] = [];
  let curCredit = 0;
  let curHeader = 0;
  let curCategory: string | null = null;
  let haveSection = false;

  const flush = () => {
    if (!haveSection) return;
    if (curProjects.length === 0) {
      haveSection = false;
      curCredit = 0;
      curHeader = 0;
      return;
    }
    const net = curHeader - curCredit;
    const parts = largestRemainder(
      net,
      curProjects.map((p) => Math.max(p.gross, 0)),
    );
    curProjects.forEach((p, i) => {
      const prev = projects.get(p.name);
      projects.set(p.name, {
        amount: (prev?.amount ?? 0) + parts[i],
        category: prev?.category ?? p.category,
      });
    });
    curProjects = [];
    curCredit = 0;
    curHeader = 0;
    curCategory = null;
    haveSection = false;
  };

  for (const tk of toks) {
    if (tk.neg || REPLIT_CREDIT_PHRASES.some((p) => tk.label.includes(p))) {
      creditsTotal += Math.abs(tk.amt);
      if (haveSection) curCredit += Math.abs(tk.amt);
      continue;
    }
    // A bare date token (e.g. "Aug 4 – 7, 2026") with no category text before
    // it is the tail of a page-split header whose category+% stayed on the
    // previous page — it is NOT a new section. Drop it so it neither opens a
    // spurious section nor is mistaken for a project.
    const dateOnly = /^[A-Z][a-z]{2} \d{1,2}(?: ?[–-] ?\d{1,2})?,\s*\d{4}$/.test(
      tk.label.trim(),
    );
    if (dateOnly) continue;
    const isProj = REPLIT_PROJ_TAIL.test(tk.label);
    const isHeader = !isProj && REPLIT_HEADER_TAIL.test(tk.label);
    if (isHeader) {
      flush();
      curHeader = tk.amt;
      haveSection = true;
      const cat = tk.label
        .replace(REPLIT_HEADER_TAIL, "")
        .replace(REPLIT_DATE_TAIL, "")
        .trim();
      curCategory = cat || null;
      // "Credits - Credit pack purchase ..." sections carry the charge on the
      // header row itself (no sub-projects) — treat the header as its project.
      if (/^Credits/i.test(cat)) {
        curProjects.push({ name: cat || "Credits", gross: tk.amt, category: cat });
      }
      continue;
    }
    // Project row: strip the trailing qty (+ optional rate) tokens to recover
    // the name. After the rate/amount collapse above, a row may carry only a
    // lone trailing quantity, so strip either shape.
    let name = tk.label.replace(REPLIT_PROJ_TAIL, "").trim();
    if (name === tk.label.trim()) {
      name = tk.label.replace(/\s[\d,]+(?:\.\d+)?\s*$/, "").trim();
    }
    if (!name) name = tk.label.trim();
    if (!name) continue;
    if (haveSection) {
      curProjects.push({ name, gross: tk.amt, category: curCategory });
    }
  }
  flush();

  let items = [...projects.entries()]
    .map(([projectLabel, v]) => ({
      projectLabel,
      category: v.category,
      // A project's net can dip a cent below zero when a section's credits,
      // apportioned by gross weight, slightly exceed its own tiny gross —
      // clamp to zero (a cost split is never negative).
      amount: Math.max(round2(v.amount), 0),
    }))
    .filter((it) => Math.round(it.amount * 100) !== 0 || projects.size === 1);
  if (items.length === 0) return null;

  // subtotal + VAT must equal the printed invoice total to the cent — this is
  // a pure arithmetic identity on figures we read directly, never negotiable.
  if (Math.round((subtotal + vatAmount) * 100) !== Math.round(total * 100)) {
    return null;
  }

  const itemSum = items.reduce((s, i) => s + i.amount, 0);
  const drift = Math.round((itemSum - subtotal) * 100);
  if (drift !== 0) {
    // Replit rounds each project row AND the section total independently to
    // the cent, so per-section nets can drift a penny or two from the printed
    // subtotal. Only tolerate a tiny drift (≤ RECON_TOLERANCE); anything
    // larger means we mis-read the structure — bail to the LLM. Never scale.
    if (Math.abs(itemSum - subtotal) > RECON_TOLERANCE) return null;
    // Snap the items to sum EXACTLY to the authoritative printed subtotal by
    // re-apportioning it across the item weights (largest-remainder). This
    // moves at most a couple of cents and only among the already-extracted
    // amounts — it invents nothing.
    const parts = largestRemainder(
      subtotal,
      items.map((it) => Math.max(it.amount, 0)),
    );
    items = items.map((it, i) => ({ ...it, amount: parts[i] }));
  }
  const finalSum = items.reduce((s, i) => s + i.amount, 0);
  if (Math.round(finalSum * 100) !== Math.round(subtotal * 100)) return null;
  return { items, subtotal, vatAmount, creditsTotal, currency: "USD" };
}

/**
 * Run the LLM extraction over already-extracted invoice text. Throws on
 * model/parse error so the caller can persist a "failed" status.
 */
export async function mineInvoiceText(args: {
  orgId: string;
  text: string;
  contextLabel: string;
  vendorKey?: VendorKey | null;
}): Promise<MinedExtraction> {
  // Deterministic pre-pass for Replit's machine-generated invoices. Only used
  // when it reconciles EXACTLY to the cent; otherwise we fall back to the LLM.
  if (args.vendorKey === "replit") {
    const parsed = parseReplitInvoice(args.text);
    if (parsed) return parsed;
  }
  const { anthropic } = await (
    await import("./assistant/provider-runtime.js")
  ).getPrivacyAuthorizedAnthropic({
    dataClasses: ["restricted"],
    orgId: args.orgId,
    capabilityId: "finance.vendor_invoice_mining",
    model: "claude-sonnet-4-5",
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90_000);
  const resp = await anthropic.messages
    .create(
      {
        model: "claude-sonnet-4-5",
        // Dense Replit invoices can carry 50+ project rows across several
        // sections — give the model ample room so the JSON is never truncated.
        max_tokens: 8192,
        system: `${EXTRACTION_SYSTEM}\n\nIMPORTANT: Reply with ONLY a single JSON object, no prose, no code fences.`,
        messages: [
          {
            role: "user",
            content: `${args.contextLabel}\n\nExtracted invoice text:\n<<<\n${args.text.slice(0, 60_000)}\n>>>`,
          },
        ],
      },
      { signal: ac.signal },
    )
    .finally(() => clearTimeout(timer));
  const block = resp.content[0];
  const raw = block && block.type === "text" ? block.text.trim() : "";
  // Task #1267 audit — same silent-truncation class as the supplier-invoice
  // parser: name the failure so it's diagnosable from logs, never "non-json".
  if ((resp as { stop_reason?: string | null }).stop_reason === "max_tokens") {
    throw new Error("extraction-truncated-max-tokens");
  }
  const json = extractFirstJsonObject(
    raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, ""),
  );
  if (!json) throw new Error("extraction-non-json");
  const parsed = JSON.parse(json) as Record<string, unknown>;
  const num = (v: unknown): number =>
    typeof v === "number" && Number.isFinite(v) ? v : 0;
  const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
  const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
  const items = rawItems
    .map((it) => {
      const o = (it ?? {}) as Record<string, unknown>;
      return {
        projectLabel: str(o.projectLabel),
        category: str(o.category) || null,
        amount: num(o.amount),
      };
    })
    .filter((it) => it.projectLabel.length > 0);
  return {
    items,
    subtotal: num(parsed.subtotal),
    vatAmount: num(parsed.vatAmount),
    creditsTotal: num(parsed.creditsTotal),
    currency: (str(parsed.currency) || "USD").toUpperCase().slice(0, 3),
  };
}

/**
 * HARD reconciliation gate — STRICT, POST-CREDIT-ONLY.
 *
 * Split creation is unconditionally post-credit (`net = gross + VAT`, credits
 * informational). So the ONLY representation we may persist is the post-credit
 * one, and the gate accepts exactly that identity:
 *   - sum(items.amount) == subtotal (within RECON_TOLERANCE), AND
 *   - subtotal + vatAmount ≈ invoiceTotal (within RECON_TOLERANCE).
 *
 * The gross-before-credit variant (`subtotal - creditsTotal + vat == total`,
 * where items/subtotal are pre-credit) is deliberately NOT accepted here: it
 * would pass a looser gate yet persist splits netting `subtotal + vat` >
 * invoiceTotal — an overstated approved cost. Such extractions must be
 * NORMALIZED to post-credit first (see normalizeToPostCredit) or quarantined.
 */
export function reconciles(
  mined: MinedExtraction,
  invoiceTotal: number,
): boolean {
  const itemSum = mined.items.reduce((s, i) => s + i.amount, 0);
  if (Math.abs(itemSum - mined.subtotal) > RECON_TOLERANCE) return false;
  return Math.abs(mined.subtotal + mined.vatAmount - invoiceTotal) <= RECON_TOLERANCE;
}

/**
 * Coerce a mined extraction into the canonical POST-CREDIT representation, or
 * return null to quarantine an ambiguous/ill-formed one.
 *
 * Two well-formed input shapes are recognised (never scaled to force a match):
 *   1. ALREADY POST-CREDIT — items/subtotal are net of credits and
 *      `subtotal + vat ≈ total`. Returned unchanged (still exact by reconciles).
 *   2. GROSS-BEFORE-CREDIT — items/subtotal are pre-credit and
 *      `subtotal - creditsTotal + vat ≈ total`. We deterministically subtract
 *      creditsTotal from the items pro-rata (largest-remainder, exact to the
 *      cent), set subtotal = subtotal - creditsTotal (now post-credit), keep
 *      creditsTotal as the informational figure, and re-check the STRICT
 *      post-credit identity. Only the normalized form is returned.
 *
 * Anything else (items don't sum to subtotal; neither identity holds) → null.
 */
export function normalizeToPostCredit(
  mined: MinedExtraction,
  invoiceTotal: number,
): MinedExtraction | null {
  const itemSum = mined.items.reduce((s, i) => s + i.amount, 0);
  // Items must always tie to the stated subtotal; if they don't, we cannot
  // trust the figure set at all.
  if (Math.abs(itemSum - mined.subtotal) > RECON_TOLERANCE) return null;

  // Shape 1: already post-credit.
  if (Math.abs(mined.subtotal + mined.vatAmount - invoiceTotal) <= RECON_TOLERANCE) {
    return mined;
  }

  // Shape 2: gross-before-credit — normalize by removing the credit pro-rata.
  const credits = round2(mined.creditsTotal);
  if (
    credits > 0 &&
    Math.abs(mined.subtotal - credits + mined.vatAmount - invoiceTotal) <= RECON_TOLERANCE
  ) {
    const weights = mined.items.map((it) => Math.max(0, it.amount));
    // Distribute the TOTAL post-credit subtotal across items by their gross
    // weight (largest-remainder) so items sum EXACTLY to the post-credit
    // subtotal — no per-item rounding drift.
    const postSubtotal = round2(mined.subtotal - credits);
    const parts = largestRemainder(postSubtotal, weights);
    const normalized: MinedExtraction = {
      ...mined,
      subtotal: postSubtotal,
      creditsTotal: credits, // informational; already removed from items above
      items: mined.items.map((it, i) => ({ ...it, amount: parts[i] })),
    };
    // Re-check the STRICT post-credit identity before accepting.
    return reconciles(normalized, invoiceTotal) ? normalized : null;
  }

  return null;
}

/**
 * Largest-remainder apportionment of `total` across `weights` so the parts
 * sum EXACTLY to `total` rounded to the cent. Returns cent-rounded parts.
 */
function largestRemainder(total: number, weights: number[]): number[] {
  const cents = Math.round(total * 100);
  const wSum = weights.reduce((s, w) => s + w, 0);
  if (cents === 0 || wSum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (cents * w) / wSum);
  const floors = raw.map((r) => Math.floor(r));
  let remaining = cents - floors.reduce((s, f) => s + f, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && remaining > 0; k++) {
    out[order[k].i] += 1;
    remaining -= 1;
  }
  return out.map((c) => c / 100);
}

/** Build the stored extraction payload for a set of mined items. */
function buildExtractionPayload(args: {
  status: VendorInvoiceExtraction["status"];
  mined: MinedExtraction;
  note: string | null;
  vendorKey?: VendorKey | null;
}): VendorInvoiceExtraction {
  // Flat vendors (Anthropic/Perplexity) have no per-project breakdown — their
  // single line resolves through the vendor alloc rule, so its projectKey MUST
  // be the sentinel VENDOR_DEFAULT_KEY (the printed description stays as the
  // human label). Otherwise the key would be a description slug that no rule
  // or project map could ever match, stranding every invoice as "unmapped".
  const flat = args.vendorKey ? isFlatVendor(args.vendorKey) : false;
  const items: VendorInvoiceExtractionItem[] = args.mined.items.map((it) => ({
    projectKey: flat ? VENDOR_DEFAULT_KEY : projectKeyFromLabel(it.projectLabel),
    projectLabel: it.projectLabel,
    category: it.category,
    amount: round2(it.amount),
  }));
  return {
    status: args.status,
    extractedAt: new Date().toISOString(),
    currency: args.mined.currency,
    subtotal: round2(args.mined.subtotal),
    vatAmount: round2(args.mined.vatAmount),
    creditsTotal: round2(args.mined.creditsTotal),
    items,
    note: args.note,
  };
}

interface InvoiceRow {
  id: string;
  orgId: string;
  partnerFirmName: string;
  costAmount: number;
  costCurrency: string;
  invoiceDate: string | null;
  fileName: string | null;
  reference: string | null;
  blobRef: string | null;
  submittedByUserId?: string | null;
}

async function loadInvoice(invoiceId: string): Promise<InvoiceRow | null> {
  const [row] = await db
    .select({
      id: atelierPartnerFirmInvoices.id,
      orgId: atelierPartnerFirmInvoices.orgId,
      partnerFirmName: atelierPartnerFirmInvoices.partnerFirmName,
      costAmount: atelierPartnerFirmInvoices.costAmount,
      costCurrency: atelierPartnerFirmInvoices.costCurrency,
      invoiceDate: atelierPartnerFirmInvoices.invoiceDate,
      fileName: atelierPartnerFirmInvoices.fileName,
      reference: atelierPartnerFirmInvoices.reference,
      blobRef: atelierPartnerFirmInvoices.blobRef,
      submittedByUserId: atelierPartnerFirmInvoices.submittedByUserId,
    })
    .from(atelierPartnerFirmInvoices)
    .where(eq(atelierPartnerFirmInvoices.id, invoiceId));
  return row ?? null;
}

async function setExtraction(
  invoiceId: string,
  payload: VendorInvoiceExtraction | null,
): Promise<void> {
  await db
    .update(atelierPartnerFirmInvoices)
    .set({ toolingExtraction: payload, updatedAt: new Date() })
    .where(eq(atelierPartnerFirmInvoices.id, invoiceId));
}

/**
 * Write a SYSTEM audit event for a tooling mining action. These run from the
 * async extraction pipeline (no human actor), so actorType is "system". Best
 * effort — an audit failure never breaks extraction (callers may ignore the
 * rejection, but we swallow it here so it cannot poison the pipeline).
 */
async function auditTooling(args: {
  orgId: string;
  invoiceId: string;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  try {
    await db.insert(atelierAuditEvents).values({
      id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      orgId: args.orgId,
      entityType: "vendor_invoice",
      entityId: args.invoiceId,
      actorType: "system",
      actorId: null,
      actorLabel: "vendor-invoice-mining",
      action: args.action,
      payload: args.payload,
      payloadSummary: args.summary,
    });
  } catch (err) {
    console.error(
      `[vendor-invoice-mining] audit write failed (${args.action}) for ${args.invoiceId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Extract + (on a clean reconciliation) propose splits for a single
 * invoice. Idempotent: re-running replaces the stored payload and any
 * prior PROPOSED splits (approved splits are never touched).
 *
 * On any failure the invoice gets extraction status "failed" and no
 * splits — the upload/caller is never broken.
 */
export async function extractAndProposeForInvoice(
  invoiceId: string,
): Promise<{ status: VendorInvoiceExtraction["status"] }> {
  const inv = await loadInvoice(invoiceId);
  if (!inv) return { status: "failed" };
  const vendorKey = detectVendorKey(inv.partnerFirmName);
  if (!vendorKey) return { status: "failed" }; // not a tooling vendor

  let mined: MinedExtraction;
  try {
    if (!inv.blobRef) throw new Error("no-blob");
    const bytes = await loadContractBytes(inv.blobRef);
    if (!bytes || bytes.length === 0) throw new Error("blob-empty");
    const pdf = await extractPdfText(new Uint8Array(bytes));
    const text = pdf.text ?? "";
    if (!text.trim()) throw new Error("no-text");
    mined = await mineInvoiceText({
      orgId: inv.orgId,
      text,
      vendorKey,
      contextLabel: `Vendor: ${vendorLabel(vendorKey)} · file: ${inv.fileName ?? inv.reference ?? invoiceId}`,
    });
  } catch (err) {
    const note = err instanceof Error ? err.message : "extraction error";
    // Store a minimal failed payload so the row shows a review state.
    await setExtraction(invoiceId, {
      status: "failed",
      extractedAt: new Date().toISOString(),
      currency: (inv.costCurrency || "USD").toUpperCase(),
      subtotal: 0,
      vatAmount: 0,
      creditsTotal: 0,
      items: [],
      note: `extraction failed: ${note}`,
    });
    await auditTooling({
      orgId: inv.orgId,
      invoiceId,
      action: "tooling.extraction",
      payload: { status: "failed", vendorKey, reason: note },
      summary: `Extraction failed for ${vendorLabel(vendorKey)} invoice ${inv.reference ?? invoiceId}: ${note}`,
    });
    return { status: "failed" };
  }

  const invoiceTotal = Number(inv.costAmount || 0);
  // Coerce to the canonical post-credit representation (or null → quarantine).
  // This guarantees the persisted `subtotal + vat == total` identity that split
  // creation relies on, so a gross-before-credit LLM response can never persist
  // splits that overstate cost.
  const normalized =
    mined.items.length > 0 ? normalizeToPostCredit(mined, invoiceTotal) : null;
  if (!normalized) {
    const payload = buildExtractionPayload({
      status: "unreconciled",
      mined,
      vendorKey,
      note:
        mined.items.length === 0
          ? "No line items extracted."
          : `Extracted figures do not reconcile to invoice total ${invoiceTotal.toFixed(2)} ${mined.currency} in the canonical post-credit form.`,
    });
    await setExtraction(invoiceId, payload);
    // Never create splits on an unreconciled invoice.
    await deleteProposedSplits(invoiceId);
    const itemSum = payload.items.reduce((s, i) => s + i.amount, 0);
    await auditTooling({
      orgId: inv.orgId,
      invoiceId,
      action: "tooling.extraction",
      payload: {
        status: "unreconciled",
        vendorKey,
        invoiceTotal,
        itemSum: round2(itemSum),
        subtotal: payload.subtotal,
        vatAmount: payload.vatAmount,
      },
      summary: `Extraction UNRECONCILED for ${vendorLabel(vendorKey)} invoice ${inv.reference ?? invoiceId} (items ${round2(itemSum).toFixed(2)} vs total ${invoiceTotal.toFixed(2)}).`,
    });
    return { status: "unreconciled" };
  }

  const payload = buildExtractionPayload({
    status: "ok",
    mined: normalized,
    vendorKey,
    note: null,
  });
  await setExtraction(invoiceId, payload);
  await auditTooling({
    orgId: inv.orgId,
    invoiceId,
    action: "tooling.extraction",
    payload: {
      status: "ok",
      vendorKey,
      itemCount: payload.items.length,
      subtotal: payload.subtotal,
      vatAmount: payload.vatAmount,
      creditsTotal: payload.creditsTotal,
    },
    summary: `Extraction OK for ${vendorLabel(vendorKey)} invoice ${inv.reference ?? invoiceId} — ${payload.items.length} line item(s).`,
  });
  const proposal = await proposeSplitsForInvoice({ inv, vendorKey, payload });

  // Task #1268 — when the breakdown scan finishes but some project names have
  // no saved home yet, tell the person who filed the invoice (Me-home card +
  // device push) so the ask happens DURING review, not silently in a queue.
  // Best-effort: a notification failure must never fail the extraction.
  if (proposal.unmapped) {
    try {
      await notifyUnmappedProjects({
        orgId: inv.orgId,
        invoiceId: inv.id,
        submittedByUserId: inv.submittedByUserId ?? null,
        vendorKey,
        payload,
      });
    } catch (err) {
      console.error(
        `[vendor-invoice-mining] unmapped notification failed for ${invoiceId}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return { status: "ok" };
}

/**
 * Task #1268 — tell someone who can ACT that projects need a home.
 *
 * The mapping console (/finance/tooling) is finance-leadership gated
 * (founding_partner | partner | finance). Notify the submitter only when
 * they hold one of those roles and can open the link; otherwise notify the
 * finance-leadership users instead, so the ask never dead-ends in a 403
 * for a consultant/contractor submitter. Exported for the probes.
 */
export async function notifyUnmappedProjects(args: {
  orgId: string;
  invoiceId: string;
  submittedByUserId: string | null;
  vendorKey: VendorKey;
  payload: VendorInvoiceExtraction;
}): Promise<string[]> {
  const { orgId, invoiceId, submittedByUserId, vendorKey, payload } = args;
  const { emitSelfNotification } = await import("../routes/atelier/meRoutes.js");
  const labels = await unmappedProjectLabels(orgId, vendorKey, payload);
  const shown = labels.slice(0, 4).join(", ");
  const more = labels.length > 4 ? ` and ${labels.length - 4} more` : "";
  const title = `${vendorLabel(vendorKey)} invoice needs project homes`;
  const body = labels.length
    ? `Tell us who ${shown}${more} belong${labels.length === 1 ? "s" : ""} to — the cost split is waiting on it.`
    : "Some projects on this invoice need a home before the cost split can be approved.";
  const FINANCE_ROLES = ["founding_partner", "partner", "finance"];
  const recipients = new Set<string>();
  if (submittedByUserId) {
    const [submitter] = await db.select({ role: atelierUsers.role })
      .from(atelierUsers)
      .where(and(eq(atelierUsers.id, submittedByUserId), eq(atelierUsers.orgId, orgId)));
    if (submitter && FINANCE_ROLES.includes(submitter.role)) recipients.add(submittedByUserId);
  }
  if (recipients.size === 0) {
    const leads = await db.select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(and(
        eq(atelierUsers.orgId, orgId),
        inArray(atelierUsers.role, FINANCE_ROLES),
        isNull(atelierUsers.deletedAt),
      ));
    for (const l of leads) recipients.add(l.id);
  }
  for (const userId of recipients) {
    await emitSelfNotification({
      orgId,
      userId,
      kind: "tooling_project_unmapped",
      title,
      body,
      href: `/finance/tooling?focus=${invoiceId}`,
    });
  }
  return [...recipients];
}

/** Labels of extraction items that currently resolve to NO mapping/rule.
 *  Exported for the tooling-costs probes (Task #1268). */
export async function unmappedProjectLabels(
  orgId: string,
  vendorKey: string,
  payload: VendorInvoiceExtraction,
): Promise<string[]> {
  const maps = await db.select().from(atelierVendorProjectMap).where(and(
    eq(atelierVendorProjectMap.orgId, orgId),
    eq(atelierVendorProjectMap.vendorKey, vendorKey),
    isNull(atelierVendorProjectMap.deletedAt),
  ));
  const mapped = new Set(maps.map((m) => m.projectKey));
  const [rule] = await db.select().from(atelierVendorAllocRules).where(and(
    eq(atelierVendorAllocRules.orgId, orgId),
    eq(atelierVendorAllocRules.vendorKey, vendorKey),
    isNull(atelierVendorAllocRules.deletedAt),
  ));
  const hasRule = ((rule?.splits ?? []) as VendorAllocSplit[]).length > 0;
  const out: string[] = [];
  for (const it of payload.items) {
    const ok = it.projectKey === VENDOR_DEFAULT_KEY ? hasRule : mapped.has(it.projectKey);
    if (!ok && !out.includes(it.projectLabel)) out.push(it.projectLabel);
  }
  return out;
}

async function deleteProposedSplits(invoiceId: string): Promise<void> {
  await db
    .delete(atelierVendorCostSplits)
    .where(
      and(
        eq(atelierVendorCostSplits.invoiceId, invoiceId),
        eq(atelierVendorCostSplits.status, "proposed"),
      ),
    );
}

/**
 * True when the invoice has ANY approved split. Approved splits are immutable
 * to automatic re-proposal: re-proposing would insert a fresh full proposal
 * alongside the already-counted approved rows, and approving it would
 * double-count the invoice in tooling totals + engagement P&L. Callers must
 * SKIP such invoices (see proposeSplitsForInvoice + the route re-propose loops
 * and the /extract 409 guard).
 */
/**
 * Per-invoice serialization key for the extract+propose single-flight lock.
 * Held as a transaction-scoped pg advisory lock so a fresh invoice's async
 * mining trigger and a synchronous backfill/manual /extract cannot each write
 * a full proposed set concurrently.
 */
export function toolingMineLockKey(invoiceId: string): string {
  return `tooling-mine:${invoiceId}`;
}

export async function hasApprovedSplits(invoiceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: atelierVendorCostSplits.id })
    .from(atelierVendorCostSplits)
    .where(
      and(
        eq(atelierVendorCostSplits.invoiceId, invoiceId),
        eq(atelierVendorCostSplits.status, "approved"),
      ),
    )
    .limit(1);
  return !!row;
}

interface ResolvedItem {
  projectKey: string;
  projectLabel: string;
  bucketType: VendorCostBucketType;
  bucketRef: string | null;
  gross: number;
  prototypeId: string | null;
}

/**
 * Resolve every extracted item to a bucket. A per-project item resolves
 * through the project map (exact projectKey only). The flat
 * "__vendor_default__" item resolves through the vendor alloc rule's
 * percentage splits (its gross is fanned out across the rule's buckets).
 *
 * Returns null when ANY item is unmapped — the caller then creates NO
 * splits and the invoice feeds the unmapped queue.
 */
async function resolveItems(args: {
  orgId: string;
  vendorKey: string;
  payload: VendorInvoiceExtraction;
}): Promise<ResolvedItem[] | null> {
  const { orgId, vendorKey, payload } = args;
  const maps = await db
    .select()
    .from(atelierVendorProjectMap)
    .where(
      and(
        eq(atelierVendorProjectMap.orgId, orgId),
        eq(atelierVendorProjectMap.vendorKey, vendorKey),
        isNull(atelierVendorProjectMap.deletedAt),
      ),
    );
  const mapByKey = new Map(maps.map((m) => [m.projectKey, m]));

  const resolved: ResolvedItem[] = [];
  for (const item of payload.items) {
    if (item.projectKey === VENDOR_DEFAULT_KEY) {
      // Flat vendor: resolve via the percentage rule.
      const [rule] = await db
        .select()
        .from(atelierVendorAllocRules)
        .where(
          and(
            eq(atelierVendorAllocRules.orgId, orgId),
            eq(atelierVendorAllocRules.vendorKey, vendorKey),
            isNull(atelierVendorAllocRules.deletedAt),
          ),
        );
      const splits = (rule?.splits ?? []) as VendorAllocSplit[];
      if (!rule || splits.length === 0) return null; // unmapped flat vendor
      const grosses = largestRemainder(
        item.amount,
        splits.map((s) => s.pct),
      );
      splits.forEach((s, i) => {
        resolved.push({
          projectKey: item.projectKey,
          projectLabel: item.projectLabel,
          bucketType: s.bucketType,
          bucketRef: s.bucketRef,
          gross: grosses[i],
          prototypeId: null,
        });
      });
      continue;
    }
    const m = mapByKey.get(item.projectKey);
    if (!m) return null; // unmapped per-project item
    resolved.push({
      projectKey: item.projectKey,
      projectLabel: item.projectLabel,
      bucketType: m.bucketType,
      bucketRef: m.bucketRef,
      gross: round2(item.amount),
      prototypeId: m.prototypeId ?? null,
    });
  }
  return resolved;
}

async function bucketLabelFor(
  orgId: string,
  bucketType: VendorCostBucketType,
  bucketRef: string | null,
): Promise<string> {
  if (bucketType === "internal") return "Internal";
  if (bucketType === "overhead") return "Overhead";
  if (bucketType === "ip_development") return "IP development";
  if (!bucketRef) return bucketType;
  if (bucketType === "account") {
    const [a] = await db
      .select({ name: atelierAccounts.name })
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, bucketRef), eq(atelierAccounts.orgId, orgId)));
    return a?.name ?? bucketRef;
  }
  if (bucketType === "engagement") {
    const [e] = await db
      .select({ name: atelierEngagements.name })
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, bucketRef), eq(atelierEngagements.orgId, orgId)));
    return e?.name ?? bucketRef;
  }
  const [o] = await db
    .select({ name: atelierOpportunities.name })
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, bucketRef), eq(atelierOpportunities.orgId, orgId)));
  return o?.name ?? bucketRef;
}

/**
 * Propose (or re-propose) splits for a reconciled invoice.
 *
 * MODEL — mined `items[].amount` are POST-CREDIT NET (they already sum to the
 * printed post-credit `subtotal`; see parseReplitInvoice and the LLM prompt).
 * So the split arithmetic is:
 *   grossAmount  = item net (the post-credit charge attributable to the item)
 *   vatAmount    = pro-rata share of the invoice VAT (largest-remainder)
 *   creditAmount = INFORMATIONAL pro-rata share of creditsTotal — recorded for
 *                  display/audit only, NEVER subtracted from netAmount again
 *   netAmount    = grossAmount + vatAmount
 * Therefore sum(netAmount) == subtotal + vatAmount == invoice total, to the
 * cent. Subtracting credits here would DOUBLE-COUNT them (the items are
 * already net of credits).
 */
export async function proposeSplitsForInvoice(args: {
  inv: InvoiceRow;
  vendorKey: string;
  payload: VendorInvoiceExtraction;
}): Promise<{ proposed: boolean; unmapped: boolean; skippedApproved?: boolean }> {
  const { inv, vendorKey, payload } = args;

  // Resolve mapping OUTSIDE the lock (pure read of maps/rules — no mutation).
  const resolved = await resolveItems({ orgId: inv.orgId, vendorKey, payload });

  const grosses = (resolved ?? []).map((r) => round2(r.gross));
  // Pro-rate the INFORMATIONAL credit share + VAT by net share so the parts
  // tie to the cent. `credits` is display-only; VAT is added to net below.
  const credits = largestRemainder(payload.creditsTotal, grosses);
  const vats = largestRemainder(payload.vatAmount, grosses);
  const fxDate = inv.invoiceDate ?? new Date().toISOString().slice(0, 10);
  // FX conversion needs no lock; precompute so the critical section is pure DB.
  const usdByIndex: number[] = [];
  if (resolved) {
    for (let i = 0; i < resolved.length; i++) {
      const net = round2(grosses[i] + vats[i]);
      const fx = await convertToUsd(net, payload.currency, fxDate);
      usdByIndex[i] = round2(fx.usdAmount);
    }
  }

  const now = new Date();
  let netTotalUsd = 0;

  // SINGLE-FLIGHT: serialize the whole re-check + delete + insert per invoice
  // with a transaction-scoped advisory lock. Two concurrent extract+propose
  // runs (async trigger + synchronous backfill/manual /extract) would each
  // otherwise insert a FULL proposed set → double-count on approval. The lock
  // makes them run one-at-a-time; the partial unique index
  // (uq_atelier_vcs_proposed_identity) is the belt-and-braces DB backstop.
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${toolingMineLockKey(inv.id)}))`,
    );

    // IMMUTABILITY GUARD (re-checked INSIDE the lock): once any split is
    // approved, the invoice is locked against automatic re-proposal — a fresh
    // proposal alongside approved rows would double-count on approval.
    const [approved] = await tx
      .select({ id: atelierVendorCostSplits.id })
      .from(atelierVendorCostSplits)
      .where(
        and(
          eq(atelierVendorCostSplits.invoiceId, inv.id),
          eq(atelierVendorCostSplits.status, "approved"),
        ),
      )
      .limit(1);
    if (approved) {
      return { proposed: false, unmapped: false, skippedApproved: true } as const;
    }

    // Always clear any prior proposed set first (idempotent re-proposal, and it
    // clears the way for the unique-index'd insert below).
    await tx
      .delete(atelierVendorCostSplits)
      .where(
        and(
          eq(atelierVendorCostSplits.invoiceId, inv.id),
          eq(atelierVendorCostSplits.status, "proposed"),
        ),
      );

    if (!resolved) {
      // Unmapped — leave zero proposed rows so the row shows "unmapped".
      return { proposed: false, unmapped: true } as const;
    }

    for (let i = 0; i < resolved.length; i++) {
      const r = resolved[i];
      const gross = grosses[i];
      const credit = credits[i];
      const vat = vats[i];
      // Items are already post-credit net; do NOT subtract credit again.
      const net = round2(gross + vat);
      await tx.insert(atelierVendorCostSplits).values({
        id: `vcs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}_${i}`,
        orgId: inv.orgId,
        invoiceId: inv.id,
        projectKey: r.projectKey,
        projectLabel: r.projectLabel,
        bucketType: r.bucketType,
        bucketRef: r.bucketRef,
        prototypeId: r.prototypeId,
        currency: payload.currency,
        grossAmount: gross,
        creditAmount: credit,
        vatAmount: vat,
        netAmount: net,
        usdAmount: usdByIndex[i],
        status: "proposed",
        createdAt: now,
        updatedAt: now,
      });
      netTotalUsd += usdByIndex[i];
    }
    return { proposed: true, unmapped: false } as const;
  });

  if (!outcome.proposed) {
    return outcome;
  }
  const count = resolved?.length ?? 0;
  await auditTooling({
    orgId: inv.orgId,
    invoiceId: inv.id,
    action: "tooling.splits_proposed",
    payload: {
      vendorKey,
      count,
      netTotalUsd: round2(netTotalUsd),
      currency: payload.currency,
    },
    summary: `Proposed ${count} cost split(s) for ${vendorLabel(vendorKey)} invoice ${inv.reference ?? inv.id} — net USD ${round2(netTotalUsd).toFixed(2)}.`,
  });
  return { proposed: true, unmapped: false };
}

/**
 * Fire-and-forget trigger used after a supplier-invoice insert for a
 * detected tooling vendor. Never throws — extraction failures land as a
 * "failed" status on the row (see extractAndProposeForInvoice).
 */
export function triggerVendorInvoiceMining(invoiceId: string): void {
  setImmediate(() => {
    extractAndProposeForInvoice(invoiceId).catch(async (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[vendor-invoice-mining] extraction failed for ${invoiceId}:`,
        reason,
      );
      // Best-effort: stamp a failed status so the row shows review state.
      await setExtraction(invoiceId, {
        status: "failed",
        extractedAt: new Date().toISOString(),
        currency: "USD",
        subtotal: 0,
        vatAmount: 0,
        creditsTotal: 0,
        items: [],
        note: "extraction failed (async trigger)",
      }).catch(() => {});
      // Audit the failure too — resolve org best-effort (RLS default 'aico'
      // when the row cannot be read).
      const inv = await loadInvoice(invoiceId).catch(() => null);
      await auditTooling({
        orgId: inv?.orgId ?? DEFAULT_ORG_ID,
        invoiceId,
        action: "tooling.extraction",
        payload: { status: "failed", reason, async: true },
        summary: `Extraction failed (async) for invoice ${invoiceId}: ${reason}`,
      });
    });
  });
}

export { bucketLabelFor };
