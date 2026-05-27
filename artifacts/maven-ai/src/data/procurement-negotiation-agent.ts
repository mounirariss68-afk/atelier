// Procurement Negotiation Agent — derived state for the Category Manager Desk.
//
// Mirrors the cockpit scenario at
// src/lib/sim/scenarios/procurement-negotiation-agent.ts and exposes
// AgentRecommendation cards, KPI tiles, and quick-stat helpers used by
// the desk views and the AI chat.

import {
  EVENTS, SUPPLIERS, totalForSupplier, totalBaseline, savingsPctVsBaseline,
  tcoForSupplier, COUNTER_DRAFTS, LINE_ITEMS, getBid,
} from "./procurement-negotiation-seed";

export type Lang = "en" | "ar";

export type ProcurementAgentId =
  | "orch"      // Negotiation Conductor
  | "spend"     // Category Analyst
  | "round"     // Round Strategist
  | "drafter"   // Counter-bid Drafter
  | "tco"       // TCO Compiler
  | "critic";   // Award Critic

export interface AgentMeta {
  id: ProcurementAgentId;
  nameEn: string;
  nameAr: string;
  color: string;
}

export const AGENTS: AgentMeta[] = [
  { id: "orch",    nameEn: "Negotiation Conductor",  nameAr: "منسّق التفاوض",     color: "#D9534F" },
  { id: "spend",   nameEn: "Category Analyst",       nameAr: "محلّل الفئة",        color: "#5B7CFF" },
  { id: "round",   nameEn: "Round Strategist",       nameAr: "خبير الجولات",       color: "#C45BB8" },
  { id: "drafter", nameEn: "Counter-bid Drafter",    nameAr: "كاتب العرض المضادّ", color: "#8A5BD6" },
  { id: "tco",     nameEn: "TCO Compiler",           nameAr: "مُجمِّع التكلفة الشاملة", color: "#5BA98A" },
  { id: "critic",  nameEn: "Award Critic",           nameAr: "ناقد الترسية",       color: "#8B5CF6" },
];

export function getAgent(id: ProcurementAgentId): AgentMeta {
  return AGENTS.find((a) => a.id === id) ?? AGENTS[0];
}

// ─── Recommendations ─────────────────────────────────────────────────────

export type Severity = "critical" | "high" | "medium" | "info";

export interface AgentRecommendation {
  id: string;
  agentId: ProcurementAgentId;
  titleEn: string;
  titleAr: string;
  rationaleEn: string;
  rationaleAr: string;
  confidence: number;
  severity: Severity;
  recordType: "award" | "counter" | "bafo" | "prequal";
  recordId: string;
  recommendedActionEn: string;
  recommendedActionAr: string;
  alternateActionsEn: string[];
  alternateActionsAr: string[];
  generatedAt: string;
}

