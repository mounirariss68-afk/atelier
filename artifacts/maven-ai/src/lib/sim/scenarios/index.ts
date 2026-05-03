/**
 * Scenario registry for the Marketplace `/demo/:slug` route.
 *
 * Each marketplace tool maps to a Scenario the DemoExperience shell plays
 * back deterministically. Flagship demos own a full hand-authored
 * Scenario; the rest use `skeletonScenario(...)` until their full run is
 * scripted.
 */

import type { Scenario } from "../types";
import valueRealization from "./value-realization";
import { skeletonScenario } from "./_skeleton";

const programmeHealth = skeletonScenario({
  slug: "programme-health-copilot",
  toolTitle: { en: "Programme Health Copilot", ar: "مساعد صحة البرنامج" },
  accent: "#156082",
  description: {
    en: "An EPMO orchestrator coordinates a Watcher (Jira/Project), a RAID Classifier, an ETC Re-baseliner, and a Steering Drafter to produce a defensible weekly steering pack — without committing the steering committee in writing.",
    ar: "منسّق مكتب البرامج يقوم بقيادة مراقب (جيرا/المشاريع)، ومصنّف RAID، ومعيد معايرة التقدير، وكاتب عبوة التوجيه لإصدار عبوة أسبوعية قابلة للدفاع دون إلزام لجنة التوجيه كتابياً.",
  },
  buyer: { en: "Head of EPMO", ar: "رئيس مكتب البرامج" },
  trigger: {
    en: "Sunday 18:00 — the EPMO needs Monday's steering pack draft on its desk.",
    ar: "الأحد 18:00 — يحتاج مكتب البرامج مسوّدة عبوة التوجيه على مكتبه يوم الإثنين.",
  },
  agents: [
    { id: "orch", name: { en: "EPMO Orchestrator", ar: "منسّق مكتب البرامج" }, role: { en: "Plans the run, gates the pack.", ar: "يخطّط الجولة ويراقب العبوة." }, kind: "orchestrator", color: "#156082" },
    { id: "watcher", name: { en: "Programme Watcher", ar: "مراقب البرنامج" }, role: { en: "Pulls Jira / MS Project / Confluence events.", ar: "يجلب أحداث جيرا/المشاريع/Confluence." }, kind: "monitor", color: "#5C8CA8" },
    { id: "raid", name: { en: "RAID Classifier", ar: "مصنّف RAID" }, role: { en: "Tags events as risk / assumption / issue / dependency.", ar: "يصنّف الأحداث كمخاطرة/افتراض/مشكلة/اعتمادية." }, kind: "specialist", color: "#F5A623" },
    { id: "etc", name: { en: "ETC Re-baseliner", ar: "معيد معايرة التقدير" }, role: { en: "Recomputes estimate-to-complete and forecast cone.", ar: "يعيد حساب التقدير حتى الإكمال." }, kind: "scorer", color: "#5BA98A" },
    { id: "drafter", name: { en: "Steering Drafter", ar: "كاتب عبوة التوجيه" }, role: { en: "Drafts the weekly steering pack in house style.", ar: "يصوغ عبوة التوجيه بأسلوب المؤسسة." }, kind: "drafter", color: "#196B24" },
  ],
  workflows: [
    {
      id: "weekly-steering",
      name: { en: "Weekly steering pack", ar: "عبوة التوجيه الأسبوعية" },
      description: { en: "Sunday 18:00 — pull, classify, recompute, draft, gate on PMO lead.", ar: "الأحد 18:00 — جلب، تصنيف، إعادة حساب، صياغة، توقف لقائد PMO." },
      trigger: { en: "Sunday 18:00 cron", ar: "جدولة الأحد 18:00" },
      steps: [
        { agentId: "watcher", label: { en: "Pull events", ar: "جلب الأحداث" } },
        { agentId: "raid", label: { en: "Tag RAID delta", ar: "تصنيف تغيّرات RAID" } },
        { agentId: "etc", label: { en: "Re-baseline ETC", ar: "إعادة معايرة" } },
        { agentId: "drafter", label: { en: "Draft pack", ar: "صياغة العبوة" } },
        { agentId: "orch", label: { en: "PMO lead checkpoint", ar: "نقطة موافقة قائد PMO" } },
      ],
    },
  ],
  kpis: [
    { id: "events", label: { en: "Programme events processed", ar: "أحداث البرنامج المُعالَجة" }, initial: "0" },
    { id: "raid", label: { en: "RAID items reclassified", ar: "بنود RAID المُعاد تصنيفها" }, initial: "0" },
    { id: "time-saved", label: { en: "PMO hours saved / week", ar: "ساعات PMO الموفّرة" }, initial: "—", source: { en: "Maven AI delivery telemetry — 6 EPMO pilots.", ar: "قياسات تسليم Maven AI — 6 تجارب EPMO." } },
  ],
});

