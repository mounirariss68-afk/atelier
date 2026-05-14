import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import {
  PROPOSAL_SPINE,
  buildProposalBlocks,
  renderProposalHtml,
  type FirmProfileLite,
  type ProposalBlock,
  type ProposalSectionBlock,
  type RecipientLite,
} from "../atelier-proposal-html.js";

export { renderProposalHtml, PROPOSAL_SPINE } from "../atelier-proposal-html.js";

export const ATELIER_ARTIFACT_DIR = join(tmpdir(), "atelier-artifacts");

export interface ProposalSectionLite {
  sectionId: string;
  name: string;
  ownerAgent: string;
  status: string;
  content: string | null;
}

export interface ProposalDocsInput {
  proposalId: string;
  title: string;
  winThemes: string[];
  sections: ProposalSectionLite[];
  pricingModel?: {
    totalRevenueUsd?: number;
    totalCostUsd?: number;
    marginPct?: number;
    verdict?: string;
  } | null;
  complianceMatrix?: Array<{
    rfpReqId: string;
    requirement: string;
    status: string;
    evidence: string;
  }>;
}

function ensureDir(): string {
  if (!existsSync(ATELIER_ARTIFACT_DIR)) mkdirSync(ATELIER_ARTIFACT_DIR, { recursive: true });
  return ATELIER_ARTIFACT_DIR;
}

