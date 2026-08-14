/**
 * Task #1102 — UAE FTA VAT 201 return dataset.
 *
 * Builds the box-by-box VAT 201 structure for a UAE legal entity and
 * period, tying back to the SAME GL data as the existing VAT return
 * calculator (accounts 2300 output / 1400 input, periodLabel scope,
 * vat_return settlements excluded):
 *
 *   - Box VAT figures are built directly from the GL VAT-account journal
 *     lines, so box 12/13 totals equal the existing output/input numbers
 *     by construction (after AED conversion).
 *   - Supporting schedules enrich each GL line from its source document
 *     (AR invoice, expense VAT register row) for auditability.
 *   - Zero-rated supplies (box 4) carry no VAT, so they come from issued
 *     0%-rated invoices tagged to the entity (net effect on tax: none).
 *   - Reverse-charge boxes (3/6/7/10), tourist refunds (2) and exempt
 *     supplies (5) have no classified source data yet and are reported
 *     as zero with an explicit data-gap note.
 *   - All amounts are converted to AED via the shared FX table
 *     (source → USD → AED), with the conversion shown per line.
 */

import { and, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  atelierLegalEntities,
  atelierGlAccount,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierInvoice,
  atelierVatRegister,
} from "@workspace/db";
import { convertToUsd, convertUsdTo } from "./atelier-fx.js";

export function round2(n: number): number { return Math.round(n * 100) / 100; }

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const QUARTER_RE = /^\d{4}-Q[1-4]$/;

export function monthsOfVatPeriod(period: string): string[] | null {
  if (MONTH_RE.test(period)) return [period];
  if (QUARTER_RE.test(period)) {
    const y = period.slice(0, 4);
    const q = Number(period.slice(6));
    return [1, 2, 3].map((i) => `${y}-${String((q - 1) * 3 + i).padStart(2, "0")}`);
  }
  return null;
}

// ── Shared GL VAT collector (used by BOTH the existing return calculator
//    and the VAT 201 builder so the figures cannot drift apart). ──────────

export interface GlVatLine {
  journalEntryId: string;
  entryDate: string;
  periodLabel: string;
  sourceKind: string;
  sourceRef: string | null;
  currency: string;
  memo: string | null;
  accountCode: string; // "2300" | "1400"
  debit: number;
  credit: number;
}

export interface GlVatData {
  outputVat: number; // credit movement on 2300, in recorded currency units
  inputVat: number;  // debit movement on 1400
  netVat: number;
  lines: GlVatLine[];
}

export async function collectGlVat(orgId: string, entityId: string, months: string[]): Promise<GlVatData> {
  const monthSet = new Set(months);
  const entries = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.orgId, orgId),
    eq(atelierGlJournalEntry.legalEntityId, entityId),
    isNull(atelierGlJournalEntry.deletedAt),
  ));
  const inScope = new Map(entries.filter((e) => monthSet.has(e.periodLabel) && e.sourceKind !== "vat_return").map((e) => [e.id, e]));
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, orgId), eq(atelierGlAccount.legalEntityId, entityId), isNull(atelierGlAccount.deletedAt),
  ));
  const vatAccountIds = new Map(accounts.filter((a) => a.code === "2300" || a.code === "1400").map((a) => [a.id, a.code]));
  const allLines = await db.select().from(atelierGlJournalLine)
    .where(and(eq(atelierGlJournalLine.orgId, orgId), isNull(atelierGlJournalLine.deletedAt)));
  let outputVat = 0, inputVat = 0;
  const lines: GlVatLine[] = [];
  for (const l of allLines) {
    const entry = inScope.get(l.journalEntryId);
    if (!entry) continue;
    const code = vatAccountIds.get(l.accountId);
    if (!code) continue;
    if (code === "2300") outputVat += (l.credit || 0) - (l.debit || 0);
    else inputVat += (l.debit || 0) - (l.credit || 0);
    lines.push({
      journalEntryId: entry.id, entryDate: entry.entryDate, periodLabel: entry.periodLabel,
      sourceKind: entry.sourceKind, sourceRef: entry.sourceRef ?? null,
      currency: entry.currency || "USD", memo: entry.memo,
      accountCode: code, debit: round2(l.debit || 0), credit: round2(l.credit || 0),
    });
  }
  lines.sort((a, b) => a.entryDate.localeCompare(b.entryDate));
  return { outputVat: round2(outputVat), inputVat: round2(inputVat), netVat: round2(outputVat - inputVat), lines };
}

