/**
 * Citizen Services Concierge — full scripted run.
 *
 * A bilingual citizen messages the ministry on WhatsApp about a stuck
 * permit. The conductor runs Dialect Tagger → Policy Retriever →
 * Response Drafter → Confidence Scorer. Confidence drops below the
 * 75% policy gate, the supervisor takes over, and the audit packet
 * is compiled before the case closes.
 */

import type { Scenario } from "../types";

const citizenServicesScenario: Scenario = {
  slug: "citizen-services-concierge",
  toolTitle: { en: "Citizen Services Concierge", ar: "كونسيرج خدمات المواطنين" },
  accent: "#5BA98A",
  description: {
    en: "A bilingual orchestrator for ministry contact-centres routes citizens through Arabic NLU, retrieves the authorising policy, drafts a grounded reply in the citizen's dialect, and either replies or escalates to a named supervisor with the full case file already assembled.",
    ar: "منسّق ثنائي اللغة لمراكز اتصال الوزارات يوجّه المواطن عبر فهم اللغة العربية، ويسترجع السياسة المخوِّلة، ويصوغ ردّاً مؤصّلاً بلهجة المواطن، ثم إمّا يرد أو يصعّد إلى مشرف محدَّد مع كامل السياق.",
  },
  buyer: { en: "Director General — Digital Services", ar: "المدير العام للخدمات الرقمية" },
  trigger: { en: "Citizen messages on WhatsApp about a stuck commercial-permit renewal.", ar: "رسالة مواطن على واتساب حول تجديد رخصة تجارية متعثّر." },
  agents: [
    { id: "orch", name: { en: "Concierge Conductor", ar: "منسّق الكونسيرج" }, role: { en: "Plans the conversation and decides escalation.", ar: "يخطّط المحادثة ويقرر التصعيد." }, kind: "orchestrator", color: "#5BA98A" },
    { id: "nlu", name: { en: "Dialect Tagger", ar: "مُصنّف اللهجة" }, role: { en: "Parses dialect-tolerant intent and entities.", ar: "يحلّل النوايا بدعم اللهجات." }, kind: "specialist", color: "#5B7CFF" },
    { id: "policy", name: { en: "Policy Retriever", ar: "مسترجِع السياسات" }, role: { en: "Pulls the right service policy and citation.", ar: "يجلب السياسة الصحيحة والمراجع." }, kind: "retriever", color: "#C45BB8" },
    { id: "drafter", name: { en: "Response Drafter", ar: "كاتب الردّ" }, role: { en: "Drafts the bilingual reply in the citizen's dialect.", ar: "يصوغ الردّ ثنائي اللغة بلهجة المواطن." }, kind: "drafter", color: "#5C8CA8" },
    { id: "conf", name: { en: "Confidence Scorer", ar: "مُصنّف الثقة" }, role: { en: "Rates the answer; refuses below the 75% gate.", ar: "يصنّف الإجابة ويرفض دون عتبة 75%." }, kind: "scorer", color: "#D9534F" },
    { id: "audit", name: { en: "Audit Packetiser", ar: "مُجمّع حزمة التدقيق" }, role: { en: "Compiles the full case file at close.", ar: "يجمع ملف القضيّة الكامل عند الإغلاق." }, kind: "compiler", color: "#8A5BD6" },
  ],
  tools: [
    { name: "tag_dialect", description: { en: "Detects intent + dialect from inbound text.", ar: "يكتشف النية واللهجة من النصّ الوارد." } },
    { name: "search_policy", description: { en: "Searches the ministry policy graph for authorising clause.", ar: "يبحث في رسم السياسات الوزاري عن البند المخوِّل." } },
    { name: "draft_reply", description: { en: "Drafts the reply grounded in cited policy.", ar: "يصوغ الردّ مؤصّلاً بالسياسة." } },
    { name: "score_confidence", description: { en: "Scores end-to-end answer confidence.", ar: "يصنّف الثقة الكاملة بالإجابة." } },
    { name: "compile_packet", description: { en: "Compiles the citizen audit packet.", ar: "يجمع حزمة تدقيق المواطن." } },
    { name: "send_reply", description: { en: "Sends the approved reply on the channel of origin.", ar: "يرسل الردّ المعتمد على القناة الأصلية." } },
  ],
  checkpoints: [
    {
      id: "supervisor-takeover",
      human: { en: "Supervising Officer", ar: "الموظف المُشرف" },
      question: { en: "The concierge could not get past 68% confidence. Take over the conversation?", ar: "لم تتجاوز الثقة 68%. هل تتولّى المحادثة؟" },
      rationale: {
        en: "The policy retrieval found two competing clauses for expired commercial permits with arrears. The drafter cannot decide between Article 14(b) (waive late fee) and Article 14(c) (collect first). Recommend take-over with the cited clauses already in your queue.",
        ar: "وجد المسترجِع بندين متنافسين للتراخيص المنتهية مع متأخرات. لم يحسم الكاتب بين المادة 14(ب) والمادة 14(ج). يُوصى بالتولّي والبنود معروضة لديك.",
      },
      options: [
        { id: "take-over", label: { en: "Take over the case", ar: "تولّي القضيّة" }, recommended: true },
        { id: "send-as-is", label: { en: "Send the draft as-is (override)", ar: "إرسال المسوّدة كما هي (تجاوز)" } },
        { id: "refuse", label: { en: "Polite refusal + book office visit", ar: "رفض مهذّب وحجز موعد" } },
      ],
    },
  ],
  workflows: [
    {
      id: "service-status",
      name: { en: "Service-status enquiry", ar: "استعلام حالة الخدمة" },
      description: { en: "Tag dialect → retrieve policy → draft reply → score confidence → reply or escalate.", ar: "تصنيف لهجة → استرجاع سياسة → صياغة ردّ → تصنيف ثقة → ردّ أو تصعيد." },
      trigger: { en: "Inbound WhatsApp / chat / call", ar: "واتساب أو دردشة أو مكالمة واردة" },
      steps: [
        { agentId: "nlu", label: { en: "Tag dialect & intent", ar: "تصنيف اللهجة والنية" } },
        { agentId: "policy", label: { en: "Pull authorising policy", ar: "جلب السياسة المخوِّلة" } },
        { agentId: "drafter", label: { en: "Draft reply", ar: "صياغة الردّ" } },
        { agentId: "conf", label: { en: "Score confidence", ar: "تصنيف الثقة" } },
        { agentId: "orch", label: { en: "Reply or escalate", ar: "ردّ أو تصعيد" } },
        { agentId: "audit", label: { en: "Compile audit packet", ar: "تجميع حزمة التدقيق" } },
      ],
    },
  ],
  kpis: [
    { id: "ar-quality", label: { en: "Arabic resolution score", ar: "جودة الحلّ بالعربية" }, initial: "—" },
    { id: "deflection", label: { en: "Tier-1 deflection %", ar: "نسبة تحويل الطبقة الأولى" }, initial: "—", source: { en: "Cognirise public-sector benchmarks, 2025 — 4 ministry pilots.", ar: "مقاييس Cognirise للقطاع الحكومي 2025 — 4 تجارب وزارية." } },
    { id: "handoff-q", label: { en: "Hand-off context completeness", ar: "اكتمال سياق التسليم" }, initial: "—" },
    { id: "audit-time", label: { en: "Audit packet assembly", ar: "زمن تجميع حزمة التدقيق" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "case-7841",
      source: { en: "WhatsApp · +966-5x-xxx-1184", ar: "واتساب · 966-5x-xxx-1184+" },
      subject: { en: "Permit renewal stuck — citizen R. Al-Otaibi", ar: "تجديد رخصة متعثّر — المواطن ر. العتيبي" },
      preview: { en: "“طلبت تجديد السجل قبل 12 يوم وما رد علي أحد. متأخر علي إيجار وعندي مخالفة. وش أسوي؟”", ar: "“طلبت تجديد السجل قبل 12 يوم وما رد علي أحد. متأخر علي إيجار وعندي مخالفة. وش أسوي؟”" },
      receivedAt: "08:14",
      status: "new",
      accent: "#5BA98A",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "c1", kind: "think", agentId: "orch", label: { en: "Pick service-status enquiry workflow", ar: "اختيار سير استعلام حالة الخدمة" }, detail: { en: "Inbound WhatsApp matches inquiry pattern. Dispatch dialect → policy → drafter → scorer. Gate on supervisor if confidence < 75%.", ar: "الرسالة مطابقة للنمط. توزيع: لهجة ← سياسة ← كاتب ← تصنيف. توقف للمشرف إذا قلّت الثقة." } },
    { id: "c2", kind: "update-inbox", agentId: "orch", label: { en: "Case picked up", ar: "تمّ التقاط القضيّة" }, inboxUpdate: { id: "case-7841", status: "in-progress" } },
    { id: "c3", kind: "handoff", agentId: "orch", toAgentId: "nlu", label: { en: "Hand off to Dialect Tagger", ar: "تسليم إلى مُصنّف اللهجة" } },
    { id: "c4", kind: "tool-call", agentId: "nlu", toolName: "tag_dialect", label: { en: "Tag dialect + intent", ar: "تصنيف اللهجة والنية" }, toolResult: { en: "Dialect: Najdi Saudi (96%). Intent: commercial_permit.renewal_stuck. Sentiment: distressed (asks for next step).", ar: "اللهجة: نجدية (96%). النية: تجديد رخصة متعثّر. المشاعر: قلق ويطلب الخطوة التالية." } },
    {
      id: "c5", kind: "patch-workspace", agentId: "nlu", label: { en: "Open citizen case file", ar: "فتح ملف القضيّة" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "case-file",
          kind: "metric-grid",
          title: { en: "Case file · #7841", ar: "ملف القضيّة · #7841" },
          rows: [
            [{ en: "Channel", ar: "القناة" }, { en: "WhatsApp", ar: "واتساب" }],
            [{ en: "Dialect", ar: "اللهجة" }, { en: "Najdi (96%)", ar: "نجدية (96%)" }],
            [{ en: "Intent", ar: "النية" }, { en: "Commercial permit renewal stuck", ar: "تجديد رخصة تجارية متعثّر" }],
            [{ en: "Sentiment", ar: "المشاعر" }, { en: "Distressed", ar: "قلق" }],
          ],
        },
      },
    },
    { id: "c6", kind: "handoff", agentId: "nlu", toAgentId: "policy", label: { en: "Hand off to Policy Retriever", ar: "تسليم إلى المسترجِع" } },
    { id: "c7", kind: "tool-call", agentId: "policy", toolName: "search_policy", label: { en: "Search ministry policy graph", ar: "بحث في رسم السياسات" }, toolResult: { en: "2 candidate clauses. Article 14(b) — waive late fee if delay ≥ 10 days and citizen reports cause. Article 14(c) — collect arrears first, then renew. Both apply; rule-set is ambiguous.", ar: "بندان مرشّحان. المادة 14(ب): إعفاء الرسم إذا تجاوز التأخير 10 أيام مع إبلاغ السبب. المادة 14(ج): تحصيل المتأخرات أولاً ثم التجديد. كلاهما ينطبق." } },
    {
      id: "c8", kind: "patch-workspace", agentId: "policy", label: { en: "Publish cited policies", ar: "نشر السياسات المرجعية" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "policies",
          kind: "list",
          title: { en: "Cited policy clauses", ar: "البنود المرجعية" },
          rows: [
            [{ en: "Article 14(b)", ar: "المادة 14(ب)" }, { en: "Waive late fee — delay ≥ 10 days, citizen-reported cause.", ar: "إعفاء الرسم — تأخير ≥ 10 أيام مع تبرير من المواطن." }],
            [{ en: "Article 14(c)", ar: "المادة 14(ج)" }, { en: "Collect arrears first, then renew.", ar: "تحصيل المتأخرات أولاً ثم التجديد." }],
          ],
        },
      },
    },
    { id: "c9", kind: "handoff", agentId: "policy", toAgentId: "drafter", label: { en: "Hand off to Response Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "c10", kind: "tool-call", agentId: "drafter", toolName: "draft_reply", label: { en: "Draft Najdi-dialect reply", ar: "صياغة ردّ بلهجة نجدية" } },
    {
      id: "c11", kind: "patch-workspace", agentId: "drafter", label: { en: "Publish draft reply", ar: "نشر مسوّدة الردّ" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "draft-reply",
          kind: "doc",
          title: { en: "Draft reply (Najdi + EN translation)", ar: "مسوّدة الردّ (نجدية + ترجمة)" },
          rows: [
            [{ en: "“يا أبو/أم العزيز، طلبك تحت المعالجة وفيه بندين ينطبقان على حالتك. ودنا نتأكد قبل ما نلتزم بقرار. حنرجعك في خلال ساعة واحدة بإذن الله.”", ar: "“يا أبو/أم العزيز، طلبك تحت المعالجة وفيه بندين ينطبقان على حالتك. ودنا نتأكد قبل ما نلتزم بقرار. حنرجعك في خلال ساعة واحدة بإذن الله.”" }],
            [{ en: "(EN translation) Your request is under review. Two clauses apply and we want to confirm before we commit. We'll come back to you within one hour.", ar: "(ترجمة) طلبك قيد المراجعة. بندان ينطبقان وسنؤكد قبل الالتزام. سنعود إليك خلال ساعة." }],
          ],
        },
      },
    },
    { id: "c12", kind: "handoff", agentId: "drafter", toAgentId: "conf", label: { en: "Hand off to Confidence Scorer", ar: "تسليم إلى مُصنّف الثقة" } },
    { id: "c13", kind: "tool-call", agentId: "conf", toolName: "score_confidence", label: { en: "Score answer confidence", ar: "تصنيف الثقة" }, toolResult: { en: "Confidence: 68%. Below 75% policy gate (clause ambiguity). Refusal pathway recommended; opening supervisor checkpoint.", ar: "الثقة: 68%. دون عتبة السياسة (غموض البند). يُوصى بالرفض وفتح نقطة المشرف." } },
    { id: "c14", kind: "update-kpi", agentId: "conf", label: { en: "Arabic resolution score = 68%", ar: "جودة الحلّ بالعربية = 68%" }, kpiPatch: { id: "ar-quality", value: "68%", delta: "—" } },
    { id: "c15", kind: "update-inbox", agentId: "orch", label: { en: "Mark case awaiting human", ar: "تعليم القضيّة بانتظار البشري" }, inboxUpdate: { id: "case-7841", status: "awaiting-human" } },
    { id: "c16", kind: "checkpoint", agentId: "orch", checkpointId: "supervisor-takeover", label: { en: "Pause for supervisor take-over", ar: "توقف لتولّي المشرف" } },
    { id: "c17", kind: "update-kpi", agentId: "orch", label: { en: "Hand-off context completeness = 100%", ar: "اكتمال السياق = 100%" }, kpiPatch: { id: "handoff-q", value: "100%", delta: "+100%" } },
    { id: "c18", kind: "handoff", agentId: "orch", toAgentId: "audit", label: { en: "Hand off to Audit Packetiser", ar: "تسليم إلى المُجمّع" } },
    { id: "c19", kind: "tool-call", agentId: "audit", toolName: "compile_packet", label: { en: "Compile case audit packet", ar: "تجميع الحزمة" }, toolResult: { en: "Packet sealed: inbound text, dialect tag, 2 cited policies, draft reply, confidence score, supervisor decision. SHA-256 hashed and stored.", ar: "تم ختم الحزمة: النصّ، اللهجة، السياستان، المسوّدة، الثقة، قرار المشرف. تجزئة SHA-256 ومحفوظة." } },
    { id: "c20", kind: "update-kpi", agentId: "audit", label: { en: "Audit packet built in 4s", ar: "تجميع الحزمة في 4 ثوانٍ" }, kpiPatch: { id: "audit-time", value: "4 s", delta: "-99%" } },
    { id: "c21", kind: "tool-call", agentId: "orch", toolName: "send_reply", label: { en: "Send supervisor's reply to citizen", ar: "إرسال ردّ المشرف للمواطن" }, toolResult: { en: "Sent on WhatsApp at 08:31. Citizen acknowledged.", ar: "أُرسل على واتساب الساعة 08:31. ردّ المواطن بالاستلام." } },
    { id: "c22", kind: "update-kpi", agentId: "orch", label: { en: "Tier-1 deflection +1 (62 / 100 today)", ar: "التحويل +1 (62/100 اليوم)" }, kpiPatch: { id: "deflection", value: "62%", delta: "+1" } },
    { id: "c23", kind: "update-inbox", agentId: "orch", label: { en: "Mark case resolved", ar: "تعليم القضيّة مُغلقة" }, inboxUpdate: { id: "case-7841", status: "resolved" } },
    { id: "c24", kind: "complete", agentId: "orch", label: { en: "Case closed. Audit packet sealed.", ar: "أُغلقت القضيّة. الحزمة مختومة." } },
  ],
};

export default citizenServicesScenario;
