// Customer Care Hive — seed data for the Care Agent Desk demo.
//
// Bilingual entities for Aisha Bin Ahmed's shift on Tuesday May 6 2026 09:30.
// Data shape mirrors the cockpit scenario in customer-care-hive.ts plus the
// breadth needed to populate 6 views (queue, approvals, supervisor strip,
// knowledge, audit, desk).

export type Lang = "en" | "ar";
export interface BiText { en: string; ar: string }

export type Channel = "whatsapp" | "webchat" | "email" | "voice";
export type Sentiment = "happy" | "neutral" | "frustrated" | "angry";
export type ConvStatus = "active" | "awaiting-customer" | "awaiting-human" | "resolved";
export type Priority = "low" | "medium" | "high" | "critical";
export type Intent =
  | "billing.duplicate" | "billing.dispute" | "billing.refund"
  | "delivery.wrong" | "delivery.late" | "delivery.damaged"
  | "account.access" | "plan.upgrade" | "plan.cancel"
  | "tech.connectivity" | "tech.device" | "kb.howto" | "complaint";

export interface CareAgent {
  id: string;
  nameEn: string;
  nameAr: string;
  role: BiText;
  occupancy: number;
  ahtMins: number;
  fcr: number;
  isMe?: boolean;
  shift: string;
  status: "available" | "busy" | "wrap" | "break";
}

export interface CareCustomer {
  id: string;
  nameEn: string;
  nameAr: string;
  segmentEn: string;
  segmentAr: string;
  clvSAR: number;
  tenureYears: number;
  lastTouchEn: string;
  lastTouchAr: string;
  productsEn: string;
  productsAr: string;
  activeOrders: number;
  sentimentTrend: number[];
}

export interface KbArticle {
  id: string;
  titleEn: string;
  titleAr: string;
  categoryEn: string;
  categoryAr: string;
  uses7d: number;
  csat: number;
  excerptEn: string;
  excerptAr: string;
}

export interface ConvMessage {
  id: string;
  from: "customer" | "agent" | "ai-draft" | "system";
  authorEn?: string;
  authorAr?: string;
  textEn: string;
  textAr: string;
  ts: string;
  isDraft?: boolean;
  draftedByAgentId?: string;
  confidence?: number;
}

export interface CareConversation {
  id: string;
  customerId: string;
  channel: Channel;
  intent: Intent;
  sentiment: Sentiment;
  priority: Priority;
  status: ConvStatus;
  subjectEn: string;
  subjectAr: string;
  summaryEn: string;
  summaryAr: string;
  slaRemainMins: number;
  lastTouchAgo: string;
  touches: number;
  assignedAgentId: string;
  hasAiDraft: boolean;
  hasRefundCard?: boolean;
  kbHits: string[];
  thread?: ConvMessage[];
  goodwillSAR?: number;
}

export interface CareCheckpoint {
  id: string;
  fromCockpit: boolean;
  scenarioId?: string;
  human: BiText;
  question: BiText;
  rationale: BiText;
  options: { id: string; label: BiText; recommended?: boolean }[];
  conversationId?: string;
  agentId: string;
  confidence: number;
  severity: "critical" | "high" | "medium" | "info";
}

export interface AgentRecommendation {
  id: string;
  agentId: string;
  title: BiText;
  rationale: BiText;
  confidence: number;
  severity: "critical" | "high" | "medium" | "info";
  recordType: "conversation";
  recordId: string;
  recommendedAction: BiText;
  alternateActions: BiText[];
  generatedAt: string;
}

export interface CareNotification {
  id: string;
  textEn: string;
  textAr: string;
  time: string;
  severity: "critical" | "high" | "medium" | "info";
  conversationId?: string;
}

export interface AuditEntry {
  id: string;
  ts: string;
  actorEn: string;
  actorAr: string;
  isAi: boolean;
  actionEn: string;
  actionAr: string;
  detailEn: string;
  detailAr: string;
  conversationId: string;
}

export interface KbSuggestion {
  id: string;
  titleEn: string;
  titleAr: string;
  reasonEn: string;
  reasonAr: string;
  fromCount: number;
  agentId: string;
}

export interface ChannelQueue {
  channel: Channel;
  open: number;
  oldestWaitMins: number;
  agentsOnChannel: number;
}

// ─── Agents ─────────────────────────────────────────────────────────────

export const AISHA_ID = "agent-aisha";