const citizenServices = skeletonScenario({
  slug: "citizen-services-agent",
  toolTitle: { en: "Sovereign Citizen Services Agent", ar: "وكيل خدمات المواطنين السيادي" },
  accent: "#5BA98A",
  description: {
    en: "A bilingual orchestrator for ministry call-centres routes the citizen through Arabic NLU, calls policy retrieval, and either resolves end-to-end or escalates to a human with full context already assembled.",
    ar: "منسّق ثنائي اللغة لمراكز اتصال الوزارات يوجّه المواطن عبر فهم اللغة العربية ويستدعي استرجاع السياسات، ثم إمّا يحلّ القضيّة حتى نهايتها أو يصعّد إلى موظف بشري مع كامل السياق.",
  },
  buyer: { en: "Director General — Digital Services", ar: "المدير العام — الخدمات الرقمية" },
  trigger: { en: "Citizen calls about a stuck service request.", ar: "مكالمة مواطن حول طلب خدمة متعثّر." },
  agents: [
    { id: "orch", name: { en: "Citizen Orchestrator", ar: "منسّق المواطن" }, role: { en: "Plans the conversation and decides escalation.", ar: "يخطّط المحادثة ويقرر التصعيد." }, kind: "orchestrator", color: "#5BA98A" },
    { id: "nlu", name: { en: "Arabic NLU", ar: "فهم اللغة العربية" }, role: { en: "Parses dialect-tolerant intent and entities.", ar: "يحلّل النوايا والكيانات بدعم اللهجات." }, kind: "specialist", color: "#156082" },
    { id: "policy", name: { en: "Policy Retriever", ar: "مسترجِع السياسات" }, role: { en: "Pulls the right service policy and citation.", ar: "يجلب السياسة الصحيحة والمراجع." }, kind: "retriever", color: "#F5A623" },
    { id: "handoff", name: { en: "Human Hand-off", ar: "تسليم بشري" }, role: { en: "Compiles context for the human agent on escalation.", ar: "يجمّع السياق للموظف البشري عند التصعيد." }, kind: "compiler", color: "#196B24" },
  ],
  workflows: [
    {
      id: "service-status",
      name: { en: "Service-status enquiry", ar: "استعلام حالة الخدمة" },
      description: { en: "Citizen asks about a request — orchestrator pulls status, explains in dialect, offers next step.", ar: "يسأل المواطن عن طلبه — يجلب المنسّق الحالة ويفسّرها باللهجة ويقترح الخطوة التالية." },
      trigger: { en: "Inbound call or chat", ar: "مكالمة واردة أو دردشة" },
      steps: [
        { agentId: "nlu", label: { en: "Parse intent + dialect", ar: "تحليل النية واللهجة" } },
        { agentId: "policy", label: { en: "Pull policy + status", ar: "جلب السياسة والحالة" } },
        { agentId: "orch", label: { en: "Decide resolve vs escalate", ar: "حسم الحلّ أو التصعيد" } },
      ],
    },
  ],
  kpis: [
    { id: "ar-quality", label: { en: "Arabic resolution score", ar: "جودة الحلّ بالعربية" }, initial: "—" },
    { id: "deflection", label: { en: "Tier-1 deflection %", ar: "نسبة تحويل الطبقة الأولى" }, initial: "—", source: { en: "Maven AI public-sector benchmarks, 2025.", ar: "مقاييس Maven AI للقطاع الحكومي 2025." } },
    { id: "handoff-q", label: { en: "Hand-off context completeness", ar: "اكتمال سياق التسليم" }, initial: "—" },
  ],
});

