/**
 * Shared self-billed (RCTI) invoice PDF renderer.
 *
 * Extracted from the Me-lens download route so the same document can be
 * streamed to a browser response or buffered as an email attachment.
 */
import PDFDocument from "pdfkit";
import type { atelierSelfBilledInvoices } from "@workspace/db";

type SelfBilledInvoice = typeof atelierSelfBilledInvoices.$inferSelect;

/** Write the invoice document into an already-created PDFDocument. */
export function writeSelfBilledInvoicePdf(doc: PDFKit.PDFDocument, inv: SelfBilledInvoice): void {
  const grey = "#6b7280";
  const ink = "#1a1f33";
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(16).text("SELF-BILLED INVOICE (RCTI)");
  doc.moveDown(0.2);
  doc.font("Helvetica").fontSize(8).fillColor(grey)
    .text("Raised by the buyer on behalf of the supplier under a self-billing agreement.");
  doc.moveDown(1);
  doc.fillColor(ink).font("Helvetica-Bold").fontSize(10).text(`Invoice number: ${inv.invoiceNumber}`);
  doc.font("Helvetica").fontSize(10);
  doc.text(`Supplier: ${inv.supplierName}${inv.supplierType === "partner_firm" ? " (partner firm)" : ""}`);
  doc.text(`Billing period: ${inv.weekIso}`);
  doc.text(
    `Status: ${inv.status}${inv.paidAt ? ` · paid ${inv.paidAt.toISOString().slice(0, 10)}` : ""}${inv.remittanceRef ? ` · remittance ${inv.remittanceRef}` : ""}`,
  );
  doc.moveDown(1);
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Engagement", 48, y, { lineBreak: false });
  doc.text("Hours", 320, y, { lineBreak: false });
  doc.text("Rate", 390, y, { lineBreak: false });
  doc.text(`Amount (${inv.currency})`, 460, y);
  doc.moveTo(48, doc.y + 2).lineTo(547, doc.y + 2).lineWidth(0.5).strokeColor(grey).stroke();
  doc.moveDown(0.5);
  doc.font("Helvetica").fontSize(9);
  for (const l of inv.lines ?? []) {
    y = doc.y;
    doc.text((l.engagementName ?? l.engagementId).slice(0, 52), 48, y, { width: 260, lineBreak: false });
    doc.text(l.hours.toFixed(1), 320, y, { lineBreak: false });
    doc.text(l.ratePerHour.toFixed(2), 390, y, { lineBreak: false });
    doc.text(l.amount.toFixed(2), 460, y);
  }
  doc.moveTo(48, doc.y + 2).lineTo(547, doc.y + 2).lineWidth(0.5).strokeColor(grey).stroke();
  doc.moveDown(0.8);
  doc.fontSize(10).text(`Subtotal: ${inv.currency} ${inv.subtotalAmount.toFixed(2)}`, 370);
  doc.text(
    `VAT (${inv.vat?.treatment ?? "n/a"}${inv.vat?.ratePct ? ` ${inv.vat.ratePct}%` : ""}): ${inv.currency} ${inv.vatAmount.toFixed(2)}`,
    370,
  );
  doc.font("Helvetica-Bold").fontSize(12).text(`Total: ${inv.currency} ${inv.totalAmount.toFixed(2)}`, 370);
  if (inv.vat?.note) {
    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(8).fillColor(grey).text(`Note: ${inv.vat.note}`, 48);
  }
}

/** Render the invoice PDF fully into a Buffer (for email attachments). */
export function renderSelfBilledInvoicePdfBuffer(inv: SelfBilledInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    writeSelfBilledInvoicePdf(doc, inv);
    doc.end();
  });
}
