export type Tier = "Nascent" | "Emerging" | "Established" | "Advanced" | "Leading";

export type AssessmentSlug = "ari" | "mvi" | "dafi" | "uvr";

export type Industry =
  | "public-sector"
  | "telecommunications"
  | "financial-services"
  | "energy-commodities"
  | "retail-consumer"
  | "travel-hospitality"
  | "automotive"
  | "healthcare"
  | "manufacturing"
  | "other";

export type Country = "ksa" | "uae" | "qatar" | "bahrain" | "kuwait" | "oman" | "other";

/**
 * Locale of the generated executive memo / PDF report. Supports the full
 * site language surface (EN/AR/TR). The memo generator and BiText helpers
 * fall TR back to EN at the leaf only when a TR translation is missing.
 */
export type Language = "en" | "ar" | "tr";

/**
 * Locale used by the assessment library's UI helper `t()`. Currently the
 * same shape as `Language`; kept as a separate alias for call sites that
 * specifically reference the wizard chrome locale.
 */
export type UiLang = Language;

/**
 * Multilingual string. EN is required (canonical); AR is required for the
 * existing bilingual product surface; TR is optional and falls back to EN.
 */
export type BiText = { en: string; ar: string; tr?: string };

export interface QuestionOption {
  id: string;
  label: BiText;
  score: number;
  sovereign?: number;
}

export interface Question {
  id: string;
  prompt: BiText;
  options: QuestionOption[];
  skipIf?: { questionId: string; optionIds: string[] };
  weight?: number;
}

export interface Dimension {
  id: string;
  title: BiText;
  weight: number;
  description: BiText;
  questions: Question[];
}

export interface RecommendationSet {
  quickWins90d: BiText[];
  roadmap6m: BiText[];
  strategic12m: BiText[];
}

export interface AssessmentDefinition {
  slug: AssessmentSlug;
  serviceSlug: string;
  code: string;
  title: BiText;
  subtitle: BiText;
  description: BiText;
  estMinutes: number;
  brandColor: string;
  dimensions: Dimension[];
  recommendations: Record<string, Partial<Record<Tier, RecommendationSet>>>;
  antiVendor: { en: string[]; ar: string[]; tr?: string[] };
  memoPromptHint: string;
}

export interface AntiPatternFlag {
  id: string;
  label: BiText;
  description: BiText;
  fix: BiText;
  severity: "warning" | "critical";
}

export interface AntiPatternRule {
  id: string;
  label: BiText;
  description: BiText;
  fix: BiText;
  severity: "warning" | "critical";
  appliesTo: AssessmentSlug[];
  test: (ctx: AntiPatternTestContext) => boolean;
}

export interface AntiPatternTestContext {
  slug: AssessmentSlug;
  dimensionScores: Record<string, number>;
  overallScore: number;
  answers: Record<string, string>;
}

export interface SovereignSubScore {
  score: number;
  components: { id: string; label: BiText; value: number }[];
}

export interface CostOfInactionResult {
  ebitDeltaUsd: number;
  costDeltaUsd: number;
  narrative: BiText;
  inputs: { revenueUsd: number; employees: number };
}

export interface UvrUseCaseResult {
  id: string;
  name: string;
  valueScore: number;
  readinessScore: number;
  effort: number;
  quadrant: "Quick Wins" | "Strategic Bets" | "Park" | "Avoid";
}

export interface ScoreResult {
  slug: AssessmentSlug;
  dimensionScores: Record<string, number>;
  overallScore: number;
  tier: Tier;
  sovereignSubScore: SovereignSubScore;
  strengths: string[];
  gaps: string[];
  antiPatterns: AntiPatternFlag[];
  recommendations: RecommendationSet;
  peerBenchmark: Record<string, number>;
  costOfInaction: CostOfInactionResult;
  useCases?: UvrUseCaseResult[];
}

export interface ProfileInput {
  name: string;
  email: string;
  company: string;
  role: string;
  industry: Industry;
  country: Country;
  revenueBand: string;
  employeeCountBand: string;
  language: Language;
  optInMarketing: boolean;
}

export interface SubmissionInput {
  slug: AssessmentSlug;
  profile: ProfileInput;
  answers: Record<string, string>;
  useCases?: { id: string; name: string; answers: Record<string, string> }[];
  teamToken?: string;
}

export const TIER_THRESHOLDS: { tier: Tier; min: number; max: number }[] = [
  { tier: "Nascent", min: 1.0, max: 1.99 },
  { tier: "Emerging", min: 2.0, max: 2.99 },
  { tier: "Established", min: 3.0, max: 3.79 },
  { tier: "Advanced", min: 3.8, max: 4.49 },
  { tier: "Leading", min: 4.5, max: 5.0 },
];

export function tierFor(score: number): Tier {
  for (const t of TIER_THRESHOLDS) {
    if (score >= t.min && score <= t.max) return t.tier;
  }
  return score >= 4.5 ? "Leading" : "Nascent";
}

export const TIER_INTERPRETATION: Record<Tier, BiText> = {
  Nascent: {
    en: "Foundational gaps. AI ambition outpaces operating reality.",
    ar: "فجوات تأسيسية. الطموح في الذكاء الاصطناعي يتجاوز الواقع التشغيلي.",
    tr: "Temel boşluklar. AI hırsı, operasyonel gerçekliği aşıyor.",
  },
  Emerging: {
    en: "Pilots underway, but the production path is not yet defined.",
    ar: "تجارب جارية، لكن مسار الإنتاج غير محدد بعد.",
    tr: "Pilotlar devam ediyor ancak üretim yolu henüz tanımlanmadı.",
  },
  Established: {
    en: "Production-grade in pockets. The foundations are real, but uneven.",
    ar: "إنتاج فعلي في بعض الجوانب. الأسس قائمة لكن غير متجانسة.",
    tr: "Bazı alanlarda üretim seviyesi. Temeller gerçek ama tutarsız.",
  },
  Advanced: {
    en: "Operating at scale across multiple domains with measurable outcomes.",
    ar: "تشغيل على نطاق واسع عبر مجالات متعددة مع نتائج قابلة للقياس.",
    tr: "Birden fazla alanda ölçülebilir sonuçlarla geniş ölçekte çalışıyor.",
  },
  Leading: {
    en: "Top-quartile in the GCC. Ready to set the regional benchmark.",
    ar: "ضمن الربع الأعلى في الخليج. جاهز لتحديد المعيار الإقليمي.",
    tr: "Körfez'de en üst çeyrekte. Bölgesel kıyas ölçütünü belirlemeye hazır.",
  },
};
