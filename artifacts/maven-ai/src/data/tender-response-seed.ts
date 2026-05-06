// Bid Manager Studio — Tender Response Studio user-facing seed.
//
// Persona: Khalid Al-Mansouri, Head of Bid Management at a Saudi
// systems-integrator. He runs ~8 active mega-tenders against GCC public-
// sector & telecom buyers (Etimad, ADNOC, ARAMCO, STC, e&). The "active"
// drilldown tender is RFP-ETM-2026-LOT3 — a 220-page Etimad smart-services
// platform RFP with a 14-day window and 41 answered questions across 7
// sections. The studio also surfaces a clause-and-precedent library, a
// compliance scorecard, and an audit trail keyed to the 3 human
// checkpoints from the Bid Conductor scenario.

export type Lang = "en" | "ar";
export interface BiText { en: string; ar: string }

// ─── Tenders ────────────────────────────────────────────────────────────

export type TenderStage = "ingest" | "qualify" | "draft" | "pricing" | "partner" | "legal" | "compile" | "submitted";
export type TenderHealth = "on-track" | "at-risk" | "blocked" | "won" | "lost";

export interface Tender {
  id: string;
  rfpRef: string;
  buyer: BiText;
  buyerType: "ministry" | "telecom" | "energy" | "municipality";
  title: BiText;
  totalValueSAR: number;
  pages: number;
  receivedAt: string;       // ISO
  dueAt: string;            // ISO
  stage: TenderStage;
  health: TenderHealth;
  fitScore: number;          // 0–100
  questionsTotal: number;
  questionsDrafted: number;
  questionsApproved: number;
  partnerLosRequired: number;
  partnerLosReceived: number;
  ownerSme: string;          // sme.id
  conductorRecommendation: BiText;
}

