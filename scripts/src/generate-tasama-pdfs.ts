// Generates 12 bilingual demo PDFs for the Tasama Payroll Intelligence Hub.
// Each PDF mirrors a doc entry in tasama-baseline.json and renders both
// English (Helvetica) and Arabic (NotoNaskhArabic, embedded via @pdf-lib/fontkit)
// with proper contextual joining and right-to-left placement.
//
// Run: pnpm --filter @workspace/scripts run generate:tasama-pdfs

import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "tasama-pdfs");
const BASELINE = path.resolve(__dirname, "tasama-baseline.json");
const ARABIC_FONT_REG = path.resolve(
  __dirname,
  "../../artifacts/maven-ai/public/fonts/NotoNaskhArabic-Regular.ttf",
);
const ARABIC_FONT_BOLD = path.resolve(
  __dirname,
  "../../artifacts/maven-ai/public/fonts/NotoNaskhArabic-Bold.ttf",
);

interface DocSpec {
  id: string;
  clientId: string;
  employeeId: string | null;
  type: string;
  titleEn: string;
  titleAr: string;
  referenceNumber: string;
  issuedAt: string;
  signedByName: string;
  signedByTitle: string;
  filename: string;
  extractedFields: Record<string, { value: string; confidence: number }>;
  overallConfidence: number;
}

interface Baseline {
  clients: Array<{ id: string; legalNameEn: string; legalNameAr: string }>;
  namedEmployees: Array<{ id: string; fullNameEn: string; fullNameAr: string }>;
  documents: DocSpec[];
}

const TEAL = rgb(13 / 255, 148 / 255, 136 / 255);
const DARK = rgb(15 / 255, 23 / 255, 42 / 255);
const MUTED = rgb(100 / 255, 116 / 255, 139 / 255);
const LIGHT_BG = rgb(245 / 255, 250 / 255, 250 / 255);

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 50;

