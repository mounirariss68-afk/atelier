/**
 * Task #396 — shared receipt/invoice parse pipeline.
 *
 * Used by BOTH the Me-lens parse endpoint (self-scope, mobile + portal) and
 * the Wallet parse endpoint (approver-facing). One code path:
 *
 *   receipt bytes → (image → vision) | (PDF → text layer → OCR → vision)
 *   → Expense Auditor → FX + policy → layered merchant resolution
 *     (org memory → global DB / keyword / fuzzy → AI legacy mapping)
 *   → expense row update + audit event.
 *
 * Fail-loud: every failure returns a typed { ok:false, status, body } the
 * route surfaces verbatim (422/502), never a silent guess.
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  atelierExpenses,
  atelierAuditEvents,
  atelierCliAttachments,
  type atelierUsers,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage.js";
import { loadAttachmentBytes, CLI_ENC_PREFIX } from "./atelier-cli/attachments/storage.js";
import { isHeicPayload, convertHeicToJpeg } from "./atelier-heic.js";
import { extractPdfText, renderPdfPageImage } from "./atelier-merchant/pdf.js";
import { matchMerchant } from "./atelier-merchant/matcher.js";
import { normalizeMerchant } from "./atelier-merchant/normalizer.js";
import { lookupMerchantMemory } from "./atelier-expense-categorizer.js";
import { lookupMerchantAlias } from "./atelier-merchant/aliases.js";
import { mapLegacyCategory } from "./atelier-expense-taxonomy.js";
import { buildContractDigest } from "./atelier-contract-digest.js";
import { convertToUsd } from "./atelier-fx.js";
import { evaluateExpense } from "./atelier-expense-policy.js";
import { runExpenseAuditor } from "./atelier-agents/runner.js";
import { assertAuditAction } from "../routes/atelier/auditContract.js";
import { proposeExpenseAllocation } from "./atelier-entity-allocation.js";

type ExpenseRow = typeof atelierExpenses.$inferSelect;
type UserRow = typeof atelierUsers.$inferSelect;
type ExpenseAuditorProposal = Awaited<ReturnType<typeof runExpenseAuditor>>["proposal"];

export const RECEIPT_PARSE_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/**
 * Task #500 — optional category-specific enrichment extracted alongside the
 * base fields. Every field is optional and MUST only be present when the
 * receipt actually prints the information (never inferred).
 */
export interface ReceiptEnrichmentDetails {
  trip?: {
    pickup?: string;
    dropoff?: string;
    datetime?: string;
  };
  flight?: {
    route?: string;
    airline?: string;
    travelClass?: string;
    passenger?: string;
    reference?: string;
  };
  stay?: {
    checkIn?: string;
    checkOut?: string;
    nights?: number;
    city?: string;
  };
  covers?: number;
  rental?: {
    period?: string;
    pickupLocation?: string;
    returnLocation?: string;
    vehicleClass?: string;
  };
  billingPeriod?: {
    service?: string;
    start?: string;
    end?: string;
  };
}

export interface VisionReceiptExtraction {
  merchant?: string;
  merchantOriginalScript?: string;
  date?: string;
  total?: number;
  tax?: number;
  currency?: string;
  country?: string;
  category?: string;
  rawText?: string;
  confidence?: "green" | "amber" | "red";
  unreadable?: boolean;
  details?: ReceiptEnrichmentDetails;
  // Task #652 — cross-check inputs so the server can validate amounts.
  subtotal?: number;
  totalMentions?: number[];
  /** Server-set: reasons the arithmetic cross-check corrected or downgraded. */
  amountValidation?: {
    status: "ok" | "corrected" | "downgraded" | "skipped";
    reasons: string[];
  };
}

const EXTRACT_FIELDS_SPEC =
  "merchant (string), merchantOriginalScript (string, ONLY when the merchant name on the receipt is printed in a non-Latin script — the name exactly as printed), date (YYYY-MM-DD if visible), total (number, grand total), tax (number, 0 if none), currency (3-letter ISO code), country (short code like KSA/UAE/US if inferable), category (one of flight|hotel|meal|gift|software|mileage|per_diem|taxi|other), rawText (the visible text, condensed), confidence (green if crisp and unambiguous, amber if partly readable, red if barely readable), unreadable (true ONLY if this is not a receipt/invoice or nothing is readable), subtotal (number, OPTIONAL — the printed pre-tax subtotal/net amount ONLY when the receipt explicitly prints one; omit otherwise), totalMentions (array of numbers, OPTIONAL — when the grand total amount is printed more than once, every printed occurrence; omit when printed only once), details (OPTIONAL object, see rules below)";