export const RECOMMENDATIONS: AgentRecommendation[] = [
  {
    id: "rec-award-mro",
    agentId: "critic",
    titleEn: "Award MRO event 70/30 between Supplier A and Supplier B",
    titleAr: "ترسية فئة الصيانة 70/30 بين المورد A والمورد B",
    rationaleEn: "Supplier A clears the lowest TCO in Round 3 (-7.2% vs baseline) but leads on a single-port logistics base. Supplier B is +0.8% costlier but pre-qualified across two ports and at a 12-day lead-time. A 70/30 split protects savings while removing concentration risk.",
    rationaleAr: "المورد A يحقّق أقلّ تكلفة شاملة في الجولة 3 (-7.2% مقابل الأساس) لكنه يعتمد على ميناء واحد. المورد B أعلى بـ 0.8% لكنه مؤهّل على ميناءين وزمن تسليم 12 يوماً. تقسيم 70/30 يحمي الوفورات ويزيل تركّز المخاطر.",
    confidence: 92,
    severity: "critical",
    recordType: "award",
    recordId: "RFQ-2026-Q2-MRO-014",
    recommendedActionEn: "Sign award memo: 70% Supplier A · 30% Supplier B",
    recommendedActionAr: "اعتماد مذكّرة ترسية: 70% المورد A · 30% المورد B",
    alternateActionsEn: ["100% to Supplier A (max savings, single-port risk)", "50/50 split (lower savings, max risk balance)", "Hold for BAFO round"],
    alternateActionsAr: ["100% للمورد A (أقصى وفورات، خطر ميناء واحد)", "تقسيم 50/50 (وفورات أقل، توازن أعلى)", "تأجيل لجولة BAFO"],
    generatedAt: "2026-05-05T08:21:00Z",
  },
  {
    id: "rec-counter-najm",
    agentId: "drafter",
    titleEn: "Send counter-bid to Najm Logistics on port handling RFP",
    titleAr: "إرسال عرض مضادّ لنجم لوجستيكس — مناقصة الموانئ",
    rationaleEn: "Najm's R3 is 4.8% above the defensible counter range. Drafter prepared a 3.4% take-down on LI-13 + LI-15 and a dual-port lead-time clause. Coach reviewed; non-binding qualifier intact.",
    rationaleAr: "ردّ نجم في الجولة 3 أعلى بـ 4.8% من النطاق القابل للدفاع. صاغ الكاتب تخفيضاً 3.4% على LI-13 + LI-15 وبند زمن تسليم بميناءين. راجع المدرّب؛ العبارة غير الملزمة قائمة.",
    confidence: 87,
    severity: "high",
    recordType: "counter",
    recordId: "cb-01",
    recommendedActionEn: "Approve & send counter-bid",
    recommendedActionAr: "اعتماد وإرسال العرض المضادّ",
    alternateActionsEn: ["Edit clause 4 then send", "Hold for in-person meeting"],
    alternateActionsAr: ["تعديل البند 4 ثم الإرسال", "تأجيل لاجتماع شخصي"],
    generatedAt: "2026-05-05T08:38:00Z",
  },
  {
    id: "rec-bafo-mro",
    agentId: "round",
    titleEn: "Stop further negotiation rounds on MRO event",
    titleAr: "إنهاء جولات التفاوض على فئة الصيانة",
    rationaleEn: "Round 3 closed at 6.3% savings (target 6.0%). Marginal gain from a BAFO call estimated at 0.3-0.5% but adds 6 working days. Recommend ending the negotiation and proceeding to award.",
    rationaleAr: "أُغلقت الجولة 3 عند 6.3% (الهدف 6.0%). الفائدة الهامشية من جولة BAFO تُقدَّر بـ 0.3-0.5% مع 6 أيام عمل إضافية. يُوصى بإنهاء التفاوض والانتقال للترسية.",
    confidence: 84,
    severity: "high",
    recordType: "bafo",
    recordId: "RFQ-2026-Q2-MRO-014",
    recommendedActionEn: "End rounds — proceed to award",
    recommendedActionAr: "إنهاء الجولات — الانتقال للترسية",
    alternateActionsEn: ["Run BAFO targeting 0.5% additional", "Hold until next week"],
    alternateActionsAr: ["تشغيل BAFO بهدف 0.5% إضافي", "تأجيل للأسبوع القادم"],
    generatedAt: "2026-05-05T08:04:00Z",
  },
  {
    id: "rec-prequal-oman",
    agentId: "critic",
    titleEn: "Block Oman Industrial from MRO award until ESG audit closes",
    titleAr: "حجب المورد عمان الصناعية من الترسية حتى إغلاق تدقيق الاستدامة",
    rationaleEn: "Oman Industrial's bid is competitive but pre-qualification is incomplete (ESG social-audit gap). Award gating policy requires completed pre-qual before any award.",
    rationaleAr: "عرض عمان الصناعية تنافسي لكن التأهيل ناقص (ثغرة تدقيق استدامة). سياسة الترسية تتطلب تأهيلاً كاملاً قبل الترسية.",
    confidence: 96,
    severity: "high",
    recordType: "prequal",
    recordId: "sup-h",
    recommendedActionEn: "Hold supplier — request audit by Wednesday",
    recommendedActionAr: "تعليق المورد — طلب التدقيق بحلول الأربعاء",
    alternateActionsEn: ["Waive pre-qual (requires CPO sign-off)", "Disqualify from event"],
    alternateActionsAr: ["إعفاء من التأهيل (يتطلب موافقة كبير المشتريات)", "إقصاء من الحدث"],
    generatedAt: "2026-05-05T09:14:00Z",
  },
];