export const CARE_AGENTS: CareAgent[] = [
  { id: AISHA_ID, nameEn: "Aisha Bin Ahmed", nameAr: "عائشة بن أحمد", role: { en: "Senior Care Agent", ar: "موظفة رعاية أولى" }, occupancy: 78, ahtMins: 6.4, fcr: 84, isMe: true, shift: "08:00–16:00", status: "busy" },
  { id: "agent-omar", nameEn: "Omar Al-Harbi", nameAr: "عمر الحربي", role: { en: "Care Agent", ar: "موظف رعاية" }, occupancy: 92, ahtMins: 7.1, fcr: 76, shift: "08:00–16:00", status: "busy" },
  { id: "agent-fatima", nameEn: "Fatima Al-Saud", nameAr: "فاطمة آل سعود", role: { en: "Senior Care Agent", ar: "موظفة رعاية أولى" }, occupancy: 64, ahtMins: 5.8, fcr: 88, shift: "08:00–16:00", status: "available" },
  { id: "agent-yousef", nameEn: "Yousef Al-Otaibi", nameAr: "يوسف العتيبي", role: { en: "Care Agent", ar: "موظف رعاية" }, occupancy: 41, ahtMins: 6.0, fcr: 81, shift: "10:00–18:00", status: "available" },
  { id: "agent-noura", nameEn: "Noura Al-Anazi", nameAr: "نورة العنزي", role: { en: "Care Agent", ar: "موظفة رعاية" }, occupancy: 88, ahtMins: 6.9, fcr: 79, shift: "08:00–16:00", status: "busy" },
  { id: "agent-khalid", nameEn: "Khalid Al-Mutairi", nameAr: "خالد المطيري", role: { en: "Tier-2 Specialist", ar: "أخصائي مستوى 2" }, occupancy: 57, ahtMins: 9.2, fcr: 91, shift: "09:00–17:00", status: "available" },
  { id: "agent-hala", nameEn: "Hala Al-Zahrani", nameAr: "هالة الزهراني", role: { en: "Care Agent", ar: "موظفة رعاية" }, occupancy: 73, ahtMins: 6.2, fcr: 82, shift: "09:00–17:00", status: "busy" },
  { id: "agent-saud", nameEn: "Saud Al-Qahtani", nameAr: "سعود القحطاني", role: { en: "Care Agent", ar: "موظف رعاية" }, occupancy: 35, ahtMins: 5.5, fcr: 80, shift: "10:00–18:00", status: "wrap" },
  { id: "agent-rana", nameEn: "Rana Al-Dosari", nameAr: "رنا الدوسري", role: { en: "Senior Care Agent", ar: "موظفة رعاية أولى" }, occupancy: 81, ahtMins: 6.7, fcr: 86, shift: "10:00–18:00", status: "busy" },
  { id: "agent-bandar", nameEn: "Bandar Al-Shehri", nameAr: "بندر الشهري", role: { en: "Care Agent", ar: "موظف رعاية" }, occupancy: 0, ahtMins: 6.3, fcr: 78, shift: "08:00–16:00", status: "break" },
  { id: "agent-lina", nameEn: "Lina Al-Ghamdi", nameAr: "لينا الغامدي", role: { en: "Tier-2 Specialist", ar: "أخصائية مستوى 2" }, occupancy: 69, ahtMins: 8.4, fcr: 90, shift: "09:00–17:00", status: "busy" },
  { id: "agent-tariq", nameEn: "Tariq Al-Subaie", nameAr: "طارق السبيعي", role: { en: "Care Agent", ar: "موظف رعاية" }, occupancy: 52, ahtMins: 6.0, fcr: 77, shift: "10:00–18:00", status: "available" },
];

// ─── Customers ──────────────────────────────────────────────────────────

