/**
 * Task #1316 — one-call receipt/expense-invoice parse via CogniDocs.
 *
 * Replaces the retired in-house extractors (Anthropic vision on images,
 * text-layer/OCR + model on PDFs) with a single CogniDocs parse for BOTH
 * images and PDFs, returning the same VisionReceiptExtraction-shaped
 * payload the Expense Auditor pipeline has always consumed.
 *
 * Callers still own HEIC→JPEG conversion (CogniDocs takes no HEIC) and
 * still run `validateReceiptAmounts` on the result — the subtotal/total
 * arithmetic check stays meaningful because subtotal/tax/total come from
 * independently parsed printed fields.
 */

import type { VisionReceiptExtraction } from "../atelier-receipt-parse.js";
import { parseCognidocsDocument } from "./client.js";
import { receiptExtractionFromJob } from "./convert.js";

function extForMedia(mediaType: string): string {
  switch (mediaType) {
    case "application/pdf":
      return ".pdf";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    default:
      return ".jpg";
  }
}

/**
 * Parse receipt/invoice bytes through CogniDocs. Throws CognidocsError on
 * configuration/transport/parse failure (fail-loud); returns
 * `{ unreadable: true }` when CogniDocs read the document fine but found
 * no invoice/receipt content in it.
 */
export async function parseReceiptDocViaCognidocs(
  bytes: Buffer,
  mediaType: string,
  fileName?: string | null,
): Promise<VisionReceiptExtraction> {
  const mime = mediaType.toLowerCase().split(";")[0].trim();
  const name =
    fileName && fileName.trim() ? fileName.trim().slice(0, 200) : `receipt${extForMedia(mime)}`;
  const job = await parseCognidocsDocument({
    bytes,
    fileName: name,
    mimeType: mime,
    // "auto": expense attachments are a mix of till receipts and full tax
    // invoices — CogniDocs detects and routes; both come back as invoice
    // results. A statement misfiled as a receipt yields no invoice payload
    // and surfaces as unreadable instead of a guessed expense.
    declaredType: "auto",
  });
  return receiptExtractionFromJob(job);
}