// ── AED conversion ───────────────────────────────────────────────────────

export interface AedConversion {
  aed: number;
  /** e.g. "USD → AED @ 3.6725 (2026-08-01)" or "AED (no conversion)" */
  chain: string;
  aedPerUnit: number;
}

export async function toAed(amount: number, currency: string, date: string): Promise<AedConversion> {
  const cur = (currency || "USD").toUpperCase();
  if (cur === "AED") return { aed: round2(amount), chain: "AED (no conversion)", aedPerUnit: 1 };
  const usd = await convertToUsd(amount, cur, date);
  const aed = await convertUsdTo(usd.usdAmount, "AED", date);
  const perUnit = amount !== 0 ? aed.amount / amount : aed.rate / (usd.rate || 1);
  return {
    aed: round2(aed.amount),
    chain: `${cur} → AED @ ${round2(perUnit * 10000) / 10000} (${aed.rateDate})`,
    aedPerUnit: perUnit,
  };
}

// ── VAT 201 dataset ──────────────────────────────────────────────────────

export interface Vat201Line {
  date: string;            // YYYY-MM-DD
  ref: string;             // invoice number / journal id / expense ref
  description: string;
  sourceKind: string;
  /** Net (taxable base) in its OWN source currency + conversion applied. */
  netCurrency: string;
  netSource: number;
  netFxChain: string;
  /** VAT in its OWN source currency (GL recording currency) + conversion. */
  vatCurrency: string;
  vatSource: number;
  vatFxChain: string;
  netAed: number;
  vatAed: number;
  note?: string;
}

export interface Vat201Box {
  box: string;   // "1a".."1g", "2".."14"
  label: string;
  netAed: number;
  vatAed: number;
  lines: Vat201Line[];
  note?: string;
}

export interface Vat201Report {
  entityId: string;
  entityName: string;
  trn: string | null;
  period: string;
  months: string[];
  vatPeriodSetting: string | null;
  currency: "AED";
  /** Emirate box (1a–1g) supplies are attributed to, and the evidence used. */
  emirate: { box: string; label: string; basis: string };
  /**
   * Output-side transactions with no classification evidence (manual VAT
   * journals, foreign-jurisdiction VAT, domestic 0% invoices). These are
   * EXCLUDED from the boxes; statutory exports must be refused while any
   * exist — a wrong box allocation is a filing error.
   */
  unclassified: Vat201Line[];
  boxes: Vat201Box[];
  totals: {
    box8NetAed: number;   // total outputs net
    box12VatAed: number;  // total output tax due
    box13VatAed: number;  // total recoverable input tax
    box14NetAed: number;  // net VAT payable (+) / refundable (−)
  };
  glTieBack: {
    outputVat: number; inputVat: number; netVat: number; // as recorded on the GL (existing calculator figures)
    outputVatAed: number; inputVatAed: number;           // same lines, AED-converted
    unclassifiedOutputVatAed: number;                    // GL output VAT excluded from the boxes pending classification
  };
  notes: string[];
  generatedAt: string;
}

const EMIRATES: Array<[string, string]> = [
  ["1a", "Standard rated supplies in Abu Dhabi"],
  ["1b", "Standard rated supplies in Dubai"],
  ["1c", "Standard rated supplies in Sharjah"],
  ["1d", "Standard rated supplies in Ajman"],
  ["1e", "Standard rated supplies in Umm Al Quwain"],
  ["1f", "Standard rated supplies in Ras Al Khaimah"],
  ["1g", "Standard rated supplies in Fujairah"],
];

