// SAMA Compliance Sentinel — CRO Obligations Console seed data.
//
// Static, deterministic seed driving the user-facing CRO console at
// /demo/sama-compliance-sentinel/console. Mirrors the shape of
// tasama-seed but is fully self-contained (no backend fetch).

export type Lang = "en" | "ar";
export interface BiText { en: string; ar: string }

export type RagStatus = "green" | "amber" | "red";
export type ObligationDomain =
  | "kyc"
  | "aml"
  | "capital"
  | "liquidity"
  | "conduct"
  | "data-protection"
  | "cyber-resilience";
export type BusinessLine =
  | "retail-banking"
  | "corporate-banking"
  | "treasury"
  | "wealth"
  | "payments"
  | "digital-channels";

export interface Obligation {
  id: string;            // OBL-####
  paragraph: string;     // e.g. "CRU-2026-04 §4.2"
  regulator: "SAMA" | "PDPL" | "CMA";
  domain: ObligationDomain;
  businessLines: BusinessLine[];
  titleEn: string;
  titleAr: string;
  summaryEn: string;
  summaryAr: string;
  ownerName: string;
  ownerTitleEn: string;
  ownerTitleAr: string;
  controlIds: string[];  // CR-###
  rag: RagStatus;
  lastTested: string;    // ISO date
  effectiveFrom: string; // ISO date
  introducedBy: string;  // circular id
  newThisWeek?: boolean;
  changedThisWeek?: boolean;
}

export interface Control {
  id: string;            // CR-###
  titleEn: string;
  titleAr: string;
  ownerName: string;
  ownerTitleEn: string;
  ownerTitleAr: string;
  frequency: "daily" | "weekly" | "monthly" | "quarterly" | "semi-annual" | "annual";
  lastTestResult: "pass" | "partial" | "fail" | "overdue";
  lastTestedAt: string;
  domain: ObligationDomain;
  obligationIds: string[];
  evidenceCount: number;
  rag: RagStatus;
}

export interface Circular {
  id: string;            // CRU-2026-04 etc.
  regulator: "SAMA" | "PDPL" | "CMA";
  titleEn: string;
  titleAr: string;
  publishedAt: string;
  effectiveFrom: string;
  paragraphCount: number;
  obligationCount: number;
  controlChanges: number;
  status: "ingested" | "in-review" | "accepted" | "filed";
  summaryEn: string;
  summaryAr: string;
}

export type ReturnFreq = "monthly" | "quarterly" | "semi-annual" | "annual" | "ad-hoc";

export interface RegulatoryReturn {
  id: string;            // QFR-2026-Q2
  code: string;          // e.g. "QFR" / "CCAR" / "AML-MTR"
  titleEn: string;
  titleAr: string;
  regulator: "SAMA" | "PDPL" | "CMA";
  frequency: ReturnFreq;
  dueDate: string;
  daysToDue: number;
  draftingStatus: "not-started" | "drafting" | "review" | "ready" | "filed";
  agentReadiness: number;  // 0-100
  amountAed: number | null;
  ownerName: string;
  signRequired: boolean;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  agentId?: string;       // matches Scenario.agents[i].id
  actorName?: string;
  actorRole?: string;
  action: string;
  detailEn: string;
  detailAr: string;
  category:
    | "ingest"
    | "map"
    | "draft"
    | "evidence"
    | "approve"
    | "override"
    | "file"
    | "system";
  obligationId?: string;
  controlId?: string;
}

export interface ParagraphTrace {
  circularId: string;           // CRU-2026-04 etc.
  paragraph: string;            // §4.1 etc.
  textEn: string;
  textAr: string;
  obligationIds: string[];
  controlIds: string[];
  evidenceLabelsEn: string[];
  evidenceLabelsAr: string[];
  isNew: boolean;
}

// ─── Domain / business-line labels ───────────────────────────────────────

export const DOMAINS: ObligationDomain[] = [
  "kyc", "aml", "capital", "liquidity", "conduct", "data-protection", "cyber-resilience",
];

export const DOMAIN_LABEL: Record<ObligationDomain, BiText> = {
  kyc: { en: "KYC", ar: "اعرف عميلك" },
  aml: { en: "AML", ar: "مكافحة غسل الأموال" },
  capital: { en: "Capital", ar: "رأس المال" },
  liquidity: { en: "Liquidity", ar: "السيولة" },
  conduct: { en: "Conduct", ar: "السلوك" },
  "data-protection": { en: "Data Protection", ar: "حماية البيانات" },
  "cyber-resilience": { en: "Cyber Resilience", ar: "المرونة السيبرانية" },
};

export const BUSINESS_LINES: BusinessLine[] = [
  "retail-banking", "corporate-banking", "treasury", "wealth", "payments", "digital-channels",
];

