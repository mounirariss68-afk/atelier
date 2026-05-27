/**
 * Procurement Negotiation Agent — full scripted run.
 *
 * Tuesday 09:12. A counter-offer from supplier "Najm Logistics" lands
 * 4 days before the RFP deadline. The conductor runs Spend Analyst →
 * Supplier-Risk Scorer → Counter-Offer Drafter → Negotiation Coach,
 * pauses at the CPO for the savings target, then again at Legal
 * before the email goes out.
 */

import type { Scenario } from "../types";

const procurementScenario: Scenario = {
  slug: "procurement-negotiation-agent",
  toolTitle: { en: "Procurement Negotiation Agent", ar: "وكيل التفاوض على المشتريات" },
  accent: "#D9534F",
  description: {
    en: "A negotiation orchestrator coordinates a Spend Analyst, a Supplier-Risk Scorer, a Counter-Offer Drafter, and a Negotiation Coach to advance an active RFP — pausing for the CPO and Legal before any reply leaves the inbox.",
    ar: "منسّق تفاوض يقود محلّل الإنفاق ومصنّف مخاطر الموردين وكاتب العروض المضادة ومدرّب التفاوض لتحريك مناقصة قائمة — مع التوقف للمشتريات والقانوني قبل أيّ ردّ.",
  },
  buyer: { en: "CPO + Category Manager", ar: "مدير المشتريات ومدير الفئة" },
  trigger: { en: "Najm Logistics counter-offer arrives 4 days before deadline.", ar: "وصول عرض مضادّ من نجم لوجستيكس قبل 4 أيام من الموعد." },
  agents: [
    { id: "orch", name: { en: "Negotiation Orchestrator", ar: "منسّق التفاوض" }, role: { en: "Sequences the analysts and gates outbound replies.", ar: "يرتّب المحلّلين ويراقب الردود الصادرة." }, kind: "orchestrator", color: "#D9534F" },
    { id: "spend", name: { en: "Spend Analyst", ar: "محلّل الإنفاق" }, role: { en: "Triangulates the offer against historical spend.", ar: "يقارن العرض بالإنفاق التاريخي." }, kind: "specialist", color: "#5B7CFF" },
    { id: "risk", name: { en: "Supplier-Risk Scorer", ar: "مصنّف مخاطر المورد" }, role: { en: "Scores supplier risk: financial, geopolitical, ESG.", ar: "يصنّف المخاطر: مالية وجيوسياسية واستدامة." }, kind: "scorer", color: "#C45BB8" },
    { id: "counter", name: { en: "Counter-Offer Drafter", ar: "كاتب العرض المضادّ" }, role: { en: "Drafts the counter and a fall-back position.", ar: "يصوغ العرض المضادّ وموقفاً احتياطياً." }, kind: "drafter", color: "#8A5BD6" },
    { id: "coach", name: { en: "Negotiation Coach", ar: "مدرّب التفاوض" }, role: { en: "Critiques the draft, names the BATNA risk.", ar: "ينتقد المسودّة ويسمّي مخاطرة البديل." }, kind: "critic", color: "#5BA98A" },
  ],
  tools: [
    { name: "triangulate_spend", description: { en: "Compares the offer against 24 months of category spend.", ar: "يقارن العرض بـ 24 شهراً من الإنفاق." } },
    { name: "score_supplier_risk", description: { en: "Runs the financial, geopolitical, ESG risk scan.", ar: "يشغّل مسح المخاطر المالية والجيوسياسية والاستدامة." } },
    { name: "draft_counter", description: { en: "Drafts the counter and the fall-back position.", ar: "يصوغ العرض المضادّ والموقف البديل." } },
    { name: "coach_critique", description: { en: "Red-teams the draft against the playbook.", ar: "يراجع المسوّدة مقابل دليل التفاوض." } },
    { name: "send_email", description: { en: "Sends the cleared email to the supplier.", ar: "يرسل البريد المعتمد للمورد." } },
  ],
  checkpoints: [
    {
      id: "cpo-target",
      human: { en: "CPO", ar: "مدير المشتريات" },
      question: { en: "Approve the 6.4% target and the $1.18M counter as the negotiating position?", ar: "هل توافق على هدف 6.4% والعرض المضادّ 1.18M$ كموقف تفاوضي؟" },
      rationale: {
        en: "Spend triangulation supports a 4.8–7.1% range; the coach recommends pinning at 6.4% with a 5.5% fall-back. Risk scorer found one yellow flag (single-port concentration). Recommend approve with the fall-back loaded.",
        ar: "يدعم تحليل الإنفاق نطاق 4.8–7.1%؛ يوصي المدرّب بـ 6.4% مع بديل 5.5%. وجد المُصنّف تنبيهاً أصفر واحداً (تركّز في ميناء واحد). يُوصى بالموافقة مع تجهيز البديل.",
      },
      options: [
        { id: "approve", label: { en: "Approve target & counter", ar: "موافقة على الهدف والعرض" }, recommended: true },
        { id: "lower", label: { en: "Lower target to 5.5% (less aggressive)", ar: "خفض الهدف إلى 5.5%" } },
        { id: "decline", label: { en: "Decline — re-scope before negotiating", ar: "رفض — إعادة نطاق أولاً" } },
      ],
    },
    {
      id: "legal-release",
      human: { en: "General Counsel", ar: "المستشار العام" },
      question: { en: "Release the counter-offer email to Najm Logistics?", ar: "هل تسمح بإرسال البريد لنجم لوجستيكس؟" },
      rationale: {
        en: "Coach reviewed and the language uses the agreed non-binding qualifier (“subject to internal approvals”). No commercial commitment in writing. Recommend release.",
        ar: "راجع المدرّب اللغة واستخدمت العبارة غير المُلزمة المتفق عليها. لا التزام تجاري كتابي. يُوصى بالإفراج.",
      },
      options: [
        { id: "release", label: { en: "Release the email", ar: "إفراج البريد" }, recommended: true },
        { id: "edit", label: { en: "Edit clause 4, then release", ar: "تعديل البند 4 ثم الإفراج" } },
        { id: "hold", label: { en: "Hold for in-person meeting", ar: "تأجيل لاجتماع شخصي" } },
      ],
    },
  ],
  workflows: [
    {
      id: "active-rfp",
      name: { en: "Active RFP turn", ar: "جولة مناقصة قائمة" },
      description: { en: "Counter arrives → spend → risk → counter draft → coach critique → CPO + Legal checkpoints.", ar: "وصول عرض → إنفاق → مخاطر → صياغة → نقد → نقاط موافقة المشتريات والقانوني." },
      trigger: { en: "Inbound supplier email", ar: "بريد وارد من المورد" },
      steps: [
        { agentId: "spend", label: { en: "Triangulate price", ar: "ترييث السعر" } },
        { agentId: "risk", label: { en: "Score risk", ar: "تصنيف المخاطر" } },
        { agentId: "counter", label: { en: "Draft counter", ar: "صياغة المضادّ" } },
        { agentId: "coach", label: { en: "Critique", ar: "نقد" } },
        { agentId: "orch", label: { en: "CPO + Legal checkpoints", ar: "نقاط موافقة المشتريات والقانوني" } },
      ],
    },
  ],
  kpis: [
    { id: "savings", label: { en: "Savings unlocked / RFP", ar: "وفورات لكل مناقصة" }, initial: "—" },
    { id: "cycle", label: { en: "Negotiation cycle time", ar: "زمن دورة التفاوض" }, initial: "—", source: { en: "Bain Procurement Excellence benchmarks, 2024.", ar: "مقاييس Bain للتميّز في المشتريات 2024." } },
    { id: "risk-cov", label: { en: "Supplier risk coverage", ar: "تغطية مخاطر الموردين" }, initial: "—" },
    { id: "drift-flag", label: { en: "Time from drift to flag", ar: "زمن من الانحراف إلى التنبيه" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "rfp-2026-Q2-LOG",
      source: { en: "Najm Logistics — sales@najm-log.sa", ar: "نجم لوجستيكس — sales@najm-log.sa" },
      subject: { en: "Counter-offer · RFP-2026-Q2-LOG (port handling)", ar: "عرض مضادّ · RFP-2026-Q2-LOG (مناولة موانئ)" },
      preview: { en: "Counter at $1.26M (vs $1.10M target). 24-month term, single-port operation, take-or-pay clause attached.", ar: "عرض 1.26M$ (مقابل هدف 1.10M$). مدّة 24 شهراً، ميناء واحد، شرط الاستهلاك الأدنى." },
      receivedAt: "Tue 09:12",
      status: "new",
      accent: "#D9534F",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "n1", kind: "think", agentId: "orch", label: { en: "Pick active-RFP workflow", ar: "اختيار سير المناقصة القائمة" }, detail: { en: "Counter-offer matches active-RFP trigger. 4 days to deadline. Dispatch Spend → Risk → Counter → Coach. Two human gates.", ar: "العرض مطابق للنمط. أربعة أيام للموعد. توزيع: إنفاق ← مخاطر ← مضادّ ← مدرّب. نقطتان." } },
    { id: "n2", kind: "update-inbox", agentId: "orch", label: { en: "RFP picked up", ar: "تمّ التقاط المناقصة" }, inboxUpdate: { id: "rfp-2026-Q2-LOG", status: "in-progress" } },
    { id: "n3", kind: "handoff", agentId: "orch", toAgentId: "spend", label: { en: "Hand off to Spend Analyst", ar: "تسليم إلى محلّل الإنفاق" } },
    { id: "n4", kind: "tool-call", agentId: "spend", toolName: "triangulate_spend", label: { en: "Triangulate against 24 months of port-handling spend", ar: "مقارنة بـ 24 شهراً من إنفاق مناولة الموانئ" }, toolResult: { en: "Median market: $1.04M / yr. Najm offer $1.26M is 21% above median, 13% above last awarded contract. Defensible counter range: $1.08–1.18M.", ar: "الوسيط: 1.04M$/سنة. عرض نجم 21% أعلى من الوسيط و13% فوق آخر عقد. نطاق المضادّ: 1.08–1.18M$." } },
    {
      id: "n5", kind: "patch-workspace", agentId: "spend", label: { en: "Publish spend triangulation", ar: "نشر تحليل الإنفاق" },
      workspacePatch: {
        op: "add", widget: {
          id: "triangulation", kind: "table",
          title: { en: "Spend triangulation", ar: "تحليل الإنفاق" },
          rows: [
            [{ en: "Reference", ar: "المرجع" }, { en: "Annual price", ar: "السعر السنوي" }, { en: "Δ vs Najm", ar: "الفرق" }],
            [{ en: "Najm counter (today)", ar: "عرض نجم (اليوم)" }, { en: "$1.26M", ar: "1.26M$" }, { en: "—", ar: "—" }],
            [{ en: "Last awarded (2024)", ar: "آخر منح (2024)" }, { en: "$1.11M", ar: "1.11M$" }, { en: "−13%", ar: "−13%" }],
            [{ en: "Market median (24m)", ar: "وسيط السوق" }, { en: "$1.04M", ar: "1.04M$" }, { en: "−21%", ar: "−21%" }],
            [{ en: "Defensible counter", ar: "المضادّ القابل للدفاع" }, { en: "$1.08–1.18M", ar: "1.08–1.18M$" }, { en: "−6 to −17%", ar: "−6 إلى −17%" }],
          ],
        },
      },
    },
    { id: "n6", kind: "update-kpi", agentId: "spend", label: { en: "Drift flagged in 18 minutes", ar: "تنبيه الانحراف خلال 18 دقيقة" }, kpiPatch: { id: "drift-flag", value: "18 min", delta: "-99%" } },
    { id: "n7", kind: "handoff", agentId: "spend", toAgentId: "risk", label: { en: "Hand off to Supplier-Risk Scorer", ar: "تسليم إلى مصنّف المخاطر" } },
    { id: "n8", kind: "tool-call", agentId: "risk", toolName: "score_supplier_risk", label: { en: "Score Najm risk profile", ar: "تصنيف ملف نجم" }, toolResult: { en: "Financial: A− (stable). Geopolitical: green. ESG: amber (one social audit gap). Operational: yellow — single-port concentration (Jeddah only).", ar: "مالي: A− (مستقر). جيوسياسي: أخضر. استدامة: أصفر (ثغرة تدقيق واحدة). تشغيلي: أصفر — تركّز في ميناء واحد (جدّة)." } },
    {
      id: "n9", kind: "patch-workspace", agentId: "risk", label: { en: "Publish supplier scorecard", ar: "نشر بطاقة مخاطر المورد" },
      workspacePatch: {
        op: "add", widget: {
          id: "scorecard", kind: "metric-grid",
          title: { en: "Najm Logistics — risk scorecard", ar: "نجم لوجستيكس — بطاقة المخاطر" },
          rows: [
            [{ en: "Financial", ar: "مالي" }, { en: "A− · Stable", ar: "A− · مستقر" }],
            [{ en: "Geopolitical", ar: "جيوسياسي" }, { en: "Green", ar: "أخضر" }],
            [{ en: "ESG", ar: "استدامة" }, { en: "Amber · 1 audit gap", ar: "أصفر · ثغرة تدقيق" }],
            [{ en: "Operational", ar: "تشغيلي" }, { en: "Yellow · single-port (Jeddah)", ar: "أصفر · ميناء واحد" }],
          ],
        },
      },
    },
    { id: "n10", kind: "update-kpi", agentId: "risk", label: { en: "Risk coverage = 4 / 4", ar: "تغطية المخاطر = 4/4" }, kpiPatch: { id: "risk-cov", value: "4 / 4", delta: "+4" } },
    { id: "n11", kind: "handoff", agentId: "risk", toAgentId: "counter", label: { en: "Hand off to Counter-Offer Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "n12", kind: "tool-call", agentId: "counter", toolName: "draft_counter", label: { en: "Draft counter + fall-back", ar: "صياغة المضادّ والبديل" } },
    {
      id: "n13", kind: "patch-workspace", agentId: "counter", label: { en: "Publish counter-offer draft", ar: "نشر مسوّدة العرض" },
      workspacePatch: {
        op: "add", widget: {
          id: "counter-doc", kind: "doc",
          title: { en: "Counter-offer to Najm (draft)", ar: "العرض المضادّ لنجم (مسوّدة)" },
          rows: [
            [{ en: "Offer. $1.18M / year, 18-month term, dual-port operation (Jeddah + Dammam) to mitigate concentration, take-or-pay removed.", ar: "العرض. 1.18M$/سنة، مدة 18 شهراً، ميناءان (جدّة + الدمّام)، حذف شرط الاستهلاك." }],
            [{ en: "Fall-back. $1.22M / year if dual-port is operationally infeasible inside 60 days, contingent on a 4% volume rebate.", ar: "البديل. 1.22M$/سنة إذا تعذّر الميناءان خلال 60 يوماً، مع خصم حجم 4%." }],
            [{ en: "Standard non-binding clause: subject to internal approvals.", ar: "بند قياسي غير مُلزم: مرهون بالموافقات الداخلية." }],
          ],
        },
      },
    },
    { id: "n14", kind: "handoff", agentId: "counter", toAgentId: "coach", label: { en: "Hand off to Negotiation Coach", ar: "تسليم إلى مدرّب التفاوض" } },
    { id: "n15", kind: "tool-call", agentId: "coach", toolName: "coach_critique", label: { en: "Red-team the counter", ar: "نقد المضادّ" }, toolResult: { en: "Counter is defensible. BATNA: re-tender (cost: 6 weeks + $40k). Coach recommends pinning target at 6.4% saving ($80k/yr) with 5.5% fall-back.", ar: "المضادّ قابل للدفاع. البديل: إعادة المناقصة (6 أسابيع + 40k$). يوصي المدرّب بهدف 6.4% (80k$/سنة) مع بديل 5.5%." } },
    { id: "n16", kind: "update-kpi", agentId: "coach", label: { en: "Projected savings: $80k / yr (6.4%)", ar: "الوفورات المتوقعة: 80k$/سنة (6.4%)" }, kpiPatch: { id: "savings", value: "$80k / yr", delta: "+$80k" } },
    { id: "n17", kind: "checkpoint", agentId: "orch", checkpointId: "cpo-target", label: { en: "Pause for CPO sign-off on target", ar: "توقف لموافقة المشتريات" } },
    { id: "n18", kind: "checkpoint", agentId: "orch", checkpointId: "legal-release", label: { en: "Pause for Legal release", ar: "توقف لإفراج القانوني" } },
    { id: "n19", kind: "tool-call", agentId: "orch", toolName: "send_email", label: { en: "Send counter to Najm", ar: "إرسال المضادّ لنجم" }, toolResult: { en: "Sent at 11:47 with non-binding qualifier intact. Reply due Friday EOD.", ar: "أُرسل الساعة 11:47 مع العبارة غير المُلزمة. الردّ مطلوب الجمعة." } },
    { id: "n20", kind: "update-kpi", agentId: "orch", label: { en: "Cycle time: 2h 35m vs 9-day baseline", ar: "زمن الدورة: 2س35د مقابل 9 أيام" }, kpiPatch: { id: "cycle", value: "2h 35m", delta: "-97%" } },
    { id: "n21", kind: "update-inbox", agentId: "orch", label: { en: "Mark RFP awaiting reply", ar: "تعليم المناقصة بانتظار الردّ" }, inboxUpdate: { id: "rfp-2026-Q2-LOG", status: "resolved" } },
    { id: "n22", kind: "complete", agentId: "orch", label: { en: "Run complete. Counter sent, audit log closed.", ar: "اكتمل التشغيل. أُرسل المضادّ وأُغلق السجل." } },
  ],
};

export default procurementScenario;
