/**
 * Value Realization — CFO Benefits Cockpit seed data.
 *
 * 24 initiatives across 4 business units for Layla Al-Otaibi
 * (CFO + Head of Transformation, UAE conglomerate). Currency: AED.
 *
 * The first 6 entries are the canonical book-of-work also referenced by
 * `lib/maven-content/src/knowledge.ts:samplePortfolio` (we re-encode them
 * here in AED so the cockpit story stays consistent). The remaining 18
 * pad the portfolio out so a CFO would actually scroll.
 */

import type { BiText } from "@/lib/sim/types";

export type InitiativeStatus = "idea" | "pilot" | "scaling" | "in-production";
export type InitiativeType = "cost-out" | "revenue" | "risk" | "experience";

export interface Sponsor {
  id: string;
  name: BiText;
  title: BiText;
  /** Initials used by the avatar block. */
  initials: string;
}

export interface Initiative {
  id: string;
  name: BiText;
  /** Short business unit display tag. */
  businessUnit: BiText;
  /** BU id used for grouping/filtering. */
  buId: string;
  type: InitiativeType;
  status: InitiativeStatus;
  /** AED. */
  invested: number;
  /** Annualised AED the business case promised. */
  promisedAnnual: number;
  /** Annualised AED P&L is currently seeing (run-rate). */
  realizedAnnual: number;
  /** 0-100. */
  confidence: number;
  /** 0-100, % of users actually using the agent. */
  adoption: number;
  sponsorId: string;
  startDate: string;
  goLiveDate: string;
  /** Days since the gap last meaningfully closed. 0 means tracking fine. */
  driftDays: number;
  /** True when the initiative has a flagged blocker. */
  stalled: boolean;
}

export interface BusinessUnit {
  id: string;
  name: BiText;
  /** Hex used for chart series. */
  color: string;
}

export const PERSONA = {
  name: { en: "Layla Al-Otaibi", ar: "ليلى العتيبي" } as BiText,
  title: {
    en: "CFO + Head of Transformation",
    ar: "المديرة المالية ورئيسة التحوّل",
  } as BiText,
  initials: "LA",
};

export const BUSINESS_UNITS: BusinessUnit[] = [
  { id: "bu-fs", name: { en: "Financial Services", ar: "الخدمات المالية" }, color: "#196B24" },
  { id: "bu-cust", name: { en: "Customer & Digital", ar: "العملاء والرقمي" }, color: "#3B82F6" },
  { id: "bu-ops", name: { en: "Operations & Supply", ar: "العمليات والإمداد" }, color: "#F59E0B" },
  { id: "bu-corp", name: { en: "Corporate Functions", ar: "الوظائف المؤسسية" }, color: "#8B5CF6" },
];

export const SPONSORS: Sponsor[] = [
  { id: "spn-cco", name: { en: "Hessa Al-Mansoori", ar: "حصة المنصوري" }, title: { en: "Chief Customer Officer", ar: "رئيسة شؤون العملاء" }, initials: "HM" },
  { id: "spn-cpo", name: { en: "Tariq Bin Saleh", ar: "طارق بن صالح" }, title: { en: "Chief Procurement Officer", ar: "رئيس المشتريات" }, initials: "TS" },
  { id: "spn-cdo", name: { en: "Mariam Al-Hashimi", ar: "مريم الهاشمي" }, title: { en: "Chief Data Officer", ar: "رئيسة البيانات" }, initials: "MH" },
  { id: "spn-coo", name: { en: "Yousef Al-Rumaithi", ar: "يوسف الرميثي" }, title: { en: "Chief Operating Officer", ar: "المدير التنفيذي للعمليات" }, initials: "YR" },
  { id: "spn-cro", name: { en: "Aisha Al-Maktoum", ar: "عائشة آل مكتوم" }, title: { en: "Chief Risk Officer", ar: "رئيسة المخاطر" }, initials: "AM" },
  { id: "spn-chro", name: { en: "Omar Al-Shamsi", ar: "عمر الشامسي" }, title: { en: "Chief HR Officer", ar: "رئيس الموارد البشرية" }, initials: "OS" },
  { id: "spn-cfob", name: { en: "Reem Al-Falasi", ar: "ريم الفلاسي" }, title: { en: "Group Treasury Director", ar: "مديرة الخزينة" }, initials: "RF" },
];