export const BUSINESS_LINE_LABEL: Record<BusinessLine, BiText> = {
  "retail-banking": { en: "Retail Banking", ar: "الصيرفة الأفراد" },
  "corporate-banking": { en: "Corporate Banking", ar: "الصيرفة الشركات" },
  treasury: { en: "Treasury", ar: "الخزينة" },
  wealth: { en: "Wealth", ar: "إدارة الثروات" },
  payments: { en: "Payments", ar: "المدفوعات" },
  "digital-channels": { en: "Digital Channels", ar: "القنوات الرقمية" },
};

export function tBi(b: BiText, lang: Lang = "en") {
  return b[lang] ?? b.en;
}

// ─── Procedural seed generation ──────────────────────────────────────────

const OWNER_POOL: { name: string; en: string; ar: string }[] = [
  { name: "Hassan Al-Otaibi", en: "Head of Identity", ar: "رئيس الهويّات" },
  { name: "Maha Al-Suwaidi", en: "Head of AML Operations", ar: "رئيس عمليات مكافحة غسل الأموال" },
  { name: "Faisal Al-Tamimi", en: "CISO Office", ar: "مكتب أمن المعلومات" },
  { name: "Lina Al-Qahtani", en: "Head of KYC", ar: "رئيس اعرف عميلك" },
  { name: "Yousef Al-Rashid", en: "Head of Capital Reporting", ar: "رئيس تقارير رأس المال" },
  { name: "Reem Al-Harbi", en: "Treasury Risk", ar: "مخاطر الخزينة" },
  { name: "Khalid Al-Ghamdi", en: "Conduct & Suitability", ar: "السلوك والملاءمة" },
  { name: "Sarah Al-Najjar", en: "Data Protection Office", ar: "مكتب حماية البيانات" },
  { name: "Saad Al-Hammadi", en: "HR Tech", ar: "تقنية الموارد" },
  { name: "Nora Al-Dosari", en: "Liquidity Reporting", ar: "تقارير السيولة" },
  { name: "Mohammed Al-Anzi", en: "Wealth Compliance", ar: "امتثال الثروات" },
  { name: "Aisha Al-Otaibi", en: "Payments Compliance", ar: "امتثال المدفوعات" },
];

const TITLE_TEMPLATES: Record<ObligationDomain, { en: string; ar: string }[]> = {
  kyc: [
    { en: "Beneficial-owner refresh cadence", ar: "تواتر تحديث المستفيد الحقيقي" },
    { en: "Customer risk-rating recalibration", ar: "إعادة معايرة تصنيف مخاطر العميل" },
    { en: "Source-of-funds documentation", ar: "توثيق مصدر الأموال" },
    { en: "Politically Exposed Persons (PEP) screening", ar: "فحص الأشخاص السياسيين" },
    { en: "Customer due-diligence renewal", ar: "تجديد العناية الواجبة بالعميل" },
  ],
  aml: [
    { en: "Transaction monitoring threshold review", ar: "مراجعة حدّ مراقبة العمليات" },
    { en: "Suspicious activity reporting SLA", ar: "اتفاقية مستوى الإبلاغ عن الأنشطة المشبوهة" },
    { en: "Sanctions screening list refresh", ar: "تحديث قائمة فحص العقوبات" },
    { en: "Cash-intensive business review", ar: "مراجعة الأعمال كثيفة الكاش" },
    { en: "Wire transfer beneficiary fields", ar: "حقول المستفيد في الحوالات" },
  ],
  capital: [
    { en: "RWA add-on for operational risk", ar: "إضافة الموجودات المرجحة بمخاطر التشغيل" },
    { en: "Pillar-3 disclosure refresh", ar: "تحديث إفصاح الركيزة الثالثة" },
    { en: "Capital plan stress-test scenario", ar: "سيناريو اختبار خطة رأس المال" },
    { en: "Tier-1 leverage ratio cap", ar: "حد الرافعة من رأس المال الأساسي" },
    { en: "Counter-cyclical buffer activation", ar: "تفعيل احتياطي مكافحة التقلبات" },
  ],
  liquidity: [
    { en: "LCR daily reporting frequency", ar: "تواتر التقرير اليومي لنسبة تغطية السيولة" },
    { en: "NSFR component reclassification", ar: "إعادة تصنيف مكوّن نسبة التمويل المستقر" },
    { en: "Intra-day liquidity monitoring", ar: "مراقبة السيولة خلال اليوم" },
    { en: "HQLA composition review", ar: "مراجعة تركيبة الأصول السائلة عالية الجودة" },
    { en: "Wholesale funding concentration cap", ar: "حد تركيز التمويل الجملة" },
  ],
  conduct: [
    { en: "Mis-selling complaints SLA", ar: "اتفاقية شكاوى البيع المضلّل" },
    { en: "Fees & charges transparency disclosure", ar: "إفصاح الرسوم والعمولات" },
    { en: "Product suitability assessment cadence", ar: "تواتر تقييم ملاءمة المنتج" },
    { en: "Vulnerable-customer treatment protocol", ar: "بروتوكول معاملة العميل الضعيف" },
    { en: "Branch staff certification renewal", ar: "تجديد شهادات موظفي الفرع" },
  ],
  "data-protection": [
    { en: "PDPL data-subject access response window", ar: "نافذة الاستجابة لطلب صاحب البيانات" },
    { en: "Cross-border data transfer attestation", ar: "إقرار نقل البيانات عبر الحدود" },
    { en: "Marketing-consent renewal cadence", ar: "تواتر تجديد موافقة التسويق" },
    { en: "Vendor data-processing agreement", ar: "اتفاقية معالجة البيانات للمورد" },
    { en: "Breach notification timeline", ar: "جدول الإبلاغ عن الخروقات" },
  ],
  "cyber-resilience": [
    { en: "Privileged-access review cadence", ar: "تواتر مراجعة الصلاحيات الحسّاسة" },
    { en: "SaaS connector inventory attestation", ar: "إقرار جرد موصلات SaaS" },
    { en: "Identity attestation interval", ar: "تواتر إقرار الهويّات" },
    { en: "End-of-day backup integrity", ar: "سلامة النسخ الاحتياطي نهاية اليوم" },
    { en: "Penetration-test recurrence", ar: "تكرار اختبار الاختراق" },
  ],
};

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const DOMAINS_ORDER: ObligationDomain[] = DOMAINS;