export async function generateProposalDocs(
  input: ProposalDocsInput & {
    firmProfile?: FirmProfileLite | null;
    recipient?: RecipientLite | null;
  },
): Promise<{
  pdfPath: string;
  docxPath: string;
  pdfFile: string;
  docxFile: string;
  htmlPath: string;
  htmlFile: string;
}> {
  const dir = ensureDir();
  const pdfFile = `proposal-${input.proposalId}.pdf`;
  const docxFile = `proposal-${input.proposalId}.docx`;
  const htmlFile = `proposal-${input.proposalId}.html`;
  const pdfPath = join(dir, pdfFile);
  const docxPath = join(dir, docxFile);
  const htmlPath = join(dir, htmlFile);

  // Task #297 — HTML is the canonical deliverable. PDF and DOCX walk
  // the *same* shared block model so all three exports agree, even on
  // the special section renderers (Company Profile pulled from
  // firm_profile, Pricing/Compliance tables, etc.).
  const renderInput = {
    proposalId: input.proposalId,
    title: input.title,
    winThemes: input.winThemes,
    sections: input.sections.map((s) => ({
      sectionId: s.sectionId,
      name: s.name,
      ownerAgent: s.ownerAgent,
      status: s.status,
      content: s.content,
    })),
    pricingModel: input.pricingModel ?? null,
    complianceMatrix: input.complianceMatrix ?? [],
    firmProfile: input.firmProfile ?? null,
    recipient: input.recipient ?? null,
  };
  const sectionBlocks: ProposalSectionBlock[] = buildProposalBlocks(renderInput);
  const html = renderProposalHtml(renderInput);
  await import("node:fs/promises").then((m) => m.writeFile(htmlPath, html, "utf8"));

  // ---- PDF (pdfkit) — projected from the shared block model. ----
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(pdfPath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.pipe(stream);
    doc.fontSize(20).text(input.title, { underline: false });
    doc.moveDown(0.3);
    if (input.recipient) {
      doc.fontSize(10).fillColor("#666").text(`Prepared for ${input.recipient.recipientName}${
        input.recipient.recipientOrg ? ` · ${input.recipient.recipientOrg}` : ""
      }`);
      doc.fillColor("black");
    }
    if (input.winThemes.length) {
      doc.fontSize(10).fillColor("#888").text(`Win themes: ${input.winThemes.join(" · ")}`);
      doc.fillColor("black");
    }
    doc.moveDown(0.5);
    for (const s of sectionBlocks) {
      if (s.isCover) continue; // cover is reflected in the title block above
      doc.fontSize(14).text(s.name);
      doc.fontSize(9).fillColor("#888").text(`owner: ${s.ownerAgent}  ·  status: ${s.status}`);
      doc.fillColor("black");
      doc.moveDown(0.25);
      for (const b of s.blocks) renderBlockPdf(doc, b);
      doc.moveDown(0.5);
    }
    doc.end();
  });

  // ---- DOCX (docx) — projected from the same shared block model. ----
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.title)] }),
  ];
  if (input.recipient) {
    children.push(
      new Paragraph({
        children: [new TextRun({
          text: `Prepared for ${input.recipient.recipientName}${
            input.recipient.recipientOrg ? ` · ${input.recipient.recipientOrg}` : ""
          }`,
          italics: true, color: "666666",
        })],
      }),
    );
  }
  if (input.winThemes.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Win themes: ${input.winThemes.join(" · ")}`, italics: true, color: "888888" })],
      }),
    );
  }
  for (const s of sectionBlocks) {
    if (s.isCover) continue;
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s.name)] }),
      new Paragraph({
        children: [new TextRun({ text: `owner: ${s.ownerAgent} · status: ${s.status}`, italics: true, color: "888888" })],
      }),
    );
    for (const b of s.blocks) appendBlockDocx(children, b);
  }
  const docx = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(docx);
  await import("node:fs/promises").then((m) => m.writeFile(docxPath, buf));

  return { pdfPath, docxPath, pdfFile, docxFile, htmlPath, htmlFile };
}

// =============================================================
// Shared block → PDF / DOCX projections. The block model lives in
// `atelier-proposal-html.ts`; both projections must walk it without
// re-introducing renderer-specific business logic.
// =============================================================

type Pdf = InstanceType<typeof PDFDocument>;

function renderBlockPdf(doc: Pdf, b: ProposalBlock): void {
  switch (b.kind) {
    case "paragraph":
      doc.fontSize(11).text(b.text, { align: "left" });
      doc.moveDown(0.4);
      return;
    case "heading":
      doc.fontSize(b.level === 3 ? 13 : 11).fillColor("#0f172a").text(b.text);
      doc.fillColor("black");
      doc.moveDown(0.2);
      return;
    case "bullets":
      for (const it of b.items) doc.fontSize(11).text(`• ${it}`);
      doc.moveDown(0.3);
      return;
    case "kv":
      for (const r of b.rows) doc.fontSize(11).text(`${r.label}: ${r.value}`);
      doc.moveDown(0.3);
      return;
    case "table": {
      if (b.headers) {
        doc.fontSize(10).fillColor("#666").text(b.headers.join("  |  "));
        doc.fillColor("black");
      }
      for (const row of b.rows) {
        const isStatusFirst = b.statusColIndex === 0;
        const prefix = isStatusFirst ? `[${row[0].toUpperCase()}] ` : "";
        const rest = isStatusFirst ? row.slice(1) : row;
        doc.fontSize(10).text(`${prefix}${rest.join("  ·  ")}`);
      }
      doc.moveDown(0.3);
      return;
    }
  }
}

function appendBlockDocx(out: Paragraph[], b: ProposalBlock): void {
  switch (b.kind) {
    case "paragraph":
      out.push(new Paragraph({ children: [new TextRun(b.text)] }));
      return;
    case "heading":
      out.push(new Paragraph({
        heading: b.level === 3 ? HeadingLevel.HEADING_3 : HeadingLevel.HEADING_4,
        children: [new TextRun(b.text)],
      }));
      return;
    case "bullets":
      for (const it of b.items) out.push(new Paragraph({ children: [new TextRun(`• ${it}`)] }));
      return;
    case "kv":
      for (const r of b.rows) out.push(new Paragraph({ children: [new TextRun(`${r.label}: ${r.value}`)] }));
      return;
    case "table": {
      if (b.headers) {
        out.push(new Paragraph({
          children: [new TextRun({ text: b.headers.join("  |  "), italics: true, color: "666666" })],
        }));
      }
      for (const row of b.rows) {
        const isStatusFirst = b.statusColIndex === 0;
        const prefix = isStatusFirst ? `[${row[0].toUpperCase()}] ` : "";
        const rest = isStatusFirst ? row.slice(1) : row;
        out.push(new Paragraph({ children: [new TextRun(`${prefix}${rest.join("  ·  ")}`)] }));
      }
      return;
    }
  }
}
