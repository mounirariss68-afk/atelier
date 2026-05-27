/**
 * Network Ops War Room — full scripted run.
 *
 * 14:03 — fibre cut south of Sharjah. Telemetry spikes, 84,310
 * subscribers affected, regulator clock starts at 30:00. The
 * conductor runs Telemetry → Topology → Mitigation → Customer-Impact
 * Narrator, drafts the EN/AR SMS and the TDRA filing, and pauses
 * twice: NOC engineer for the rollback, Regulator officer for the
 * filing.
 */

import type { Scenario } from "../types";

const networkOpsScenario: Scenario = {
  slug: "network-ops-war-room",
  toolTitle: { en: "Network Ops War Room", ar: "غرفة عمليات الشبكة" },
  accent: "#5B7CFF",
  description: {
    en: "A NOC orchestrator triages a multi-cell incident: a Telemetry Watcher, a Topology Reasoner, a Mitigation Drafter, and a Customer-Impact Narrator coordinate to recommend the rollback, draft the EN/AR customer SMS, and stage the regulator filing — pausing twice for the NOC engineer and the regulator officer.",
    ar: "منسّق غرفة العمليات يفرز حادثاً متعدد الخلايا: مراقب القياس، ومحلّل الطوبولوجيا، وكاتب التخفيف، وكاتب أثر العملاء، يتعاونون لاقتراح التراجع وصياغة الرسائل وتجهيز الإيداع — مع توقفين بشريَّين.",
  },
  buyer: { en: "VP Network Operations", ar: "نائب رئيس عمليات الشبكة" },
  trigger: { en: "Fibre cut south of Sharjah at 14:03 — 84,310 subscribers degraded.", ar: "قطع ألياف جنوب الشارقة 14:03 — 84,310 مشتركاً متأثراً." },
  agents: [
    { id: "orch", name: { en: "NOC Orchestrator", ar: "منسّق غرفة العمليات" }, role: { en: "Plans the triage and gates the action.", ar: "يخطّط الفرز ويراقب الإجراء." }, kind: "orchestrator", color: "#5B7CFF" },
    { id: "telemetry", name: { en: "Telemetry Watcher", ar: "مراقب القياس" }, role: { en: "Streams cell + transport metrics in real time.", ar: "يبثّ مقاييس الخلايا والنقل لحظياً." }, kind: "monitor", color: "#5C8CA8" },
    { id: "topology", name: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" }, role: { en: "Maps the fault to upstream / downstream blast radius.", ar: "يربط العطل بنطاق التأثير." }, kind: "specialist", color: "#C45BB8" },
    { id: "mitigation", name: { en: "Mitigation Drafter", ar: "كاتب التخفيف" }, role: { en: "Drafts the rollback or load-shed plan.", ar: "يصوغ خطة التراجع أو توزيع الحمل." }, kind: "drafter", color: "#5BA98A" },
    { id: "narrator", name: { en: "Customer-Impact Narrator", ar: "كاتب أثر العملاء" }, role: { en: "Quantifies user-facing impact and drafts EN/AR SMS.", ar: "يحسب الأثر ويصوغ الرسائل ثنائية اللغة." }, kind: "drafter", color: "#8A5BD6" },
    { id: "regulator", name: { en: "Regulator Filer", ar: "كاتب الإيداع التنظيمي" }, role: { en: "Drafts the TDRA / CST notification template.", ar: "يصوغ نموذج إخطار الجهة التنظيمية." }, kind: "drafter", color: "#D9534F" },
  ],
  tools: [
    { name: "stream_telemetry", description: { en: "Confirms the spike and locates the cells.", ar: "يؤكّد الارتفاع ويحدّد الخلايا." } },
    { name: "compute_blast_radius", description: { en: "Computes the upstream/downstream impact graph.", ar: "يحسب نطاق التأثير العلوي والسفلي." } },
    { name: "draft_mitigation", description: { en: "Drafts the rollback or load-shed action.", ar: "يصوغ التراجع أو توزيع الحمل." } },
    { name: "quantify_impact", description: { en: "Counts affected MSISDNs and revenue at risk.", ar: "يُحصي المشتركين والإيراد المعرّض." } },
    { name: "draft_sms", description: { en: "Drafts EN + AR customer SMS.", ar: "يصوغ رسائل ثنائية اللغة." } },
    { name: "draft_regulator_filing", description: { en: "Drafts the TDRA/CST notification template.", ar: "يصوغ نموذج إخطار TDRA/CST." } },
    { name: "execute_rollback", description: { en: "Executes the approved rollback on the transport plane.", ar: "ينفّذ التراجع المعتمد على طبقة النقل." } },
    { name: "file_regulator", description: { en: "Files the cleared notification with the regulator.", ar: "يُودع الإخطار المعتمد." } },
  ],
  checkpoints: [
    {
      id: "noc-engineer",
      human: { en: "On-call NOC Engineer", ar: "مهندس الغرفة المناوب" },
      question: { en: "Approve rollback of TX-NORTH-04 to last-good and re-route via TX-NORTH-09?", ar: "هل توافق على التراجع لـ TX-NORTH-04 وإعادة التوجيه عبر TX-NORTH-09؟" },
      rationale: {
        en: "Topology reasoner narrowed the fault to the South-Sharjah feeder. Re-route via TX-NORTH-09 restores 78% of affected sessions in ~6 minutes; 22% require field crew. Recommend approve.",
        ar: "حدّد المحلّل العطل في مغذّي جنوب الشارقة. إعادة التوجيه تستعيد 78% خلال 6 دقائق؛ 22% بحاجة لفريق ميداني. يُوصى بالموافقة.",
      },
      options: [
        { id: "approve", label: { en: "Approve rollback & re-route", ar: "موافقة على التراجع وإعادة التوجيه" }, recommended: true },
        { id: "field-only", label: { en: "Field-crew only (slower, no re-route)", ar: "فريق ميداني فقط (أبطأ)" } },
        { id: "hold", label: { en: "Hold — open bridge with vendor", ar: "تأجيل — جسر مع المورد" } },
      ],
    },
    {
      id: "regulator-filing",
      human: { en: "Regulator Officer", ar: "موظف العلاقات التنظيمية" },
      question: { en: "File the TDRA major-incident notification now? (16 min remaining on the 30-min clock)", ar: "هل تودع إخطار TDRA الآن؟ (16 دقيقة متبقّية)" },
      rationale: {
        en: "Filing draft uses TDRA template MI-A2, includes affected MSISDN count, root-cause hypothesis, and ETA-to-restore. Recommend file now to preserve buffer.",
        ar: "المسوّدة على نموذج MI-A2 وتضمّ عدد المشتركين والسبب المفترض ووقت الاستعادة. يُوصى بالإيداع فوراً.",
      },
      options: [
        { id: "file", label: { en: "File now", ar: "إيداع الآن" }, recommended: true },
        { id: "amend", label: { en: "Amend root-cause line, then file", ar: "تعديل سطر السبب ثم الإيداع" } },
        { id: "phone", label: { en: "Call duty officer first", ar: "اتصال بالمناوب أولاً" } },
      ],
    },
  ],
  workflows: [
    {
      id: "incident-triage",
      name: { en: "Major-incident triage", ar: "فرز الحادث الكبير" },
      description: { en: "Spike → telemetry → topology → mitigation → impact → SMS → regulator filing.", ar: "ارتفاع → قياس → طوبولوجيا → تخفيف → أثر → رسائل → إيداع." },
      trigger: { en: "Telemetry threshold breach (loss > 8% on > 2 cells)", ar: "تجاوز حدّ القياس" },
      steps: [
        { agentId: "telemetry", label: { en: "Confirm spike", ar: "تأكيد الارتفاع" } },
        { agentId: "topology", label: { en: "Compute blast radius", ar: "حساب النطاق" } },
        { agentId: "mitigation", label: { en: "Draft rollback", ar: "صياغة التراجع" } },
        { agentId: "narrator", label: { en: "Quantify impact + SMS", ar: "حساب الأثر والرسائل" } },
        { agentId: "regulator", label: { en: "Draft regulator filing", ar: "صياغة الإيداع" } },
        { agentId: "orch", label: { en: "Two human checkpoints", ar: "نقطتان بشريّتان" } },
      ],
    },
  ],
  kpis: [
    { id: "mttd", label: { en: "Mean time to detect", ar: "زمن الاكتشاف" }, initial: "—" },
    { id: "mttr", label: { en: "Mean time to mitigate", ar: "زمن التخفيف" }, initial: "—", source: { en: "Gartner AIOps benchmarks 2024 + Cognirise telco delivery telemetry.", ar: "مقاييس Gartner AIOps 2024 وقياسات تسليم Cognirise." } },
    { id: "users-impact", label: { en: "Users impacted", ar: "العملاء المتأثرون" }, initial: "—" },
    { id: "regulator-buffer", label: { en: "Buffer on regulator clock", ar: "هامش زمن المنظّم" }, initial: "—" },
  ],
  initialInbox: [
    {
      id: "INC-2026-3041",
      source: { en: "NMS · auto-alert", ar: "NMS · تنبيه آلي" },
      subject: { en: "Spike: 4 cells RIY-N show packet loss > 8%", ar: "ارتفاع: 4 خلايا في شمال الرياض > 8%" },
      preview: { en: "TX-NORTH-04 transport degradation suspected. Sharjah-South cells affected.", ar: "اشتباه تدهور نقل TX-NORTH-04. خلايا جنوب الشارقة متأثّرة." },
      receivedAt: "14:03",
      status: "new",
      accent: "#5B7CFF",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "w1", kind: "think", agentId: "orch", label: { en: "Open major-incident triage", ar: "فتح فرز الحادث الكبير" }, detail: { en: "Loss > 8% on 4 cells. Major-incident threshold breached. Start regulator clock at 30:00. Dispatch telemetry → topology → mitigation → narrator → regulator.", ar: "تجاوز العتبة. يبدأ عدّاد المنظّم 30:00. توزيع المسارات." } },
    { id: "w2", kind: "update-inbox", agentId: "orch", label: { en: "Incident picked up", ar: "تمّ التقاط الحادث" }, inboxUpdate: { id: "INC-2026-3041", status: "in-progress" } },
    { id: "w3", kind: "handoff", agentId: "orch", toAgentId: "telemetry", label: { en: "Hand off to Telemetry Watcher", ar: "تسليم إلى مراقب القياس" } },
    { id: "w4", kind: "tool-call", agentId: "telemetry", toolName: "stream_telemetry", label: { en: "Confirm spike on TX-NORTH-04 feeder", ar: "تأكيد الارتفاع على المغذّي" }, toolResult: { en: "Confirmed: 4 cells in Sharjah-South show packet loss 9.4–14.2%. Detected at 14:01:48. MTTD: 1m 14s.", ar: "مؤكّد: 4 خلايا بفقد 9.4–14.2%. الاكتشاف 14:01:48. زمن الاكتشاف: 1د14ث." } },
    { id: "w5", kind: "update-kpi", agentId: "telemetry", label: { en: "MTTD = 1m 14s", ar: "زمن الاكتشاف = 1د14ث" }, kpiPatch: { id: "mttd", value: "1m 14s", delta: "-95%" } },
    { id: "w6", kind: "handoff", agentId: "telemetry", toAgentId: "topology", label: { en: "Hand off to Topology Reasoner", ar: "تسليم إلى محلّل الطوبولوجيا" } },
    { id: "w7", kind: "tool-call", agentId: "topology", toolName: "compute_blast_radius", label: { en: "Trace blast radius", ar: "تتبّع نطاق التأثير" }, toolResult: { en: "Root: fibre cut on South-Sharjah feeder. Blast radius: 4 cells, 84,310 MSISDNs, 1 enterprise SLA (port logistics tenant).", ar: "السبب: قطع ألياف. النطاق: 4 خلايا، 84,310 مشتركاً، اتفاقية مؤسسية واحدة." } },
    {
      id: "w8", kind: "patch-workspace", agentId: "topology", label: { en: "Publish incident dashboard", ar: "نشر لوحة الحادث" },
      workspacePatch: {
        op: "add", widget: {
          id: "incident", kind: "metric-grid",
          title: { en: "Incident · INC-2026-3041", ar: "الحادث · INC-2026-3041" },
          rows: [
            [{ en: "Affected cells", ar: "الخلايا المتأثّرة" }, { en: "4 (Sharjah-South)", ar: "4 (جنوب الشارقة)" }],
            [{ en: "Subscribers degraded", ar: "المشتركون" }, { en: "84,310", ar: "84,310" }],
            [{ en: "Enterprise SLAs", ar: "اتفاقيات المؤسسات" }, { en: "1 (port logistics)", ar: "1 (لوجستيات الميناء)" }],
            [{ en: "Root cause hypothesis", ar: "السبب المفترض" }, { en: "Fibre cut · TX-NORTH-04", ar: "قطع ألياف · TX-NORTH-04" }],
            [{ en: "Regulator clock", ar: "عدّاد المنظّم" }, { en: "Started 14:03 · 30:00 budget", ar: "بدأ 14:03 · ميزانية 30:00" }],
          ],
        },
      },
    },
    { id: "w9", kind: "update-kpi", agentId: "topology", label: { en: "Users impacted = 84,310", ar: "العملاء = 84,310" }, kpiPatch: { id: "users-impact", value: "84,310", delta: "+84,310" } },
    { id: "w10", kind: "handoff", agentId: "topology", toAgentId: "mitigation", label: { en: "Hand off to Mitigation Drafter", ar: "تسليم إلى كاتب التخفيف" } },
    { id: "w11", kind: "tool-call", agentId: "mitigation", toolName: "draft_mitigation", label: { en: "Draft rollback + re-route plan", ar: "صياغة التراجع وإعادة التوجيه" }, toolResult: { en: "Plan: rollback TX-NORTH-04 to last-good config, re-route via TX-NORTH-09. Restores 78% in ~6 min. 22% need field crew at the cut.", ar: "الخطة: تراجع TX-NORTH-04 وإعادة التوجيه عبر TX-NORTH-09. استعادة 78% خلال 6 دقائق." } },
    {
      id: "w12", kind: "patch-workspace", agentId: "mitigation", label: { en: "Publish mitigation plan", ar: "نشر خطة التخفيف" },
      workspacePatch: {
        op: "add", widget: {
          id: "mitigation-plan", kind: "list",
          title: { en: "Mitigation plan", ar: "خطة التخفيف" },
          rows: [
            [{ en: "Step 1", ar: "الخطوة 1" }, { en: "Roll back TX-NORTH-04 to last-good config (ETA 90s).", ar: "تراجع TX-NORTH-04 (90 ثانية)." }],
            [{ en: "Step 2", ar: "الخطوة 2" }, { en: "Re-route Sharjah-South via TX-NORTH-09 (ETA 6 min, restores 78%).", ar: "إعادة التوجيه عبر TX-NORTH-09 (6 دقائق، 78%)." }],
            [{ en: "Step 3", ar: "الخطوة 3" }, { en: "Dispatch field crew to fibre cut at km-21 (ETA on-site 35 min).", ar: "إرسال فريق ميداني للقطع عند الكيلو 21 (35 دقيقة)." }],
          ],
        },
      },
    },
    { id: "w13", kind: "handoff", agentId: "mitigation", toAgentId: "narrator", label: { en: "Hand off to Customer-Impact Narrator", ar: "تسليم إلى كاتب الأثر" } },
    { id: "w14", kind: "tool-call", agentId: "narrator", toolName: "draft_sms", label: { en: "Draft EN + AR customer SMS", ar: "صياغة الرسائل" } },
    {
      id: "w15", kind: "patch-workspace", agentId: "narrator", label: { en: "Publish customer SMS drafts", ar: "نشر مسوّدات الرسائل" },
      workspacePatch: {
        op: "add", widget: {
          id: "sms", kind: "doc",
          title: { en: "Customer SMS (draft)", ar: "رسائل العملاء (مسوّدة)" },
          rows: [
            [{ en: "EN — 'We're aware of a service issue affecting parts of Sharjah. Engineers are on it; expect restoration within 45 minutes. We'll text you once you're back online.'", ar: "إنجليزي — 'نعلم بمشكلة في أجزاء من الشارقة. الفِرق تعمل، ومتوقّع الاستعادة خلال 45 دقيقة.'" }],
            [{ en: "AR — 'نعتذر — نواجه خللاً مؤقتاً في أجزاء من الشارقة. الفِرق تعمل وسنرسل لكم تأكيد الاستعادة خلال 45 دقيقة.'", ar: "عربي — 'نعتذر — نواجه خللاً مؤقتاً في أجزاء من الشارقة. الفِرق تعمل وسنرسل لكم تأكيد الاستعادة خلال 45 دقيقة.'" }],
          ],
        },
      },
    },
    { id: "w16", kind: "handoff", agentId: "narrator", toAgentId: "regulator", label: { en: "Hand off to Regulator Filer", ar: "تسليم إلى كاتب الإيداع" } },
    { id: "w17", kind: "tool-call", agentId: "regulator", toolName: "draft_regulator_filing", label: { en: "Draft TDRA MI-A2 notification", ar: "صياغة إخطار TDRA MI-A2" }, toolResult: { en: "Draft ready in 6m 12s. 23m 48s buffer on 30-min clock when ready for filer.", ar: "المسوّدة جاهزة في 6د12ث. هامش 23د48ث على عدّاد المنظّم." } },
    { id: "w18", kind: "update-kpi", agentId: "regulator", label: { en: "Regulator buffer: 23m 48s", ar: "هامش المنظّم: 23د48ث" }, kpiPatch: { id: "regulator-buffer", value: "23m 48s", delta: "+18m" } },
    { id: "w19", kind: "checkpoint", agentId: "orch", checkpointId: "noc-engineer", label: { en: "Pause for NOC engineer approval", ar: "توقف لموافقة المهندس" } },
    { id: "w20", kind: "tool-call", agentId: "orch", toolName: "execute_rollback", label: { en: "Execute approved rollback", ar: "تنفيذ التراجع" }, toolResult: { en: "Rollback applied 14:11:34. Re-route active. Loss back below 1% on 3 of 4 cells. 22% await field crew.", ar: "نُفّذ التراجع 14:11:34. الفقد دون 1% على 3 خلايا. 22% ينتظرون الفريق." } },
    { id: "w21", kind: "update-kpi", agentId: "orch", label: { en: "MTTR: 8m 26s vs 4h baseline", ar: "زمن التخفيف: 8د26ث مقابل 4 ساعات" }, kpiPatch: { id: "mttr", value: "8m 26s", delta: "-96%" } },
    { id: "w22", kind: "checkpoint", agentId: "orch", checkpointId: "regulator-filing", label: { en: "Pause for regulator filing approval", ar: "توقف لإيداع المنظّم" } },
    { id: "w23", kind: "tool-call", agentId: "orch", toolName: "file_regulator", label: { en: "File TDRA MI-A2", ar: "إيداع TDRA MI-A2" }, toolResult: { en: "Filed at 14:14:09 with 15m 51s buffer. Acknowledgment ID TDRA-2026-MI-3041 received.", ar: "أُودع 14:14:09 بهامش 15د51ث. رقم الإقرار TDRA-2026-MI-3041." } },
    { id: "w24", kind: "update-inbox", agentId: "orch", label: { en: "Mark incident in recovery", ar: "تعليم الحادث قيد الاستعادة" }, inboxUpdate: { id: "INC-2026-3041", status: "resolved" } },
    { id: "w25", kind: "complete", agentId: "orch", label: { en: "Run complete. Field crew dispatched, regulator informed.", ar: "اكتمل التشغيل. الفريق في الطريق والمنظّم مُخطر." } },
  ],
};

export default networkOpsScenario;