export const TENDERS: Tender[] = [
  {
    id: "RFP-ETM-2026-LOT3",
    rfpRef: "RFP-ETM-2026-LOT3",
    buyer: { en: "Ministry of Communications & IT (MCIT)", ar: "وزارة الاتصالات وتقنية المعلومات" },
    buyerType: "ministry",
    title: { en: "Smart-services platform · Etimad lot 3", ar: "منصّة الخدمات الذكية · اعتماد الجزء 3" },
    totalValueSAR: 142_000_000,
    pages: 220,
    receivedAt: "2026-04-23T08:30:00Z",
    dueAt: "2026-05-07T15:00:00Z",
    stage: "draft",
    health: "at-risk",
    fitScore: 76,
    questionsTotal: 41,
    questionsDrafted: 32,
    questionsApproved: 19,
    partnerLosRequired: 3,
    partnerLosReceived: 2,
    ownerSme: "sme-khalid",
    conductorRecommendation: { en: "Bid with partner caveat — 4-day window to lock 3rd LoS or fall back to defensible no-bid memo.", ar: "تقديم بشرط الشريك — 4 أيام لتأمين الشريك الثالث أو الانسحاب." },
  },
  {
    id: "RFP-ADNOC-2026-DT4",
    rfpRef: "RFP-ADNOC-2026-DT4",
    buyer: { en: "ADNOC Digital", ar: "أدنوك الرقمية" },
    buyerType: "energy",
    title: { en: "Upstream operations data lake (DT-4)", ar: "بحيرة بيانات العمليات (DT-4)" },
    totalValueSAR: 88_500_000,
    pages: 164,
    receivedAt: "2026-04-12T07:00:00Z",
    dueAt: "2026-05-19T15:00:00Z",
    stage: "pricing",
    health: "on-track",
    fitScore: 84,
    questionsTotal: 36,
    questionsDrafted: 36,
    questionsApproved: 28,
    partnerLosRequired: 2,
    partnerLosReceived: 2,
    ownerSme: "sme-noura",
    conductorRecommendation: { en: "Approve base SAR 88.5M (margin 12.4%). Pricing committee Tue.", ar: "اعتماد الأساس 88.5M (هامش 12.4%). لجنة الثلاثاء." },
  },
  {
    id: "RFP-STC-2026-NW7",
    rfpRef: "RFP-STC-2026-NW7",
    buyer: { en: "stc Group", ar: "مجموعة stc" },
    buyerType: "telecom",
    title: { en: "5G core SI services (NW-7)", ar: "خدمات تكامل نواة 5G (NW-7)" },
    totalValueSAR: 61_300_000,
    pages: 138,
    receivedAt: "2026-04-02T10:00:00Z",
    dueAt: "2026-05-12T15:00:00Z",
    stage: "legal",
    health: "on-track",
    fitScore: 81,
    questionsTotal: 28,
    questionsDrafted: 28,
    questionsApproved: 26,
    partnerLosRequired: 1,
    partnerLosReceived: 1,
    ownerSme: "sme-faisal",
    conductorRecommendation: { en: "Legal flagged 1 indemnity clause; library position 4.2c applied. Awaiting GC release.", ar: "نبّه القانوني لبند تعويض؛ طُبّق موقع المكتبة 4.2ج. ينتظر الإفراج." },
  },
  {
    id: "RFP-ETM-2026-EDU2",
    rfpRef: "RFP-ETM-2026-EDU2",
    buyer: { en: "Ministry of Education (Etimad)", ar: "وزارة التعليم (اعتماد)" },
    buyerType: "ministry",
    title: { en: "Student-services digital platform", ar: "المنصّة الرقمية لخدمات الطلاب" },
    totalValueSAR: 47_900_000,
    pages: 96,
    receivedAt: "2026-04-28T09:30:00Z",
    dueAt: "2026-05-22T15:00:00Z",
    stage: "qualify",
    health: "on-track",
    fitScore: 72,
    questionsTotal: 22,
    questionsDrafted: 8,
    questionsApproved: 0,
    partnerLosRequired: 1,
    partnerLosReceived: 0,
    ownerSme: "sme-laila",
    conductorRecommendation: { en: "Bid — 72% fit; SME confirmed pricing headroom available.", ar: "تقديم — 72% جدارة؛ مؤكَّد هامش التسعير." },
  },
  {
    id: "RFP-ARAMCO-2026-CYB1",
    rfpRef: "RFP-ARAMCO-2026-CYB1",
    buyer: { en: "Saudi Aramco — Cybersecurity", ar: "أرامكو السعودية — الأمن السيبراني" },
    buyerType: "energy",
    title: { en: "OT cyber managed services framework", ar: "إطار خدمات الأمن السيبراني للتشغيل" },
    totalValueSAR: 215_000_000,
    pages: 286,
    receivedAt: "2026-03-30T08:00:00Z",
    dueAt: "2026-05-09T15:00:00Z",
    stage: "compile",
    health: "on-track",
    fitScore: 89,
    questionsTotal: 54,
    questionsDrafted: 54,
    questionsApproved: 52,
    partnerLosRequired: 4,
    partnerLosReceived: 4,
    ownerSme: "sme-noura",
    conductorRecommendation: { en: "Packet stitched at 248 pages; uploading Friday after CFO sign-off rehearsal.", ar: "الحزمة 248 صفحة؛ الرفع الجمعة بعد تدريب اعتماد المدير المالي." },
  },
  {
    id: "RFP-NEOM-2026-MOB3",
    rfpRef: "RFP-NEOM-2026-MOB3",
    buyer: { en: "NEOM — Mobility", ar: "نيوم — التنقل" },
    buyerType: "ministry",
    title: { en: "Mobility command-centre platform", ar: "منصّة مركز قيادة التنقل" },
    totalValueSAR: 122_000_000,
    pages: 188,
    receivedAt: "2026-03-18T11:00:00Z",
    dueAt: "2026-05-04T15:00:00Z",
    stage: "submitted",
    health: "won",
    fitScore: 91,
    questionsTotal: 38,
    questionsDrafted: 38,
    questionsApproved: 38,
    partnerLosRequired: 2,
    partnerLosReceived: 2,
    ownerSme: "sme-faisal",
    conductorRecommendation: { en: "Submitted on D+12. Award letter received yesterday.", ar: "قُدّمت في اليوم 12. وردت رسالة الترسية أمس." },
  },
  {
    id: "RFP-MUNI-RIY-2026-WT1",
    rfpRef: "RFP-MUNI-RIY-2026-WT1",
    buyer: { en: "Riyadh Municipality", ar: "أمانة الرياض" },
    buyerType: "municipality",
    title: { en: "Smart-waste IoT roll-out", ar: "إنترنت الأشياء للنفايات الذكية" },
    totalValueSAR: 28_400_000,
    pages: 74,
    receivedAt: "2026-04-19T08:00:00Z",
    dueAt: "2026-05-15T15:00:00Z",
    stage: "draft",
    health: "blocked",
    fitScore: 58,
    questionsTotal: 19,
    questionsDrafted: 6,
    questionsApproved: 1,
    partnerLosRequired: 1,
    partnerLosReceived: 0,
    ownerSme: "sme-laila",
    conductorRecommendation: { en: "Recommend NO-BID — past performance gap on municipal IoT and pricing floor breached.", ar: "يُوصى بالانسحاب — نقص في السوابق وكسر حدّ التسعير." },
  },
  {
    id: "RFP-EAND-2026-OSS5",
    rfpRef: "RFP-EAND-2026-OSS5",
    buyer: { en: "e& UAE", ar: "e& الإمارات" },
    buyerType: "telecom",
    title: { en: "OSS modernisation (lot 5)", ar: "تحديث OSS (الجزء 5)" },
    totalValueSAR: 73_200_000,
    pages: 142,
    receivedAt: "2026-04-09T09:00:00Z",
    dueAt: "2026-05-17T15:00:00Z",
    stage: "partner",
    health: "at-risk",
    fitScore: 69,
    questionsTotal: 31,
    questionsDrafted: 24,
    questionsApproved: 12,
    partnerLosRequired: 2,
    partnerLosReceived: 1,
    ownerSme: "sme-faisal",
    conductorRecommendation: { en: "2nd partner silent at D+10; auto-escalation drafted to alternative vendor.", ar: "الشريك الثاني صامت في اليوم 10؛ تصعيد آلي للبديل." },
  },
];

export const ACTIVE_TENDER_ID = "RFP-ETM-2026-LOT3";

// ─── 41 questions for the active tender ─────────────────────────────────

