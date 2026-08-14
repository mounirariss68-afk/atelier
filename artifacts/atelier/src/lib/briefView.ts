// One balanced view instead of dueling opinions in the account brief.
//
// Pure mirror of the server-side distiller at
// artifacts/api-server/src/lib/atelier-brief-view.ts — the Account page and
// chat result cards render from the raw researchBrief blob client-side, so
// the distillation logic lives in both places. Keep the two in lockstep.

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
  ourView: string | null;
  fromStressTest: boolean;
  watchOuts: string[];
  confidence: {
    level: BriefConfidenceLevel;
    label: string;
    evidenced: number;
    untested: number;
    uncertain: number;
  } | null;
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