// ─── Arabic shaping ─────────────────────────────────────────────────────
// Maps each Arabic letter codepoint to its 4 presentation forms (Unicode
// FExx block): [isolated, initial, medial, final]. Covers the letters
// used in the demo's named entities (client legal names, employee names,
// document titles). Letters in NO_JOIN_NEXT only join from the previous
// letter and never to the next.
const FORMS: Record<number, [number, number, number, number]> = {
  0x0627: [0xFE8D, 0xFE8D, 0xFE8E, 0xFE8E],
  0x0628: [0xFE8F, 0xFE91, 0xFE92, 0xFE90],
  0x062A: [0xFE95, 0xFE97, 0xFE98, 0xFE96],
  0x062B: [0xFE99, 0xFE9B, 0xFE9C, 0xFE9A],
  0x062C: [0xFE9D, 0xFE9F, 0xFEA0, 0xFE9E],
  0x062D: [0xFEA1, 0xFEA3, 0xFEA4, 0xFEA2],
  0x062E: [0xFEA5, 0xFEA7, 0xFEA8, 0xFEA6],
  0x062F: [0xFEA9, 0xFEA9, 0xFEAA, 0xFEAA],
  0x0630: [0xFEAB, 0xFEAB, 0xFEAC, 0xFEAC],
  0x0631: [0xFEAD, 0xFEAD, 0xFEAE, 0xFEAE],
  0x0632: [0xFEAF, 0xFEAF, 0xFEB0, 0xFEB0],
  0x0633: [0xFEB1, 0xFEB3, 0xFEB4, 0xFEB2],
  0x0634: [0xFEB5, 0xFEB7, 0xFEB8, 0xFEB6],
  0x0635: [0xFEB9, 0xFEBB, 0xFEBC, 0xFEBA],
  0x0636: [0xFEBD, 0xFEBF, 0xFEC0, 0xFEBE],
  0x0637: [0xFEC1, 0xFEC3, 0xFEC4, 0xFEC2],
  0x0638: [0xFEC5, 0xFEC7, 0xFEC8, 0xFEC6],
  0x0639: [0xFEC9, 0xFECB, 0xFECC, 0xFECA],
  0x063A: [0xFECD, 0xFECF, 0xFED0, 0xFECE],
  0x0641: [0xFED1, 0xFED3, 0xFED4, 0xFED2],
  0x0642: [0xFED5, 0xFED7, 0xFED8, 0xFED6],
  0x0643: [0xFED9, 0xFEDB, 0xFEDC, 0xFEDA],
  0x0644: [0xFEDD, 0xFEDF, 0xFEE0, 0xFEDE],
  0x0645: [0xFEE1, 0xFEE3, 0xFEE4, 0xFEE2],
  0x0646: [0xFEE5, 0xFEE7, 0xFEE8, 0xFEE6],
  0x0647: [0xFEE9, 0xFEEB, 0xFEEC, 0xFEEA],
  0x0648: [0xFEED, 0xFEED, 0xFEEE, 0xFEEE],
  0x064A: [0xFEF1, 0xFEF3, 0xFEF4, 0xFEF2],
  0x0629: [0xFE93, 0xFE93, 0xFE94, 0xFE94],
  0x0649: [0xFEEF, 0xFEEF, 0xFEF0, 0xFEF0],
  0x0623: [0xFE83, 0xFE83, 0xFE84, 0xFE84],
  0x0625: [0xFE87, 0xFE87, 0xFE88, 0xFE88],
  0x0622: [0xFE81, 0xFE81, 0xFE82, 0xFE82],
  0x0626: [0xFE89, 0xFE8B, 0xFE8C, 0xFE8A],
  0x0624: [0xFE85, 0xFE85, 0xFE86, 0xFE86],
  0x0621: [0xFE80, 0xFE80, 0xFE80, 0xFE80],
};
const NO_JOIN_NEXT = new Set([
  0x0622, 0x0623, 0x0624, 0x0625, 0x0627, 0x062F, 0x0630, 0x0631, 0x0632,
  0x0648, 0x0629, 0x0649, 0x0621,
]);
const ARABIC_RANGE = /[\u0600-\u06FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
function isArabicChar(cp: number): boolean {
  return cp in FORMS;
}
function joinsLeftOf(cp: number): boolean {
  return cp in FORMS && !NO_JOIN_NEXT.has(cp);
}
function reshapeArabic(text: string): string {
  const cps = [...text].map((c) => c.codePointAt(0) ?? 0);
  const out: string[] = [];
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (!isArabicChar(cp)) {
      out.push(String.fromCodePoint(cp));
      continue;
    }
    const prev = cps[i - 1];
    const next = cps[i + 1];
    const joinsToPrev = prev !== undefined && joinsLeftOf(prev);
    const joinsToNext =
      next !== undefined && isArabicChar(next) && !NO_JOIN_NEXT.has(cp);
    let form = 0;
    if (joinsToPrev && joinsToNext) form = 2;
    else if (joinsToPrev) form = 3;
    else if (joinsToNext) form = 1;
    out.push(String.fromCodePoint(FORMS[cp][form]));
  }
  return out.reverse().join("");
}