export type AnswerStatus = "drafted" | "sme-review" | "approved" | "needs-rework" | "blocked";

export interface TenderQuestion {
  id: string;
  section: "S1-Cover" | "S2-Past" | "S3-Technical" | "S4-Security" | "S5-Commercial" | "S6-Compliance" | "S7-Partner";
  ref: string;            // requirement id like M-04
  prompt: BiText;
  status: AnswerStatus;
  draftAgent: "drafter" | "ingest" | "qualifier" | "pricing" | "partner" | "legal" | "compiler";
  confidence: number;     // 0–100
  wordCount: number;
  citationsFromLibrary: number;
  smeOwner: string;       // sme.id
  flag?: BiText;          // SME / risk flag
  precedentAnswerId?: string;
}

const SECTIONS: { id: TenderQuestion["section"]; count: number; sme: string }[] = [
  { id: "S1-Cover", count: 2, sme: "sme-khalid" },
  { id: "S2-Past", count: 5, sme: "sme-laila" },
  { id: "S3-Technical", count: 14, sme: "sme-faisal" },
  { id: "S4-Security", count: 8, sme: "sme-noura" },
  { id: "S5-Commercial", count: 4, sme: "sme-khalid" },
  { id: "S6-Compliance", count: 5, sme: "sme-noura" },
  { id: "S7-Partner", count: 3, sme: "sme-khalid" },
];

const SAMPLE_PROMPTS: Record<TenderQuestion["section"], BiText[]> = {
  "S1-Cover": [
    { en: "Bidder cover letter with authorised signatory.", ar: "خطاب التغطية مع المفوّض بالتوقيع." },
    { en: "Executive summary of approach (max 2 pages).", ar: "الملخّص التنفيذي للنهج (صفحتان)." },
  ],
  "S2-Past": [
    { en: "List 5 in-Kingdom platform deliveries (last 5 yrs).", ar: "اذكر 5 تسليمات منصّات داخل المملكة." },
    { en: "Reference letters from 3 ministry clients.", ar: "خطابات مرجعية من 3 جهات وزارية." },
    { en: "On-time on-budget rate across last 24 months.", ar: "نسبة التسليم في الموعد والميزانية." },
    { en: "Attrition rate of named delivery leads.", ar: "نسبة دوران قادة التسليم المُسمّين." },
    { en: "Prior Etimad-platform integrations.", ar: "تكاملات سابقة مع منصّة اعتماد." },
  ],
  "S3-Technical": [
    { en: "Solution architecture overview.", ar: "نظرة عامة على معمارية الحل." },
    { en: "Bilingual UI (AR + EN) RTL conformance.", ar: "توافق الواجهة الثنائية RTL." },
    { en: "Microservices breakdown and message bus choice.", ar: "تقسيم الخدمات الدقيقة وناقل الرسائل." },
    { en: "Identity & access — IAM federation with NAFATH.", ar: "الهوية والوصول — اتحاد مع نفاذ." },
    { en: "Performance: P95 latency under peak load.", ar: "الأداء: زمن استجابة P95 تحت الذروة." },
    { en: "Observability: logs, metrics, traces stack.", ar: "المراقبة: السجلات والمقاييس والمسارات." },
    { en: "Disaster recovery RTO / RPO.", ar: "استرداد الكوارث RTO/RPO." },
    { en: "Cloud-native deployment topology.", ar: "طوبولوجيا النشر السحابي." },
    { en: "API contract management & versioning.", ar: "إدارة عقود API والإصدارات." },
    { en: "Mobile companion app scope.", ar: "نطاق التطبيق المصاحب للجوال." },
    { en: "Accessibility (WCAG 2.2 AA).", ar: "إمكانية الوصول WCAG 2.2 AA." },
    { en: "Roadmap of post-go-live capabilities (12 mo).", ar: "خارطة طريق ما بعد الإطلاق." },
    { en: "AI / ML usage & guardrails.", ar: "استخدام الذكاء الاصطناعي وضوابطه." },
    { en: "Test automation pyramid.", ar: "هرم أتمتة الاختبار." },
  ],
  "S4-Security": [
    { en: "SAMA cybersecurity framework attestation mapping.", ar: "تخطيط إطار ساما للأمن." },
    { en: "NCA-ECC controls coverage matrix.", ar: "مصفوفة ضوابط NCA-ECC." },
    { en: "Data residency: in-Kingdom only.", ar: "إقامة البيانات داخل المملكة." },
    { en: "Penetration-test cadence and remediation SLA.", ar: "وتيرة اختبار الاختراق و SLA المعالجة." },
    { en: "Secrets management & key rotation.", ar: "إدارة الأسرار وتدوير المفاتيح." },
    { en: "SOC 24/7 staffing model.", ar: "نموذج تشغيل مركز العمليات الأمنية 24/7." },
    { en: "Incident-response runbooks.", ar: "أدلّة الاستجابة للحوادث." },
    { en: "Insider-threat controls.", ar: "ضوابط التهديد الداخلي." },
  ],
  "S5-Commercial": [
    { en: "Total contract value with 5-yr breakdown.", ar: "إجمالي قيمة العقد بتفصيل 5 سنوات." },
    { en: "Milestone-based payment schedule.", ar: "جدول الدفعات المرتبط بالمعالم." },
    { en: "Local-content table (Saudi suppliers, ≥ 40%).", ar: "جدول المحتوى المحلي (≥ 40%)." },
    { en: "Optional change-request rate card.", ar: "بطاقة أسعار طلبات التغيير الاختيارية." },
  ],
  "S6-Compliance": [
    { en: "ZATCA e-invoice readiness.", ar: "جاهزية الفاتورة الإلكترونية للزكاة." },
    { en: "GOSI registration of named team.", ar: "تسجيل الفريق المُسمّى لدى التأمينات." },
    { en: "Saudization band (Nitaqat) declaration.", ar: "إقرار نطاق السعودة (نطاقات)." },
    { en: "PDPL data-protection officer assignment.", ar: "تعيين ضابط حماية البيانات (PDPL)." },
    { en: "Vendor footprint declaration (no SDN exposure).", ar: "إقرار البصمة (دون عقوبات SDN)." },
  ],
  "S7-Partner": [
    { en: "Partner LoS — Tier-1 sovereign cloud.", ar: "رسالة دعم — سحابة سيادية." },
    { en: "Partner LoS — managed-security partner.", ar: "رسالة دعم — شريك أمن مُدار." },
    { en: "Partner LoS — change-management consultancy.", ar: "رسالة دعم — استشارات إدارة التغيير." },
  ],
};

