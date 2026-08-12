/**
 * Atelier — Cognirise-branded PDF renderer for research briefs and POVs.
 *
 * Task #1007 — restyled on the shared glassmorphism brand kit
 * (atelier-pdf-brand.ts): navy glass cover, ice backdrop wash, rounded
 * glass panels per section, gold accents, Plus Jakarta Sans, logo on
 * every page. Three top-level build functions:
 *
 *   buildAccountResearchBriefPdf  — Account Cartographer brief
 *   buildScoutBriefPdf            — Pursuit Scout opportunity brief
 *   buildPovPdf                   — POV current version
 *
 * NOTE: callers get the pre-configured document from `createBriefDoc()`
 * (autoFirstPage:false + bufferPages:true so the footer page-number pass
 * can stamp already-rendered pages) and remain responsible for doc.end().
 */

import {
  createBrandDoc,
  addBrandPage,
  brandCover,
  glassSection,
  writeBrandFooters,
  block,
  BRAND,
  FONT,
  type BrandBlock,
} from "./atelier-pdf-brand.js";

// ── Document factory ──────────────────────────────────────────────────────────

/** Create a pdfkit document pre-configured for buffered multi-page export. */
export function createBriefDoc(): PDFKit.PDFDocument {
  return createBrandDoc();
}

// ── Shared source-registry helpers ────────────────────────────────────────────

type SourceRegistry = Array<{ url: string; index: number }>;

function refsFor(urls: string[] | undefined, sources: SourceRegistry): string | null {
  const list = urls ?? [];
  if (!list.length) return null;
  const refs = list.map((url) => {
    const existing = sources.find((s) => s.url === url);
    if (existing) return `[${existing.index}]`;
    const idx = sources.length + 1;
    sources.push({ url, index: idx });
    return `[${idx}]`;
  });
  return refs.join(" ");
}

function evidenceBlocks(
  item: { text: string; evidence?: string; sourceUrls?: string[] },
  sources: SourceRegistry,
): BrandBlock[] {
  const out: BrandBlock[] = [block.bullet(item.text, { bold: true })];
  if (item.evidence) out.push(block.italic(item.evidence, { indent: 12, size: 8.5 }));
  const refs = refsFor(item.sourceUrls, sources);
  if (refs) out.push(block.refs(refs, 12));
  return out;
}

