import type { BiText } from "@/lib/sim/types";

export type Classification = "public" | "internal" | "sensitive" | "restricted";
export type ProductStatus = "active" | "pending" | "draft" | "blocked" | "deprecated";
export type Residency = "in-kingdom" | "gcc-only" | "eu-allowed" | "global";
export type Domain =
  | "citizen-services"
  | "tax-revenue"
  | "health"
  | "education"
  | "transport"
  | "energy"
  | "public-safety"
  | "workforce"
  | "social"
  | "finance"
  | "ai-foundations"
  | "infra";

export interface DataProduct {
  id: string;
  name: BiText;
  domain: Domain;
  classification: Classification;
  status: ProductStatus;
  residency: Residency;
  owner: BiText;
  ownerOrg: BiText;
  freshnessMin: number;
  rowsK: number;
  lineageCoverage: number;
  pdplPass: number;
  pdplTotal: number;
  blockedSinks: number;
  contractRefresh: BiText;
  contractCompleteness: string;
  contractLatency: BiText;
  contractRetention: BiText;
  isScenarioActive?: boolean;
}

export const DOMAIN_LABEL: Record<Domain, BiText> = {
  "citizen-services": { en: "Citizen Services", ar: "خدمات المواطنين" },
  "tax-revenue": { en: "Tax & Revenue", ar: "الضرائب والإيرادات" },
  health: { en: "Health", ar: "الصحة" },
  education: { en: "Education", ar: "التعليم" },
  transport: { en: "Transport", ar: "النقل" },
  energy: { en: "Energy", ar: "الطاقة" },
  "public-safety": { en: "Public Safety", ar: "السلامة العامة" },
  workforce: { en: "Workforce", ar: "القوى العاملة" },
  social: { en: "Social", ar: "الاجتماعي" },
  finance: { en: "Public Finance", ar: "المالية العامة" },
  "ai-foundations": { en: "AI Foundations", ar: "أُسس الذكاء" },
  infra: { en: "Infrastructure", ar: "البنية التحتية" },
};

const ministryCx: BiText = { en: "Ministry CX", ar: "وزارة تجربة المتعامل" };
const zatca: BiText = { en: "ZATCA", ar: "هيئة الزكاة والضريبة" };
const moh: BiText = { en: "MoH", ar: "وزارة الصحة" };
const moe: BiText = { en: "MoE", ar: "وزارة التعليم" };
const mot: BiText = { en: "MoT", ar: "وزارة النقل" };
const moenergy: BiText = { en: "MoEnergy", ar: "وزارة الطاقة" };
const moi: BiText = { en: "MoI", ar: "وزارة الداخلية" };
const hrsd: BiText = { en: "HRSD", ar: "وزارة الموارد البشرية" };
const sdaia: BiText = { en: "SDAIA", ar: "هيئة البيانات والذكاء" };
const mof: BiText = { en: "MoF", ar: "وزارة المالية" };

function p(en: string, ar: string): BiText { return { en, ar }; }