export function buildSeedObligations(): Obligation[] {
  const r = rng(20260505);
  const out: Obligation[] = [];
  let idx = 0;
  // 240 obligations evenly distributed across 7 domains
  const perDomain = Math.ceil(240 / DOMAINS_ORDER.length);
  for (const dom of DOMAINS_ORDER) {
    const templates = TITLE_TEMPLATES[dom];
    for (let i = 0; i < perDomain && out.length < 240; i++) {
      idx++;
      const tpl = templates[i % templates.length];
      const variant = Math.floor(i / templates.length) + 1;
      const owner = OWNER_POOL[Math.floor(r() * OWNER_POOL.length)];
      const blCount = 1 + Math.floor(r() * 2);
      const bls: BusinessLine[] = [];
      while (bls.length < blCount) {
        const bl = BUSINESS_LINES[Math.floor(r() * BUSINESS_LINES.length)];
        if (!bls.includes(bl)) bls.push(bl);
      }
      // RAG distribution: ~78% green, ~17% amber, ~5% red
      const ragRoll = r();
      const rag: RagStatus = ragRoll < 0.05 ? "red" : ragRoll < 0.22 ? "amber" : "green";
      const lastTestedDays = Math.floor(r() * 80) + 1;
      const lastTested = isoDaysAgo(lastTestedDays);
      const effFromYear = 2024 + Math.floor(r() * 2);
      out.push({
        id: `OBL-${String(idx).padStart(4, "0")}`,
        paragraph: `SAMA-${effFromYear}-${String(Math.floor(r() * 90) + 1).padStart(2, "0")} §${1 + Math.floor(r() * 8)}.${1 + Math.floor(r() * 12)}`,
        regulator: r() < 0.85 ? "SAMA" : r() < 0.93 ? "PDPL" : "CMA",
        domain: dom,
        businessLines: bls,
        titleEn: variant > 1 ? `${tpl.en} (rev ${variant})` : tpl.en,
        titleAr: variant > 1 ? `${tpl.ar} (مراجعة ${variant})` : tpl.ar,
        summaryEn: `Obligation derived from the ${DOMAIN_LABEL[dom].en.toLowerCase()} circular requiring ${tpl.en.toLowerCase()} across ${bls.map((b) => BUSINESS_LINE_LABEL[b].en).join(" and ")}.`,
        summaryAr: `التزام مشتقّ من تعميم ${DOMAIN_LABEL[dom].ar} يستوجب ${tpl.ar} عبر ${bls.map((b) => BUSINESS_LINE_LABEL[b].ar).join(" و ")}.`,
        ownerName: owner.name,
        ownerTitleEn: owner.en,
        ownerTitleAr: owner.ar,
        controlIds: [
          `CR-${String(((idx - 1) % 80) + 1).padStart(3, "0")}`,
          ...(r() < 0.4 ? [`CR-${String(((idx + 7) % 80) + 1).padStart(3, "0")}`] : []),
        ],
        rag,
        lastTested,
        effectiveFrom: `${effFromYear}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-15`,
        introducedBy: r() < 0.06 ? "CRU-2026-04" : r() < 0.1 ? "PDPL-2026-02" : `SAMA-${effFromYear}-${String(Math.floor(r() * 90) + 1).padStart(2, "0")}`,
      });
    }
  }
  // Mark 6 obligations as new this week (linked to CRU-2026-04 — the cockpit's focus)
  for (let i = 0; i < 6 && i < out.length; i++) {
    out[i].newThisWeek = true;
    out[i].introducedBy = "CRU-2026-04";
    out[i].rag = i < 3 ? "red" : "amber";
  }
  // Mark 4 as changed
  for (let i = 6; i < 10 && i < out.length; i++) {
    out[i].changedThisWeek = true;
  }
  return out;
}