export const INITIATIVES: Initiative[] = [
  // ── Customer & Digital ─────────────────────────────────────────────────
  {
    id: "vr-contact-centre",
    name: { en: "AI-Powered Contact Centre", ar: "مركز الاتصال المعزّز بالذكاء الاصطناعي" },
    businessUnit: { en: "Customer & Digital", ar: "العملاء والرقمي" },
    buId: "bu-cust",
    type: "cost-out",
    status: "scaling",
    invested: 4_400_000,
    promisedAnnual: 18_500_000,
    realizedAnnual: 6_400_000,
    confidence: 58,
    adoption: 35,
    sponsorId: "spn-cco",
    startDate: "2025-02-01",
    goLiveDate: "2025-08-15",
    driftDays: 96,
    stalled: true,
  },
  {
    id: "vr-citizen-services",
    name: { en: "Citizen-Services Agent (front line)", ar: "وكيل الخدمات للجمهور" },
    businessUnit: { en: "Customer & Digital", ar: "العملاء والرقمي" },
    buId: "bu-cust",
    type: "cost-out",
    status: "in-production",
    invested: 4_400_000, // ~AED, USD 1.2M ≈ 4.4M
    promisedAnnual: 15_400_000,
    realizedAnnual: 12_300_000,
    confidence: 80,
    adoption: 78,
    sponsorId: "spn-cco",
    startDate: "2025-05-15",
    goLiveDate: "2025-09-01",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-self-service-portal",
    name: { en: "Self-Service Portal v2", ar: "بوابة الخدمة الذاتية الإصدار 2" },
    businessUnit: { en: "Customer & Digital", ar: "العملاء والرقمي" },
    buId: "bu-cust",
    type: "experience",
    status: "in-production",
    invested: 1_900_000,
    promisedAnnual: 5_200_000,
    realizedAnnual: 4_100_000,
    confidence: 82,
    adoption: 71,
    sponsorId: "spn-cco",
    startDate: "2025-01-10",
    goLiveDate: "2025-06-01",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-personalisation",
    name: { en: "Cross-Sell Personalisation", ar: "تخصيص العروض المتقاطعة" },
    businessUnit: { en: "Customer & Digital", ar: "العملاء والرقمي" },
    buId: "bu-cust",
    type: "revenue",
    status: "scaling",
    invested: 2_100_000,
    promisedAnnual: 11_000_000,
    realizedAnnual: 4_800_000,
    confidence: 62,
    adoption: 44,
    sponsorId: "spn-cdo",
    startDate: "2025-04-01",
    goLiveDate: "2025-10-01",
    driftDays: 41,
    stalled: false,
  },
  {
    id: "vr-hospitality-revenue",
    name: { en: "Hospitality Revenue Optimiser", ar: "محسّن إيرادات الضيافة" },
    businessUnit: { en: "Customer & Digital", ar: "العملاء والرقمي" },
    buId: "bu-cust",
    type: "revenue",
    status: "pilot",
    invested: 2_600_000,
    promisedAnnual: 19_800_000,
    realizedAnnual: 0,
    confidence: 40,
    adoption: 8,
    sponsorId: "spn-cdo",
    startDate: "2025-09-01",
    goLiveDate: "2026-08-01",
    driftDays: 142,
    stalled: true,
  },

  // ── Operations & Supply ────────────────────────────────────────────────
  {
    id: "vr-network-ops",
    name: { en: "Network-Ops Copilot (RAN tier-1)", ar: "مساعد عمليات الشبكة" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "cost-out",
    status: "in-production",
    invested: 6_600_000,
    promisedAnnual: 24_900_000,
    realizedAnnual: 16_900_000,
    confidence: 75,
    adoption: 68,
    sponsorId: "spn-coo",
    startDate: "2025-08-01",
    goLiveDate: "2025-12-01",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-procurement-intel",
    name: { en: "Procurement Intelligence", ar: "ذكاء المشتريات" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "cost-out",
    status: "scaling",
    invested: 7_700_000,
    promisedAnnual: 34_800_000,
    realizedAnnual: 19_000_000,
    confidence: 60,
    adoption: 52,
    sponsorId: "spn-cpo",
    startDate: "2025-09-01",
    goLiveDate: "2025-12-15",
    driftDays: 73,
    stalled: true,
  },
  {
    id: "vr-demand-forecaster",
    name: { en: "Demand Forecaster (grocery)", ar: "متنبّئ الطلب — السلع الغذائية" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "revenue",
    status: "pilot",
    invested: 2_900_000,
    promisedAnnual: 11_400_000,
    realizedAnnual: 5_100_000,
    confidence: 65,
    adoption: 38,
    sponsorId: "spn-cpo",
    startDate: "2025-08-15",
    goLiveDate: "2026-02-01",
    driftDays: 22,
    stalled: false,
  },
  {
    id: "vr-warehouse-pick",
    name: { en: "Warehouse Pick Optimiser", ar: "محسّن انتقاء المستودع" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "cost-out",
    status: "in-production",
    invested: 1_400_000,
    promisedAnnual: 4_900_000,
    realizedAnnual: 4_300_000,
    confidence: 88,
    adoption: 82,
    sponsorId: "spn-coo",
    startDate: "2024-11-01",
    goLiveDate: "2025-04-15",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-fleet-routing",
    name: { en: "Fleet Routing Agent", ar: "وكيل توجيه الأسطول" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "cost-out",
    status: "scaling",
    invested: 1_100_000,
    promisedAnnual: 3_800_000,
    realizedAnnual: 2_600_000,
    confidence: 78,
    adoption: 64,
    sponsorId: "spn-coo",
    startDate: "2025-03-01",
    goLiveDate: "2025-09-15",
    driftDays: 12,
    stalled: false,
  },
  {
    id: "vr-predictive-maintenance",
    name: { en: "Predictive Maintenance", ar: "الصيانة التنبؤية" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "cost-out",
    status: "pilot",
    invested: 900_000,
    promisedAnnual: 6_200_000,
    realizedAnnual: 1_300_000,
    confidence: 55,
    adoption: 18,
    sponsorId: "spn-coo",
    startDate: "2025-10-01",
    goLiveDate: "2026-04-01",
    driftDays: 38,
    stalled: false,
  },
  {
    id: "vr-supplier-risk",
    name: { en: "Supplier Risk Sentinel", ar: "حارس مخاطر الموردين" },
    businessUnit: { en: "Operations & Supply", ar: "العمليات والإمداد" },
    buId: "bu-ops",
    type: "risk",
    status: "scaling",
    invested: 850_000,
    promisedAnnual: 3_300_000,
    realizedAnnual: 2_400_000,
    confidence: 80,
    adoption: 60,
    sponsorId: "spn-cpo",
    startDate: "2025-05-01",
    goLiveDate: "2025-11-01",
    driftDays: 0,
    stalled: false,
  },

  // ── Financial Services ─────────────────────────────────────────────────
  {
    id: "vr-sama-compliance",
    name: { en: "SAMA Compliance Copilot", ar: "مساعد الالتزام — ساما" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "risk",
    status: "in-production",
    invested: 3_300_000,
    promisedAnnual: 8_800_000,
    realizedAnnual: 7_000_000,
    confidence: 90,
    adoption: 84,
    sponsorId: "spn-cro",
    startDate: "2025-04-01",
    goLiveDate: "2025-07-15",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-fraud-triage",
    name: { en: "Fraud Triage Agent", ar: "وكيل فرز الاحتيال" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "risk",
    status: "scaling",
    invested: 1_700_000,
    promisedAnnual: 9_400_000,
    realizedAnnual: 5_800_000,
    confidence: 76,
    adoption: 70,
    sponsorId: "spn-cro",
    startDate: "2025-03-15",
    goLiveDate: "2025-09-01",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-aml-narratives",
    name: { en: "AML Narrative Drafter", ar: "كاتب روايات مكافحة غسيل الأموال" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "cost-out",
    status: "in-production",
    invested: 1_200_000,
    promisedAnnual: 4_600_000,
    realizedAnnual: 4_000_000,
    confidence: 85,
    adoption: 76,
    sponsorId: "spn-cro",
    startDate: "2025-01-15",
    goLiveDate: "2025-06-15",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-credit-decisioning",
    name: { en: "SME Credit Decisioning", ar: "قرارات الائتمان للمنشآت الصغيرة" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "revenue",
    status: "scaling",
    invested: 2_600_000,
    promisedAnnual: 14_200_000,
    realizedAnnual: 6_900_000,
    confidence: 64,
    adoption: 47,
    sponsorId: "spn-cfob",
    startDate: "2025-04-01",
    goLiveDate: "2025-10-15",
    driftDays: 55,
    stalled: false,
  },
  {
    id: "vr-treasury-cash",
    name: { en: "Treasury Cash Forecaster", ar: "متنبّئ السيولة للخزينة" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "cost-out",
    status: "pilot",
    invested: 750_000,
    promisedAnnual: 3_900_000,
    realizedAnnual: 600_000,
    confidence: 50,
    adoption: 22,
    sponsorId: "spn-cfob",
    startDate: "2025-09-01",
    goLiveDate: "2026-03-15",
    driftDays: 67,
    stalled: true,
  },
  {
    id: "vr-collections",
    name: { en: "Collections Outreach Agent", ar: "وكيل تواصل التحصيل" },
    businessUnit: { en: "Financial Services", ar: "الخدمات المالية" },
    buId: "bu-fs",
    type: "revenue",
    status: "scaling",
    invested: 1_300_000,
    promisedAnnual: 6_700_000,
    realizedAnnual: 4_200_000,
    confidence: 73,
    adoption: 58,
    sponsorId: "spn-cfob",
    startDate: "2025-06-01",
    goLiveDate: "2025-11-15",
    driftDays: 28,
    stalled: false,
  },

  // ── Corporate Functions ────────────────────────────────────────────────
  {
    id: "vr-hr-letters",
    name: { en: "HR Letters Drafter", ar: "كاتب خطابات الموارد البشرية" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "cost-out",
    status: "in-production",
    invested: 600_000,
    promisedAnnual: 2_100_000,
    realizedAnnual: 1_900_000,
    confidence: 90,
    adoption: 88,
    sponsorId: "spn-chro",
    startDate: "2024-12-01",
    goLiveDate: "2025-04-01",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-recruiting",
    name: { en: "Recruiting Sourcer", ar: "مستكشف التوظيف" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "cost-out",
    status: "scaling",
    invested: 950_000,
    promisedAnnual: 3_600_000,
    realizedAnnual: 1_800_000,
    confidence: 60,
    adoption: 41,
    sponsorId: "spn-chro",
    startDate: "2025-05-01",
    goLiveDate: "2025-10-01",
    driftDays: 49,
    stalled: false,
  },
  {
    id: "vr-policy-qa",
    name: { en: "Policy Q&A Concierge", ar: "كونسيرج أسئلة السياسات" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "experience",
    status: "in-production",
    invested: 700_000,
    promisedAnnual: 2_500_000,
    realizedAnnual: 2_100_000,
    confidence: 86,
    adoption: 79,
    sponsorId: "spn-cdo",
    startDate: "2024-11-15",
    goLiveDate: "2025-04-15",
    driftDays: 0,
    stalled: false,
  },
  {
    id: "vr-board-pack",
    name: { en: "Board-Pack Drafter", ar: "كاتب حزمة المجلس" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "cost-out",
    status: "pilot",
    invested: 450_000,
    promisedAnnual: 1_800_000,
    realizedAnnual: 700_000,
    confidence: 70,
    adoption: 33,
    sponsorId: "spn-cdo",
    startDate: "2025-08-01",
    goLiveDate: "2026-01-15",
    driftDays: 18,
    stalled: false,
  },
  {
    id: "vr-internal-audit",
    name: { en: "Internal-Audit Co-pilot", ar: "مساعد التدقيق الداخلي" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "risk",
    status: "pilot",
    invested: 520_000,
    promisedAnnual: 2_200_000,
    realizedAnnual: 0,
    confidence: 45,
    adoption: 6,
    sponsorId: "spn-cro",
    startDate: "2025-10-15",
    goLiveDate: "2026-05-01",
    driftDays: 124,
    stalled: true,
  },
  {
    id: "vr-it-helpdesk",
    name: { en: "IT Helpdesk Resolver", ar: "حلّال خدمة تقنية المعلومات" },
    businessUnit: { en: "Corporate Functions", ar: "الوظائف المؤسسية" },
    buId: "bu-corp",
    type: "cost-out",
    status: "in-production",
    invested: 880_000,
    promisedAnnual: 4_100_000,
    realizedAnnual: 3_400_000,
    confidence: 84,
    adoption: 75,
    sponsorId: "spn-cdo",
    startDate: "2025-02-15",
    goLiveDate: "2025-07-01",
    driftDays: 0,
    stalled: false,
  },
];

// Sanity assertion: 24+ initiatives.
if (INITIATIVES.length < 24) {
  // eslint-disable-next-line no-console
  console.warn(`value-realization seed should have >= 24 initiatives, has ${INITIATIVES.length}`);
}

export function getInitiative(id: string): Initiative | undefined {
  return INITIATIVES.find((i) => i.id === id);
}

export function getSponsor(id: string): Sponsor | undefined {
  return SPONSORS.find((s) => s.id === id);
}

export function getBusinessUnit(id: string): BusinessUnit | undefined {
  return BUSINESS_UNITS.find((b) => b.id === id);
}

/** Format AED value as compact "AED 18.5M" / "18.5M". */
export function formatAED(value: number, opts: { withCurrency?: boolean } = {}): string {
  const sign = value < 0 ? "-" : "";
  const v = Math.abs(value);
  let body: string;
  if (v >= 1_000_000_000) body = `${(v / 1_000_000_000).toFixed(1)}B`;
  else if (v >= 1_000_000) body = `${(v / 1_000_000).toFixed(1)}M`;
  else if (v >= 1_000) body = `${(v / 1_000).toFixed(0)}K`;
  else body = String(v);
  return opts.withCurrency === false ? `${sign}${body}` : `AED ${sign}${body}`;
}

/** Gap = promised - realized, in AED. */
export function gap(i: Initiative): number {
  return i.promisedAnnual - i.realizedAnnual;
}

/** % of promised that has been realised. */
export function realisationPct(i: Initiative): number {
  if (i.promisedAnnual <= 0) return 0;
  return Math.round((i.realizedAnnual / i.promisedAnnual) * 100);
}
