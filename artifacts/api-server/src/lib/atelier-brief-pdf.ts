/**
 * Atelier — Cognirise-branded PDF renderer for research briefs and POVs.
 *
 * Shared primitives (cover page, section headings, bullet lists, evidence
 * items with source footnotes, page footers with page numbers + generation
 * date) that all three PDF exports reuse. Three top-level build functions:
 *
 *   buildAccountResearchBriefPdf  — Account Cartographer brief
 *   buildScoutBriefPdf            — Pursuit Scout opportunity brief
 *   buildPovPdf                   — POV current version
 *
 * Branding follows the existing board-pack / client-invoice conventions:
 *   Navy  #0E1F3D  (headings, title text)
 *   Gold  #E89E2C  (rules, accents, confidence note)
 *   Grey  #6b7280  (body text, sub-labels)
 *
 * The Cognirise navy wordmark is loaded via the established sibling-asset
 * loader (loadBoardPackLogo); falls back to a text header when the asset is
 * unavailable (dev without a dist build, or the asset was moved).
 *
 * NOTE: all callers must set `autoFirstPage: false` and `bufferPages: true`
 * so the footer page-number pass can write over already-rendered pages.
 * The helper `createBriefDoc()` returns a PDFDocument pre-configured this way.
 */

import PDFDocument from "pdfkit";
import { loadBoardPackLogo } from "./atelier-board-pack-logo.js";

// ── Branding constants ────────────────────────────────────────────────────────
const NAVY = "#0E1F3D";
const GOLD = "#E89E2C";
const GREY = "#6b7280";
const LEFT = 56;
const RIGHT = 539;
const PAGE_W = RIGHT - LEFT; // usable width

// Logo loaded once — null if the asset can't be resolved.
const BRIEF_LOGO: Buffer | null = loadBoardPackLogo();

// ── Document factory ──────────────────────────────────────────────────────────

/** Create a pdfkit document pre-configured for buffered multi-page export. */
export function createBriefDoc(): PDFKit.PDFDocument {
  return new PDFDocument({ size: "A4", margin: LEFT, autoFirstPage: false, bufferPages: true });
}

// ── Shared primitives ─────────────────────────────────────────────────────────

function addPage(doc: PDFKit.PDFDocument): void {
  doc.addPage();
}

function coverPage(
  doc: PDFKit.PDFDocument,
  opts: {
    docType: string;
    entityName: string;
    subLine?: string | null;
    generatedAt: Date;
    confidenceBadge?: string | null;
  },
): void {
  addPage(doc);
  let y = LEFT;

  // Logo or text fallback
  if (BRIEF_LOGO) {
    doc.image(BRIEF_LOGO, LEFT, y, { width: 120 });
    y += 56;
  } else {
    doc.font("Helvetica-Bold").fontSize(18).fillColor(NAVY).text("COGNIRISE", LEFT, y);
    y += 30;
  }

  doc.font("Helvetica").fontSize(10).fillColor(GOLD).text("The Atelier — Professional Services", LEFT, y);
  y += 18;

  // Thin gold rule
  doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor(GOLD).lineWidth(0.8).stroke();
  y += 20;

  // Document type label
  doc.font("Helvetica-Bold").fontSize(22).fillColor(NAVY).text(opts.docType, LEFT, y, { width: PAGE_W });
  y = doc.y + 8;

  // Entity name
  doc.font("Helvetica").fontSize(14).fillColor(GREY).text(opts.entityName, LEFT, y, { width: PAGE_W });
  y = doc.y + 4;

  // Optional sub-line (opportunity name for Scout brief, audience for POV)
  if (opts.subLine) {
    doc.font("Helvetica").fontSize(11).fillColor(GREY).text(opts.subLine, LEFT, y, { width: PAGE_W });
    y = doc.y + 4;
  }

  // Generation date
  const dateStr = opts.generatedAt.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  doc.font("Helvetica").fontSize(10).fillColor(GREY).text(`Generated ${dateStr}`, LEFT, doc.y + 8, { width: PAGE_W });
  y = doc.y + 4;

  // Confidence badge
  if (opts.confidenceBadge) {
    doc.font("Helvetica").fontSize(10).fillColor(GOLD).text(`Confidence: ${opts.confidenceBadge}`, LEFT, doc.y + 6, { width: PAGE_W });
  }

  // Confidentiality footer at bottom of cover
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(GREY)
    .text(
      "Confidential — prepared by Cognirise. Not for distribution outside the intended recipient.",
      LEFT,
      doc.page.height - 70,
      { width: PAGE_W, align: "center" },
    );
}