export function buildSeedControls(): Control[] {
  const r = rng(424242);
  const out: Control[] = [];
  // Reserve one slot for the CR-082 spotlight (added below) so the
  // library stays at exactly 80 entries.
  for (let i = 1; i <= 79; i++) {
    const dom = DOMAINS_ORDER[i % DOMAINS_ORDER.length];
    const tpl = TITLE_TEMPLATES[dom][i % TITLE_TEMPLATES[dom].length];
    const owner = OWNER_POOL[(i + 3) % OWNER_POOL.length];
    const freq = (["monthly", "quarterly", "weekly", "monthly", "semi-annual"] as const)[i % 5];
    const result = (() => {
      const v = r();
      if (i <= 3) return "fail";          // newly degraded controls (CR-014/-027/-082 spirit)
      if (v < 0.06) return "fail";
      if (v < 0.18) return "partial";
      if (v < 0.22) return "overdue";
      return "pass";
    })() as Control["lastTestResult"];
    const rag: RagStatus = result === "fail" || result === "overdue" ? "red" : result === "partial" ? "amber" : "green";
    out.push({
      id: `CR-${String(i).padStart(3, "0")}`,
      titleEn: tpl.en,
      titleAr: tpl.ar,
      ownerName: owner.name,
      ownerTitleEn: owner.en,
      ownerTitleAr: owner.ar,
      frequency: freq,
      lastTestResult: result,
      lastTestedAt: isoDaysAgo(Math.floor(r() * 70) + 1),
      domain: dom,
      obligationIds: [`OBL-${String(i).padStart(4, "0")}`],
      evidenceCount: 3 + Math.floor(r() * 18),
      rag,
    });
  }
  // Spotlight controls referenced in scenario (CR-014, CR-027, CR-082 → tied to CRU-2026-04)
  const spotlight: Array<[string, BiText, BiText]> = [
    ["CR-014", { en: "Privileged-access review cadence", ar: "تواتر مراجعة الصلاحيات" }, { en: "Head of Identity", ar: "رئيس الهويّات" }],
    ["CR-027", { en: "SaaS connector inventory attestation", ar: "إقرار جرد موصلات SaaS" }, { en: "CISO Office", ar: "مكتب أمن المعلومات" }],
    ["CR-082" as string, { en: "Identity attestation interval", ar: "تواتر إقرار الهويّات" }, { en: "HR Tech", ar: "تقنية الموارد" }],
  ];
  for (const [id, t, owner] of spotlight) {
    let c = out.find((x) => x.id === id);
    if (!c) {
      c = {
        id, titleEn: t.en, titleAr: t.ar,
        ownerName: "—", ownerTitleEn: owner.en, ownerTitleAr: owner.ar,
        frequency: "monthly", lastTestResult: "fail", lastTestedAt: isoDaysAgo(2),
        domain: "cyber-resilience", obligationIds: [], evidenceCount: 9, rag: "red",
      };
      out.push(c);
    } else {
      c.titleEn = t.en; c.titleAr = t.ar; c.ownerTitleEn = owner.en; c.ownerTitleAr = owner.ar;
      c.lastTestResult = "fail"; c.rag = "red"; c.domain = "cyber-resilience";
    }
  }
  return out;
}

export function buildSeedCirculars(): Circular[] {
  return [
    {
      id: "CRU-2026-04",
      regulator: "SAMA",
      titleEn: "Cyber Resilience Update CRU-2026-04 — Identity-fabric controls",
      titleAr: "تحديث المرونة السيبرانية CRU-2026-04 — ضوابط الهويّات",
      publishedAt: "2026-05-02",
      effectiveFrom: "2026-06-02",
      paragraphCount: 28,
      obligationCount: 14,
      controlChanges: 3,
      status: "in-review",
      summaryEn: "Tightens privileged-access review cadence (quarterly → monthly), mandates SaaS connector auto-discovery + weekly attestation, and reduces identity-attestation interval (180d → 90d). 14 paragraphs are net-new; 7 reformat existing evidence requirements.",
      summaryAr: "يشدّد تواتر مراجعة الصلاحيات (ربعي → شهري) ويفرض اكتشاف موصلات SaaS تلقائياً مع إقرار أسبوعي ويقلّص تواتر إقرار الهويّات (180 → 90 يوماً). 14 فقرة جديدة و7 تعدّل شكل الأدلّة.",
    },
    {
      id: "PDPL-2026-02",
      regulator: "PDPL",
      titleEn: "PDPL Update 02-2026 — Cross-border transfer attestations",
      titleAr: "تحديث نظام حماية البيانات 02-2026 — إقرارات النقل عبر الحدود",
      publishedAt: "2026-04-14",
      effectiveFrom: "2026-07-01",
      paragraphCount: 16,
      obligationCount: 6,
      controlChanges: 2,
      status: "accepted",
      summaryEn: "Introduces a quarterly attestation for any cross-border personal-data transfer; clarifies vendor data-processing agreement scope.",
      summaryAr: "يُلزم بإقرار ربعي لكل نقل لبيانات شخصية عبر الحدود ويوضّح نطاق اتفاقيات معالجة البيانات للموردين.",
    },
    {
      id: "SAMA-2026-AML-09",
      regulator: "SAMA",
      titleEn: "AML Circular 09-2026 — Wire-transfer beneficiary completeness",
      titleAr: "تعميم مكافحة غسل الأموال 09-2026 — اكتمال بيانات المستفيد في الحوالات",
      publishedAt: "2026-03-20",
      effectiveFrom: "2026-05-01",
      paragraphCount: 12,
      obligationCount: 4,
      controlChanges: 1,
      status: "filed",
      summaryEn: "Brings wire-transfer beneficiary-field completeness rule in line with FATF Recommendation 16 update.",
      summaryAr: "يوائم قاعدة اكتمال حقول المستفيد في الحوالات مع تحديث توصية FATF رقم 16.",
    },
  ];
}

