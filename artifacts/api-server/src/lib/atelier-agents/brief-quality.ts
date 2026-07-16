/**
 * Task #9 — research quality & completeness signals for a Pursuit Scout brief.
 *
 * Pure, deterministic derivations over an already-persisted brief:
 *   - `fiveCFactIds` links each 5C draft section to the research facts that
 *     plausibly support it (token-overlap matching — no model call), so
 *     readers can verify claims without hunting through the Research tab.
 *   - `completeness` summarises which sections are populated, how many facts
 *     carry a real source URL, and the confidence mix, rolled into a 0–100
 *     score partners can judge at a glance.
 *   - `briefAge` computes age + a refresh-recommended flag (manual refresh
 *     stays the trigger — there is no background cron).
 *
 * Everything here applies retroactively to briefs created before this task:
 * no schema change, no re-run required.
 */

import type { AgentFact, PursuitScoutOutput } from "./runner.js";

/** Research older than this is flagged "refresh recommended". */
export const RESEARCH_STALE_AFTER_DAYS = 30;

export type FiveCKey = "client" | "competition" | "capability" | "capacity" | "contract";
export const FIVE_C_KEYS: FiveCKey[] = [
  "client",
  "competition",
  "capability",
  "capacity",
  "contract",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "their", "they",
  "have", "has", "are", "was", "were", "will", "would", "could", "should",
  "not", "but", "its", "into", "over", "under", "more", "most", "than",
  "then", "them", "these", "those", "there", "where", "which", "while",
  "been", "being", "also", "such", "may", "might", "can", "about", "across",
  "after", "before", "between", "during", "through", "against", "among",
]);

function significantTokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? "").toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length > 3 && !STOPWORDS.has(raw)) out.add(raw);
  }
  return out;
}

/**
 * Deterministically match research facts to each 5C section. A fact supports
 * a section when at least 2 of its significant statement tokens appear in the
 * section text (or its single significant token does, for very short facts).
 * Capped at 5 facts per section, strongest overlap first.
 */
export function linkFactsToFiveC(
  fiveCDraft: Partial<Record<FiveCKey, string>> | null | undefined,
  facts: AgentFact[],
): Record<FiveCKey, string[]> {
  const result = {
    client: [],
    competition: [],
    capability: [],
    capacity: [],
    contract: [],
  } as Record<FiveCKey, string[]>;
  if (!fiveCDraft) return result;

  const factTokens = facts
    .filter((f) => !!f.id && (f.statement ?? "").trim().length > 0)
    .map((f) => ({ id: f.id as string, tokens: significantTokens(`${f.statement} ${f.snippet ?? ""}`) }));

  for (const key of FIVE_C_KEYS) {
    const sectionText = fiveCDraft[key] ?? "";
    if (!sectionText.trim()) continue;
    const sectionTokens = significantTokens(sectionText);
    const scored = factTokens
      .map((f) => {
        let overlap = 0;
        for (const t of f.tokens) if (sectionTokens.has(t)) overlap++;
        return { id: f.id, overlap, total: f.tokens.size };
      })
      .filter((s) => s.overlap >= 2 || (s.total > 0 && s.total <= 2 && s.overlap >= 1))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5);
    result[key] = scored.map((s) => s.id);
  }
  return result;
}

export interface BriefCompleteness {
  /** Section-key → populated? (fiveC keys prefixed `fiveC.`) */
  sections: Record<string, boolean>;
  /** Human-readable keys of unpopulated sections. */
  missingSections: string[];
  factCount: number;
  /** Facts carrying a real http(s) source URL. */
  sourcedFactCount: number;
  /** sourcedFactCount / factCount; null when there are no facts. */
  sourcedFactRatio: number | null;
  confidenceMix: { green: number; amber: number; red: number };
  /** 0–100 — 60% section coverage, 40% sourced-fact ratio. */
  score: number;
}

type BriefLike = Pick<
  PursuitScoutOutput,
  "accountSnapshot" | "buyerLandscape" | "fiveCDraft" | "openQuestions"
>;

