// Procurement Negotiation Agent — Category Manager Desk seed.
//
// Anchored on the cockpit scenario at
// artifacts/maven-ai/src/lib/sim/scenarios/procurement-negotiation-agent.ts
// but expanded to the breadth a user-facing sourcing console needs:
// 4 events, 12 suppliers on the active MRO event, 24 line-items, 3 rounds
// of bids, supplier 360 records, audit log, counter-bid drafts.

export type Lang = "en" | "ar";

export interface Supplier {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string;
  countryEn: string;
  countryAr: string;
  preQualified: boolean;
  preQualNotes: { en: string; ar: string };
  onTimeDeliveryPct: number;
  esgScore: number;
  paymentTermsDays: number;
  freightPctOfPrice: number;
  leadTimeDays: number;
  incumbent: boolean;
  flagsEn: string[];
  flagsAr: string[];
}

export interface LineItem {
  id: string;
  code: string;
  descriptionEn: string;
  descriptionAr: string;
  uom: string;
  qty: number;
  baselineUnitPrice: number;
}

export interface Bid {
  itemId: string;
  supplierId: string;
  round: 1 | 2 | 3;
  unitPrice: number;
}

export interface SourcingEvent {
  id: string;
  refId: string;
  titleEn: string;
  titleAr: string;
  categoryEn: string;
  categoryAr: string;
  stage: "drafting" | "live" | "evaluating" | "awarded" | "closed";
  baselineSpend: number;
  currentSavingsPct: number;
  savingsTargetPct: number;
  suppliersInvited: number;
  suppliersBidding: number;
  rounds: number;
  currentRound: number;
  closeDate: string;
  ownerEn: string;
  ownerAr: string;
}

export interface Persona {
  initials: string;
  nameEn: string;
  nameAr: string;
  roleEn: string;
  roleAr: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actorEn: string;
  actorAr: string;
  actorKind: "agent" | "user";
  agentId?: string;
  eventEn: string;
  eventAr: string;
  refId?: string;
}

export interface CounterBidDraft {
  id: string;
  supplierId: string;
  authorAgentId: string;
  subjectEn: string;
  subjectAr: string;
  bodyEn: string;
  bodyAr: string;
  status: "pending" | "sent" | "edited";
  createdAt: string;
}

export const PERSONA: Persona = {
  initials: "FH",
  nameEn: "Faisal Bin Hashim",
  nameAr: "فيصل بن هاشم",
  roleEn: "Category Manager — Indirects",
  roleAr: "مدير فئة — المشتريات غير المباشرة",
};

export const SAR = (n: number) =>
  `SAR ${Math.round(n).toLocaleString("en-US")}`;
export const SARm = (n: number) =>
  `SAR ${(n / 1_000_000).toFixed(2)}M`;

// ─── Suppliers ───────────────────────────────────────────────────────────