// ─── KPI tiles ───────────────────────────────────────────────────────────

export interface KpiTile {
  id: string;
  labelEn: string;
  labelAr: string;
  value: string;
  subEn: string;
  subAr: string;
  trend?: "up" | "down" | "flat";
  trendLabel?: string;
}

export function generateKpis(_lang: Lang): KpiTile[] {
  const openEvents = EVENTS.filter((e) => e.stage === "live" || e.stage === "evaluating" || e.stage === "drafting").length;
  const ytdSavings = 18_400_000; // SAR — demo number
  const roundsAuto = 47;
  const suppliersThisMonth = SUPPLIERS.length + 11; // 12 + spillover
  const decisionsWaiting = RECOMMENDATIONS.filter((r) => r.severity === "critical" || r.severity === "high").length;
  return [
    { id: "open",      labelEn: "Open events",          labelAr: "الأحداث المفتوحة",   value: `${openEvents}`,            subEn: "across 4 categories",                subAr: "عبر 4 فئات",                  trend: "up",   trendLabel: "+1 vs last week" },
    { id: "ytd",       labelEn: "YTD savings",          labelAr: "الوفورات السنوية",  value: `SAR ${(ytdSavings / 1_000_000).toFixed(1)}M`, subEn: "108% of plan",       subAr: "108% من الخطة",               trend: "up",   trendLabel: "+8% vs plan" },
    { id: "auto",      labelEn: "Rounds autonomous",    labelAr: "جولات مؤتمتة",      value: `${roundsAuto}`,            subEn: "this quarter",                       subAr: "هذا الربع",                   trend: "up",   trendLabel: "+12 vs Q1" },
    { id: "suppliers", labelEn: "Suppliers competing",  labelAr: "موردون منافسون",    value: `${suppliersThisMonth}`,    subEn: "this month",                         subAr: "هذا الشهر",                   trend: "flat", trendLabel: "unchanged" },
    { id: "queue",     labelEn: "Decisions waiting",    labelAr: "قرارات بانتظاري",   value: `${decisionsWaiting}`,      subEn: "from 3 sourcing events",             subAr: "من 3 أحداث",                  trend: "up",   trendLabel: "+2 vs yesterday" },
  ];
}

// ─── Round-by-round savings (for the round timeline widget) ──────────────

export interface RoundSummary {
  round: 1 | 2 | 3;
  totalAt: number;       // SAR — best supplier total at end of round
  savingsPct: number;    // vs baseline
  participating: number; // suppliers in this round
  bestSupplierId: string;
}

export function generateRoundSummaries(): RoundSummary[] {
  const out: RoundSummary[] = [];
  for (const round of [1, 2, 3] as const) {
    let bestSup = SUPPLIERS[0].id;
    let bestTotal = Infinity;
    for (const s of SUPPLIERS) {
      const t = totalForSupplier(s.id, round);
      if (t < bestTotal) {
        bestTotal = t;
        bestSup = s.id;
      }
    }
    out.push({
      round,
      totalAt: bestTotal,
      savingsPct: savingsPctVsBaseline(bestTotal),
      participating: round === 1 ? 12 : round === 2 ? 11 : 10,
      bestSupplierId: bestSup,
    });
  }
  return out;
}

// ─── R3 winners / improvement deltas ─────────────────────────────────────

export interface SupplierRoundDelta {
  supplierId: string;
  totalR2: number;
  totalR3: number;
  improvementPct: number;
  totalTco: number;
  savingsVsBaseline: number;
}

export function generateSupplierDeltas(): SupplierRoundDelta[] {
  return SUPPLIERS.map((s) => {
    const r2 = totalForSupplier(s.id, 2);
    const r3 = totalForSupplier(s.id, 3);
    return {
      supplierId: s.id,
      totalR2: r2,
      totalR3: r3,
      improvementPct: ((r2 - r3) / r2) * 100,
      totalTco: tcoForSupplier(s.id, 3),
      savingsVsBaseline: savingsPctVsBaseline(r3),
    };
  }).sort((a, b) => b.improvementPct - a.improvementPct);
}