const procurementNegotiation = skeletonScenario({
  slug: "procurement-intelligence",
  toolTitle: { en: "Procurement Negotiation Agent", ar: "وكيل التفاوض على المشتريات" },
  accent: "#D9534F",
  description: {
    en: "A negotiation orchestrator coordinates a Spend Analyst, a Supplier-Risk Scorer, a Counter-Offer Drafter, and a Negotiation Coach to advance an active RFP without ever committing the buyer in writing.",
    ar: "منسّق تفاوض يقود محلّل الإنفاق ومصنّف مخاطر الموردين وكاتب العروض المضادة ومدرّب التفاوض لتحريك مناقصة قائمة دون إلزام المشتري كتابياً.",
  },
  buyer: { en: "CPO + Category Manager", ar: "مدير المشتريات ومدير الفئة" },
  trigger: { en: "Supplier counter-offer arrives 4 days before the deadline.", ar: "وصول عرض مضاد من المورد قبل 4 أيام من الموعد." },
  agents: [
    { id: "orch", name: { en: "Negotiation Orchestrator", ar: "منسّق التفاوض" }, role: { en: "Sequences the analysts and gates outbound replies.", ar: "يرتّب المحلّلين ويراقب الردود الصادرة." }, kind: "orchestrator", color: "#D9534F" },
    { id: "spend", name: { en: "Spend Analyst", ar: "محلّل الإنفاق" }, role: { en: "Triangulates the offer against historical spend.", ar: "يقارن العرض بالإنفاق التاريخي." }, kind: "specialist", color: "#156082" },
    { id: "risk", name: { en: "Supplier-Risk Scorer", ar: "مصنّف مخاطر المورد" }, role: { en: "Scores supplier risk: financial, geopolitical, ESG.", ar: "يصنّف مخاطر المورد: مالية وجيوسياسية واستدامة." }, kind: "scorer", color: "#F5A623" },
    { id: "counter", name: { en: "Counter-Offer Drafter", ar: "كاتب العرض المضادّ" }, role: { en: "Drafts the counter and a fall-back position.", ar: "يصوغ العرض المضادّ وموقفاً احتياطياً." }, kind: "drafter", color: "#196B24" },
    { id: "coach", name: { en: "Negotiation Coach", ar: "مدرّب التفاوض" }, role: { en: "Critiques the draft, names the BATNA risk.", ar: "ينتقد المسودّة ويسمّي مخاطرة البديل." }, kind: "critic", color: "#5BA98A" },
  ],
  workflows: [
    {
      id: "active-rfp",
      name: { en: "Active RFP turn", ar: "جولة مناقصة قائمة" },
      description: { en: "Inbound counter → analyse → score → draft counter → coach critique → CPO checkpoint.", ar: "وصول عرض مضادّ → تحليل → تصنيف → صياغة → نقد → نقطة موافقة مدير المشتريات." },
      trigger: { en: "Inbound supplier email", ar: "بريد وارد من المورد" },
      steps: [
        { agentId: "spend", label: { en: "Triangulate price", ar: "ترييث السعر" } },
        { agentId: "risk", label: { en: "Score risk", ar: "تصنيف المخاطر" } },
        { agentId: "counter", label: { en: "Draft counter", ar: "صياغة المضادّ" } },
        { agentId: "coach", label: { en: "Critique", ar: "نقد" } },
        { agentId: "orch", label: { en: "CPO checkpoint", ar: "نقطة موافقة مدير المشتريات" } },
      ],
    },
  ],
  kpis: [
    { id: "savings", label: { en: "Savings unlocked / RFP", ar: "وفورات لكل مناقصة" }, initial: "—" },
    { id: "cycle", label: { en: "Negotiation cycle time", ar: "زمن دورة التفاوض" }, initial: "—" },
    { id: "supplier-cov", label: { en: "Supplier risk coverage", ar: "تغطية مخاطر الموردين" }, initial: "—" },
  ],
});