const EXTRACT_GUIDANCE = `
Amount-reading rules (CRITICAL — misreading an amount is the worst possible failure):
- Currency symbols and marks are NEVER digits. Arabic and regional currency glyphs (د.إ for AED, ر.س / ﷼ for SAR, ج.م for EGP, د.ك for KWD, ₺ for TRY) printed directly before or after a number are part of the currency, not the amount — "د.إ657.72" means 657.72, NEVER 4657.72. Do not let any part of a currency glyph become a leading or trailing digit.
- Masked card-number fragments (e.g. "···· 4722", "**** 4722", "ending in 4722") are never amounts and must never merge into an adjacent amount.
- Read every amount digit-for-digit exactly as printed. When the same total is printed in more than one place, all occurrences must agree — if they seem to disagree, re-read them before answering.
- Sanity-check yourself: when a subtotal and tax are printed, subtotal + tax must equal the total. If your reading fails that arithmetic, re-read the amounts.

Multilingual rules: receipts may be in English, Arabic, or Turkish. Extract fields the same way regardless of language. Always return "merchant" in Latin script — transliterate Arabic names and keep Turkish names as written but in Latin characters; when the printed name uses a non-Latin script, also return it verbatim in "merchantOriginalScript". Keep the original-language text in "rawText".

The "details" object carries category-specific enrichment. Include a sub-object ONLY when the receipt explicitly prints that information — NEVER infer, guess, or fabricate any detail. Omit "details" entirely (or any sub-field) when the information is not printed. Sub-objects (all fields optional strings unless noted):
- trip (taxi / ride-hailing e.g. Uber, Careem, Bolt, BiTaksi): { pickup, dropoff, datetime (trip date/time as printed) }
- flight (flight ticket/invoice): { route (e.g. "IST → DXB", use IATA codes when printed), airline, travelClass (economy|premium_economy|business|first as printed), passenger, reference (ticket number or PNR) }
- stay (hotel): { checkIn (YYYY-MM-DD), checkOut (YYYY-MM-DD), nights (number), city }
- covers (restaurant/entertainment): number of covers/guests, ONLY if printed
- rental (car rental): { period (e.g. "2026-07-01 to 2026-07-04"), pickupLocation, returnLocation, vehicleClass }
- billingPeriod (subscription/software invoice): { service (service/plan name), start (YYYY-MM-DD), end (YYYY-MM-DD) }`;

// ---- Task #652 — arithmetic cross-check of extracted amounts -------------
//
// A vision model misread the Arabic dirham glyph (د.إ) prefixed to amounts as
// a leading digit "4" (total د.إ657.72 → 4657.72) while still reporting green
// confidence. The server now validates the extracted numbers against
// independent evidence on the receipt (printed subtotal, repeated total
// occurrences, rawText) and either self-corrects the single unambiguous
// stray-leading-digit case or downgrades confidence so the draft lands in
// needs-review — never silently confidently wrong.

const AMOUNT_TOLERANCE = 0.02;

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

function posNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Candidate amounts obtained by stripping stray leading digits (e.g. 4657.72 → 657.72). */
function strippedCandidates(n: number): number[] {
  const out: number[] = [];
  let s = n.toFixed(2);
  // Strip up to 2 stray leading digits, keeping at least one integer digit.
  for (let i = 0; i < 2; i++) {
    const intPart = s.split(".")[0];
    if (intPart.length <= 1) break;
    s = s.slice(1);
    const cand = Number(s);
    if (Number.isFinite(cand) && cand > 0) out.push(cand);
  }
  return out;
}