function sourcesAppendix(doc: PDFKit.PDFDocument, registry: SourceRegistry): void {
  if (!registry.length) return;
  glassSection(
    doc,
    "Sources",
    registry.map((s) =>
      block.muted(`[${s.index}] ${s.url}`, { size: 8, gapAfter: 3, link: s.url }),
    ),
  );
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
 * the output. Section order mirrors the in-app ProfileTab.
 */
export function buildAccountResearchBriefPdf(
  doc: PDFKit.PDFDocument,
  input: AccountResearchBriefInput,
): void {
  const { accountName, researchBrief: b, generatedAt } = input;
  const sources: SourceRegistry = [];

  brandCover(doc, {
    docType: "Client Research Brief",
    title: accountName,
    generatedAt,
  });

  addBrandPage(doc);

  // 1. The one thing + why-now
  if (b.singleMostImportant) {
    const blocks: BrandBlock[] = [block.body(b.singleMostImportant, { size: 10.5 })];
    if (b.whyNowHypothesis) blocks.push(block.italic(`Why now: ${b.whyNowHypothesis}`));
    glassSection(doc, "The One Thing That Matters", blocks);
  }

  // 2. What's changing
  glassSection(doc, "What's Changing", (b.whatsChanging ?? []).flatMap((i) => evidenceBlocks(i, sources)));

  // 3. Executive tensions
  glassSection(doc, "Executive Tensions", (b.executiveTensions ?? []).flatMap((i) => evidenceBlocks(i, sources)));

  // 4. Service-line fit
  glassSection(
    doc,
    "Service-Line Fit",
    (b.serviceLineFit ?? []).flatMap((item) =>
      evidenceBlocks({ text: `${item.serviceLine}: ${item.signal}`, sourceUrls: item.sourceUrls }, sources),
    ),
  );

  // 5. Partner ecosystem
  glassSection(
    doc,
    "Partner Ecosystem",
    (b.partnerEcosystem ?? []).flatMap((item) => {
      const detail = [item.relationship, item.serviceLineGap ? `Gap: ${item.serviceLineGap}` : null]
        .filter(Boolean)
        .join(" · ");
      return evidenceBlocks({ text: `${item.partner}: ${detail}`, sourceUrls: item.sourceUrls }, sources);
    }),
  );

  // 6. Business units (optional)
  if ((b.businessUnits ?? []).length > 0) {
    glassSection(
      doc,
      "Business Units",
      b.businessUnits!.map((bu) => {
        const brands = bu.brands.length > 0 ? ` (${bu.brands.join(", ")})` : "";
        const note = bu.note ? ` — ${bu.note}` : "";
        return block.bullet(`${bu.name}${brands}${note}`, { bold: true });
      }),
    );
  }

  // 7. Mandate angles
  glassSection(
    doc,
    "Mandate Angles",
    (b.mandateAngles ?? []).flatMap((m) => {
      const blocks: BrandBlock[] = [block.strong(m.title)];
      if ((m.serviceLines ?? []).length > 0) {
        blocks.push(block.muted(`Service lines: ${m.serviceLines.join(", ")}`, { indent: 10, size: 8.5 }));
      }
      blocks.push(
        block.body(`Tension: ${m.tension}`, { indent: 10 }),
        block.body(`Why now: ${m.whyNow}`, { indent: 10 }),
        block.body(`Entry stakeholder: ${m.entryStakeholder}`, { indent: 10 }),
      );
      const refs = refsFor(m.sourceUrls, sources);
      if (refs) blocks.push(block.refs(refs, 10));
      blocks.push(block.gap(6));
      return blocks;
    }),
  );

  // 8. Open questions
  if ((b.openQuestions ?? []).length > 0) {
    glassSection(doc, "Open Questions", b.openQuestions.map((q) => block.bullet(q)));
  }

  // 9. Stress test (optional)
  if (b.stressTest) {
    const st = b.stressTest;
    const blocks: BrandBlock[] = [];
    if (st.revisedHypothesis) {
      blocks.push(block.label("Revised hypothesis:"), block.body(st.revisedHypothesis));
    }
    if ((st.failureScenarios ?? []).length > 0) {
      blocks.push(block.label("Failure scenarios:"), ...st.failureScenarios.map((s) => block.bullet(s)));
    }
    if ((st.likelyObjections ?? []).length > 0) {
      blocks.push(block.label("Likely objections:"), ...st.likelyObjections.map((s) => block.bullet(s)));
    }
    const assumptions = st.assumptions ?? {};
    const allAssumptions = [
      ...(assumptions.evidenced ?? []).map((a) => `[evidenced] ${a}`),
      ...(assumptions.untestedButLikely ?? []).map((a) => `[likely] ${a}`),
      ...(assumptions.uncertain ?? []).map((a) => `[uncertain] ${a}`),
    ];
    if (allAssumptions.length > 0) {
      blocks.push(block.label("Assumptions:"), ...allAssumptions.map((a) => block.bullet(a)));
    }
    if ((st.evidenceToStrengthen ?? []).length > 0) {
      blocks.push(block.label("Evidence to strengthen hypothesis:"));
      for (const e of st.evidenceToStrengthen) {
        blocks.push(block.bullet(`${e.evidence} (find at: ${e.whereToFind})`));
      }
    }
    glassSection(doc, "Stress Test", blocks);
  }

  sourcesAppendix(doc, sources);
  writeBrandFooters(doc, { generatedAt });
}

/**
 * Render the Pursuit Scout opportunity brief. Section order mirrors
 * BriefTab: snapshot, buyer landscape, 5C draft, open questions,
 * completeness, sources appendix.
 */
export function buildScoutBriefPdf(
  doc: PDFKit.PDFDocument,
  input: ScoutBriefInput,
): void {
  const { oppName, accountName, brief: b, facts, confidence, completeness, generatedAt } = input;
  const sources: SourceRegistry = [];

  brandCover(doc, {
    docType: "Pursuit Research Brief",
    title: accountName,
    subLines: [oppName],
    badge: confidence ? `Confidence: ${confidence}` : null,
    generatedAt,
  });

  addBrandPage(doc);

  // 1. Account snapshot
  {
    const blocks: BrandBlock[] = [];
    if (b.accountSnapshot?.oneLiner) blocks.push(block.strong(b.accountSnapshot.oneLiner));
    if (b.accountSnapshot?.scaleHint) blocks.push(block.muted(b.accountSnapshot.scaleHint));
    if ((b.accountSnapshot?.recentMoves ?? []).length > 0) {
      blocks.push(block.label("Recent moves:"), ...b.accountSnapshot.recentMoves.map((m) => block.bullet(m)));
    }
    glassSection(doc, "Account Snapshot", blocks);
  }

  // 2. Buyer landscape
  {
    const blocks: BrandBlock[] = [];
    for (const bu of b.buyerLandscape?.likelyBuyers ?? []) {
      blocks.push(block.strong(bu.title, { indent: 10, size: 10 }), block.body(bu.rationale, { indent: 20 }));
    }
    if (b.buyerLandscape?.powerMap) {
      blocks.push(block.label("Power map:"), block.body(b.buyerLandscape.powerMap));
    }
    glassSection(doc, "Buyer Landscape", blocks);
  }

  // 3. 5C draft
  {
    const FIVE_C_KEYS: Array<[string, string]> = [
      ["client", "Client"],
      ["competition", "Competition"],
      ["capability", "Capability"],
      ["capacity", "Capacity"],
      ["contract", "Contract"],
    ];
    const blocks: BrandBlock[] = [];
    for (const [key, label] of FIVE_C_KEYS) {
      const text = (b.fiveCDraft ?? {})[key];
      blocks.push(block.label(label));
      if (text && text.trim()) {
        blocks.push(block.body(text));
        // Attach fact-citation refs for facts linked to this 5C dimension
        const linked = facts.filter((f) => {
          const topic = (f.topic ?? "").toLowerCase();
          return topic.includes(key) || topic.includes(label.toLowerCase());
        });
        const refs = refsFor(linked.filter((f) => f.sourceUrl).map((f) => f.sourceUrl!), sources);
        if (refs) blocks.push(block.refs(refs, 10));
      } else {
        blocks.push(block.italic("Not researched — re-run Scout to fill this in.", { indent: 10 }));
      }
      blocks.push(block.gap(4));
    }
    glassSection(doc, "5C Draft", blocks);
  }

  // 4. Open questions
  if ((b.openQuestions ?? []).length > 0) {
    glassSection(doc, "Open Questions", b.openQuestions.map((q) => block.bullet(q)));
  }

  // 5. Research completeness summary
  if (completeness) {
    glassSection(doc, "Research Completeness", [
      block.body(`Score: ${completeness.score}%`),
      block.body(`Facts: ${completeness.factCount} total · ${completeness.sourcedFactCount} with sources`),
      block.body(
        `Confidence mix: ${completeness.confidenceMix.green} green / ${completeness.confidenceMix.amber} amber / ${completeness.confidenceMix.red} red`,
      ),
    ]);
  }

  // 6. Sources from all facts with URLs (not already in registry)
  for (const f of facts) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }
  sourcesAppendix(doc, sources);
  writeBrandFooters(doc, { generatedAt });
}