function sectionHeading(doc: PDFKit.PDFDocument, title: string): void {
  // Ensure we have enough room; add page if too close to the bottom
  if (doc.y > doc.page.height - 120) {
    addPage(doc);
  }
  doc.moveDown(0.6);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(NAVY).text(title, LEFT, doc.y, { width: PAGE_W });
  const ruleY = doc.y + 2;
  doc.moveTo(LEFT, ruleY).lineTo(RIGHT, ruleY).strokeColor(GOLD).lineWidth(0.5).stroke();
  doc.moveDown(0.5);
}

function bodyText(doc: PDFKit.PDFDocument, text: string, colour: string = "#000"): void {
  doc.font("Helvetica").fontSize(10).fillColor(colour).text(text, LEFT, doc.y, { width: PAGE_W });
  doc.moveDown(0.3);
}

function notYetAvailable(doc: PDFKit.PDFDocument): void {
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor(GREY)
    .text("Not yet available.", LEFT, doc.y, { width: PAGE_W });
  doc.moveDown(0.4);
}

function bulletList(doc: PDFKit.PDFDocument, items: string[]): void {
  if (!items.length) { notYetAvailable(doc); return; }
  for (const item of items) {
    doc.font("Helvetica").fontSize(10).fillColor("#000").text(`• ${item}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.3);
}

/**
 * Render one evidence item: bold claim text, then an indented italic evidence
 * line, then `[n1, n2]` citation refs. Returns the footnote indices used so
 * the caller can build the sources appendix.
 */
function evidenceItem(
  doc: PDFKit.PDFDocument,
  item: { text: string; evidence?: string; sourceUrls?: string[] },
  sourceRegistry: Array<{ url: string; index: number }>,
): void {
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(`• ${item.text}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
  if (item.evidence) {
    doc.font("Helvetica-Oblique").fontSize(9).fillColor(GREY).text(item.evidence, LEFT + 20, doc.y, { width: PAGE_W - 20 });
  }
  const urls = item.sourceUrls ?? [];
  if (urls.length > 0) {
    const refs = urls.map((url) => {
      const existing = sourceRegistry.find((s) => s.url === url);
      if (existing) return `[${existing.index}]`;
      const idx = sourceRegistry.length + 1;
      sourceRegistry.push({ url, index: idx });
      return `[${idx}]`;
    });
    doc.font("Helvetica").fontSize(8).fillColor(GOLD).text(refs.join(" "), LEFT + 20, doc.y, { width: PAGE_W - 20 });
  }
  doc.moveDown(0.35);
}

function sourcesAppendix(doc: PDFKit.PDFDocument, registry: Array<{ url: string; index: number }>): void {
  if (!registry.length) return;
  sectionHeading(doc, "Sources");
  for (const s of registry) {
    doc.font("Helvetica").fontSize(8.5).fillColor(GREY).text(`[${s.index}] ${s.url}`, LEFT, doc.y, { width: PAGE_W, link: s.url });
    doc.moveDown(0.25);
  }
}

/** Write page-number + date footers across all buffered pages. */
function writeFooters(doc: PDFKit.PDFDocument, generatedAt: Date): void {
  const range = doc.bufferedPageRange();
  const total = range.count;
  const dateStr = generatedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const footerY = doc.page.height - 40;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(GREY)
      .text(`Cognirise — Confidential`, LEFT, footerY, { width: PAGE_W / 2 });
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(GREY)
      .text(`${dateStr}   Page ${i + 1} of ${total}`, LEFT + PAGE_W / 2, footerY, {
        width: PAGE_W / 2,
        align: "right",
      });
  }
}

// ── Account research brief shape (from atelierAccounts.researchBrief) ─────────
type EvidenceItem = { text: string; evidence: string; sourceUrls: string[] };
type ServiceLineFitItem = { serviceLine: string; signal: string; sourceUrls: string[] };
type PartnerEcosystemItem = { partner: string; relationship: string; serviceLineGap?: string | null; sourceUrls: string[] };
type BusinessUnit = { name: string; brands: string[]; note?: string | null };
type MandateAngle = { title: string; serviceLines: string[]; tension: string; whyNow: string; entryStakeholder: string; sourceUrls: string[] };
type StressTest = {
  failureScenarios: string[];
  assumptions: { evidenced: string[]; untestedButLikely: string[]; uncertain: string[] };
  likelyObjections: string[];
  evidenceToStrengthen: Array<{ evidence: string; whereToFind: string }>;
  revisedHypothesis: string;
};

export interface AccountResearchBriefInput {
  accountName: string;
  researchBrief: {
    whatsChanging: EvidenceItem[];
    executiveTensions: EvidenceItem[];
    serviceLineFit: ServiceLineFitItem[];
    partnerEcosystem: PartnerEcosystemItem[];
    businessUnits?: BusinessUnit[];
    mandateAngles: MandateAngle[];
    whyNowHypothesis: string;
    openQuestions: string[];
    singleMostImportant: string;
    stressTest?: StressTest;
  };
  generatedAt: Date;
}

// ── Scout brief shape (from atelierBriefs) ────────────────────────────────────
type AgentFact = {
  id?: string;
  topic?: string;
  statement: string;
  sourceUrl?: string;
  sourceTitle?: string;
  snippet?: string;
  confidence?: "green" | "amber" | "red";
};
type BuyerProfile = { title: string; rationale: string };

export interface ScoutBriefInput {
  oppName: string;
  accountName: string;
  brief: {
    accountSnapshot: { oneLiner: string; scaleHint: string; recentMoves: string[] };
    buyerLandscape: { likelyBuyers: BuyerProfile[]; powerMap: string };
    fiveCDraft: Record<string, string>;
    openQuestions: string[];
  };
  facts: AgentFact[];
  confidence: string;
  completeness?: {
    score: number;
    factCount: number;
    sourcedFactCount: number;
    confidenceMix: { green: number; amber: number; red: number };
  } | null;
  generatedAt: Date;
}

// ── POV version shape (from atelierPovs + atelierPovVersions) ─────────────────
type PovSection = { id?: string; heading?: string; intent?: string; content?: string; factIds?: string[] };

export interface PovVersionInput {
  oppName: string;
  pov: {
    title: string;
    audience?: string | null;
    objective?: string | null;
  };
  version: {
    versionNumber: number;
    body: string;
    sections: PovSection[];
    citations: AgentFact[];
    citationCoverage?: number | null;
    notes?: string | null;
  };
  generatedAt: Date;
}

// ── Build functions ───────────────────────────────────────────────────────────

/**
 * Render the Account Cartographer research brief into a pre-configured
 * PDFDocument. The caller is responsible for calling doc.end() and piping
 * the output.
 *
 * Section order mirrors the in-app ProfileTab:
 *   1. The One Thing + Why-Now Hypothesis
 *   2. What's Changing
 *   3. Executive Tensions
 *   4. Service-Line Fit
 *   5. Partner Ecosystem
 *   6. Business Units (if present)
 *   7. Mandate Angles
 *   8. Open Questions
 *   9. Stress Test (if present)
 */
export function buildAccountResearchBriefPdf(
  doc: PDFKit.PDFDocument,
  input: AccountResearchBriefInput,
): void {
  const { accountName, researchBrief: b, generatedAt } = input;
  const sources: Array<{ url: string; index: number }> = [];

  coverPage(doc, {
    docType: "Client Research Brief",
    entityName: accountName,
    generatedAt,
  });

  addPage(doc);

  // 1. The one thing + why-now
  if (b.singleMostImportant) {
    sectionHeading(doc, "The One Thing That Matters");
    bodyText(doc, b.singleMostImportant);
    if (b.whyNowHypothesis) {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor(GREY).text(
        `Why now: ${b.whyNowHypothesis}`, LEFT, doc.y, { width: PAGE_W },
      );
      doc.moveDown(0.4);
    }
  }

  // 2. What's changing
  sectionHeading(doc, "What's Changing");
  if ((b.whatsChanging ?? []).length === 0) {
    notYetAvailable(doc);
  } else {
    for (const item of b.whatsChanging) evidenceItem(doc, item, sources);
  }

  // 3. Executive tensions
  sectionHeading(doc, "Executive Tensions");
  if ((b.executiveTensions ?? []).length === 0) {
    notYetAvailable(doc);
  } else {
    for (const item of b.executiveTensions) evidenceItem(doc, item, sources);
  }

  // 4. Service-line fit
  sectionHeading(doc, "Service-Line Fit");
  if ((b.serviceLineFit ?? []).length === 0) {
    notYetAvailable(doc);
  } else {
    for (const item of b.serviceLineFit) {
      evidenceItem(doc, { text: `${item.serviceLine}: ${item.signal}`, evidence: "", sourceUrls: item.sourceUrls }, sources);
    }
  }

  // 5. Partner ecosystem
  sectionHeading(doc, "Partner Ecosystem");
  if ((b.partnerEcosystem ?? []).length === 0) {
    notYetAvailable(doc);
  } else {
    for (const item of b.partnerEcosystem) {
      const detail = [item.relationship, item.serviceLineGap ? `Gap: ${item.serviceLineGap}` : null]
        .filter(Boolean).join(" · ");
      evidenceItem(doc, { text: `${item.partner}: ${detail}`, sourceUrls: item.sourceUrls }, sources);
    }
  }

  // 6. Business units (optional)
  if ((b.businessUnits ?? []).length > 0) {
    sectionHeading(doc, "Business Units");
    for (const bu of b.businessUnits!) {
      const brands = bu.brands.length > 0 ? ` (${bu.brands.join(", ")})` : "";
      const note = bu.note ? ` — ${bu.note}` : "";
      doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text(`• ${bu.name}${brands}${note}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
      doc.moveDown(0.25);
    }
    doc.moveDown(0.2);
  }

  // 7. Mandate angles
  sectionHeading(doc, "Mandate Angles");
  if ((b.mandateAngles ?? []).length === 0) {
    notYetAvailable(doc);
  } else {
    for (const m of b.mandateAngles) {
      doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(m.title, LEFT, doc.y, { width: PAGE_W });
      doc.moveDown(0.15);
      if ((m.serviceLines ?? []).length > 0) {
        doc.font("Helvetica").fontSize(9).fillColor(GREY).text(`Service lines: ${m.serviceLines.join(", ")}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
        doc.moveDown(0.15);
      }
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(`Tension: ${m.tension}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
      doc.moveDown(0.1);
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(`Why now: ${m.whyNow}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
      doc.moveDown(0.1);
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(`Entry stakeholder: ${m.entryStakeholder}`, LEFT + 10, doc.y, { width: PAGE_W - 10 });
      const sUrls = m.sourceUrls ?? [];
      if (sUrls.length > 0) {
        const refs = sUrls.map((url) => {
          const ex = sources.find((s) => s.url === url);
          if (ex) return `[${ex.index}]`;
          const idx = sources.length + 1;
          sources.push({ url, index: idx });
          return `[${idx}]`;
        });
        doc.font("Helvetica").fontSize(8).fillColor(GOLD).text(refs.join(" "), LEFT + 10, doc.y, { width: PAGE_W - 10 });
      }
      doc.moveDown(0.5);
    }
  }

  // 8. Open questions
  if ((b.openQuestions ?? []).length > 0) {
    sectionHeading(doc, "Open Questions");
    bulletList(doc, b.openQuestions);
  }

  // 9. Stress test (optional)
  if (b.stressTest) {
    const st = b.stressTest;
    sectionHeading(doc, "Stress Test");
    if (st.revisedHypothesis) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Revised hypothesis:", LEFT, doc.y, { width: PAGE_W });
      bodyText(doc, st.revisedHypothesis);
    }
    if ((st.failureScenarios ?? []).length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Failure scenarios:", LEFT, doc.y, { width: PAGE_W });
      bulletList(doc, st.failureScenarios);
    }
    if ((st.likelyObjections ?? []).length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Likely objections:", LEFT, doc.y, { width: PAGE_W });
      bulletList(doc, st.likelyObjections);
    }
    const assumptions = st.assumptions ?? {};
    const allAssumptions = [
      ...(assumptions.evidenced ?? []).map((a) => `[evidenced] ${a}`),
      ...(assumptions.untestedButLikely ?? []).map((a) => `[likely] ${a}`),
      ...(assumptions.uncertain ?? []).map((a) => `[uncertain] ${a}`),
    ];
    if (allAssumptions.length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Assumptions:", LEFT, doc.y, { width: PAGE_W });
      bulletList(doc, allAssumptions);
    }
    if ((st.evidenceToStrengthen ?? []).length > 0) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Evidence to strengthen hypothesis:", LEFT, doc.y, { width: PAGE_W });
      for (const e of st.evidenceToStrengthen) {
        bodyText(doc, `• ${e.evidence} (find at: ${e.whereToFind})`);
      }
    }
  }

  sourcesAppendix(doc, sources);
  writeFooters(doc, generatedAt);
}