export function buildSeedReturns(): RegulatoryReturn[] {
  const out: RegulatoryReturn[] = [];
  const today = new Date("2026-05-05T00:00:00Z").getTime();
  const d = (offset: number) => {
    const dt = new Date(today + offset * 24 * 3600 * 1000);
    return dt.toISOString().slice(0, 10);
  };
  const seed: Array<Omit<RegulatoryReturn, "daysToDue">> = [
    {
      id: "QFR-2026-Q2", code: "QFR", regulator: "SAMA", frequency: "quarterly",
      titleEn: "Quarterly Financial Return — Q2 2026", titleAr: "التقرير المالي الربعي — الربع الثاني 2026",
      dueDate: d(25), draftingStatus: "drafting", agentReadiness: 78,
      amountAed: 4_200_000_000, ownerName: "Yousef Al-Rashid", signRequired: true,
    },
    {
      id: "AML-MTR-2026-04", code: "AML-MTR", regulator: "SAMA", frequency: "monthly",
      titleEn: "AML Monthly Threshold Return — April 2026", titleAr: "تقرير حدود مكافحة غسل الأموال — أبريل 2026",
      dueDate: d(8), draftingStatus: "ready", agentReadiness: 96,
      amountAed: null, ownerName: "Maha Al-Suwaidi", signRequired: true,
    },
    {
      id: "CRU-ATT-2026-04", code: "ATT", regulator: "SAMA", frequency: "ad-hoc",
      titleEn: "CRU-2026-04 Attestation Filing", titleAr: "إيداع إقرار CRU-2026-04",
      dueDate: d(28), draftingStatus: "review", agentReadiness: 82,
      amountAed: null, ownerName: "Faisal Al-Tamimi", signRequired: true,
    },
    {
      id: "LCR-DAILY-2026-05", code: "LCR", regulator: "SAMA", frequency: "monthly",
      titleEn: "LCR Monthly Aggregate — May 2026", titleAr: "إجمالي تغطية السيولة الشهري — مايو 2026",
      dueDate: d(20), draftingStatus: "drafting", agentReadiness: 65,
      amountAed: null, ownerName: "Nora Al-Dosari", signRequired: false,
    },
    {
      id: "PDPL-CBT-2026-Q2", code: "PDPL-CBT", regulator: "PDPL", frequency: "quarterly",
      titleEn: "PDPL Cross-Border Transfer Attestation — Q2", titleAr: "إقرار النقل عبر الحدود — الربع الثاني",
      dueDate: d(35), draftingStatus: "not-started", agentReadiness: 12,
      amountAed: null, ownerName: "Sarah Al-Najjar", signRequired: true,
    },
    {
      id: "PILLAR3-2026-Q1", code: "PILLAR3", regulator: "SAMA", frequency: "quarterly",
      titleEn: "Pillar-3 Disclosure — Q1 2026", titleAr: "إفصاح الركيزة الثالثة — الربع الأول 2026",
      dueDate: d(-7), draftingStatus: "filed", agentReadiness: 100,
      amountAed: 1_800_000_000, ownerName: "Yousef Al-Rashid", signRequired: false,
    },
    {
      id: "NITAQAT-2026-H1", code: "NITAQAT", regulator: "SAMA", frequency: "semi-annual",
      titleEn: "Saudization Half-Year Return — H1 2026", titleAr: "إقرار السعودة نصف السنوي — H1 2026",
      dueDate: d(48), draftingStatus: "not-started", agentReadiness: 4,
      amountAed: null, ownerName: "Saad Al-Hammadi", signRequired: false,
    },
    {
      id: "CMA-DISC-2026-04", code: "CMA-DISC", regulator: "CMA", frequency: "monthly",
      titleEn: "CMA Material-Event Disclosure — April 2026", titleAr: "إفصاح الأحداث الجوهرية — أبريل 2026",
      dueDate: d(3), draftingStatus: "ready", agentReadiness: 92,
      amountAed: null, ownerName: "Khalid Al-Ghamdi", signRequired: true,
    },
    {
      id: "STRESS-2026-H1", code: "STRESS", regulator: "SAMA", frequency: "semi-annual",
      titleEn: "Capital Plan Stress-Test — H1 2026", titleAr: "اختبار الضغط لخطة رأس المال — H1 2026",
      dueDate: d(60), draftingStatus: "drafting", agentReadiness: 41,
      amountAed: 12_400_000_000, ownerName: "Yousef Al-Rashid", signRequired: true,
    },
    {
      id: "FRAUD-2026-04", code: "FRAUD", regulator: "SAMA", frequency: "monthly",
      titleEn: "Fraud-Loss Monthly Return — April 2026", titleAr: "تقرير خسائر الاحتيال الشهري — أبريل 2026",
      dueDate: d(11), draftingStatus: "review", agentReadiness: 88,
      amountAed: 47_000_000, ownerName: "Maha Al-Suwaidi", signRequired: false,
    },
    {
      id: "LIQ-NSFR-2026-Q2", code: "NSFR", regulator: "SAMA", frequency: "quarterly",
      titleEn: "NSFR Quarterly Return — Q2 2026", titleAr: "التقرير الربعي لنسبة التمويل المستقر — Q2 2026",
      dueDate: d(31), draftingStatus: "drafting", agentReadiness: 58,
      amountAed: null, ownerName: "Nora Al-Dosari", signRequired: true,
    },
    {
      id: "OPRISK-2026-Q2", code: "OPRISK", regulator: "SAMA", frequency: "quarterly",
      titleEn: "Operational Risk Loss Return — Q2 2026", titleAr: "تقرير خسائر مخاطر التشغيل — Q2 2026",
      dueDate: d(54), draftingStatus: "not-started", agentReadiness: 8,
      amountAed: 9_300_000, ownerName: "Reem Al-Harbi", signRequired: false,
    },
  ];
  for (const s of seed) {
    const due = new Date(s.dueDate).getTime();
    out.push({ ...s, daysToDue: Math.round((due - today) / (24 * 3600 * 1000)) });
  }
  return out;
}