export const CARE_CUSTOMERS: CareCustomer[] = [
  { id: "cust-layla", nameEn: "Layla Q.", nameAr: "ليلى ق.", segmentEn: "Postpaid · 4y tenure", segmentAr: "شهرية · 4 سنوات", clvSAR: 11400, tenureYears: 4, lastTouchEn: "2 days ago — bill query (resolved)", lastTouchAr: "قبل يومين — استفسار فاتورة (محلول)", productsEn: "Postpaid 99 · Fiber 200Mb · iPhone 15", productsAr: "شهرية 99 · فايبر 200م · آيفون 15", activeOrders: 1, sentimentTrend: [3, 3, 2, 2, 1] },
  { id: "cust-mohammed", nameEn: "Mohammed K.", nameAr: "محمد ك.", segmentEn: "Enterprise · 7y", segmentAr: "مؤسسي · 7 سنوات", clvSAR: 184000, tenureYears: 7, lastTouchEn: "Today — roaming pack query", lastTouchAr: "اليوم — استفسار باقة تجوال", productsEn: "Enterprise 50-line · Fiber 1Gb", productsAr: "خط مؤسسي 50 · فايبر 1ج", activeOrders: 0, sentimentTrend: [4, 4, 3, 3, 3] },
  { id: "cust-sara", nameEn: "Sara H.", nameAr: "سارة ه.", segmentEn: "Postpaid · 2y", segmentAr: "شهرية · سنتان", clvSAR: 5100, tenureYears: 2, lastTouchEn: "Last week — plan upgrade", lastTouchAr: "الأسبوع الماضي — ترقية باقة", productsEn: "Postpaid 199 · Galaxy S24", productsAr: "شهرية 199 · جالاكسي S24", activeOrders: 0, sentimentTrend: [3, 4, 4, 4, 4] },
  { id: "cust-yousef", nameEn: "Yousef R.", nameAr: "يوسف ر.", segmentEn: "Postpaid · 1y", segmentAr: "شهرية · سنة", clvSAR: 2800, tenureYears: 1, lastTouchEn: "Today — connectivity issue", lastTouchAr: "اليوم — مشكلة اتصال", productsEn: "Postpaid 79 · Pixel 8", productsAr: "شهرية 79 · بكسل 8", activeOrders: 0, sentimentTrend: [3, 3, 3, 2, 2] },
  { id: "cust-ahmed", nameEn: "Ahmed B.", nameAr: "أحمد ب.", segmentEn: "Prepaid · 5y", segmentAr: "مسبق الدفع · 5 سنوات", clvSAR: 6200, tenureYears: 5, lastTouchEn: "Yesterday — top-up", lastTouchAr: "أمس — شحن", productsEn: "Prepaid 50/mo", productsAr: "مسبق الدفع 50/شهر", activeOrders: 0, sentimentTrend: [4, 4, 4, 4, 4] },
  { id: "cust-nadia", nameEn: "Nadia M.", nameAr: "نادية م.", segmentEn: "Postpaid · 3y", segmentAr: "شهرية · 3 سنوات", clvSAR: 8400, tenureYears: 3, lastTouchEn: "Last month — device upgrade", lastTouchAr: "الشهر الماضي — ترقية جهاز", productsEn: "Postpaid 149 · Mate 60", productsAr: "شهرية 149 · ميت 60", activeOrders: 1, sentimentTrend: [3, 3, 3, 3, 3] },
  { id: "cust-faisal", nameEn: "Faisal T.", nameAr: "فيصل ت.", segmentEn: "Enterprise · 4y", segmentAr: "مؤسسي · 4 سنوات", clvSAR: 96000, tenureYears: 4, lastTouchEn: "Today — invoice dispute", lastTouchAr: "اليوم — اعتراض على فاتورة", productsEn: "Enterprise 20-line · Fiber 500Mb", productsAr: "مؤسسي 20 خط · فايبر 500م", activeOrders: 0, sentimentTrend: [3, 3, 2, 2, 2] },
  { id: "cust-hessa", nameEn: "Hessa A.", nameAr: "حصة أ.", segmentEn: "Postpaid · 6y", segmentAr: "شهرية · 6 سنوات", clvSAR: 18900, tenureYears: 6, lastTouchEn: "3 days ago — KB self-served", lastTouchAr: "قبل 3 أيام — حلّ ذاتي", productsEn: "Postpaid 249 · Fiber 1Gb · 2x iPhone 15", productsAr: "شهرية 249 · فايبر 1ج · 2 آيفون 15", activeOrders: 0, sentimentTrend: [4, 4, 4, 5, 5] },
];

// ─── KB articles ────────────────────────────────────────────────────────