/**
 * Render a POV version. Section order mirrors PovTab: overview, POV
 * sections in version order, citation coverage, sources appendix.
 */
export function buildPovPdf(
  doc: PDFKit.PDFDocument,
  input: PovVersionInput,
): void {
  const { oppName, pov, version: v, generatedAt } = input;
  const sources: SourceRegistry = [];

  brandCover(doc, {
    docType: "Point of View",
    title: pov.title,
    subLines: [oppName + (pov.audience ? ` · For ${pov.audience}` : "")],
    generatedAt,
  });

  addBrandPage(doc);

  // 1. POV header
  {
    const blocks: BrandBlock[] = [];
    if (pov.audience) blocks.push(block.body(`Audience: ${pov.audience}`));
    if (pov.objective) blocks.push(block.body(`Objective: ${pov.objective}`));
    glassSection(doc, "Overview", blocks);
  }

  // 2. POV sections (from version.sections if present, otherwise fall back to body)
  const sections = (v.sections ?? []).filter((s) => s.heading || s.content);
  if (sections.length > 0) {
    for (const section of sections) {
      const blocks: BrandBlock[] = [];
      if (section.content && section.content.trim()) {
        // Strip HTML tags that may be in body content
        const stripped = section.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        blocks.push(block.body(stripped));
      } else if (section.intent) {
        blocks.push(block.italic(`Intent: ${section.intent}`));
      }
      // Attach citation refs for facts cited in this section
      const factIds = section.factIds ?? [];
      const linked = (v.citations as AgentFact[]).filter((f) => f.id && factIds.includes(f.id));
      const refs = refsFor(linked.filter((f) => f.sourceUrl).map((f) => f.sourceUrl!), sources);
      if (refs) blocks.push(block.refs(refs, 0));
      glassSection(doc, section.heading ?? null, blocks);
    }
  } else if (v.body && v.body.trim()) {
    // Fall back to HTML body stripped of tags
    const stripped = v.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    glassSection(doc, `Draft v${v.versionNumber}`, [block.body(stripped)]);
  } else {
    glassSection(doc, "Draft", []);
  }

  // 3. Citation coverage note
  if (v.citationCoverage != null) {
    const blocks: BrandBlock[] = [block.body(`${Math.round(v.citationCoverage * 100)}% of sections cite evidence.`)];
    if (v.notes) blocks.push(block.italic(`Notes: ${v.notes}`, { size: 8.5 }));
    glassSection(doc, "Citation Coverage", blocks);
  }

  // 4. All remaining citations
  for (const f of v.citations as AgentFact[]) {
    if (f.sourceUrl && !sources.find((s) => s.url === f.sourceUrl)) {
      sources.push({ url: f.sourceUrl, index: sources.length + 1 });
    }
  }
  sourcesAppendix(doc, sources);
  writeBrandFooters(doc, { generatedAt });
}

// Re-export brand tokens for callers that add small custom touches.
export { BRAND, FONT };