const STATUS_DIST: AnswerStatus[] = [
  // 41 statuses, totals: 32 drafted (19 approved, 7 sme-review, 6 needs-rework), 6 still-blocked, 3 not started? but we count drafted=32, approved=19.
  // Build: 19 approved + 7 sme-review + 6 needs-rework = 32 drafted; remaining 9 = 5 blocked + 4 sme-review (still drafted) — keep simple at totals 19/7/6 + 9 remaining as "drafted" but flagged = let's instead: 19 approved, 13 drafted/sme-review, 6 needs-rework, 3 blocked = 41.
];

function buildQuestions(): TenderQuestion[] {
  const out: TenderQuestion[] = [];
  let qIdx = 1;
  // Distribution of statuses across 41 questions
  const statuses: AnswerStatus[] = [];
  for (let i = 0; i < 19; i++) statuses.push("approved");
  for (let i = 0; i < 7; i++) statuses.push("sme-review");
  for (let i = 0; i < 6; i++) statuses.push("needs-rework");
  for (let i = 0; i < 6; i++) statuses.push("drafted");
  for (let i = 0; i < 3; i++) statuses.push("blocked");
  // shuffle deterministically
  const order = [3, 7, 11, 1, 14, 21, 5, 28, 33, 9, 17, 36, 25, 19, 2, 31, 8, 13, 22, 6, 38, 27, 12, 35, 4, 30, 18, 26, 40, 15, 10, 24, 39, 16, 32, 20, 29, 37, 23, 34, 41];
  const shuffled: AnswerStatus[] = order.map((_, i) => statuses[i]);

  for (const sec of SECTIONS) {
    const prompts = SAMPLE_PROMPTS[sec.id];
    for (let i = 0; i < sec.count; i++) {
      const status = shuffled[qIdx - 1] ?? "drafted";
      const baseConf = status === "approved" ? 92 : status === "sme-review" ? 86 : status === "needs-rework" ? 64 : status === "blocked" ? 0 : 79;
      const conf = baseConf + (qIdx % 5);
      out.push({
        id: `Q-${String(qIdx).padStart(2, "0")}`,
        section: sec.id,
        ref: `M-${String(qIdx).padStart(2, "0")}`,
        prompt: prompts[i % prompts.length],
        status,
        draftAgent: sec.id === "S5-Commercial" ? "pricing" : sec.id === "S4-Security" || sec.id === "S6-Compliance" ? "legal" : sec.id === "S7-Partner" ? "partner" : "drafter",
        confidence: Math.min(99, conf),
        wordCount: 180 + ((qIdx * 73) % 340),
        citationsFromLibrary: 1 + (qIdx % 5),
        smeOwner: sec.sme,
        flag: status === "needs-rework" ? { en: "SME flagged claim — verify footprint citation in §4.2 vs §1.1.", ar: "نبّه الخبير — تحقّق من ادعاء البصمة." }
            : status === "blocked"     ? { en: "Awaiting partner LoS before this section can be drafted.", ar: "بانتظار رسالة الشريك قبل الصياغة." }
            : undefined,
        precedentAnswerId: status === "approved" ? `LIB-${(qIdx % 24) + 1}` : undefined,
      });
      qIdx++;
    }
  }
  return out;
}

export const ACTIVE_QUESTIONS: TenderQuestion[] = buildQuestions();

// ─── Library (precedent answers + clauses) ──────────────────────────────

export interface LibraryEntry {
  id: string;
  type: "answer" | "clause";
  category: BiText;
  title: BiText;
  summary: BiText;
  reusedCount: number;
  winRate: number;          // 0–100
  lastUsed: string;
  ownerSme: string;
}