const networkOps = skeletonScenario({
  slug: "network-ops-agent",
  toolTitle: { en: "Network Ops War Room", ar: "غرفة عمليات الشبكة" },
  accent: "#156082",
  description: {
    en: "A NOC orchestrator triages a multi-cell incident: a Telemetry Watcher, a Topology Reasoner, a Mitigation Drafter, and a Customer-Impact Narrator coordinate to recommend (and, on approval, apply) the right rollback.",
    ar: "منسّق غرفة العمليات يفرز حادثاً متعدد الخلايا: مراقب القياس، ومحلّل الطوبولوجيا، وكاتب التخفيف، وكاتب أثر العملاء، يتعاونون لاقتراح (وبالموافقة تنفيذ) الإجراء الصحيح.",
  },
  buyer: { en: "VP Network Operations", ar: "نائب رئيس عمليات الشبكة" },
  trigger: { en: "Spike: 4 cells in Riyadh-North show packet loss > 8%.", ar: "ارتفاع: 4 خلايا في شمال الرياض بفقد حزم > 8%." },
  agents: [
    { id: "orch", name: { en: "NOC Orchestrator", ar: "منسّق غرفة العمليات" }, role: { en: "Plans the triage and gates the action.", ar: "يخطّط الفرز ويراقب الإجراء." }, kind: "orchestrator", color: "#156082" },
    { id: "telemetry", name: { en: "Telemetry Watcher", ar: "مراقب القياس" }, role: { en: "Streams cell + transport metrics in real time.", ar: "يبثّ مقاييس الخلايا والنقل لحظياً." }, kind: "monitor", color: "#5C8CA8" },
    { id: "topology", name: { en: "Topology Reasoner", ar: "محلّل الطوبولوجيا" }, role: { en: "Maps fault to upstream / downstream blast radius.", ar: "يربط العطل بنطاق التأثير العلوي والسفلي." }, kind: "specialist", color: "#F5A623" },
    { id: "mitigation", name: { en: "Mitigation Drafter", ar: "كاتب التخفيف" }, role: { en: "Drafts the rollback or load-shed plan.", ar: "يصوغ خطة التراجع أو توزيع الحمل." }, kind: "drafter", color: "#5BA98A" },
    { id: "narrator", name: { en: "Customer-Impact Narrator", ar: "كاتب أثر العملاء" }, role: { en: "Quantifies and explains user-facing impact.", ar: "يحسب أثر المستخدمين ويشرحه." }, kind: "drafter", color: "#196B24" },
  ],
  workflows: [
    {
      id: "incident-triage",
      name: { en: "Incident triage", ar: "فرز الحادث" },
      description: { en: "Spike → telemetry → topology blast radius → mitigation draft → impact narration → on-call engineer checkpoint.", ar: "ارتفاع → قياس → نطاق تأثير → خطة تخفيف → سرد أثر → نقطة موافقة المهندس المناوب." },
      trigger: { en: "Telemetry threshold breach", ar: "تجاوز حدّ القياس" },
      steps: [
        { agentId: "telemetry", label: { en: "Confirm spike", ar: "تأكيد الارتفاع" } },
        { agentId: "topology", label: { en: "Compute blast radius", ar: "حساب نطاق التأثير" } },
        { agentId: "mitigation", label: { en: "Draft rollback", ar: "صياغة التراجع" } },
        { agentId: "narrator", label: { en: "Quantify impact", ar: "تحديد الأثر" } },
        { agentId: "orch", label: { en: "On-call checkpoint", ar: "نقطة موافقة المناوب" } },
      ],
    },
  ],
  kpis: [
    { id: "mttd", label: { en: "Mean time to detect", ar: "زمن الاكتشاف" }, initial: "—" },
    { id: "mttr", label: { en: "Mean time to mitigate", ar: "زمن التخفيف" }, initial: "—" },
    { id: "users-impact", label: { en: "Users impacted", ar: "العملاء المتأثرون" }, initial: "—" },
  ],
});

