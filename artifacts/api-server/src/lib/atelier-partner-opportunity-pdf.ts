import { addBrandPage, block, createBrandDoc, FONT, PAGE, glassSection, writeBrandFooters } from "./atelier-pdf-brand.js";

/** Strict external-facing allowlist. No raw opportunities, notes, economics, or other firms. */
export interface PartnerReportRow {
  name: string;
  accountName: string;
  salesStage: string;
  partnerOwnerName: string;
  dealSizeUsd: number;
  currency: string;
  closeDate: string | null;
}

export async function partnerOpportunityPdf(partnerName: string, filters: string, rows: PartnerReportRow[]): Promise<Buffer> {
  const doc = createBrandDoc();
  const output = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const generatedAt = new Date();
  addBrandPage(doc);
  glassSection(doc, "Partner opportunity report", [
    block.strong(partnerName),
    block.body(`Generated ${generatedAt.toISOString().slice(0, 10)} · ${rows.length} opportunities`),
    block.muted(filters),
  ]);
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.dealSizeUsd);
  glassSection(doc, "Pipeline value by currency", [...totals.entries()].sort().map(([currency, value]) =>
    block.body(`${currency} ${value.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`)));
  for (const row of rows) {
    const blocks = [
      block.strong(row.name),
      block.body(`Client: ${row.accountName}`),
      block.body(`Stage: ${row.salesStage.replaceAll("_", " ")} · Owner: ${row.partnerOwnerName}`),
      block.body(`Deal value: ${row.currency} ${row.dealSizeUsd.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`),
      block.muted(`Expected close: ${row.closeDate || "Not specified"}`),
    ];
    // Keep normal cards together instead of orphaning a deal's value/close
    // date on the next page. Exceptionally large text still uses the kit's
    // measured block splitting rather than clipping.
    const cardHeight = 28 + blocks.reduce((sum, item) => {
      if (item.kind !== "text") return sum;
      doc.font(item.font ?? FONT.regular).fontSize(item.size ?? 9.5);
      return sum + doc.heightOfString(item.text, { width: PAGE.contentW - 28 }) + (item.gapAfter ?? 4);
    }, 0);
    if (cardHeight <= PAGE.bottom - PAGE.contentTop && doc.y + cardHeight > PAGE.bottom) addBrandPage(doc);
    glassSection(doc, null, blocks);
  }
  writeBrandFooters(doc, { label: "Cognirise · Partner opportunity report", generatedAt });
  doc.end();
  return output;
}