const EMIRATE_KEYWORDS: Array<[string, RegExp]> = [
  ["1a", /abu\s*dhabi|adgm/i],
  ["1b", /dubai|difc|dmcc|jafza|dso|dwtc/i],
  ["1c", /sharjah|saif\s*zone|shams/i],
  ["1d", /ajman/i],
  ["1e", /umm\s*al[\s-]*quwain|uaq/i],
  ["1f", /ras\s*al[\s-]*khaimah|rakez|rak\b/i],
  ["1g", /fujairah/i],
];

/**
 * Resolve which emirate box (1a–1g) the entity's standard-rated supplies
 * belong to, from its jurisdiction / registered address / premises city.
 * Returns null when the emirate cannot be determined — callers must
 * REFUSE to export rather than silently defaulting (a wrong emirate
 * allocation is a filing error).
 */
export function resolveEmirateBox(ent: typeof atelierLegalEntities.$inferSelect): { box: string; label: string; basis: string } | null {
  const candidates: Array<[string, string]> = [
    ["jurisdiction", ent.jurisdiction || ""],
    ["registered address", ent.registeredAddress || ""],
    ["office address", ent.officeAddress || ""],
    ["premises city", ent.premises?.city || ""],
  ];
  for (const [basis, text] of candidates) {
    if (!text) continue;
    for (const [box, re] of EMIRATE_KEYWORDS) {
      if (re.test(text)) {
        const label = EMIRATES.find(([b]) => b === box)![1];
        return { box, label, basis: `${basis}: "${text}"` };
      }
    }
  }
  return null;
}

