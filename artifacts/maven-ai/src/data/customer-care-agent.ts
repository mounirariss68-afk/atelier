// Customer Care Hive — Care Agent Desk: derived agent outputs.
//
// Generates checkpoints (mirroring the cockpit scenario), inline
// recommendations, audit log entries, and supervisor-strip metrics from
// the static seed.

import {
  CARE_CONVERSATIONS,
  CARE_AGENTS,
  CHANNEL_QUEUES,
  AISHA_ID,
  FOCUS_CONV_ID,
  type AgentRecommendation,
  type CareCheckpoint,
  type AuditEntry,
  type Lang,
} from "./customer-care-seed";

export function getCheckpoints(): CareCheckpoint[] {
  return [
    {
      id: "ck-refund-signoff",
      fromCockpit: false,
      human: { en: "Care Agent (you)", ar: "موظف الرعاية (أنتِ)" },
      question: { en: "Approve SAR 124 refund + SAR 50 goodwill credit for Layla Q.?", ar: "اعتماد استرداد 124 ريالاً + ائتمان 50 ريالاً تعويضاً لليلى ق.؟" },
      rationale: {
        en: "Cross-system Investigator confirmed duplicate charge (INV-2026-05-A & -B). Goodwill Recommender suggests SAR 50 (4-year tenure threshold under KB-002). Refund is well under your single-approval limit (SAR 1,000).",
        ar: "محقّق الأنظمة أكّد الخصم المكرّر (INV-2026-05-A و -B). موصي التعويض يقترح 50 ريالاً (عتبة 4 سنوات وفق KB-002). الاسترداد ضمن حدّ اعتمادك المنفرد (1,000 ريال).",
      },
      options: [
        { id: "approve", label: { en: "Approve refund + goodwill", ar: "اعتماد الاسترداد + التعويض" }, recommended: true },
        { id: "approve-refund-only", label: { en: "Refund only (skip goodwill)", ar: "استرداد فقط" } },
        { id: "escalate", label: { en: "Escalate to supervisor", ar: "تصعيد للمشرف" } },
      ],
      conversationId: FOCUS_CONV_ID,
      agentId: "goodwill",
      confidence: 94,
      severity: "critical",
    },
    {
      id: "ck-takeover-9128",
      fromCockpit: true,
      scenarioId: "care-agent-takeover",
      human: { en: "Care Agent (you)", ar: "موظف الرعاية (أنتِ)" },
      question: { en: "conv-78440 (enterprise roaming) needs Tier-2 — escalate route?", ar: "conv-78440 (تجوال مؤسسي) تحتاج المستوى 2 — مسار التصعيد؟" },
      rationale: {
        en: "Comms Drafter retried twice; both rejected by QA — addendum-7 entitlement clause not in resolver's read scope. Recommended route: Khalid Al-Mutairi (Tier-2, available, 91% FCR on enterprise).",
        ar: "كاتب الردود حاول مرّتين؛ رفضهما الناقد — بند الاستحقاق في الملحق 7 خارج صلاحية القراءة. المسار الموصى به: خالد المطيري (مستوى 2، متاح، 91% FCR للمؤسسات).",
      },
      options: [
        { id: "escalate-khalid", label: { en: "Escalate to Khalid Al-Mutairi", ar: "تصعيد إلى خالد المطيري" }, recommended: true },
        { id: "escalate-lina", label: { en: "Escalate to Lina Al-Ghamdi", ar: "تصعيد إلى لينا الغامدي" } },
        { id: "another-attempt", label: { en: "Give Comms Drafter one more attempt", ar: "محاولة إضافية للكاتب" } },
      ],
      conversationId: "conv-78440",
      agentId: "orch",
      confidence: 88,
      severity: "high",
    },
    {
      id: "ck-tower-comms",
      fromCockpit: false,
      human: { en: "Care Agent (you)", ar: "موظف الرعاية (أنتِ)" },
      question: { en: "Send proactive WhatsApp to 14 Riyadh-7 customers about tower congestion?", ar: "إرسال واتساب استباقي إلى 14 عميل بالرياض-7 عن ازدحام البرج؟" },
      rationale: {
        en: "Cross-system Investigator detected the congestion 18 min ago. Comms Drafter prepared a bilingual outage notice with ETA. Sending now would cut inbound volume by an estimated 60%.",
        ar: "محقّق الأنظمة رصد الازدحام قبل 18 دقيقة. أعدّ كاتب الردود إشعاراً ثنائي اللغة مع وقت متوقع. الإرسال الآن يقلّل الحجم الوارد بنحو 60%.",
      },
      options: [
        { id: "send", label: { en: "Send proactive notice", ar: "إرسال الإشعار الاستباقي" }, recommended: true },
        { id: "edit", label: { en: "Edit before sending", ar: "تحرير قبل الإرسال" } },
        { id: "skip", label: { en: "Don't send", ar: "عدم الإرسال" } },
      ],
      agentId: "drafter",
      confidence: 81,
      severity: "high",
    },
  ];
}

