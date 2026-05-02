import type { AssessmentSlug, CostOfInactionResult, ProfileInput, Tier } from "./types";

const REVENUE_BANDS: Record<string, number> = {
  "lt-50m": 25_000_000,
  "50-250m": 150_000_000,
  "250m-1b": 600_000_000,
  "1-5b": 2_500_000_000,
  "gt-5b": 8_000_000_000,
};

const EMP_BANDS: Record<string, number> = {
  "lt-200": 100,
  "200-1000": 600,
  "1000-5000": 2500,
  "5000-20000": 10_000,
  "gt-20000": 30_000,
};

const TIER_GAP: Record<Tier, number> = {
  Nascent: 4,
  Emerging: 3,
  Established: 2,
  Advanced: 1,
  Leading: 0.5,
};

const ASSESSMENT_FACTORS: Record<AssessmentSlug, { revPct: number; empUsd: number; ar: { ebit: string; cost: string }; en: { ebit: string; cost: string } }> = {
  ari: {
    revPct: 0.012,
    empUsd: 6_500,
    en: {
      ebit: "EBIT lift you forfeit by not shipping production agents in regulated workflows.",
      cost: "Operating cost you keep paying because human handoffs still dominate priority journeys.",
    },
    ar: {
      ebit: "أرباح إضافية تفوّتونها بعدم نشر وكلاء إنتاج في التدفقات المنظمة.",
      cost: "تكلفة تشغيل تستمرون بدفعها لأن التحويلات البشرية ما زالت تسيطر على الرحلات.",
    },
  },
  mvi: {
    revPct: 0.009,
    empUsd: 9_500,
    en: {
      ebit: "Revenue acceleration you forfeit by shipping at half the pace of an AI-augmented team.",
      cost: "70% of your IT spend is locked in maintenance — the gap above is the recoverable portion.",
    },
    ar: {
      ebit: "تسارع إيرادات تفوّتونه بسبب التسليم بنصف سرعة فريق معزز بالذكاء الاصطناعي.",
      cost: "70% من إنفاق تقنية المعلومات محبوس في الصيانة — الفجوة أعلاه هي الجزء القابل للاسترداد.",
    },
  },
  dafi: {
    revPct: 0.014,
    empUsd: 4_200,
    en: {
      ebit: "Decision-quality revenue you forfeit because the data underneath your AI cannot be trusted.",
      cost: "Annual cost of duplicate data, manual reconciliation, and avoidable compliance remediation.",
    },
    ar: {
      ebit: "إيرادات جودة قرار تفوّتونها لأن البيانات تحت AI غير موثوقة.",
      cost: "تكلفة سنوية للبيانات المكررة والتوفيق اليدوي ومعالجة الامتثال.",
    },
  },
  uvr: {
    revPct: 0.008,
    empUsd: 3_000,
    en: {
      ebit: "EBIT impact of the top-quartile use case in your portfolio if approved this quarter.",
      cost: "Cost-of-delay for parking your top use case for another four quarters.",
    },
    ar: {
      ebit: "أثر الأرباح لأعلى حالة استخدام في محفظتكم إذا اعتمدت هذا الربع.",
      cost: "تكلفة التأخير لتأجيل أعلى حالة استخدام أربعة أرباع إضافية.",
    },
  },
};

export function computeCostOfInaction(
  slug: AssessmentSlug,
  tier: Tier,
  profile: ProfileInput
): CostOfInactionResult {
  const revenue = REVENUE_BANDS[profile.revenueBand] ?? 100_000_000;
  const employees = EMP_BANDS[profile.employeeCountBand] ?? 500;
  const f = ASSESSMENT_FACTORS[slug];
  const gapMultiplier = TIER_GAP[tier];

  const ebitDelta = revenue * f.revPct * (gapMultiplier / 4);
  const costDelta = employees * f.empUsd * (gapMultiplier / 4);

  return {
    ebitDeltaUsd: Math.round(ebitDelta),
    costDeltaUsd: Math.round(costDelta),
    inputs: { revenueUsd: revenue, employees },
    narrative: {
      en: `${f.en.ebit} ${f.en.cost}`,
      ar: `${f.ar.ebit} ${f.ar.cost}`,
    },
  };
}
