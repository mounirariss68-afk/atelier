/**
 * Task #1316 — CogniDocs LIVE smoke test (manual, needs a real API key).
 *
 * Not part of any automated suite: it hits the real
 * https://cognidocs.cognirise.ai/api service, so run it once when
 * COGNIDOCS_API_KEY / COGNIDOCS_SANDBOX_API_KEY arrive to confirm the
 * integration end-to-end (auth header, base64 upload, job polling, ×10k
 * amount mapping, receipt/invoice/statement conversion, HEIC→JPEG).
 *
 * Usage (attach your own sample documents):
 *   pnpm --filter @workspace/api-server exec tsx scripts/cognidocs-live-smoke.ts \
 *     --invoice path/to/invoice.pdf \
 *     [--receipt path/to/receipt.jpg|.png|.heic] \
 *     [--statement path/to/statement.pdf]
 *
 * Prints job status/confidence and the CONVERTED app-side fields for each
 * document. Read-only against the app: nothing is written to the DB.
 */
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import {
  cognidocsBaseUrl,
  cognidocsConfigured,
  parseCognidocsDocument,
} from "../src/lib/cognidocs/client.js";
import {
  receiptExtractionFromJob,
  statementRowsFromJob,
  supplierFieldsFromJob,
} from "../src/lib/cognidocs/convert.js";
import { parseReceiptDocViaCognidocs } from "../src/lib/cognidocs/receipt.js";
import { convertHeicToJpeg, isHeicPayload } from "../src/lib/atelier-heic.js";

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".csv": "text/csv",
  ".heic": "image/heic", // converted to JPEG below — CogniDocs takes no HEIC
  ".heif": "image/heif",
};

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

/** Load a sample document, converting HEIC/HEIF to JPEG exactly like the
 *  app's upload paths do (CogniDocs accepts PDF/PNG/JPEG/WEBP/CSV only). */
async function loadForSubmit(
  path: string,
  fallbackMime: string,
): Promise<{ bytes: Buffer; mime: string; name: string }> {
  let bytes = await readFile(path);
  let mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? fallbackMime;
  let name = basename(path);
  if (isHeicPayload(bytes, mime)) {
    console.log(`(converting ${name} HEIC→JPEG before submit)`);
    bytes = await convertHeicToJpeg(bytes);
    mime = "image/jpeg";
    name = name.replace(/\.(heic|heif)$/i, ".jpg");
  }
  return { bytes, mime, name };
}

async function main() {
  if (!cognidocsConfigured()) {
    console.error(
      "No CogniDocs API key configured (COGNIDOCS_API_KEY / COGNIDOCS_SANDBOX_API_KEY) — aborting.",
    );
    process.exit(2);
  }
  console.log(`Base URL: ${cognidocsBaseUrl()}`);
  const invoicePath = arg("--invoice");
  const receiptPath = arg("--receipt");
  const statementPath = arg("--statement");
  if (!invoicePath && !receiptPath && !statementPath) {
    console.error("Provide at least one of --invoice / --receipt / --statement <path>.");
    process.exit(2);
  }
  let problems = 0;

  if (invoicePath) {
    console.log(`\n=== invoice: ${basename(invoicePath)} ===`);
    const doc = await loadForSubmit(invoicePath, "application/pdf");
    const job = await parseCognidocsDocument({
      bytes: doc.bytes,
      fileName: doc.name,
      mimeType: doc.mime,
      declaredType: "invoice",
    });
    console.log(`job ${job.id}: status=${job.status} detected=${job.detectedType} confidence=${job.confidence}`);
    const sup = supplierFieldsFromJob(job);
    if (!sup) {
      problems++;
      console.error("!! no invoice payload came back — check the sample document");
    } else {
      console.log("mapped fields:", JSON.stringify(sup.fields, null, 2));
      console.log(`confidence=${sup.confidence} cognidocsInvoiceId=${sup.cognidocsInvoiceId}`);
    }
  }

  if (receiptPath) {
    console.log(`\n=== receipt: ${basename(receiptPath)} ===`);
    // HEIC→JPEG happens in loadForSubmit — like the app's upload surfaces,
    // which convert BEFORE handing bytes to the CogniDocs receipt path.
    const doc = await loadForSubmit(receiptPath, "image/jpeg");
    const extraction = await parseReceiptDocViaCognidocs(doc.bytes, doc.mime, doc.name);
    console.log("extraction:", JSON.stringify(extraction, null, 2));
    if (extraction.unreadable) {
      problems++;
      console.error("!! receipt came back unreadable — check the sample document");
    }
  }

  if (statementPath) {
    console.log(`\n=== statement: ${basename(statementPath)} ===`);
    const doc = await loadForSubmit(statementPath, "application/pdf");
    const job = await parseCognidocsDocument({
      bytes: doc.bytes,
      fileName: doc.name,
      mimeType: doc.mime,
      // "auto" on purpose: this surface takes bank AND credit-card
      // statements — CogniDocs classifies and reports in detectedType.
      declaredType: "auto",
    });
    console.log(`job ${job.id}: status=${job.status} detected=${job.detectedType} confidence=${job.confidence}`);
    const conv = statementRowsFromJob(job, "AED");
    if (!conv) {
      problems++;
      console.error("!! no statement payload came back — check the sample document");
    } else {
      console.log(`rows=${conv.rows.length} flagged=${conv.flagged.length} confidence=${conv.confidence}`);
      for (const r of conv.rows.slice(0, 10)) {
        console.log(`  ${r.postedDate}  ${r.amount} ${r.currency}  ${r.counterpartyNameRaw ?? ""}`);
      }
      for (const f of conv.flagged.slice(0, 5)) {
        console.log(`  FLAGGED: ${f.snippet} — ${f.reason}`);
      }
      if (conv.warning) console.log(`  warning: ${conv.warning}`);
    }
  }

  // receiptExtractionFromJob is exercised via parseReceiptDocViaCognidocs.
  void receiptExtractionFromJob;
  console.log(problems === 0 ? "\nSMOKE OK" : `\nSMOKE finished with ${problems} problem(s)`);
  process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