const LIBRARY_TITLES: { cat: BiText; title: BiText; summary: BiText; type: "answer" | "clause" }[] = [
  { type: "answer", cat: { en: "Solution architecture", ar: "معمارية الحل" }, title: { en: "Cloud-native microservices reference", ar: "مرجع الخدمات الدقيقة السحابية" }, summary: { en: "K8s + service mesh + event bus boilerplate, 1100 words.", ar: "نموذج K8s + شبكة خدمات + ناقل أحداث، 1100 كلمة." } },
  { type: "answer", cat: { en: "Identity & access", ar: "الهوية والوصول" }, title: { en: "NAFATH federation pattern", ar: "نمط اتحاد نفاذ" }, summary: { en: "OIDC bridge to NAFATH with attribute mapping table.", ar: "جسر OIDC مع نفاذ وجدول مواءمة السمات." } },
  { type: "answer", cat: { en: "Past performance", ar: "السابقة" }, title: { en: "5-Ministry references block", ar: "كتلة مراجع 5 وزارات" }, summary: { en: "Auto-localised reference paragraph for ministry RFPs.", ar: "فقرة مرجع تلقائية لمناقصات الوزارات." } },
  { type: "clause", cat: { en: "Indemnity", ar: "التعويض" }, title: { en: "Indemnity capped at contract value (4.2c)", ar: "تعويض مسقوف بقيمة العقد (4.2ج)" }, summary: { en: "Library position 4.2c — capped, 12-month survival.", ar: "موقع 4.2ج — مسقوف، بقاء 12 شهراً." } },
  { type: "clause", cat: { en: "IP", ar: "الملكية الفكرية" }, title: { en: "Joint IP with carve-outs (7.4a)", ar: "ملكية مشتركة مع استثناءات (7.4أ)" }, summary: { en: "Bidder retains pre-existing IP; deliverables joint.", ar: "ملكية سابقة للبائع؛ المخرجات مشتركة." } },
  { type: "clause", cat: { en: "Liability", ar: "المسؤولية" }, title: { en: "Aggregate liability cap (5.1b)", ar: "سقف المسؤولية الإجمالية (5.1ب)" }, summary: { en: "12-month fees cap with carve-outs for breach of confidentiality.", ar: "سقف 12 شهراً مع استثناءات السرية." } },
  { type: "answer", cat: { en: "Security", ar: "الأمن" }, title: { en: "SAMA + NCA-ECC mapping matrix", ar: "مصفوفة ساما و NCA-ECC" }, summary: { en: "Pre-mapped controls table covering 142 NCA-ECC controls.", ar: "جدول 142 ضابط NCA-ECC." } },
  { type: "answer", cat: { en: "Security", ar: "الأمن" }, title: { en: "SOC 24/7 staffing model", ar: "نموذج تشغيل SOC 24/7" }, summary: { en: "3-shift, 18-FTE SOC with run-of-show cadence.", ar: "ثلاث ورديات و 18 موظفاً." } },
  { type: "answer", cat: { en: "Commercial", ar: "تجاري" }, title: { en: "Local-content 42% breakdown table", ar: "جدول المحتوى المحلي 42%" }, summary: { en: "Reusable Saudi-supplier matrix anchored on Local Content Authority.", ar: "مصفوفة الموردين السعوديين." } },
  { type: "answer", cat: { en: "Compliance", ar: "الامتثال" }, title: { en: "PDPL DPO & data-flow declaration", ar: "إقرار ضابط البيانات وتدفّقها" }, summary: { en: "DPO appointment letter + data-flow diagram template.", ar: "خطاب تعيين الضابط ومخطط التدفّق." } },
  { type: "answer", cat: { en: "Compliance", ar: "الامتثال" }, title: { en: "ZATCA e-invoice readiness statement", ar: "بيان الفاتورة الإلكترونية للزكاة" }, summary: { en: "Phase-2 integration evidence pack.", ar: "حزمة دليل المرحلة 2." } },
  { type: "answer", cat: { en: "Performance", ar: "الأداء" }, title: { en: "P95 latency benchmark sheet", ar: "ورقة قياس P95" }, summary: { en: "Load-test results from 3 ministry deployments.", ar: "نتائج اختبار الحمل من 3 نشرات وزارية." } },
  { type: "clause", cat: { en: "Termination", ar: "الإنهاء" }, title: { en: "Termination for convenience (8.3)", ar: "إنهاء للملاءمة (8.3)" }, summary: { en: "60-day notice with wind-down fee schedule.", ar: "إشعار 60 يوماً مع جدول رسوم الإغلاق." } },
  { type: "answer", cat: { en: "Mobility", ar: "التنقل" }, title: { en: "Mobile companion architecture", ar: "معمارية تطبيق الجوال" }, summary: { en: "Cross-platform RN architecture with offline mode.", ar: "معمارية React Native مع وضع غير متّصل." } },
  { type: "answer", cat: { en: "AI/ML", ar: "ذكاء اصطناعي" }, title: { en: "AI guardrails & evaluation pack", ar: "حزمة ضوابط وتقييم الذكاء" }, summary: { en: "Eval harness + red-team coverage for AI features.", ar: "تقييم وتغطية المراجعة الحمراء." } },
  { type: "answer", cat: { en: "Mobility", ar: "التنقل" }, title: { en: "Mobility command-centre case study", ar: "دراسة حالة مركز قيادة التنقل" }, summary: { en: "NEOM deployment 2025 — 40% throughput uplift.", ar: "نشر نيوم 2025 — تحسّن 40%." } },
  { type: "answer", cat: { en: "Past performance", ar: "السابقة" }, title: { en: "On-time on-budget evidence (24mo)", ar: "دليل التسليم في الموعد (24 شهراً)" }, summary: { en: "Rolling delivery KPIs across 12 engagements.", ar: "مؤشرات التسليم لـ 12 ارتباطاً." } },
  { type: "answer", cat: { en: "Test", ar: "اختبار" }, title: { en: "Test automation pyramid", ar: "هرم أتمتة الاختبار" }, summary: { en: "70/20/10 unit/integration/e2e mix narrative.", ar: "مزيج 70/20/10." } },
  { type: "answer", cat: { en: "Architecture", ar: "معمارية" }, title: { en: "DR / RTO 4h / RPO 15m sheet", ar: "ورقة استرداد كوارث" }, summary: { en: "Multi-region active-passive DR baseline.", ar: "نشط-سلبي بين المناطق." } },
  { type: "answer", cat: { en: "Accessibility", ar: "إمكانية الوصول" }, title: { en: "WCAG 2.2 AA conformance pack", ar: "حزمة WCAG 2.2 AA" }, summary: { en: "Audit checklist + remediation tracker.", ar: "قائمة تدقيق ومتابعة المعالجة." } },
  { type: "clause", cat: { en: "Force majeure", ar: "قوة قاهرة" }, title: { en: "Force majeure with epidemic clause (9.1)", ar: "قوة قاهرة مع بند الوباء (9.1)" }, summary: { en: "Standard force-majeure with epidemic carve-in.", ar: "نص قياسي مع شمول الوباء." } },
  { type: "clause", cat: { en: "SLA", ar: "اتفاقية مستوى الخدمة" }, title: { en: "SLA credit cap at 25% (6.2)", ar: "سقف ائتمان SLA 25% (6.2)" }, summary: { en: "Library SLA credits position with 25% cap.", ar: "موقع ائتمانات SLA بسقف 25%." } },
  { type: "answer", cat: { en: "Observability", ar: "المراقبة" }, title: { en: "Observability stack reference", ar: "مرجع منصّة المراقبة" }, summary: { en: "OTel + Prometheus + Grafana + Loki diagram.", ar: "OTel + Prometheus + Grafana + Loki." } },
  { type: "answer", cat: { en: "API", ar: "واجهات" }, title: { en: "API contract & versioning playbook", ar: "كتيّب عقود API" }, summary: { en: "OpenAPI-driven semver lifecycle.", ar: "دورة semver مدارة بـ OpenAPI." } },
];