function safeText(s: string): string {
  // For Helvetica spans (English), strip Arabic + normalise punctuation.
  return s
    .replace(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[\u00A0]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function drawArabicRight(
  page: PDFPage,
  font: PDFFont,
  text: string,
  rightX: number,
  y: number,
  size: number,
  color = DARK,
) {
  if (!ARABIC_RANGE.test(text)) return;
  const shaped = reshapeArabic(text);
  const width = font.widthOfTextAtSize(shaped, size);
  page.drawText(shaped, { x: rightX - width, y, size, font, color });
}

function drawHeader(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  arBold: PDFFont,
  client: { legalNameEn: string; legalNameAr: string },
  doc: DocSpec,
) {
  page.drawRectangle({ x: 0, y: PAGE_H - 90, width: PAGE_W, height: 90, color: TEAL });
  page.drawText("TASAMA  |  Payroll Intelligence Hub", {
    x: MARGIN,
    y: PAGE_H - 45,
    size: 16,
    font: bold,
    color: rgb(1, 1, 1),
  });
  drawArabicRight(
    page,
    arBold,
    "تسامى | منصة ذكاء الرواتب",
    PAGE_W - MARGIN - 175,
    PAGE_H - 45,
    13,
    rgb(1, 1, 1),
  );
  page.drawText("Bilingual EN / AR  -  Reference Document", {
    x: MARGIN,
    y: PAGE_H - 65,
    size: 9,
    font: reg,
    color: rgb(0.85, 0.95, 0.93),
  });
  page.drawText(`Ref: ${doc.referenceNumber}  |  Issued: ${doc.issuedAt}`, {
    x: PAGE_W - MARGIN - 220,
    y: PAGE_H - 65,
    size: 9,
    font: reg,
    color: rgb(1, 1, 1),
  });

  page.drawText(safeText(client.legalNameEn), {
    x: MARGIN,
    y: PAGE_H - 120,
    size: 11,
    font: bold,
    color: DARK,
  });
  drawArabicRight(page, arBold, client.legalNameAr, PAGE_W - MARGIN, PAGE_H - 120, 12);
}

function drawTitle(
  page: PDFPage,
  bold: PDFFont,
  arBold: PDFFont,
  doc: DocSpec,
) {
  page.drawText(safeText(doc.titleEn), {
    x: MARGIN,
    y: PAGE_H - 160,
    size: 17,
    font: bold,
    color: DARK,
  });
  drawArabicRight(page, arBold, doc.titleAr, PAGE_W - MARGIN, PAGE_H - 185, 13);
  page.drawLine({
    start: { x: MARGIN, y: PAGE_H - 200 },
    end: { x: PAGE_W - MARGIN, y: PAGE_H - 200 },
    thickness: 1,
    color: TEAL,
  });
}

function drawFieldsTable(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  fields: Record<string, { value: string }>,
  startY: number,
): number {
  let y = startY;
  page.drawText("KEY DATA FIELDS", { x: MARGIN, y, size: 10, font: bold, color: TEAL });
  y -= 18;

  const labelX = MARGIN + 10;
  const valueX = MARGIN + 230;
  const tableTop = y + 8;
  let rowY = y;
  let rowCount = 0;
  for (const [k, v] of Object.entries(fields)) {
    const label = humanLabel(k);
    if (rowCount % 2 === 0) {
      page.drawRectangle({
        x: MARGIN,
        y: rowY - 6,
        width: PAGE_W - 2 * MARGIN,
        height: 18,
        color: LIGHT_BG,
      });
    }
    page.drawText(safeText(label), { x: labelX, y: rowY, size: 9.5, font: bold, color: DARK });
    page.drawText(safeText(String(v.value)), { x: valueX, y: rowY, size: 9.5, font: reg, color: DARK });
    rowY -= 18;
    rowCount += 1;
  }
  page.drawRectangle({
    x: MARGIN - 1,
    y: rowY,
    width: PAGE_W - 2 * MARGIN + 2,
    height: tableTop - rowY,
    borderColor: rgb(0.85, 0.85, 0.85),
    borderWidth: 0.5,
  });
  return rowY - 12;
}

function humanLabel(key: string): string {
  return key.replace(/_/g, " ").replace(/\bsar\b/g, "(SAR)").replace(/\b\w/g, (c) => c.toUpperCase());
}

function drawBody(page: PDFPage, reg: PDFFont, lines: string[], startY: number): number {
  let y = startY;
  for (const line of lines) {
    page.drawText(safeText(line), { x: MARGIN, y, size: 10, font: reg, color: DARK });
    y -= 14;
  }
  return y;
}

function drawSignature(
  page: PDFPage,
  bold: PDFFont,
  reg: PDFFont,
  arReg: PDFFont,
  doc: DocSpec,
  y: number,
) {
  page.drawLine({
    start: { x: MARGIN, y: y - 30 },
    end: { x: MARGIN + 180, y: y - 30 },
    thickness: 0.6,
    color: DARK,
  });
  page.drawText("Signature:", { x: MARGIN, y: y - 46, size: 9, font: bold, color: DARK });
  drawArabicRight(page, arReg, "التوقيع", MARGIN + 95, y - 46, 9.5);
  page.drawText(safeText(doc.signedByName), {
    x: MARGIN + 100,
    y: y - 46,
    size: 9,
    font: reg,
    color: DARK,
  });
  page.drawText(safeText(doc.signedByTitle), {
    x: MARGIN + 100,
    y: y - 60,
    size: 8.5,
    font: reg,
    color: MUTED,
  });
  drawArabicRight(page, arReg, doc.signedByName, PAGE_W - MARGIN - 80, y - 46, 9.5);
  page.drawRectangle({
    x: PAGE_W - MARGIN - 60,
    y: y - 60,
    width: 60,
    height: 60,
    color: rgb(0.9, 0.96, 0.95),
    borderColor: TEAL,
    borderWidth: 0.6,
  });
  page.drawText("QR", {
    x: PAGE_W - MARGIN - 38,
    y: y - 36,
    size: 12,
    font: bold,
    color: TEAL,
  });

  page.drawText(
    `Generated by Tasama Payroll Intelligence Hub  |  Document ID: ${doc.id}  |  Confidence: ${(doc.overallConfidence * 100).toFixed(1)}%`,
    {
      x: MARGIN,
      y: 30,
      size: 7,
      font: reg,
      color: MUTED,
    },
  );
}

function bodyForType(doc: DocSpec, employeeName: string | null): string[] {
  const empN = employeeName ?? "the employee";
  const f = doc.extractedFields;
  switch (doc.type) {
    case "termination-letter":
      return [
        `This letter formally accepts the resignation of ${empN}.`,
        ``,
        `Last working day: ${f.last_working_day?.value ?? "(see fields)"}`,
        `Notice period served: ${f.notice_period_served?.value ?? "as per contract"}`,
        ``,
        `EOSB calculation, leave encashment, and remaining salary will be settled per the`,
        `final settlement statement, in accordance with KSA Labour Law Article 84.`,
      ];
    case "final-settlement":
      return [
        `Final settlement summary for ${empN}:`,
        ``,
        `Years of service: ${f.years_of_service?.value ?? "-"}`,
        `EOSB amount (SAR): ${f.eosb_amount_sar?.value ?? "-"}`,
        `Leave encashment (SAR): ${f.leave_encashment_sar?.value ?? "-"}`,
        `Remaining salary (SAR): ${f.remaining_salary_sar?.value ?? "-"}`,
        `Total settlement (SAR): ${f.total_settlement_sar?.value ?? "-"}`,
        ``,
        `Payment will be processed via Mudad WPS within 5 business days of signature.`,
      ];
    case "salary-certificate":
      return [
        `This is to certify that ${empN} is currently employed and receiving:`,
        ``,
        `Monthly basic salary (SAR): ${f.monthly_basic_sar?.value ?? "-"}`,
        `Total monthly compensation (SAR): ${f.total_monthly_sar?.value ?? "-"}`,
        ``,
        `This certificate is issued for the requested purpose and is valid for 30 days.`,
      ];
    case "maternity-leave-approval":
      return [
        `Maternity leave for ${empN} is approved as follows:`,
        ``,
        `Leave start date: ${f.leave_start_date?.value ?? "-"}`,
        `Duration (days): ${f.leave_duration_days?.value ?? "-"}`,
        `Expected return date: ${f.expected_return_date?.value ?? "-"}`,
        ``,
        `Leave is paid in full per Article 151 of the KSA Labour Law.`,
      ];
    case "performance-review":
      return [
        `Performance review summary for ${empN}:`,
        ``,
        `Performance rating: ${f.performance_rating?.value ?? "-"}`,
        `Goals met: ${f.goals_met?.value ?? "-"}`,
        `Promotion recommendation: ${f.promotion_recommended?.value ?? "-"}`,
        ``,
        `A formal promotion package will be tabled at the next leadership review.`,
      ];
    case "promotion-letter":
      return [
        `It is our pleasure to confirm the promotion of ${empN}.`,
        ``,
        `Current position: ${f.current_position?.value ?? "-"}`,
        `New position: ${f.new_position?.value ?? "-"}`,
        `Effective date: ${f.effective_date?.value ?? "-"}`,
        `New basic salary (SAR): ${f.new_basic_sar?.value ?? "-"}`,
        ``,
        `Please countersign and return a copy to HR.`,
      ];
    case "employment-contract":
      return [
        `Employment contract issued to ${empN}.`,
        ``,
        `Position: ${f.position?.value ?? "-"}`,
        `Contract type: ${f.contract_type?.value ?? "-"}`,
        `Monthly basic salary (SAR): ${f.monthly_basic_sar?.value ?? "-"}`,
        `Start date: ${f.start_date?.value ?? "-"}`,
        ``,
        `This contract is governed by the KSA Labour Law and registered with Qiwa.`,
      ];
    case "salary-increase-letter":
      return [
        `${empN}: this letter confirms an adjustment to your monthly basic salary.`,
        ``,
        `Current basic (SAR): ${f.current_basic_sar?.value ?? "-"}`,
        `New basic (SAR): ${f.new_basic_sar?.value ?? "-"}`,
        `Increase (%): ${f.increase_percent?.value ?? "-"}`,
        `Effective from: ${f.effective_date?.value ?? "-"}`,
        ``,
        `GOSI base will be re-calculated automatically from the effective month.`,
      ];
    case "bonus-letter":
      return [
        `${empN}: in recognition of your performance, a bonus has been awarded.`,
        ``,
        `Bonus amount (SAR): ${f.bonus_amount_sar?.value ?? "-"}`,
        `Period: ${f.bonus_period?.value ?? "-"}`,
        `Payment month: ${f.payment_month?.value ?? "-"}`,
      ];
    case "experience-letter":
      return [
        `To Whom It May Concern:`,
        ``,
        `This is to certify that ${empN} was a valued member of our team for`,
        `the period below, and we hereby acknowledge their service.`,
        ``,
        `Employment start: ${f.employment_start?.value ?? "-"}`,
        `Employment end: ${f.employment_end?.value ?? "-"}`,
        `Total years of service: ${f.total_service_years?.value ?? "-"}`,
        `Final position held: ${f.final_position?.value ?? "-"}`,
        ``,
        `Summary of duties: ${f.duties_summary?.value ?? "-"}`,
        ``,
        `${empN} demonstrated professionalism throughout their tenure and is`,
        `eligible for re-hire. Issued at the employee's request for use with`,
        `future employers and government bodies.`,
      ];
    default:
      return Object.entries(f).map(([k, v]) => `${humanLabel(k)}: ${v.value}`);
  }
}

async function buildPdf(
  doc: DocSpec,
  client: { legalNameEn: string; legalNameAr: string },
  employeeName: string | null,
  arabicRegBytes: Uint8Array,
  arabicBoldBytes: Uint8Array,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const arReg = await pdf.embedFont(arabicRegBytes, { subset: true });
  const arBold = await pdf.embedFont(arabicBoldBytes, { subset: true });

  drawHeader(page, bold, reg, arBold, client, doc);
  drawTitle(page, bold, arBold, doc);
  let y = PAGE_H - 230;
  y = drawFieldsTable(page, bold, reg, doc.extractedFields, y);
  y = drawBody(page, reg, bodyForType(doc, employeeName), y - 8);
  drawSignature(page, bold, reg, arReg, doc, Math.max(y - 24, 200));

  pdf.setTitle(safeText(doc.titleEn));
  pdf.setSubject(`Tasama demo document — ${doc.type}`);
  pdf.setProducer("Tasama Payroll Intelligence Hub");
  pdf.setAuthor("Tasama BPO");
  return pdf.save();
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const baseline: Baseline = JSON.parse(await fs.readFile(BASELINE, "utf8"));
  const clientById = new Map(baseline.clients.map((c) => [c.id, c] as const));
  const empById = new Map(baseline.namedEmployees.map((e) => [e.id, e] as const));

  const arabicRegBytes = await fs.readFile(ARABIC_FONT_REG);
  const arabicBoldBytes = await fs.readFile(ARABIC_FONT_BOLD);
  console.log(
    `[generate-tasama-pdfs] arabic font loaded: ${(arabicRegBytes.length / 1024).toFixed(1)} KB regular, ${(arabicBoldBytes.length / 1024).toFixed(1)} KB bold`,
  );

  let okCount = 0;
  for (const doc of baseline.documents) {
    const client = clientById.get(doc.clientId);
    if (!client) {
      console.error(`[generate-tasama-pdfs] missing client ${doc.clientId} for doc ${doc.id}`);
      continue;
    }
    const emp = doc.employeeId ? empById.get(doc.employeeId) ?? null : null;
    const bytes = await buildPdf(doc, client, emp?.fullNameEn ?? null, arabicRegBytes, arabicBoldBytes);
    await fs.writeFile(path.join(OUT_DIR, doc.filename), bytes);
    okCount += 1;
    console.log(`[generate-tasama-pdfs] wrote ${doc.filename} (${bytes.length} bytes)`);
  }
  console.log(`[generate-tasama-pdfs] done. ${okCount} bilingual PDFs written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