// ─── Allocation maths (for the slider) ───────────────────────────────────

export function landedCostForSplit(
  supplierAId: string,
  supplierBId: string,
  pctA: number,
  view: "price" | "tco",
): number {
  const a = view === "tco" ? tcoForSupplier(supplierAId, 3) : totalForSupplier(supplierAId, 3);
  const b = view === "tco" ? tcoForSupplier(supplierBId, 3) : totalForSupplier(supplierBId, 3);
  const pa = pctA / 100;
  return a * pa + b * (1 - pa);
}

// ─── Regret analysis ─────────────────────────────────────────────────────

export function regretVsLowestPrice(): number {
  // SAR difference between awarded (recommended 70/30 A/B) vs theoretical
  // line-by-line lowest in R3 (split allocation per item).
  let theoretical = 0;
  let awarded = 0;
  for (const item of getLineItemsLite()) {
    let bestPrice = Infinity;
    for (const s of SUPPLIERS) {
      const b = item.bidsR3[s.id];
      if (b < bestPrice) bestPrice = b;
    }
    theoretical += bestPrice * item.qty;
  }
  awarded = totalForSupplier("sup-a", 3) * 0.7 + totalForSupplier("sup-b", 3) * 0.3;
  return Math.max(0, awarded - theoretical);
}

// Convenience for regret math, kept as a small helper so the math above
// reads clearly. Uses the static ESM imports above (no `require` — that
// breaks in the browser bundle).
function getLineItemsLite() {
  return LINE_ITEMS.map((it) => {
    const bidsR3: Record<string, number> = {};
    for (const s of SUPPLIERS) {
      const b = getBid(it.id, s.id, 3);
      bidsR3[s.id] = b ? b.unitPrice : 0;
    }
    return { id: it.id, qty: it.qty, bidsR3 };
  });
}

// ─── Award memo helper ───────────────────────────────────────────────────

export function generateAwardMemo(lang: Lang): { headline: string; bullets: string[] } {
  const a = SUPPLIERS.find((s) => s.id === "sup-a")!;
  const b = SUPPLIERS.find((s) => s.id === "sup-b")!;
  const totalA = totalForSupplier("sup-a", 3);
  const totalB = totalForSupplier("sup-b", 3);
  const awarded = totalA * 0.7 + totalB * 0.3;
  const savings = totalBaseline() - awarded;
  if (lang === "ar") {
    return {
      headline: `ترسية ${EVENTS[0].refId}: تقسيم 70/30 بين ${a.nameAr} و${b.nameAr}.`,
      bullets: [
        `إجمالي قابل للترسية: ${SARm(awarded)} (وفورات ${SARm(savings)} = ${savingsPctVsBaseline(awarded).toFixed(1)}%).`,
        `${a.nameAr}: 70% من الحجم، أقلّ تكلفة شاملة في الجولة 3.`,
        `${b.nameAr}: 30%، مؤهّل على ميناءين وزمن تسليم 12 يوماً، يخفّف تركّز المخاطر.`,
        `جميع الموردين مؤهّلون مسبقاً؛ عمان الصناعية محجوبة لحين إغلاق تدقيق الاستدامة.`,
      ],
    };
  }
  return {
    headline: `Award ${EVENTS[0].refId}: 70/30 split between ${a.nameEn} and ${b.nameEn}.`,
    bullets: [
      `Awardable total: ${SARm(awarded)} (savings ${SARm(savings)} = ${savingsPctVsBaseline(awarded).toFixed(1)}%).`,
      `${a.nameEn}: 70% of volume, lowest TCO in Round 3.`,
      `${b.nameEn}: 30%, dual-port pre-qualified, 12-day lead-time — mitigates concentration risk.`,
      `All awardees pre-qualified; Oman Industrial held until ESG audit closes.`,
    ],
  };
}

function SARm(n: number) { return `SAR ${(n / 1_000_000).toFixed(2)}M`; }