export async function computeVat201(
  orgId: string,
  ent: typeof atelierLegalEntities.$inferSelect,
  period: string,
  months: string[],
  emirate: { box: string; label: string; basis: string },
): Promise<Vat201Report> {
  const monthSet = new Set(months);
  const gl = await collectGlVat(orgId, ent.id, months);
  const notes: string[] = [];

  // Source-document enrichment: invoices referenced by output GL lines +
  // zero-rated issued invoices, and VAT-register rows for expense lines.
  const outputLines = gl.lines.filter((l) => l.accountCode === "2300");
  const inputLines = gl.lines.filter((l) => l.accountCode === "1400");

  const invoiceRefs = [...new Set(outputLines.filter((l) => l.sourceKind === "invoice" && l.sourceRef).map((l) => l.sourceRef as string))];
  const invById = new Map<string, typeof atelierInvoice.$inferSelect>();
  if (invoiceRefs.length) {
    const rows = await db.select().from(atelierInvoice).where(and(
      eq(atelierInvoice.orgId, orgId), inArray(atelierInvoice.id, invoiceRefs),
    ));
    for (const r of rows) invById.set(r.id, r);
  }
  // Zero-rated supplies never touch 2300 — pull them from issued 0%-rated
  // invoices tagged to this entity in the period.
  const entityInvoices = await db.select().from(atelierInvoice).where(and(
    eq(atelierInvoice.orgId, orgId),
    eq(atelierInvoice.legalEntityId, ent.id),
    isNull(atelierInvoice.deletedAt),
  ));
  const zeroRated = entityInvoices.filter((inv) =>
    inv.issuedAt && !inv.voidedAt && inv.vatRatePct === 0 &&
    monthSet.has(inv.issuedAt.toISOString().slice(0, 7)));

  const expenseRefs = [...new Set(inputLines.filter((l) => l.sourceKind === "expense" && l.sourceRef).map((l) => l.sourceRef as string))];
  const regByExpense = new Map<string, typeof atelierVatRegister.$inferSelect>();
  if (expenseRefs.length) {
    const regs = await db.select().from(atelierVatRegister).where(and(
      eq(atelierVatRegister.orgId, orgId), inArray(atelierVatRegister.expenseId, expenseRefs),
    ));
    for (const r of regs) if (!regByExpense.has(r.expenseId)) regByExpense.set(r.expenseId, r);
  }

  // ── Box 1 (standard-rated supplies) — attributed to the entity's
  //    resolved emirate of establishment (fixed place of business rule).
  //    Only output-VAT lines with classification EVIDENCE (an AR invoice
  //    billed under the AE jurisdiction at a positive rate) are filed as
  //    standard-rated. Anything else on the output VAT account (manual
  //    journals, foreign-jurisdiction VAT, unresolvable refs) is a
  //    BLOCKING data gap: it is listed under `unclassified` and callers
  //    must refuse the statutory export until it is reclassified. ──
  const box1Lines: Vat201Line[] = [];
  const unclassifiedLines: Vat201Line[] = [];
  for (const l of outputLines) {
    const vatSrc = round2((l.credit || 0) - (l.debit || 0));
    const inv = l.sourceKind === "invoice" && l.sourceRef ? invById.get(l.sourceRef) : undefined;
    const vatFx = await toAed(vatSrc, l.currency, l.entryDate);
    if (inv && inv.jurisdiction === "AE" && inv.vatRatePct > 0) {
      const netFx = await toAed(inv.subtotal, inv.currency, l.entryDate);
      box1Lines.push({
        date: l.entryDate.slice(0, 10),
        ref: inv.invoiceNumber || l.journalEntryId,
        description: `Invoice ${inv.invoiceNumber ?? inv.id}${inv.billTo?.name ? ` — ${inv.billTo.name}` : ""} (AE, ${inv.vatRatePct}%)`,
        sourceKind: l.sourceKind,
        netCurrency: inv.currency, netSource: inv.subtotal, netFxChain: netFx.chain,
        vatCurrency: l.currency, vatSource: vatSrc, vatFxChain: vatFx.chain,
        netAed: netFx.aed, vatAed: vatFx.aed,
      });
    } else {
      const why = inv
        ? `invoice billed under jurisdiction ${inv.jurisdiction} at ${inv.vatRatePct}% — not a classified UAE standard-rated supply`
        : `no source invoice (${l.sourceKind} journal) — VAT treatment unknown`;
      unclassifiedLines.push({
        date: l.entryDate.slice(0, 10),
        ref: inv?.invoiceNumber || l.journalEntryId,
        description: `${inv ? `Invoice ${inv.invoiceNumber ?? inv.id}` : (l.memo ?? l.sourceKind)}`,
        sourceKind: l.sourceKind,
        netCurrency: l.currency, netSource: 0, netFxChain: "—",
        vatCurrency: l.currency, vatSource: vatSrc, vatFxChain: vatFx.chain,
        netAed: 0, vatAed: vatFx.aed,
        note: why,
      });
    }
  }

  // ── Box 4 (zero-rated supplies) — only invoices with export EVIDENCE:
  //    0% rate AND billed under a non-AE jurisdiction (supply to a
  //    recipient outside the UAE). Domestic 0% invoices are ambiguous
  //    (could be exempt, out of scope, or zero-rated domestic) and are a
  //    blocking data gap instead. ──
  const box4Lines: Vat201Line[] = [];
  for (const inv of zeroRated) {
    const d = inv.issuedAt!.toISOString().slice(0, 10);
    const netFx = await toAed(inv.subtotal, inv.currency, d);
    if (inv.jurisdiction !== "AE") {
      box4Lines.push({
        date: d,
        ref: inv.invoiceNumber || inv.id,
        description: `Invoice ${inv.invoiceNumber ?? inv.id}${inv.billTo?.name ? ` — ${inv.billTo.name}` : ""} (0% — export, billing jurisdiction ${inv.jurisdiction})`,
        sourceKind: "invoice",
        netCurrency: inv.currency, netSource: inv.subtotal, netFxChain: netFx.chain,
        vatCurrency: inv.currency, vatSource: 0, vatFxChain: "—",
        netAed: netFx.aed, vatAed: 0,
      });
    } else {
      unclassifiedLines.push({
        date: d,
        ref: inv.invoiceNumber || inv.id,
        description: `Invoice ${inv.invoiceNumber ?? inv.id}${inv.billTo?.name ? ` — ${inv.billTo.name}` : ""}`,
        sourceKind: "invoice",
        netCurrency: inv.currency, netSource: inv.subtotal, netFxChain: netFx.chain,
        vatCurrency: inv.currency, vatSource: 0, vatFxChain: "—",
        netAed: netFx.aed, vatAed: 0,
        note: "0%-rated invoice under the AE jurisdiction — ambiguous between zero-rated, exempt and out-of-scope; classify before filing",
      });
    }
  }

  // ── Box 9 (standard-rated expenses / recoverable input tax) ──
  const box9Lines: Vat201Line[] = [];
  for (const l of inputLines) {
    const vatSrc = round2((l.debit || 0) - (l.credit || 0));
    const reg = l.sourceKind === "expense" && l.sourceRef ? regByExpense.get(l.sourceRef) : undefined;
    let netSource: number;
    let netCurrency = l.currency;
    let note: string | undefined;
    if (reg) {
      netSource = reg.netAmount;
      netCurrency = reg.currency;
      if (reg.treatment && reg.treatment !== "uae_5") note = `VAT register treatment: ${reg.treatment}`;
    } else {
      netSource = round2(vatSrc / 0.05);
      note = "base derived at 5% from GL VAT amount";
    }
    const vatFx = await toAed(vatSrc, l.currency, l.entryDate);
    const netFx = await toAed(netSource, netCurrency, l.entryDate);
    box9Lines.push({
      date: l.entryDate.slice(0, 10),
      ref: l.sourceRef || l.journalEntryId,
      description: reg ? `${reg.merchant ?? "Expense"}${reg.summary ? ` — ${reg.summary}` : ""}` : (l.memo ?? l.sourceKind),
      sourceKind: l.sourceKind,
      netCurrency, netSource, netFxChain: netFx.chain,
      vatCurrency: l.currency, vatSource: vatSrc, vatFxChain: vatFx.chain,
      netAed: netFx.aed, vatAed: vatFx.aed, note,
    });
  }

  const sumNet = (ls: Vat201Line[]) => round2(ls.reduce((s, l) => s + l.netAed, 0));
  const sumVat = (ls: Vat201Line[]) => round2(ls.reduce((s, l) => s + l.vatAed, 0));

  const emptyNote = "No classified source data — reported as zero. Review before filing if such transactions occurred.";
  const boxes: Vat201Box[] = [
    ...EMIRATES.map(([box, label]) => ({
      box, label,
      netAed: box === emirate.box ? sumNet(box1Lines) : 0,
      vatAed: box === emirate.box ? sumVat(box1Lines) : 0,
      lines: box === emirate.box ? box1Lines : [],
      note: box === emirate.box ? `All supplies attributed to this emirate — entity's fixed establishment resolved from ${emirate.basis}.` : undefined,
    })),
    { box: "2", label: "Tax refunds provided to tourists", netAed: 0, vatAed: 0, lines: [], note: emptyNote },
    { box: "3", label: "Supplies subject to the reverse charge provisions", netAed: 0, vatAed: 0, lines: [], note: emptyNote },
    { box: "4", label: "Zero rated supplies", netAed: sumNet(box4Lines), vatAed: 0, lines: box4Lines },
    { box: "5", label: "Exempt supplies", netAed: 0, vatAed: 0, lines: [], note: emptyNote },
    { box: "6", label: "Goods imported into the UAE", netAed: 0, vatAed: 0, lines: [], note: emptyNote },
    { box: "7", label: "Adjustments to goods imported into the UAE", netAed: 0, vatAed: 0, lines: [], note: emptyNote },
  ];
  const box8Net = round2(boxes.reduce((s, b) => s + b.netAed, 0));
  const box8Vat = round2(boxes.reduce((s, b) => s + b.vatAed, 0));
  boxes.push({ box: "8", label: "Totals (outputs)", netAed: box8Net, vatAed: box8Vat, lines: [] });
  boxes.push({ box: "9", label: "Standard rated expenses", netAed: sumNet(box9Lines), vatAed: sumVat(box9Lines), lines: box9Lines });
  boxes.push({ box: "10", label: "Supplies subject to the reverse charge provisions (recoverable)", netAed: 0, vatAed: 0, lines: [], note: emptyNote });
  const box11Net = round2(sumNet(box9Lines));
  const box11Vat = round2(sumVat(box9Lines));
  boxes.push({ box: "11", label: "Totals (inputs)", netAed: box11Net, vatAed: box11Vat, lines: [] });
  const box12 = box8Vat;
  const box13 = box11Vat;
  const box14 = round2(box12 - box13);
  boxes.push({ box: "12", label: "Total value of due tax for the period", netAed: 0, vatAed: box12, lines: [] });
  boxes.push({ box: "13", label: "Total value of recoverable tax for the period", netAed: 0, vatAed: box13, lines: [] });
  boxes.push({ box: "14", label: box14 >= 0 ? "Net VAT payable to the FTA" : "Net VAT refundable / carried forward", netAed: 0, vatAed: box14, lines: [] });

  notes.push("Box VAT figures are built from the same GL VAT-account journal lines (2300 output / 1400 input) as the internal VAT return calculator; boxes 12/13 tie to it exactly after AED conversion once all output transactions are classified.");
  if (unclassifiedLines.length)
    notes.push(`${unclassifiedLines.length} output-side transaction(s) lack VAT classification evidence and are EXCLUDED from the boxes — the statutory export is blocked until they are reclassified (see the unclassified schedule).`);
  if (box1Lines.some((l) => l.note) || box9Lines.some((l) => l.note))
    notes.push("Lines marked 'base derived at 5%' have no linked source document; their taxable base is imputed from the GL VAT amount at the UAE standard rate.");
  notes.push("Boxes 2, 3, 5, 6, 7 and 10 (tourist refunds, reverse charge, exempt supplies, imports) have no classified source data in this build and default to zero.");
  notes.push("Amounts converted to AED via the firm FX table (source currency → USD → AED); the conversion applied is shown on each schedule line.");

  const outAed = sumVat(box1Lines);
  const inAed = sumVat(box9Lines);
  // TRN (tax registration number) from the entity's registrations, if recorded.
  const trnReg = (ent.registrations ?? []).find((r) => {
    const hay = `${r.type ?? ""} ${r.label ?? ""}`.toLowerCase();
    return r.type === "tax" || hay.includes("vat") || hay.includes("trn") || hay.includes("tax registration");
  });

  return {
    entityId: ent.id,
    entityName: ent.shortName || ent.legalNameEn,
    trn: trnReg?.number ?? null,
    period, months,
    vatPeriodSetting: ent.fiscal?.vatPeriod ?? null,
    currency: "AED",
    emirate,
    unclassified: unclassifiedLines,
    boxes,
    totals: { box8NetAed: box8Net, box12VatAed: box12, box13VatAed: box13, box14NetAed: box14 },
    glTieBack: {
      outputVat: gl.outputVat, inputVat: gl.inputVat, netVat: gl.netVat,
      outputVatAed: outAed, inputVatAed: inAed,
      unclassifiedOutputVatAed: round2(unclassifiedLines.reduce((s, l) => s + l.vatAed, 0)),
    },
    notes,
    generatedAt: new Date().toISOString(),
  };
}