/**
 * Render the Pursuit Scout opportunity brief.
 *
 * Section order mirrors BriefTab:
 *   1. Account Snapshot (one-liner, scale, recent moves)
 *   2. Buyer Landscape (likely buyers, power map)
 *   3. 5C Draft (Client, Competition, Capability, Capacity, Contract)
 *   4. Open Questions
 *   5. Research Completeness summary
 *   6. Sources appendix
 */
export function buildScoutBriefPdf(
  doc: PDFKit.PDFDocument,
  input: ScoutBriefInput,
): void {
  const { oppName, accountName, brief: b, facts, confidence, completeness, generatedAt } = input;
  const sources: Array<{ url: string; index: number }> = [];

  coverPage(doc, {
    docType: "Pursuit Research Brief",
    entityName: accountName,
    subLine: oppName,
    generatedAt,
    confidenceBadge: confidence,
  });

  addPage(doc);

  // 1. Account snapshot
  sectionHeading(doc, "Account Snapshot");
  if (b.accountSnapshot?.oneLiner) {
    doc.font("Helvetica-Bold").fontSize(11).fillColor(NAVY).text(b.accountSnapshot.oneLiner, LEFT, doc.y, { width: PAGE_W });
    doc.moveDown(0.3);
  }
  if (b.accountSnapshot?.scaleHint) {
    bodyText(doc, b.accountSnapshot.scaleHint, GREY);
  }
  if ((b.accountSnapshot?.recentMoves ?? []).length > 0) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Recent moves:", LEFT, doc.y, { width: PAGE_W });
    bulletList(doc, b.accountSnapshot.recentMoves);
  } else {
    notYetAvailable(doc);
  }

  // 2. Buyer landscape
  sectionHeading(doc, "Buyer Landscape");
  const likelyBuyers = b.buyerLandscape?.likelyBuyers ?? [];
  if (likelyBuyers.length === 0) {
    notYetAvailable(doc);
  } else {
    for (const bu of likelyBuyers) {
      doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(bu.title, LEFT + 10, doc.y, { width: PAGE_W - 10 });
      doc.font("Helvetica").fontSize(10).fillColor("#000").text(bu.rationale, LEFT + 20, doc.y, { width: PAGE_W - 20 });
      doc.moveDown(0.3);
    }
  }
  if (b.buyerLandscape?.powerMap) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text("Power map:", LEFT, doc.y, { width: PAGE_W });
    bodyText(doc, b.buyerLandscape.powerMap);
  }

  // 3. 5C draft
  sectionHeading(doc, "5C Draft");
  const FIVE_C_KEYS: Array<[string, string]> = [
    ["client", "Client"],
    ["competition", "Competition"],
    ["capability", "Capability"],
    ["capacity", "Capacity"],
    ["contract", "Contract"],
  ];
  for (const [key, label] of FIVE_C_KEYS) {
    const text = (b.fiveCDraft ?? {})[key];
    doc.font("Helvetica-Bold").fontSize(10).fillColor(NAVY).text(label, LEFT, doc.y, { width: PAGE_W });
    if (text && text.trim()) {
      bodyText(doc, text);
      // Attach fact-citation refs for facts linked to this 5C dimension
      const linked = facts.filter((f) => {
        const topic = (f.topic ?? "").toLowerCase();
        return topic.includes(key) || topic.includes(label.toLowerCase());
      });
      if (linked.length > 0) {
        const refs = linked
          .filter((f) => f.sourceUrl)
          .map((f) => {
            const existing = sources.find((s) => s.url === f.sourceUrl);
            if (existing) return `[${existing.index}]`;
            const idx = sources.length + 1;
            sources.push({ url: f.sourceUrl!, index: idx });
            return `[${idx}]`;
          });
        if (refs.length > 0) {
          doc.font("Helvetica").fontSize(8).fillColor(GOLD).text(refs.join(" "), LEFT + 10, doc.y, { width: PAGE_W - 10 });
          doc.moveDown(0.2);
        }
      }
    } else {
      doc.font("Helvetica-Oblique").fontSize(10).fillColor(GREY).text("Not researched — re-run Scout to fill this in.", LEFT + 10, doc.y, { width: PAGE_W - 10 });
      doc.moveDown(0.3);
    }
    doc.moveDown(0.25);
  }

  // 4. Open questions
  if ((b.openQuestions ?? []).length > 0) {
    sectionHeading(doc, "Open Questions");
    bulletList(doc, b.openQuestions);
  }

  // 5. Research completeness summary
  if (completeness) {
    sectionHeading(doc, "Research Completeness");
    bodyText(doc, `Score: ${completeness.score}%`);
    bodyText(doc, `Facts: ${completeness.factCount} total · ${completeness.sourcedFactCount} with sources`);
    bodyText(
      doc,
      `Confidence mix: ${completeness.confidenceMix.green} green / ${completeness.confidenceMix.amber} amber / ${completeness.confidenceMix.red} red`,
    );
  }

  // 6. Sources from all facts with URLs (not already in registry)
  for (const f of facts) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }
  sourcesAppendix(doc, sources);
  writeFooters(doc, generatedAt);
}