export const SUPPLIERS: Supplier[] = [
  { id: "sup-a", code: "ALMR", nameEn: "Al-Mashreq Industrial", nameAr: "المشرق الصناعية", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified Tier 1 · ISO 9001 · Aramco AVL", ar: "مؤهّل مسبقاً درجة 1 · ISO 9001 · قائمة أرامكو" }, onTimeDeliveryPct: 96, esgScore: 78, paymentTermsDays: 60, freightPctOfPrice: 3.2, leadTimeDays: 18, incumbent: true, flagsEn: [], flagsAr: [] },
  { id: "sup-b", code: "GLFM", nameEn: "Gulf Mechanical Trading", nameAr: "ميكانيكا الخليج", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · ISO 14001 · 7-yr supply history", ar: "مؤهّل · ISO 14001 · 7 سنوات تاريخ توريد" }, onTimeDeliveryPct: 98, esgScore: 84, paymentTermsDays: 45, freightPctOfPrice: 2.8, leadTimeDays: 12, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-c", code: "NAJM", nameEn: "Najm Logistics & Supply", nameAr: "نجم لوجستيكس", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · single-port concentration (Jeddah)", ar: "مؤهّل · تركّز ميناء واحد (جدّة)" }, onTimeDeliveryPct: 91, esgScore: 71, paymentTermsDays: 60, freightPctOfPrice: 3.6, leadTimeDays: 22, incumbent: false, flagsEn: ["Single-port concentration"], flagsAr: ["تركّز ميناء واحد"] },
  { id: "sup-d", code: "EMRT", nameEn: "Emirates MRO Holdings", nameAr: "الإمارات للصيانة", countryEn: "United Arab Emirates", countryAr: "الإمارات", preQualified: true, preQualNotes: { en: "Pre-qualified · cross-border DDP terms", ar: "مؤهّل · تسليم عابر للحدود DDP" }, onTimeDeliveryPct: 94, esgScore: 80, paymentTermsDays: 30, freightPctOfPrice: 5.1, leadTimeDays: 14, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-e", code: "BHRT", nameEn: "Bahrain Industrial Parts", nameAr: "البحرين للقطع الصناعية", countryEn: "Bahrain", countryAr: "البحرين", preQualified: true, preQualNotes: { en: "Pre-qualified · GCC origin certificate", ar: "مؤهّل · شهادة منشأ خليجية" }, onTimeDeliveryPct: 89, esgScore: 68, paymentTermsDays: 45, freightPctOfPrice: 4.2, leadTimeDays: 16, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-f", code: "RYDH", nameEn: "Riyadh Engineering Supplies", nameAr: "الرياض للتوريدات الهندسية", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · 12-month frame agreement", ar: "مؤهّل · اتفاقية إطارية 12 شهراً" }, onTimeDeliveryPct: 93, esgScore: 75, paymentTermsDays: 60, freightPctOfPrice: 3.0, leadTimeDays: 15, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-g", code: "DMMM", nameEn: "Dammam Heavy Trading", nameAr: "الدمّام للتجارة الثقيلة", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · East-coast logistics base", ar: "مؤهّل · قاعدة لوجستية شرقية" }, onTimeDeliveryPct: 92, esgScore: 73, paymentTermsDays: 60, freightPctOfPrice: 2.6, leadTimeDays: 13, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-h", code: "OMRA", nameEn: "Oman Industrial Co.", nameAr: "عمان الصناعية", countryEn: "Oman", countryAr: "عُمان", preQualified: false, preQualNotes: { en: "Pre-qual in progress · ESG audit due", ar: "تأهيل قيد المراجعة · تدقيق استدامة" }, onTimeDeliveryPct: 87, esgScore: 62, paymentTermsDays: 30, freightPctOfPrice: 5.8, leadTimeDays: 24, incumbent: false, flagsEn: ["Pre-qual incomplete"], flagsAr: ["تأهيل ناقص"] },
  { id: "sup-i", code: "QTRP", nameEn: "Qatar Procurement Partners", nameAr: "قطر للتوريد", countryEn: "Qatar", countryAr: "قطر", preQualified: true, preQualNotes: { en: "Pre-qualified · ESG amber (1 audit gap)", ar: "مؤهّل · استدامة أصفر (ثغرة تدقيق)" }, onTimeDeliveryPct: 90, esgScore: 67, paymentTermsDays: 45, freightPctOfPrice: 4.8, leadTimeDays: 18, incumbent: false, flagsEn: ["ESG audit gap"], flagsAr: ["ثغرة تدقيق استدامة"] },
  { id: "sup-j", code: "KWTM", nameEn: "Kuwait MRO Services", nameAr: "الكويت لخدمات الصيانة", countryEn: "Kuwait", countryAr: "الكويت", preQualified: true, preQualNotes: { en: "Pre-qualified · 4-yr supply history", ar: "مؤهّل · 4 سنوات تاريخ توريد" }, onTimeDeliveryPct: 88, esgScore: 70, paymentTermsDays: 45, freightPctOfPrice: 5.4, leadTimeDays: 20, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-k", code: "JEDD", nameEn: "Jeddah Maritime Supplies", nameAr: "جدّة للتوريدات البحرية", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · port-side warehousing", ar: "مؤهّل · مستودعات مينائية" }, onTimeDeliveryPct: 95, esgScore: 76, paymentTermsDays: 30, freightPctOfPrice: 2.4, leadTimeDays: 11, incumbent: false, flagsEn: [], flagsAr: [] },
  { id: "sup-l", code: "ALKH", nameEn: "Al-Khobar Industrial Group", nameAr: "مجموعة الخبر الصناعية", countryEn: "Saudi Arabia", countryAr: "السعودية", preQualified: true, preQualNotes: { en: "Pre-qualified · LGTM frame partner", ar: "مؤهّل · شريك إطار LGTM" }, onTimeDeliveryPct: 94, esgScore: 81, paymentTermsDays: 60, freightPctOfPrice: 2.9, leadTimeDays: 14, incumbent: false, flagsEn: [], flagsAr: [] },
];

// ─── Line items (24, MRO-flavoured) ──────────────────────────────────────

export const LINE_ITEMS: LineItem[] = [
  { id: "li-01", code: "VLV-150-CS", descriptionEn: "Carbon-steel gate valve, 150# class, 4\"", descriptionAr: "صمّام بوابة فولاذ كربوني، فئة 150، 4\"", uom: "EA", qty: 480, baselineUnitPrice: 2150 },
  { id: "li-02", code: "VLV-300-SS", descriptionEn: "Stainless gate valve, 300# class, 6\"", descriptionAr: "صمّام بوابة ستانلس، فئة 300، 6\"", uom: "EA", qty: 220, baselineUnitPrice: 4380 },
  { id: "li-03", code: "PMP-CTR-50", descriptionEn: "Centrifugal pump, 50 m³/h, API 610", descriptionAr: "مضخّة طاردة مركزية، 50 م³/س، API 610", uom: "EA", qty: 36, baselineUnitPrice: 28400 },
  { id: "li-04", code: "BRG-SKF-62", descriptionEn: "Deep-groove ball bearing 6210-2RS", descriptionAr: "محمل كرات 6210-2RS", uom: "EA", qty: 1800, baselineUnitPrice: 142 },
  { id: "li-05", code: "FLT-OIL-HD", descriptionEn: "Hydraulic oil filter, 25-micron", descriptionAr: "مرشّح زيت هيدروليكي 25 ميكرون", uom: "EA", qty: 960, baselineUnitPrice: 218 },
  { id: "li-06", code: "FLT-AIR-IN", descriptionEn: "Compressor intake air filter", descriptionAr: "مرشّح هواء سحب الضاغط", uom: "EA", qty: 540, baselineUnitPrice: 184 },
  { id: "li-07", code: "GSK-SPW-04", descriptionEn: "Spiral-wound gasket 4\" 150#", descriptionAr: "حشية لولبية 4\" 150#", uom: "EA", qty: 2400, baselineUnitPrice: 38 },
  { id: "li-08", code: "FST-A193-B7", descriptionEn: "Stud bolt set ASTM A193-B7", descriptionAr: "طقم برغي A193-B7", uom: "SET", qty: 1500, baselineUnitPrice: 96 },
  { id: "li-09", code: "ELC-CBL-3X35", descriptionEn: "LV power cable 3×35 mm² armoured", descriptionAr: "كابل قوى LV 3×35 مم² مدرّع", uom: "M", qty: 12000, baselineUnitPrice: 84 },
  { id: "li-10", code: "ELC-CBL-INST", descriptionEn: "Instrument cable 4-pair, IS", descriptionAr: "كابل قياس 4 أزواج IS", uom: "M", qty: 8000, baselineUnitPrice: 36 },
  { id: "li-11", code: "INS-PT-100", descriptionEn: "RTD temperature sensor PT-100", descriptionAr: "حسّاس حرارة PT-100", uom: "EA", qty: 320, baselineUnitPrice: 412 },
  { id: "li-12", code: "INS-PRS-XMT", descriptionEn: "Pressure transmitter, 0–40 bar", descriptionAr: "ناقل ضغط 0–40 بار", uom: "EA", qty: 180, baselineUnitPrice: 1980 },
  { id: "li-13", code: "PIP-CS-A106-6", descriptionEn: "Carbon steel pipe A106-B, 6\" SCH40", descriptionAr: "أنبوب فولاذ A106-B 6\" SCH40", uom: "M", qty: 4200, baselineUnitPrice: 312 },
  { id: "li-14", code: "PIP-SS-316-4", descriptionEn: "SS 316L pipe, 4\" SCH10", descriptionAr: "أنبوب SS 316L 4\" SCH10", uom: "M", qty: 1800, baselineUnitPrice: 686 },
  { id: "li-15", code: "WLD-ROD-7018", descriptionEn: "Welding electrode E7018, 3.2 mm", descriptionAr: "إلكترود لحام E7018 3.2 مم", uom: "KG", qty: 2400, baselineUnitPrice: 42 },
  { id: "li-16", code: "PNT-EPX-25", descriptionEn: "Epoxy coating, 25 L drum", descriptionAr: "طلاء إيبوكسي 25 لتر", uom: "DRUM", qty: 320, baselineUnitPrice: 1240 },
  { id: "li-17", code: "PPE-HLM-V", descriptionEn: "Industrial helmet with visor", descriptionAr: "خوذة صناعية بحاجب", uom: "EA", qty: 1200, baselineUnitPrice: 96 },
  { id: "li-18", code: "PPE-GLV-CR5", descriptionEn: "Cut-resistant gloves, level 5", descriptionAr: "قفازات مقاومة للقطع مستوى 5", uom: "PR", qty: 4800, baselineUnitPrice: 28 },
  { id: "li-19", code: "TLS-IMP-WR", descriptionEn: "Pneumatic impact wrench, 1\" drive", descriptionAr: "مفتاح ربط هوائي 1\"", uom: "EA", qty: 48, baselineUnitPrice: 2840 },
  { id: "li-20", code: "TLS-TRQ-WR", descriptionEn: "Hydraulic torque wrench kit", descriptionAr: "طقم مفتاح ربط هيدروليكي", uom: "SET", qty: 24, baselineUnitPrice: 18400 },
  { id: "li-21", code: "MTR-IND-30", descriptionEn: "Induction motor, 30 kW, IE3", descriptionAr: "محرّك حثّي 30 kW IE3", uom: "EA", qty: 36, baselineUnitPrice: 14200 },
  { id: "li-22", code: "VFD-30KW", descriptionEn: "Variable freq. drive, 30 kW", descriptionAr: "محرّك تردد متغيّر 30 kW", uom: "EA", qty: 30, baselineUnitPrice: 9800 },
  { id: "li-23", code: "HVC-FCU-5T", descriptionEn: "Fan coil unit, 5 ton", descriptionAr: "وحدة مروحة ملف 5 طن", uom: "EA", qty: 60, baselineUnitPrice: 6200 },
  { id: "li-24", code: "FRP-EXT-9KG", descriptionEn: "Fire extinguisher, dry chemical 9 kg", descriptionAr: "طفاية حريق كيميائية 9 كجم", uom: "EA", qty: 240, baselineUnitPrice: 184 },
];

// Per-supplier discount factors per round (deterministic, demo-friendly).
// Round 1 baseline factor of ~0.97 (3% below baseline median),
// Round 2 tightens, Round 3 tightens further.
const SUP_FACTORS: Record<string, [number, number, number]> = {
  "sup-a": [0.965, 0.945, 0.928], // best-price track (Supplier A)
  "sup-b": [0.972, 0.953, 0.939], // best-other-tradeoff (Supplier B)
  "sup-c": [0.985, 0.974, 0.960],
  "sup-d": [0.978, 0.960, 0.948],
  "sup-e": [0.992, 0.978, 0.965],
  "sup-f": [0.974, 0.962, 0.951],
  "sup-g": [0.981, 0.968, 0.955],
  "sup-h": [1.005, 0.998, 0.989],
  "sup-i": [0.996, 0.985, 0.974],
  "sup-j": [0.989, 0.977, 0.966],
  "sup-k": [0.976, 0.961, 0.946],
  "sup-l": [0.971, 0.958, 0.944],
};

// Per-item supplier-specific jitter so the bid matrix isn't uniform.
function jitter(itemId: string, supplierId: string): number {
  let h = 0;
  const s = `${itemId}:${supplierId}`;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff;
  // map to [-0.025, +0.025]
  return ((h / 0xffff) * 0.05) - 0.025;
}

export const BIDS: Bid[] = (() => {
  const out: Bid[] = [];
  for (const item of LINE_ITEMS) {
    for (const sup of SUPPLIERS) {
      const factors = SUP_FACTORS[sup.id];
      const j = jitter(item.id, sup.id);
      for (let r = 0; r < 3; r++) {
        const factor = factors[r] + j;
        const unitPrice = Math.round(item.baselineUnitPrice * factor * 100) / 100;
        out.push({ itemId: item.id, supplierId: sup.id, round: (r + 1) as 1 | 2 | 3, unitPrice });
      }
    }
  }
  return out;
})();

export function getBid(itemId: string, supplierId: string, round: 1 | 2 | 3): Bid | undefined {
  return BIDS.find((b) => b.itemId === itemId && b.supplierId === supplierId && b.round === round);
}

export function totalBaseline(): number {
  return LINE_ITEMS.reduce((s, it) => s + it.baselineUnitPrice * it.qty, 0);
}

export function totalForSupplier(supplierId: string, round: 1 | 2 | 3): number {
  return LINE_ITEMS.reduce((s, it) => {
    const b = getBid(it.id, supplierId, round);
    return s + (b ? b.unitPrice * it.qty : 0);
  }, 0);
}

// TCO = price + freight + payment-terms NPV penalty + lead-time risk premium
// + sustainability discount. Pure demo formula; tuned for realistic deltas.
export function tcoForSupplier(supplierId: string, round: 1 | 2 | 3): number {
  const sup = SUPPLIERS.find((s) => s.id === supplierId)!;
  const price = totalForSupplier(supplierId, round);
  const freight = price * (sup.freightPctOfPrice / 100);
  const termsAdj = price * ((60 - sup.paymentTermsDays) / 60) * 0.01; // shorter terms cost more
  const leadAdj = price * ((sup.leadTimeDays - 14) / 14) * 0.005;
  const esgAdj = -price * ((sup.esgScore - 70) / 100) * 0.01;
  return Math.max(0, price + freight + termsAdj + leadAdj + esgAdj);
}

export function savingsPctVsBaseline(value: number): number {
  const base = totalBaseline();
  return ((base - value) / base) * 100;
}

// ─── Events ──────────────────────────────────────────────────────────────

export const EVENTS: SourcingEvent[] = [
  {
    id: "evt-mro",
    refId: "RFQ-2026-Q2-MRO-014",
    titleEn: "MRO consumables & rotating spares — 24 line items",
    titleAr: "مستهلكات الصيانة والقطع الدوّارة — 24 بنداً",
    categoryEn: "MRO · Indirects",
    categoryAr: "صيانة · غير مباشر",
    stage: "evaluating",
    baselineSpend: totalBaseline(),
    currentSavingsPct: savingsPctVsBaseline(totalForSupplier("sup-a", 3)),
    savingsTargetPct: 6.0,
    suppliersInvited: 18,
    suppliersBidding: 12,
    rounds: 3,
    currentRound: 3,
    closeDate: "2026-05-08",
    ownerEn: "Faisal Bin Hashim",
    ownerAr: "فيصل بن هاشم",
  },
  {
    id: "evt-log",
    refId: "RFQ-2026-Q2-LOG-007",
    titleEn: "Port handling services — Jeddah hub",
    titleAr: "خدمات مناولة الموانئ — جدّة",
    categoryEn: "Logistics",
    categoryAr: "لوجستيات",
    stage: "live",
    baselineSpend: 4_180_000,
    currentSavingsPct: 4.8,
    savingsTargetPct: 6.4,
    suppliersInvited: 6,
    suppliersBidding: 5,
    rounds: 2,
    currentRound: 2,
    closeDate: "2026-05-09",
    ownerEn: "Faisal Bin Hashim",
    ownerAr: "فيصل بن هاشم",
  },
  {
    id: "evt-it",
    refId: "RFQ-2026-Q2-IT-031",
    titleEn: "Endpoint laptops · 1,200 seats",
    titleAr: "أجهزة لابتوب للنهايات · 1,200 مقعد",
    categoryEn: "IT Hardware",
    categoryAr: "أجهزة تقنية",
    stage: "drafting",
    baselineSpend: 9_600_000,
    currentSavingsPct: 0,
    savingsTargetPct: 8.0,
    suppliersInvited: 0,
    suppliersBidding: 0,
    rounds: 0,
    currentRound: 0,
    closeDate: "2026-06-15",
    ownerEn: "Layla Al-Sayed",
    ownerAr: "ليلى السيّد",
  },
  {
    id: "evt-fac",
    refId: "RFQ-2026-Q1-FAC-022",
    titleEn: "Facilities cleaning · 14 sites",
    titleAr: "خدمات نظافة المرافق · 14 موقعاً",
    categoryEn: "Facilities",
    categoryAr: "مرافق",
    stage: "awarded",
    baselineSpend: 3_240_000,
    currentSavingsPct: 7.1,
    savingsTargetPct: 5.5,
    suppliersInvited: 8,
    suppliersBidding: 6,
    rounds: 3,
    currentRound: 3,
    closeDate: "2026-04-12",
    ownerEn: "Faisal Bin Hashim",
    ownerAr: "فيصل بن هاشم",
  },
];

export function getEvent(id: string): SourcingEvent | undefined {
  return EVENTS.find((e) => e.id === id);
}

// ─── Audit log ───────────────────────────────────────────────────────────

export const AUDIT_LOG: AuditEntry[] = [
  { id: "au-01", ts: "2026-05-05T07:42:00Z", actorEn: "Negotiation Conductor", actorAr: "منسّق التفاوض", actorKind: "agent", agentId: "orch", eventEn: "Round 3 closed at 10:00 — 12/12 suppliers responded", eventAr: "أُغلقت الجولة 3 الساعة 10:00 — استجابة 12/12 مورّد", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-02", ts: "2026-05-05T07:55:00Z", actorEn: "Category Analyst", actorAr: "محلّل الفئة", actorKind: "agent", agentId: "spend", eventEn: "Bid matrix scored against baseline; 6.3% achieved (target 6.0%)", eventAr: "قياس مصفوفة العروض مقابل الأساس؛ 6.3% (الهدف 6.0%)", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-03", ts: "2026-05-05T08:04:00Z", actorEn: "Round Strategist", actorAr: "خبير الجولات", actorKind: "agent", agentId: "round", eventEn: "Recommended ending negotiation; no BAFO call required", eventAr: "يوصي بإنهاء التفاوض دون جولة BAFO", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-04", ts: "2026-05-05T08:21:00Z", actorEn: "Award Critic", actorAr: "ناقد الترسية", actorKind: "agent", agentId: "critic", eventEn: "Recommends 70/30 split: Supplier A (lowest TCO) + Supplier B (lead-time, pre-qualified)", eventAr: "يوصي بتقسيم 70/30: المورد A (أقل تكلفة شاملة) + B (وقت تسليم وتأهيل مسبق)", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-05", ts: "2026-05-05T08:38:00Z", actorEn: "Counter-bid Drafter", actorAr: "كاتب العرض المضادّ", actorKind: "agent", agentId: "drafter", eventEn: "Drafted revised counter for Supplier C — pending buyer review", eventAr: "صياغة عرض مضادّ منقّح للمورد C — بانتظار مراجعة المشتري", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-06", ts: "2026-05-05T09:14:00Z", actorEn: "TCO Compiler", actorAr: "مُجمِّع التكلفة الشاملة", actorKind: "agent", agentId: "tco", eventEn: "TCO overlay computed across freight, payment terms, lead-time, ESG", eventAr: "حساب التكلفة الشاملة عبر الشحن وشروط الدفع وزمن التسليم والاستدامة", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-07", ts: "2026-05-04T16:02:00Z", actorEn: "Faisal Bin Hashim", actorAr: "فيصل بن هاشم", actorKind: "user", eventEn: "Approved Round 3 invite for 12 suppliers", eventAr: "اعتماد دعوة الجولة 3 لـ 12 مورّداً", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-08", ts: "2026-05-04T11:28:00Z", actorEn: "Negotiation Conductor", actorAr: "منسّق التفاوض", actorKind: "agent", agentId: "orch", eventEn: "Round 2 closed; 9.4% gap to target — Round 3 triggered", eventAr: "أُغلقت الجولة 2؛ فجوة 9.4% — تشغيل الجولة 3", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-09", ts: "2026-05-03T14:55:00Z", actorEn: "Category Analyst", actorAr: "محلّل الفئة", actorKind: "agent", agentId: "spend", eventEn: "24-month spend triangulation completed for MRO category", eventAr: "اكتمال تحليل إنفاق 24 شهراً لفئة الصيانة", refId: "RFQ-2026-Q2-MRO-014" },
  { id: "au-10", ts: "2026-05-02T09:12:00Z", actorEn: "Negotiation Conductor", actorAr: "منسّق التفاوض", actorKind: "agent", agentId: "orch", eventEn: "Counter-offer received from Najm Logistics — port handling RFP", eventAr: "وصول عرض مضادّ من نجم لوجستيكس — مناقصة مناولة الموانئ", refId: "RFQ-2026-Q2-LOG-007" },
];

// ─── Counter-bid drafts ──────────────────────────────────────────────────

export const COUNTER_DRAFTS: CounterBidDraft[] = [
  {
    id: "cb-01",
    supplierId: "sup-c",
    authorAgentId: "drafter",
    subjectEn: "RFQ-2026-Q2-MRO-014 · Counter to your Round 3 submission",
    subjectAr: "RFQ-2026-Q2-MRO-014 · عرض مضادّ لردّكم في الجولة 3",
    bodyEn: "Dear Najm Logistics team,\n\nThank you for your Round 3 submission on RFQ-2026-Q2-MRO-014. After triangulation against the active bid range, we have prepared a counter-position:\n\n• Pricing: a further 3.4% reduction on items LI-13 (CS pipe) and LI-15 (welding rod) would put your aggregate within the awardable band.\n• Lead-time: please commit to a 14-day lead-time on LI-03 and LI-21 (or propose a dual-port logistics plan if your single-port concentration cannot be lifted).\n• Payment terms: maintain at 60 days net.\n\nThis communication is non-binding and subject to internal approvals. Please respond by Friday EOD.\n\nWith respect,\nFaisal Bin Hashim · Category Manager — Indirects",
    bodyAr: "فريق نجم لوجستيكس،\n\nشكراً لتقديمكم في الجولة 3 على المناقصة RFQ-2026-Q2-MRO-014. بعد التحليل مقابل نطاق العروض، نضع موقفاً تفاوضياً:\n\n• السعر: تخفيض إضافي 3.4% على البندين LI-13 (أنبوب CS) و LI-15 (إلكترود لحام) يضع إجمالي عرضكم ضمن النطاق القابل للترسية.\n• زمن التسليم: التزام بزمن 14 يوماً على LI-03 و LI-21 (أو اقتراح خطة ميناءين إذا تعذّر رفع تركّز ميناء واحد).\n• شروط الدفع: 60 يوماً صافي.\n\nهذه المراسلة غير ملزمة ومرهونة بالموافقات الداخلية. الرجاء الردّ بنهاية يوم الجمعة.\n\nمع التقدير،\nفيصل بن هاشم · مدير فئة — المشتريات غير المباشرة",
    status: "pending",
    createdAt: "2026-05-05T08:38:00Z",
  },
  {
    id: "cb-02",
    supplierId: "sup-h",
    authorAgentId: "drafter",
    subjectEn: "Pre-qualification reminder · ESG audit gap",
    subjectAr: "تذكير بالتأهيل · ثغرة تدقيق استدامة",
    bodyEn: "Dear Oman Industrial team,\n\nYour Round 3 bid on RFQ-2026-Q2-MRO-014 is competitive on price, but our award gating requires completed pre-qualification including the outstanding ESG social-audit submission.\n\nPlease upload the missing audit by Wednesday so the Award Critic can re-score. We can hold the award decision until end of next week if the audit is delivered on time.\n\nNon-binding — subject to internal approvals.",
    bodyAr: "فريق عمان الصناعية،\n\nعرضكم في الجولة 3 على المناقصة RFQ-2026-Q2-MRO-014 تنافسي سعراً، لكن بوّابة الترسية لدينا تتطلب اكتمال التأهيل بما في ذلك تقديم تدقيق الاستدامة المعلّق.\n\nالرجاء رفع التدقيق الناقص بحلول الأربعاء لإعادة احتساب نتائج التقييم. يمكننا تأجيل الترسية حتى نهاية الأسبوع القادم.\n\nغير ملزمة ومرهونة بالموافقات الداخلية.",
    status: "pending",
    createdAt: "2026-05-05T09:02:00Z",
  },
];

// ─── Notifications (for header bell) ─────────────────────────────────────

export interface DeskNotification {
  id: string;
  severity: "critical" | "high" | "medium";
  titleEn: string;
  titleAr: string;
  subEn: string;
  subAr: string;
  ts: string;
  view: string;
}

export const NOTIFICATIONS: DeskNotification[] = [
  { id: "n-01", severity: "critical", titleEn: "Award decision waiting — MRO event", titleAr: "قرار ترسية بانتظار — فئة الصيانة", subEn: "Award Critic recommends 70/30 split A/B", subAr: "ناقد الترسية يوصي بتقسيم 70/30 A/B", ts: "11:14", view: "approvals" },
  { id: "n-02", severity: "high", titleEn: "Counter-bid drafted for Najm (Supplier C)", titleAr: "صياغة عرض مضادّ لنجم (المورد C)", subEn: "Counter-bid Drafter · awaiting send", subAr: "كاتب العرض المضادّ · بانتظار الإرسال", ts: "10:54", view: "counter" },
  { id: "n-03", severity: "high", titleEn: "ESG audit gap — Oman Industrial", titleAr: "ثغرة تدقيق استدامة — عمان الصناعية", subEn: "Pre-qual incomplete; reminder drafted", subAr: "تأهيل ناقص؛ تم صياغة تذكير", ts: "10:33", view: "suppliers" },
  { id: "n-04", severity: "medium", titleEn: "BAFO not required — Round 3 closed", titleAr: "لا حاجة لـ BAFO — أُغلقت الجولة 3", subEn: "Round Strategist · stop further rounds", subAr: "خبير الجولات · إيقاف الجولات", ts: "10:12", view: "workspace" },
];
