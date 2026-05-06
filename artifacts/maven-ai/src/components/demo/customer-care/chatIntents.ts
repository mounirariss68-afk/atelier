// Customer Care Hive — Care Agent Desk: 8 deterministic AI chat intents.
// Each intent matches the Aisha persona and references real seed data.
//
// Pattern follows the arcelik AiChat: a list of triggers + a render function
// that returns React-friendly markdown blocks resolved by the chat panel.

import type { DemoLang } from "./DemoLangContext";

export type ChatBlock =
  | { kind: "text"; en: string; ar: string }
  | { kind: "kpi"; rows: { labelEn: string; labelAr: string; value: string; tone?: "ok" | "warn" | "bad" }[] }
  | { kind: "list"; items: { en: string; ar: string }[] }
  | { kind: "actions"; actions: { id: string; labelEn: string; labelAr: string }[] };

export interface ChatIntent {
  id: string;
  labelEn: string;
  labelAr: string;
  triggers: string[]; // lowercase substrings — match in either lang
  respond: () => ChatBlock[];
}

export const CHAT_INTENTS: ChatIntent[] = [
  {
    id: "queue.hot",
    labelEn: "What's burning in my queue?",
    labelAr: "ما الأشد إلحاحاً في طابوري؟",
    triggers: ["burning", "hot", "urgent", "ملحاح", "عاجل"],
    respond: () => ([
      { kind: "text", en: "You have 4 active conversations. The hottest is conv-78421 (Layla Q., WhatsApp) — 12 min until SLA breach, refund awaiting your sign-off.", ar: "لديكِ 4 محادثات نشطة. الأشد إلحاحاً conv-78421 (ليلى ق.، واتساب) — 12 دقيقة على خرق SLA، استرداد بانتظار اعتمادكِ." },
      { kind: "kpi", rows: [
        { labelEn: "conv-78421 · Layla", labelAr: "conv-78421 · ليلى", value: "12m", tone: "bad" },
        { labelEn: "conv-78436 · Yousef", labelAr: "conv-78436 · يوسف", value: "38m", tone: "warn" },
        { labelEn: "conv-78440 · Mohammed", labelAr: "conv-78440 · محمد", value: "4h", tone: "ok" },
        { labelEn: "conv-78451 · Nadia", labelAr: "conv-78451 · نادية", value: "1h36m", tone: "ok" },
      ]},
    ]),
  },
  {
    id: "team.sla",
    labelEn: "Show team SLA right now",
    labelAr: "أرني SLA الفريق الآن",
    triggers: ["team sla", "sla", "team", "الفريق", "خرق"],
    respond: () => ([
      { kind: "text", en: "17 conversations across the team are projected to breach SLA in the next 30 minutes — driven by email backlog (oldest wait 142 min). Email needs 2 more agents to recover within the hour.", ar: "17 محادثة في الفريق متوقّع خرقها لـ SLA خلال 30 دقيقة — البريد هو السبب (أقدم انتظار 142 د). يحتاج البريد موظفَين إضافيَّين للتعافي خلال ساعة." },
      { kind: "list", items: [
        { en: "WhatsApp · 47 open · 6 agents · oldest 8 min", ar: "واتساب · 47 مفتوحة · 6 موظفين · أقدم 8 دقائق" },
        { en: "Web chat · 31 open · 5 agents · oldest 4 min", ar: "ويب · 31 مفتوحة · 5 موظفين · أقدم 4 دقائق" },
        { en: "Email · 84 open · 4 agents · oldest 142 min ⚠", ar: "بريد · 84 مفتوحة · 4 موظفين · أقدم 142 د ⚠" },
        { en: "Voice · 12 open · 3 agents · oldest 2 min", ar: "صوت · 12 مفتوحة · 3 موظفين · أقدم 2 د" },
      ]},
    ]),
  },
  {
    id: "customer.history",
    labelEn: "Find similar past issues for this customer",
    labelAr: "ابحث عن قضايا مشابهة لهذا العميل",
    triggers: ["past", "history", "similar", "سابق", "مشاب"],
    respond: () => ([
      { kind: "text", en: "Layla Q. has hit duplicate-charge issues 4 times in 14 months — all linked to INC-2026-04-117 (system retry bug). Patch deployed 2026-05-04, but old invoices still cleared via auto-credit per KB-008.", ar: "تكرّرت مشكلة الخصم المضاعف لليلى 4 مرّات خلال 14 شهراً — كلها مرتبطة بـ INC-2026-04-117. التصحيح نُشر 2026-05-04 لكن الفواتير القديمة تُسوّى آلياً وفق KB-008." },
      { kind: "list", items: [
        { en: "conv-66104 · 2025-08 · resolved with goodwill SAR 50", ar: "conv-66104 · 2025-08 · حُلّت مع تعويض 50 ريالاً" },
        { en: "conv-69287 · 2025-12 · resolved with goodwill SAR 50", ar: "conv-69287 · 2025-12 · حُلّت مع تعويض 50 ريالاً" },
        { en: "conv-72109 · 2026-02 · auto-credited, no contact needed", ar: "conv-72109 · 2026-02 · ائتمان آلي" },
        { en: "conv-75488 · 2026-04 · resolved with apology + KB-008 cite", ar: "conv-75488 · 2026-04 · حُلّت باعتذار + KB-008" },
      ]},
    ]),
  },
  {
    id: "draft.goodwill",
    labelEn: "Draft a goodwill apology in Arabic",
    labelAr: "صُغ اعتذار تعويض بالعربية",
    triggers: ["draft", "apology", "goodwill", "اعتذار", "تعويض"],
    respond: () => ([
      { kind: "text", en: "Drafted by Comms Drafter · QA passed 92/100. Insert into the active conversation when ready.", ar: "صاغها كاتب الردود · جودة 92/100. أدرجيها في المحادثة عند الجاهزية." },
      { kind: "text", en: "ليلى الكريمة، نعتذر عن تكرار المشكلة. أدرجنا استرداد 124 ريالاً وائتمان 50 ريالاً وحجزنا إعادة تسليم اليوم 13:00–15:00. سنبقيكِ على اطلاع.", ar: "ليلى الكريمة، نعتذر عن تكرار المشكلة. أدرجنا استرداد 124 ريالاً وائتمان 50 ريالاً وحجزنا إعادة تسليم اليوم 13:00–15:00. سنبقيكِ على اطلاع." },
      { kind: "actions", actions: [{ id: "insert", labelEn: "Insert into draft", labelAr: "إدراج في المسوّدة" }] },
    ]),
  },
  {
    id: "refund.eligibility",
    labelEn: "Refund eligibility for order 78421?",
    labelAr: "أهلية الاسترداد للطلب 78421؟",
    triggers: ["refund", "eligibility", "78421", "استرداد", "أهلية"],
    respond: () => ([
      { kind: "text", en: "Yes — eligible. SAR 124 sits below your single-approval limit (SAR 1,000). Per KB-005, refunds < SAR 500 settle same-day. Goodwill SAR 50 is also approved by Goodwill Recommender (4-year tenure threshold, KB-002).", ar: "نعم — مؤهّل. مبلغ 124 ريالاً تحت حدّ اعتمادكِ الفردي (1,000 ريال). وفق KB-005 يُسدَّد في اليوم نفسه. تعويض 50 ريالاً أيضاً موصى به (KB-002)." },
      { kind: "kpi", rows: [
        { labelEn: "Refund amount", labelAr: "مبلغ الاسترداد", value: "SAR 124", tone: "ok" },
        { labelEn: "Goodwill credit", labelAr: "ائتمان التعويض", value: "SAR 50", tone: "ok" },
        { labelEn: "Settles", labelAr: "التسوية", value: "Same-day", tone: "ok" },
      ]},
    ]),
  },
  {
    id: "team.bandwidth",
    labelEn: "Who has bandwidth to take 2 of mine?",
    labelAr: "من لديه طاقة لأخذ اثنتين من محادثاتي؟",
    triggers: ["bandwidth", "take", "transfer", "طاقة", "تحويل"],
    respond: () => ([
      { kind: "text", en: "Best candidates by occupancy + FCR:", ar: "أفضل المرشحين حسب الانشغال وFCR:" },
      { kind: "list", items: [
        { en: "Yousef Al-Otaibi · 41% busy · 81% FCR · available now", ar: "يوسف العتيبي · 41% انشغال · 81% FCR · متاح الآن" },
        { en: "Saud Al-Qahtani · 35% busy · 80% FCR · finishing wrap-up", ar: "سعود القحطاني · 35% انشغال · 80% FCR · في إنهاء" },
        { en: "Tariq Al-Subaie · 52% busy · 77% FCR · available now", ar: "طارق السبيعي · 52% انشغال · 77% FCR · متاح" },
      ]},
      { kind: "actions", actions: [{ id: "transfer", labelEn: "Reassign 2 conversations to Yousef", labelAr: "تحويل اثنتين إلى يوسف" }] },
    ]),
  },
  {
    id: "deflection.today",
    labelEn: "What's the AI deflecting today?",
    labelAr: "ماذا ينحرف الذكاء اليوم؟",
    triggers: ["deflect", "deflecting", "deflection", "انحراف"],
    respond: () => ([
      { kind: "text", en: "AI deflected 412 conversations in the last 24 hours — 64% of inbound. Highest rate is on how-to questions; lowest on plan-info (most cancel-risk customers still want a human).", ar: "انحرف الذكاء عن 412 محادثة خلال 24 ساعة — 64% من الوارد. الأعلى في الإرشادات؛ الأدنى في معلومات الباقة." },
      { kind: "kpi", rows: [
        { labelEn: "How-to", labelAr: "إرشادات", value: "184", tone: "ok" },
        { labelEn: "Account", labelAr: "حساب", value: "96", tone: "ok" },
        { labelEn: "Billing FAQ", labelAr: "فوترة شائعة", value: "71", tone: "ok" },
        { labelEn: "Top-up", labelAr: "شحن", value: "48", tone: "ok" },
        { labelEn: "Plan info", labelAr: "معلومات الباقة", value: "13", tone: "warn" },
      ]},
    ]),
  },
  {
    id: "qa.scorecard",
    labelEn: "Open the QA scorecard for this convo",
    labelAr: "افتح بطاقة الجودة لهذه المحادثة",
    triggers: ["qa", "scorecard", "quality", "جودة", "بطاقة"],
    respond: () => ([
      { kind: "text", en: "QA Auditor passed conv-78421's draft at 94/100 — ready to send. Strongest dimension: tone (warm, customer-named). Weakest: brevity (2 lines longer than the 80-word target).", ar: "ناقد الجودة اعتمد مسوّدة conv-78421 بـ 94/100 — جاهزة. الأقوى: النبرة. الأضعف: الإيجاز (سطران فوق هدف 80 كلمة)." },
      { kind: "kpi", rows: [
        { labelEn: "Tone", labelAr: "النبرة", value: "98", tone: "ok" },
        { labelEn: "Accuracy", labelAr: "الدقة", value: "96", tone: "ok" },
        { labelEn: "Policy fit", labelAr: "السياسة", value: "94", tone: "ok" },
        { labelEn: "Brevity", labelAr: "الإيجاز", value: "84", tone: "warn" },
      ]},
    ]),
  },
];

export function matchIntent(input: string, lang: DemoLang): ChatIntent | null {
  const q = input.toLowerCase().trim();
  if (!q) return null;
  // Exact prompt label match (the suggestion buttons send this)
  for (const it of CHAT_INTENTS) {
    if (q === it.labelEn.toLowerCase() || q === it.labelAr.toLowerCase()) return it;
  }
  for (const it of CHAT_INTENTS) {
    for (const trig of it.triggers) {
      if (q.includes(trig.toLowerCase())) return it;
    }
  }
  // Fall back: lang doesn't matter
  void lang;
  return null;
}