/** Boundary-aware check that an amount appears in the receipt text (plain or comma-grouped). */
export function amountInText(text: string, n: number): boolean {
  if (!text) return false;
  const plain = n.toFixed(2);
  const grouped = plain.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const bare = Number.isInteger(n) ? String(n) : null;
  const forms = [plain, grouped, ...(bare ? [bare] : [])];
  for (const f of forms) {
    const esc = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(?<![\\d.,])${esc}(?![\\d])`).test(text)) return true;
  }
  return false;
}

/**
 * Validate the extracted total/tax against independent numbers on the receipt.
 * Mutates nothing — returns a new extraction with either corrected amounts
 * (only when the arithmetic unambiguously forces a single stray-leading-digit
 * fix) or a downgraded confidence (green → amber) when the numbers are
 * internally inconsistent. Receipts without a printed subtotal / repeated
 * total are left untouched (no false positives).
 */
export function validateReceiptAmounts(
  vision: VisionReceiptExtraction,
): VisionReceiptExtraction {
  if (vision.unreadable) return vision;
  const total = posNum(vision.total);
  if (total === undefined) return vision;
  const tax = Number.isFinite(Number(vision.tax)) && Number(vision.tax) >= 0 ? Number(vision.tax) : 0;
  const subtotal = posNum(vision.subtotal);
  const mentions = Array.isArray(vision.totalMentions)
    ? vision.totalMentions.map(posNum).filter((n): n is number => n !== undefined).slice(0, 10)
    : [];
  const rawText = typeof vision.rawText === "string" ? vision.rawText : "";
  const reasons: string[] = [];

  const finish = (
    status: "ok" | "corrected" | "downgraded" | "skipped",
    patch: Partial<VisionReceiptExtraction> = {},
  ): VisionReceiptExtraction => {
    const out: VisionReceiptExtraction = {
      ...vision,
      ...patch,
      amountValidation: { status, reasons },
    };
    if (status === "downgraded" && out.confidence !== "red") out.confidence = "amber";
    return out;
  };

  // --- Check 1: subtotal + tax = total (strongest signal) ---
  if (subtotal !== undefined) {
    if (approxEq(subtotal + tax, total)) return finish("ok");
    reasons.push(
      `subtotal ${subtotal.toFixed(2)} + tax ${tax.toFixed(2)} != total ${total.toFixed(2)}`,
    );
    // Try the unambiguous stray-leading-digit corrections.
    const totalCands = [total, ...strippedCandidates(total)];
    const taxCands = [tax, ...(tax > 0 ? strippedCandidates(tax) : [])];
    const fixes: Array<{ total: number; tax: number }> = [];
    for (const tc of totalCands) {
      for (const xc of taxCands) {
        if (tc === total && xc === tax) continue;
        if (approxEq(subtotal + xc, tc)) fixes.push({ total: tc, tax: xc });
      }
    }
    if (fixes.length === 1) {
      const fix = fixes[0];
      // rawText must not contradict the fix: if the ORIGINAL total is
      // verifiably printed but the corrected one is not, don't correct.
      const origInText = amountInText(rawText, total);
      const fixInText = amountInText(rawText, fix.total);
      if (origInText && !fixInText) {
        reasons.push("rawText contradicts correction");
        return finish("downgraded");
      }
      reasons.push(
        `corrected via subtotal arithmetic → total ${fix.total.toFixed(2)}, tax ${fix.tax.toFixed(2)}`,
      );
      return finish("corrected", { total: fix.total, tax: fix.tax });
    }
    reasons.push(
      fixes.length === 0 ? "no unambiguous correction found" : "multiple candidate corrections — ambiguous",
    );
    return finish("downgraded");
  }

  // --- Check 2: repeated printed totals must agree ---
  if (mentions.length > 0) {
    const disagreeing = mentions.filter((m) => !approxEq(m, total));
    if (disagreeing.length > 0) {
      reasons.push(`total ${total.toFixed(2)} disagrees with printed occurrence(s) ${disagreeing.map((m) => m.toFixed(2)).join(", ")}`);
      // If ALL mentions agree with each other and match a stripped candidate,
      // the correction is unambiguous.
      const first = mentions[0];
      const allAgree = mentions.every((m) => approxEq(m, first));
      if (allAgree && strippedCandidates(total).some((c) => approxEq(c, first))) {
        reasons.push(`corrected via repeated printed total → ${first.toFixed(2)}`);
        return finish("corrected", { total: first });
      }
      return finish("downgraded");
    }
    return finish("ok");
  }

  // --- Check 3 (weak): total should appear in rawText when text is rich ---
  if (rawText && !amountInText(rawText, total)) {
    const cands = strippedCandidates(total).filter((c) => amountInText(rawText, c));
    if (cands.length === 1) {
      // Only downgrade — a lone rawText hit is not strong enough to rewrite
      // the amount, but it IS strong enough to distrust green confidence.
      reasons.push(`total ${total.toFixed(2)} not printed in rawText but ${cands[0].toFixed(2)} is`);
      return finish("downgraded");
    }
    return finish("skipped");
  }

  return finish(rawText ? "ok" : "skipped");
}

function parseModelJson(text: string): VisionReceiptExtraction {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("extract-non-json");
  }
  return JSON.parse(stripped.slice(start, end + 1)) as VisionReceiptExtraction;
}

export async function extractReceiptWithVision(
  bytes: Buffer,
  mediaType: string,
): Promise<VisionReceiptExtraction> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 45000),
  );
  try {
    const resp = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: `You are an expense-receipt OCR extractor. Read the receipt image and reply with ONLY a single JSON object (no prose, no code fences) with fields: ${EXTRACT_FIELDS_SPEC}.\n${EXTRACT_GUIDANCE}`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
                  data: bytes.toString("base64"),
                },
              },
              { type: "text", text: "Extract this receipt." },
            ],
          },
        ],
      },
      { signal: ac.signal },
    );
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    return validateReceiptAmounts(parseModelJson(text));
  } finally {
    clearTimeout(timer);
  }
}

export async function extractReceiptFromText(
  rawText: string,
): Promise<VisionReceiptExtraction> {
  const { anthropic } = await import("@workspace/integrations-anthropic-ai");
  const ac = new AbortController();
  const timer = setTimeout(
    () => ac.abort(),
    Number(process.env.ATELIER_AGENT_TIMEOUT_MS ?? 45000),
  );
  try {
    const resp = await anthropic.messages.create(
      {
        model: "claude-haiku-4-5",
        max_tokens: 2048,
        system: `You are an expense-receipt/invoice extractor. Read the extracted document text and reply with ONLY a single JSON object (no prose, no code fences) with fields: ${EXTRACT_FIELDS_SPEC}.\n${EXTRACT_GUIDANCE}`,
        messages: [
          {
            role: "user",
            content: `Extract this receipt/invoice text:\n\n${rawText.slice(0, 20000)}`,
          },
        ],
      },
      { signal: ac.signal },
    );
    const block = resp.content[0];
    const text = block && block.type === "text" ? block.text.trim() : "";
    return validateReceiptAmounts(parseModelJson(text));
  } finally {
    clearTimeout(timer);
  }
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

// ---- Task #500 — enrichment sanitize + description composition ----------

function cleanStr(v: unknown, max = 120): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, max) : undefined;
}

function cleanNum(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function prune<T extends Record<string, unknown>>(obj: T): T | undefined {
  const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
  return entries.length ? (Object.fromEntries(entries) as T) : undefined;
}

/**
 * Defensive sanitation of the model-returned `details` object: only known
 * keys survive, strings are trimmed/capped, numbers validated. Returns
 * undefined when nothing usable remains so absent enrichment stays absent.
 */
export function sanitizeReceiptDetails(raw: unknown): ReceiptEnrichmentDetails | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const d = raw as Record<string, unknown>;
  const t = d.trip as Record<string, unknown> | undefined;
  const f = d.flight as Record<string, unknown> | undefined;
  const s = d.stay as Record<string, unknown> | undefined;
  const r = d.rental as Record<string, unknown> | undefined;
  const b = d.billingPeriod as Record<string, unknown> | undefined;
  const out: ReceiptEnrichmentDetails = {
    trip:
      t && typeof t === "object"
        ? prune({ pickup: cleanStr(t.pickup), dropoff: cleanStr(t.dropoff), datetime: cleanStr(t.datetime, 60) })
        : undefined,
    flight:
      f && typeof f === "object"
        ? prune({
            route: cleanStr(f.route, 60),
            airline: cleanStr(f.airline, 80),
            travelClass: cleanStr(f.travelClass, 40),
            passenger: cleanStr(f.passenger, 80),
            reference: cleanStr(f.reference, 40),
          })
        : undefined,
    stay:
      s && typeof s === "object"
        ? prune({
            checkIn: isIsoDate(s.checkIn) ? s.checkIn : undefined,
            checkOut: isIsoDate(s.checkOut) ? s.checkOut : undefined,
            nights: cleanNum(s.nights),
            city: cleanStr(s.city, 80),
          })
        : undefined,
    covers: cleanNum(d.covers),
    rental:
      r && typeof r === "object"
        ? prune({
            period: cleanStr(r.period, 60),
            pickupLocation: cleanStr(r.pickupLocation),
            returnLocation: cleanStr(r.returnLocation),
            vehicleClass: cleanStr(r.vehicleClass, 60),
          })
        : undefined,
    billingPeriod:
      b && typeof b === "object"
        ? prune({
            service: cleanStr(b.service, 80),
            start: isIsoDate(b.start) ? b.start : undefined,
            end: isIsoDate(b.end) ? b.end : undefined,
          })
        : undefined,
  };
  return prune(out as Record<string, unknown>) as ReceiptEnrichmentDetails | undefined;
}

/** Compact human-readable detail fragment, or "" when nothing to show. */
export function formatReceiptDetails(details: ReceiptEnrichmentDetails | undefined): string {
  if (!details) return "";
  const parts: string[] = [];
  if (details.trip) {
    const { pickup, dropoff, datetime } = details.trip;
    const route = pickup && dropoff ? `${pickup} → ${dropoff}` : pickup || dropoff;
    const bits = [route, datetime].filter(Boolean);
    if (bits.length) parts.push(`Trip: ${bits.join(", ")}`);
  }
  if (details.flight) {
    const { route, airline, travelClass, passenger, reference } = details.flight;
    const bits = [route, airline, travelClass, passenger, reference ? `ref ${reference}` : undefined].filter(Boolean);
    if (bits.length) parts.push(`Flight: ${bits.join(", ")}`);
  }
  if (details.stay) {
    const { checkIn, checkOut, nights, city } = details.stay;
    const range = checkIn && checkOut ? `${checkIn} – ${checkOut}` : checkIn || checkOut;
    const bits = [range, nights ? `${nights} night${nights === 1 ? "" : "s"}` : undefined, city].filter(Boolean);
    if (bits.length) parts.push(`Stay: ${bits.join(", ")}`);
  }
  if (details.covers) {
    parts.push(`${details.covers} cover${details.covers === 1 ? "" : "s"}`);
  }
  if (details.rental) {
    const { period, pickupLocation, returnLocation, vehicleClass } = details.rental;
    const locs =
      pickupLocation && returnLocation && pickupLocation !== returnLocation
        ? `${pickupLocation} → ${returnLocation}`
        : pickupLocation || returnLocation;
    const bits = [period, locs, vehicleClass].filter(Boolean);
    if (bits.length) parts.push(`Rental: ${bits.join(", ")}`);
  }
  if (details.billingPeriod) {
    const { service, start, end } = details.billingPeriod;
    const range = start && end ? `${start} – ${end}` : start || end;
    const bits = [service, range].filter(Boolean);
    if (bits.length) parts.push(`Subscription: ${bits.join(", ")}`);
  }
  return parts.join(" · ");
}

/**
 * Append the enrichment fragment to a base description/summary. Degrades to
 * the base string unchanged when no enrichment is present.
 */
export function composeEnrichedSummary(
  base: string | null | undefined,
  details: ReceiptEnrichmentDetails | undefined,
): string {
  const detail = formatReceiptDetails(details);
  const b = (base ?? "").trim();
  if (!detail) return b;
  if (!b) return detail;
  return `${b} — ${detail}`;
}

export type ReceiptParseResult =
  | {
      ok: true;
      expense: ExpenseRow;
      runId: string;
      proposal: ExpenseAuditorProposal;
      policyFindings: unknown;
    }
  | { ok: false; status: number; body: Record<string, unknown> };

/** Magic-byte sniff for blobs stored without a useful content type. */
function sniffMediaType(bytes: Buffer): string {
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "%PDF") return "application/pdf";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 4 && bytes.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  return "application/octet-stream";
}

/**
 * Full parse pipeline for an expense with an attached receipt/invoice.
 * Caller is responsible for AUTH (self-scope or wallet ACL) — this function
 * assumes the actor may parse this row.
 */
export async function parseReceiptForExpense(args: {
  row: ExpenseRow;
  me: UserRow;
  via: string;
}): Promise<ReceiptParseResult> {
  const { row, me, via } = args;
  const ref = row.receiptFileRef ?? "";
  if (!ref || (!ref.startsWith("/objects/") && !ref.startsWith(CLI_ENC_PREFIX))) {
    return {
      ok: false,
      status: 400,
      body: { error: "no-receipt", message: "Attach a receipt first, then parse it." },
    };
  }

  let bytes: Buffer;
  let mediaType: string;
  if (ref.startsWith(CLI_ENC_PREFIX)) {
    // Task #1263 — chat-created expenses store `enc:cli:<attachmentId>`
    // (the CLI attachment id, whose row carries the actual blob pointer).
    // Resolve attachment row → blob; fall back to treating the ref itself
    // as a raw blob key for defensiveness.
    const key = ref.slice(CLI_ENC_PREFIX.length);
    const [att] = await db
      .select()
      .from(atelierCliAttachments)
      .where(
        and(
          eq(atelierCliAttachments.id, key),
          eq(atelierCliAttachments.orgId, me.orgId),
        ),
      );
    let loaded: Buffer | null = null;
    if (att?.encryptedRef) {
      loaded = await loadAttachmentBytes(att.encryptedRef);
    }
    if (!loaded) {
      loaded = await loadAttachmentBytes(ref);
    }
    if (!loaded) {
      return { ok: false, status: 404, body: { error: "no-receipt" } };
    }
    bytes = loaded;
    mediaType = (att?.mime ?? "").split(";")[0].trim().toLowerCase();
    if (!mediaType || mediaType === "application/octet-stream") {
      mediaType = sniffMediaType(bytes);
    }
  } else {
    const svc = new ObjectStorageService();
    try {
      const file = await svc.getObjectEntityFile(ref);
      const dl = await svc.downloadObject(file, 60);
      mediaType = (dl.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      bytes = Buffer.from(await dl.arrayBuffer());
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        return { ok: false, status: 404, body: { error: "no-receipt" } };
      }
      throw err;
    }
  }
  // Task #554 — iPhone photos arrive as HEIC (sometimes with a generic
  // content type from object storage): convert to JPEG before the vision
  // extractor, which doesn't accept HEIC.
  if (isHeicPayload(bytes, mediaType)) {
    if (bytes.length > 8 * 1024 * 1024) {
      return {
        ok: false,
        status: 422,
        body: {
          error: "receipt-too-large",
          message: "Receipt image exceeds 8MB — retake at lower resolution.",
        },
      };
    }
    try {
      bytes = await convertHeicToJpeg(bytes);
    } catch {
      return {
        ok: false,
        status: 422,
        body: {
          error: "unreadable-receipt-image",
          message: "This HEIC photo couldn't be decoded — retake it or export it as JPEG and re-upload.",
          mediaType: mediaType || "image/heic",
        },
      };
    }
    mediaType = "image/jpeg";
  }
  if (!RECEIPT_PARSE_MEDIA.has(mediaType)) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "unsupported-receipt-type",
        message: "Receipt parsing supports photos (JPEG/PNG/WebP/GIF/HEIC) and PDF invoices.",
        mediaType,
      },
    };
  }
  const isPdf = mediaType === "application/pdf";
  const maxBytes = (isPdf ? 15 : 8) * 1024 * 1024;
  if (bytes.length > maxBytes) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "receipt-too-large",
        message: isPdf
          ? "PDF invoice exceeds 15MB — upload a smaller file."
          : "Receipt image exceeds 8MB — retake at lower resolution.",
      },
    };
  }

  // PDFs: text layer → tesseract OCR → vision-on-render fallback.
  let vision: VisionReceiptExtraction;
  let extractionMethod: "vision" | "pdf_text_layer" | "pdf_ocr" | "pdf_vision" = "vision";
  try {
    if (isPdf) {
      const pdf = await extractPdfText(new Uint8Array(bytes));
      if (pdf.quality.isUsable) {
        extractionMethod = pdf.method === "text_layer" ? "pdf_text_layer" : "pdf_ocr";
        vision = await extractReceiptFromText(pdf.text);
        if (!vision.rawText) vision.rawText = pdf.text.slice(0, 4000);
      } else {
        extractionMethod = "pdf_vision";
        const pageImage = await renderPdfPageImage(new Uint8Array(bytes), 1, 200);
        vision = await extractReceiptWithVision(pageImage, "image/png");
      }
    } else {
      vision = await extractReceiptWithVision(bytes, mediaType);
    }
  } catch (err) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "receipt-parse-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  if (vision.unreadable) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "receipt-unreadable",
        message: "Could not read this file as a receipt — retake the photo or upload a clearer document.",
      },
    };
  }

  // Vision fields become the OCR payload for the EXISTING Expense Auditor.
  const amount =
    Number.isFinite(Number(vision.total)) && Number(vision.total) > 0
      ? Number(vision.total)
      : row.amount;
  const currency =
    typeof vision.currency === "string" && /^[A-Za-z]{3}$/.test(vision.currency)
      ? vision.currency.toUpperCase()
      : row.currency;
  const expenseDate = isIsoDate(vision.date) ? vision.date : row.expenseDate;
  // Task #500 — category-specific enrichment (sanitized; absent stays absent).
  const details = sanitizeReceiptDetails(vision.details);
  const ocr = {
    merchant: vision.merchant || row.merchant || undefined,
    merchantOriginalScript: cleanStr(vision.merchantOriginalScript, 200),
    date: expenseDate,
    total: amount,
    tax: Number.isFinite(Number(vision.tax)) ? Number(vision.tax) : 0,
    currency,
    country: vision.country || undefined,
    category: vision.category || undefined,
    rawText: vision.rawText || undefined,
    confidence: vision.confidence ?? "amber",
    extractionMethod,
    details,
  };
  const contractDigest = await buildContractDigest(row.engagementId ?? null);
  let runId: string;
  let proposal: ExpenseAuditorProposal;
  try {
    const out = await runExpenseAuditor({
      expenseId: row.id,
      triggeredByUserId: me.id,
      ocr,
      contractDigest,
      draft: {
        amount,
        currency,
        country: vision.country ?? undefined,
        category: vision.category ?? row.category ?? undefined,
        engagementId: row.engagementId ?? null,
      },
    });
    runId = out.runId;
    proposal = out.proposal;
  } catch (err) {
    return {
      ok: false,
      status: 502,
      body: {
        error: "auditor-failed",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
  if (proposal.refused) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "auditor-refused",
        message: proposal.reason ?? "Auditor refused this receipt.",
        runId,
      },
    };
  }

  const fx = await convertToUsd(amount, currency, expenseDate);
  const usdAmount = +fx.usdAmount.toFixed(2);
  const policy = await evaluateExpense({
    orgId: me.orgId,
    category: proposal.category,
    usdAmount,
    amount,
    currency,
    country: vision.country ?? null,
    role: me.role,
    flightClass:
      proposal.category === "flight"
        ? (details?.flight?.travelClass?.toLowerCase().replace(/\s+/g, "_") ??
           ocr.rawText?.match(/\b(first|business|premium_economy|economy)\b/i)?.[1]?.toLowerCase() ??
           null)
        : null,
  });

  // Task #383/#396 — layered category resolution:
  // org merchant memory → global merchant DB / keyword / fuzzy matcher →
  // AI (auditor legacy category mapped onto the taxonomy tree).
  let merchantForMemory = (ocr.merchant ?? row.merchant ?? "").trim();
  let merchantDisplay = (ocr.merchant ?? row.merchant ?? "Unknown merchant");
  // Task #408 — tier 0: org alias from a manual correction rewrites the
  // merchant BEFORE memory/matcher tiers, so a remembered rename applies
  // immediately to future parses.
  let aliasApplied = false;
  if (merchantForMemory) {
    try {
      const alias = await lookupMerchantAlias(merchantForMemory, me.orgId);
      if (alias) {
        merchantForMemory = alias.aliasLabel;
        merchantDisplay = alias.aliasLabel;
        aliasApplied = true;
      }
    } catch (e) {
      console.log(`[ReceiptParse] Alias lookup error: ${e}`);
    }
  }
  let taxonomyPatch: Record<string, unknown> = {};
  let merchantResolution = "ai";
  const memoryHit = merchantForMemory
    ? await lookupMerchantMemory(merchantForMemory, me.orgId)
    : null;
  if (memoryHit) {
    merchantResolution = "merchant_memory";
    taxonomyPatch = {
      categoryCode: memoryHit.categoryCode,
      subCategoryCode: memoryHit.subCategoryCode,
      categorySource: "merchant_memory",
    };
  } else {
    let matched = false;
    if (merchantForMemory) {
      const match = await matchMerchant(merchantForMemory, vision.country ?? "global");
      if (match.categoryCode && match.subCategoryCode) {
        matched = true;
        merchantResolution =
          match.matchMethod === "EXACT_NORMALIZED"
            ? "exact_db"
            : match.matchMethod.startsWith("TOKEN")
              ? "token"
              : "keyword";
        taxonomyPatch = {
          categoryCode: match.categoryCode,
          subCategoryCode: match.subCategoryCode,
          categorySource: "merchant_memory",
        };
      }
    }
    if (!matched) {
      const mapped = await mapLegacyCategory(proposal.category);
      if (mapped) {
        taxonomyPatch = {
          categoryCode: mapped.categoryCode,
          subCategoryCode: mapped.subCategoryCode,
          categorySource: "ai",
        };
      }
    }
  }

  if (aliasApplied) merchantResolution = `org_alias_${merchantResolution}`;

  // Task #757 — prefill the user-facing description from what the parse
  // understood (merchant summary + trip/flight/stay enrichment). NEVER
  // overwrite a description the user already typed: only fill when the
  // row's description is empty/blank.
  const enrichedSummary = composeEnrichedSummary(proposal.summary, details);
  const descriptionPatch = !row.description?.trim()
    ? { description: enrichedSummary.slice(0, 2000) || null }
    : {};

  const [updated] = await db
    .update(atelierExpenses)
    .set({
      ...descriptionPatch,
      merchant: merchantDisplay.slice(0, 200),
      merchantNormalized: merchantForMemory
        ? normalizeMerchant(merchantForMemory).slice(0, 200)
        : null,
      merchantResolution,
      ...taxonomyPatch,
      expenseDate,
      amount,
      currency,
      fxRate: fx.rate,
      fxRateDate: fx.rateDate,
      usdAmount,
      category: proposal.category,
      vatTreatment: proposal.vatTreatment,
      vatAmount: proposal.vatAmount,
      vatCurrency: currency,
      vatCountry: vision.country ?? row.vatCountry,
      clientBillable: proposal.clientBillable,
      markupPct: proposal.markupPct,
      auditorRunId: runId,
      auditorProposal: proposal,
      ocrPayload: ocr,
      policyStatus: policy.status,
      policyFindings: policy.findings,
      summary: enrichedSummary,
      updatedAt: new Date(),
    })
    .where(eq(atelierExpenses.id, row.id))
    .returning();

  assertAuditAction("expense.audit");
  await db.insert(atelierAuditEvents).values({
    id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    entityType: "expense",
    entityId: row.id,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action: "expense.audit",
    payload: { runId, policyStatus: policy.status, via, extractionMethod, merchantResolution },
    payloadSummary: `Auditor parsed receipt for ${updated.merchant ?? row.id} → policy ${policy.status}`,
  });

  // Task #1095 — entity-allocation prefill after the parse lands its
  // update (the OCR gives the engine the document country; the AI
  // fallback may infer trip purpose/destination from the receipt text).
  await proposeExpenseAllocation(row.id, { actorId: me.id }).catch(() => {});

  return {
    ok: true,
    expense: updated,
    runId,
    proposal,
    policyFindings: policy.findings,
  };
}