export function getRecommendations(): AgentRecommendation[] {
  return [
    {
      id: "rec-cancel-78395",
      agentId: "drafter",
      title: { en: "Counter-offer for Sara H. (cancel risk)", ar: "عرض مضاد لسارة ه. (خطر إلغاء)" },
      rationale: { en: "Sara cited a competitor offer. KB-009 retention script (2 months 50% off + free upgrade) is within Tier-1 limits — suggest sending it.", ar: "سارة استشهدت بعرض منافس. سيناريو KB-009 (شهران 50% + ترقية) ضمن الحدود — يُقترح إرساله." },
      confidence: 87,
      severity: "high",
      recordType: "conversation",
      recordId: "conv-78395",
      recommendedAction: { en: "Send retention offer", ar: "إرسال عرض الاحتفاظ" },
      alternateActions: [{ en: "Loop in supervisor", ar: "إشراك المشرف" }, { en: "Escalate to retention desk", ar: "تصعيد لمكتب الاحتفاظ" }],
      generatedAt: "09:24",
    },
    {
      id: "rec-late-78451",
      agentId: "crm",
      title: { en: "Pre-empt Nadia's chase on Mate 60", ar: "استبق متابعة نادية على Mate 60" },
      rationale: { en: "Identity Resolver pulled OMS — courier is now 4 km from Nadia. Send proactive ETA to close the loop.", ar: "محلّل الهوية سحب OMS — المندوب على بُعد 4 كم. أرسل ETA استباقياً." },
      confidence: 90,
      severity: "medium",
      recordType: "conversation",
      recordId: "conv-78451",
      recommendedAction: { en: "Send ETA update", ar: "إرسال تحديث ETA" },
      alternateActions: [{ en: "Wait for customer reply", ar: "انتظار ردّ العميلة" }],
      generatedAt: "09:22",
    },
    {
      id: "rec-tone-78410",
      agentId: "qa",
      title: { en: "Tone uplift on Hessa's complaint reply", ar: "تحسين نبرة الردّ على شكوى حصة" },
      rationale: { en: "QA Auditor scores draft at 72/100 — too transactional for a 6-year customer. Suggested edits attached.", ar: "ناقد الجودة قيّم المسوّدة 72/100 — جافّة لعميلة 6 سنوات. تعديلات مقترحة." },
      confidence: 76,
      severity: "medium",
      recordType: "conversation",
      recordId: "conv-78410",
      recommendedAction: { en: "Apply suggested edits", ar: "تطبيق التعديلات" },
      alternateActions: [{ en: "Send as-is", ar: "إرسال كما هو" }, { en: "Re-draft from scratch", ar: "إعادة الصياغة" }],
      generatedAt: "09:11",
    },
  ];
}

