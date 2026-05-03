/**
 * Value Realization Tool — flagship scenario.
 *
 * Buyer: CFO + COO of a GCC group with an enterprise AI book of work.
 * Trigger: Friday close. The CFO needs the Monday board read on whether
 * the AI portfolio is delivering the dollars promised.
 *
 * The orchestrator runs four specialists in sequence: Portfolio Watcher
 * (snapshot), UVR Scorer (rate every initiative), Leakage Detective
 * (name the bleeders), CFO Narrator (draft the one-pager). The CFO
 * checkpoint gates the publish.
 */

import type { Scenario } from "../types";

const PORTFOLIO = [
  { name: "Citizen-services agent", invested: "1.2M", expected: "4.2M", realized: "3.35M", confidence: "80%", status: "Live" },
  { name: "Network-ops copilot", invested: "1.8M", expected: "6.8M", realized: "4.6M", confidence: "75%", status: "Live" },
  { name: "SAMA compliance copilot", invested: "0.9M", expected: "2.4M", realized: "1.9M", confidence: "90%", status: "Live" },
  { name: "Procurement intelligence", invested: "2.1M", expected: "9.5M", realized: "5.2M", confidence: "60%", status: "Scaling" },
  { name: "Demand forecaster (grocery)", invested: "0.8M", expected: "3.1M", realized: "1.4M", confidence: "65%", status: "Pilot" },
  { name: "Hospitality revenue optimizer", invested: "0.7M", expected: "5.4M", realized: "0", confidence: "40%", status: "Pilot" },
];

