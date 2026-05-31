/**
 * Cognirise Personal Agent — scenario for the Marketplace detail page.
 *
 * The Personal Agent has its own purpose-built demos (Cockpit and Mind),
 * dispatched by Demo.tsx before the scenario engine is consulted. This
 * scenario exists to populate the marketplace detail page's
 * "Workflows / Agent topology / KPIs" sections so the tool reads as
 * agentic-native to a buyer browsing the marketplace.
 */

import type { Scenario } from "../types";

const personalAgent: Scenario = {
  slug: "cognirise-personal-agent",
  toolTitle: { en: "Cognirise Personal Agent", ar: "مساعد Cognirise الشخصي" },
  accent: "#a78bfa",
  description: {
    en: "An always-on per-employee AI agent. Learns the job and the person, stores it in an employee-owned Personal Context Graph, and acts autonomously under a glass-box trust model.",
    ar: "مساعد ذكاء اصطناعي شخصي لكل موظف، دائم العمل. يتعلّم العمل والشخص ويخزّن المعرفة في رسم سياق شخصي مملوك للموظف، ويعمل ذاتياً ضمن نموذج ثقة زجاجي شفّاف.",
  },
  buyer: { en: "CHRO + CIO + every employee", ar: "الرئيس التنفيذي للموارد البشرية والمعلومات وكل موظف" },
  trigger: {
    en: "Monday 08:30. The agent (Atlas for Sales, Ember for HR) wakes up to the day's calendar, inbox and tasks, and starts learning, drafting, scheduling, and proposing actions.",
    ar: "الإثنين 08:30. يستيقظ المساعد (أطلس للمبيعات، إمبر للموارد البشرية) على تقويم اليوم والصندوق والمهام، ويبدأ بالتعلّم والصياغة والجدولة واقتراح الإجراءات.",
  },
  agents: [
    { id: "planner", name: { en: "Personal Planner (Atlas / Ember)", ar: "المخطّط الشخصي (أطلس / إمبر)" }, role: { en: "Per-employee named planner. Reads the day, dispatches sub-agents, gates everything through the autonomy ladder.", ar: "مخطّط مسمّى لكل موظف. يقرأ اليوم، يوزّع الوكلاء، يمرّر كل شيء عبر سلّم الاستقلالية." }, kind: "orchestrator", color: "#a78bfa" },
    { id: "extractor", name: { en: "Observation Extractor", ar: "مستخرج الملاحظات" }, role: { en: "Listens to transcripts, mail, chat, doc edits and proposes new PCG nodes.", ar: "يستمع للنسخ والبريد والدردشة وتعديلات الوثائق ويقترح عقد رسم جديدة." }, kind: "monitor", color: "#60a5fa" },
    { id: "curator", name: { en: "Graph Curator", ar: "أمين الرسم" }, role: { en: "Sole writer to the PCG. Dedupes, scores confidence, decays staleness, resolves contradictions.", ar: "الكاتب الوحيد للرسم. يزيل التكرار، يصنّف الثقة، يُلاشي القديم، يحلّ التناقض." }, kind: "compiler", color: "#34d399" },
    { id: "retriever", name: { en: "Context Retriever", ar: "مسترجع السياق" }, role: { en: "Picks the smallest sufficient subset of PCG nodes for any chat turn or autonomous task.", ar: "يختار أصغر مجموعة كافية من عقد الرسم لأي دورة محادثة أو مهمة آلية." }, kind: "retriever", color: "#fbbf24" },
    { id: "drafter", name: { en: "Drafter", ar: "الكاتب" }, role: { en: "Writes the artefact (email, FAQ, offer letter, brief) in the persona's voice, grounded in the bundle.", ar: "يكتب الناتج (بريد، أسئلة شائعة، خطاب عرض، موجز) بأسلوب الشخص، مؤصّلاً بالحزمة." }, kind: "drafter", color: "#f472b6" },
    { id: "gate", name: { en: "Autonomy Gate", ar: "بوابة الاستقلالية" }, role: { en: "Enforces per-capability autonomy ladder (L0 → L4). Routes to auto / propose-with-undo / ask-human.", ar: "يطبّق سلّم الاستقلالية لكل قدرة (L0 → L4). يوجّه إلى آلي / اقتراح مع تراجع / سؤال البشري." }, kind: "router", color: "#fb7185" },
    { id: "receipt", name: { en: "Receipt Keeper", ar: "أمين الإيصالات" }, role: { en: "Writes the glass-box receipt for every autonomous action — what, citations, confidence, undo.", ar: "يكتب الإيصال الشفّاف لكل إجراء آلي — ماذا، استشهادات، ثقة، تراجع." }, kind: "compiler", color: "#22d3ee" },
  ],
  tools: [
    { name: "tap_streams", description: { en: "Read-only OAuth into calendar, email, chat, transcripts, docs, CRM/ATS/ERP.", ar: "وصول قراءة فقط إلى التقويم والبريد والدردشة والنسخ والوثائق وCRM/ATS/ERP." } },
    { name: "extract_entities", description: { en: "Extract people, projects, preferences and relationships from raw streams.", ar: "استخراج الأشخاص والمشاريع والتفضيلات والعلاقات من القنوات الخام." } },
    { name: "write_pcg", description: { en: "Append/update a node or edge in the Personal Context Graph (curator-only).", ar: "إلحاق/تحديث عقدة أو رأس في رسم السياق الشخصي (الأمين فقط)." } },
    { name: "retrieve_subset", description: { en: "Hybrid retrieval (graph traversal + embedding) for the smallest sufficient grounding bundle.", ar: "استرجاع هجين (اجتياز الرسم + تضمين) لأصغر حزمة تأصيل كافية." } },
    { name: "draft_artefact", description: { en: "Generate a draft email / FAQ / offer letter / brief in the persona's voice.", ar: "توليد مسودة بريد / أسئلة شائعة / خطاب عرض / موجز بأسلوب الشخص." } },
    { name: "send_with_receipt", description: { en: "Execute an autonomous action and emit a glass-box receipt with one-click undo.", ar: "تنفيذ إجراء آلي وإصدار إيصال شفّاف بزر تراجع واحد." } },
  ],
  checkpoints: [
    {
      id: "employee-approves",
      human: { en: "Employee", ar: "الموظف" },
      question: { en: "Approve the drafted follow-up to Maya at ACME?", ar: "هل توافق على متابعة مايا في ACME؟" },
      rationale: { en: "Drafter cited 5 PCG nodes — Maya, ACME pricing project, Sara, your voice profile, and Maya's BCC preference. Confidence 0.92. Estimated time saved: 18 minutes. L3 capability — undoable for 5 minutes after send.", ar: "استشهد الكاتب بـ 5 عقد — مايا، مشروع تسعير ACME، سارة، أسلوبك، تفضيل BCC لمايا. الثقة 0.92. الوقت الموفّر المقدّر: 18 دقيقة. قدرة L3 — قابلة للتراجع لمدة 5 دقائق بعد الإرسال." },
      options: [
        { id: "approve", label: { en: "Approve and send (L3 — undoable 5 min)", ar: "موافقة وإرسال (L3 — تراجع 5 دقائق)" }, recommended: true },
        { id: "edit", label: { en: "Edit before sending", ar: "تعديل قبل الإرسال" } },
        { id: "reject", label: { en: "Reject — I'll handle it manually", ar: "رفض — سأتولّاه يدوياً" } },
      ],
    },
    {
      id: "manager-policy",
      human: { en: "Manager / Policy owner", ar: "المدير / مالك السياسة" },
      question: { en: "Lift the offer-letter capability from L1 (suggest) to L2 (confirm-to-act) for HRBPs?", ar: "رفع قدرة خطاب العرض من L1 (اقتراح) إلى L2 (تأكيد للتنفيذ) لشركاء أعمال الموارد البشرية؟" },
      rationale: { en: "After 90 days at L1, undo rate is 1.2% (target ≤ 5%) and HRBP-reported satisfaction is 4.6/5. Lifting to L2 preserves human signoff but lets Ember pre-fill comp band and standard clauses, freeing ~30 minutes per offer.", ar: "بعد 90 يوماً في L1، معدل التراجع 1.2% (الهدف ≤ 5%) ورضا شركاء الأعمال 4.6/5. الرفع إلى L2 يحافظ على توقيع البشري ويسمح لإمبر بتعبئة حد التعويض والبنود القياسية مسبقاً، موفراً ~30 دقيقة لكل عرض." },
      options: [
        { id: "lift-l2", label: { en: "Lift to L2", ar: "رفع إلى L2" }, recommended: true },
        { id: "stay-l1", label: { en: "Stay at L1", ar: "البقاء في L1" } },
        { id: "pilot", label: { en: "Pilot with 3 HRBPs first", ar: "تجربة مع 3 شركاء أعمال أولاً" } },
      ],
    },
  ],
  workflows: [
    {
      id: "morning-plan",
      name: { en: "Morning plan", ar: "خطة الصباح" },
      description: { en: "Every weekday 08:30 — read calendar, mail, chat overnight; refresh PCG; surface top 3 pending approvals + 2 in-progress + 1 personal nudge.", ar: "كل يوم عمل 08:30 — قراءة التقويم والبريد والدردشة ليلاً؛ تحديث الرسم؛ عرض أعلى 3 موافقات معلّقة + 2 قيد التنفيذ + تنبيه شخصي." },
      trigger: { en: "Weekday 08:30 cron", ar: "جدولة 08:30 يوم عمل" },
      steps: [
        { agentId: "extractor", label: { en: "Tap overnight streams", ar: "ربط القنوات الليلية" } },
        { agentId: "curator", label: { en: "Update PCG", ar: "تحديث الرسم" } },
        { agentId: "retriever", label: { en: "Build day's grounding bundle", ar: "بناء حزمة التأصيل لليوم" } },
        { agentId: "drafter", label: { en: "Pre-draft top approvals", ar: "صياغة مسبقة لأعلى الموافقات" } },
        { agentId: "gate", label: { en: "Route by autonomy ceiling", ar: "توجيه حسب سقف الاستقلالية" } },
        { agentId: "planner", label: { en: "Render the cockpit", ar: "عرض القمرة" } },
      ],
    },
    {
      id: "post-meeting-debrief",
      name: { en: "Post-meeting debrief", ar: "مراجعة ما بعد الاجتماع" },
      description: { en: "Triggered by any meeting end — extract entities and preferences from the transcript, propose follow-up, queue for L3 send-with-undo.", ar: "يُفعَّل بنهاية أي اجتماع — استخراج الكيانات والتفضيلات من النص، اقتراح متابعة، إعدادها لإرسال L3 قابل للتراجع." },
      trigger: { en: "Meeting transcript available", ar: "نص الاجتماع متاح" },
      steps: [
        { agentId: "extractor", label: { en: "Extract entities + preferences", ar: "استخراج الكيانات + التفضيلات" } },
        { agentId: "curator", label: { en: "Resolve contradictions, write PCG", ar: "حلّ التناقضات وكتابة الرسم" } },
        { agentId: "retriever", label: { en: "Build follow-up grounding bundle", ar: "بناء حزمة متابعة" } },
        { agentId: "drafter", label: { en: "Draft follow-up", ar: "صياغة المتابعة" } },
        { agentId: "gate", label: { en: "Send (L3) or queue for approval", ar: "إرسال (L3) أو وضع للموافقة" } },
        { agentId: "receipt", label: { en: "Emit glass-box receipt", ar: "إصدار الإيصال الشفّاف" } },
      ],
    },
    {
      id: "pattern-detection",
      name: { en: "Pattern-detection sweep", ar: "مسح كشف الأنماط" },
      description: { en: "Continuous: detect repeated questions or signals across people (e.g. 3 engineers asking about sabbaticals); propose proactive artefact (FAQ + office hours).", ar: "مستمر: كشف الأسئلة أو الإشارات المتكررة عبر الأشخاص (مثل 3 مهندسين يسألون عن الإجازة)؛ اقتراح ناتج استباقي (FAQ + ساعات مكتبية)." },
      trigger: { en: "Threshold (≥3 similar signals in window)", ar: "العتبة (≥3 إشارات مشابهة في النافذة)" },
      steps: [
        { agentId: "extractor", label: { en: "Detect cross-source pattern", ar: "كشف النمط عبر المصادر" } },
        { agentId: "retriever", label: { en: "Pull policy + 1:1 context", ar: "سحب السياسة + سياق اللقاء" } },
        { agentId: "drafter", label: { en: "Draft FAQ + schedule office hours", ar: "صياغة FAQ + جدولة ساعات مكتبية" } },
        { agentId: "gate", label: { en: "Queue for employee approval (L2)", ar: "إعداد لموافقة الموظف (L2)" } },
      ],
    },
  ],
  kpis: [
    { id: "hours-saved", label: { en: "Hours saved / employee / week", ar: "الساعات الموفّرة / موظف / أسبوع" }, initial: "0", source: { en: "Aggregated receipts (manager observability)", ar: "إيصالات مجمّعة (مرئية للمدير)" } },
    { id: "pct-routine", label: { en: "% of routine tasks automated", ar: "% من المهام الروتينية المؤتمتة" }, initial: "0%" },
    { id: "ttp-newhire", label: { en: "Time-to-productivity for new hires", ar: "زمن وصول الموظفين الجدد للإنتاجية" }, initial: "12 weeks", source: { en: "Industry baseline; pilot will measure delta", ar: "خط الأساس الصناعي؛ ستقيس التجربة الفرق" } },
    { id: "undo-rate", label: { en: "Undo rate (quality signal)", ar: "معدل التراجع (إشارة جودة)" }, initial: "—", source: { en: "Receipt log; target ≤ 5%", ar: "سجل الإيصالات؛ الهدف ≤ 5%" } },
    { id: "satisfaction", label: { en: "Employee satisfaction", ar: "رضا الموظف" }, initial: "—", source: { en: "Quarterly self-report; target ≥ 4.5/5", ar: "تقرير ذاتي ربع سنوي؛ الهدف ≥ 4.5/5" } },
    { id: "portability-exports", label: { en: "PCG exports requested", ar: "تصديرات الرسم المطلوبة" }, initial: "0", source: { en: "Always-free employee right; tracked for transparency", ar: "حق الموظف المجاني دائماً؛ مُتابع للشفافية" } },
  ],
  initialInbox: [
    { id: "ib.1", source: { en: "Calendar", ar: "التقويم" }, subject: { en: "ACME pricing call (10:00am, Maya)", ar: "مكالمة تسعير ACME (10:00 صباحاً، مايا)" }, preview: { en: "30 min — discovery follow-up", ar: "30 دقيقة — متابعة استكشاف" }, receivedAt: "08:31", status: "in-progress" },
    { id: "ib.2", source: { en: "Slack #eng-talk", ar: "Slack #eng-talk" }, subject: { en: "Sabbatical questions (3 in 60 min)", ar: "أسئلة الإجازة (3 في 60 دقيقة)" }, preview: { en: "Pattern detected — pre-drafting FAQ", ar: "كُشف نمط — صياغة FAQ مسبقاً" }, receivedAt: "09:22", status: "in-progress" },
    { id: "ib.3", source: { en: "ServiceNow HR", ar: "ServiceNow HR" }, subject: { en: "Maria — visa renewal moved to legal review", ar: "ماريا — انتقل تجديد التأشيرة إلى المراجعة القانونية" }, preview: { en: "Watch added; nudging legal weekly", ar: "أُضيفت متابعة؛ تنبيه قانوني أسبوعياً" }, receivedAt: "10:17", status: "awaiting-human" },
  ],
  initialWorkspace: [
    {
      id: "ws.pcg",
      kind: "metric-grid",
      title: { en: "PCG snapshot", ar: "لقطة الرسم" },
      rows: [
        [{ en: "Nodes", ar: "العقد" }, { en: "55", ar: "55" }],
        [{ en: "Edges", ar: "الرؤوس" }, { en: "63", ar: "63" }],
        [{ en: "Avg confidence", ar: "متوسط الثقة" }, { en: "0.91", ar: "0.91" }],
        [{ en: "Personal-scope nodes", ar: "عقد النطاق الشخصي" }, { en: "12 (employee-only)", ar: "12 (الموظف فقط)" }],
      ],
    },
    {
      id: "ws.today",
      kind: "list",
      title: { en: "Today's queue", ar: "قائمة اليوم" },
      rows: [
        [{ en: "3 pending approvals (top: ACME follow-up draft)", ar: "3 موافقات معلّقة (أعلاها: مسودة متابعة ACME)" }],
        [{ en: "2 in-progress tasks (ACME QBR · TechCorp opener)", ar: "مهمتان قيد التنفيذ (ACME QBR · افتتاح TechCorp)" }],
        [{ en: "1 personal nudge (Layan's recital · florists shortlisted)", ar: "تنبيه شخصي (حفلة ليان · قائمة محلات الزهور)" }],
      ],
    },
  ],
  events: [
    { id: "ev.1", kind: "think", agentId: "planner", label: { en: "Atlas reads the morning state", ar: "يقرأ أطلس الحالة الصباحية" }, detail: { en: "Calendar: 4 meetings (1 with Maya at 10am). Inbox: 11 new. Slack: 3 sabbatical questions in #eng-talk. Top priority: Maya call prep + ACME follow-up.", ar: "التقويم: 4 اجتماعات (واحد مع مايا 10 صباحاً). الصندوق: 11 جديد. Slack: 3 أسئلة إجازة. الأولوية: تجهيز مايا + متابعة ACME." } },
    { id: "ev.2", kind: "tool-call", agentId: "extractor", toolName: "tap_streams", label: { en: "Tap overnight streams", ar: "ربط القنوات الليلية" }, toolResult: { en: "9 transcripts, 47 emails, 230 Slack messages, 12 doc edits ingested.", ar: "9 نسخ، 47 بريد، 230 رسالة Slack، 12 تعديل وثيقة." } },
    { id: "ev.3", kind: "handoff", agentId: "extractor", toAgentId: "curator", label: { en: "Hand off proposed nodes to Curator", ar: "تسليم العقد المقترحة للأمين" } },
    { id: "ev.4", kind: "tool-call", agentId: "curator", toolName: "write_pcg", label: { en: "Update PCG (3 new nodes, 2 confidence bumps)", ar: "تحديث الرسم (3 عقد جديدة، رفع ثقة لـ2)" }, toolResult: { en: "Nodes added: s.r.sara (confirmed reports_to Maya), s.p.acme-eu (LinkedIn signal), h.dom.policy-sabbatical (3rd citation).", ar: "أُضيفت: سارة (مؤكدة تتبع لمايا)، ACME-EU (إشارة LinkedIn)، سياسة الإجازة (الاستشهاد الثالث)." } },
    { id: "ev.5", kind: "tool-call", agentId: "retriever", toolName: "retrieve_subset", label: { en: "Build grounding bundle for ACME follow-up", ar: "بناء حزمة تأصيل لمتابعة ACME" }, toolResult: { en: "5 nodes selected: Maya · ACME pricing · Sara · voice style · Maya BCC preference.", ar: "5 عقد: مايا · تسعير ACME · سارة · الأسلوب · تفضيل BCC." } },
    { id: "ev.6", kind: "tool-call", agentId: "drafter", toolName: "draft_artefact", label: { en: "Draft follow-up (3 options · M. signoff)", ar: "صياغة متابعة (3 خيارات · توقيع M.)" }, toolResult: { en: "Draft ready: 142 words. Confidence 0.92. Estimated time saved 18 min.", ar: "المسودة جاهزة: 142 كلمة. الثقة 0.92. وقت موفّر 18 دقيقة." } },
    { id: "ev.7", kind: "checkpoint", checkpointId: "employee-approves", label: { en: "Wait for Mariam to approve", ar: "انتظار موافقة مريم" } },
    { id: "ev.8", kind: "tool-call", agentId: "gate", toolName: "send_with_receipt", label: { en: "L3 send (undoable 5 min)", ar: "إرسال L3 (تراجع 5 دقائق)" }, toolResult: { en: "Sent to maya@acme at 11:47, BCC kc@acme. Receipt logged with 5 PCG citations + Undo handle.", ar: "أُرسل إلى مايا 11:47، BCC kc@acme. سُجل الإيصال مع 5 استشهادات + زر تراجع." } },
    { id: "ev.9", kind: "update-kpi", label: { en: "Hours saved this week ↑", ar: "ارتفاع الساعات الموفّرة هذا الأسبوع" }, kpiPatch: { id: "hours-saved", value: "6.4", delta: "+0.3" } },
    { id: "ev.10", kind: "patch-workspace", label: { en: "Append receipt to today's actions", ar: "إلحاق الإيصال بإجراءات اليوم" }, workspacePatch: { op: "add", widget: { id: "ws.receipt.acme", kind: "doc", title: { en: "Receipt — ACME follow-up sent 11:47", ar: "إيصال — متابعة ACME أُرسلت 11:47" }, rows: [
      [{ en: "Cited PCG nodes: Maya · ACME pricing · Sara · voice style · BCC preference", ar: "العقد: مايا · تسعير ACME · سارة · الأسلوب · تفضيل BCC" }],
      [{ en: "Confidence 0.92 · Time saved 18 min · L3 (undoable 5 min)", ar: "الثقة 0.92 · موفّر 18 دقيقة · L3 (تراجع 5 دقائق)" }],
      [{ en: "Undo button active until 11:52", ar: "زر التراجع نشط حتى 11:52" }],
    ] } } },
    { id: "ev.11", kind: "think", agentId: "planner", label: { en: "Atlas runs pattern-detection sweep", ar: "يجري أطلس مسح الأنماط" }, detail: { en: "Cross-employee: 3 sabbatical questions in #eng-talk → triggers HR pattern-detection workflow.", ar: "عبر الموظفين: 3 أسئلة إجازة → تفعيل سير عمل كشف نمط HR." } },
    { id: "ev.12", kind: "checkpoint", checkpointId: "manager-policy", label: { en: "Quarterly autonomy review", ar: "مراجعة استقلالية ربع سنوية" } },
    { id: "ev.13", kind: "complete", label: { en: "Cycle complete", ar: "اكتملت الدورة" }, detail: { en: "Open the Cockpit for the live cross-life view, or the Mind to inspect the PCG that powered today's actions.", ar: "افتح القمرة لعرض الحياة المتقاطعة الحي، أو العقل لفحص الرسم الذي شغّل إجراءات اليوم." } },
  ],
};

export default personalAgent;