export function getAuditLog(conversationId: string = FOCUS_CONV_ID): AuditEntry[] {
  if (conversationId !== FOCUS_CONV_ID) {
    return [
      { id: "a1", ts: "09:18", actorEn: "Customer", actorAr: "العميل", isAi: false, actionEn: "Inbound message", actionAr: "رسالة واردة", detailEn: "First touch on this conversation", detailAr: "أول تواصل في هذه المحادثة", conversationId },
      { id: "a2", ts: "09:18", actorEn: "Care Conductor", actorAr: "منسّق الرعاية", isAi: true, actionEn: "Workflow opened", actionAr: "فتح المسار", detailEn: "Routed to inbound-care workflow", detailAr: "وُجّهت إلى مسار الرعاية الواردة", conversationId },
    ];
  }
  return [
    { id: "a1", ts: "09:18", actorEn: "Customer (Layla Q.)", actorAr: "العميلة (ليلى ق.)", isAi: false, actionEn: "Inbound WhatsApp message", actionAr: "رسالة واتساب واردة", detailEn: "Reported wrong color delivery + double-charge on May invoice", detailAr: "بلّغت عن لون خاطئ + خصم مكرّر على فاتورة مايو", conversationId },
    { id: "a2", ts: "09:18", actorEn: "Care Conductor", actorAr: "منسّق الرعاية", isAi: true, actionEn: "Opened conv-78421", actionAr: "فتح conv-78421", detailEn: "Dispatched to Issue Classifier → Identity Resolver → Cross-system Investigator", detailAr: "وُزّعت إلى المصنّف → محلّل الهوية → محقّق الأنظمة", conversationId },
    { id: "a3", ts: "09:19", actorEn: "Issue Classifier", actorAr: "مصنّف المشكلات", isAi: true, actionEn: "Classified intent", actionAr: "تصنيف النية", detailEn: "billing.duplicate + delivery.wrong (composite); language: code-switch EN/AR", detailAr: "فوترة مكرّرة + تسليم خاطئ (مركّب)؛ مزج إنجليزي/عربي", conversationId },
    { id: "a4", ts: "09:20", actorEn: "Identity Resolver", actorAr: "محلّل الهوية", isAi: true, actionEn: "Pulled customer 360", actionAr: "جلب ملف العميل 360", detailEn: "Layla Q. — postpaid 99, 4y tenure, CLV SAR 11,400", detailAr: "ليلى ق. — شهرية 99، 4 سنوات، CLV 11,400 ريال", conversationId },
    { id: "a5", ts: "09:22", actorEn: "Cross-system Investigator", actorAr: "محقّق الأنظمة", isAi: true, actionEn: "Found root causes", actionAr: "وجد الأسباب الجذرية", detailEn: "OMS confirms wrong color; Payments confirms duplicate INV-A & -B (INC-2026-04-117 retry bug)", detailAr: "OMS يؤكّد لون خاطئ؛ المدفوعات تؤكّد فاتورتين مكرّرتين (خلل إعادة المحاولة)", conversationId },
    { id: "a6", ts: "09:24", actorEn: "Goodwill Recommender", actorAr: "موصي التعويض", isAi: true, actionEn: "Suggested SAR 50 credit", actionAr: "اقترح ائتمان 50 ريالاً", detailEn: "Per KB-002, 4y tenure qualifies for SAR 50 on service-failure incident", detailAr: "وفق KB-002 تستحق 4 سنوات ائتمان 50 ريالاً عند الإخفاق", conversationId },
    { id: "a7", ts: "09:28", actorEn: "Comms Drafter", actorAr: "كاتب الردود", isAi: true, actionEn: "Draft v1 published", actionAr: "نشر المسوّدة 1", detailEn: "Bilingual reply with re-delivery slot + refund + goodwill", detailAr: "ردّ ثنائي اللغة مع نافذة إعادة التسليم + استرداد + تعويض", conversationId },
    { id: "a8", ts: "09:29", actorEn: "QA Auditor", actorAr: "ناقد الجودة", isAi: true, actionEn: "QA passed (94/100)", actionAr: "اجتازت الجودة (94/100)", detailEn: "Tone warm; root cause named; action explicit; ready to send", detailAr: "نبرة دافئة؛ سبب مذكور؛ إجراء واضح؛ جاهز للإرسال", conversationId },
    { id: "a9", ts: "09:30", actorEn: "Care Conductor", actorAr: "منسّق الرعاية", isAi: true, actionEn: "Refund queued for sign-off", actionAr: "أُدرج الاسترداد للاعتماد", detailEn: "SAR 124 refund + SAR 50 goodwill awaiting Aisha's approval", detailAr: "استرداد 124 ريالاً + 50 ريالاً تعويضاً بانتظار موافقة عائشة", conversationId },
  ];
}

