/**
 * Task #334 — Deterministic 6-dimension opportunity qualification rubric.
 *
 * The CLI's `ingest_rfp_to_opportunity` flow turns an extracted RFP
 * document into an opportunity row + a structured qualification score.
 * Scoring is a *pure function* of the extracted text (and any caller-
 * supplied context) so the same RFP always produces the same band —
 * no LLM call, no randomness — making the rubric auditable and
 * reproducible across replays.
 *
 * Dimensions (each scored 0..5):
 *   fitToOffering    — overlap with our declared offering anchors
 *   buyerAccess      — named decision-makers / champion signals
 *   budgetSignal     — budget range, fee envelope, currency markers
 *   timeline         — concrete dates / submission deadlines
 *   competition      — incumbents, shortlist mentions, sole-source signals
 *   deliverability   — geography + language + capacity hints
 *
 * Weights (sum = 100):
 *   fitToOffering 25 · buyerAccess 20 · budgetSignal 20
 *   timeline 10 · competition 10 · deliverability 15
 *
 * Bands: composite ≥70 → pursue · 40..69 → watch · <40 → decline.
 */

export type RubricDimensionKey =
  | "fitToOffering"
  | "buyerAccess"
  | "budgetSignal"
  | "timeline"
  | "competition"
  | "deliverability";

export interface RubricDimension {
  key: RubricDimensionKey;
  score: number;
  weight: number;
  rationale: string;
  chunkIds: string[];
}

export interface RubricResult {
  composite: number;
  band: "pursue" | "watch" | "decline";
  dimensions: RubricDimension[];
  attachmentIds: string[];
  generatedAt: string;
}

export const RUBRIC_WEIGHTS: Record<RubricDimensionKey, number> = {
  fitToOffering: 25,
  buyerAccess: 20,
  budgetSignal: 20,
  timeline: 10,
  competition: 10,
  deliverability: 15,
};

export interface RubricChunk {
  chunkId: string;
  text: string;
}

export interface RubricInput {
  attachmentIds: string[];
  chunks: RubricChunk[];
  offeringAnchors?: string[];
  accountCountry?: string;
  accountSector?: string;
}

interface DimSpec {
  key: RubricDimensionKey;
  signals: Array<{ pattern: RegExp; weight: number; label: string }>;
  /** Bonus signals from caller-supplied context (not chunk-anchored). */
  contextBoost?: (input: RubricInput) => { weight: number; label: string } | null;
}