const samaCompliance = skeletonScenario({
  slug: "sama-compliance-agent",
  toolTitle: { en: "SAMA Compliance Sentinel", ar: "حارس الامتثال لمؤسسة النقد" },
  accent: "#F5A623",
  description: {
    en: "A compliance orchestrator monitors regulator updates, retrieves the affected policies, drafts the impact memo, and stages the evidence pack — pausing for the CRO before any filing.",
    ar: "منسّق امتثال يراقب تحديثات المنظّم، يسترجع السياسات المتأثرة، يصوغ مذكّرة الأثر، ويُعدّ حزمة الأدلة — متوقفاً قبل أي إيداع لطلب موافقة مدير المخاطر.",
  },
  buyer: { en: "CRO + Head of Compliance", ar: "مدير المخاطر ورئيس الامتثال" },
  trigger: { en: "SAMA publishes a Cyber Resilience update.", ar: "تنشر مؤسسة النقد تحديث المرونة السيبرانية." },
  agents: [
    { id: "orch", name: { en: "Compliance Orchestrator", ar: "منسّق الامتثال" }, role: { en: "Plans the response and gates filings.", ar: "يخطّط الاستجابة ويراقب الإيداع." }, kind: "orchestrator", color: "#F5A623" },
    { id: "monitor", name: { en: "Regulator Monitor", ar: "مراقب المنظّم" }, role: { en: "Watches SAMA / PDPL / CMA bulletins.", ar: "يراقب نشرات ساما والبيانات الشخصية وهيئة السوق." }, kind: "monitor", color: "#156082" },
    { id: "policy", name: { en: "Policy Retriever", ar: "مسترجِع السياسات" }, role: { en: "Pulls all affected internal policies.", ar: "يجلب جميع السياسات الداخلية المتأثرة." }, kind: "retriever", color: "#5C8CA8" },
    { id: "memo", name: { en: "Impact Memo Drafter", ar: "كاتب مذكّرة الأثر" }, role: { en: "Drafts the impact memo and remediation plan.", ar: "يصوغ مذكّرة الأثر وخطة المعالجة." }, kind: "drafter", color: "#5BA98A" },
    { id: "evidence", name: { en: "Evidence Compiler", ar: "مُجمّع الأدلة" }, role: { en: "Stages the audit-ready evidence pack.", ar: "يُعدّ حزمة الأدلة الجاهزة للتدقيق." }, kind: "compiler", color: "#196B24" },
  ],
  workflows: [
    {
      id: "regulator-update",
      name: { en: "Regulator update response", ar: "الاستجابة لتحديث المنظّم" },
      description: { en: "Update arrives → identify affected policies → draft memo → stage evidence → CRO checkpoint.", ar: "وصول التحديث → تحديد السياسات المتأثرة → صياغة المذكّرة → تجهيز الأدلة → نقطة موافقة مدير المخاطر." },
      trigger: { en: "Regulator publishes a circular", ar: "نشر المنظّم لتعميم" },
      steps: [
        { agentId: "monitor", label: { en: "Detect bulletin", ar: "رصد النشرة" } },
        { agentId: "policy", label: { en: "Retrieve policies", ar: "استرجاع السياسات" } },
        { agentId: "memo", label: { en: "Draft impact memo", ar: "صياغة المذكّرة" } },
        { agentId: "evidence", label: { en: "Stage evidence", ar: "تجهيز الأدلة" } },
        { agentId: "orch", label: { en: "CRO checkpoint", ar: "نقطة موافقة مدير المخاطر" } },
      ],
    },
  ],
  kpis: [
    { id: "lead-time", label: { en: "Time to impact memo", ar: "زمن مذكّرة الأثر" }, initial: "—" },
    { id: "policies-touched", label: { en: "Policies cross-referenced", ar: "السياسات المُراجعة" }, initial: "—" },
    { id: "evidence", label: { en: "Audit-ready evidence pack", ar: "حزمة أدلة جاهزة للتدقيق" }, initial: "—" },
  ],
});

