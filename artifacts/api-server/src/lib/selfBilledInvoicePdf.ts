/**
 * Shared self-billed (RCTI) invoice PDF renderer.
 *
 * Extracted from the Me-lens download route so the same document can be
 * streamed to a browser response or buffered as an email attachment.
 * Task #1007 — restyled on the shared glassmorphism brand kit.
 *
 * Callers create the document with `createSelfBilledInvoiceDoc()` and
 * stay responsible for piping + doc.end().
 */
import type { atelierSelfBilledInvoices } from "@workspace/db";
import {
  createBrandDoc,
  addBrandPage,
  glassSection,
  brandTable,
  writeBrandFooters,
  block,
  BRAND,
  FONT,
  PAGE,
} from "./atelier-pdf-brand.js";

type SelfBilledInvoice = typeof atelierSelfBilledInvoices.$inferSelect;

/** Create the pre-configured brand document for the invoice. */
export function createSelfBilledInvoiceDoc(): PDFKit.PDFDocument {
  return createBrandDoc();
}

/** Write the invoice document into an already-created brand PDFDocument. */
export function writeSelfBilledInvoicePdf(doc: PDFKit.PDFDocument, inv: SelfBilledInvoice): void {
  addBrandPage(doc);

  doc.font(FONT.bold).fontSize(17).fillColor(BRAND.navy).text("SELF-BILLED INVOICE (RCTI)", PAGE.left, doc.y);
  doc
    .font(FONT.regular)
    .fontSize(8)
    .fillColor(BRAND.muted)
    .text("Raised by the buyer on behalf of the supplier under a self-billing agreement.", PAGE.left, doc.y + 2);
  doc.moveDown(1);

  glassSection(doc, null, [
    block.body(`Invoice number: ${inv.invoiceNumber}`, { font: FONT.semibold, color: BRAND.navy }),
    block.body(`Supplier: ${inv.supplierName}${inv.supplierType === "partner_firm" ? " (partner firm)" : ""}`),
    block.body(`Billing period: ${inv.weekIso}`),
    block.body(
      `Status: ${inv.status}${inv.paidAt ? ` · paid ${inv.paidAt.toISOString().slice(0, 10)}` : ""}${inv.remittanceRef ? ` · remittance ${inv.remittanceRef}` : ""}`,
    ),
  ]);

  brandTable(
    doc,
    [
      { label: "Engagement", width: 253 },
      { label: "Hours", width: 60, align: "right" },
      { label: "Rate", width: 70, align: "right" },
      { label: `Amount (${inv.currency})`, width: 100, align: "right" },
    ],
    (inv.lines ?? []).map((l) => [
      (l.engagementName ?? l.engagementId).slice(0, 52),
      l.hours.toFixed(1),
      l.ratePerHour.toFixed(2),
      l.amount.toFixed(2),
    ]),
    { fontSize: 9 },
  );

  doc.font(FONT.regular).fontSize(10).fillColor(BRAND.ink);
  doc.text(`Subtotal: ${inv.currency} ${inv.subtotalAmount.toFixed(2)}`, 320, doc.y, { width: PAGE.right - 320, align: "right" });
  doc.text(
    `VAT (${inv.vat?.treatment ?? "n/a"}${inv.vat?.ratePct ? ` ${inv.vat.ratePct}%` : ""}): ${inv.currency} ${inv.vatAmount.toFixed(2)}`,
    320,
    doc.y,
    { width: PAGE.right - 320, align: "right" },
  );
  doc.font(FONT.bold).fontSize(12).fillColor(BRAND.navy);
  doc.text(`Total: ${inv.currency} ${inv.totalAmount.toFixed(2)}`, 320, doc.y + 2, { width: PAGE.right - 320, align: "right" });
  if (inv.vat?.note) {
    doc.moveDown(0.8);
    doc.font(FONT.regular).fontSize(8).fillColor(BRAND.muted).text(`Note: ${inv.vat.note}`, PAGE.left, doc.y, { width: PAGE.contentW });
  }

  writeBrandFooters(doc, { label: `Cognirise — ${inv.invoiceNumber}` });
}

/** Render the invoice PDF fully into a Buffer (for email attachments). */
export function renderSelfBilledInvoicePdfBuffer(inv: SelfBilledInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createSelfBilledInvoiceDoc();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    writeSelfBilledInvoicePdf(doc, inv);
    doc.end();
  });
}