const SPECS: DimSpec[] = [
  {
    key: "fitToOffering",
    signals: [
      { pattern: /\b(operating model|target operating model|TOM)\b/i, weight: 2, label: "TOM scope" },
      { pattern: /\b(transformation|reorganisation|restructur)\w*/i, weight: 1, label: "transformation work" },
      { pattern: /\b(strateg(y|ic)|advisory|consulting)\b/i, weight: 1, label: "strategic advisory" },
      { pattern: /\b(capability build|operating excellence|process redesign)\b/i, weight: 2, label: "capability build" },
    ],
    contextBoost: (input) => {
      const anchors = input.offeringAnchors ?? [];
      const text = input.chunks.map((c) => c.text).join("\n").toLowerCase();
      for (const a of anchors) {
        if (a && text.includes(a.toLowerCase())) {
          return { weight: 1, label: `mentions our ${a} offering anchor` };
        }
      }
      return null;
    },
  },
  {
    key: "buyerAccess",
    signals: [
      { pattern: /\b(CEO|COO|CFO|CIO|chief\s+\w+\s+officer)\b/i, weight: 2, label: "C-suite contact" },
      { pattern: /\b(steering committee|sponsor|champion)\b/i, weight: 1, label: "named sponsor" },
      { pattern: /\b(point of contact|primary contact|please direct)\b/i, weight: 1, label: "explicit contact channel" },
      { pattern: /\b(procurement|tender desk)\b/i, weight: 1, label: "procurement channel" },
    ],
  },
  {
    key: "budgetSignal",
    signals: [
      { pattern: /\b(budget|fee envelope|ceiling)\b/i, weight: 2, label: "explicit budget mention" },
      { pattern: /\b(USD|SAR|AED|EUR|GBP)\s*[\d,]{4,}/i, weight: 2, label: "currency + amount" },
      { pattern: /\b(not to exceed|NTE|maximum)\s+[\d,]+/i, weight: 1, label: "NTE cap" },
      { pattern: /\b(fixed[-\s]?price|time\s*and\s*materials|T&M)\b/i, weight: 1, label: "pricing mechanism" },
    ],
  },
  {
    key: "timeline",
    signals: [
      { pattern: /\bsubmission deadline\b/i, weight: 2, label: "submission deadline" },
      { pattern: /\b(start date|kickoff|kick-off|commence)\b/i, weight: 1, label: "named start" },
      { pattern: /\b\d{1,2}\s*(weeks?|months?)\b/i, weight: 1, label: "duration" },
      { pattern: /\b(Q[1-4]\s*20\d{2}|20\d{2}-\d{2}-\d{2})\b/i, weight: 2, label: "calendar anchor" },
    ],
  },
  {
    key: "competition",
    signals: [
      { pattern: /\b(incumbent|current vendor|prior consultant)\b/i, weight: 2, label: "incumbent named" },
      { pattern: /\b(shortlist|down-?selected|finalists?)\b/i, weight: 2, label: "shortlist signal" },
      { pattern: /\b(sole[-\s]?source|single source)\b/i, weight: 3, label: "sole-source" },
      { pattern: /\b(\d+)\s+(firms?|vendors?|bidders?)\b/i, weight: -1, label: "many bidders mentioned" },
    ],
  },
  {
    key: "deliverability",
    signals: [
      { pattern: /\b(Riyadh|Jeddah|Dubai|Abu Dhabi|Doha|Manama|Kuwait|KSA|UAE|GCC)\b/i, weight: 2, label: "GCC geography" },
      { pattern: /\b(Arabic|bilingual|English)\b/i, weight: 1, label: "language match" },
      { pattern: /\b(on[-\s]?site|presence in|local team)\b/i, weight: 1, label: "on-site requirement" },
      { pattern: /\b(remote|hybrid)\b/i, weight: 1, label: "delivery mode flexibility" },
    ],
    contextBoost: (input) => {
      const country = (input.accountCountry ?? "").toUpperCase();
      if (["KSA", "UAE", "QATAR", "BAHRAIN", "KUWAIT", "OMAN"].includes(country)) {
        return { weight: 1, label: `account country ${country} in delivery footprint` };
      }
      return null;
    },
  },
];

function scoreDimension(spec: DimSpec, input: RubricInput): RubricDimension {
  let raw = 0;
  const reasons: string[] = [];
  const chunkIds = new Set<string>();
  for (const sig of spec.signals) {
    for (const c of input.chunks) {
      if (sig.pattern.test(c.text)) {
        raw += sig.weight;
        reasons.push(sig.label);
        chunkIds.add(c.chunkId);
        break; // count each signal at most once
      }
    }
  }
  const boost = spec.contextBoost?.(input);
  if (boost) {
    raw += boost.weight;
    reasons.push(boost.label);
  }
  // Clamp to 0..5; raw 0 → 0, raw ≥ 5 → 5, in between linear.
  const score = Math.max(0, Math.min(5, raw));
  const rationale =
    reasons.length === 0
      ? `no ${spec.key} signal in extracted text`
      : `${reasons.slice(0, 4).join("; ")}`;
  return {
    key: spec.key,
    score,
    weight: RUBRIC_WEIGHTS[spec.key],
    rationale,
    chunkIds: [...chunkIds],
  };
}

export function scoreRubric(input: RubricInput): RubricResult {
  const dimensions = SPECS.map((s) => scoreDimension(s, input));
  // Composite is a weighted average over score/5 ⇒ 0..100.
  const composite = Math.round(
    dimensions.reduce((acc, d) => acc + (d.score / 5) * d.weight, 0),
  );
  const band: RubricResult["band"] =
    composite >= 70 ? "pursue" : composite >= 40 ? "watch" : "decline";
  return {
    composite,
    band,
    dimensions,
    attachmentIds: [...input.attachmentIds],
    generatedAt: new Date().toISOString(),
  };
}
