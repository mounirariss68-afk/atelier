/**
 * Programme War Room — full scripted run.
 *
 * Sunday 18:00. The EPMO needs Monday's steering pack. The conductor
 * dispatches Watcher → RAID Classifier → ETC Re-baseliner → Steering
 * Drafter, surfaces a hidden ETC drift and a shared-resource conflict,
 * and pauses the PMO Lead before the pack is published.
 */

import type { Scenario } from "../types";

const WORKSTREAMS = [
  { name: "Core banking re-platform", lead: "F. Khaled", rag: "Amber", etc: "+1.4w", note: "Vendor patch slipping" },
  { name: "Branch transformation", lead: "N. Rashid", rag: "Green", etc: "0", note: "On plan" },
  { name: "Data foundation", lead: "L. Otieno", rag: "Red", etc: "+3.2w", note: "Lineage gap on 3 sources" },
  { name: "Risk & compliance uplift", lead: "M. Saleh", rag: "Green", etc: "-0.5w", note: "Ahead on SAMA controls" },
  { name: "Customer onboarding", lead: "S. Hadid", rag: "Amber", etc: "+0.8w", note: "Arabic NLU dependency" },
  { name: "Cloud landing zone", lead: "A. Tariq", rag: "Green", etc: "+0.3w", note: "Awaiting CCoE sign-off" },
  { name: "AI productivity rollout", lead: "R. Doumit", rag: "Amber", etc: "+1.1w", note: "Licence true-up pending" },
  { name: "ESG reporting", lead: "P. Murthy", rag: "Green", etc: "0", note: "On plan" },
];