const valueRealizationScenario: Scenario = {
  slug: "value-realization",
  toolTitle: { en: "Value Realization Tool", ar: "أداة تحقيق القيمة" },
  accent: "#F5A623",
  description: {
    en: "A CFO-grade scoreboard for an enterprise AI portfolio. Watch four specialist agents, coordinated by an orchestrator, snapshot the book of work, score each initiative on the UVR rubric, name the leaking ones, and draft the board one-pager — pausing for the CFO before anything publishes.",
    ar: "لوحة قياس بمستوى المدير المالي لمحفظة ذكاء اصطناعي مؤسسية. شاهد أربعة وكلاء متخصصين بقيادة منسّق يلتقطون كتاب العمل، ويصنّفون كل مبادرة وفق منهج UVR، ويسمّون المبادرات المتسرّبة، ويصوغون صفحة المجلس — مع التوقف لطلب موافقة المدير المالي قبل أي نشر.",
  },
  buyer: { en: "CFO + COO", ar: "المدير المالي والمدير التنفيذي للعمليات" },
  trigger: {
    en: "Friday 17:00. The CFO has a Monday board slot and needs a defensible read on the AI portfolio's run-rate value.",
    ar: "الجمعة 17:00. لدى المدير المالي شريحة في مجلس الإثنين ويحتاج قراءة قابلة للدفاع عن القيمة التشغيلية للمحفظة.",
  },
  agents: [
    {
      id: "orchestrator",
      name: { en: "Portfolio Orchestrator", ar: "منسّق المحفظة" },
      role: { en: "Plans the run, dispatches specialists, gates the publish.", ar: "يخطّط الجولة ويوزّع المهام ويراقب النشر." },
      kind: "orchestrator",
      color: "#F5A623",
    },
    {
      id: "watcher",
      name: { en: "Portfolio Watcher", ar: "مراقب المحفظة" },
      role: { en: "Snapshots the book of work from ERP and project ledger.", ar: "يلتقط كتاب العمل من ERP وسجل المشاريع." },
      kind: "monitor",
      color: "#156082",
    },
    {
      id: "scorer",
      name: { en: "UVR Scorer", ar: "مصنّف UVR" },
      role: { en: "Scores every initiative on value, feasibility, governance fit.", ar: "يصنّف كل مبادرة على القيمة والجدوى وتوافق الحوكمة." },
      kind: "scorer",
      color: "#5C8CA8",
    },
    {
      id: "detective",
      name: { en: "Leakage Detective", ar: "محقّق التسرّب" },
      role: { en: "Finds bleeding initiatives and names the dominant cause.", ar: "يكتشف المبادرات المتسرّبة ويحدّد السبب الغالب." },
      kind: "critic",
      color: "#D9534F",
    },
    {
      id: "narrator",
      name: { en: "CFO Narrator", ar: "كاتب ملخّص المدير المالي" },
      role: { en: "Drafts the printable board one-pager in CFO house style.", ar: "يصوغ صفحة المجلس بأسلوب المدير المالي." },
      kind: "drafter",
      color: "#196B24",
    },
  ],
  tools: [
    { name: "snapshot_portfolio", description: { en: "Pulls every initiative from ERP + project ledger.", ar: "يجلب كل مبادرة من ERP وسجل المشاريع." } },
    { name: "score_uvr", description: { en: "Runs the UVR rubric on a single initiative.", ar: "يطبّق منهج UVR على مبادرة واحدة." } },
    { name: "detect_leakage", description: { en: "Identifies the dominant cause of value bleed.", ar: "يحدّد السبب الغالب لتسرّب القيمة." } },
    { name: "draft_one_pager", description: { en: "Drafts the board one-pager from the scoreboard.", ar: "يصوغ صفحة المجلس من لوحة القياس." } },
    { name: "publish_board_pack", description: { en: "Sends the signed one-pager to the board pack.", ar: "يُرسل الصفحة الموقّعة إلى حزمة المجلس." } },
  ],
  checkpoints: [
    {
      id: "cfo-signoff",
      human: { en: "CFO", ar: "المدير المالي" },
      question: {
        en: "Approve the board one-pager and ship it to the Monday pack?",
        ar: "هل توافق على صفحة المجلس وإرسالها لحزمة الإثنين؟",
      },
      rationale: {
        en: "The narrator drafted from the scored portfolio and the leakage callouts. Numbers carry full provenance back to ERP. Recommend approve unless you want to soften the procurement leakage callout.",
        ar: "صاغ الكاتب الصفحة من المحفظة المصنّفة وتنبيهات التسرّب. ترتبط الأرقام مرجعياً بـ ERP. يُوصى بالموافقة ما لم ترغب في تخفيف تنبيه تسرّب المشتريات.",
      },
      options: [
        { id: "approve", label: { en: "Approve and publish", ar: "موافقة ونشر" }, recommended: true },
        { id: "soften", label: { en: "Soften procurement callout, then publish", ar: "تخفيف تنبيه المشتريات ثم النشر" } },
        { id: "send-back", label: { en: "Send back to narrator", ar: "إعادة للكاتب" } },
      ],
    },
  ],
  workflows: [
    {
      id: "weekly-cfo-readout",
      name: { en: "Weekly CFO read-out", ar: "إفادة المدير المالي الأسبوعية" },
      description: {
        en: "Every Friday 17:00 — snapshot, score, detect leakage, draft, gate on the CFO, publish to the board pack.",
        ar: "كل جمعة 17:00 — التقاط، تقييم، اكتشاف تسرّب، صياغة، توقف للمدير المالي، نشر في حزمة المجلس.",
      },
      trigger: { en: "Friday 17:00 cron", ar: "جدولة الجمعة 17:00" },
      steps: [
        { agentId: "watcher", label: { en: "Snapshot ERP + ledger", ar: "التقاط ERP والسجل" } },
        { agentId: "scorer", label: { en: "UVR each initiative", ar: "تصنيف UVR" } },
        { agentId: "detective", label: { en: "Name the bleeders", ar: "تسمية المتسرّبين" } },
        { agentId: "narrator", label: { en: "Draft one-pager", ar: "صياغة الصفحة" } },
        { agentId: "orchestrator", label: { en: "CFO checkpoint", ar: "نقطة موافقة المدير المالي" } },
      ],
    },
    {
      id: "milestone-event",
      name: { en: "Milestone event re-score", ar: "إعادة تصنيف عند حدث محطّة" },
      description: {
        en: "Whenever a milestone slips or an initiative changes status, re-run the scorer + detective on just that initiative and update the scoreboard.",
        ar: "عند انزلاق محطّة أو تغيّر حالة، يعاد تشغيل المصنّف والمحقّق على المبادرة فقط وتحديث لوحة القياس.",
      },
      trigger: { en: "ERP webhook: milestone or status change", ar: "Webhook من ERP: تغيّر محطّة أو حالة" },
      steps: [
        { agentId: "watcher", label: { en: "Pull delta", ar: "جلب التغيّر" } },
        { agentId: "scorer", label: { en: "Re-score affected", ar: "إعادة تصنيف المتأثر" } },
        { agentId: "detective", label: { en: "Update leakage callout", ar: "تحديث تنبيه التسرّب" } },
      ],
    },
  ],
  kpis: [
    {
      id: "portfolio-roi",
      label: { en: "Portfolio ROI %", ar: "العائد على المحفظة %" },
      initial: "—",
      source: { en: "Computed from ERP + business cases", ar: "محسوبة من ERP وحالات العمل" },
    },
    {
      id: "value-at-risk",
      label: { en: "Value at risk (USD)", ar: "القيمة المعرّضة للخطر" },
      initial: "—",
    },
    {
      id: "initiatives-scored",
      label: { en: "Initiatives scored", ar: "المبادرات المُصنّفة" },
      initial: "0 / 6",
    },
    {
      id: "time-to-readout",
      label: { en: "Time to CFO readout", ar: "زمن إعداد إفادة المدير المالي" },
      initial: "—",
      source: {
        en: "Maven AI delivery telemetry — 4 GCC pilots, 2025.",
        ar: "قياسات تسليم Maven AI — 4 تجارب خليجية، 2025.",
      },
    },
  ],
  initialInbox: [
    {
      id: "kickoff",
      source: { en: "scheduler@maven.ai", ar: "scheduler@maven.ai" },
      subject: { en: "Friday 17:00 — Weekly CFO read-out", ar: "الجمعة 17:00 — إفادة المدير المالي الأسبوعية" },
      preview: {
        en: "Run the value-realization workflow and prep a one-pager for Monday's board.",
        ar: "تشغيل سير عمل تحقيق القيمة وتحضير صفحة لمجلس الإثنين.",
      },
      receivedAt: "Fri 17:00",
      status: "new",
      accent: "#F5A623",
    },
  ],
  initialWorkspace: [],
  events: [
    {
      id: "v1",
      kind: "think",
      agentId: "orchestrator",
      label: { en: "Pick the weekly CFO read-out workflow", ar: "اختيار سير عمل الإفادة الأسبوعية" },
      detail: {
        en: "Trigger matches the Friday cron. Dispatching Watcher → Scorer → Detective → Narrator. CFO checkpoint will gate the publish.",
        ar: "المحفّز يطابق جدولة الجمعة. توزيع: مراقب ← مصنّف ← محقّق ← كاتب. ستوقف نقطة المدير المالي النشر.",
      },
    },
    {
      id: "v2",
      kind: "update-inbox",
      agentId: "orchestrator",
      label: { en: "Inbox item picked up", ar: "تم التقاط عنصر الوارد" },
      inboxUpdate: { id: "kickoff", status: "in-progress" },
    },
    {
      id: "v3",
      kind: "handoff",
      agentId: "orchestrator",
      toAgentId: "watcher",
      label: { en: "Hand off to Portfolio Watcher", ar: "تسليم إلى مراقب المحفظة" },
    },
    {
      id: "v4",
      kind: "tool-call",
      agentId: "watcher",
      toolName: "snapshot_portfolio",
      label: { en: "Snapshot ERP + project ledger", ar: "التقاط ERP وسجل المشاريع" },
      toolResult: {
        en: "6 initiatives loaded. 4 live, 2 in pilot. AED 7.5M invested to date.",
        ar: "تحميل 6 مبادرات. 4 حيّة، 2 تجريبية. 7.5M درهم مُستثمر.",
      },
    },
    {
      id: "v5",
      kind: "patch-workspace",
      agentId: "watcher",
      label: { en: "Publish portfolio snapshot to workspace", ar: "نشر لقطة المحفظة في مساحة العمل" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "portfolio-table",
          kind: "table",
          title: { en: "Portfolio snapshot", ar: "لقطة المحفظة" },
          rows: [
            [
              { en: "Initiative", ar: "المبادرة" },
              { en: "Invested", ar: "المستثمر" },
              { en: "Expected", ar: "المتوقع" },
              { en: "Realised", ar: "المحقق" },
              { en: "Conf.", ar: "الثقة" },
              { en: "Status", ar: "الحالة" },
            ],
            ...PORTFOLIO.map((p) => [
              { en: p.name, ar: p.name },
              { en: `$${p.invested}`, ar: `$${p.invested}` },
              { en: `$${p.expected}`, ar: `$${p.expected}` },
              { en: `$${p.realized}`, ar: `$${p.realized}` },
              { en: p.confidence, ar: p.confidence },
              { en: p.status, ar: p.status },
            ]),
          ],
        },
      },
    },
    {
      id: "v6",
      kind: "handoff",
      agentId: "watcher",
      toAgentId: "scorer",
      label: { en: "Hand off to UVR Scorer", ar: "تسليم إلى مصنّف UVR" },
    },
    {
      id: "v7",
      kind: "tool-call",
      agentId: "scorer",
      toolName: "score_uvr",
      label: { en: "UVR-score every initiative", ar: "تصنيف UVR لكل مبادرة" },
      toolResult: {
        en: "6 / 6 scored. 3 strong (UVR ≥ 70). 2 watchlist (40–69). 1 underperforming (< 40).",
        ar: "6/6 مُصنّفة. 3 قوية (≥70). 2 على قائمة المراقبة. 1 ضعيفة الأداء.",
      },
    },
    {
      id: "v8",
      kind: "update-kpi",
      agentId: "scorer",
      label: { en: "Initiatives scored = 6/6", ar: "المبادرات المُصنّفة = 6/6" },
      kpiPatch: { id: "initiatives-scored", value: "6 / 6", delta: "+6" },
    },
    {
      id: "v9",
      kind: "handoff",
      agentId: "scorer",
      toAgentId: "detective",
      label: { en: "Hand off to Leakage Detective", ar: "تسليم إلى محقّق التسرّب" },
    },
    {
      id: "v10",
      kind: "tool-call",
      agentId: "detective",
      toolName: "detect_leakage",
      label: { en: "Identify the bleeders", ar: "تحديد المتسرّبين" },
      toolResult: {
        en: "2 callouts: Procurement intelligence (scope creep, $4.3M short of expected), Hospitality revenue (governance block, $5.4M parked).",
        ar: "تنبيهان: ذكاء المشتريات (تمدّد نطاق، نقص 4.3M$)، إيرادات الضيافة (حاجز حوكمة، 5.4M$ مجمّدة).",
      },
    },
    {
      id: "v11",
      kind: "patch-workspace",
      agentId: "detective",
      label: { en: "Publish leakage callouts", ar: "نشر تنبيهات التسرّب" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "leakage",
          kind: "list",
          title: { en: "Leakage callouts", ar: "تنبيهات التسرّب" },
          rows: [
            [
              { en: "Procurement intelligence", ar: "ذكاء المشتريات" },
              { en: "Scope creep — $4.3M short of expected. Sponsor: CPO.", ar: "تمدّد نطاق — نقص 4.3M$. الراعي: مدير المشتريات." },
            ],
            [
              { en: "Hospitality revenue optimizer", ar: "محسّن إيرادات الضيافة" },
              { en: "Governance block — $5.4M parked behind PDPL review.", ar: "حاجز حوكمة — 5.4M$ مجمّدة خلف مراجعة PDPL." },
            ],
          ],
        },
      },
    },
    {
      id: "v12",
      kind: "update-kpi",
      agentId: "detective",
      label: { en: "Value at risk computed", ar: "احتساب القيمة المعرضة للخطر" },
      kpiPatch: { id: "value-at-risk", value: "$9.7M", delta: "+$9.7M" },
    },
    {
      id: "v13",
      kind: "handoff",
      agentId: "detective",
      toAgentId: "narrator",
      label: { en: "Hand off to CFO Narrator", ar: "تسليم إلى كاتب ملخّص المدير المالي" },
    },
    {
      id: "v14",
      kind: "tool-call",
      agentId: "narrator",
      toolName: "draft_one_pager",
      label: { en: "Draft the board one-pager", ar: "صياغة صفحة المجلس" },
    },
    {
      id: "v15",
      kind: "patch-workspace",
      agentId: "narrator",
      label: { en: "Publish one-pager draft", ar: "نشر مسوّدة الصفحة" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "one-pager",
          kind: "doc",
          title: { en: "Board one-pager (draft)", ar: "صفحة المجلس (مسودّة)" },
          rows: [
            [{
              en: "Headline. Of $26.4M expected annualised value across 6 initiatives, $16.45M is run-rating today — a 62% realisation rate, on track vs the 70% Q4 target.",
              ar: "العنوان. من 26.4M$ متوقّعة من 6 مبادرات، يجري تحقيق 16.45M$ — معدّل تحقيق 62% متوافق مع هدف الربع 70%.",
            }],
            [{
              en: "Two callouts. Procurement intelligence is $4.3M behind plan due to scope creep — recommend a rescope review with the CPO before further investment. Hospitality revenue is parked behind a PDPL governance block — escalate to the CDO for a 14-day unblocking sprint.",
              ar: "تنبيهان. ذكاء المشتريات متأخّر 4.3M$ بسبب تمدّد النطاق — يُوصى بمراجعة نطاق مع مدير المشتريات قبل المزيد من الاستثمار. إيرادات الضيافة مجمّدة خلف مراجعة PDPL — تصعيد للمدير الرقمي لجدولة موجة فكّ حصار 14 يوماً.",
            }],
            [{
              en: "Recommendation. Continue investing in the four healthy initiatives at current run-rate. Pause new spend on procurement and hospitality until the two callouts are cleared. Forecast confidence: 78%.",
              ar: "التوصية. الاستمرار في المبادرات الأربع الصحّية بالوتيرة الحالية. إيقاف الإنفاق الجديد على المشتريات والضيافة حتى تُحسم القضيّتان. الثقة في التوقّع: 78%.",
            }],
          ],
        },
      },
    },
    {
      id: "v16",
      kind: "update-kpi",
      agentId: "narrator",
      label: { en: "Portfolio ROI computed", ar: "احتساب العائد" },
      kpiPatch: { id: "portfolio-roi", value: "62%", delta: "+62 pts" },
    },
    {
      id: "v17",
      kind: "update-kpi",
      agentId: "narrator",
      label: { en: "Time to readout: 12 min vs 2-day baseline", ar: "زمن الإفادة: 12 دقيقة مقابل يومين" },
      kpiPatch: { id: "time-to-readout", value: "12 min", delta: "-99%" },
    },
    {
      id: "v18",
      kind: "checkpoint",
      agentId: "orchestrator",
      checkpointId: "cfo-signoff",
      label: { en: "Pause for CFO sign-off", ar: "توقف لطلب موافقة المدير المالي" },
    },
    {
      id: "v19",
      kind: "tool-call",
      agentId: "orchestrator",
      toolName: "publish_board_pack",
      label: { en: "Publish to Monday board pack", ar: "النشر في حزمة الإثنين" },
      toolResult: {
        en: "Uploaded as v1.0 to /board/2026-05/value-realization.pdf — read access: CFO, COO, CEO.",
        ar: "تم الرفع كنسخة 1.0 إلى /board/2026-05/value-realization.pdf — وصول قراءة: المدير المالي، المدير التشغيلي، الرئيس التنفيذي.",
      },
    },
    {
      id: "v20",
      kind: "update-inbox",
      agentId: "orchestrator",
      label: { en: "Mark inbox item resolved", ar: "تعليم الوارد كمُكتمل" },
      inboxUpdate: { id: "kickoff", status: "resolved" },
    },
    {
      id: "v21",
      kind: "complete",
      agentId: "orchestrator",
      label: {
        en: "Run complete. Board pack ready, audit log closed.",
        ar: "اكتمل التشغيل. حزمة المجلس جاهزة، سجل التدقيق مغلق.",
      },
    },
  ],
};

export default valueRealizationScenario;