export const KB_ARTICLES: KbArticle[] = [
  { id: "kb-001", titleEn: "Resolving duplicate charges on postpaid invoices", titleAr: "حلّ الخصومات المكرّرة على الفواتير الشهرية", categoryEn: "Billing", categoryAr: "الفوترة", uses7d: 412, csat: 4.6, excerptEn: "When the system retries an invoice run, customers may see two identical charges. Issue an auto-credit equal to the duplicate amount within 24h.", excerptAr: "عند إعادة محاولة الفوترة قد يظهر للعميل خصمان متطابقان. أصدر ائتماناً آلياً يساوي المبلغ المكرّر خلال 24 ساعة." },
  { id: "kb-002", titleEn: "Goodwill credit policy — tenure thresholds", titleAr: "سياسة ائتمان التعويض — حدود مدة العميل", categoryEn: "Policy", categoryAr: "السياسات", uses7d: 287, csat: 4.4, excerptEn: "Customers with ≥3y tenure qualify for a SAR 50 goodwill credit on any service-failure incident. ≥6y qualify for SAR 100.", excerptAr: "العملاء بـ ≥3 سنوات يستحقون ائتمان 50 ريالاً عند أي إخفاق خدمي. ≥6 سنوات يستحقون 100 ريال." },
  { id: "kb-003", titleEn: "Wrong-delivery re-routing — same-day windows", titleAr: "إعادة توجيه التسليم الخاطئ — نوافذ اليوم نفسه", categoryEn: "Logistics", categoryAr: "اللوجستيات", uses7d: 198, csat: 4.5, excerptEn: "If the OMS shows wrong-address delivery, same-day re-delivery slots are available before 14:00 in Tier-1 cities.", excerptAr: "إذا أظهر OMS تسليماً لعنوان خاطئ، تتوفّر نوافذ إعادة تسليم في اليوم نفسه قبل 14:00 في مدن المستوى الأول." },
  { id: "kb-004", titleEn: "Enterprise roaming entitlement — addendum lookup", titleAr: "استحقاق التجوال للمؤسسات — البحث في الملاحق", categoryEn: "Enterprise", categoryAr: "مؤسسي", uses7d: 86, csat: 3.9, excerptEn: "EU roaming on enterprise contracts is governed by Addendum-7. Resolver agents do not have addendum read access; escalate to Tier-2.", excerptAr: "تجوال الاتحاد الأوروبي للعقود المؤسسية يحكمه الملحق 7. ليس لدى الكاتب الآلي صلاحية قراءته؛ صعّد للمستوى 2." },
  { id: "kb-005", titleEn: "Mudad refund SLAs — same-day vs T+1", titleAr: "SLAs استرداد مدد — يوم/يومان", categoryEn: "Billing", categoryAr: "الفوترة", uses7d: 154, csat: 4.3, excerptEn: "Refunds < SAR 500 settle same-day. Refunds ≥ SAR 500 settle T+1 (next business day).", excerptAr: "الاستردادات < 500 ريالاً تُسدّد في اليوم نفسه. ≥ 500 ريالاً تُسدّد في يوم العمل التالي." },
  { id: "kb-006", titleEn: "Connectivity drop — first three diagnostics", titleAr: "انقطاع الاتصال — التشخيصات الثلاثة الأولى", categoryEn: "Tech", categoryAr: "التقنية", uses7d: 332, csat: 4.2, excerptEn: "Run cell-tower health, SIM-IMSI status, and OOS coverage checks in parallel before any device-level diagnostic.", excerptAr: "افحص صحة البرج وحالة SIM وتغطية OOS بالتوازي قبل أي تشخيص للجهاز." },
  { id: "kb-007", titleEn: "Bilingual reply tone — code-switch guidance", titleAr: "نبرة الردّ الثنائي اللغة — توجيه مزج اللغات", categoryEn: "Communication", categoryAr: "التواصل", uses7d: 121, csat: 4.5, excerptEn: "When a customer code-switches EN/AR within one message, mirror their lead language in the first sentence and keep the closing in their second.", excerptAr: "عندما يمزج العميل الإنجليزية والعربية في رسالة واحدة، اعكس لغته الأولى في الجملة الافتتاحية واحتفظ بالخاتمة بلغته الثانية." },
  { id: "kb-008", titleEn: "Invoice retry bug — known-issue tracker", titleAr: "خلل إعادة محاولة الفوترة — متتبع المشكلات المعروفة", categoryEn: "Known issues", categoryAr: "مشكلات معروفة", uses7d: 73, csat: 4.1, excerptEn: "INC-2026-04-117 — system retry double-billing. Patch deployed 2026-05-04. Old invoices still cleared via auto-credit.", excerptAr: "INC-2026-04-117 — إعادة محاولة النظام تسبّب فواتير مكرّرة. التصحيح نُشر 2026-05-04. الفواتير القديمة تُسوّى بالائتمان الآلي." },
  { id: "kb-009", titleEn: "Plan-cancel — retention scripts", titleAr: "إلغاء الباقة — سيناريوهات الاحتفاظ", categoryEn: "Retention", categoryAr: "الاحتفاظ", uses7d: 102, csat: 4.0, excerptEn: "Tier-1 retention offer: 2 months 50% off + free device upgrade for ≥4y customers. Manager approval not required.", excerptAr: "عرض الاحتفاظ مستوى 1: شهران بـ 50% + ترقية جهاز للعملاء ≥4 سنوات. لا يحتاج اعتماد المدير." },
  { id: "kb-010", titleEn: "Iqama-linked SIM activation", titleAr: "تفعيل SIM المرتبطة بالإقامة", categoryEn: "Account", categoryAr: "الحساب", uses7d: 245, csat: 4.4, excerptEn: "Verify Absher status before any SIM activation for expat lines. Activation blocked if Iqama < 60 days from expiry.", excerptAr: "تحقّق من حالة أبشر قبل تفعيل SIM للوافدين. التفعيل ممنوع إذا الإقامة < 60 يوماً من الانتهاء." },
  { id: "kb-011", titleEn: "Damaged-device claim — photo evidence rules", titleAr: "ادعاء جهاز تالف — قواعد الصور", categoryEn: "Logistics", categoryAr: "اللوجستيات", uses7d: 67, csat: 3.8, excerptEn: "Require 3 photos: external box, sealed-tape, device serial visible. Without all three, reject and request resend.", excerptAr: "اطلب 3 صور: الصندوق الخارجي، الشريط المختوم، الرقم التسلسلي للجهاز. بدون الثلاثة، ارفض واطلب إعادة الإرسال." },
  { id: "kb-012", titleEn: "Payment-method update — SAMA verification", titleAr: "تحديث وسيلة الدفع — تحقّق ساما", categoryEn: "Billing", categoryAr: "الفوترة", uses7d: 178, csat: 4.3, excerptEn: "Card BIN must be on the SAMA-approved list. Tokenisation handled by the gateway; do not store raw PAN in CRM notes.", excerptAr: "يجب أن يكون BIN ضمن قائمة ساما المعتمدة. الترميز عبر البوابة؛ لا تخزّن رقم البطاقة في ملاحظات CRM." },
];