export const DATA_PRODUCTS: DataProduct[] = [
  // ── ACTIVE SCENARIO PRODUCT ──
  {
    id: "citizen-sentiment-dashboard",
    name: p("Citizen Sentiment Dashboard", "لوحة مشاعر المواطنين"),
    domain: "citizen-services", classification: "sensitive", status: "pending",
    residency: "in-kingdom",
    owner: p("Layla Al-Otaibi", "ليلى العتيبي"), ownerOrg: ministryCx,
    freshnessMin: 15, rowsK: 14, lineageCoverage: 100, pdplPass: 14, pdplTotal: 14, blockedSinks: 1,
    contractRefresh: p("15 minutes", "15 دقيقة"), contractCompleteness: "99%",
    contractLatency: p("< 5 min", "أقل من 5 دقائق"),
    contractRetention: p("90 days hot · 2 years archive", "90 يوماً حار · سنتان أرشيف"),
    isScenarioActive: true,
  },
  // ── Citizen services (5 more) ──
  { id: "tawakkalna-incidents", name: p("Tawakkalna Incident Stream", "تدفق حوادث توكلنا"), domain: "citizen-services", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Hessa Al-Dossari", "حصة الدوسري"), ownerOrg: ministryCx, freshnessMin: 5, rowsK: 412, lineageCoverage: 96, pdplPass: 12, pdplTotal: 12, blockedSinks: 2, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "99.5%", contractLatency: p("< 2 min", "أقل من دقيقتين"), contractRetention: p("180 days", "180 يوماً") },
  { id: "absher-throughput", name: p("Absher Throughput Metrics", "مؤشرات أبشر"), domain: "citizen-services", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Khaled Al-Suhaibani", "خالد السهيباني"), ownerOrg: moi, freshnessMin: 60, rowsK: 1820, lineageCoverage: 91, pdplPass: 9, pdplTotal: 10, blockedSinks: 0, contractRefresh: p("1 hour", "ساعة"), contractCompleteness: "98%", contractLatency: p("< 30 min", "أقل من 30 دقيقة"), contractRetention: p("365 days", "سنة") },
  { id: "complaint-router", name: p("National Complaint Router", "موجّه الشكاوى الوطني"), domain: "citizen-services", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Reem Al-Shehri", "ريم الشهري"), ownerOrg: ministryCx, freshnessMin: 10, rowsK: 88, lineageCoverage: 100, pdplPass: 13, pdplTotal: 13, blockedSinks: 0, contractRefresh: p("10 min", "10 دقائق"), contractCompleteness: "99%", contractLatency: p("< 5 min", "أقل من 5 دقائق"), contractRetention: p("3 years", "3 سنوات") },
  { id: "service-csat", name: p("Service CSAT Index", "مؤشر رضا الخدمة"), domain: "citizen-services", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Fahad Al-Mutairi", "فهد المطيري"), ownerOrg: ministryCx, freshnessMin: 1440, rowsK: 6, lineageCoverage: 88, pdplPass: 7, pdplTotal: 8, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "97%", contractLatency: p("< 24h", "أقل من 24س"), contractRetention: p("5 years", "5 سنوات") },
  { id: "appointment-availability", name: p("Appointment Availability Feed", "تدفق المواعيد المتاحة"), domain: "citizen-services", classification: "public", status: "active", residency: "global", owner: p("Sara Al-Ghamdi", "سارة الغامدي"), ownerOrg: ministryCx, freshnessMin: 5, rowsK: 240, lineageCoverage: 100, pdplPass: 4, pdplTotal: 4, blockedSinks: 0, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "99%", contractLatency: p("< 2 min", "أقل من دقيقتين"), contractRetention: p("30 days", "30 يوماً") },
  // ── Tax/Revenue (4) ──
  { id: "vat-realtime", name: p("VAT Realtime Stream", "تدفق ضريبة القيمة المضافة"), domain: "tax-revenue", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Abdulrahman Al-Harbi", "عبدالرحمن الحربي"), ownerOrg: zatca, freshnessMin: 1, rowsK: 9_400, lineageCoverage: 100, pdplPass: 18, pdplTotal: 18, blockedSinks: 3, contractRefresh: p("1 min", "دقيقة"), contractCompleteness: "99.9%", contractLatency: p("< 30s", "أقل من 30 ثانية"), contractRetention: p("10 years", "10 سنوات") },
  { id: "zakat-filings", name: p("Zakat Filings Catalogue", "كتالوج إقرارات الزكاة"), domain: "tax-revenue", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Mona Al-Zahrani", "منى الزهراني"), ownerOrg: zatca, freshnessMin: 1440, rowsK: 1_120, lineageCoverage: 95, pdplPass: 16, pdplTotal: 16, blockedSinks: 1, contractRefresh: p("Daily", "يومي"), contractCompleteness: "99%", contractLatency: p("< 4h", "أقل من 4س"), contractRetention: p("10 years", "10 سنوات") },
  { id: "customs-clearance", name: p("Customs Clearance Events", "أحداث التخليص الجمركي"), domain: "tax-revenue", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Yousef Al-Qahtani", "يوسف القحطاني"), ownerOrg: zatca, freshnessMin: 15, rowsK: 320, lineageCoverage: 94, pdplPass: 11, pdplTotal: 12, blockedSinks: 1, contractRefresh: p("15 min", "15 دقيقة"), contractCompleteness: "99%", contractLatency: p("< 10 min", "أقل من 10 دقائق"), contractRetention: p("7 years", "7 سنوات") },
  { id: "e-invoice-fatoora", name: p("Fatoora e-Invoice Master", "السجل الرئيسي لفاتورة"), domain: "tax-revenue", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Norah Bin Salem", "نورة بن سالم"), ownerOrg: zatca, freshnessMin: 5, rowsK: 18_200, lineageCoverage: 100, pdplPass: 20, pdplTotal: 20, blockedSinks: 4, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "99.95%", contractLatency: p("< 1 min", "أقل من دقيقة"), contractRetention: p("10 years", "10 سنوات") },
  // ── Health (4) ──
  { id: "ehr-encounter-fact", name: p("EHR Encounter Fact Table", "جدول حقائق سجل المريض"), domain: "health", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Dr. Aisha Al-Mansour", "د. عائشة المنصور"), ownerOrg: moh, freshnessMin: 60, rowsK: 4_800, lineageCoverage: 92, pdplPass: 22, pdplTotal: 22, blockedSinks: 5, contractRefresh: p("1 hour", "ساعة"), contractCompleteness: "99.5%", contractLatency: p("< 15 min", "أقل من 15 دقيقة"), contractRetention: p("25 years", "25 سنة") },
  { id: "hajj-health-screen", name: p("Hajj Health Screening", "الفحص الصحي للحج"), domain: "health", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Dr. Omar Al-Sulaiman", "د. عمر السليمان"), ownerOrg: moh, freshnessMin: 30, rowsK: 612, lineageCoverage: 100, pdplPass: 14, pdplTotal: 14, blockedSinks: 1, contractRefresh: p("30 min", "30 دقيقة"), contractCompleteness: "99%", contractLatency: p("< 5 min", "أقل من 5 دقائق"), contractRetention: p("7 years", "7 سنوات") },
  { id: "vaccination-coverage", name: p("Vaccination Coverage", "تغطية التطعيم"), domain: "health", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Dr. Hadeel Al-Faisal", "د. هديل الفيصل"), ownerOrg: moh, freshnessMin: 1440, rowsK: 240, lineageCoverage: 88, pdplPass: 10, pdplTotal: 11, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "98%", contractLatency: p("< 6h", "أقل من 6س"), contractRetention: p("10 years", "10 سنوات") },
  { id: "telemed-utilization", name: p("Telemedicine Utilization", "استخدام الطب عن بُعد"), domain: "health", classification: "sensitive", status: "draft", residency: "in-kingdom", owner: p("Dr. Bandar Al-Otaibi", "د. بندر العتيبي"), ownerOrg: moh, freshnessMin: 1440, rowsK: 90, lineageCoverage: 65, pdplPass: 8, pdplTotal: 12, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "—", contractLatency: p("—", "—"), contractRetention: p("7 years", "7 سنوات") },
  // ── Education (3) ──
  { id: "schools-attendance", name: p("Schools Attendance Stream", "تدفق حضور المدارس"), domain: "education", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Dr. Tariq Al-Subaie", "د. طارق السبيعي"), ownerOrg: moe, freshnessMin: 240, rowsK: 1_920, lineageCoverage: 94, pdplPass: 13, pdplTotal: 13, blockedSinks: 1, contractRefresh: p("4 hours", "4 ساعات"), contractCompleteness: "98%", contractLatency: p("< 1h", "أقل من ساعة"), contractRetention: p("10 years", "10 سنوات") },
  { id: "national-exam-results", name: p("National Exam Results", "نتائج الاختبار الوطني"), domain: "education", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Maha Al-Qassem", "مها القاسم"), ownerOrg: moe, freshnessMin: 43_200, rowsK: 380, lineageCoverage: 100, pdplPass: 15, pdplTotal: 15, blockedSinks: 2, contractRefresh: p("Yearly", "سنوي"), contractCompleteness: "100%", contractLatency: p("< 24h", "أقل من 24س"), contractRetention: p("Permanent", "دائم") },
  { id: "scholarship-portfolio", name: p("Scholarship Portfolio", "محفظة الابتعاث"), domain: "education", classification: "internal", status: "active", residency: "gcc-only", owner: p("Faisal Al-Ahmadi", "فيصل الأحمدي"), ownerOrg: moe, freshnessMin: 1440, rowsK: 42, lineageCoverage: 86, pdplPass: 9, pdplTotal: 10, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "97%", contractLatency: p("< 12h", "أقل من 12س"), contractRetention: p("15 years", "15 سنة") },
  // ── Transport (3) ──
  { id: "metro-ridership", name: p("Riyadh Metro Ridership", "ركّاب مترو الرياض"), domain: "transport", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Salem Al-Rasheed", "سالم الرشيد"), ownerOrg: mot, freshnessMin: 5, rowsK: 720, lineageCoverage: 96, pdplPass: 7, pdplTotal: 8, blockedSinks: 0, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "99%", contractLatency: p("< 2 min", "أقل من دقيقتين"), contractRetention: p("3 years", "3 سنوات") },
  { id: "highway-incidents", name: p("Highway Incident Feed", "تدفق حوادث الطرق"), domain: "transport", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Mohammed Al-Anazi", "محمد العنزي"), ownerOrg: mot, freshnessMin: 1, rowsK: 18, lineageCoverage: 100, pdplPass: 6, pdplTotal: 6, blockedSinks: 0, contractRefresh: p("1 min", "دقيقة"), contractCompleteness: "99%", contractLatency: p("< 30s", "أقل من 30ث"), contractRetention: p("3 years", "3 سنوات") },
  { id: "logistics-corridor", name: p("Logistics Corridor Throughput", "إنتاجية ممر اللوجستيات"), domain: "transport", classification: "sensitive", status: "draft", residency: "in-kingdom", owner: p("Hatim Al-Asiri", "حاتم العسيري"), ownerOrg: mot, freshnessMin: 1440, rowsK: 220, lineageCoverage: 62, pdplPass: 5, pdplTotal: 9, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "—", contractLatency: p("—", "—"), contractRetention: p("5 years", "5 سنوات") },
  // ── Energy (2) ──
  { id: "grid-load", name: p("National Grid Load", "حمل الشبكة الوطنية"), domain: "energy", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Bader Al-Sheikh", "بدر الشيخ"), ownerOrg: moenergy, freshnessMin: 1, rowsK: 1_440, lineageCoverage: 98, pdplPass: 6, pdplTotal: 6, blockedSinks: 0, contractRefresh: p("1 min", "دقيقة"), contractCompleteness: "99.5%", contractLatency: p("< 1 min", "أقل من دقيقة"), contractRetention: p("5 years", "5 سنوات") },
  { id: "renewables-output", name: p("Renewables Output", "إنتاج المتجدّدة"), domain: "energy", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Khalid Al-Najjar", "خالد النجار"), ownerOrg: moenergy, freshnessMin: 15, rowsK: 96, lineageCoverage: 100, pdplPass: 5, pdplTotal: 5, blockedSinks: 0, contractRefresh: p("15 min", "15 دقيقة"), contractCompleteness: "99%", contractLatency: p("< 5 min", "أقل من 5 دقائق"), contractRetention: p("10 years", "10 سنوات") },
  // ── Public safety (2) ──
  { id: "incident-cad", name: p("CAD Incident Stream", "تدفق حوادث CAD"), domain: "public-safety", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Capt. Talal Al-Dosari", "النقيب طلال الدوسري"), ownerOrg: moi, freshnessMin: 1, rowsK: 64, lineageCoverage: 100, pdplPass: 16, pdplTotal: 16, blockedSinks: 4, contractRefresh: p("1 min", "دقيقة"), contractCompleteness: "99.9%", contractLatency: p("< 30s", "أقل من 30ث"), contractRetention: p("10 years", "10 سنوات") },
  { id: "border-crossings", name: p("Border Crossings Master", "السجل الرئيسي للمعابر"), domain: "public-safety", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Maj. Saud Al-Mutairi", "الرائد سعود المطيري"), ownerOrg: moi, freshnessMin: 5, rowsK: 1_200, lineageCoverage: 100, pdplPass: 18, pdplTotal: 18, blockedSinks: 5, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "99.95%", contractLatency: p("< 2 min", "أقل من دقيقتين"), contractRetention: p("Permanent", "دائم") },
  // ── Workforce (2) ──
  { id: "saudization-band", name: p("Saudization Band Tracker", "تتبّع نطاقات السعودة"), domain: "workforce", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Asma Al-Yami", "أسماء اليامي"), ownerOrg: hrsd, freshnessMin: 1440, rowsK: 410, lineageCoverage: 92, pdplPass: 10, pdplTotal: 10, blockedSinks: 0, contractRefresh: p("Daily", "يومي"), contractCompleteness: "98%", contractLatency: p("< 12h", "أقل من 12س"), contractRetention: p("10 years", "10 سنوات") },
  { id: "labour-mobility", name: p("Labour Mobility Events", "أحداث انتقال العمالة"), domain: "workforce", classification: "sensitive", status: "active", residency: "in-kingdom", owner: p("Saif Al-Bishi", "سيف البيشي"), ownerOrg: hrsd, freshnessMin: 60, rowsK: 88, lineageCoverage: 90, pdplPass: 11, pdplTotal: 12, blockedSinks: 1, contractRefresh: p("1 hour", "ساعة"), contractCompleteness: "99%", contractLatency: p("< 30 min", "أقل من 30 دقيقة"), contractRetention: p("7 years", "7 سنوات") },
  // ── Social (2) ──
  { id: "social-benefit-roster", name: p("Social Benefit Roster", "سجل المستفيدين"), domain: "social", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Wafa Al-Saleh", "وفاء الصالح"), ownerOrg: hrsd, freshnessMin: 1440, rowsK: 1_700, lineageCoverage: 96, pdplPass: 17, pdplTotal: 17, blockedSinks: 3, contractRefresh: p("Daily", "يومي"), contractCompleteness: "99.5%", contractLatency: p("< 6h", "أقل من 6س"), contractRetention: p("Permanent", "دائم") },
  { id: "housing-applications", name: p("Housing Applications Pipeline", "أنبوب طلبات الإسكان"), domain: "social", classification: "sensitive", status: "deprecated", residency: "in-kingdom", owner: p("Adel Al-Khaldi", "عادل الخالدي"), ownerOrg: hrsd, freshnessMin: 4320, rowsK: 38, lineageCoverage: 70, pdplPass: 8, pdplTotal: 11, blockedSinks: 0, contractRefresh: p("Weekly", "أسبوعي"), contractCompleteness: "92%", contractLatency: p("< 24h", "أقل من 24س"), contractRetention: p("5 years", "5 سنوات") },
  // ── Public finance (2) ──
  { id: "budget-execution", name: p("Budget Execution Cube", "مكعّب تنفيذ الميزانية"), domain: "finance", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Layla Al-Harbi", "ليلى الحربي"), ownerOrg: mof, freshnessMin: 1440, rowsK: 240, lineageCoverage: 100, pdplPass: 12, pdplTotal: 12, blockedSinks: 1, contractRefresh: p("Daily", "يومي"), contractCompleteness: "99.5%", contractLatency: p("< 4h", "أقل من 4س"), contractRetention: p("10 years", "10 سنوات") },
  { id: "treasury-flows", name: p("Treasury Cash Flows", "التدفقات النقدية للخزينة"), domain: "finance", classification: "restricted", status: "active", residency: "in-kingdom", owner: p("Nayef Al-Saud", "نايف السعود"), ownerOrg: mof, freshnessMin: 60, rowsK: 18, lineageCoverage: 100, pdplPass: 14, pdplTotal: 14, blockedSinks: 2, contractRefresh: p("1 hour", "ساعة"), contractCompleteness: "99.9%", contractLatency: p("< 10 min", "أقل من 10 دقائق"), contractRetention: p("10 years", "10 سنوات") },
  // ── AI Foundations (2) ──
  { id: "feature-store-arabic", name: p("Arabic NER Feature Store", "متجر ميزات الكيانات"), domain: "ai-foundations", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Dr. Hadi Al-Sharif", "د. هادي الشريف"), ownerOrg: sdaia, freshnessMin: 60, rowsK: 920, lineageCoverage: 88, pdplPass: 9, pdplTotal: 10, blockedSinks: 0, contractRefresh: p("1 hour", "ساعة"), contractCompleteness: "97%", contractLatency: p("< 15 min", "أقل من 15 دقيقة"), contractRetention: p("3 years", "3 سنوات") },
  { id: "embedding-vault", name: p("Sovereign Embedding Vault", "خزنة التضمينات السيادية"), domain: "ai-foundations", classification: "restricted", status: "draft", residency: "in-kingdom", owner: p("Dr. Maha Al-Rashed", "د. مها الراشد"), ownerOrg: sdaia, freshnessMin: 4320, rowsK: 12_000, lineageCoverage: 60, pdplPass: 6, pdplTotal: 14, blockedSinks: 0, contractRefresh: p("Weekly", "أسبوعي"), contractCompleteness: "—", contractLatency: p("—", "—"), contractRetention: p("5 years", "5 سنوات") },
  // ── Infrastructure (2) ──
  { id: "datacentre-telemetry", name: p("Datacentre Telemetry", "قياسات مركز البيانات"), domain: "infra", classification: "internal", status: "active", residency: "in-kingdom", owner: p("Tariq Al-Salem", "طارق السالم"), ownerOrg: sdaia, freshnessMin: 1, rowsK: 480, lineageCoverage: 100, pdplPass: 4, pdplTotal: 4, blockedSinks: 0, contractRefresh: p("1 min", "دقيقة"), contractCompleteness: "99.9%", contractLatency: p("< 30s", "أقل من 30ث"), contractRetention: p("1 year", "سنة") },
  { id: "iam-events", name: p("IAM Event Stream", "تدفق أحداث الهوية"), domain: "infra", classification: "sensitive", status: "blocked", residency: "in-kingdom", owner: p("Saad Al-Hazmi", "سعد الهزمي"), ownerOrg: sdaia, freshnessMin: 5, rowsK: 280, lineageCoverage: 78, pdplPass: 8, pdplTotal: 12, blockedSinks: 2, contractRefresh: p("5 min", "5 دقائق"), contractCompleteness: "—", contractLatency: p("< 2 min", "أقل من دقيقتين"), contractRetention: p("7 years", "7 سنوات") },
];

export function productById(id: string): DataProduct | undefined {
  return DATA_PRODUCTS.find((d) => d.id === id);
}

export function fmtFreshness(min: number, lang: "en" | "ar"): string {
  if (min < 60) return lang === "ar" ? `${min} د` : `${min}m ago`;
  if (min < 1440) return lang === "ar" ? `${Math.round(min / 60)} س` : `${Math.round(min / 60)}h ago`;
  return lang === "ar" ? `${Math.round(min / 1440)} يوم` : `${Math.round(min / 1440)}d ago`;
}

export function classificationColor(c: Classification): string {
  if (c === "restricted") return "#D9534F";
  if (c === "sensitive") return "#F59E0B";
  if (c === "internal") return "#5B7CFF";
  return "#8A5BD6";
}

export function statusColor(s: ProductStatus): string {
  if (s === "blocked") return "#D9534F";
  if (s === "pending") return "#F59E0B";
  if (s === "draft") return "#5C8CA8";
  if (s === "deprecated") return "#9CA3AF";
  return "#8A5BD6";
}

// Lineage graph for the active product (Citizen Sentiment Dashboard)
export interface LineageNode {
  id: string;
  label: BiText;
  kind: "source" | "transform" | "sink";
  classification?: Classification;
  blocked?: boolean;
  blockedReason?: BiText;
  x: number;
  y: number;
}

export interface LineageEdge {
  from: string;
  to: string;
  blocked?: boolean;
}

export const ACTIVE_LINEAGE_NODES: LineageNode[] = [
  { id: "src-crm", label: { en: "CRM", ar: "CRM" }, kind: "source", classification: "sensitive", x: 60, y: 40 },
  { id: "src-cc", label: { en: "Contact-centre (AR)", ar: "مكالمات (عربي)" }, kind: "source", classification: "sensitive", x: 60, y: 140 },
  { id: "src-soc", label: { en: "Social listening", ar: "الاستماع الاجتماعي" }, kind: "source", classification: "public", x: 60, y: 240 },
  { id: "src-comp", label: { en: "Complaints", ar: "الشكاوى" }, kind: "source", classification: "sensitive", x: 60, y: 340 },
  { id: "tx-clean", label: { en: "Clean + de-dupe", ar: "تنظيف وإزالة" }, kind: "transform", x: 280, y: 90 },
  { id: "tx-translate", label: { en: "AR → EN translate", ar: "ترجمة" }, kind: "transform", x: 280, y: 190 },
  { id: "tx-sentiment", label: { en: "Sentiment + topic", ar: "مشاعر وموضوع" }, kind: "transform", x: 280, y: 290 },
  { id: "tx-aggregate", label: { en: "Daily aggregate", ar: "تجميع يومي" }, kind: "transform", x: 500, y: 190 },
  { id: "sink-1", label: { en: "Internal Looker (in-Kingdom)", ar: "Looker داخلي" }, kind: "sink", x: 720, y: 120 },
  {
    id: "sink-2", label: { en: "External BI (Frankfurt)", ar: "BI خارجي (فرانكفورت)" }, kind: "sink", blocked: true,
    blockedReason: { en: "PDPL Article 13 — sensitive citizen data must remain in-Kingdom.", ar: "المادة 13 PDPL — تبقى داخل المملكة." },
    x: 720, y: 260,
  },
];

export const ACTIVE_LINEAGE_EDGES: LineageEdge[] = [
  { from: "src-crm", to: "tx-clean" },
  { from: "src-cc", to: "tx-clean" },
  { from: "src-cc", to: "tx-translate" },
  { from: "src-soc", to: "tx-clean" },
  { from: "src-comp", to: "tx-clean" },
  { from: "tx-clean", to: "tx-sentiment" },
  { from: "tx-translate", to: "tx-sentiment" },
  { from: "tx-sentiment", to: "tx-aggregate" },
  { from: "tx-aggregate", to: "sink-1" },
  { from: "tx-aggregate", to: "sink-2", blocked: true },
];

// PDPL / NDMO / SDAIA obligations register
export interface Obligation {
  id: string;
  framework: "PDPL" | "NDMO" | "SDAIA";
  clause: string;
  topic: BiText;
  enforcement: BiText;
  status: "active" | "review";
  lastEnforcedHrAgo: number;
}

export const OBLIGATIONS: Obligation[] = [
  { id: "pdpl-13", framework: "PDPL", clause: "Article 13", topic: { en: "Sensitive citizen data residency", ar: "إقامة البيانات الحسّاسة" }, enforcement: { en: "Block sinks outside the Kingdom for sensitive citizen data.", ar: "حجب أي مصبّ خارج المملكة للبيانات الحسّاسة." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "pdpl-22", framework: "PDPL", clause: "Article 22", topic: { en: "Consent for secondary use", ar: "موافقة الاستخدام الثانوي" }, enforcement: { en: "Require recorded consent for AI training reuse.", ar: "اشتراط موافقة مسجَّلة لإعادة استخدام التدريب." }, status: "active", lastEnforcedHrAgo: 6 },
  { id: "pdpl-29", framework: "PDPL", clause: "Article 29", topic: { en: "Breach disclosure SLA", ar: "اتفاقية الخرق" }, enforcement: { en: "72-hour breach notification routed to DPO + SDAIA.", ar: "إشعار خرق خلال 72 ساعة إلى DPO وSDAIA." }, status: "active", lastEnforcedHrAgo: 72 },
  { id: "ndmo-2-3", framework: "NDMO", clause: "Spec 2.3", topic: { en: "Data classification", ar: "تصنيف البيانات" }, enforcement: { en: "Every product must declare classification before publish.", ar: "تصنيف معلَن قبل النشر." }, status: "active", lastEnforcedHrAgo: 1 },
  { id: "ndmo-3-1", framework: "NDMO", clause: "Spec 3.1", topic: { en: "Data quality contract", ar: "عقد جودة البيانات" }, enforcement: { en: "Quality contract attached and signed by data owner.", ar: "عقد مرفق وموقّع." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "ndmo-4-2", framework: "NDMO", clause: "Spec 4.2", topic: { en: "Lineage-to-source completeness", ar: "اكتمال النسب" }, enforcement: { en: "100% column-level lineage to source-of-truth.", ar: "100% نسب على مستوى العمود." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "ndmo-5-4", framework: "NDMO", clause: "Spec 5.4", topic: { en: "PII tagging", ar: "وسم البيانات الشخصية" }, enforcement: { en: "Arabic NER tags PII columns at ingest.", ar: "كيانات عربية تصنّف الأعمدة." }, status: "active", lastEnforcedHrAgo: 4 },
  { id: "sdaia-aig-7", framework: "SDAIA", clause: "AI-G 7", topic: { en: "Sovereign-cloud only for citizen-PII", ar: "السحابة السيادية فقط للبيانات الشخصية" }, enforcement: { en: "Reject deployments to non-sovereign regions.", ar: "رفض النشر خارج المنطقة السيادية." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "sdaia-aig-9", framework: "SDAIA", clause: "AI-G 9", topic: { en: "Audit trail completeness", ar: "اكتمال سجل التدقيق" }, enforcement: { en: "Every agent action logged with prompt + tool result.", ar: "كل إجراء وكيل مسجَّل." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "sdaia-aig-12", framework: "SDAIA", clause: "AI-G 12", topic: { en: "Human gate for citizen-facing publish", ar: "بوابة بشرية للنشر للمواطن" }, enforcement: { en: "Two-person sign-off (engineer + owner) before publish.", ar: "توقيع مزدوج قبل النشر." }, status: "active", lastEnforcedHrAgo: 0 },
  { id: "pdpl-15", framework: "PDPL", clause: "Article 15", topic: { en: "Right to access", ar: "حق الوصول" }, enforcement: { en: "Subject access requests routed within 30 days.", ar: "طلبات الوصول خلال 30 يوماً." }, status: "review", lastEnforcedHrAgo: 240 },
  { id: "ndmo-6-2", framework: "NDMO", clause: "Spec 6.2", topic: { en: "Master data steward named", ar: "تسمية حارس البيانات" }, enforcement: { en: "Each domain has named human steward in catalogue.", ar: "حارس بشري لكل نطاق." }, status: "active", lastEnforcedHrAgo: 12 },
];