/**
 * Render a POV version.
 *
 * Section order mirrors PovTab:
 *   1. Title / audience / objective
 *   2. POV sections in version order (heading + content)
 *   3. Citation coverage note
 *   4. Sources appendix
 */
export function buildPovPdf(
  doc: PDFKit.PDFDocument,
  input: PovVersionInput,
): void {
  const { oppName, pov, version: v, generatedAt } = input;
  const sources: Array<{ url: string; index: number }> = [];

  coverPage(doc, {
    docType: "Point of View",
    entityName: pov.title,
    subLine: oppName + (pov.audience ? ` · For ${pov.audience}` : ""),
    generatedAt,
  });

  addPage(doc);

  // 1. POV header
  sectionHeading(doc, "Overview");
  if (pov.audience) bodyText(doc, `Audience: ${pov.audience}`);
  if (pov.objective) bodyText(doc, `Objective: ${pov.objective}`);
  doc.moveDown(0.3);

  // 2. POV sections (from version.sections if present, otherwise fall back to body)
  const sections = (v.sections ?? []).filter((s) => s.heading || s.content);
  if (sections.length > 0) {
    for (const section of sections) {
      if (section.heading) {
        sectionHeading(doc, section.heading);
      }
      if (section.content && section.content.trim()) {
        // Strip HTML tags that may be in body content
        const stripped = section.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        bodyText(doc, stripped);
      } else if (section.intent) {
        doc.font("Helvetica-Oblique").fontSize(10).fillColor(GREY).text(`Intent: ${section.intent}`, LEFT, doc.y, { width: PAGE_W });
        doc.moveDown(0.3);
      }
      // Attach citation refs for facts cited in this section
      const factIds = section.factIds ?? [];
      const linked = (v.citations as AgentFact[]).filter((f) => f.id && factIds.includes(f.id));
      for (const f of linked) {
        if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
          sources.push({ url: f.sourceUrl, index: sources.length + 1 });
        }
      }
      if (linked.length > 0) {
        const refs = linked.filter((f) => f.sourceUrl).map((f) => {
          const s = sources.find((x) => x.url === f.sourceUrl);
          return s ? `[${s.index}]` : "";
        }).filter(Boolean);
        if (refs.length > 0) {
          doc.font("Helvetica").fontSize(8).fillColor(GOLD).text(refs.join(" "), LEFT, doc.y, { width: PAGE_W });
          doc.moveDown(0.2);
        }
      }
    }
  } else if (v.body && v.body.trim()) {
    // Fall back to HTML body stripped of tags
    sectionHeading(doc, `Draft v${v.versionNumber}`);
    const stripped = v.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    bodyText(doc, stripped);
  } else {
    notYetAvailable(doc);
  }

  // 3. Citation coverage note
  if (v.citationCoverage != null) {
    sectionHeading(doc, "Citation Coverage");
    bodyText(doc, `${Math.round(v.citationCoverage * 100)}% of sections cite evidence.`);
    if (v.notes) {
      doc.font("Helvetica-Oblique").fontSize(9).fillColor(GREY).text(`Notes: ${v.notes}`, LEFT, doc.y, { width: PAGE_W });
      doc.moveDown(0.3);
    }
  }

  // 4. All remaining citations
  for (const f of v.citations as AgentFact[]) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }
  sourcesAppendix(doc, sources);
  writeFooters(doc, generatedAt);
}
