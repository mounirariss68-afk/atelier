/**
 * Customer Care Hive — full scripted run.
 *
 * 10:42 — bilingual customer "Layla Q." messages on WhatsApp about a
 * double-billing on her postpaid line. The hive-conductor routes the
 * case through Intent Classifier → CRM Retriever → Resolution Drafter
 * → QA Critic. The first draft fails QA on tone; the drafter retries
 * and clears. The reply ships, but a separate stalled case opens the
 * Care Agent checkpoint mid-shift.
 */

import type { Scenario } from "../types";

const customerCareScenario: Scenario = {
  slug: "customer-care-hive",
  toolTitle: { en: "Customer Care Hive", ar: "خلية رعاية العملاء" },
  accent: "#5BA98A",
  description: {
    en: "A care orchestrator routes a bilingual customer issue across an Intent Classifier, a CRM Retriever, a Resolution Drafter, and a QA Critic — running QA on every reply (not 2%) and preserving full context if it has to escalate to a Care Agent or Coach.",
    ar: "منسّق رعاية يوزّع قضيّة عميل ثنائية اللغة بين مصنّف النية ومسترجِع CRM وكاتب الحلّ وناقد الجودة — مع نقد على كل ردّ وحفظ السياق عند التصعيد.",
  },
  buyer: { en: "Head of Customer Care", ar: "رئيس رعاية العملاء" },
  trigger: { en: "Bilingual WhatsApp message about double-billing arrives at 10:42.", ar: "رسالة عميل ثنائية اللغة عن فاتورة مكرّرة الساعة 10:42." },
  agents: [
    { id: "orch", name: { en: "Hive Conductor", ar: "منسّق الخلية" }, role: { en: "Sequences resolution and decides hand-off.", ar: "يرتّب الحلّ ويقرر التسليم." }, kind: "orchestrator", color: "#5BA98A" },
    { id: "intent", name: { en: "Intent Classifier", ar: "مصنّف النية" }, role: { en: "Classifies the issue + language + sentiment.", ar: "يصنّف القضيّة واللغة والمشاعر." }, kind: "specialist", color: "#5B7CFF" },
    { id: "crm", name: { en: "CRM Retriever", ar: "مسترجِع CRM" }, role: { en: "Pulls customer history, plan, and entitlements.", ar: "يجلب التاريخ والباقة والاستحقاقات." }, kind: "retriever", color: "#C45BB8" },
    { id: "drafter", name: { en: "Resolution Drafter", ar: "كاتب الحلّ" }, role: { en: "Drafts the bilingual reply and proposed action.", ar: "يصوغ الردّ ثنائي اللغة والإجراء." }, kind: "drafter", color: "#5C8CA8" },
    { id: "qa", name: { en: "QA Critic", ar: "ناقد الجودة" }, role: { en: "Critiques tone, accuracy, regulator wording.", ar: "ينتقد النبرة والدقّة والصياغة." }, kind: "critic", color: "#8A5BD6" },
    { id: "telemetry", name: { en: "Cost Telemetry", ar: "قياس التكلفة" }, role: { en: "Aggregates cost-per-contact in real time.", ar: "يُجمّع تكلفة الاتصال لحظياً." }, kind: "monitor", color: "#D9534F" },
  ],
  tools: [
    { name: "classify_intent", description: { en: "Classifies intent, language, sentiment.", ar: "يصنّف النية واللغة والمشاعر." } },
    { name: "fetch_crm", description: { en: "Pulls plan, entitlements and last 6 invoices.", ar: "يجلب الباقة والاستحقاقات وآخر 6 فواتير." } },
    { name: "draft_reply", description: { en: "Drafts the bilingual reply + proposed action.", ar: "يصوغ الردّ والإجراء." } },
    { name: "qa_review", description: { en: "Reviews tone, accuracy, policy fit on every reply.", ar: "يراجع النبرة والدقّة والسياسة." } },
    { name: "execute_action", description: { en: "Executes the credit / refund / plan-change action.", ar: "ينفّذ الائتمان أو الاسترداد أو التغيير." } },
    { name: "record_cost", description: { en: "Records cost-per-contact telemetry.", ar: "يسجّل قياس تكلفة الاتصال." } },
  ],
  checkpoints: [
    {
      id: "care-agent-takeover",
      human: { en: "Care Agent (on shift)", ar: "موظف الرعاية المناوب" },
      question: { en: "Case-9128 has stalled (resolver lacks the policy). Take over with full context loaded?", ar: "تعثّرت القضيّة 9128 (السياسة غير متاحة). هل تتولّى مع تحميل السياق؟" },
      rationale: {
        en: "Resolver retried twice, both times QA refused on missing entitlement clause. Hand-off packet has the customer history, the failed drafts, and the missing-policy pointer. Recommend take-over.",
        ar: "حاول الكاتب مرّتين ورفض الناقد لعدم وجود البند. حزمة التسليم تتضمّن التاريخ والمسوّدات وموضع السياسة المفقودة. يُوصى بالتولّي.",
      },
      options: [
        { id: "take-over", label: { en: "Take over", ar: "التولّي" }, recommended: true },
        { id: "extend", label: { en: "Give the resolver one more attempt", ar: "محاولة إضافية للكاتب" } },
      ],
    },
  ],
  workflows: [
    {
      id: "inbound-care",
      name: { en: "Inbound bilingual contact", ar: "اتصال ثنائي اللغة" },
      description: { en: "Classify → retrieve → draft → QA on every reply → execute action.", ar: "تصنيف → استرجاع → صياغة → نقد لكل ردّ → تنفيذ." },
      trigger: { en: "Inbound channel event (voice / chat / WhatsApp / email)", ar: "حدث قناة وارد" },
      steps: [
        { agentId: "intent", label: { en: "Classify intent", ar: "تصنيف النية" } },
        { agentId: "crm", label: { en: "Pull customer", ar: "جلب العميل" } },
        { agentId: "drafter", label: { en: "Draft reply", ar: "صياغة الردّ" } },
        { agentId: "qa", label: { en: "QA every reply", ar: "نقد كل ردّ" } },
        { agentId: "orch", label: { en: "Send / escalate", ar: "إرسال أو تصعيد" } },
        { agentId: "telemetry", label: { en: "Record cost", ar: "تسجيل التكلفة" } },
      ],
    },
  ],
  kpis: [
    { id: "ar-csat", label: { en: "Arabic CSAT", ar: "رضا العملاء بالعربية" }, initial: "—" },
    { id: "ftr", label: { en: "First-touch resolution", ar: "حلّ من أول لمسة" }, initial: "—", source: { en: "Forrester TEI of Salesforce Einstein for Service, 2024.", ar: "Forrester TEI لـ Salesforce Einstein for Service 2024." } },
    { id: "cost", label: { en: "Cost per contact", ar: "تكلفة الاتصال" }, initial: "AED 21" },
    { id: "qa-cov", label: { en: "QA coverage", ar: "تغطية الجودة" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "case-9127",
      source: { en: "WhatsApp · +971-5x-xxx-2218 (Layla Q.)", ar: "واتساب · 971-5x-xxx-2218+ (ليلى ق.)" },
      subject: { en: "Double-billing on postpaid line", ar: "فاتورة مكرّرة على خط مسبق الدفع الشهري" },
      preview: { en: "“I was charged twice for May. Can you check please / تم خصم فاتورة مايو مرتين، تأكدوا لو سمحتم.”", ar: "“I was charged twice for May. Can you check please / تم خصم فاتورة مايو مرتين، تأكدوا لو سمحتم.”" },
      receivedAt: "10:42",
      status: "new",
      accent: "#5BA98A",
    },
    {
      id: "case-9128",
      source: { en: "Web chat · y. khoury", ar: "دردشة الويب · ي. خوري" },
      subject: { en: "Roaming pack on enterprise contract", ar: "باقة تجوال على عقد مؤسسي" },
      preview: { en: "“My account manager said the EU roaming pack is included. Your bot disagrees.”", ar: "قال مدير حسابي إن باقة تجوال الاتحاد الأوروبي مشمولة. البوت يخالف." },
      receivedAt: "10:48",
      status: "new",
      accent: "#5BA98A",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "h1", kind: "think", agentId: "orch", label: { en: "Open inbound-care workflow on case-9127", ar: "فتح سير الرعاية للقضيّة 9127" }, detail: { en: "Bilingual WhatsApp matches inbound trigger. Dispatch intent → CRM → drafter → QA. Send only on QA pass.", ar: "الرسالة مطابقة. توزيع المسارات. الإرسال فقط بعد إجازة الناقد." } },
    { id: "h2", kind: "update-inbox", agentId: "orch", label: { en: "Case-9127 picked up", ar: "تمّ التقاط 9127" }, inboxUpdate: { id: "case-9127", status: "in-progress" } },
    { id: "h3", kind: "handoff", agentId: "orch", toAgentId: "intent", label: { en: "Hand off to Intent Classifier", ar: "تسليم إلى المصنّف" } },
    { id: "h4", kind: "tool-call", agentId: "intent", toolName: "classify_intent", label: { en: "Classify intent + language", ar: "تصنيف النية واللغة" }, toolResult: { en: "Intent: billing.duplicate. Language: code-switch EN/AR (62/38). Sentiment: frustrated, polite. Recommended SLA: 5 min.", ar: "النية: فاتورة مكرّرة. اللغة: مزج إنجليزي/عربي. المشاعر: محبط ومهذّب. SLA: 5 دقائق." } },
    { id: "h5", kind: "handoff", agentId: "intent", toAgentId: "crm", label: { en: "Hand off to CRM Retriever", ar: "تسليم إلى المسترجِع" } },
    { id: "h6", kind: "tool-call", agentId: "crm", toolName: "fetch_crm", label: { en: "Pull last 6 invoices + plan", ar: "جلب آخر 6 فواتير والباقة" }, toolResult: { en: "Layla Q., Postpaid 99-AED plan, customer 4 yrs. Invoice INV-2026-05-A AED 124, INV-2026-05-B AED 124 (duplicate, system retry artefact).", ar: "ليلى ق.، باقة 99 درهماً، عميلة 4 سنوات. فاتورتان مكرّرتان بـ 124 درهماً (أثر إعادة محاولة)." } },
    {
      id: "h7", kind: "patch-workspace", agentId: "crm", label: { en: "Open contact case file", ar: "فتح ملف الاتصال" },
      workspacePatch: {
        op: "add", widget: {
          id: "case-9127", kind: "metric-grid",
          title: { en: "Case · 9127 · Layla Q.", ar: "قضيّة · 9127 · ليلى ق." },
          rows: [
            [{ en: "Plan", ar: "الباقة" }, { en: "Postpaid 99 AED", ar: "شهرية 99 درهماً" }],
            [{ en: "Tenure", ar: "مدة العميل" }, { en: "4 yrs", ar: "4 سنوات" }],
            [{ en: "Issue", ar: "القضيّة" }, { en: "Duplicate billing — system retry", ar: "فاتورة مكرّرة — إعادة محاولة" }],
            [{ en: "Recommended action", ar: "الإجراء" }, { en: "Auto-credit AED 124 + apology", ar: "ائتمان آلي 124 درهماً + اعتذار" }],
          ],
        },
      },
    },
    { id: "h8", kind: "handoff", agentId: "crm", toAgentId: "drafter", label: { en: "Hand off to Resolution Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "h9", kind: "tool-call", agentId: "drafter", toolName: "draft_reply", label: { en: "Draft v1 bilingual reply", ar: "صياغة الردّ — نسخة 1" } },
    {
      id: "h10", kind: "patch-workspace", agentId: "drafter", label: { en: "Publish draft v1", ar: "نشر مسوّدة 1" },
      workspacePatch: {
        op: "add", widget: {
          id: "reply-v1", kind: "doc",
          title: { en: "Reply draft · v1", ar: "مسوّدة الردّ · 1" },
          rows: [
            [{ en: "“Hi Layla, the duplicate charge has been processed. AED 124 will be credited within 24h. Anything else?”", ar: "“مرحبا ليلى، تمّت معالجة الفاتورة المكرّرة. سيُضاف ائتمان 124 درهم خلال 24 ساعة. أي شيء آخر؟”" }],
          ],
        },
      },
    },
    { id: "h11", kind: "handoff", agentId: "drafter", toAgentId: "qa", label: { en: "Hand off to QA Critic", ar: "تسليم إلى الناقد" } },
    { id: "h12", kind: "tool-call", agentId: "qa", toolName: "qa_review", label: { en: "QA on draft v1", ar: "نقد المسوّدة 1" }, toolResult: { en: "REFUSED. Tone is too transactional for a 4-year customer who is frustrated. Missing apology + missing root-cause naming. Send back to drafter.", ar: "مرفوض. النبرة جافّة لعميلة بـ 4 سنوات. لا اعتذار ولا تسمية للسبب. إعادة." } },
    { id: "h13", kind: "tool-call", agentId: "drafter", toolName: "draft_reply", label: { en: "Draft v2 with apology + named cause", ar: "صياغة 2 مع اعتذار وتسمية" } },
    {
      id: "h14", kind: "patch-workspace", agentId: "drafter", label: { en: "Publish draft v2", ar: "نشر مسوّدة 2" },
      workspacePatch: {
        op: "update", id: "reply-v1",
        rows: [
          [{ en: "“Hi Layla — sorry about that. Our system retried May's invoice and double-charged you (INV-2026-05-A and -B, AED 124 each). I have credited AED 124 to your account; you'll see it on tomorrow's statement. We've also flagged the retry bug so it doesn't repeat. Thanks for being with us 4 years.”", ar: "“مرحبا ليلى — نعتذر عن هذا. أعاد نظامنا محاولة فاتورة مايو وخصمكِ مرّتين (INV-2026-05-A و B بقيمة 124 درهماً لكلٍّ منهما). تم إضافة 124 درهماً إلى حسابكِ وستظهر في كشف الغد. كما وضعنا علامة على هذا الخلل لمنع تكراره. شكراً لثقتكِ بنا منذ 4 سنوات.”" }],
        ],
      },
    },
    { id: "h15", kind: "tool-call", agentId: "qa", toolName: "qa_review", label: { en: "QA on draft v2", ar: "نقد المسوّدة 2" }, toolResult: { en: "PASSED. Tone warm, root cause named, action explicit. Approved to send.", ar: "اجتازت. النبرة دافئة والسبب مذكور والإجراء واضح. مُجازة." } },
    { id: "h16", kind: "tool-call", agentId: "orch", toolName: "execute_action", label: { en: "Apply AED 124 credit + send reply", ar: "تطبيق ائتمان 124 درهماً وإرسال الردّ" }, toolResult: { en: "Credit applied at 10:46. Reply delivered to WhatsApp. Customer reacted with thumbs-up at 10:47.", ar: "نُفّذ الائتمان 10:46. أُرسل الردّ. ردّت العميلة بإعجاب 10:47." } },
    { id: "h17", kind: "update-kpi", agentId: "orch", label: { en: "QA coverage = 100% (every reply)", ar: "تغطية الجودة = 100%" }, kpiPatch: { id: "qa-cov", value: "100%", delta: "+98 pts" } },
    { id: "h18", kind: "update-kpi", agentId: "orch", label: { en: "First-touch resolution: 1 / 1 today", ar: "حلّ من أول لمسة: 1/1" }, kpiPatch: { id: "ftr", value: "100% today", delta: "+18 pts" } },
    { id: "h19", kind: "update-kpi", agentId: "orch", label: { en: "Arabic CSAT (rolling 7d) → 4.7 / 5", ar: "رضا العربية (7 أيام) → 4.7/5" }, kpiPatch: { id: "ar-csat", value: "4.7 / 5", delta: "+0.4" } },
    { id: "h20", kind: "handoff", agentId: "orch", toAgentId: "telemetry", label: { en: "Hand off to Cost Telemetry", ar: "تسليم إلى قياس التكلفة" } },
    { id: "h21", kind: "tool-call", agentId: "telemetry", toolName: "record_cost", label: { en: "Record cost per contact", ar: "تسجيل تكلفة الاتصال" }, toolResult: { en: "AED 8 vs AED 21 baseline (model + drafter + QA tokens; no human time).", ar: "8 دراهم مقابل 21 درهماً (نماذج فقط، بدون وقت بشري)." } },
    { id: "h22", kind: "update-kpi", agentId: "telemetry", label: { en: "Cost per contact = AED 8", ar: "تكلفة الاتصال = 8 دراهم" }, kpiPatch: { id: "cost", value: "AED 8", delta: "-62%" } },
    { id: "h23", kind: "update-inbox", agentId: "orch", label: { en: "Case-9127 closed", ar: "قضيّة 9127 مغلقة" }, inboxUpdate: { id: "case-9127", status: "resolved" } },
    { id: "h24", kind: "think", agentId: "orch", label: { en: "Case-9128 stalled — escalate", ar: "تعثّرت 9128 — تصعيد" }, detail: { en: "Resolver tried twice. Both times QA refused: enterprise-roaming entitlement clause is in a contract addendum the resolver cannot read. Open Care Agent checkpoint.", ar: "محاولتان فاشلتان. بند الاستحقاق في ملحق عقد لا يستطيع الكاتب قراءته. فتح نقطة الموظف." } },
    { id: "h25", kind: "update-inbox", agentId: "orch", label: { en: "Case-9128 awaiting human", ar: "قضيّة 9128 بانتظار البشري" }, inboxUpdate: { id: "case-9128", status: "awaiting-human" } },
    { id: "h26", kind: "checkpoint", agentId: "orch", checkpointId: "care-agent-takeover", label: { en: "Pause for Care Agent take-over", ar: "توقف لتولّي الموظف" } },
    { id: "h27", kind: "complete", agentId: "orch", label: { en: "Run complete. 1 case resolved, 1 escalated with full context.", ar: "اكتمل التشغيل. قضيّة محلولة وأخرى مُصعّدة مع السياق." } },
  ],
};

export default customerCareScenario;