// ─── Conversations ──────────────────────────────────────────────────────

export const FOCUS_CONV_ID = "conv-78421";

export const CARE_CONVERSATIONS: CareConversation[] = [
  {
    id: FOCUS_CONV_ID,
    customerId: "cust-layla",
    channel: "whatsapp",
    intent: "billing.duplicate",
    sentiment: "frustrated",
    priority: "critical",
    status: "active",
    subjectEn: "Wrong delivery + double-charge — 5-touch escalation",
    subjectAr: "تسليم خاطئ + خصم مكرّر — تصعيد 5 لمسات",
    summaryEn: "Layla received the wrong order (color variant), was double-charged for May invoice, and asked for a refund + re-delivery. Care Conductor pulled OMS + payments; drafted reply with SAR 50 goodwill credit and a same-day re-delivery slot. Refund queued for sign-off.",
    summaryAr: "استلمت ليلى طلباً خاطئاً، خُصمت فاتورة مايو مرتين، وطلبت استرداداً وإعادة تسليم. سحب المنسّق OMS والمدفوعات؛ صاغ ردّاً مع ائتمان 50 ريالاً ونافذة إعادة تسليم في اليوم نفسه. أُدرج الاسترداد للاعتماد.",
    slaRemainMins: 12,
    lastTouchAgo: "3 min ago",
    touches: 5,
    assignedAgentId: AISHA_ID,
    hasAiDraft: true,
    hasRefundCard: true,
    kbHits: ["kb-001", "kb-002", "kb-003"],
    goodwillSAR: 50,
    thread: [
      { id: "m1", from: "customer", textEn: "Hi — I got the wrong color (white not black) AND I see two charges of SAR 124 on my May bill?? This is the 5th time I write about this.", textAr: "مرحبا — وصلني اللون الخاطئ (أبيض بدل أسود) وأرى خصمين من 124 ريال على فاتورة مايو؟؟ هذه المرة الخامسة أكتب فيها.", ts: "09:18" },
      { id: "m2", from: "system", textEn: "Care Conductor opened ticket conv-78421 · pulled OMS, payments, customer 360.", textAr: "منسّق الرعاية فتح التذكرة conv-78421 · سحب OMS والمدفوعات وملف العميل 360.", ts: "09:18" },
      { id: "m3", from: "ai-draft", isDraft: true, draftedByAgentId: "drafter", confidence: 92, textEn: "Hi Layla — I'm so sorry for the back-and-forth on this. I checked both issues end-to-end:\n\n1) Order #ORD-44218 was indeed sent to you in white instead of black. I've booked a same-day re-delivery (today 13:00–15:00) and a return collection of the white unit at the same window.\n2) Invoice INV-2026-05-A was duplicated by INV-2026-05-B (system retry, INC-2026-04-117). I've queued a refund of SAR 124 to your card and added a SAR 50 goodwill credit to your account for the inconvenience.\n\nNothing else needed from you. I'll text once the courier is on the way.", textAr: "مرحبا ليلى — أعتذر بشدّة عن تكرار الموضوع. تحقّقت من المشكلتين:\n\n1) الطلب #ORD-44218 وصلكِ بالفعل أبيض بدل أسود. حجزت إعادة تسليم اليوم (13:00–15:00) واستلام الوحدة البيضاء في النافذة نفسها.\n2) الفاتورة INV-2026-05-A تكرّرت بـ INV-2026-05-B (إعادة محاولة، INC-2026-04-117). أدرجت استرداد 124 ريالاً إلى بطاقتكِ وأضفت ائتمان 50 ريالاً لحسابكِ تعويضاً.\n\nلا حاجة لأي شيء منكِ. سأراسلكِ حال انطلاق المندوب.", ts: "09:30" },
    ],
  },
  {
    id: "conv-78436",
    customerId: "cust-yousef",
    channel: "webchat",
    intent: "tech.connectivity",
    sentiment: "frustrated",
    priority: "high",
    status: "active",
    subjectEn: "Connectivity drops every 15 min — Riyadh district 7",
    subjectAr: "انقطاع كل 15 دقيقة — حي 7 الرياض",
    summaryEn: "Customer reports rolling outages. Tower-health diagnostic shows congestion. Reroute or compensation TBD.",
    summaryAr: "العميل يبلّغ عن انقطاعات متتالية. تشخيص البرج يُظهر ازدحاماً. إعادة التوجيه أو التعويض لاحقاً.",
    slaRemainMins: 38,
    lastTouchAgo: "8 min ago",
    touches: 2,
    assignedAgentId: AISHA_ID,
    hasAiDraft: false,
    kbHits: ["kb-006"],
  },
  {
    id: "conv-78440",
    customerId: "cust-mohammed",
    channel: "email",
    intent: "plan.upgrade",
    sentiment: "neutral",
    priority: "medium",
    status: "active",
    subjectEn: "Add 5 lines to enterprise contract",
    subjectAr: "إضافة 5 خطوط للعقد المؤسسي",
    summaryEn: "Enterprise asked for 5 additional lines mid-contract. Pricing already drafted.",
    summaryAr: "طلب الحساب المؤسسي 5 خطوط إضافية. التسعير صيغ بالفعل.",
    slaRemainMins: 240,
    lastTouchAgo: "47 min ago",
    touches: 3,
    assignedAgentId: AISHA_ID,
    hasAiDraft: true,
    kbHits: ["kb-004"],
  },
  {
    id: "conv-78451",
    customerId: "cust-nadia",
    channel: "whatsapp",
    intent: "delivery.late",
    sentiment: "neutral",
    priority: "medium",
    status: "awaiting-customer",
    subjectEn: "Mate 60 delivery slipped from yesterday",
    subjectAr: "تأخّر تسليم Mate 60 من أمس",
    summaryEn: "Asked customer to confirm new slot.",
    summaryAr: "طلبنا من العميلة تأكيد نافذة جديدة.",
    slaRemainMins: 96,
    lastTouchAgo: "1 hour ago",
    touches: 4,
    assignedAgentId: AISHA_ID,
    hasAiDraft: false,
    kbHits: ["kb-003"],
  },
  // Other agents' work — surfaces in supervisor strip & queue counts
  {
    id: "conv-78380",
    customerId: "cust-faisal",
    channel: "email",
    intent: "billing.dispute",
    sentiment: "angry",
    priority: "critical",
    status: "active",
    subjectEn: "Disputes SAR 4,200 charge on enterprise line",
    subjectAr: "اعتراض على خصم 4,200 ريال",
    summaryEn: "",
    summaryAr: "",
    slaRemainMins: 4,
    lastTouchAgo: "12 min ago",
    touches: 6,
    assignedAgentId: "agent-omar",
    hasAiDraft: true,
    kbHits: ["kb-001", "kb-005"],
  },
  {
    id: "conv-78395",
    customerId: "cust-sara",
    channel: "webchat",
    intent: "plan.cancel",
    sentiment: "frustrated",
    priority: "high",
    status: "active",
    subjectEn: "Wants to cancel — found a cheaper competitor offer",
    subjectAr: "ترغب في الإلغاء — وجدت عرضاً أرخص",
    summaryEn: "",
    summaryAr: "",
    slaRemainMins: 22,
    lastTouchAgo: "5 min ago",
    touches: 1,
    assignedAgentId: "agent-noura",
    hasAiDraft: true,
    kbHits: ["kb-009"],
  },
  {
    id: "conv-78402",
    customerId: "cust-ahmed",
    channel: "whatsapp",
    intent: "kb.howto",
    sentiment: "neutral",
    priority: "low",
    status: "resolved",
    subjectEn: "How do I top up via Apple Pay?",
    subjectAr: "كيف أشحن عبر Apple Pay؟",
    summaryEn: "AI deflected — customer self-served from KB-010 link.",
    summaryAr: "تم انحرافه ذكياً — حلّ ذاتي من kb-010.",
    slaRemainMins: 0,
    lastTouchAgo: "23 min ago",
    touches: 1,
    assignedAgentId: AISHA_ID,
    hasAiDraft: false,
    kbHits: ["kb-010"],
  },
  {
    id: "conv-78410",
    customerId: "cust-hessa",
    channel: "email",
    intent: "complaint",
    sentiment: "frustrated",
    priority: "medium",
    status: "active",
    subjectEn: "Service-failure complaint — second time this month",
    subjectAr: "شكوى إخفاق خدمي — للمرة الثانية هذا الشهر",
    summaryEn: "",
    summaryAr: "",
    slaRemainMins: 75,
    lastTouchAgo: "32 min ago",
    touches: 3,
    assignedAgentId: "agent-fatima",
    hasAiDraft: true,
    kbHits: ["kb-002"],
  },
];