export const LIBRARY: LibraryEntry[] = LIBRARY_TITLES.map((entry, i) => ({
  id: `LIB-${i + 1}`,
  type: entry.type,
  category: entry.cat,
  title: entry.title,
  summary: entry.summary,
  reusedCount: 4 + ((i * 7) % 26),
  winRate: 60 + ((i * 11) % 35),
  lastUsed: new Date(Date.UTC(2026, 3, 5 + (i % 28))).toISOString(),
  ownerSme: ["sme-noura", "sme-faisal", "sme-laila", "sme-khalid"][i % 4],
}));

// ─── SMEs ───────────────────────────────────────────────────────────────

export interface Sme {
  id: string;
  name: BiText;
  role: BiText;
  initials: string;
  color: string;
  load: number;             // open answers assigned
}

export const SMES: Sme[] = [
  { id: "sme-khalid", name: { en: "Khalid Al-Mansouri", ar: "خالد المنصوري" }, role: { en: "Head of Bid Management", ar: "رئيس إدارة العطاءات" }, initials: "KM", color: "#196B24", load: 9 },
  { id: "sme-noura", name: { en: "Noura Al-Salem", ar: "نورة السالم" }, role: { en: "Security & Compliance SME", ar: "خبير الأمن والامتثال" }, initials: "NS", color: "#5C8CA8", load: 6 },
  { id: "sme-faisal", name: { en: "Faisal Al-Otaibi", ar: "فيصل العتيبي" }, role: { en: "Solution Architect SME", ar: "خبير معمارية الحلول" }, initials: "FA", color: "#5BA98A", load: 11 },
  { id: "sme-laila", name: { en: "Laila Hadid", ar: "ليلى حديد" }, role: { en: "Past-performance & Refs SME", ar: "خبير السوابق والمراجع" }, initials: "LH", color: "#F5A623", load: 4 },
  { id: "sme-omar", name: { en: "Omar Al-Faraj", ar: "عمر الفرج" }, role: { en: "Pricing & Commercial SME", ar: "خبير التسعير" }, initials: "OF", color: "#156082", load: 5 },
  { id: "sme-rana", name: { en: "Rana Khoury", ar: "رنا خوري" }, role: { en: "Legal SME", ar: "خبير قانوني" }, initials: "RK", color: "#D9534F", load: 3 },
];

// ─── Compliance gates (scorecard) ───────────────────────────────────────

