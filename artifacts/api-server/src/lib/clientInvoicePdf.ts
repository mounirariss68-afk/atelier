/**
 * Task #451 — branded client-facing invoice PDF.
 *
 * Renders an issued Atelier client invoice (atelier_invoice + lines)
 * as a Cognirise-branded A4 document, either streamed to a browser
 * response or buffered for an email attachment. Task #1007 — restyled
 * on the shared glassmorphism brand kit (atelier-pdf-brand.ts): ice
 * backdrop wash, glass panels, navy/gold palette, Plus Jakarta Sans,
 * wordmark chrome on every page.
 *
 * Drafts are intentionally NOT renderable here: the routes only call
 * this for invoices that already minted a number (issued/paid/void),
 * and a VOID watermark line is added for voided invoices so a stale
 * PDF can never pass as a live receivable.
 *
 * Callers create the document with `createClientInvoiceDoc()` and stay
 * responsible for piping + doc.end().
 */
import type { atelierInvoice, atelierInvoiceLine } from "@workspace/db";
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
  type BrandBlock,
} from "./atelier-pdf-brand.js";

type Invoice = typeof atelierInvoice.$inferSelect;
type InvoiceLine = typeof atelierInvoiceLine.$inferSelect;

export interface ClientInvoicePdfArgs {
  invoice: Invoice;
  lines: InvoiceLine[];
  accountName?: string | null;
  engagementName?: string | null;
}

/** Create the pre-configured brand document for the invoice. */
export function createClientInvoiceDoc(): PDFKit.PDFDocument {
  return createBrandDoc();
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function writeClientInvoicePdf(doc: PDFKit.PDFDocument, args: ClientInvoicePdfArgs): void {
  const { invoice: inv, lines } = args;
  const currency = inv.currency;

  addBrandPage(doc);

  // Title band.
  doc
    .font(FONT.bold)
    .fontSize(19)
    .fillColor(inv.status === "void" ? BRAND.danger : BRAND.navy)
    .text(inv.status === "void" ? "INVOICE (VOID)" : "INVOICE", PAGE.left, doc.y);
  doc
    .font(FONT.medium)
    .fontSize(9.5)
    .fillColor(BRAND.gold)
    .text("Atelier — Professional Services", PAGE.left, doc.y + 2);
  doc.moveDown(0.9);

  // Invoice meta + bill-to as glass panels.
  const metaBlocks: BrandBlock[] = [
    block.body(`Invoice number: ${inv.invoiceNumber ?? "—"}`, { font: FONT.semibold, color: BRAND.navy }),
  ];
  if (inv.issuedAt) metaBlocks.push(block.body(`Issue date: ${inv.issuedAt.toISOString().slice(0, 10)}`));
  if (inv.dueDate) metaBlocks.push(block.body(`Due date: ${inv.dueDate}`));
  metaBlocks.push(block.body(`Jurisdiction: ${inv.jurisdiction}`));
  if (args.engagementName) metaBlocks.push(block.body(`Engagement: ${args.engagementName}`));
  glassSection(doc, null, metaBlocks);

  const billTo = inv.billTo ?? {};
  const billBlocks: BrandBlock[] = [];
  const billToName = billTo.name || args.accountName || "—";
  billBlocks.push(block.body(billToName, { font: FONT.semibold, color: BRAND.navy }));
  if (billTo.address) billBlocks.push(block.body(billTo.address));
  if (billTo.country) billBlocks.push(block.body(billTo.country));
  if (billTo.vatId) billBlocks.push(block.body(`VAT/Tax ID: ${billTo.vatId}`));
  if (billTo.contactEmail) billBlocks.push(block.body(billTo.contactEmail));
  glassSection(doc, "Bill To", billBlocks);

  // Lines table.
  brandTable(
    doc,
    [
      { label: "Description", width: 258 },
      { label: "Qty", width: 55, align: "right" },
      { label: "Unit price", width: 80, align: "right" },
      { label: "Amount", width: 90, align: "right" },
    ],
    lines.map((l) => [
      l.description,
      l.qty.toLocaleString("en-US", { maximumFractionDigits: 2 }),
      l.unitPrice.toFixed(2),
      l.amount.toFixed(2),
    ]),
    { fontSize: 9 },
  );

  // Totals — right-aligned emphasis block.
  doc.font(FONT.regular).fontSize(10).fillColor(BRAND.ink);
  doc.text(`Subtotal: ${money(inv.subtotal, currency)}`, 320, doc.y, { width: PAGE.right - 320, align: "right" });
  doc.text(`VAT (${inv.vatRatePct}%): ${money(inv.vatAmount, currency)}`, 320, doc.y, { width: PAGE.right - 320, align: "right" });
  doc.font(FONT.bold).fontSize(12).fillColor(BRAND.navy);
  doc.text(`Total due: ${money(inv.total, currency)}`, 320, doc.y + 2, { width: PAGE.right - 320, align: "right" });
  if (inv.amountPaid > 0) {
    doc.font(FONT.regular).fontSize(10).fillColor(BRAND.ink);
    doc.text(`Paid to date: ${money(inv.amountPaid, currency)}`, 320, doc.y, { width: PAGE.right - 320, align: "right" });
    doc.text(
      `Balance: ${money(Math.max(0, Math.round((inv.total - inv.amountPaid) * 100) / 100), currency)}`,
      320,
      doc.y,
      { width: PAGE.right - 320, align: "right" },
    );
  }

  if (inv.status === "void") {
    doc.moveDown(1);
    doc.font(FONT.bold).fontSize(11).fillColor(BRAND.danger);
    doc.text(
      `VOIDED${inv.voidedAt ? ` on ${inv.voidedAt.toISOString().slice(0, 10)}` : ""}${inv.voidedReason ? ` — ${inv.voidedReason}` : ""}. This invoice is not payable.`,
      PAGE.left,
      doc.y,
      { width: PAGE.contentW },
    );
  }

  if (inv.notes) {
    doc.moveDown(1);
    doc.font(FONT.regular).fontSize(9).fillColor(BRAND.muted);
    doc.text(`Notes: ${inv.notes}`, PAGE.left, doc.y, { width: PAGE.contentW });
  }

  doc.moveDown(1.2);
  doc.font(FONT.regular).fontSize(8).fillColor(BRAND.muted);
  doc.text(
    inv.dueDate
      ? `Payment is due by ${inv.dueDate}. Please quote invoice number ${inv.invoiceNumber ?? ""} with your remittance.`
      : `Please quote invoice number ${inv.invoiceNumber ?? ""} with your remittance.`,
    PAGE.left,
    doc.y,
    { width: PAGE.contentW },
  );

  writeBrandFooters(doc, {
    label: `Cognirise — Invoice ${inv.invoiceNumber ?? ""}`.trim(),
    generatedAt: inv.issuedAt ?? new Date(),
  });
}

/** Render the client invoice PDF fully into a Buffer. */
export function renderClientInvoicePdfBuffer(args: ClientInvoicePdfArgs): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = createClientInvoiceDoc();
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    writeClientInvoicePdf(doc, args);
    doc.end();
  });
}