// ─── Supervisor-strip metrics ───────────────────────────────────────────

export function getQueueByChannel() { return CHANNEL_QUEUES; }

export function getSlaPredictor(lang: Lang) {
  return [
    { name: lang === "en" ? "5 min" : "5 د", value: 3 },
    { name: lang === "en" ? "10 min" : "10 د", value: 5 },
    { name: lang === "en" ? "15 min" : "15 د", value: 8 },
    { name: lang === "en" ? "20 min" : "20 د", value: 11 },
    { name: lang === "en" ? "30 min" : "30 د", value: 17 },
  ];
}

export function getOccupancy() {
  return CARE_AGENTS.map((a) => ({ id: a.id, nameEn: a.nameEn, nameAr: a.nameAr, occupancy: a.occupancy, fcr: a.fcr, aht: a.ahtMins, status: a.status, role: a.role, isMe: !!a.isMe }));
}

export function getAiVsHumanMix(lang: Lang) {
  return [
    { name: lang === "en" ? "AI deflected" : "انحراف ذكي", value: 412 },
    { name: lang === "en" ? "AI-drafted, human sent" : "صياغة ذكية، إرسال بشري", value: 188 },
    { name: lang === "en" ? "Human end-to-end" : "بشري كامل", value: 47 },
  ];
}

export function getDeflectionByIntent(lang: Lang) {
  return [
    { name: lang === "en" ? "How-to" : "إرشاد", value: 184 },
    { name: lang === "en" ? "Account" : "حساب", value: 96 },
    { name: lang === "en" ? "Billing FAQ" : "فوترة شائعة", value: 71 },
    { name: lang === "en" ? "Top-up" : "شحن", value: 48 },
    { name: lang === "en" ? "Plan info" : "معلومات الباقة", value: 13 },
  ];
}

// ─── KPI helpers ────────────────────────────────────────────────────────

export function getDeskKpis(lang: Lang) {
  const mine = CARE_CONVERSATIONS.filter((c) => c.assignedAgentId === AISHA_ID && c.status !== "resolved").length;
  const team = CARE_CONVERSATIONS.filter((c) => c.status !== "resolved").length;
  const slaAtRisk = CARE_CONVERSATIONS.filter((c) => c.status !== "resolved" && c.slaRemainMins <= 30).length;
  const decisions = getCheckpoints().length + getRecommendations().length;
  return [
    { id: "open", value: `${mine} / ${team}`, label: lang === "en" ? "Open conversations" : "محادثات مفتوحة", sub: lang === "en" ? "mine / team" : "لي / للفريق" },
    { id: "sla", value: String(slaAtRisk), label: lang === "en" ? "SLA at risk" : "SLA في خطر", sub: lang === "en" ? "next 30 min" : "خلال 30 دقيقة" },
    { id: "deflection", value: "64%", label: lang === "en" ? "AI deflection (24h)" : "انحراف ذكي (24س)", sub: "+9pp" },
    { id: "fcr", value: "84%", label: lang === "en" ? "FCR rolling 7d" : "FCR لـ 7 أيام", sub: "+3pp" },
    { id: "decisions", value: String(decisions), label: lang === "en" ? "Waiting on me" : "بانتظاري", sub: lang === "en" ? "approvals" : "اعتمادات" },
  ];
}
