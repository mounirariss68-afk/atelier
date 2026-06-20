/**
 * pnpm --filter @workspace/api-server run test:board-pack-logo
 *
 * Brand-refresh survival check for the atelier board-pack PDF.
 *
 * The board pack (financeReportsRoutes) embeds the navy Cognirise wordmark
 * read at run time from the sibling atelier artifact. If that asset is renamed
 * or removed, the PDF still renders 200 OK — just silently without branding.
 * These assertions fail loudly instead:
 *
 *   1. The logo asset resolves via the SAME loader the route uses
 *      (loadBoardPackLogo) and is a non-trivial PNG.
 *   2. A board-pack-style PDF built with that logo actually embeds an image
 *      XObject — i.e. the bytes carry the logo, not just a 200 response.
 */
import assert from "node:assert/strict";
import PDFDocument from "pdfkit";
import { loadBoardPackLogo } from "../../src/lib/atelier-board-pack-logo.js";

// ---- 1. Asset resolves + is a real PNG -------------------------------
const logo = loadBoardPackLogo();
assert.ok(
  logo,
  "loadBoardPackLogo() returned null — the atelier board-pack logo asset is missing or moved (see BOARD_PACK_LOGO_CANDIDATES).",
);
// PNG magic number: 89 50 4E 47 0D 0A 1A 0A
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
assert.ok(
  logo.subarray(0, 8).equals(PNG_MAGIC),
  "board-pack logo is not a valid PNG (bad magic bytes).",
);
assert.ok(
  logo.length > 1024,
  `board-pack logo is suspiciously small (${logo.length} bytes) — likely a broken/placeholder asset.`,
);

// ---- 2. PDF actually embeds the image --------------------------------
async function buildPdfWithLogo(buf: Buffer): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    // Mirrors the route: doc.image(BOARD_PACK_LOGO, { width: 120 }).
    doc.image(buf, { width: 120 });
    doc.fontSize(20).text("Cognirise Group — Board Pack");
    doc.end();
  });
}

const pdf = await buildPdfWithLogo(logo);
const pdfText = pdf.toString("latin1");
assert.ok(pdf.length > 1024, `generated board-pack PDF is too small (${pdf.length} bytes).`);
assert.ok(pdfText.startsWith("%PDF-"), "output is not a PDF document.");
assert.ok(
  pdfText.includes("/Subtype /Image") && pdfText.includes("/XObject"),
  "board-pack PDF does not embed an image XObject — the logo is not being rendered into the PDF.",
);

console.log(
  `ok — board-pack logo resolves (${(logo.length / 1024).toFixed(0)}kb PNG) and embeds as an image XObject in a ${(pdf.length / 1024).toFixed(0)}kb PDF.`,
);