export function buildSeedAuditEvents(): AuditEvent[] {
  const events: AuditEvent[] = [
    { id: "ev-001", timestamp: isoHoursAgo(0.5), agentId: "monitor", action: "ingest.bulletin",
      detailEn: "SAMA bulletin CRU-2026-04 parsed: 28 paragraphs → 14 obligations, 7 evidence-format changes.",
      detailAr: "تحليل نشرة CRU-2026-04: 28 فقرة → 14 التزاماً و7 تغييرات شكل أدلّة.",
      category: "ingest" },
    { id: "ev-002", timestamp: isoHoursAgo(0.4), agentId: "policy", action: "map.controls",
      detailEn: "Mapped 9 affected controls — 3 newly degraded (CR-014, CR-027, CR-082).",
      detailAr: "ربط 9 ضوابط متأثّرة — 3 منها متدهورة (CR-014 و CR-027 و CR-082).",
      category: "map", controlId: "CR-014" },
    { id: "ev-003", timestamp: isoHoursAgo(0.35), agentId: "memo", action: "draft.impact-memo",
      detailEn: "Drafted CRO impact memo (3 sections, 21-day remediation plan).",
      detailAr: "صياغة مذكّرة الأثر (3 أقسام، خطة معالجة 21 يوماً).",
      category: "draft" },
    { id: "ev-004", timestamp: isoHoursAgo(0.3), agentId: "evidence", action: "stage.evidence",
      detailEn: "Staged 47 audit-ready evidence artefacts on WORM bucket; coverage 9/9.",
      detailAr: "تجهيز 47 قطعة دليل على تخزين WORM؛ التغطية 9/9.",
      category: "evidence" },
    { id: "ev-005", timestamp: isoHoursAgo(2.1), agentId: "memo", action: "draft.return-section",
      detailEn: "Drafted Section 4 of QFR-2026-Q2 (Capital Adequacy commentary).",
      detailAr: "صياغة القسم 4 من QFR-2026-Q2 (تعليق كفاية رأس المال).",
      category: "draft" },
    { id: "ev-006", timestamp: isoHoursAgo(4.0), actorName: "Noura Al-Saif", actorRole: "CRO", action: "approve.recommendation",
      detailEn: "Noura approved Q1 Pillar-3 disclosure for filing.",
      detailAr: "اعتماد إفصاح الركيزة الثالثة Q1 للإيداع من قبل نورا.",
      category: "approve" },
    { id: "ev-007", timestamp: isoHoursAgo(7.5), agentId: "monitor", action: "ingest.bulletin",
      detailEn: "PDPL-2026-02 ingested: 16 paragraphs → 6 obligations.",
      detailAr: "استلام PDPL-2026-02: 16 فقرة → 6 التزامات.",
      category: "ingest" },
    { id: "ev-008", timestamp: isoDaysAgo(1, 8), actorName: "Noura Al-Saif", actorRole: "CRO", action: "override.threshold",
      detailEn: "Noura overrode agent recommendation on AML-MTR threshold (raised by 5%).",
      detailAr: "تجاوز توصية الوكيل لحدّ AML-MTR (رفعها بنسبة 5%).",
      category: "override" },
    { id: "ev-009", timestamp: isoDaysAgo(1, 14), agentId: "orch", action: "file.return",
      detailEn: "Filed AML circular 09-2026 attestation with SAMA (ref SAM-ATT-2026-09-441).",
      detailAr: "إيداع إقرار تعميم مكافحة غسل الأموال 09-2026 لدى ساما.",
      category: "file" },
    { id: "ev-010", timestamp: isoDaysAgo(2, 9), agentId: "policy", action: "map.controls",
      detailEn: "Re-tested CR-027 SaaS-inventory control — partial pass.",
      detailAr: "إعادة اختبار ضابط جرد SaaS — نجاح جزئي.",
      category: "map", controlId: "CR-027" },
    { id: "ev-011", timestamp: isoDaysAgo(3, 11), actorName: "Internal Audit", actorRole: "Audit", action: "approve.evidence",
      detailEn: "Internal Audit cleared evidence pack for AML 09-2026 filing.",
      detailAr: "إجازة التدقيق الداخلي لحزمة أدلّة AML 09-2026.",
      category: "approve" },
    { id: "ev-012", timestamp: isoDaysAgo(4, 16), agentId: "evidence", action: "stage.evidence",
      detailEn: "Refreshed evidence index for KYC obligations (122 artefacts).",
      detailAr: "تحديث فهرس أدلّة التزامات KYC (122 قطعة).",
      category: "evidence" },
    { id: "ev-013", timestamp: isoDaysAgo(5, 9), agentId: "memo", action: "draft.return-section",
      detailEn: "Drafted Pillar-3 Q1 disclosure narrative.",
      detailAr: "صياغة سرد إفصاح الركيزة الثالثة Q1.",
      category: "draft" },
    { id: "ev-014", timestamp: isoDaysAgo(6, 14), actorName: "Noura Al-Saif", actorRole: "CRO", action: "approve.return",
      detailEn: "Approved CMA Material-Event Disclosure for March.",
      detailAr: "اعتماد إفصاح الأحداث الجوهرية لشهر مارس.",
      category: "approve" },
    { id: "ev-015", timestamp: isoDaysAgo(7, 9), agentId: "orch", action: "file.return",
      detailEn: "Filed Pillar-3 Q1 disclosure with SAMA portal.",
      detailAr: "إيداع إفصاح الركيزة الثالثة Q1 عبر بوابة ساما.",
      category: "file" },
  ];
  return events;
}

