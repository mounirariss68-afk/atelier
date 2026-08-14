// Task: one balanced view instead of dueling opinions in the account brief.
//
// The Cartographer's stress-test (pre-mortem) stays as stored data, but every
// reader-facing surface presents ONE synthesized opinion:
//   - "Our view"                — the post-stress-test revised hypothesis
//                                 (falls back to the why-now hypothesis for
//                                 older briefs without a stress-test),
//   - "What could change our view" — 3–4 caveats distilled from failure
//                                 scenarios + likely objections,
//   - a confidence indicator derived from evidenced / untested / uncertain
//                                 assumption counts.
//
// NOTE: the web app has a mirrored pure copy of this distiller at
// artifacts/atelier/src/lib/briefView.ts (Account page + chat cards render
// from the raw blob client-side). Keep the two in lockstep.

export type BriefStressTestLike = {
  failureScenarios?: string[] | null;
  assumptions?: {
    evidenced?: string[] | null;
    untestedButLikely?: string[] | null;
    uncertain?: string[] | null;
  } | null;
  likelyObjections?: string[] | null;
  evidenceToStrengthen?: Array<{ evidence: string; whereToFind: string }> | null;
  revisedHypothesis?: string | null;
} | null;

export type BriefConfidenceLevel = "strong" | "moderate" | "tentative";

export interface DistilledBriefView {
  /** The single final opinion. Null when the brief has no hypothesis at all. */
  ourView: string | null;
  /** True when ourView is the post-stress-test revised hypothesis. */
  fromStressTest: boolean;
  /** Up to 4 caveats ("What could change our view"). */
  watchOuts: string[];
  /** Confidence derived from assumption grounding; null when untested. */
  confidence: {
    level: BriefConfidenceLevel;
    label: string;
    evidenced: number;
    untested: number;
    uncertain: number;
  } | null;
  /** Actionable follow-ups carried through unchanged. */
  evidenceToStrengthen: Array<{ evidence: string; whereToFind: string }>;
}

// Task #1061 — reader-language rendering. The distilled view stays
// structural (level + counts); renderers localize via the helpers below so
// the Account page callout and chat cards share ONE set of strings.
export type BriefViewLocale = "en" | "ar";

export const BRIEF_VIEW_LABELS: Record<
  "ourView" | "watchOuts",
  Record<BriefViewLocale, string>
> = {
  ourView: { en: "Our view", ar: "رأينا" },
  watchOuts: { en: "What could change our view", ar: "ما الذي قد يغيّر رأينا" },
};

const CONFIDENCE_WORD: Record<BriefConfidenceLevel, Record<BriefViewLocale, string>> = {
  strong: { en: "Strong", ar: "عالية" },
  moderate: { en: "Moderate", ar: "متوسطة" },
  tentative: { en: "Tentative", ar: "أولية" },
};

/** One localized confidence sentence for every reader-facing surface. */
export function briefConfidenceLabel(
  c: { level: BriefConfidenceLevel; evidenced: number; untested: number; uncertain: number },
  locale: BriefViewLocale = "en",
): string {
  if (locale === "ar") {
    return `ثقة ${CONFIDENCE_WORD[c.level].ar} — ${c.evidenced} مُثبت · ${c.untested} غير مُختبر · ${c.uncertain} غير مؤكد`;
  }
  return `${CONFIDENCE_WORD[c.level].en} confidence — ${c.evidenced} evidenced · ${c.untested} untested · ${c.uncertain} uncertain`;
}

const clean = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(clean).filter((s) => s.length > 0) : [];

export function distillBriefView(brief: {
  whyNowHypothesis?: string | null;
  stressTest?: BriefStressTestLike;
}): DistilledBriefView {
  const st = brief.stressTest ?? null;
  const revised = clean(st?.revisedHypothesis);
  const whyNow = clean(brief.whyNowHypothesis);
  const ourView = revised || whyNow || null;

  const objections = cleanList(st?.likelyObjections);
  const failures = cleanList(st?.failureScenarios);
  const uncertainList = cleanList(st?.assumptions?.uncertain);
  // 3–4 caveats: lead with the two most likely objections, then the two most
  // plausible failure scenarios; top up with uncertain assumptions if thin.
  const watchOuts = [...objections.slice(0, 2), ...failures.slice(0, 2)];
  for (const u of uncertainList) {
    if (watchOuts.length >= 4) break;
    if (watchOuts.length < 3) watchOuts.push(u);
  }

  const evidenced = cleanList(st?.assumptions?.evidenced).length;
  const untested = cleanList(st?.assumptions?.untestedButLikely).length;
  const uncertain = uncertainList.length;
  let confidence: DistilledBriefView["confidence"] = null;
  if (evidenced + untested + uncertain > 0) {
    const level: BriefConfidenceLevel =
      uncertain === 0 && evidenced > 0
        ? "strong"
        : uncertain > evidenced
          ? "tentative"
          : "moderate";
    confidence = {
      level,
      // English default; locale-aware renderers should call
      // briefConfidenceLabel(confidence, locale) instead of this field.
      label: briefConfidenceLabel({ level, evidenced, untested, uncertain }),
      evidenced,
      untested,
      uncertain,
    };
  }

  return {
    ourView,
    fromStressTest: revised.length > 0,
    watchOuts: watchOuts.slice(0, 4),
    confidence,
    evidenceToStrengthen: Array.isArray(st?.evidenceToStrengthen)
      ? st!.evidenceToStrengthen!.filter((e) => clean(e?.evidence).length > 0)
      : [],
  };
}