// ─── Channel queue snapshot (supervisor strip) ──────────────────────────

export const CHANNEL_QUEUES: ChannelQueue[] = [
  { channel: "whatsapp", open: 47, oldestWaitMins: 8, agentsOnChannel: 6 },
  { channel: "webchat", open: 31, oldestWaitMins: 4, agentsOnChannel: 5 },
  { channel: "email", open: 84, oldestWaitMins: 142, agentsOnChannel: 4 },
  { channel: "voice", open: 12, oldestWaitMins: 2, agentsOnChannel: 3 },
];

// ─── KB suggestions (knowledge view) ────────────────────────────────────

export const KB_SUGGESTIONS: KbSuggestion[] = [
  { id: "sug-1", titleEn: "How to handle code-switched WhatsApp openings", titleAr: "كيفية التعامل مع افتتاحيات واتساب مزدوجة اللغة", reasonEn: "11 frustrated openers in 7 days that the bilingual classifier mishandled", reasonAr: "11 افتتاحية محبطة خلال 7 أيام أساء المصنّف ثنائي اللغة فهمها", fromCount: 11, agentId: "intent" },
  { id: "sug-2", titleEn: "Mudad refund timing FAQ — addendum to KB-005", titleAr: "أسئلة شائعة عن توقيت استرداد مدد — ملحق لـ KB-005", reasonEn: "Customers ask 'when exactly' even when KB-005 is cited", reasonAr: "العملاء يسألون 'متى بالضبط' رغم اقتباس KB-005", fromCount: 18, agentId: "drafter" },
  { id: "sug-3", titleEn: "Re-delivery window for outside Tier-1 cities", titleAr: "نافذة إعادة التسليم خارج مدن المستوى الأول", reasonEn: "KB-003 covers Tier-1 only; agents searching for Dammam/Khobar windows", reasonAr: "KB-003 يغطّي المستوى 1 فقط؛ موظفون يبحثون عن نوافذ الدمام/الخبر", fromCount: 7, agentId: "crm" },
  { id: "sug-4", titleEn: "Enterprise addendum quick-card — what each addendum covers", titleAr: "بطاقة سريعة لملاحق المؤسسات — ما يغطّيه كل ملحق", reasonEn: "5 escalations this week stalled on addendum lookup", reasonAr: "5 تصعيدات هذا الأسبوع تعثّرت في البحث عن الملاحق", fromCount: 5, agentId: "qa" },
];