const programmeWarRoomScenario: Scenario = {
  slug: "programme-war-room",
  toolTitle: { en: "Programme War Room", ar: "غرفة عمليات البرنامج" },
  accent: "#5B7CFF",
  description: {
    en: "An EPMO orchestrator coordinates a Watcher (Jira/Project), a RAID Classifier, an ETC Re-baseliner, and a Steering Drafter to produce a defensible weekly steering pack — without committing the steering committee in writing.",
    ar: "منسّق مكتب البرامج يقود مراقباً (جيرا/المشاريع)، ومصنّف RAID، ومعيد معايرة التقدير، وكاتب عبوة التوجيه لإصدار عبوة أسبوعية قابلة للدفاع دون إلزام لجنة التوجيه كتابياً.",
  },
  buyer: { en: "Head of EPMO", ar: "رئيس مكتب البرامج" },
  trigger: {
    en: "Sunday 18:00. The EPMO needs Monday's steering pack draft on its desk.",
    ar: "الأحد 18:00 — يحتاج مكتب البرامج مسوّدة عبوة التوجيه على مكتبه يوم الإثنين.",
  },
  agents: [
    { id: "orch", name: { en: "EPMO Orchestrator", ar: "منسّق مكتب البرامج" }, role: { en: "Plans the run, gates the pack.", ar: "يخطّط الجولة ويراقب العبوة." }, kind: "orchestrator", color: "#5B7CFF" },
    { id: "watcher", name: { en: "Programme Watcher", ar: "مراقب البرنامج" }, role: { en: "Pulls Jira / MS Project / Confluence events.", ar: "يجلب أحداث جيرا والمشاريع وConfluence." }, kind: "monitor", color: "#5C8CA8" },
    { id: "raid", name: { en: "RAID Classifier", ar: "مصنّف RAID" }, role: { en: "Tags events as risk / assumption / issue / dependency.", ar: "يصنّف الأحداث كمخاطرة/افتراض/مشكلة/اعتمادية." }, kind: "specialist", color: "#C45BB8" },
    { id: "etc", name: { en: "ETC Re-baseliner", ar: "معيد معايرة التقدير" }, role: { en: "Recomputes estimate-to-complete and forecast cone.", ar: "يعيد حساب التقدير حتى الإكمال." }, kind: "scorer", color: "#5BA98A" },
    { id: "drafter", name: { en: "Steering Drafter", ar: "كاتب عبوة التوجيه" }, role: { en: "Drafts the weekly steering pack in house style.", ar: "يصوغ عبوة التوجيه بأسلوب المؤسسة." }, kind: "drafter", color: "#8A5BD6" },
  ],
  tools: [
    { name: "pull_workstreams", description: { en: "Polls every workstream feed (Jira, MS Project, Confluence) for delta.", ar: "يجلب تغيّرات كل مسار من جيرا والمشاريع وConfluence." } },
    { name: "tag_raid", description: { en: "Classifies events into Risks / Assumptions / Issues / Dependencies.", ar: "يصنّف الأحداث إلى مخاطر/افتراضات/مشاكل/اعتماديات." } },
    { name: "recompute_etc", description: { en: "Recomputes estimate-to-complete with the latest velocity.", ar: "يعيد احتساب التقدير بناءً على أحدث سرعة." } },
    { name: "draft_steering_pack", description: { en: "Drafts the weekly steering pack from the live programme state.", ar: "يصوغ عبوة التوجيه الأسبوعية من حالة البرنامج." } },
    { name: "publish_pack", description: { en: "Publishes the signed pack to the steering SharePoint.", ar: "ينشر العبوة الموقّعة على SharePoint للتوجيه." } },
  ],
  checkpoints: [
    {
      id: "pmo-lead-signoff",
      human: { en: "PMO Lead", ar: "قائد PMO" },
      question: { en: "Approve the steering pack and publish to Monday's invite?", ar: "هل توافق على العبوة ونشرها لدعوة الإثنين؟" },
      rationale: {
        en: "Drafter built the pack from 8 workstreams, 14 RAID items, and the ETC re-baseline. Top three asks are surfaced. Recommend approve unless you want to soften the Data Foundation red flag.",
        ar: "صاغ الكاتب العبوة من 8 مسارات و14 بند RAID وإعادة معايرة. أبرز ثلاثة طلبات معروضة. يُوصى بالموافقة ما لم ترغب في تخفيف الإشارة الحمراء لأُسس البيانات.",
      },
      options: [
        { id: "approve", label: { en: "Approve & publish", ar: "موافقة ونشر" }, recommended: true },
        { id: "soften", label: { en: "Soften Data Foundation flag, then publish", ar: "تخفيف إشارة أُسس البيانات ثم النشر" } },
        { id: "send-back", label: { en: "Send back to drafter", ar: "إعادة للكاتب" } },
      ],
    },
  ],
  workflows: [
    {
      id: "weekly-steering",
      name: { en: "Weekly steering pack", ar: "عبوة التوجيه الأسبوعية" },
      description: { en: "Sunday 18:00 — pull, classify, recompute, draft, gate on PMO Lead.", ar: "الأحد 18:00 — جلب، تصنيف، إعادة حساب، صياغة، توقف للقائد." },
      trigger: { en: "Sunday 18:00 cron", ar: "جدولة الأحد 18:00" },
      steps: [
        { agentId: "watcher", label: { en: "Pull events", ar: "جلب الأحداث" } },
        { agentId: "raid", label: { en: "Tag RAID delta", ar: "تصنيف تغيّرات RAID" } },
        { agentId: "etc", label: { en: "Re-baseline ETC", ar: "إعادة معايرة" } },
        { agentId: "drafter", label: { en: "Draft pack", ar: "صياغة العبوة" } },
        { agentId: "orch", label: { en: "PMO Lead checkpoint", ar: "نقطة موافقة القائد" } },
      ],
    },
    {
      id: "raid-triage",
      name: { en: "RAID auto-triage", ar: "فرز RAID الآلي" },
      description: { en: "On every new ticket, classify and route to the right workstream lead.", ar: "عند كل تذكرة جديدة: تصنيف وتوجيه إلى قائد المسار." },
      trigger: { en: "Jira webhook: new RAID-tagged ticket", ar: "Webhook من جيرا: تذكرة RAID جديدة" },
      steps: [
        { agentId: "watcher", label: { en: "Detect ticket", ar: "رصد التذكرة" } },
        { agentId: "raid", label: { en: "Classify", ar: "تصنيف" } },
        { agentId: "orch", label: { en: "Route to lead", ar: "توجيه للقائد" } },
      ],
    },
  ],
  kpis: [
    { id: "events", label: { en: "Programme events processed", ar: "أحداث البرنامج المُعالَجة" }, initial: "0" },
    { id: "raid", label: { en: "RAID items reclassified", ar: "بنود RAID المُعاد تصنيفها" }, initial: "0" },
    { id: "drift", label: { en: "ETC drift detected (weeks)", ar: "انزياح التقدير (أسابيع)" }, initial: "—" },
    { id: "time-saved", label: { en: "PMO hours saved / week", ar: "ساعات PMO الموفّرة" }, initial: "—", source: { en: "Cognirise delivery telemetry — 6 EPMO pilots, 2025.", ar: "قياسات تسليم Cognirise — 6 تجارب EPMO، 2025." } },
  ],
  initialInbox: [
    {
      id: "kickoff",
      source: { en: "scheduler@cognirise.com", ar: "scheduler@cognirise.com" },
      subject: { en: "Sunday 18:00 — Weekly steering pack", ar: "الأحد 18:00 — عبوة التوجيه الأسبوعية" },
      preview: { en: "Run the weekly-steering workflow and prep the Monday pack.", ar: "تشغيل سير عمل التوجيه الأسبوعي وتحضير عبوة الإثنين." },
      receivedAt: "Sun 18:00",
      status: "new",
      accent: "#5B7CFF",
    },
  ],
  initialWorkspace: [],
  events: [
    { id: "p1", kind: "think", agentId: "orch", label: { en: "Pick weekly steering workflow", ar: "اختيار سير التوجيه الأسبوعي" }, detail: { en: "Sunday cron matches. Dispatch Watcher → RAID → ETC → Drafter. PMO Lead gates the publish.", ar: "جدولة الأحد مطابقة. توزيع: مراقب ← RAID ← تقدير ← كاتب. القائد يوقف النشر." } },
    { id: "p2", kind: "update-inbox", agentId: "orch", label: { en: "Inbox item picked up", ar: "التقاط عنصر الوارد" }, inboxUpdate: { id: "kickoff", status: "in-progress" } },
    { id: "p3", kind: "handoff", agentId: "orch", toAgentId: "watcher", label: { en: "Hand off to Programme Watcher", ar: "تسليم إلى مراقب البرنامج" } },
    { id: "p4", kind: "tool-call", agentId: "watcher", toolName: "pull_workstreams", label: { en: "Poll Jira / MS Project / Confluence", ar: "جلب جيرا والمشاريع وConfluence" }, toolResult: { en: "8 workstreams synced. 47 deltas since Friday. 3 status changes, 2 new RAID, 1 silent ETC drift.", ar: "8 مسارات. 47 تغيّر منذ الجمعة. 3 تغييرات حالة، 2 RAID جديد، انزياح صامت واحد." } },
    {
      id: "p5", kind: "patch-workspace", agentId: "watcher", label: { en: "Publish workstream RAG board", ar: "نشر لوحة الحالة" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "rag-board",
          kind: "table",
          title: { en: "Workstream RAG board", ar: "لوحة حالة المسارات" },
          rows: [
            [
              { en: "Workstream", ar: "المسار" },
              { en: "Lead", ar: "القائد" },
              { en: "RAG", ar: "الحالة" },
              { en: "ETC drift", ar: "انزياح التقدير" },
              { en: "Note", ar: "ملاحظة" },
            ],
            ...WORKSTREAMS.map((w) => [
              { en: w.name, ar: w.name },
              { en: w.lead, ar: w.lead },
              { en: w.rag, ar: w.rag },
              { en: w.etc, ar: w.etc },
              { en: w.note, ar: w.note },
            ]),
          ],
        },
      },
    },
    { id: "p6", kind: "update-kpi", agentId: "watcher", label: { en: "Events processed = 47", ar: "الأحداث = 47" }, kpiPatch: { id: "events", value: "47", delta: "+47" } },
    { id: "p7", kind: "handoff", agentId: "watcher", toAgentId: "raid", label: { en: "Hand off to RAID Classifier", ar: "تسليم إلى مصنّف RAID" } },
    { id: "p8", kind: "tool-call", agentId: "raid", toolName: "tag_raid", label: { en: "Classify the 14 open RAID items", ar: "تصنيف 14 بنداً مفتوحاً" }, toolResult: { en: "14 items: 6 risks, 3 issues, 4 dependencies, 1 assumption. 2 newly upgraded to issue.", ar: "14 بنداً: 6 مخاطر، 3 مشاكل، 4 اعتماديات، افتراض واحد. تمت ترقية 2 إلى مشكلة." } },
    {
      id: "p9", kind: "patch-workspace", agentId: "raid", label: { en: "Publish top RAID escalations", ar: "نشر أبرز التصعيدات" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "raid-escalations",
          kind: "list",
          title: { en: "RAID — top three this week", ar: "RAID — أبرز ثلاثة هذا الأسبوع" },
          rows: [
            [{ en: "Issue · Data Foundation lineage gap", ar: "مشكلة · ثغرة في نسب أُسس البيانات" }, { en: "3 sources lack lineage. Blocks reporting Wave 2. Owner: L. Otieno.", ar: "3 مصادر بدون نسب. تعطّل تقارير الموجة 2. المسؤول: ل. أوتيينو." }],
            [{ en: "Risk · Vendor patch slip (Core banking)", ar: "مخاطرة · تأخّر تصحيح المورد (الجوهر المصرفي)" }, { en: "Vendor confirmed Wed slip. Mitigation: parallel UAT track. Owner: F. Khaled.", ar: "أكّد المورد التأخّر. التخفيف: مسار اختبار متوازٍ. المسؤول: ف. خالد." }],
            [{ en: "Dependency · CCoE sign-off (Cloud LZ)", ar: "اعتمادية · موافقة مركز التميز (المنطقة السحابية)" }, { en: "Awaiting CCoE answer for 9 days. Recommend escalation to CIO.", ar: "في انتظار المركز منذ 9 أيام. يُوصى بالتصعيد للمدير التقني." }],
          ],
        },
      },
    },
    { id: "p10", kind: "update-kpi", agentId: "raid", label: { en: "RAID reclassified = 14", ar: "RAID مُعاد تصنيفه = 14" }, kpiPatch: { id: "raid", value: "14", delta: "+14" } },
    { id: "p11", kind: "handoff", agentId: "raid", toAgentId: "etc", label: { en: "Hand off to ETC Re-baseliner", ar: "تسليم إلى معيد المعايرة" } },
    { id: "p12", kind: "tool-call", agentId: "etc", toolName: "recompute_etc", label: { en: "Re-baseline ETC across 8 workstreams", ar: "إعادة معايرة 8 مسارات" }, toolResult: { en: "Cumulative drift: +6.3 weeks vs baseline. Data Foundation drives 3.2w. Conflict found: A. Tariq booked on Cloud LZ + AI rollout in W34.", ar: "إجمالي الانزياح: +6.3 أسابيع. أُسس البيانات تتسبب بـ 3.2 منها. تعارض: أ. طارق محجوز مرتين في الأسبوع 34." } },
    { id: "p13", kind: "update-kpi", agentId: "etc", label: { en: "ETC drift = +6.3 weeks", ar: "الانزياح = +6.3 أسبوع" }, kpiPatch: { id: "drift", value: "+6.3w", delta: "+6.3w" } },
    {
      id: "p14", kind: "patch-workspace", agentId: "etc", label: { en: "Publish resource conflict alert", ar: "تنبيه تعارض موارد" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "conflict",
          kind: "list",
          title: { en: "Shared-resource conflicts", ar: "تعارضات الموارد المشتركة" },
          rows: [
            [{ en: "A. Tariq — W34", ar: "أ. طارق — الأسبوع 34" }, { en: "Booked on Cloud LZ go-live AND AI rollout train-the-trainer. Recommend swap with N. Rashid.", ar: "محجوز للإطلاق السحابي وتدريب الذكاء الاصطناعي. يُقترح التبديل مع ن. راشد." }],
          ],
        },
      },
    },
    { id: "p15", kind: "handoff", agentId: "etc", toAgentId: "drafter", label: { en: "Hand off to Steering Drafter", ar: "تسليم إلى الكاتب" } },
    { id: "p16", kind: "tool-call", agentId: "drafter", toolName: "draft_steering_pack", label: { en: "Draft the steering pack", ar: "صياغة العبوة" } },
    {
      id: "p17", kind: "patch-workspace", agentId: "drafter", label: { en: "Publish steering pack draft", ar: "نشر مسوّدة العبوة" },
      workspacePatch: {
        op: "add",
        widget: {
          id: "pack",
          kind: "doc",
          title: { en: "Monday steering pack (draft)", ar: "عبوة الإثنين (مسودّة)" },
          rows: [
            [{ en: "Headline. 5 of 8 workstreams Green or ahead. 3 Amber, 1 Red (Data Foundation). Cumulative ETC drift: +6.3w on a 26-week plan — within tolerance, but trending.", ar: "العنوان. 5 من 8 مسارات على الأخضر. 3 على الأصفر، 1 على الأحمر (أُسس البيانات). الانزياح: +6.3 أسبوع على خطة 26 أسبوعاً — ضمن النطاق ولكنه يتصاعد." }],
            [{ en: "Top three asks. (1) Approve a 14-day Data Foundation lineage sprint. (2) Escalate Cloud LZ CCoE sign-off to CIO. (3) Approve A. Tariq / N. Rashid swap for W34.", ar: "أبرز ثلاثة طلبات. (1) إقرار موجة نسب لأُسس البيانات 14 يوماً. (2) تصعيد موافقة المركز إلى المدير التقني. (3) إقرار تبديل أ. طارق و ن. راشد للأسبوع 34." }],
            [{ en: "Recommendation. Hold ETC at +6.3w; do not re-baseline yet. Re-evaluate after the lineage sprint closes.", ar: "التوصية. تثبيت الانزياح ولا إعادة معايرة بعد. مراجعة عند إغلاق موجة النسب." }],
          ],
        },
      },
    },
    { id: "p18", kind: "update-kpi", agentId: "drafter", label: { en: "PMO hours saved this run: 18", ar: "ساعات PMO الموفّرة: 18" }, kpiPatch: { id: "time-saved", value: "18 h", delta: "-18 h" } },
    { id: "p19", kind: "checkpoint", agentId: "orch", checkpointId: "pmo-lead-signoff", label: { en: "Pause for PMO Lead sign-off", ar: "توقف لطلب موافقة القائد" } },
    { id: "p20", kind: "tool-call", agentId: "orch", toolName: "publish_pack", label: { en: "Publish to steering SharePoint", ar: "النشر على SharePoint للتوجيه" }, toolResult: { en: "Uploaded to /steering/2026-W18.pdf — invite refreshed, 9 attendees notified.", ar: "تم الرفع إلى /steering/2026-W18.pdf — تحديث الدعوة وإخطار 9 حاضرين." } },
    { id: "p21", kind: "update-inbox", agentId: "orch", label: { en: "Mark inbox resolved", ar: "تعليم الوارد كمكتمل" }, inboxUpdate: { id: "kickoff", status: "resolved" } },
    { id: "p22", kind: "complete", agentId: "orch", label: { en: "Run complete. Steering pack ready, audit log closed.", ar: "اكتمل التشغيل. العبوة جاهزة وسجل التدقيق مغلق." } },
  ],
};

export default programmeWarRoomScenario;