export function buildParagraphTraces(): ParagraphTrace[] {
  return [
    {
      circularId: "CRU-2026-04",
      paragraph: "§4.1",
      textEn: "All privileged-access reviews shall be conducted on a monthly cadence, with attestations recorded against an immutable log.",
      textAr: "تُجرى مراجعات الصلاحيات الحسّاسة شهرياً مع تسجيل الإقرارات في سجلّ غير قابل للتغيير.",
      obligationIds: ["OBL-0001"], controlIds: ["CR-014"],
      evidenceLabelsEn: ["PAM monthly attestation log (Apr 2026)", "PAM exception register"],
      evidenceLabelsAr: ["سجلّ إقرار PAM الشهري (أبريل 2026)", "سجلّ استثناءات PAM"],
      isNew: true,
    },
    {
      circularId: "CRU-2026-04",
      paragraph: "§4.2",
      textEn: "Banks shall maintain an auto-discovered inventory of every SaaS connector touching customer data, attested weekly.",
      textAr: "تحتفظ البنوك بجرد آلي لكل موصل SaaS يلامس بيانات العميل، مع إقرار أسبوعي.",
      obligationIds: ["OBL-0002"], controlIds: ["CR-027"],
      evidenceLabelsEn: ["SaaS inventory snapshot (auto-discovery)", "Weekly attestation report W18"],
      evidenceLabelsAr: ["لقطة جرد SaaS (الاكتشاف الآلي)", "تقرير الإقرار الأسبوعي الأسبوع 18"],
      isNew: true,
    },
    {
      circularId: "CRU-2026-04",
      paragraph: "§4.3",
      textEn: "Identity-attestation cycles shall not exceed 90 days, down from the prior 180-day ceiling.",
      textAr: "لا تتجاوز دورات إقرار الهويّة 90 يوماً بدلاً من 180 يوماً سابقاً.",
      obligationIds: ["OBL-0003"], controlIds: ["CR-082"],
      evidenceLabelsEn: ["Identity attestation runs (Q1 2026)", "Joiners-movers-leavers reconciliation"],
      evidenceLabelsAr: ["تشغيلات إقرار الهويّة (Q1 2026)", "تسوية القادمين والمتنقلين والمغادرين"],
      isNew: true,
    },
    {
      circularId: "CRU-2026-04",
      paragraph: "§5.1",
      textEn: "Existing evidence-format requirements (PAM logs, attestation runs) reformatted to JSON-LD with SHA-256 hash.",
      textAr: "تُعاد صياغة متطلبات شكل الأدلّة (سجلّات PAM وتشغيلات الإقرار) إلى JSON-LD مع تجزئة SHA-256.",
      obligationIds: ["OBL-0004"], controlIds: ["CR-014", "CR-082"],
      evidenceLabelsEn: ["JSON-LD schema v2.4", "Existing evidence pack (re-hashed)"],
      evidenceLabelsAr: ["مخطط JSON-LD v2.4", "حزمة الأدلّة الحالية (إعادة تجزئة)"],
      isNew: false,
    },
    {
      circularId: "CRU-2026-04",
      paragraph: "§6.2",
      textEn: "Effective date 2026-06-02; banks shall file an attestation 7 days prior.",
      textAr: "تاريخ السريان 2026-06-02؛ تودِع البنوك إقراراً قبل ذلك بسبعة أيام.",
      obligationIds: ["OBL-0005"], controlIds: ["CR-014", "CR-027", "CR-082"],
      evidenceLabelsEn: ["Filing schedule + sign-off log"],
      evidenceLabelsAr: ["جدول الإيداع + سجلّ التوقيع"],
      isNew: true,
    },
    // PDPL-2026-02 — cross-border attestations
    {
      circularId: "PDPL-2026-02",
      paragraph: "§2.1",
      textEn: "Any controller transferring personal data outside the Kingdom shall attest the transfer quarterly with the lawful basis cited.",
      textAr: "يلتزم كل ضابط بيانات بنقل بيانات شخصية خارج المملكة بإيداع إقرار ربعي مع الاستناد القانوني.",
      obligationIds: [], controlIds: [],
      evidenceLabelsEn: ["Cross-border transfer register (Q1)", "Lawful-basis citations log"],
      evidenceLabelsAr: ["سجلّ النقل عبر الحدود (Q1)", "سجلّ الاستناد القانوني"],
      isNew: true,
    },
    {
      circularId: "PDPL-2026-02",
      paragraph: "§3.4",
      textEn: "Vendor data-processing agreements must enumerate sub-processors and the geographies they operate in.",
      textAr: "تحدّد اتفاقيات معالجة البيانات للموردين قائمة المعالجين الفرعيين والمناطق الجغرافية لتشغيلهم.",
      obligationIds: [], controlIds: [],
      evidenceLabelsEn: ["Vendor DPA register (refreshed)"],
      evidenceLabelsAr: ["سجلّ اتفاقيات DPA (محدّث)"],
      isNew: false,
    },
    // SAMA AML 09-2026
    {
      circularId: "SAMA-2026-AML-09",
      paragraph: "§5.2",
      textEn: "All wire transfers shall carry full beneficiary fields per FATF Recommendation 16; partial fields trigger an automatic hold.",
      textAr: "تحمل جميع الحوالات حقول المستفيد كاملة وفق توصية FATF 16؛ النقص يُفعّل تعليقاً تلقائياً.",
      obligationIds: [], controlIds: [],
      evidenceLabelsEn: ["Wire payload completeness report (Mar–Apr)", "Automatic-hold release log"],
      evidenceLabelsAr: ["تقرير اكتمال حمولة الحوالات (مارس–أبريل)", "سجلّ رفع التعليق التلقائي"],
      isNew: false,
    },
  ];
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const NOW_ANCHOR = new Date("2026-05-05T09:00:00Z");

export function isoDaysAgo(days: number, hours = 9): string {
  const dt = new Date(NOW_ANCHOR);
  dt.setUTCDate(dt.getUTCDate() - days);
  dt.setUTCHours(hours, 0, 0, 0);
  return dt.toISOString();
}

export function isoHoursAgo(hours: number): string {
  return new Date(NOW_ANCHOR.getTime() - hours * 3600 * 1000).toISOString();
}

export function ragColor(rag: RagStatus): string {
  return rag === "green" ? "#10B981" : rag === "amber" ? "#F59E0B" : "#E30613";
}

export function ragBg(rag: RagStatus): string {
  return rag === "green" ? "bg-emerald-100 text-emerald-700" :
    rag === "amber" ? "bg-amber-100 text-amber-700" :
    "bg-red-100 text-red-700";
}

export function relativeTime(iso: string, lang: Lang): string {
  const ms = NOW_ANCHOR.getTime() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(ms / 60000));
  if (mins < 60) return lang === "ar" ? `قبل ${mins} د` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return lang === "ar" ? `قبل ${hrs} س` : `${hrs}h ago`;
  const d = Math.round(hrs / 24);
  return lang === "ar" ? `قبل ${d} يوم` : `${d}d ago`;
}

export function formatAed(amount: number | null, lang: Lang): string {
  if (amount == null) return "—";
  const m = amount >= 1_000_000_000 ? `${(amount / 1_000_000_000).toFixed(1)}B` :
    amount >= 1_000_000 ? `${(amount / 1_000_000).toFixed(1)}M` :
    amount.toLocaleString();
  return lang === "ar" ? `${m} ر.س` : `SAR ${m}`;
}