// ─── Notifications ──────────────────────────────────────────────────────

export const CARE_NOTIFICATIONS: CareNotification[] = [
  { id: "n1", textEn: "conv-78421 · Refund SAR 124 awaiting your sign-off", textAr: "conv-78421 · استرداد 124 ريالاً بانتظار اعتمادك", time: "1 min ago", severity: "critical", conversationId: FOCUS_CONV_ID },
  { id: "n2", textEn: "Tower-7 (Riyadh) congestion — 14 conversations affected", textAr: "ازدحام البرج 7 (الرياض) — 14 محادثة متأثرة", time: "8 min ago", severity: "high" },
  { id: "n3", textEn: "Email queue oldest wait crossed 2h — re-balance suggested", textAr: "أقدم انتظار في طابور البريد تجاوز ساعتين — يُقترح إعادة التوازن", time: "18 min ago", severity: "high" },
  { id: "n4", textEn: "QA Critic flagged conv-78395 for tone — Noura notified", textAr: "ناقد الجودة أشّر على conv-78395 للنبرة — تم إخطار نورة", time: "31 min ago", severity: "medium" },
  { id: "n5", textEn: "AI deflection rate hit 64% (24h) — best in 30 days", textAr: "معدل الانحراف الذكي 64% (24 ساعة) — الأفضل خلال 30 يوماً", time: "1 hour ago", severity: "info" },
];

// ─── Agent display names from cockpit scenario ──────────────────────────

export const CARE_AGENT_BADGES: Record<string, { nameEn: string; nameAr: string; color: string }> = {
  orch: { nameEn: "Care Conductor", nameAr: "منسّق الرعاية", color: "#5BA98A" },
  intent: { nameEn: "Issue Classifier", nameAr: "مصنّف المشكلات", color: "#156082" },
  crm: { nameEn: "Identity Resolver", nameAr: "محلّل الهوية", color: "#F5A623" },
  drafter: { nameEn: "Comms Drafter", nameAr: "كاتب الردود", color: "#5C8CA8" },
  qa: { nameEn: "QA Auditor", nameAr: "ناقد الجودة", color: "#196B24" },
  investigator: { nameEn: "Cross-system Investigator", nameAr: "محقّق الأنظمة", color: "#8B5CF6" },
  goodwill: { nameEn: "Goodwill Recommender", nameAr: "موصي التعويض", color: "#E91E63" },
};

export function getCareAgentBadge(id: string, lang: Lang) {
  const b = CARE_AGENT_BADGES[id];
  if (!b) return { name: id, color: "#5BA98A" };
  return { name: lang === "en" ? b.nameEn : b.nameAr, color: b.color };
}

