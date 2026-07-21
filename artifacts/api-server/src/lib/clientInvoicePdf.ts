/**
 * Task #451 — branded client-facing invoice PDF.
 *
 * Renders an issued Atelier client invoice (atelier_invoice + lines)
 * as a Cognirise-branded A4 document, either streamed to a browser
 * response or buffered for an email attachment. Follows the shared
 * pdfkit branding used by the audit-trail export (navy #0E1F3D ink,
 * gold #E89E2C rules).
 *
 * Drafts are intentionally NOT renderable here: the routes only call
 * this for invoices that already minted a number (issued/paid/void),
 * and a VOID watermark line is added for voided invoices so a stale
 * PDF can never pass as a live receivable.
 */
import PDFDocument from "pdfkit";
import type { atelierInvoice, atelierInvoiceLine } from "@workspace/db";

type Invoice = typeof atelierInvoice.$inferSelect;
type InvoiceLine = typeof atelierInvoiceLine.$inferSelect;

export interface ClientInvoicePdfArgs {
  invoice: Invoice;
  lines: InvoiceLine[];
  accountName?: string | null;
  engagementName?: string | null;
}

const NAVY = "#0E1F3D";
const GOLD = "#E89E2C";
const GREY = "#6b7280";
const LEFT = 56;
const RIGHT = 539;

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function writeClientInvoicePdf(doc: PDFKit.PDFDocument, args: ClientInvoicePdfArgs): void {
  const { invoice: inv, lines } = args;
  const currency = inv.currency;

  // Header
  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(20).text("COGNIRISE", LEFT, 56);
  doc.fillColor(GOLD).font("Helvetica").fontSize(10).text("The Atelier — Professional Services", LEFT);
  doc.moveDown(0.8);

  doc.fillColor(NAVY).font("Helvetica-Bold").fontSize(16).text(
    inv.status === "void" ? "INVOICE (VOID)" : "INVOICE",
    LEFT,
  );
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(NAVY);
  doc.text(`Invoice number: ${inv.invoiceNumber ?? "—"}`);
  if (inv.issuedAt) doc.text(`Issue date: ${inv.issuedAt.toISOString().slice(0, 10)}`);
  if (inv.dueDate) doc.text(`Due date: ${inv.dueDate}`);
  doc.text(`Jurisdiction: ${inv.jurisdiction}`);
  if (args.engagementName) doc.text(`Engagement: ${args.engagementName}`);
  doc.moveDown(0.8);

  // Bill-to block
  const billTo = inv.billTo ?? {};
  doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Bill to");
  doc.font("Helvetica").fontSize(10).fillColor("#333");
  const billToName = billTo.name || args.accountName || "—";
  doc.text(billToName);
  if (billTo.address) doc.text(billTo.address);
  if (billTo.country) doc.text(billTo.country);
  if (billTo.vatId) doc.text(`VAT/Tax ID: ${billTo.vatId}`);
  if (billTo.contactEmail) doc.text(billTo.contactEmail);
  doc.moveDown(0.8);

  doc.moveTo(LEFT, doc.y).lineTo(RIGHT, doc.y).strokeColor(GOLD).lineWidth(0.7).stroke();
  doc.moveDown(0.5);

  // Lines table
  let y = doc.y;
  doc.font("Helvetica-Bold").fontSize(9).fillColor(NAVY);
  doc.text("Description", LEFT, y, { width: 270, lineBreak: false });
  doc.text("Qty", 340, y, { width: 50, align: "right", lineBreak: false });
  doc.text("Unit price", 395, y, { width: 65, align: "right", lineBreak: false });
  doc.text("Amount", 465, y, { width: 74, align: "right" });
  doc.moveTo(LEFT, doc.y + 2).lineTo(RIGHT, doc.y + 2).strokeColor(GREY).lineWidth(0.5).stroke();
  doc.moveDown(0.4);

  doc.font("Helvetica").fontSize(9).fillColor("#333");
  for (const l of lines) {
    y = doc.y;
    if (y > 720) {
      doc.addPage();
      y = doc.y;
    }
    const descHeight = doc.heightOfString(l.description, { width: 270 });
    doc.text(l.description, LEFT, y, { width: 270, lineBreak: false });
    doc.text(l.qty.toLocaleString("en-US", { maximumFractionDigits: 2 }), 340, y, { width: 50, align: "right", lineBreak: false });
    doc.text(l.unitPrice.toFixed(2), 395, y, { width: 65, align: "right", lineBreak: false });
    doc.text(l.amount.toFixed(2), 465, y, { width: 74, align: "right" });
    doc.y = y + Math.max(descHeight, 12) + 2;
  }
  doc.moveTo(LEFT, doc.y + 2).lineTo(RIGHT, doc.y + 2).strokeColor(GREY).lineWidth(0.5).stroke();
  doc.moveDown(0.8);

  // Totals
  doc.font("Helvetica").fontSize(10).fillColor(NAVY);
  doc.text(`Subtotal: ${money(inv.subtotal, currency)}`, 320, doc.y, { width: 219, align: "right" });
  doc.text(`VAT (${inv.vatRatePct}%): ${money(inv.vatAmount, currency)}`, 320, doc.y, { width: 219, align: "right" });
  doc.font("Helvetica-Bold").fontSize(12);
  doc.text(`Total due: ${money(inv.total, currency)}`, 320, doc.y, { width: 219, align: "right" });
  if (inv.amountPaid > 0) {
    doc.font("Helvetica").fontSize(10);
    doc.text(`Paid to date: ${money(inv.amountPaid, currency)}`, 320, doc.y, { width: 219, align: "right" });
    doc.text(`Balance: ${money(Math.max(0, Math.round((inv.total - inv.amountPaid) * 100) / 100), currency)}`, 320, doc.y, { width: 219, align: "right" });
  }

  if (inv.status === "void") {
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#b91c1c");
    doc.text(
      `VOIDED${inv.voidedAt ? ` on ${inv.voidedAt.toISOString().slice(0, 10)}` : ""}${inv.voidedReason ? ` — ${inv.voidedReason}` : ""}. This invoice is not payable.`,
      LEFT,
      doc.y,
      { width: RIGHT - LEFT },
    );
  }

  if (inv.notes) {
    doc.moveDown(1);
    doc.font("Helvetica").fontSize(9).fillColor(GREY);
    doc.text(`Notes: ${inv.notes}`, LEFT, doc.y, { width: RIGHT - LEFT });
  }

  doc.moveDown(1.2);
  doc.font("Helvetica").fontSize(8).fillColor(GREY);
  doc.text(
    inv.dueDate
      ? `Payment is due by ${inv.dueDate}. Please quote invoice number ${inv.invoiceNumber ?? ""} with your remittance.`
      : `Please quote invoice number ${inv.invoiceNumber ?? ""} with your remittance.`,
    LEFT,
    doc.y,
    { width: RIGHT - LEFT },
  );
}

/** Render the client invoice PDF fully into a Buffer. */
export function renderClientInvoicePdfBuffer(args: ClientInvoicePdfArgs): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    writeClientInvoicePdf(doc, args);
    doc.end();
  });
}
