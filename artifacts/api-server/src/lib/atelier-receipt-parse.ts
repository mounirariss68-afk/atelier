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

import { eq } from "drizzle-orm";
import { db, atelierExpenses, atelierAuditEvents, type atelierUsers } from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "./objectStorage.js";
import { extractPdfText, renderPdfPageImage } from "./atelier-merchant/pdf.js";
import { matchMerchant } from "./atelier-merchant/matcher.js";
import { normalizeMerchant } from "./atelier-merchant/normalizer.js";
import { lookupMerchantMemory } from "./atelier-expense-categorizer.js";
import { mapLegacyCategory } from "./atelier-expense-taxonomy.js";
import { buildContractDigest } from "./atelier-contract-digest.js";
import { convertToUsd } from "./atelier-fx.js";
import { evaluateExpense } from "./atelier-expense-policy.js";
import { runExpenseAuditor } from "./atelier-agents/runner.js";
import { assertAuditAction } from "../routes/atelier/auditContract.js";

type ExpenseRow = typeof atelierExpenses.$inferSelect;
type UserRow = typeof atelierUsers.$inferSelect;
type ExpenseAuditorProposal = Awaited<ReturnType<typeof runExpenseAuditor>>["proposal"];

export const RECEIPT_PARSE_MEDIA = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

export interface VisionReceiptExtraction {
  merchant?: string;
  date?: string;
  total?: number;
  tax?: number;
  currency?: string;
  country?: string;
  category?: string;
  rawText?: string;
  confidence?: "green" | "amber" | "red";
  unreadable?: boolean;
}

const EXTRACT_FIELDS_SPEC =
  "merchant (string), date (YYYY-MM-DD if visible), total (number, grand total), tax (number, 0 if none), currency (3-letter ISO code), country (short code like KSA/UAE/US if inferable), category (one of flight|hotel|meal|gift|software|mileage|per_diem|taxi|other), rawText (the visible text, condensed), confidence (green if crisp and unambiguous, amber if partly readable, red if barely readable), unreadable (true ONLY if this is not a receipt/invoice or nothing is readable)";

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
        system: `You are an expense-receipt OCR extractor. Read the receipt image and reply with ONLY a single JSON object (no prose, no code fences) with fields: ${EXTRACT_FIELDS_SPEC}.`,
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
    return parseModelJson(text);
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
        system: `You are an expense-receipt/invoice extractor. Read the extracted document text and reply with ONLY a single JSON object (no prose, no code fences) with fields: ${EXTRACT_FIELDS_SPEC}.`,
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
    return parseModelJson(text);
  } finally {
    clearTimeout(timer);
  }
}

function isIsoDate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
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
  if (!row.receiptFileRef || !row.receiptFileRef.startsWith("/objects/")) {
    return {
      ok: false,
      status: 400,
      body: { error: "no-receipt", message: "Attach a receipt first, then parse it." },
    };
  }

  const svc = new ObjectStorageService();
  let bytes: Buffer;
  let mediaType: string;
  try {
    const file = await svc.getObjectEntityFile(row.receiptFileRef);
    const dl = await svc.downloadObject(file, 60);
    mediaType = (dl.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    bytes = Buffer.from(await dl.arrayBuffer());
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      return { ok: false, status: 404, body: { error: "no-receipt" } };
    }
    throw err;
  }
  if (!RECEIPT_PARSE_MEDIA.has(mediaType)) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "unsupported-receipt-type",
        message: "Receipt parsing supports photos (JPEG/PNG/WebP/GIF) and PDF invoices.",
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
  const ocr = {
    merchant: vision.merchant || row.merchant || undefined,
    date: expenseDate,
    total: amount,
    tax: Number.isFinite(Number(vision.tax)) ? Number(vision.tax) : 0,
    currency,
    country: vision.country || undefined,
    category: vision.category || undefined,
    rawText: vision.rawText || undefined,
    confidence: vision.confidence ?? "amber",
    extractionMethod,
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
    category: proposal.category,
    usdAmount,
    amount,
    currency,
    country: vision.country ?? null,
    role: me.role,
    flightClass:
      proposal.category === "flight"
        ? (ocr.rawText?.match(/\b(first|business|premium_economy|economy)\b/i)?.[1]?.toLowerCase() ?? null)
        : null,
  });

  // Task #383/#396 — layered category resolution:
  // org merchant memory → global merchant DB / keyword / fuzzy matcher →
  // AI (auditor legacy category mapped onto the taxonomy tree).
  const merchantForMemory = (ocr.merchant ?? row.merchant ?? "").trim();
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

  const [updated] = await db
    .update(atelierExpenses)
    .set({
      merchant: (ocr.merchant ?? row.merchant ?? "Unknown merchant").slice(0, 200),
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
      summary: proposal.summary,
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

  return {
    ok: true,
    expense: updated,
    runId,
    proposal,
    policyFindings: policy.findings,
  };
}