export interface ComplianceGate {
  id: string;
  category: BiText;
  rule: BiText;
  status: "pass" | "warn" | "fail";
  evidence: BiText;
  agent: "ingest" | "drafter" | "pricing" | "legal" | "compiler" | "qualifier" | "partner";
}

export const COMPLIANCE_GATES: ComplianceGate[] = [
  { id: "gate-mandatory", category: { en: "Mandatory requirements", ar: "المتطلبات الإلزامية" }, rule: { en: "All 18 mandatory requirements (M-01 … M-18) addressed.", ar: "كل 18 متطلباً إلزامياً." }, status: "pass", evidence: { en: "18/18 mapped to drafted answers; M-15 partner LoS still pending receipt.", ar: "18/18 مرتبطة؛ M-15 رسالة الشريك قيد الاستلام." }, agent: "ingest" },
  { id: "gate-residency", category: { en: "Data residency", ar: "إقامة البيانات" }, rule: { en: "100% in-Kingdom data residency declared.", ar: "إقامة بيانات داخل المملكة 100%." }, status: "pass", evidence: { en: "Riyadh + Jeddah regions only; declaration block lifted from LIB-2.", ar: "الرياض + جدّة فقط." }, agent: "drafter" },
  { id: "gate-localcontent", category: { en: "Local content", ar: "المحتوى المحلي" }, rule: { en: "Local content ≥ 40% (Saudi suppliers).", ar: "محتوى محلي ≥ 40%." }, status: "pass", evidence: { en: "Modeled at 42.1% in S5; LIB-9 table populated.", ar: "نُمذِج عند 42.1%." }, agent: "pricing" },
  { id: "gate-margin", category: { en: "Pricing floor", ar: "حدّ التسعير" }, rule: { en: "Margin ≥ 10% on selected scenario.", ar: "هامش ≥ 10% على السيناريو." }, status: "warn", evidence: { en: "Base scenario sits at 11.2% — only 1.2 pts of headroom.", ar: "السيناريو الأساس عند 11.2% — هامش 1.2 نقطة فقط." }, agent: "pricing" },
  { id: "gate-partner", category: { en: "Partner LoS", ar: "رسائل الشركاء" }, rule: { en: "All required partner LoS received and signed.", ar: "كل رسائل الشركاء مُستلمة." }, status: "fail", evidence: { en: "2 of 3 LoS in hand; 3rd partner silent at D+3.", ar: "2/3 مُستلمة؛ الثالث صامت." }, agent: "partner" },
  { id: "gate-legal", category: { en: "Legal red-team", ar: "المراجعة القانونية" }, rule: { en: "All legal flags resolved with library positions.", ar: "كل التنبيهات حُلّت بمواقع المكتبة." }, status: "warn", evidence: { en: "Clauses 4.2 + 7.4 resolved; clause 6.2 (SLA cap) under final review.", ar: "4.2 و 7.4 حُلّت؛ 6.2 قيد المراجعة." }, agent: "legal" },
  { id: "gate-bilingual", category: { en: "Bilingual UI", ar: "ثنائية اللغة" }, rule: { en: "AR + EN with RTL conformance evidence attached.", ar: "AR + EN مع دليل RTL." }, status: "pass", evidence: { en: "Screenshot pack from NEOM deployment attached.", ar: "حزمة لقطات من نيوم." }, agent: "drafter" },
  { id: "gate-conflict", category: { en: "Cross-section conflicts", ar: "تعارض الأقسام" }, rule: { en: "No conflicting claims across drafted sections.", ar: "لا تعارض بين الأقسام." }, status: "warn", evidence: { en: "Footprint claim differs in §4.2 vs §1.1 — flagged for SME reconciliation.", ar: "اختلاف ادعاء البصمة في §4.2 و§1.1." }, agent: "drafter" },
  { id: "gate-pdpl", category: { en: "PDPL compliance", ar: "PDPL" }, rule: { en: "DPO appointed and data-flow attached.", ar: "ضابط البيانات معيّن والتدفق مرفق." }, status: "pass", evidence: { en: "LIB-10 DPO letter attached.", ar: "خطاب الضابط مرفق." }, agent: "legal" },
  { id: "gate-format", category: { en: "Submission format", ar: "صيغة التقديم" }, rule: { en: "Etimad portal format (PDF/A, ≤ 100 MB per file).", ar: "صيغة بوّابة اعتماد." }, status: "pass", evidence: { en: "Compiler dry-run produced 86 pages; under 18 MB.", ar: "تجربة المُجمّع 86 صفحة." }, agent: "compiler" },
];

// ─── Audit log entries ──────────────────────────────────────────────────

export type AuditKind = "ingest" | "qualify" | "draft" | "checkpoint" | "pricing" | "partner" | "legal" | "compile" | "human-decision" | "submit";

export interface AuditEntry {
  id: string;
  kind: AuditKind;
  timestamp: string;
  agent: string;
  actor?: string;             // for human decisions
  title: BiText;
  detail: BiText;
  tenderId: string;
  checkpointId?: "bid-no-bid" | "pricing-signoff" | "legal-release";
}

