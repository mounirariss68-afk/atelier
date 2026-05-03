/**
 * Enterprise Knowledge Concierge — full scripted run.
 *
 * The CFO asks "what is our exposure to the Egyptian pound move on
 * receivables?" The concierge-conductor runs Permission Filter →
 * Semantic Retriever → Grounded Drafter → Citation Auditor →
 * Confidence Scorer. Two relevant docs are hidden from the asker's
 * persona (legal-only) — the agent surfaces *what was hidden* and
 * answers from what's visible. A second persona-switch demo refuses
 * with a named rationale.
 */

import type { Scenario } from "../types";

const knowledgeScenario: Scenario = {
  slug: "enterprise-knowledge-concierge",
  toolTitle: { en: "Enterprise Knowledge Concierge", ar: "كونسيرج المعرفة المؤسسية" },
  accent: "#5C8CA8",
  description: {
    en: "A knowledge orchestrator answers a senior leader's question by routing through a Permission Filter, a Semantic Retriever, a Grounded Drafter, a Citation Auditor, and a Confidence Scorer — never answering without a citation trail back to a source the asker is allowed to see.",
    ar: "منسّق معرفي يجيب على سؤال قائد بقيادة فلتر صلاحيات، ومسترجِع، وكاتب، ومدقّق استشهاد، ومصنّف ثقة — ولا يجيب أبداً دون مسار استشهاد إلى وثيقة مسموح للسائل برؤيتها.",
  },
  buyer: { en: "Chief AI Officer", ar: "كبير مسؤولي الذكاء الاصطناعي" },
  trigger: { en: "CFO asks: 'What is our exposure to the EGP move on receivables?'", ar: "سؤال المدير المالي عن التعرّض لانخفاض الجنيه المصري على الذمم." },
  agents: [
    { id: "orch", name: { en: "Concierge Conductor", ar: "منسّق الكونسيرج" }, role: { en: "Plans the query and gates the answer.", ar: "يخطّط الاستعلام ويراقب الإجابة." }, kind: "orchestrator", color: "#5C8CA8" },
    { id: "perm", name: { en: "Permission Filter", ar: "فلتر الصلاحيات" }, role: { en: "Filters sources by the asker's persona ACLs.", ar: "يفلتر المصادر حسب صلاحيات السائل." }, kind: "specialist", color: "#156082" },
    { id: "ret", name: { en: "Semantic Retriever", ar: "المسترجِع الدلالي" }, role: { en: "Pulls candidate passages from the visible set.", ar: "يجلب مقاطع مرشّحة من المسموح." }, kind: "retriever", color: "#F5A623" },
    { id: "draft", name: { en: "Grounded Drafter", ar: "كاتب مؤصّل" }, role: { en: "Composes a defensible answer from passages.", ar: "يصوغ إجابة قابلة للدفاع." }, kind: "drafter", color: "#5BA98A" },
    { id: "audit", name: { en: "Citation Auditor", ar: "مدقّق الاستشهاد" }, role: { en: "Verifies every claim cites a real visible passage.", ar: "يتحقّق أن كل ادعاء يستشهد بمقطع مرئي." }, kind: "critic", color: "#D9534F" },
    { id: "conf", name: { en: "Confidence Scorer", ar: "مصنّف الثقة" }, role: { en: "Rates answer confidence; refuses below threshold.", ar: "يصنّف الثقة ويرفض دون العتبة." }, kind: "scorer", color: "#196B24" },
  ],
  tools: [
    { name: "filter_acl", description: { en: "Reduces source set to those visible to the asker.", ar: "يحدّ المصادر إلى المرئي للسائل." } },
    { name: "vector_search", description: { en: "Searches the visible-source vector index.", ar: "يبحث في فهرس المرئي." } },
    { name: "draft_with_citations", description: { en: "Drafts a grounded answer with inline citations.", ar: "يصوغ إجابة بمراجع." } },
    { name: "audit_citations", description: { en: "Verifies each citation resolves to a visible passage.", ar: "يتحقّق أن كل استشهاد لمقطع مرئي." } },
    { name: "score_confidence", description: { en: "Scores end-to-end confidence in the grounded answer.", ar: "يصنّف ثقة الإجابة." } },
    { name: "log_withhold", description: { en: "Logs hidden-but-relevant sources for the steward.", ar: "يسجّل المصادر المخفيّة للحارس." } },
  ],
  checkpoints: [
    {
      id: "compliance-withhold",
      human: { en: "Compliance Reviewer", ar: "مراجع الامتثال" },
      question: { en: "Approve the persona-aware reply, and review 2 hidden sources for possible re-classification?", ar: "هل توافق على الردّ، وتراجع مصدرَين مخفيَّين لإعادة التصنيف؟" },
      rationale: {
        en: "The CFO has access to 22 of 24 sources. 2 hidden sources (legal-privileged) materially affect the answer. The agent's reply is defensible *and* discloses that 2 sources were withheld. Recommend approve and book a re-classification review.",
        ar: "للمدير المالي 22 من 24 مصدراً. مصدران مخفيّان (سرّ قانوني) يؤثّران ماديّاً. الردّ قابل للدفاع ويُفصح عن الحجب. يُوصى بالموافقة وحجز مراجعة.",
      },
      options: [
        { id: "approve", label: { en: "Approve & book re-classification review", ar: "موافقة وحجز مراجعة" }, recommended: true },
        { id: "approve-only", label: { en: "Approve only (skip review)", ar: "موافقة فقط" } },
        { id: "send-back", label: { en: "Send back — refuse instead", ar: "إعادة — رفض بدلاً من الإجابة" } },
      ],
    },
  ],
  workflows: [
    {
      id: "exec-ask",
      name: { en: "Executive ask", ar: "سؤال تنفيذي" },
      description: { en: "ACL filter → retrieve → draft with citations → audit → score → answer or refuse.", ar: "صلاحيات → استرجاع → صياغة بمراجع → تدقيق → تصنيف → إجابة أو رفض." },
      trigger: { en: "Inbound chat question", ar: "سؤال دردشة وارد" },
      steps: [
        { agentId: "perm", label: { en: "ACL filter", ar: "فلتر الصلاحيات" } },
        { agentId: "ret", label: { en: "Retrieve passages", ar: "استرجاع المقاطع" } },
        { agentId: "draft", label: { en: "Draft with citations", ar: "صياغة بمراجع" } },
        { agentId: "audit", label: { en: "Audit citations", ar: "تدقيق" } },
        { agentId: "conf", label: { en: "Score confidence", ar: "تصنيف ثقة" } },
        { agentId: "orch", label: { en: "Answer or refuse", ar: "إجابة أو رفض" } },
      ],
    },
  ],
  kpis: [
    { id: "groundedness", label: { en: "Grounded answer rate", ar: "معدّل الإجابة المؤصّلة" }, initial: "—" },
    { id: "refusal", label: { en: "Defensible refusal rate", ar: "معدّل الرفض المُبرّر" }, initial: "—" },
    { id: "ttv", label: { en: "Time to answer", ar: "زمن الإجابة" }, initial: "—" },
    { id: "leaks", label: { en: "Permission leaks", ar: "تسريبات الصلاحيات" }, initial: "0", source: { en: "Glean public benchmarks + Maven AI deployments, 2025.", ar: "مقاييس Glean وعمليات نشر Maven AI 2025." } },
  ],
  initialInbox: [
    {
      id: "Q-2026-114",
      source: { en: "Persona: CFO · Chief Financial Officer", ar: "شخصية: المدير المالي" },
      subject: { en: "EGP exposure on receivables?", ar: "التعرّض على الجنيه المصري في الذمم؟" },
      preview: { en: "Asked in chat: “What is our exposure to the EGP move on receivables across our Egypt entities?”", ar: "سؤال في الدردشة عن التعرّض في كيانات مصر." },
      receivedAt: "11:08",
      status: "new",
      accent: "#5C8CA8",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "k1", kind: "think", agentId: "orch", label: { en: "Open executive-ask workflow", ar: "فتح سير السؤال التنفيذي" }, detail: { en: "CFO persona, financial question. Dispatch ACL filter → retriever → drafter → auditor → scorer. Refuse if confidence < 80%; surface withholds either way.", ar: "شخصية المدير المالي. توزيع المسارات. الرفض إذا قلّت الثقة 80% وإظهار المخفي." } },
    { id: "k2", kind: "update-inbox", agentId: "orch", label: { en: "Question picked up", ar: "تمّ التقاط السؤال" }, inboxUpdate: { id: "Q-2026-114", status: "in-progress" } },
    { id: "k3", kind: "handoff", agentId: "orch", toAgentId: "perm", label: { en: "Hand off to Permission Filter", ar: "تسليم إلى فلتر الصلاحيات" } },
    { id: "k4", kind: "tool-call", agentId: "perm", toolName: "filter_acl", label: { en: "Filter 24 sources by CFO ACL", ar: "فلتر 24 مصدراً بصلاحيات المدير المالي" }, toolResult: { en: "Visible to CFO: 22 / 24. Hidden: 2 (legal-privileged: 'EGP-litigation-memo-2026-04', 'JV-rescue-term-sheet-draft').", ar: "المرئي: 22/24. المخفي: 2 (سرّ قانوني)." } },
    {
      id: "k5", kind: "patch-workspace", agentId: "perm", label: { en: "Publish ACL summary", ar: "نشر ملخّص الصلاحيات" },
      workspacePatch: {
        op: "add", widget: {
          id: "acl-summary", kind: "metric-grid",
          title: { en: "ACL summary · CFO persona", ar: "ملخّص الصلاحيات · شخصية المدير المالي" },
          rows: [
            [{ en: "Sources visible", ar: "مصادر مرئية" }, { en: "22 / 24", ar: "22 / 24" }],
            [{ en: "Sources hidden", ar: "مصادر مخفيّة" }, { en: "2 (legal-privileged)", ar: "2 (سرّ قانوني)" }],
            [{ en: "Hidden but relevant?", ar: "مخفي ومتعلّق؟" }, { en: "Yes — agent will disclose", ar: "نعم — يُفصح الوكيل" }],
          ],
        },
      },
    },
    { id: "k6", kind: "handoff", agentId: "perm", toAgentId: "ret", label: { en: "Hand off to Semantic Retriever", ar: "تسليم إلى المسترجِع" } },
    { id: "k7", kind: "tool-call", agentId: "ret", toolName: "vector_search", label: { en: "Search visible 22-source set", ar: "بحث في 22 مصدراً" }, toolResult: { en: "Top 6 passages: Q1 Egypt receivables ledger, FX hedging policy, treasury weekly note (Apr 28), CFO board pack (Apr Q&A), audit AR ageing report, IFRS-9 ECL run.", ar: "أفضل 6 مقاطع: السجل الأول، سياسة التحوّط، الملخّص الأسبوعي، حزمة المجلس، تقرير التقادم، تشغيل IFRS-9." } },
    { id: "k8", kind: "handoff", agentId: "ret", toAgentId: "draft", label: { en: "Hand off to Grounded Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "k9", kind: "tool-call", agentId: "draft", toolName: "draft_with_citations", label: { en: "Draft answer with inline citations", ar: "صياغة إجابة بمراجع" } },
    {
      id: "k10", kind: "patch-workspace", agentId: "draft", label: { en: "Publish answer draft", ar: "نشر مسوّدة الإجابة" },
      workspacePatch: {
        op: "add", widget: {
          id: "answer", kind: "doc",
          title: { en: "Answer draft (CFO persona)", ar: "مسوّدة الإجابة (المدير المالي)" },
          rows: [
            [{ en: "Headline. Group exposure to the EGP move on receivables is USD 18.4M as of 28 Apr [src: Treasury weekly note], of which USD 11.2M is hedged and USD 7.2M sits open in the Egypt B2G subsidiary [src: FX hedging policy].", ar: "العنوان. التعرّض 18.4M$ بتاريخ 28 أبريل، منه 11.2M$ متحوّط و7.2M$ مفتوح في الفرع المصري." }],
            [{ en: "Recognised loss to date. The Q1 ledger booked AED 4.6M IFRS-9 ECL uplift on the open exposure [src: IFRS-9 ECL run, AR ageing report].", ar: "الخسارة المعترف بها. حجزت Q1 رفعاً 4.6M درهم بحسب IFRS-9." }],
            [{ en: "Disclosure. 2 sources matching this question are withheld for legal privilege ('EGP-litigation-memo-2026-04', 'JV-rescue-term-sheet-draft'). They may materially change the answer. Recommend booking a Compliance review.", ar: "إفصاح. يُحجب مصدران لسرّ قانوني وقد يغيّران الإجابة. يُوصى بمراجعة." }],
          ],
        },
      },
    },
    { id: "k11", kind: "handoff", agentId: "draft", toAgentId: "audit", label: { en: "Hand off to Citation Auditor", ar: "تسليم إلى المدقّق" } },
    { id: "k12", kind: "tool-call", agentId: "audit", toolName: "audit_citations", label: { en: "Audit each citation resolves", ar: "تدقيق المراجع" }, toolResult: { en: "All 5 citations resolve to visible passages. No hallucinated sources. Withholds disclosed cleanly.", ar: "كل 5 مراجع تتوافق. لا مراجع مفبركة. الإفصاح نظيف." } },
    { id: "k13", kind: "handoff", agentId: "audit", toAgentId: "conf", label: { en: "Hand off to Confidence Scorer", ar: "تسليم إلى مصنّف الثقة" } },
    { id: "k14", kind: "tool-call", agentId: "conf", toolName: "score_confidence", label: { en: "Score confidence", ar: "تصنيف الثقة" }, toolResult: { en: "Confidence 84%. Above 80% threshold. Withholds risk noted as material; recommend Compliance review.", ar: "الثقة 84%. فوق العتبة. الحجب مهمّ؛ يُوصى بمراجعة." } },
    { id: "k15", kind: "update-kpi", agentId: "conf", label: { en: "Grounded answer rate (rolling 100) → 96%", ar: "معدّل الإجابة المؤصّلة → 96%" }, kpiPatch: { id: "groundedness", value: "96%", delta: "+18 pts" } },
    { id: "k16", kind: "update-kpi", agentId: "conf", label: { en: "Time to answer = 3.4s", ar: "زمن الإجابة = 3.4 ثانية" }, kpiPatch: { id: "ttv", value: "3.4 s", delta: "-99%" } },
    { id: "k17", kind: "tool-call", agentId: "orch", toolName: "log_withhold", label: { en: "Log hidden-but-relevant sources", ar: "تسجيل المخفي ذي الصلة" }, toolResult: { en: "Logged 2 hidden sources with question id Q-2026-114 for steward review.", ar: "تسجيل مصدرَين مع رقم السؤال." } },
    { id: "k18", kind: "checkpoint", agentId: "orch", checkpointId: "compliance-withhold", label: { en: "Pause for Compliance review of withholds", ar: "توقف لمراجعة المخفي" } },
    { id: "k19", kind: "think", agentId: "orch", label: { en: "Persona switch demo: Junior Analyst", ar: "تجربة شخصية: محلّل مبتدئ" }, detail: { en: "Visitor switches persona. Visible sources drop from 22 to 8. Re-running the same question.", ar: "تبديل الشخصية. تراجع المرئي إلى 8. إعادة الجولة." } },
    { id: "k20", kind: "tool-call", agentId: "perm", toolName: "filter_acl", label: { en: "Re-filter for Junior Analyst", ar: "إعادة فلتر للمحلّل" }, toolResult: { en: "Visible: 8 / 24. Treasury, IFRS-9, audit reports all hidden. Visitor cannot answer this question safely.", ar: "المرئي: 8/24. المصادر الجوهرية مخفيّة. لا يمكن الإجابة بأمان." } },
    {
      id: "k21", kind: "patch-workspace", agentId: "draft", label: { en: "Publish defensible refusal", ar: "نشر رفض مبرّر" },
      workspacePatch: {
        op: "add", widget: {
          id: "refusal", kind: "doc",
          title: { en: "Refusal (Junior Analyst persona)", ar: "رفض (شخصية المحلّل)" },
          rows: [
            [{ en: "I cannot answer this from your visible source set. The 6 sources I would have used (Treasury weekly, FX hedging policy, IFRS-9 ECL run, AR ageing report, CFO board pack, EGP exposure ledger) are not visible to your persona. Forwarding the question to your manager.", ar: "لا أستطيع الإجابة من مصادرك المرئية. المصادر اللازمة غير متاحة لشخصيّتك. تمّت إحالة السؤال إلى مديرك." }],
          ],
        },
      },
    },
    { id: "k22", kind: "update-kpi", agentId: "orch", label: { en: "Defensible refusal rate (rolling) → 100%", ar: "معدّل الرفض المبرّر → 100%" }, kpiPatch: { id: "refusal", value: "100%", delta: "+100%" } },
    { id: "k23", kind: "update-kpi", agentId: "orch", label: { en: "Permission leaks: 0", ar: "تسريبات الصلاحيات: 0" }, kpiPatch: { id: "leaks", value: "0", delta: "0" } },
    { id: "k24", kind: "update-inbox", agentId: "orch", label: { en: "Mark question resolved", ar: "تعليم السؤال مغلق" }, inboxUpdate: { id: "Q-2026-114", status: "resolved" } },
    { id: "k25", kind: "complete", agentId: "orch", label: { en: "Run complete. Answer cited, withholds disclosed, audit log closed.", ar: "اكتمل التشغيل. الإجابة بمراجع، والمخفي مُفصح، والسجل مغلق." } },
  ],
};

export default knowledgeScenario;