// ─── Display helpers ────────────────────────────────────────────────────

export const CHANNEL_LABEL: Record<Channel, BiText> = {
  whatsapp: { en: "WhatsApp", ar: "واتساب" },
  webchat: { en: "Web chat", ar: "دردشة الويب" },
  email: { en: "Email", ar: "البريد" },
  voice: { en: "Voice", ar: "صوت" },
};

export const SENTIMENT_LABEL: Record<Sentiment, BiText> = {
  happy: { en: "Happy", ar: "سعيد" },
  neutral: { en: "Neutral", ar: "محايد" },
  frustrated: { en: "Frustrated", ar: "محبط" },
  angry: { en: "Angry", ar: "غاضب" },
};

export const PRIORITY_LABEL: Record<Priority, BiText> = {
  low: { en: "Low", ar: "منخفض" },
  medium: { en: "Medium", ar: "متوسط" },
  high: { en: "High", ar: "عالٍ" },
  critical: { en: "Critical", ar: "حرج" },
};

export const INTENT_LABEL: Record<Intent, BiText> = {
  "billing.duplicate": { en: "Billing · duplicate", ar: "فوترة · مكرّر" },
  "billing.dispute": { en: "Billing · dispute", ar: "فوترة · اعتراض" },
  "billing.refund": { en: "Billing · refund", ar: "فوترة · استرداد" },
  "delivery.wrong": { en: "Delivery · wrong item", ar: "تسليم · خاطئ" },
  "delivery.late": { en: "Delivery · late", ar: "تسليم · متأخر" },
  "delivery.damaged": { en: "Delivery · damaged", ar: "تسليم · تالف" },
  "account.access": { en: "Account · access", ar: "حساب · دخول" },
  "plan.upgrade": { en: "Plan · upgrade", ar: "باقة · ترقية" },
  "plan.cancel": { en: "Plan · cancel", ar: "باقة · إلغاء" },
  "tech.connectivity": { en: "Tech · connectivity", ar: "تقنية · اتصال" },
  "tech.device": { en: "Tech · device", ar: "تقنية · جهاز" },
  "kb.howto": { en: "KB · how-to", ar: "معرفة · إرشاد" },
  "complaint": { en: "Complaint", ar: "شكوى" },
};

export function tBi(b: BiText, lang: Lang): string { return lang === "en" ? b.en : b.ar; }

export function getCustomer(id: string): CareCustomer | undefined {
  return CARE_CUSTOMERS.find((c) => c.id === id);
}

export function getAgent(id: string): CareAgent | undefined {
  return CARE_AGENTS.find((a) => a.id === id);
}

export function getKb(id: string): KbArticle | undefined {
  return KB_ARTICLES.find((k) => k.id === id);
}

// ─── Macros ──────────────────────────────────────────────────────────────

export interface Macro { id: string; titleEn: string; titleAr: string; bodyEn: string; bodyAr: string }

export const MACROS: Macro[] = [
  { id: "macro-thanks", titleEn: "Thank you & set expectations", titleAr: "شكر وتحديد توقعات", bodyEn: "Thanks for reaching out — I'll have an answer within the next 5 minutes.", bodyAr: "شكراً لتواصلك — سأرد خلال 5 دقائق." },
  { id: "macro-apology", titleEn: "Apology + compensation hint", titleAr: "اعتذار + إشارة تعويض", bodyEn: "I'm really sorry about this. I'd like to make it right — please give me one moment to check what we can do.", bodyAr: "أعتذر بشدّة. أودّ تصحيح الأمر — أمهليني لحظة لأرى ما يمكننا فعله." },
  { id: "macro-refund-confirmed", titleEn: "Refund confirmed", titleAr: "تأكيد الاسترداد", bodyEn: "Your refund has been queued. You'll see it on your card within 24 hours.", bodyAr: "تم إدراج الاسترداد. ستراه على بطاقتك خلال 24 ساعة." },
  { id: "macro-redelivery", titleEn: "Re-delivery booked", titleAr: "تأكيد إعادة التسليم", bodyEn: "I've booked a new delivery slot. The courier will message you when on the way.", bodyAr: "حجزت موعد تسليم جديد. سيراسلك المندوب عند انطلاقه." },
  { id: "macro-escalate", titleEn: "Escalating to Tier-2", titleAr: "تصعيد للمستوى 2", bodyEn: "Let me bring in our specialist team — they'll have the answer within 15 minutes.", bodyAr: "دعني أُشرك فريق المختصّين — سيردّون خلال 15 دقيقة." },
  { id: "macro-csat", titleEn: "Closing + CSAT request", titleAr: "إقفال + طلب تقييم", bodyEn: "Anything else I can help with? If not, you'll get a 1-tap rating after this chat.", bodyAr: "أي شيء آخر أساعدك به؟ ستصلك بطاقة تقييم بعد هذه المحادثة." },
];