export function computeBriefCompleteness(
  brief: Partial<BriefLike> | null | undefined,
  facts: AgentFact[],
): BriefCompleteness {
  const b = brief ?? {};
  const nonEmpty = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  const sections: Record<string, boolean> = {
    "accountSnapshot": nonEmpty(b.accountSnapshot?.oneLiner) || nonEmpty(b.accountSnapshot?.scaleHint),
    "recentMoves": (b.accountSnapshot?.recentMoves ?? []).some(nonEmpty),
    "buyerLandscape":
      (b.buyerLandscape?.likelyBuyers ?? []).length > 0 || nonEmpty(b.buyerLandscape?.powerMap),
    "openQuestions": (b.openQuestions ?? []).some(nonEmpty),
  };
  for (const key of FIVE_C_KEYS) {
    sections[`fiveC.${key}`] = nonEmpty(b.fiveCDraft?.[key]);
  }

  const sectionKeys = Object.keys(sections);
  const populated = sectionKeys.filter((k) => sections[k]);
  const missingSections = sectionKeys.filter((k) => !sections[k]);

  const factCount = facts.length;
  const sourcedFactCount = facts.filter(
    (f) => !!f.sourceUrl && /^https?:\/\//.test(f.sourceUrl),
  ).length;
  const sourcedFactRatio = factCount > 0 ? sourcedFactCount / factCount : null;
  const confidenceMix = { green: 0, amber: 0, red: 0 };
  for (const f of facts) {
    if (f.confidence === "green") confidenceMix.green++;
    else if (f.confidence === "red") confidenceMix.red++;
    else confidenceMix.amber++;
  }

  const sectionScore = sectionKeys.length > 0 ? populated.length / sectionKeys.length : 0;
  const score = Math.round(sectionScore * 60 + (sourcedFactRatio ?? 0) * 40);

  return {
    sections,
    missingSections,
    factCount,
    sourcedFactCount,
    sourcedFactRatio: sourcedFactRatio === null ? null : Math.round(sourcedFactRatio * 100) / 100,
    confidenceMix,
    score,
  };
}

// ---------------------------------------------------------------------------
// Account-side research quality (Account Cartographer brief) — Task #9.
// Mirrors the opportunity-side helpers: deterministic completeness summary and
// narrative→evidence linking over the persisted `researchBrief` blob.
// ---------------------------------------------------------------------------

/** Minimal structural view of `atelier_accounts.research_brief`. */
export interface AccountResearchBriefLike {
  whatsChanging?: Array<{ text: string; evidence?: string; sourceUrls?: string[] }>;
  executiveTensions?: Array<{ text: string; evidence?: string; sourceUrls?: string[] }>;
  serviceLineFit?: Array<{ serviceLine: string; signal: string; sourceUrls?: string[] }>;
  partnerEcosystem?: Array<{ partner: string; relationship: string; sourceUrls?: string[] }>;
  businessUnits?: Array<{ name: string }>;
  mandateAngles?: Array<{
    title: string;
    tension?: string;
    whyNow?: string;
    sourceUrls?: string[];
  }>;
  whyNowHypothesis?: string;
  openQuestions?: string[];
  singleMostImportant?: string;
  stressTest?: { revisedHypothesis?: string; failureScenarios?: string[] } | null;
}

type SignalLike = { confidence?: "green" | "amber" | "red" };

const HTTP_URL = /^https?:\/\//;

function sourcedEntry(urls: string[] | undefined): boolean {
  return (urls ?? []).some((u) => typeof u === "string" && HTTP_URL.test(u));
}

/**
 * A stable reference into the account research brief: `section:index`,
 * e.g. `whatsChanging:0`. The UI resolves these back to the rendered facts.
 */
export type AccountFactRef = string;

interface AccountFactEntry {
  ref: AccountFactRef;
  text: string;
  sourced: boolean;
}

function collectAccountFacts(brief: AccountResearchBriefLike): AccountFactEntry[] {
  const out: AccountFactEntry[] = [];
  (brief.whatsChanging ?? []).forEach((f, i) =>
    out.push({
      ref: `whatsChanging:${i}`,
      text: `${f.text} ${f.evidence ?? ""}`,
      sourced: sourcedEntry(f.sourceUrls),
    }),
  );
  (brief.executiveTensions ?? []).forEach((f, i) =>
    out.push({
      ref: `executiveTensions:${i}`,
      text: `${f.text} ${f.evidence ?? ""}`,
      sourced: sourcedEntry(f.sourceUrls),
    }),
  );
  (brief.serviceLineFit ?? []).forEach((f, i) =>
    out.push({
      ref: `serviceLineFit:${i}`,
      text: `${f.serviceLine} ${f.signal}`,
      sourced: sourcedEntry(f.sourceUrls),
    }),
  );
  (brief.partnerEcosystem ?? []).forEach((f, i) =>
    out.push({
      ref: `partnerEcosystem:${i}`,
      text: `${f.partner} ${f.relationship}`,
      sourced: sourcedEntry(f.sourceUrls),
    }),
  );
  (brief.mandateAngles ?? []).forEach((f, i) =>
    out.push({
      ref: `mandateAngles:${i}`,
      text: `${f.title} ${f.tension ?? ""} ${f.whyNow ?? ""}`,
      sourced: sourcedEntry(f.sourceUrls),
    }),
  );
  return out;
}

export interface AccountNarrativeLinks {
  /** Fact refs supporting `whyNowHypothesis`. */
  whyNowHypothesis: AccountFactRef[];
  /** Fact refs supporting `singleMostImportant`. */
  singleMostImportant: AccountFactRef[];
  /** Fact refs supporting the stress-test `revisedHypothesis` (if present). */
  revisedHypothesis: AccountFactRef[];
}