const customerCare = skeletonScenario({
  slug: "customer-care-multi-agent",
  toolTitle: { en: "Customer Care Hive", ar: "خلية رعاية العملاء" },
  accent: "#5BA98A",
  description: {
    en: "A care orchestrator routes a bilingual customer issue across an Intent Classifier, a CRM Retriever, a Resolution Drafter, and a QA Critic — preserving full context if it has to escalate to a human.",
    ar: "منسّق رعاية يوزّع قضيّة عميل ثنائية اللغة بين مصنّف النية ومسترجِع CRM وكاتب الحلّ وناقد الجودة — مع حفظ السياق الكامل عند التصعيد.",
  },
  buyer: { en: "Head of Customer Care", ar: "رئيس رعاية العملاء" },
  trigger: { en: "Bilingual customer message arrives on WhatsApp.", ar: "وصول رسالة عميل ثنائية اللغة على واتساب." },
  agents: [
    { id: "orch", name: { en: "Care Orchestrator", ar: "منسّق الرعاية" }, role: { en: "Sequences resolution and decides hand-off.", ar: "يرتّب الحلّ ويقرر التسليم." }, kind: "orchestrator", color: "#5BA98A" },
    { id: "intent", name: { en: "Intent Classifier", ar: "مصنّف النية" }, role: { en: "Classifies the issue and language.", ar: "يصنّف القضيّة واللغة." }, kind: "specialist", color: "#156082" },
    { id: "crm", name: { en: "CRM Retriever", ar: "مسترجِع CRM" }, role: { en: "Pulls customer history and entitlements.", ar: "يجلب تاريخ العميل والاستحقاقات." }, kind: "retriever", color: "#F5A623" },
    { id: "drafter", name: { en: "Resolution Drafter", ar: "كاتب الحلّ" }, role: { en: "Drafts the bilingual reply.", ar: "يصوغ الردّ ثنائي اللغة." }, kind: "drafter", color: "#5C8CA8" },
    { id: "qa", name: { en: "QA Critic", ar: "ناقد الجودة" }, role: { en: "Critiques tone, accuracy, regulator wording.", ar: "ينتقد النبرة والدقّة وصياغة المنظّم." }, kind: "critic", color: "#196B24" },
  ],
  workflows: [
    {
      id: "inbound",
      name: { en: "Inbound customer message", ar: "رسالة عميل واردة" },
      description: { en: "Classify → retrieve → draft → critique → reply or escalate.", ar: "تصنيف → استرجاع → صياغة → نقد → ردّ أو تصعيد." },
      trigger: { en: "Inbound channel event", ar: "حدث قناة وارد" },
      steps: [
        { agentId: "intent", label: { en: "Classify intent", ar: "تصنيف النية" } },
        { agentId: "crm", label: { en: "Pull history", ar: "جلب التاريخ" } },
        { agentId: "drafter", label: { en: "Draft reply", ar: "صياغة الردّ" } },
        { agentId: "qa", label: { en: "Critique", ar: "نقد" } },
        { agentId: "orch", label: { en: "Send / escalate", ar: "إرسال أو تصعيد" } },
      ],
    },
  ],
  kpis: [
    { id: "ar-quality", label: { en: "Arabic CSAT", ar: "رضا العملاء بالعربية" }, initial: "—" },
    { id: "ftr", label: { en: "First-touch resolution", ar: "حلّ من أول لمسة" }, initial: "—" },
    { id: "cost-to-serve", label: { en: "Cost to serve", ar: "تكلفة الخدمة" }, initial: "—" },
  ],
});

const sovereignData = skeletonScenario({
  slug: "sovereign-data-workbench",
  toolTitle: { en: "Sovereign Data Steward", ar: "حارس البيانات السيادي" },
  accent: "#0E2841",
  description: {
    en: "An on-prem orchestrator runs a data run inside an air-gapped enclave: Profiler, Lineage Mapper, Mastering Drafter, and Governance Critic coordinate to land a clean, mastered, regulator-defensible dataset.",
    ar: "منسّق محلّي يدير جولة بيانات داخل بيئة معزولة: مُحلّل، ومسجّل النسب، وكاتب الضبط، وناقد الحوكمة، يتعاونون لإصدار مجموعة بيانات نظيفة ومضبوطة وقابلة للدفاع تنظيمياً.",
  },
  buyer: { en: "CDO + Head of AI Foundations", ar: "المدير الرقمي ورئيس أُسس الذكاء الاصطناعي" },
  trigger: { en: "New dataset onboarded into the sovereign enclave.", ar: "إدخال مجموعة بيانات جديدة في البيئة السيادية." },
  agents: [
    { id: "orch", name: { en: "Steward Orchestrator", ar: "منسّق الحارس" }, role: { en: "Plans the run and gates the publish.", ar: "يخطّط الجولة ويراقب النشر." }, kind: "orchestrator", color: "#0E2841" },
    { id: "profile", name: { en: "Data Profiler", ar: "محلّل البيانات" }, role: { en: "Profiles schema, distributions, anomalies.", ar: "يحلّل البنية والتوزيع والشذوذ." }, kind: "specialist", color: "#156082" },
    { id: "lineage", name: { en: "Lineage Mapper", ar: "مسجّل النسب" }, role: { en: "Maps every column back to source and steward.", ar: "يربط كل عمود بالمصدر والحارس." }, kind: "specialist", color: "#5C8CA8" },
    { id: "mastering", name: { en: "Mastering Drafter", ar: "كاتب الضبط" }, role: { en: "Proposes match / merge / survivorship rules.", ar: "يقترح قواعد المطابقة والدمج والبقاء." }, kind: "drafter", color: "#F5A623" },
    { id: "gov", name: { en: "Governance Critic", ar: "ناقد الحوكمة" }, role: { en: "Checks PDPL / classification / retention posture.", ar: "يدقّق الموقف من PDPL والتصنيف والاحتفاظ." }, kind: "critic", color: "#D9534F" },
  ],
  workflows: [
    {
      id: "onboard",
      name: { en: "Dataset onboarding", ar: "إدخال مجموعة بيانات" },
      description: { en: "Profile → lineage → mastering → governance critique → CDO checkpoint.", ar: "تحليل → نسب → ضبط → نقد حوكمة → نقطة موافقة المدير الرقمي." },
      trigger: { en: "New dataset in landing zone", ar: "مجموعة بيانات جديدة في منطقة الإدخال" },
      steps: [
        { agentId: "profile", label: { en: "Profile", ar: "تحليل" } },
        { agentId: "lineage", label: { en: "Map lineage", ar: "تسجيل النسب" } },
        { agentId: "mastering", label: { en: "Draft mastering", ar: "صياغة الضبط" } },
        { agentId: "gov", label: { en: "Governance critique", ar: "نقد الحوكمة" } },
        { agentId: "orch", label: { en: "CDO checkpoint", ar: "نقطة موافقة المدير الرقمي" } },
      ],
    },
  ],
  kpis: [
    { id: "datasets", label: { en: "Datasets stewarded", ar: "مجموعات تحت الحراسة" }, initial: "—" },
    { id: "lineage-cov", label: { en: "Lineage coverage", ar: "تغطية النسب" }, initial: "—" },
    { id: "pdpl-pass", label: { en: "PDPL controls passed", ar: "ضوابط PDPL المُجتازة" }, initial: "—" },
  ],
});

