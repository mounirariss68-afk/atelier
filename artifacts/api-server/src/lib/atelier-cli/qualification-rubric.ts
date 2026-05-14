/**
 * Task #334 — Deterministic 6-dimension opportunity qualification rubric.
 *
 * Pure-function scorer for an extracted RFP. Same inputs → same band,
 * always — no LLM call, no randomness — so the rubric is auditable and
 * reproducible across replays.
 *
 * Dimensions (each 0..5; weights sum to 100):
 *   strategicFit    25 — overlap with our offering anchors / target segments
 *   clientQuality   15 — sector quality + named decision-makers / champions
 *   dealEconomics   20 — budget mention, currency + amount, NTE, fee model
 *   winProbability  10 — sole-source, incumbent dynamics, shortlist signals
 *   deliverability  15 — geography + language + capacity hints
 *   riskInverted    15 — *inverted* score: more risk markers ⇒ lower points
 *
 * Composite = Σ(score/5 × weight) → 0..100.
 * Bands: composite ≥70 → pursue · 40..69 → watch · <40 → decline.
 *
 * Each dimension's `chunkIds` cite the source chunks that fired the
 * signal so reviewers can pivot from the band back to the RFP text.
 */

export type RubricDimensionKey =
  | "strategicFit"
  | "clientQuality"
  | "dealEconomics"
  | "winProbability"
  | "deliverability"
  | "riskInverted";

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
  strategicFit: 25,
  clientQuality: 15,
  dealEconomics: 20,
  winProbability: 10,
  deliverability: 15,
  riskInverted: 15,
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
  /** Standard signal patterns (positive contributors). */
  signals: Array<{ pattern: RegExp; weight: number; label: string }>;
  /** When true, the raw score is `5 - clamp(raw,0,5)` (used for risk). */
  inverted?: boolean;
  /** Bonus signals from caller-supplied context (not chunk-anchored). */
  contextBoost?: (input: RubricInput) => { weight: number; label: string } | null;
}

const SPECS: DimSpec[] = [
  {
    key: "strategicFit",
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
    key: "clientQuality",
    signals: [
      { pattern: /\b(CEO|COO|CFO|CIO|chief\s+\w+\s+officer)\b/i, weight: 2, label: "C-suite contact" },
      { pattern: /\b(steering committee|sponsor|champion)\b/i, weight: 1, label: "named sponsor" },
      { pattern: /\b(fortune\s*\d+|publicly\s+listed|sovereign|government)\b/i, weight: 2, label: "tier-1 client signal" },
      { pattern: /\b(family office|holding|conglomerate)\b/i, weight: 1, label: "marquee account type" },
    ],
    contextBoost: (input) => {
      const sector = (input.accountSector ?? "").toLowerCase();
      if (["financial services", "energy", "telecom", "government"].includes(sector)) {
        return { weight: 1, label: `target sector: ${sector}` };
      }
      return null;
    },
  },
  {
    key: "dealEconomics",
    signals: [
      { pattern: /\b(budget|fee envelope|ceiling)\b/i, weight: 2, label: "explicit budget mention" },
      { pattern: /\b(USD|SAR|AED|EUR|GBP)\s*[\d,]{4,}/i, weight: 2, label: "currency + amount" },
      { pattern: /\b(not to exceed|NTE|maximum)\s+[\d,]+/i, weight: 1, label: "NTE cap" },
      { pattern: /\b(fixed[-\s]?price|time\s*and\s*materials|T&M)\b/i, weight: 1, label: "pricing mechanism" },
    ],
  },
  {
    key: "winProbability",
    signals: [
      { pattern: /\b(sole[-\s]?source|single source)\b/i, weight: 4, label: "sole-source" },
      { pattern: /\b(incumbent|current vendor|prior consultant)\b/i, weight: 1, label: "incumbent named" },
      { pattern: /\b(shortlist|down-?selected|finalists?)\b/i, weight: 2, label: "shortlist signal" },
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
  {
    key: "riskInverted",
    inverted: true,
    signals: [
      { pattern: /\b(litigation|sanctions?|compliance breach)\b/i, weight: 3, label: "compliance / litigation risk" },
      { pattern: /\b(adverse media|investigation)\b/i, weight: 2, label: "adverse media flag" },
      { pattern: /\b(unclear scope|ambiguous|tbd|to be determined)\b/i, weight: 1, label: "scope ambiguity" },
      { pattern: /\b(very tight|aggressive timeline|impossible)\b/i, weight: 1, label: "timeline risk" },
      { pattern: /\b(payment terms|late payer|past due)\b/i, weight: 1, label: "commercial risk" },
    ],
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
        break; // each signal counts at most once
      }
    }
  }
  const boost = spec.contextBoost?.(input);
  if (boost) {
    raw += boost.weight;
    reasons.push(boost.label);
  }
  const clamped = Math.max(0, Math.min(5, raw));
  const score = spec.inverted ? 5 - clamped : clamped;
  const rationale = spec.inverted
    ? reasons.length === 0
      ? "no risk markers detected (max risk-inverted score)"
      : `risk markers (deductive): ${reasons.slice(0, 4).join("; ")}`
    : reasons.length === 0
      ? `no ${spec.key} signal in extracted text`
      : reasons.slice(0, 4).join("; ");
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
