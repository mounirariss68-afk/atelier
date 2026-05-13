import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";

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

export async function generateProposalDocs(input: ProposalDocsInput): Promise<{
  pdfPath: string;
  docxPath: string;
  pdfFile: string;
  docxFile: string;
}> {
  const dir = ensureDir();
  const pdfFile = `proposal-${input.proposalId}.pdf`;
  const docxFile = `proposal-${input.proposalId}.docx`;
  const pdfPath = join(dir, pdfFile);
  const docxPath = join(dir, docxFile);

  // ---- PDF (pdfkit) ----
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const stream = createWriteStream(pdfPath);
    stream.on("finish", () => resolve());
    stream.on("error", reject);
    doc.pipe(stream);
    doc.fontSize(20).text(input.title, { underline: false });
    doc.moveDown(0.5);
    if (input.winThemes.length) {
      doc.fontSize(10).fillColor("#888").text(`Win themes: ${input.winThemes.join(" · ")}`);
      doc.moveDown(0.5);
    }
    doc.fillColor("black");
    for (const s of input.sections) {
      doc.fontSize(14).text(s.name);
      doc.fontSize(9).fillColor("#888").text(`owner: ${s.ownerAgent}  ·  status: ${s.status}`);
      doc.fillColor("black");
      doc.moveDown(0.25);
      doc.fontSize(11).text(s.content ?? "(no content)", { align: "left" });
      doc.moveDown(0.75);
    }
    if (input.pricingModel) {
      const p = input.pricingModel;
      doc.addPage();
      doc.fontSize(16).text("Pricing");
      doc.moveDown(0.5);
      doc.fontSize(11).text(`Revenue: $${(p.totalRevenueUsd ?? 0).toLocaleString()}`);
      doc.text(`Cost:    $${(p.totalCostUsd ?? 0).toLocaleString()}`);
      doc.text(`Margin:  ${p.marginPct ?? 0}%   Verdict: ${p.verdict ?? "n/a"}`);
    }
    if (input.complianceMatrix?.length) {
      doc.addPage();
      doc.fontSize(16).text("Compliance matrix");
      doc.moveDown(0.5);
      for (const r of input.complianceMatrix) {
        doc.fontSize(10).text(`[${r.status.toUpperCase()}] ${r.rfpReqId}  ${r.requirement}`);
        doc.fontSize(9).fillColor("#666").text(`evidence: ${r.evidence}`);
        doc.fillColor("black");
        doc.moveDown(0.25);
      }
    }
    doc.end();
  });

  // ---- DOCX (docx) ----
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(input.title)] }),
  ];
  if (input.winThemes.length) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: `Win themes: ${input.winThemes.join(" · ")}`, italics: true, color: "888888" })],
      }),
    );
  }
  for (const s of input.sections) {
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(s.name)] }),
      new Paragraph({
        children: [new TextRun({ text: `owner: ${s.ownerAgent} · status: ${s.status}`, italics: true, color: "888888" })],
      }),
      new Paragraph({ children: [new TextRun(s.content ?? "(no content)")] }),
    );
  }
  if (input.pricingModel) {
    const p = input.pricingModel;
    children.push(
      new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Pricing")] }),
      new Paragraph({ children: [new TextRun(`Revenue: $${(p.totalRevenueUsd ?? 0).toLocaleString()}`)] }),
      new Paragraph({ children: [new TextRun(`Cost: $${(p.totalCostUsd ?? 0).toLocaleString()}`)] }),
      new Paragraph({ children: [new TextRun(`Margin: ${p.marginPct ?? 0}%   Verdict: ${p.verdict ?? "n/a"}`)] }),
    );
  }
  if (input.complianceMatrix?.length) {
    children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("Compliance matrix")] }));
    for (const r of input.complianceMatrix) {
      children.push(
        new Paragraph({ children: [new TextRun(`[${r.status.toUpperCase()}] ${r.rfpReqId} — ${r.requirement}`)] }),
        new Paragraph({ children: [new TextRun({ text: `evidence: ${r.evidence}`, color: "666666" })] }),
      );
    }
  }
  const docx = new Document({ sections: [{ children }] });
  const buf = await Packer.toBuffer(docx);
  await import("node:fs/promises").then((m) => m.writeFile(docxPath, buf));

  return { pdfPath, docxPath, pdfFile, docxFile };
}