const knowledgeMemory = skeletonScenario({
  slug: "knowledge-memory-agent",
  toolTitle: { en: "Enterprise Knowledge Concierge", ar: "كونسيرج المعرفة المؤسسية" },
  accent: "#5C8CA8",
  description: {
    en: "A knowledge orchestrator answers a senior leader's question by routing through a Retriever, a Synthesiser, a Citation Auditor, and a Confidence Scorer — never answering without a citation trail back to a source document.",
    ar: "منسّق معرفي يجيب على سؤال قائد بقيادة مسترجِع وكاتب توليف ومدقّق استشهاد ومصنّف ثقة — ولا يجيب أبداً دون مسار استشهاد إلى وثيقة مصدرية.",
  },
  buyer: { en: "Chief of Staff", ar: "رئيس مكتب الرئيس التنفيذي" },
  trigger: { en: "Executive asks a strategy question in chat.", ar: "يسأل تنفيذي سؤالاً استراتيجياً في الدردشة." },
  agents: [
    { id: "orch", name: { en: "Knowledge Orchestrator", ar: "منسّق المعرفة" }, role: { en: "Plans the query and gates the answer.", ar: "يخطّط الاستعلام ويراقب الإجابة." }, kind: "orchestrator", color: "#5C8CA8" },
    { id: "retriever", name: { en: "Retriever", ar: "المسترجِع" }, role: { en: "Pulls candidate passages from the corpus.", ar: "يجلب مقاطع مرشّحة من المتن." }, kind: "retriever", color: "#156082" },
    { id: "synth", name: { en: "Synthesiser", ar: "كاتب التوليف" }, role: { en: "Composes a defensible answer from passages.", ar: "يصوغ إجابة قابلة للدفاع من المقاطع." }, kind: "drafter", color: "#F5A623" },
    { id: "audit", name: { en: "Citation Auditor", ar: "مدقّق الاستشهاد" }, role: { en: "Verifies every claim cites a real passage.", ar: "يتحقّق من أن كل ادعاء يستشهد بمقطع حقيقي." }, kind: "critic", color: "#D9534F" },
    { id: "conf", name: { en: "Confidence Scorer", ar: "مصنّف الثقة" }, role: { en: "Rates answer confidence; refuses below threshold.", ar: "يصنّف ثقة الإجابة ويرفض دون العتبة." }, kind: "scorer", color: "#196B24" },
  ],
  workflows: [
    {
      id: "ask",
      name: { en: "Executive ask", ar: "سؤال تنفيذي" },
      description: { en: "Question → retrieve → synthesise → audit citations → score confidence → answer or refuse.", ar: "سؤال → استرجاع → توليف → تدقيق استشهاد → تصنيف ثقة → إجابة أو رفض." },
      trigger: { en: "Inbound chat question", ar: "سؤال دردشة وارد" },
      steps: [
        { agentId: "retriever", label: { en: "Retrieve passages", ar: "استرجاع المقاطع" } },
        { agentId: "synth", label: { en: "Synthesise", ar: "توليف" } },
        { agentId: "audit", label: { en: "Audit citations", ar: "تدقيق الاستشهاد" } },
        { agentId: "conf", label: { en: "Score confidence", ar: "تصنيف الثقة" } },
        { agentId: "orch", label: { en: "Answer or refuse", ar: "إجابة أو رفض" } },
      ],
    },
  ],
  kpis: [
    { id: "groundedness", label: { en: "Grounded answer rate", ar: "معدّل الإجابة المُؤصّلة" }, initial: "—" },
    { id: "refusal", label: { en: "Defensible refusal rate", ar: "معدّل الرفض المبرّر" }, initial: "—" },
    { id: "ttv", label: { en: "Time to answer", ar: "زمن الإجابة" }, initial: "—" },
  ],
});