export const AUDIT_LOG: AuditEntry[] = [
  { id: "a01", kind: "ingest", timestamp: "2026-04-23T08:31:00Z", agent: "ingest", title: { en: "RFP parsed", ar: "تحليل المناقصة" }, detail: { en: "220 pages → 7 sections, 18 mandatory requirements, 6 evaluation criteria.", ar: "220 صفحة → 7 أقسام، 18 إلزامي، 6 معايير." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a02", kind: "qualify", timestamp: "2026-04-23T11:14:00Z", agent: "qualifier", title: { en: "Fit-to-win scored 76%", ar: "جدارة 76%" }, detail: { en: "Capability 88, past 81, pricing 62, partner 67. Composite 76. Bid recommended with caveat.", ar: "88/81/62/67. مركّب 76. تقديم بشرط." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a03", kind: "checkpoint", timestamp: "2026-04-23T13:00:00Z", agent: "orch", title: { en: "Bid/no-bid checkpoint opened", ar: "نقطة قرار التقديم" }, detail: { en: "Pause for Bid Director.", ar: "توقف لمدير العطاءات." }, tenderId: ACTIVE_TENDER_ID, checkpointId: "bid-no-bid" },
  { id: "a04", kind: "human-decision", timestamp: "2026-04-23T14:22:00Z", agent: "orch", actor: "Khalid Al-Mansouri", title: { en: "BID approved (with partner caveat)", ar: "تقديم — بشرط الشريك" }, detail: { en: "Decision: BID with caveat. 4-day clock to lock 3rd LoS opens.", ar: "قرار: تقديم بشرط. 4 أيام لتأمين الشريك." }, tenderId: ACTIVE_TENDER_ID, checkpointId: "bid-no-bid" },
  { id: "a05", kind: "draft", timestamp: "2026-04-24T09:05:00Z", agent: "drafter", title: { en: "5 section drafters launched", ar: "تشعيب 5 كتّاب" }, detail: { en: "Lanes S2/S3/S4/S5/S6 forked in parallel.", ar: "تشعيب الأقسام بالتوازي." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a06", kind: "draft", timestamp: "2026-04-26T16:40:00Z", agent: "drafter", title: { en: "32 of 41 answers drafted", ar: "32 من 41 صيغت" }, detail: { en: "19 SME-approved, 7 in SME review, 6 needs-rework, 9 still queued.", ar: "19 معتمدة، 7 مراجعة، 6 إعادة." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a07", kind: "pricing", timestamp: "2026-04-29T11:20:00Z", agent: "pricing", title: { en: "3 pricing scenarios modelled", ar: "3 سيناريوهات" }, detail: { en: "Aggressive 134M (8.4%, under floor); Base 142M (11.2%, recommended); Floor 151M (14%).", ar: "طموح 134M، أساس 142M، حدّ 151M." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a08", kind: "checkpoint", timestamp: "2026-04-29T15:00:00Z", agent: "orch", title: { en: "Pricing checkpoint opened", ar: "نقطة التسعير" }, detail: { en: "Pause for CFO.", ar: "توقف للمدير المالي." }, tenderId: ACTIVE_TENDER_ID, checkpointId: "pricing-signoff" },
  { id: "a09", kind: "partner", timestamp: "2026-05-01T10:12:00Z", agent: "partner", title: { en: "2 of 3 LoS received (36h)", ar: "2/3 رسائل (36 ساعة)" }, detail: { en: "Partners A + B signed. Partner C silent — auto-escalation drafted.", ar: "أ + ب وقّعا؛ ج صامت." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a10", kind: "legal", timestamp: "2026-05-03T14:55:00Z", agent: "legal", title: { en: "Legal red-team flagged 2 clauses", ar: "نبّه القانوني لبندَين" }, detail: { en: "4.2 indemnity → resolved with 4.2c. 7.4 IP → resolved with 7.4a. 6.2 SLA cap under final review.", ar: "4.2 و 7.4 حُلّا؛ 6.2 قيد المراجعة." }, tenderId: ACTIVE_TENDER_ID },
  { id: "a11", kind: "compile", timestamp: "2026-05-04T08:00:00Z", agent: "compiler", title: { en: "Compiler dry-run", ar: "تجربة المُجمّع" }, detail: { en: "86-page packet draft generated for QA.", ar: "حزمة 86 صفحة للجودة." }, tenderId: ACTIVE_TENDER_ID },
];

// helpers
export function getSme(id: string): Sme | undefined { return SMES.find((s) => s.id === id); }
export function getQuestion(id: string): TenderQuestion | undefined { return ACTIVE_QUESTIONS.find((q) => q.id === id); }
export function tenderProgress(t: Tender): number {
  return Math.round((t.questionsApproved / Math.max(1, t.questionsTotal)) * 100);
}
export function formatSAR(n: number, lang: Lang = "en"): string {
  const v = n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n.toLocaleString(lang === "ar" ? "ar-SA" : "en-US");
  return lang === "ar" ? `${v} ر.س` : `SAR ${v}`;
}
export function daysUntil(iso: string, fromIso = "2026-05-05T00:00:00Z"): number {
  return Math.ceil((new Date(iso).getTime() - new Date(fromIso).getTime()) / 86_400_000);
}