/**
 * Deterministically link the account brief's narrative claims to the facts
 * that plausibly support them (same token-overlap rule as the 5C linker).
 */
export function linkAccountNarrativeToFacts(
  brief: AccountResearchBriefLike | null | undefined,
): AccountNarrativeLinks {
  const result: AccountNarrativeLinks = {
    whyNowHypothesis: [],
    singleMostImportant: [],
    revisedHypothesis: [],
  };
  if (!brief) return result;
  const facts = collectAccountFacts(brief).map((f) => ({
    ref: f.ref,
    tokens: significantTokens(f.text),
  }));
  const linkTo = (narrative: string | undefined): AccountFactRef[] => {
    if (!narrative?.trim()) return [];
    const nTokens = significantTokens(narrative);
    return facts
      .map((f) => {
        let overlap = 0;
        for (const t of f.tokens) if (nTokens.has(t)) overlap++;
        return { ref: f.ref, overlap, total: f.tokens.size };
      })
      .filter((s) => s.overlap >= 2 || (s.total > 0 && s.total <= 2 && s.overlap >= 1))
      .sort((a, b) => b.overlap - a.overlap)
      .slice(0, 5)
      .map((s) => s.ref);
  };
  result.whyNowHypothesis = linkTo(brief.whyNowHypothesis);
  result.singleMostImportant = linkTo(brief.singleMostImportant);
  result.revisedHypothesis = linkTo(brief.stressTest?.revisedHypothesis ?? undefined);
  return result;
}

/**
 * Completeness summary for the ACCOUNT research brief. Section coverage is
 * over the Cognirise 4-step method sections; sourced-fact ratio counts brief
 * entries carrying a real http(s) citation; confidence mix comes from the
 * account's sourceSignals (the account facts themselves carry no confidence).
 */
export function computeAccountBriefCompleteness(
  brief: AccountResearchBriefLike | null | undefined,
  sourceSignals: SignalLike[] | null | undefined,
): BriefCompleteness {
  const b = brief ?? {};
  const nonEmpty = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  const sections: Record<string, boolean> = {
    whatsChanging: (b.whatsChanging ?? []).length > 0,
    executiveTensions: (b.executiveTensions ?? []).length > 0,
    serviceLineFit: (b.serviceLineFit ?? []).length > 0,
    partnerEcosystem: (b.partnerEcosystem ?? []).length > 0,
    businessUnits: (b.businessUnits ?? []).length > 0,
    mandateAngles: (b.mandateAngles ?? []).length > 0,
    stressTest:
      !!b.stressTest &&
      ((b.stressTest.failureScenarios ?? []).length > 0 ||
        nonEmpty(b.stressTest.revisedHypothesis)),
    whyNowHypothesis: nonEmpty(b.whyNowHypothesis),
    openQuestions: (b.openQuestions ?? []).some(nonEmpty),
    singleMostImportant: nonEmpty(b.singleMostImportant),
  };
  const sectionKeys = Object.keys(sections);
  const populated = sectionKeys.filter((k) => sections[k]);
  const missingSections = sectionKeys.filter((k) => !sections[k]);

  const facts = brief ? collectAccountFacts(b) : [];
  const factCount = facts.length;
  const sourcedFactCount = facts.filter((f) => f.sourced).length;
  const sourcedFactRatio = factCount > 0 ? sourcedFactCount / factCount : null;

  const confidenceMix = { green: 0, amber: 0, red: 0 };
  for (const s of sourceSignals ?? []) {
    if (s.confidence === "green") confidenceMix.green++;
    else if (s.confidence === "red") confidenceMix.red++;
    else confidenceMix.amber++;
  }

  const sectionScore = sectionKeys.length > 0 ? populated.length / sectionKeys.length : 0;
  const score = Math.round(sectionScore * 60 + (sourcedFactRatio ?? 0) * 40);

  return {
    sections,
    missingSections,
    factCount,
    sourcedFactCount,
    sourcedFactRatio: sourcedFactRatio === null ? null : Math.round(sourcedFactRatio * 100) / 100,
    confidenceMix,
    score,
  };
}

export function briefAge(createdAt: Date | string | null | undefined): {
  ageDays: number | null;
  refreshRecommended: boolean;
} {
  if (!createdAt) return { ageDays: null, refreshRecommended: false };
  const ts = typeof createdAt === "string" ? new Date(createdAt).getTime() : createdAt.getTime();
  if (!Number.isFinite(ts)) return { ageDays: null, refreshRecommended: false };
  const ageDays = Math.max(0, Math.floor((Date.now() - ts) / 86_400_000));
  return { ageDays, refreshRecommended: ageDays >= RESEARCH_STALE_AFTER_DAYS };
}