// Tools that are part of the legacy catalogue but are being de-emphasised in
// the redesign — keep stub scenarios so old links don't 404 while we phase
// them out.
const legacyStub = (slug: string, title: { en: string; ar: string }, accent: string) =>
  skeletonScenario({
    slug,
    toolTitle: title,
    accent,
    description: {
      en: "This demo is being rebuilt as part of the agentic marketplace redesign. The page below shows the orchestrator + specialist topology that will drive the new run.",
      ar: "يجري إعادة بناء هذا العرض ضمن إعادة تصميم السوق الوكيلي. توضّح الصفحة أدناه طوبولوجيا المنسّق والمتخصّصين التي ستدير الجولة الجديدة.",
    },
    buyer: { en: "TBC", ar: "قيد التحديد" },
    trigger: { en: "TBC", ar: "قيد التحديد" },
    agents: [
      { id: "orch", name: { en: "Orchestrator", ar: "المنسّق" }, role: { en: "Plans the run.", ar: "يخطّط الجولة." }, kind: "orchestrator", color: accent },
      { id: "spec", name: { en: "Specialist", ar: "متخصّص" }, role: { en: "Executes the work.", ar: "ينفّذ العمل." }, kind: "specialist", color: "#156082" },
    ],
    workflows: [
      {
        id: "tbc",
        name: { en: "Coming soon", ar: "قريباً" },
        description: { en: "Full scenario lands in the next release.", ar: "السيناريو الكامل في الإصدار القادم." },
        trigger: { en: "TBC", ar: "قيد التحديد" },
        steps: [
          { agentId: "orch", label: { en: "Plan", ar: "التخطيط" } },
          { agentId: "spec", label: { en: "Execute", ar: "التنفيذ" } },
        ],
      },
    ],
    kpis: [{ id: "tbc", label: { en: "KPIs in development", ar: "المؤشرات قيد التطوير" }, initial: "—" }],
  });

const SCENARIOS: Record<string, Scenario> = {
  "value-realization": valueRealization,
  "programme-health-copilot": programmeHealth,
  "citizen-services-agent": citizenServices,
  "procurement-intelligence": procurementNegotiation,
  "network-ops-agent": networkOps,
  "sama-compliance-agent": samaCompliance,
  "customer-care-multi-agent": customerCare,
  "sovereign-data-workbench": sovereignData,
  "knowledge-memory-agent": knowledgeMemory,
  "energy-trading-copilot": legacyStub(
    "energy-trading-copilot",
    { en: "Energy Trading Copilot", ar: "مساعد تداول الطاقة" },
    "#F5A623",
  ),
  "retail-demand-forecaster": legacyStub(
    "retail-demand-forecaster",
    { en: "Retail Demand Forecaster", ar: "متنبّئ الطلب للتجزئة" },
    "#196B24",
  ),
  "hospitality-revenue-optimizer": legacyStub(
    "hospitality-revenue-optimizer",
    { en: "Hospitality Revenue Optimizer", ar: "محسّن إيرادات الضيافة" },
    "#D9534F",
  ),
  "ev-battery-health-agent": legacyStub(
    "ev-battery-health-agent",
    { en: "EV Battery Health Agent", ar: "وكيل صحة بطارية المركبات" },
    "#5BA98A",
  ),
  "fpa-rolling-forecast": legacyStub(
    "fpa-rolling-forecast",
    { en: "FP&A Rolling Forecast", ar: "تنبؤ مالي متجدّد" },
    "#5C8CA8",
  ),
};

export function getScenario(slug: string): Scenario | undefined {
  return SCENARIOS[slug];
}

export function listScenarioSlugs(): string[] {
  return Object.keys(SCENARIOS);
}
