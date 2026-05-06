import type { BiText } from "@/lib/sim/types";

export type Rag = "red" | "amber" | "green";

export interface Milestone {
  id: string;
  label: BiText;
  due: string;
  status: "done" | "at-risk" | "planned" | "slipping";
}

export interface Programme {
  id: string;
  name: BiText;
  sponsor: BiText;
  vendor: BiText;
  rag: Rag;
  ragLastWeek: Rag;
  pctComplete: number;
  slipDays: number;
  weeklySlipDelta: number;
  budgetAed: number;
  spentAed: number;
  contingencyAed: number;
  contingencyBurnedAed: number;
  silentSlip: boolean;
  milestones: Milestone[];
  blockingIssue?: BiText;
  blockingParty?: BiText;
}

export interface Dependency {
  fromId: string;
  toId: string;
  label: BiText;
  critical: boolean;
}

export const PROGRAMMES: Programme[] = [
  {
    id: "erp-oracle",
    name: { en: "Oracle ERP rollout", ar: "تطبيق Oracle ERP" },
    sponsor: { en: "CFO · A. Al Mansoori", ar: "المدير المالي · أ. المنصوري" },
    vendor: { en: "Oracle GCC + IBM iX", ar: "Oracle الخليج + IBM iX" },
    rag: "red", ragLastWeek: "amber",
    pctComplete: 62, slipDays: 28, weeklySlipDelta: 14,
    budgetAed: 38_400_000, spentAed: 24_900_000,
    contingencyAed: 6_400_000, contingencyBurnedAed: 4_100_000,
    silentSlip: false,
    blockingIssue: { en: "Vendor data-migration patch v2.4 failed UAT round 3", ar: "فشل تصحيح هجرة البيانات v2.4 في الجولة الثالثة من UAT" },
    blockingParty: { en: "Oracle GCC delivery", ar: "تسليم Oracle الخليج" },
    milestones: [
      { id: "m1", label: { en: "Finance module UAT", ar: "اختبار وحدة المالية" }, due: "2026-04-22", status: "done" },
      { id: "m2", label: { en: "Data migration cutover", ar: "تحويل هجرة البيانات" }, due: "2026-05-18", status: "slipping" },
      { id: "m3", label: { en: "HCM go-live", ar: "إطلاق HCM" }, due: "2026-06-30", status: "at-risk" },
      { id: "m4", label: { en: "Procurement go-live", ar: "إطلاق المشتريات" }, due: "2026-08-15", status: "planned" },
    ],
  },
  {
    id: "customer360",
    name: { en: "Customer 360", ar: "العميل 360" },
    sponsor: { en: "CCO · L. Habib", ar: "مدير العملاء · ل. حبيب" },
    vendor: { en: "Salesforce + Accenture", ar: "Salesforce + Accenture" },
    rag: "amber", ragLastWeek: "green",
    pctComplete: 48, slipDays: 18, weeklySlipDelta: 10,
    budgetAed: 22_100_000, spentAed: 11_300_000,
    contingencyAed: 3_300_000, contingencyBurnedAed: 1_650_000,
    silentSlip: false,
    blockingIssue: { en: "Awaiting ERP customer-master cutover", ar: "بانتظار تحويل العملاء من ERP" },
    blockingParty: { en: "Oracle ERP programme", ar: "برنامج Oracle ERP" },
    milestones: [
      { id: "m1", label: { en: "Identity stitching", ar: "ربط الهويات" }, due: "2026-04-30", status: "done" },
      { id: "m2", label: { en: "ERP master sync", ar: "مزامنة سجلات ERP" }, due: "2026-05-25", status: "slipping" },
      { id: "m3", label: { en: "Wave-1 contact centre cutover", ar: "تحويل مركز الاتصال الموجة 1" }, due: "2026-07-12", status: "at-risk" },
    ],
  },
  {
    id: "network-mod",
    name: { en: "Network Modernisation", ar: "تحديث الشبكة" },
    sponsor: { en: "CTO · S. Al Hashimi", ar: "المدير التقني · س. الهاشمي" },
    vendor: { en: "Nokia + Ericsson", ar: "Nokia + Ericsson" },
    rag: "amber", ragLastWeek: "amber",
    pctComplete: 55, slipDays: 12, weeklySlipDelta: 6,
    budgetAed: 64_800_000, spentAed: 36_500_000,
    contingencyAed: 8_900_000, contingencyBurnedAed: 2_100_000,
    silentSlip: false,
    blockingIssue: { en: "Awaiting ERP asset-master for site-cost reporting", ar: "بانتظار سجل الأصول من ERP" },
    blockingParty: { en: "Oracle ERP programme", ar: "برنامج Oracle ERP" },
    milestones: [
      { id: "m1", label: { en: "Core IP backbone uplift", ar: "ترقية شبكة IP الأساسية" }, due: "2026-04-10", status: "done" },
      { id: "m2", label: { en: "Edge router refresh — wave 2", ar: "تحديث موجّهات الحافّة الموجة 2" }, due: "2026-06-05", status: "at-risk" },
      { id: "m3", label: { en: "Northern region cutover", ar: "تحويل المنطقة الشمالية" }, due: "2026-08-20", status: "planned" },
    ],
  },
  {
    id: "five-g",
    name: { en: "5G SA rollout", ar: "إطلاق 5G المستقل" },
    sponsor: { en: "CTO · S. Al Hashimi", ar: "المدير التقني · س. الهاشمي" },
    vendor: { en: "Huawei + Ericsson", ar: "Huawei + Ericsson" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 71, slipDays: 0, weeklySlipDelta: 0,
    budgetAed: 86_500_000, spentAed: 58_000_000,
    contingencyAed: 9_200_000, contingencyBurnedAed: 1_400_000,
    silentSlip: false,
    milestones: [
      { id: "m1", label: { en: "Phase-2 site activation", ar: "تنشيط المواقع المرحلة 2" }, due: "2026-05-20", status: "planned" },
    ],
  },
  {
    id: "fttx",
    name: { en: "Fibre FTTx expansion", ar: "توسعة الألياف FTTx" },
    sponsor: { en: "COO · R. Bin Zayed", ar: "مدير العمليات · ر. بن زايد" },
    vendor: { en: "ZTE + local crews", ar: "ZTE + فرق محليّة" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 64, slipDays: 0, weeklySlipDelta: 0,
    budgetAed: 41_200_000, spentAed: 26_300_000,
    contingencyAed: 5_400_000, contingencyBurnedAed: 800_000,
    silentSlip: false,
    milestones: [
      { id: "m1", label: { en: "Sharjah district pass", ar: "تمرير منطقة الشارقة" }, due: "2026-06-15", status: "planned" },
    ],
  },
  {
    id: "core-billing",
    name: { en: "Core billing refresh", ar: "تحديث نظام الفوترة" },
    sponsor: { en: "CFO · A. Al Mansoori", ar: "المدير المالي · أ. المنصوري" },
    vendor: { en: "Amdocs", ar: "Amdocs" },
    rag: "amber", ragLastWeek: "amber",
    pctComplete: 53, slipDays: 7, weeklySlipDelta: 2,
    budgetAed: 29_700_000, spentAed: 16_200_000,
    contingencyAed: 4_100_000, contingencyBurnedAed: 1_700_000,
    silentSlip: false,
    blockingIssue: { en: "ERP general-ledger interface contract pending", ar: "عقد ربط دفتر الأستاذ مع ERP معلّق" },
    blockingParty: { en: "Oracle ERP programme", ar: "برنامج Oracle ERP" },
    milestones: [
      { id: "m1", label: { en: "Tariff engine cutover", ar: "تحويل محرك التعرفة" }, due: "2026-07-01", status: "at-risk" },
    ],
  },
  {
    id: "omnichannel",
    name: { en: "Omnichannel care", ar: "خدمة متعدّدة القنوات" },
    sponsor: { en: "CCO · L. Habib", ar: "مدير العملاء · ل. حبيب" },
    vendor: { en: "Genesys + Cognizant", ar: "Genesys + Cognizant" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 58, slipDays: 2, weeklySlipDelta: 1,
    budgetAed: 18_400_000, spentAed: 9_800_000,
    contingencyAed: 2_700_000, contingencyBurnedAed: 320_000,
    silentSlip: false,
    milestones: [
      { id: "m1", label: { en: "WhatsApp BSP integration", ar: "ربط مزوّد واتساب" }, due: "2026-06-08", status: "planned" },
    ],
  },
  {
    id: "data-foundation",
    name: { en: "Data foundation", ar: "أُسس البيانات" },
    sponsor: { en: "CDO · L. Otieno", ar: "مدير البيانات · ل. أوتيينو" },
    vendor: { en: "Databricks + EY", ar: "Databricks + EY" },
    rag: "red", ragLastWeek: "red",
    pctComplete: 41, slipDays: 22, weeklySlipDelta: 4,
    budgetAed: 31_000_000, spentAed: 14_200_000,
    contingencyAed: 4_900_000, contingencyBurnedAed: 3_600_000,
    silentSlip: false,
    blockingIssue: { en: "Lineage gap on 3 source systems blocking Wave-2 reporting", ar: "ثغرة نسب على 3 أنظمة تعطّل تقارير الموجة 2" },
    blockingParty: { en: "Internal — DataOps", ar: "داخلي — DataOps" },
    milestones: [
      { id: "m1", label: { en: "Lineage sprint close", ar: "إغلاق موجة النسب" }, due: "2026-05-28", status: "at-risk" },
      { id: "m2", label: { en: "Wave-2 reporting cutover", ar: "تحويل التقارير الموجة 2" }, due: "2026-07-15", status: "slipping" },
    ],
  },
  {
    id: "cybersec",
    name: { en: "Cyber security uplift", ar: "ترقية الأمن السيبراني" },
    sponsor: { en: "CISO · M. Saleh", ar: "مدير أمن المعلومات · م. صالح" },
    vendor: { en: "Palo Alto + Deloitte", ar: "Palo Alto + Deloitte" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 78, slipDays: 0, weeklySlipDelta: -1,
    budgetAed: 17_800_000, spentAed: 12_400_000,
    contingencyAed: 2_100_000, contingencyBurnedAed: 280_000,
    silentSlip: false,
    milestones: [
      { id: "m1", label: { en: "ZTNA rollout — corporate", ar: "إطلاق ZTNA — الشركات" }, due: "2026-05-30", status: "planned" },
    ],
  },
  {
    id: "cloud-mig",
    name: { en: "Cloud landing zone", ar: "المنطقة السحابية" },
    sponsor: { en: "CTO · S. Al Hashimi", ar: "المدير التقني · س. الهاشمي" },
    vendor: { en: "AWS + PwC", ar: "AWS + PwC" },
    rag: "amber", ragLastWeek: "amber",
    pctComplete: 49, slipDays: 9, weeklySlipDelta: 3,
    budgetAed: 24_600_000, spentAed: 11_900_000,
    contingencyAed: 3_500_000, contingencyBurnedAed: 1_200_000,
    silentSlip: false,
    blockingIssue: { en: "Awaiting CCoE sovereign-region sign-off", ar: "بانتظار موافقة مركز التميّز للمنطقة السيادية" },
    blockingParty: { en: "Internal — CCoE", ar: "داخلي — CCoE" },
    milestones: [
      { id: "m1", label: { en: "Landing zone hardening", ar: "تصليب المنطقة السحابية" }, due: "2026-06-12", status: "planned" },
    ],
  },
  {
    id: "ai-productivity",
    name: { en: "AI productivity rollout", ar: "إطلاق إنتاجية الذكاء" },
    sponsor: { en: "CHRO · R. Doumit", ar: "مديرة الموارد البشرية · ر. دوميت" },
    vendor: { en: "Microsoft + KPMG", ar: "Microsoft + KPMG" },
    rag: "amber", ragLastWeek: "green",
    pctComplete: 38, slipDays: 6, weeklySlipDelta: 6,
    budgetAed: 9_400_000, spentAed: 3_100_000,
    contingencyAed: 1_300_000, contingencyBurnedAed: 220_000,
    silentSlip: true,
    blockingIssue: { en: "Licence true-up + Data Foundation lineage prerequisite", ar: "تسوية الرخص + اعتمادية أُسس البيانات" },
    blockingParty: { en: "Microsoft + Data Foundation", ar: "Microsoft + أُسس البيانات" },
    milestones: [
      { id: "m1", label: { en: "Wave-1 Copilot rollout", ar: "موجة 1 لإطلاق Copilot" }, due: "2026-06-20", status: "planned" },
    ],
  },
  {
    id: "esg",
    name: { en: "ESG reporting", ar: "تقارير ESG" },
    sponsor: { en: "CSO · P. Murthy", ar: "مدير الاستدامة · ب. مورثي" },
    vendor: { en: "SAP + EY", ar: "SAP + EY" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 67, slipDays: 0, weeklySlipDelta: 0,
    budgetAed: 6_800_000, spentAed: 4_100_000,
    contingencyAed: 900_000, contingencyBurnedAed: 90_000,
    silentSlip: false,
    milestones: [
      { id: "m1", label: { en: "Scope-3 emissions ingestion", ar: "استيعاب انبعاثات النطاق 3" }, due: "2026-06-30", status: "planned" },
    ],
  },
  {
    id: "b2b-portal",
    name: { en: "B2B self-service portal", ar: "بوابة الخدمة الذاتية للأعمال" },
    sponsor: { en: "CBO · F. Al Khouri", ar: "مدير الأعمال · ف. الخوري" },
    vendor: { en: "Adobe + LTIMindtree", ar: "Adobe + LTIMindtree" },
    rag: "amber", ragLastWeek: "amber",
    pctComplete: 44, slipDays: 5, weeklySlipDelta: 2,
    budgetAed: 12_200_000, spentAed: 5_900_000,
    contingencyAed: 1_700_000, contingencyBurnedAed: 480_000,
    silentSlip: false,
    blockingIssue: { en: "Customer 360 identity API not yet exposed", ar: "واجهة الهوية من Customer 360 لم تُفعّل" },
    blockingParty: { en: "Customer 360 programme", ar: "برنامج Customer 360" },
    milestones: [
      { id: "m1", label: { en: "Wave-1 enterprise pilots", ar: "تجارب الموجة 1 للشركات" }, due: "2026-07-22", status: "at-risk" },
    ],
  },
  {
    id: "talent",
    name: { en: "Talent platform", ar: "منصّة المواهب" },
    sponsor: { en: "CHRO · R. Doumit", ar: "مديرة الموارد البشرية · ر. دوميت" },
    vendor: { en: "Workday + Mercer", ar: "Workday + Mercer" },
    rag: "green", ragLastWeek: "green",
    pctComplete: 73, slipDays: 1, weeklySlipDelta: 1,
    budgetAed: 8_300_000, spentAed: 5_400_000,
    contingencyAed: 1_100_000, contingencyBurnedAed: 110_000,
    silentSlip: true,
    milestones: [
      { id: "m1", label: { en: "Performance module go-live", ar: "إطلاق وحدة الأداء" }, due: "2026-06-18", status: "planned" },
    ],
  },
];

export const DEPENDENCIES: Dependency[] = [
  { fromId: "erp-oracle", toId: "customer360", critical: true, label: { en: "Customer master data", ar: "سجل العملاء الرئيسي" } },
  { fromId: "erp-oracle", toId: "network-mod", critical: true, label: { en: "Asset master + cost centres", ar: "سجل الأصول ومراكز التكلفة" } },
  { fromId: "erp-oracle", toId: "core-billing", critical: true, label: { en: "GL interface contract", ar: "عقد ربط دفتر الأستاذ" } },
  { fromId: "customer360", toId: "omnichannel", critical: false, label: { en: "Identity API", ar: "واجهة الهوية" } },
  { fromId: "customer360", toId: "b2b-portal", critical: true, label: { en: "Identity API", ar: "واجهة الهوية" } },
  { fromId: "network-mod", toId: "five-g", critical: false, label: { en: "Backhaul capacity", ar: "سعة النقل الخلفي" } },
  { fromId: "network-mod", toId: "fttx", critical: false, label: { en: "Edge router refresh", ar: "تحديث الموجّهات" } },
  { fromId: "data-foundation", toId: "customer360", critical: true, label: { en: "Lineage of contact data", ar: "نسب بيانات الاتصال" } },
  { fromId: "data-foundation", toId: "ai-productivity", critical: true, label: { en: "Document-AI source data", ar: "بيانات الذكاء التوليدي" } },
  { fromId: "data-foundation", toId: "esg", critical: false, label: { en: "Scope-3 lineage", ar: "نسب النطاق 3" } },
  { fromId: "cloud-mig", toId: "erp-oracle", critical: false, label: { en: "Sovereign region", ar: "منطقة سيادية" } },
  { fromId: "cloud-mig", toId: "ai-productivity", critical: false, label: { en: "Compute landing zone", ar: "منطقة الحوسبة" } },
  { fromId: "cybersec", toId: "cloud-mig", critical: false, label: { en: "ZTNA controls", ar: "ضوابط ZTNA" } },
  { fromId: "cybersec", toId: "b2b-portal", critical: false, label: { en: "Identity hardening", ar: "تصليب الهوية" } },
  { fromId: "talent", toId: "ai-productivity", critical: false, label: { en: "Skills taxonomy", ar: "تصنيف المهارات" } },
  { fromId: "core-billing", toId: "b2b-portal", critical: false, label: { en: "Invoice service", ar: "خدمة الفواتير" } },
  { fromId: "esg", toId: "core-billing", critical: false, label: { en: "Tariff data", ar: "بيانات التعرفة" } },
  { fromId: "omnichannel", toId: "b2b-portal", critical: false, label: { en: "Care SDK", ar: "SDK للخدمة" } },
];

export const DEPENDENCY_NODE_POSITIONS: Record<string, { x: number; y: number }> = {
  "data-foundation": { x: 80, y: 80 },
  "cloud-mig": { x: 80, y: 200 },
  "cybersec": { x: 80, y: 320 },
  "erp-oracle": { x: 320, y: 200 },
  "talent": { x: 320, y: 60 },
  "ai-productivity": { x: 320, y: 360 },
  "customer360": { x: 560, y: 120 },
  "network-mod": { x: 560, y: 220 },
  "core-billing": { x: 560, y: 320 },
  "esg": { x: 560, y: 420 },
  "omnichannel": { x: 800, y: 80 },
  "b2b-portal": { x: 800, y: 200 },
  "five-g": { x: 800, y: 300 },
  "fttx": { x: 800, y: 400 },
};

export function programmeById(id: string): Programme | undefined {
  return PROGRAMMES.find((p) => p.id === id);
}

export function bi(p: Programme | undefined, lang: "en" | "ar"): string {
  if (!p) return "";
  return p.name[lang];
}

export function fmtAed(n: number, lang: "en" | "ar"): string {
  if (n >= 1_000_000) return `${lang === "ar" ? "" : "AED "}${(n / 1_000_000).toFixed(1)}M${lang === "ar" ? " د.إ" : ""}`;
  if (n >= 1_000) return `${lang === "ar" ? "" : "AED "}${(n / 1_000).toFixed(0)}K${lang === "ar" ? " د.إ" : ""}`;
  return `${lang === "ar" ? "" : "AED "}${n}${lang === "ar" ? " د.إ" : ""}`;
}
