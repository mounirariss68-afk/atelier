/**
 * Marketplace tool agent casts — the single source of truth for the
 * "How does this work?" explainer modal and for the in-demo agent trace.
 *
 * Every marketplace tool ships a named cast of agents (planner, retriever,
 * classifier, drafter, critic, etc.) plus the human-in-the-loop checkpoints
 * that gate any real-world action. The same agent ids referenced in the
 * explainer diagram are also used by each demo's runtime trace so a buyer
 * can map the live trace onto the diagram one-to-one.
 *
 * Sample data convention: bilingual EN/AR, illustrative scenarios — the
 * agents do not represent real customer deployments.
 */

import type { BiText } from "./knowledge";

export type AgentKind =
  | "planner"
  | "retriever"
  | "classifier"
  | "drafter"
  | "critic"
  | "router"
  | "scorer"
  | "compiler"
  | "monitor";

export interface AgentNode {
  id: string;
  name: BiText;
  /** One-line role description. */
  role: BiText;
  kind: AgentKind;
  /** External systems / source feeds this agent reads from. */
  reads?: BiText[];
  /** Outputs this agent produces (named artifacts or signals). */
  writes?: BiText[];
}

export interface AgentEdge {
  from: string;
  to: string;
  /** Optional one-line handoff label. */
  label?: BiText;
}

export interface HumanCheckpoint {
  id: string;
  /** Role of the human ("PMO lead", "Trader", "CRO" …). */
  name: BiText;
  /** What the human approves, signs, or owns at this checkpoint. */
  decision: BiText;
}

/**
 * Diagram flow order. The explainer renders agents and human checkpoints
 * in this order top-to-bottom, with the cast's edges drawn between them.
 */
export interface FlowStep {
  kind: "agent" | "human";
  id: string;
}

export interface AgentCast {
  agents: AgentNode[];
  edges: AgentEdge[];
  humanCheckpoints: HumanCheckpoint[];
  flowOrder: FlowStep[];
  /** Why agents and not a single model — tied to this tool's reality. */
  rationale: BiText;
}

const linearFlow = (
  agentIds: string[],
  humans: Array<{ id: string; afterAgent: string }> = [],
): FlowStep[] => {
  const out: FlowStep[] = [];
  for (const aid of agentIds) {
    out.push({ kind: "agent", id: aid });
    for (const h of humans) {
      if (h.afterAgent === aid) out.push({ kind: "human", id: h.id });
    }
  }
  return out;
};

export const marketplaceAgentCasts: Record<string, AgentCast> = {
  // ─── 1. Value Realization Tool ──────────────────────────────────────────
  "value-realization": {
    agents: [
      {
        id: "portfolio-watcher",
        name: { en: "Portfolio Watcher", ar: "مراقب المحفظة" },
        role: { en: "Watches the book of work for new initiatives, status changes and milestone events.", ar: "يراقب كتاب العمل بحثاً عن مبادرات جديدة وتغيّرات حالة وأحداث محطّات." },
        kind: "monitor",
        reads: [
          { en: "ERP, project ledger, business-case repository", ar: "ERP، سجل المشاريع، مستودع حالات العمل" },
        ],
        writes: [{ en: "Initiative snapshot", ar: "لقطة المبادرة" }],
      },
      {
        id: "uvr-scorer",
        name: { en: "UVR Scorer", ar: "مصنّف UVR" },
        role: { en: "Scores each initiative against Maven's UVR rubric — value, feasibility, governance fit.", ar: "يصنّف كل مبادرة وفق منهج UVR — القيمة والجدوى وتوافق الحوكمة." },
        kind: "scorer",
        reads: [{ en: "Initiative snapshot, UVR rubric", ar: "لقطة المبادرة، منهج UVR" }],
        writes: [{ en: "Per-initiative UVR scores", ar: "درجات UVR لكل مبادرة" }],
      },
      {
        id: "leakage-detective",
        name: { en: "Leakage Detective", ar: "محقّق التسرّب" },
        role: { en: "Finds the initiatives bleeding the most expected value and names the dominant cause.", ar: "يكتشف المبادرات الأكثر تسرّباً للقيمة ويسمّي السبب الغالب." },
        kind: "critic",
        reads: [
          { en: "UVR scores, milestone events, status emails", ar: "درجات UVR، أحداث المحطّات، بريد الحالة" },
        ],
        writes: [
          { en: "Leakage callouts with dominant cause", ar: "تنبيهات التسرّب مع السبب الغالب" },
        ],
      },
      {
        id: "cfo-narrator",
        name: { en: "CFO Narrator", ar: "كاتب ملخّص المدير المالي" },
        role: { en: "Drafts the printable CFO one-pager — totals, leakage callouts, ROI gauge.", ar: "يصوغ صفحة الملخّص للمدير المالي — المجاميع وتنبيهات التسرّب ومقياس العائد." },
        kind: "drafter",
        reads: [
          { en: "Leakage callouts, scoreboard totals, board house style", ar: "تنبيهات التسرّب، مجاميع لوحة القياس، أسلوب المجلس" },
        ],
        writes: [{ en: "Printable CFO one-pager", ar: "صفحة ملخّص قابلة للطباعة للمدير المالي" }],
      },
    ],
    edges: [
      { from: "portfolio-watcher", to: "uvr-scorer" },
      { from: "uvr-scorer", to: "leakage-detective" },
      { from: "leakage-detective", to: "cfo-narrator" },
    ],
    humanCheckpoints: [
      {
        id: "cfo-signoff",
        name: { en: "CFO", ar: "المدير المالي" },
        decision: {
          en: "Edits and signs the one-pager before it ships to the board pack. The agent never publishes on the CFO's behalf.",
          ar: "يحرّر ويوقّع الصفحة قبل إرسالها إلى حزمة المجلس. لا ينشر الوكيل أبداً نيابة عن المدير المالي.",
        },
      },
    ],
    flowOrder: linearFlow(
      ["portfolio-watcher", "uvr-scorer", "leakage-detective", "cfo-narrator"],
      [{ id: "cfo-signoff", afterAgent: "cfo-narrator" }],
    ),
    rationale: {
      en: "A single model would either monitor or narrate, not both. Splitting watcher / scorer / detective / narrator keeps each agent narrow, auditable, and replaceable on its own cadence — which is exactly how a CFO actually divides work across an FP&A team.",
      ar: "نموذج واحد إمّا يراقب أو يسرد، لا الاثنين معاً. تقسيم العمل بين المراقب والمصنّف والمحقّق والكاتب يبقي كل وكيل ضيّقاً قابلاً للتدقيق ويمكن استبداله على وتيرته الخاصة — وهذا تماماً ما يفعله المدير المالي عند توزيع العمل على فريق التخطيط المالي.",
    },
  },

  // ─── 2. Programme Health Copilot ────────────────────────────────────────
  "programme-health-copilot": {
    agents: [
      {
        id: "programme-watcher",
        name: { en: "Programme Watcher", ar: "مراقب البرنامج" },
        role: { en: "Pulls events from Jira, MS Project, Confluence and status emails.", ar: "يجلب الأحداث من جيرا وMS Project وConfluence وبريد الحالة." },
        kind: "retriever",
        reads: [
          { en: "Jira, MS Project, Asana, Smartsheet", ar: "جيرا، MS Project، Asana، Smartsheet" },
          { en: "Confluence / SharePoint, status mailboxes", ar: "Confluence وSharePoint، صناديق بريد الحالة" },
        ],
        writes: [{ en: "Normalised event stream", ar: "مجرى أحداث موحّد" }],
      },
      {
        id: "raid-classifier",
        name: { en: "RAID Classifier", ar: "مصنّف RAID" },
        role: { en: "Tags every event as risk / assumption / issue / dependency and assigns a RAG.", ar: "يصنّف كل حدث كمخاطرة أو افتراض أو مشكلة أو اعتمادية ويسند له حالة RAG." },
        kind: "classifier",
        writes: [{ en: "RAID delta tagged by RAG", ar: "تغيّرات RAID موسومة بحالة RAG" }],
      },
      {
        id: "etc-recompiler",
        name: { en: "ETC Recompiler", ar: "مُعيد معايرة التقدير" },
        role: { en: "Recomputes the estimate-to-complete and forecast cone using the milestone plan.", ar: "يعيد حساب التقدير حتى الإكمال ومخروط التنبؤ باستخدام خطة المحطّات." },
        kind: "scorer",
        writes: [{ en: "ETC drift, forecast cone", ar: "انجراف التقدير، مخروط التنبؤ" }],
      },
      {
        id: "steering-drafter",
        name: { en: "Steering Drafter", ar: "كاتب عبوة التوجيه" },
        role: { en: "Drafts the weekly steering pack in the executive's house style.", ar: "يصوغ مسوّدة عبوة التوجيه الأسبوعية بأسلوب التنفيذي." },
        kind: "drafter",
        writes: [{ en: "Weekly steering pack draft", ar: "مسوّدة عبوة التوجيه الأسبوعية" }],
      },
      {
        id: "ask-extractor",
        name: { en: "Ask Extractor", ar: "مستخرج الطلب" },
        role: { en: "Extracts the single decision the steering committee must make this week.", ar: "يستخرج القرار الوحيد الذي يجب أن تتخذه لجنة التوجيه هذا الأسبوع." },
        kind: "critic",
        writes: [{ en: "One recommended ask", ar: "طلب موصى به واحد" }],
      },
    ],
    edges: [
      { from: "programme-watcher", to: "raid-classifier" },
      { from: "raid-classifier", to: "etc-recompiler" },
      { from: "etc-recompiler", to: "steering-drafter" },
      { from: "steering-drafter", to: "ask-extractor" },
    ],
    humanCheckpoints: [
      {
        id: "pmo-lead-signs",
        name: { en: "PMO Lead", ar: "قائد PMO" },
        decision: {
          en: "Edits, signs and owns the steering pack. The agent never sends it to the steering committee on its own.",
          ar: "يحرّر العبوة ويوقّعها ويتحمّل مسؤوليتها. لا يرسلها الوكيل إلى لجنة التوجيه من تلقاء نفسه.",
        },
      },
    ],
    flowOrder: linearFlow(
      ["programme-watcher", "raid-classifier", "etc-recompiler", "steering-drafter", "ask-extractor"],
      [{ id: "pmo-lead-signs", afterAgent: "ask-extractor" }],
    ),
    rationale: {
      en: "Classification, forecasting and executive narrative are different skills. Chaining specialised agents lets the PMO swap the forecasting model without retraining the drafter, and lets every claim in the pack cite the source ticket the watcher pulled.",
      ar: "التصنيف والتنبؤ وكتابة الرواية التنفيذية مهارات مختلفة. تسلسل الوكلاء المتخصّصين يتيح لـPMO استبدال نموذج التنبؤ دون إعادة تدريب الكاتب، ويسمح لكل ادعاء في العبوة بأن يستند إلى التذكرة المصدرية التي جلبها المراقب.",
    },
  },

  // ─── 3. Sovereign Citizen Services Agent ────────────────────────────────
  "citizen-services-agent": {
    agents: [
      {
        id: "dialect-tagger",
        name: { en: "Dialect Tagger", ar: "موسوم اللهجة" },
        role: { en: "Detects intent and Arabic dialect (Khaleeji, Egyptian, Levantine, MSA).", ar: "يكتشف النية واللهجة العربية (خليجية، مصرية، شامية، فصحى)." },
        kind: "classifier",
        reads: [{ en: "Live caller transcript (voice or chat)", ar: "نص الاتصال الحيّ (صوتي أو محادثة)" }],
        writes: [{ en: "Intent + dialect tag", ar: "النية + وسم اللهجة" }],
      },
      {
        id: "policy-retriever",
        name: { en: "Policy Retriever", ar: "مسترجع السياسات" },
        role: { en: "Finds the matching service-catalogue entry and any cited policy clauses.", ar: "يعثر على بند الخدمة في الكتالوج وأي مواد السياسة المرتبطة." },
        kind: "retriever",
        reads: [
          { en: "Service catalogue, ministry SharePoint, regulator decrees", ar: "كتالوج الخدمات، شيربوينت الوزارة، مراسيم الجهة التنظيمية" },
        ],
        writes: [{ en: "Candidate citations", ar: "مراجع مرشّحة" }],
      },
      {
        id: "response-drafter",
        name: { en: "Response Drafter", ar: "كاتب الرد" },
        role: { en: "Drafts a bilingual reply that always carries a citation back to a published policy.", ar: "يصوغ ردّاً ثنائي اللغة يحمل دائماً مرجعاً إلى سياسة منشورة." },
        kind: "drafter",
        writes: [{ en: "Bilingual reply with citation", ar: "ردّ ثنائي اللغة مع مرجع" }],
      },
      {
        id: "confidence-scorer",
        name: { en: "Confidence Scorer", ar: "مصنّف الثقة" },
        role: { en: "Scores confidence and routes to a human supervisor when below the threshold or sensitive.", ar: "يصنّف الثقة ويحوّل إلى مشرف بشري عند انخفاضها أو في الحالات الحسّاسة." },
        kind: "router",
        writes: [{ en: "Confidence score, routing decision", ar: "درجة الثقة، قرار التوجيه" }],
      },
      {
        id: "audit-packetizer",
        name: { en: "Audit Packetizer", ar: "مُجمّع حزمة التدقيق" },
        role: { en: "Packages every conversation into a regulator-subpoenable evidence packet.", ar: "يجمع كل محادثة في حزمة أدلة قابلة للطلب من الجهة التنظيمية." },
        kind: "compiler",
        writes: [
          { en: "Per-conversation audit packet", ar: "حزمة تدقيق لكل محادثة" },
        ],
      },
    ],
    edges: [
      { from: "dialect-tagger", to: "policy-retriever" },
      { from: "policy-retriever", to: "response-drafter" },
      { from: "response-drafter", to: "confidence-scorer" },
      { from: "confidence-scorer", to: "audit-packetizer" },
    ],
    humanCheckpoints: [
      {
        id: "supervisor-takes-over",
        name: { en: "Supervising Officer", ar: "الموظف المشرف" },
        decision: {
          en: "Takes the conversation when the confidence scorer routes it — sensitive intent or confidence below 75 %.",
          ar: "يتولّى المحادثة حين يحوّلها مصنّف الثقة — نية حسّاسة أو ثقة أقل من 75%.",
        },
      },
    ],
    flowOrder: linearFlow(
      ["dialect-tagger", "policy-retriever", "response-drafter", "confidence-scorer", "audit-packetizer"],
      [{ id: "supervisor-takes-over", afterAgent: "confidence-scorer" }],
    ),
    rationale: {
      en: "Classification, retrieval, drafting, scoring and packaging are independent crafts — separating them is what makes the pipeline regulator-defensible. The audit packetizer alone is the difference between deployable and not.",
      ar: "التصنيف والاسترجاع والصياغة والتصنيف والتجميع حِرف مستقلة — فصلها هو ما يجعل المسار قابلاً للدفاع تنظيمياً. وحدها حزمة التدقيق تصنع الفرق بين قابل للنشر وغير قابل.",
    },
  },

  // ─── 4. Procurement Intelligence Agent ──────────────────────────────────
  "procurement-intelligence": {
    agents: [
      {
        id: "spend-normaliser",
        name: { en: "Spend Normaliser", ar: "موحِّد الإنفاق" },
        role: { en: "Normalises spend across ERP, Ariba and Etimad into a single FX-adjusted taxonomy.", ar: "يوحّد الإنفاق عبر ERP وAriba واعتماد في تصنيف واحد معدَّل بالعملة." },
        kind: "compiler",
        reads: [
          { en: "ERP, SAP Ariba, Etimad, FX rates", ar: "ERP، SAP Ariba، اعتماد، أسعار الصرف" },
        ],
        writes: [{ en: "Normalised spend taxonomy", ar: "تصنيف إنفاق موحّد" }],
      },
      {
        id: "savings-modeller",
        name: { en: "Savings Modeller", ar: "نمذجة الوفورات" },
        role: { en: "Builds a category-level savings hypothesis from baseline, FX leverage and consolidation.", ar: "يبني فرضية وفورات على مستوى الفئة من الأساس ونفوذ العملة والدمج." },
        kind: "scorer",
        writes: [{ en: "Category savings hypothesis", ar: "فرضية وفورات الفئة" }],
      },
      {
        id: "supplier-risk-analyst",
        name: { en: "Supplier Risk Analyst", ar: "محلّل مخاطر الموردين" },
        role: { en: "Scores each supplier on performance, financial, sanction and ESG signals.", ar: "يصنّف كل مورد على الأداء والمالية والعقوبات وإشارات ESG." },
        kind: "scorer",
        reads: [
          { en: "Supplier master, sanction lists, financial filings, ESG signals", ar: "ملفات الموردين، قوائم العقوبات، الإفصاحات المالية، إشارات ESG" },
        ],
        writes: [{ en: "Risk score per supplier", ar: "درجة المخاطر لكل مورد" }],
      },
      {
        id: "negotiation-drafter",
        name: { en: "Negotiation Drafter", ar: "كاتب التفاوض" },
        role: { en: "Drafts a buyer / supplier leverage map and BATNA pre-read for each renewal.", ar: "يصوغ خريطة نفوذ المشتري والمورد وأفضل بديل لكل تجديد." },
        kind: "drafter",
        writes: [{ en: "Negotiation pre-read", ar: "ملخّص تحضير التفاوض" }],
      },
    ],
    edges: [
      { from: "spend-normaliser", to: "savings-modeller" },
      { from: "spend-normaliser", to: "supplier-risk-analyst" },
      { from: "savings-modeller", to: "negotiation-drafter" },
      { from: "supplier-risk-analyst", to: "negotiation-drafter" },
    ],
    humanCheckpoints: [
      {
        id: "cpo-approves-savings",
        name: { en: "CPO and category lead", ar: "كبير المشتريات ومسؤول الفئة" },
        decision: {
          en: "Approve the savings hypothesis before it goes to the sourcing committee.",
          ar: "يوافقان على فرضية الوفورات قبل عرضها على لجنة التوريد.",
        },
      },
      {
        id: "legal-clears-pre-read",
        name: { en: "Legal & compliance", ar: "القانونية والامتثال" },
        decision: {
          en: "Clears the negotiation pre-read for use against the supplier.",
          ar: "تجيز ملخّص التفاوض للاستخدام أمام المورد.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "spend-normaliser" },
      { kind: "agent", id: "savings-modeller" },
      { kind: "agent", id: "supplier-risk-analyst" },
      { kind: "human", id: "cpo-approves-savings" },
      { kind: "agent", id: "negotiation-drafter" },
      { kind: "human", id: "legal-clears-pre-read" },
    ],
    rationale: {
      en: "Spend normalisation, savings modelling and supplier-risk scoring operate on completely different sources. Chaining specialists prevents one fragile model from owning all four — and means a CPO can swap the risk model without retraining anything else.",
      ar: "توحيد الإنفاق ونمذجة الوفورات وتقييم مخاطر الموردين يعتمد كلٌّ منها على مصادر مختلفة تماماً. تسلسل المتخصّصين يمنع نموذجاً هشّاً واحداً من امتلاك الأربعة — ويتيح لكبير المشتريات استبدال نموذج المخاطر دون إعادة تدريب أيّ شيء آخر.",
    },
  },

  // ─── 5. Telecom Network Ops Agent ───────────────────────────────────────
  "network-ops-agent": {
    agents: [
      {
        id: "alarm-collector",
        name: { en: "Alarm Collector", ar: "جامع الإنذارات" },
        role: { en: "Pulls alarms from RAN / Core / Transport OSS and normalises against a vendor-agnostic ontology.", ar: "يجلب الإنذارات من شبكات الراديو والنواة والنقل ويوحّدها وفق أنطولوجيا مستقلة عن المورد." },
        kind: "retriever",
        reads: [{ en: "OSS alarms (RAN/Core/Transport)", ar: "إنذارات OSS (الراديو/النواة/النقل)" }],
        writes: [{ en: "Normalised alarm chain", ar: "سلسلة إنذارات موحّدة" }],
      },
      {
        id: "customer-impact-scorer",
        name: { en: "Customer-Impact Scorer", ar: "مصنّف أثر العميل" },
        role: { en: "Scores how much customer impact each alarm chain is creating right now.", ar: "يقيس مقدار أثر العميل الذي تسبّبه كل سلسلة إنذار حالياً." },
        kind: "scorer",
        reads: [{ en: "BSS care tickets, CSAT telemetry", ar: "تذاكر خدمة BSS، قياسات رضا العملاء" }],
        writes: [{ en: "Impact score by cell / cohort", ar: "درجة الأثر لكل خلية/فئة" }],
      },
      {
        id: "change-correlator",
        name: { en: "Change Correlator", ar: "رابط التغيير" },
        role: { en: "Correlates the alarm chain back to recent change-management records.", ar: "يربط سلسلة الإنذار بسجلات إدارة التغيير الأخيرة." },
        kind: "critic",
        reads: [{ en: "Change-management records", ar: "سجلات إدارة التغيير" }],
        writes: [{ en: "Candidate root-cause hypothesis", ar: "فرضية جذر السبب" }],
      },
      {
        id: "triage-recommender",
        name: { en: "Triage Recommender", ar: "موصي الفرز" },
        role: { en: "Drafts the recommended triage action with the supporting evidence chain.", ar: "يصوغ إجراء الفرز الموصى به مع سلسلة الأدلة الداعمة." },
        kind: "drafter",
        writes: [{ en: "Triage recommendation with evidence", ar: "توصية فرز مع الأدلّة" }],
      },
      {
        id: "regulator-flagger",
        name: { en: "Regulator Flagger", ar: "رافع علم المنظّم" },
        role: { en: "Flags incidents that meet a regulator-notification threshold.", ar: "يرفع علم الحوادث التي تستوفي عتبة إخطار المنظّم." },
        kind: "router",
        writes: [{ en: "Regulator-notifiable flag", ar: "علامة إخطار المنظّم" }],
      },
    ],
    edges: [
      { from: "alarm-collector", to: "customer-impact-scorer" },
      { from: "alarm-collector", to: "change-correlator" },
      { from: "customer-impact-scorer", to: "triage-recommender" },
      { from: "change-correlator", to: "triage-recommender" },
      { from: "triage-recommender", to: "regulator-flagger" },
    ],
    humanCheckpoints: [
      {
        id: "noc-engineer-actions",
        name: { en: "NOC Engineer", ar: "مهندس مركز عمليات الشبكة" },
        decision: {
          en: "Reviews and executes any network-impacting change. The agent never touches the network directly.",
          ar: "يراجع وينفّذ أي تغيير يمسّ الشبكة. لا يلمس الوكيل الشبكة مباشرةً أبداً.",
        },
      },
      {
        id: "regulator-officer-files",
        name: { en: "Regulator Liaison", ar: "ضابط الاتصال بالمنظّم" },
        decision: {
          en: "Files the formal regulator notification when the regulator-flag fires.",
          ar: "يقدّم الإخطار الرسمي للمنظّم عند تفعيل العلم.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "alarm-collector" },
      { kind: "agent", id: "customer-impact-scorer" },
      { kind: "agent", id: "change-correlator" },
      { kind: "agent", id: "triage-recommender" },
      { kind: "human", id: "noc-engineer-actions" },
      { kind: "agent", id: "regulator-flagger" },
      { kind: "human", id: "regulator-officer-files" },
    ],
    rationale: {
      en: "Alarm fusion, customer-impact scoring and change correlation use entirely different signals — splitting them keeps each model accountable for its slice of the evidence and lets the NOC swap one without breaking the others.",
      ar: "دمج الإنذارات وتقييم أثر العميل وربط التغيير يستخدم إشارات مختلفة تماماً — وتقسيمها يبقي كل نموذج مسؤولاً عن قطعته من الدليل ويتيح لمركز العمليات استبدال أحدها دون كسر الباقي.",
    },
  },

  // ─── 6. SAMA Compliance Agent ───────────────────────────────────────────
  "sama-compliance-agent": {
    agents: [
      {
        id: "obligation-mapper",
        name: { en: "Obligation Mapper", ar: "مُخطِّط الالتزامات" },
        role: { en: "Maps SAMA circulars, the UAE AI Charter and PDPL into a versioned obligation library.", ar: "يحوّل تعميمات ساما وميثاق الإمارات للذكاء الاصطناعي وPDPL إلى مكتبة التزامات مُصدَّرة." },
        kind: "compiler",
        reads: [{ en: "SAMA circulars, UAE AI Charter, PDPL", ar: "تعميمات ساما، ميثاق الإمارات، PDPL" }],
        writes: [{ en: "Obligation library (versioned)", ar: "مكتبة التزامات مُصدَّرة" }],
      },
      {
        id: "control-monitor",
        name: { en: "Control Monitor", ar: "مراقب الضوابط" },
        role: { en: "Monitors GRC tooling, change records and operational telemetry for control health.", ar: "يراقب أدوات الحوكمة وسجلات التغيير والقياسات التشغيلية لصحة الضوابط." },
        kind: "monitor",
        reads: [
          { en: "GRC tooling, change records, operational telemetry", ar: "أدوات الحوكمة، سجلات التغيير، القياسات التشغيلية" },
        ],
        writes: [{ en: "Control health snapshot", ar: "لقطة صحة الضوابط" }],
      },
      {
        id: "evidence-curator",
        name: { en: "Evidence Curator", ar: "منسّق الأدلّة" },
        role: { en: "Pulls the right evidence document for each obligation, with a citation trail.", ar: "يجلب الوثيقة الدليلية المناسبة لكل التزام مع سلسلة مراجع." },
        kind: "retriever",
        reads: [{ en: "Policy library, SharePoint", ar: "مكتبة السياسات، شيربوينت" }],
        writes: [{ en: "Evidence per obligation with citations", ar: "أدلّة لكل التزام مع مراجع" }],
      },
      {
        id: "degradation-detective",
        name: { en: "Degradation Detective", ar: "محقّق التدهور" },
        role: { en: "Predicts which control will breach next given current degradation trajectory.", ar: "يتنبّأ بالضابط الذي سيخترق التزامه أوّلاً بناء على مسار التدهور." },
        kind: "critic",
        writes: [{ en: "Degradation alerts with breach forecast", ar: "تنبيهات تدهور مع تنبؤ بالخرق" }],
      },
      {
        id: "pack-compiler",
        name: { en: "Inspection-Pack Compiler", ar: "مُجمّع حزمة التفتيش" },
        role: { en: "Compiles the bilingual inspection-ready PDF on demand.", ar: "يجمع ملف PDF ثنائي اللغة الجاهز للتفتيش عند الطلب." },
        kind: "compiler",
        writes: [{ en: "Inspection-ready PDF (EN/AR)", ar: "ملف PDF جاهز للتفتيش (EN/AR)" }],
      },
    ],
    edges: [
      { from: "obligation-mapper", to: "evidence-curator" },
      { from: "control-monitor", to: "degradation-detective" },
      { from: "evidence-curator", to: "pack-compiler" },
      { from: "degradation-detective", to: "pack-compiler" },
    ],
    humanCheckpoints: [
      {
        id: "cro-signs-pack",
        name: { en: "CRO and Head of Compliance", ar: "كبير المخاطر ورئيس الامتثال" },
        decision: {
          en: "Reviews and signs the evidence pack before any inspection submission.",
          ar: "يراجعان حزمة الأدلّة ويوقّعانها قبل أي تقديم تفتيشي.",
        },
      },
      {
        id: "audit-clears-finding",
        name: { en: "Internal Audit", ar: "التدقيق الداخلي" },
        decision: {
          en: "Clears every degradation alert before it surfaces to the regulator.",
          ar: "يجيز كل تنبيه تدهور قبل وصوله إلى المنظّم.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "obligation-mapper" },
      { kind: "agent", id: "control-monitor" },
      { kind: "agent", id: "evidence-curator" },
      { kind: "agent", id: "degradation-detective" },
      { kind: "human", id: "audit-clears-finding" },
      { kind: "agent", id: "pack-compiler" },
      { kind: "human", id: "cro-signs-pack" },
    ],
    rationale: {
      en: "Regulator obligations, control telemetry, evidence retrieval and inspection-pack drafting demand different auditable trails. Chaining specialised agents lets each one carry the right metadata so SAMA can subpoena any single step in isolation.",
      ar: "التزامات المنظّم، وقياسات الضوابط، واسترجاع الأدلّة، وصياغة حزم التفتيش تتطلّب مسارات تدقيق مختلفة. تسلسل الوكلاء المتخصّصين يتيح لكلٍّ منها حمل البيانات الصحيحة حتى تستطيع ساما طلب أي خطوة بمعزل.",
    },
  },

  // ─── 7. Energy Trading Copilot ──────────────────────────────────────────
  "energy-trading-copilot": {
    agents: [
      {
        id: "feed-aggregator",
        name: { en: "Feed Aggregator", ar: "مُجمّع التدفقات" },
        role: { en: "Normalises price, weather, vessel-position and macro feeds into one event stream.", ar: "يوحّد تدفقات الأسعار والطقس ومواقع الناقلات والاقتصاد الكلي في مجرى أحداث واحد." },
        kind: "retriever",
        reads: [
          { en: "Brent/WTI/Dubai/Murban prices, OPEC and JODI commentary", ar: "أسعار برنت/WTI/دبي/مربان، تعليقات أوبك وJODI" },
          { en: "Vessel positions, weather, refinery telemetry", ar: "مواقع الناقلات، الطقس، قياسات المصافي" },
        ],
        writes: [{ en: "Normalised event stream", ar: "مجرى أحداث موحّد" }],
      },
      {
        id: "event-correlator",
        name: { en: "Event Correlator", ar: "رابط الأحداث" },
        role: { en: "Spots correlated events that hint at a tradable hypothesis.", ar: "يكتشف الأحداث المترابطة التي تشير إلى فرضية تداول." },
        kind: "critic",
        writes: [{ en: "Candidate idea hypotheses", ar: "فرضيات أفكار مرشّحة" }],
      },
      {
        id: "risk-bander",
        name: { en: "Risk Bander", ar: "مصنّف نطاق المخاطر" },
        role: { en: "Assigns conviction and risk band to each idea before it ever reaches the floor.", ar: "يسند الاقتناع ونطاق المخاطر لكل فكرة قبل وصولها إلى القاعة." },
        kind: "scorer",
        writes: [{ en: "Conviction + risk band per idea", ar: "اقتناع + نطاق مخاطر لكل فكرة" }],
      },
      {
        id: "memo-drafter",
        name: { en: "Memo Drafter", ar: "كاتب المذكّرة" },
        role: { en: "Drafts the trade-idea memo with assumption stack and exit triggers.", ar: "يصوغ مذكّرة فكرة التداول مع حزمة الافتراضات ومحفّزات الخروج." },
        kind: "drafter",
        writes: [{ en: "Trade-idea memo (PDF draft)", ar: "مسوّدة مذكّرة فكرة التداول" }],
      },
    ],
    edges: [
      { from: "feed-aggregator", to: "event-correlator" },
      { from: "event-correlator", to: "risk-bander" },
      { from: "risk-bander", to: "memo-drafter" },
    ],
    humanCheckpoints: [
      {
        id: "trader-signs-memo",
        name: { en: "Trader", ar: "المتداول" },
        decision: {
          en: "Signs the memo. Only the trader can act — the agent never touches an order.",
          ar: "يوقّع المذكّرة. المتداول وحده من يمكنه التصرّف — لا يلمس الوكيل أمراً أبداً.",
        },
      },
      {
        id: "compliance-clears-floor",
        name: { en: "Compliance Officer", ar: "مسؤول الامتثال" },
        decision: {
          en: "Clears any new memo template against the trading floor's regulatory ringfence.",
          ar: "يجيز أي قالب مذكّرة جديد مقابل الحاجز التنظيمي لقاعة التداول.",
        },
      },
    ],
    flowOrder: linearFlow(
      ["feed-aggregator", "event-correlator", "risk-bander", "memo-drafter"],
      [
        { id: "compliance-clears-floor", afterAgent: "memo-drafter" },
        { id: "trader-signs-memo", afterAgent: "memo-drafter" },
      ],
    ),
    rationale: {
      en: "Separating feed normalisation from idea generation from risk banding from drafting is what makes the copilot deployable inside a hard regulatory ringfence — no single model is ever both researching the market and writing to the trading floor.",
      ar: "فصل توحيد التدفقات عن توليد الأفكار عن تصنيف المخاطر عن الصياغة هو ما يجعل المساعد قابلاً للنشر داخل حاجز تنظيمي صارم — لا يجمع نموذج واحد بين البحث في السوق والكتابة إلى القاعة.",
    },
  },

  // ─── 8. Retail Demand Forecaster ────────────────────────────────────────
  "retail-demand-forecaster": {
    agents: [
      {
        id: "season-tagger",
        name: { en: "Season Tagger", ar: "موسوم الموسم" },
        role: { en: "Tags every week with Hijri events, school terms and public holidays per emirate.", ar: "يضع وسماً لكل أسبوع بأحداث التقويم الهجري وفصول المدارس والإجازات لكل إمارة." },
        kind: "classifier",
        reads: [
          { en: "Hijri calendar, school terms by emirate, public holidays", ar: "التقويم الهجري، فصول المدارس حسب الإمارة، الإجازات الرسمية" },
        ],
        writes: [{ en: "Seasonality overlay per SKU/store/week", ar: "طبقة الموسمية لكل منتج/متجر/أسبوع" }],
      },
      {
        id: "base-forecaster",
        name: { en: "Base Forecaster", ar: "متنبّئ الأساس" },
        role: { en: "Generates the base SKU × store × week forecast from POS history and inventory.", ar: "يولّد التنبؤ الأساسي للمنتج × المتجر × الأسبوع من تاريخ نقاط البيع والمخزون." },
        kind: "scorer",
        reads: [
          { en: "POS sales history, on-hand and in-transit inventory, store master", ar: "تاريخ مبيعات نقاط البيع، المخزون والشحنات قيد النقل، البيانات الرئيسية للمتاجر" },
        ],
        writes: [{ en: "Base SKU×store×week forecast", ar: "تنبؤ أساسي" }],
      },
      {
        id: "seasonality-overlay",
        name: { en: "Seasonality Overlay", ar: "طبقة الموسمية" },
        role: { en: "Applies Ramadan, school-return and summer-exodus shifts to the base forecast.", ar: "يطبّق إزاحات رمضان وعودة المدارس ونزوح الصيف على التنبؤ الأساسي." },
        kind: "compiler",
        writes: [{ en: "Region-tuned forecast", ar: "تنبؤ مضبوط للمنطقة" }],
      },
      {
        id: "allocator",
        name: { en: "Allocator", ar: "مُخصِّص" },
        role: { en: "Suggests per-store allocation against current on-hand and in-transit.", ar: "يقترح التخصيص لكل متجر مقابل المخزون والشحنات." },
        kind: "drafter",
        writes: [{ en: "Per-store allocation suggestion", ar: "اقتراح تخصيص لكل متجر" }],
      },
      {
        id: "promo-simulator",
        name: { en: "Promo Simulator", ar: "محاكي العروض" },
        role: { en: "Simulates promo cadence and depth, projecting lift and margin impact.", ar: "يحاكي إيقاع العروض وعمقها ويتنبّأ بالرفع وأثر الهامش." },
        kind: "scorer",
        writes: [{ en: "Lift and margin simulation", ar: "محاكاة الرفع والهامش" }],
      },
    ],
    edges: [
      { from: "season-tagger", to: "seasonality-overlay" },
      { from: "base-forecaster", to: "seasonality-overlay" },
      { from: "seasonality-overlay", to: "allocator" },
      { from: "seasonality-overlay", to: "promo-simulator" },
    ],
    humanCheckpoints: [
      {
        id: "merchandiser-approves-allocation",
        name: { en: "Merchandiser", ar: "رئيس البضائع" },
        decision: {
          en: "Approves or overrides each store allocation before it hits the planning system.",
          ar: "يوافق أو يتجاوز كل تخصيص للمتجر قبل دخوله نظام التخطيط.",
        },
      },
      {
        id: "revenue-signs-promo",
        name: { en: "Revenue Manager", ar: "مدير الإيرادات" },
        decision: {
          en: "Signs the promo cadence before commit.",
          ar: "يوقّع إيقاع العروض قبل الإلزام.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "season-tagger" },
      { kind: "agent", id: "base-forecaster" },
      { kind: "agent", id: "seasonality-overlay" },
      { kind: "agent", id: "allocator" },
      { kind: "human", id: "merchandiser-approves-allocation" },
      { kind: "agent", id: "promo-simulator" },
      { kind: "human", id: "revenue-signs-promo" },
    ],
    rationale: {
      en: "GCC seasonality, base demand and promo lift each demand specialist models. Splitting them lets the merchandiser tune one — say the seasonality overlay around a moving Eid date — without retraining the others.",
      ar: "الموسمية الخليجية، والطلب الأساسي، ورفع العروض، يحتاج كلٌّ منها نموذجاً متخصّصاً. تقسيمها يتيح لرئيس البضائع ضبط أحدها — مثل طبقة الموسمية حول موعد عيد متغيّر — دون إعادة تدريب الباقي.",
    },
  },

  // ─── 9. Hospitality Revenue Optimizer ───────────────────────────────────
  "hospitality-revenue-optimizer": {
    agents: [
      {
        id: "event-tagger",
        name: { en: "Event Tagger", ar: "موسوم الأحداث" },
        role: { en: "Tags every day with Riyadh Season, F1, EXPO-class and Hajj-cohort overlays.", ar: "يضع وسماً لكل يوم بطبقات موسم الرياض وF1 وفعاليات بحجم إكسبو وحجاج العمرة." },
        kind: "classifier",
        reads: [{ en: "Event calendar, brand calendar", ar: "تقويم الأحداث، تقويم العلامة" }],
        writes: [{ en: "Demand-event overlay per day", ar: "طبقة أحداث الطلب لكل يوم" }],
      },
      {
        id: "demand-modeller",
        name: { en: "Demand Modeller", ar: "نمذجة الطلب" },
        role: { en: "Models demand pressure per room-type per day from PMS history and event overlay.", ar: "يصمّم ضغط الطلب لكل نوع غرفة لكل يوم من تاريخ PMS وطبقة الأحداث." },
        kind: "scorer",
        reads: [{ en: "PMS data (Opera, Mews, Cloudbeds)", ar: "بيانات PMS (Opera وMews وCloudbeds)" }],
        writes: [{ en: "Demand pressure per day per room-type", ar: "ضغط الطلب لكل يوم لكل نوع غرفة" }],
      },
      {
        id: "competitor-rate-watcher",
        name: { en: "Competitor Rate Watcher", ar: "مراقب أسعار المنافسين" },
        role: { en: "Scrapes competitor rates and surfaces the day's benchmark.", ar: "يستخرج أسعار المنافسين ويعرض المعيار اليومي." },
        kind: "retriever",
        reads: [{ en: "Competitor rate scrape", ar: "استخراج أسعار المنافسين" }],
        writes: [{ en: "Competitor benchmark", ar: "معيار المنافسين" }],
      },
      {
        id: "rate-recommender",
        name: { en: "Rate Recommender", ar: "موصي الأسعار" },
        role: { en: "Recommends rate, length-of-stay and channel mix per room-type per day.", ar: "يوصي بالسعر وقيود طول الإقامة ومزيج القنوات لكل نوع غرفة لكل يوم." },
        kind: "drafter",
        writes: [{ en: "Rate / LOS / channel-mix recommendation", ar: "توصية السعر/طول الإقامة/مزيج القنوات" }],
      },
      {
        id: "channel-mix-tuner",
        name: { en: "Channel-Mix Tuner", ar: "موالف مزيج القنوات" },
        role: { en: "Tunes the OTA / direct / corporate mix and projects margin impact.", ar: "يضبط مزيج OTA والمباشر والشركات ويتنبّأ بأثر الهامش." },
        kind: "scorer",
        writes: [{ en: "Channel-mix simulation", ar: "محاكاة مزيج القنوات" }],
      },
    ],
    edges: [
      { from: "event-tagger", to: "demand-modeller" },
      { from: "competitor-rate-watcher", to: "rate-recommender" },
      { from: "demand-modeller", to: "rate-recommender" },
      { from: "rate-recommender", to: "channel-mix-tuner" },
    ],
    humanCheckpoints: [
      {
        id: "revenue-manager-signs-rates",
        name: { en: "Revenue Manager", ar: "مدير الإيرادات" },
        decision: {
          en: "Signs each rate update before publish to channels.",
          ar: "يوقّع كل تحديث للسعر قبل النشر على القنوات.",
        },
      },
      {
        id: "cco-clears-event-overlay",
        name: { en: "CCO", ar: "كبير المسؤولين التجاريين" },
        decision: {
          en: "Clears any new event overlay before it influences pricing.",
          ar: "يُجيز أي طبقة أحداث جديدة قبل أن تؤثّر على التسعير.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "event-tagger" },
      { kind: "human", id: "cco-clears-event-overlay" },
      { kind: "agent", id: "demand-modeller" },
      { kind: "agent", id: "competitor-rate-watcher" },
      { kind: "agent", id: "rate-recommender" },
      { kind: "human", id: "revenue-manager-signs-rates" },
      { kind: "agent", id: "channel-mix-tuner" },
    ],
    rationale: {
      en: "Event tagging, demand modelling, competitor scrape and channel-mix tuning each operate on different feeds. Splitting them lets the revenue manager intervene at the precise step that matters that day, without breaking the rest of the pipeline.",
      ar: "وسم الأحداث، ونمذجة الطلب، واستخراج المنافسين، وضبط مزيج القنوات يعتمد كلٌّ منها على تدفقات مختلفة. تقسيمها يتيح لمدير الإيرادات التدخّل في الخطوة الدقيقة التي تهمّ ذلك اليوم دون كسر بقية المسار.",
    },
  },

  // ─── 10. EV Battery Health Agent ────────────────────────────────────────
  "ev-battery-health-agent": {
    agents: [
      {
        id: "telemetry-ingestor",
        name: { en: "Telemetry Ingestor", ar: "مستوعب القياسات" },
        role: { en: "Ingests connected-vehicle telemetry from each OEM API.", ar: "يستوعب قياسات المركبات المتصلة من واجهات البرمجة لكل صانع." },
        kind: "retriever",
        reads: [{ en: "OEM connected-vehicle APIs", ar: "واجهات OEM للمركبات المتصلة" }],
        writes: [{ en: "Normalised telemetry stream", ar: "مجرى قياسات موحّد" }],
      },
      {
        id: "soh-predictor",
        name: { en: "SOH Predictor", ar: "متنبّئ صحة البطارية" },
        role: { en: "Predicts the state-of-health curve months ahead of the warning lights.", ar: "يتنبّأ بمنحنى صحة البطارية قبل أشهر من إنذارات اللوحة." },
        kind: "scorer",
        writes: [{ en: "Predicted SOH curve per VIN", ar: "منحنى صحة متنبَّأ لكل مركبة" }],
      },
      {
        id: "intervention-window-planner",
        name: { en: "Intervention Window Planner", ar: "مُخطّط نافذة التدخّل" },
        role: { en: "Plans the intervention window per VIN against parts availability and bay capacity.", ar: "يخطّط نافذة التدخّل لكل مركبة مقابل توفّر القطع وسعة ورش الخدمة." },
        kind: "drafter",
        reads: [{ en: "Service history, parts availability", ar: "تاريخ الخدمة، توفّر القطع" }],
        writes: [{ en: "Intervention window per VIN", ar: "نافذة التدخّل لكل مركبة" }],
      },
      {
        id: "customer-graph-resolver",
        name: { en: "Customer Graph Resolver", ar: "محلّل رسم العميل" },
        role: { en: "Builds a household-level multi-brand customer profile from DMS and CRM.", ar: "يبني ملف عميل متعدّد العلامات على مستوى المنزل من DMS وCRM." },
        kind: "compiler",
        reads: [{ en: "DMS, CRM, multi-brand customer master", ar: "DMS وCRM وبيانات العميل متعدّدة العلامات" }],
        writes: [{ en: "Household-level customer profile", ar: "ملف عميل على مستوى المنزل" }],
      },
      {
        id: "outreach-drafter",
        name: { en: "Outreach Drafter", ar: "كاتب التواصل" },
        role: { en: "Drafts SMS / WhatsApp / call-script outreach for the service advisor to send.", ar: "يصوغ الرسائل القصيرة وواتساب ونصوص الاتصال لمستشار الخدمة." },
        kind: "drafter",
        writes: [{ en: "Drafted SMS/WhatsApp/call script", ar: "مسوّدة الرسائل ونص الاتصال" }],
      },
    ],
    edges: [
      { from: "telemetry-ingestor", to: "soh-predictor" },
      { from: "soh-predictor", to: "intervention-window-planner" },
      { from: "customer-graph-resolver", to: "outreach-drafter" },
      { from: "intervention-window-planner", to: "outreach-drafter" },
    ],
    humanCheckpoints: [
      {
        id: "service-advisor-sends",
        name: { en: "Service Advisor", ar: "مستشار الخدمة" },
        decision: {
          en: "Reviews and sends every outreach. Outreach is never auto-sent.",
          ar: "يراجع ويرسل كل تواصل. لا يُرسل التواصل تلقائياً أبداً.",
        },
      },
      {
        id: "aftermarket-head-approves-template",
        name: { en: "Head of Aftermarket", ar: "رئيس ما بعد البيع" },
        decision: {
          en: "Approves new outreach templates before they go live in the dealer network.",
          ar: "يوافق على قوالب التواصل الجديدة قبل تفعيلها في شبكة الوكلاء.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "telemetry-ingestor" },
      { kind: "agent", id: "soh-predictor" },
      { kind: "agent", id: "intervention-window-planner" },
      { kind: "agent", id: "customer-graph-resolver" },
      { kind: "agent", id: "outreach-drafter" },
      { kind: "human", id: "service-advisor-sends" },
      { kind: "human", id: "aftermarket-head-approves-template" },
    ],
    rationale: {
      en: "Telemetry ingestion, SOH prediction and outreach drafting are completely different skills — and the multi-brand customer graph is its own data problem. Chaining specialist agents lets each ship on its own cadence and lets the dealer swap any one of them.",
      ar: "استيعاب القياسات، والتنبؤ بصحة البطارية، وصياغة التواصل، مهارات مختلفة تماماً — ورسم العميل متعدّد العلامات مشكلة بيانات قائمة بذاتها. تسلسل وكلاء متخصّصين يتيح لكلٍّ منهم الإطلاق بوتيرته ويتيح للوكيل استبدال أيٍّ منهم.",
    },
  },

  // ─── 11. FP&A Rolling Forecast Agent ────────────────────────────────────
  "fpa-rolling-forecast": {
    agents: [
      {
        id: "actuals-ingestor",
        name: { en: "Actuals Ingestor", ar: "مستوعب الفعلي" },
        role: { en: "Ingests period actuals from ERP, revenue subledgers and the prior planning model.", ar: "يستوعب الفعلي من ERP ودفاتر الإيرادات الفرعية ونموذج التخطيط السابق." },
        kind: "retriever",
        reads: [
          { en: "ERP, revenue subledgers, prior planning model", ar: "ERP، دفاتر الإيرادات الفرعية، نموذج التخطيط السابق" },
        ],
        writes: [{ en: "Normalised actuals snapshot", ar: "لقطة فعلي موحّدة" }],
      },
      {
        id: "driver-recompiler",
        name: { en: "Driver Recompiler", ar: "مُعيد بناء المحركات" },
        role: { en: "Regenerates the forecast cone using the existing driver tree and actuals.", ar: "يعيد توليد مخروط التنبؤ باستخدام شجرة المحركات الحالية والفعلي." },
        kind: "scorer",
        writes: [
          { en: "Forecast cone with driver decomposition", ar: "مخروط تنبؤ مع تفكيك المحركات" },
        ],
      },
      {
        id: "variance-analyst",
        name: { en: "Variance Analyst", ar: "محلّل الانحرافات" },
        role: { en: "Drafts the variance commentary in the CFO's house style with citations to figures.", ar: "يصوغ تعليق الانحرافات بأسلوب المدير المالي مع مراجع للأرقام." },
        kind: "drafter",
        writes: [{ en: "Variance commentary draft", ar: "مسوّدة تعليق الانحرافات" }],
      },
      {
        id: "board-flagger",
        name: { en: "Board Flagger", ar: "رافع علم المجلس" },
        role: { en: "Picks the three things the board must see, with rationale and evidence.", ar: "يختار البنود الثلاثة التي يجب أن يراها المجلس مع التبرير والأدلّة." },
        kind: "router",
        writes: [{ en: "Top-three board flags", ar: "أهم ثلاثة بنود للمجلس" }],
      },
    ],
    edges: [
      { from: "actuals-ingestor", to: "driver-recompiler" },
      { from: "driver-recompiler", to: "variance-analyst" },
      { from: "variance-analyst", to: "board-flagger" },
    ],
    humanCheckpoints: [
      {
        id: "cfo-signs-commentary",
        name: { en: "CFO", ar: "المدير المالي" },
        decision: {
          en: "Retains the pen — edits the variance commentary and signs.",
          ar: "يحتفظ بالقلم — يحرّر تعليق الانحرافات ويوقّع.",
        },
      },
      {
        id: "fpa-lead-clears-flags",
        name: { en: "FP&A Lead", ar: "قائد التخطيط المالي" },
        decision: {
          en: "Reviews and clears the top-three flags before the board pack.",
          ar: "يراجع البنود الثلاثة ويُجيزها قبل حزمة المجلس.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "actuals-ingestor" },
      { kind: "agent", id: "driver-recompiler" },
      { kind: "agent", id: "variance-analyst" },
      { kind: "human", id: "cfo-signs-commentary" },
      { kind: "agent", id: "board-flagger" },
      { kind: "human", id: "fpa-lead-clears-flags" },
    ],
    rationale: {
      en: "Ingestion, driver math, narrative drafting and materiality routing are four different crafts. Keeping them as separate agents matches how a CFO actually splits work across an FP&A team — and means each one can be challenged on its own.",
      ar: "الاستيعاب، وحسابات المحركات، وصياغة الرواية، وتوجيه الجوهرية، أربع حِرف مختلفة. إبقاؤها وكلاء منفصلين يطابق توزيع المدير المالي للعمل في فريق التخطيط المالي — ويعني أن كل واحد منهم قابل للتحدّي على حدة.",
    },
  },

  // ─── 12. Customer Care Multi-Agent ──────────────────────────────────────
  "customer-care-multi-agent": {
    agents: [
      {
        id: "intent-router",
        name: { en: "Intent Router", ar: "موجِّه النوايا" },
        role: { en: "Classifies intent + dialect across voice, chat, WhatsApp and email.", ar: "يصنّف النية + اللهجة عبر الصوت والمحادثة وواتساب والبريد." },
        kind: "classifier",
        reads: [
          { en: "Live transcript (voice/chat/WhatsApp/email), CRM context", ar: "نص حيّ (صوت/محادثة/واتساب/بريد)، سياق CRM" },
        ],
        writes: [{ en: "Intent + dialect tag + channel", ar: "النية + وسم اللهجة + القناة" }],
      },
      {
        id: "resolution-agent",
        name: { en: "Resolution Agent", ar: "وكيل الحل" },
        role: { en: "Drafts the customer reply from knowledge-base articles and CRM context.", ar: "يصوغ ردّ العميل من مقالات قاعدة المعرفة وسياق CRM." },
        kind: "drafter",
        writes: [{ en: "Draft customer reply", ar: "مسوّدة ردّ العميل" }],
      },
      {
        id: "qa-critic",
        name: { en: "QA Critic", ar: "ناقد الجودة" },
        role: { en: "Audits every draft against house style, compliance rules and tone.", ar: "يدقّق كل مسوّدة مقابل أسلوب الشركة وقواعد الامتثال ونبرة الصوت." },
        kind: "critic",
        writes: [{ en: "Pass / fail with reasons", ar: "نجاح/إخفاق مع الأسباب" }],
      },
      {
        id: "cost-telemetry",
        name: { en: "Cost Telemetry", ar: "قياسات التكلفة" },
        role: { en: "Tracks cost-per-contact and CSAT prediction across every channel.", ar: "يتعقّب التكلفة لكل تواصل وتنبؤ رضا العملاء عبر القنوات." },
        kind: "monitor",
        writes: [
          { en: "Cost-per-contact telemetry", ar: "قياسات التكلفة لكل تواصل" },
          { en: "Predicted CSAT", ar: "تنبؤ برضا العملاء" },
        ],
      },
    ],
    edges: [
      { from: "intent-router", to: "resolution-agent" },
      { from: "resolution-agent", to: "qa-critic" },
      { from: "intent-router", to: "cost-telemetry" },
    ],
    humanCheckpoints: [
      {
        id: "care-agent-takes-over",
        name: { en: "Care Agent", ar: "موظّف الخدمة" },
        decision: {
          en: "Takes over when QA fails or the intent router fires a sensitive category.",
          ar: "يتولّى المحادثة عند إخفاق الجودة أو حين يرفع موجِّه النوايا فئة حسّاسة.",
        },
      },
      {
        id: "coach-reviews-failures",
        name: { en: "Team Leader / Coach", ar: "قائد الفريق / المدرّب" },
        decision: {
          en: "Reviews the QA failure log weekly and updates the house rules.",
          ar: "يراجع سجل إخفاقات الجودة أسبوعياً ويحدّث قواعد الشركة.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "intent-router" },
      { kind: "agent", id: "resolution-agent" },
      { kind: "agent", id: "qa-critic" },
      { kind: "human", id: "care-agent-takes-over" },
      { kind: "agent", id: "cost-telemetry" },
      { kind: "human", id: "coach-reviews-failures" },
    ],
    rationale: {
      en: "Routing, drafting, quality-checking and telemetry are independent skills — and the QA critic is what makes the topology deployable. Nothing reaches the customer without an auditable quality decision the care team can defend.",
      ar: "التوجيه، والصياغة، وفحص الجودة، والقياسات، مهارات مستقلّة — وناقد الجودة هو ما يجعل الهيكل قابلاً للنشر. لا شيء يصل إلى العميل دون قرار جودة قابل للتدقيق يدافع عنه فريق الخدمة.",
    },
  },

  // ─── 13. Sovereign Data Workbench ───────────────────────────────────────
  "sovereign-data-workbench": {
    agents: [
      {
        id: "schema-explorer",
        name: { en: "Schema Explorer", ar: "مستكشف المخطّط" },
        role: { en: "Maps source-system schemas and bilingual data dictionaries into a graph.", ar: "يضع مخطّطات أنظمة المصدر وقواميس البيانات الثنائية في رسم بياني." },
        kind: "retriever",
        reads: [
          { en: "Source-system schemas (legacy and modern)", ar: "مخطّطات أنظمة المصدر (الموروثة والحديثة)" },
          { en: "Data dictionaries (English and Arabic)", ar: "قواميس البيانات (إنجليزية وعربية)" },
        ],
        writes: [{ en: "Normalised schema graph", ar: "رسم مخطّط موحّد" }],
      },
      {
        id: "arabic-ner",
        name: { en: "Arabic NER", ar: "كاشف الكيانات العربية" },
        role: { en: "Tags PII and entities including Arabic-script names and addresses.", ar: "يوسم البيانات الشخصية والكيانات بما فيها الأسماء والعناوين بالحرف العربي." },
        kind: "classifier",
        writes: [{ en: "Entity / PII tags", ar: "وسوم الكيانات/البيانات الشخصية" }],
      },
      {
        id: "pipeline-drafter",
        name: { en: "Pipeline Drafter", ar: "كاتب خطّ الأنابيب" },
        role: { en: "Drafts a dbt-style SQL/Python pipeline against the target model.", ar: "يصوغ خط أنابيب بأسلوب dbt بـSQL/بايثون مقابل النموذج المستهدف." },
        kind: "drafter",
        writes: [{ en: "Drafted pipeline (SQL/Python)", ar: "مسوّدة خط أنابيب (SQL/بايثون)" }],
      },
      {
        id: "lineage-compiler",
        name: { en: "Lineage Compiler", ar: "مُجمّع نسب البيانات" },
        role: { en: "Compiles column-level lineage spanning source-of-truth back to the report.", ar: "يجمّع نسب البيانات على مستوى العمود من مصدر الحقيقة حتى التقرير." },
        kind: "compiler",
        writes: [{ en: "Column-level lineage graph", ar: "رسم نسب على مستوى الأعمدة" }],
      },
      {
        id: "quality-contract-drafter",
        name: { en: "Quality-Contract Drafter", ar: "كاتب عقد الجودة" },
        role: { en: "Drafts the data-quality contract — checks, owners, escalation, breach SLA.", ar: "يصوغ عقد جودة البيانات — الفحوصات والمسؤولين والتصعيد واتفاقية الخرق." },
        kind: "drafter",
        writes: [{ en: "Data-quality contract", ar: "عقد جودة البيانات" }],
      },
    ],
    edges: [
      { from: "schema-explorer", to: "arabic-ner" },
      { from: "schema-explorer", to: "pipeline-drafter" },
      { from: "pipeline-drafter", to: "lineage-compiler" },
      { from: "lineage-compiler", to: "quality-contract-drafter" },
    ],
    humanCheckpoints: [
      {
        id: "data-engineer-merges",
        name: { en: "Data Engineer", ar: "مهندس البيانات" },
        decision: {
          en: "Reviews, edits and merges every drafted pipeline. The agent never deploys.",
          ar: "يراجع ويحرّر ويدمج كل خط أنابيب مسوّد. لا ينشر الوكيل أبداً.",
        },
      },
      {
        id: "data-owner-signs-contract",
        name: { en: "Data Owner", ar: "مالك البيانات" },
        decision: {
          en: "Signs the quality contract before publish.",
          ar: "يوقّع عقد الجودة قبل النشر.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "schema-explorer" },
      { kind: "agent", id: "arabic-ner" },
      { kind: "agent", id: "pipeline-drafter" },
      { kind: "human", id: "data-engineer-merges" },
      { kind: "agent", id: "lineage-compiler" },
      { kind: "agent", id: "quality-contract-drafter" },
      { kind: "human", id: "data-owner-signs-contract" },
    ],
    rationale: {
      en: "Schema understanding, Arabic NER, pipeline drafting and lineage compilation are independent specialties. Chaining them keeps every step auditable inside the sovereign perimeter — and means the data engineer can intervene at exactly the step that needs human judgement.",
      ar: "فهم المخطّط، والتعرّف على الكيانات العربية، وصياغة خط الأنابيب، وتجميع نسب البيانات، تخصّصات مستقلّة. تسلسلها يبقي كل خطوة قابلة للتدقيق داخل النطاق السيادي — ويتيح لمهندس البيانات التدخّل في الخطوة الدقيقة التي تحتاج حكماً بشرياً.",
    },
  },

  // ─── 14. Knowledge Memory Agent ─────────────────────────────────────────
  "knowledge-memory-agent": {
    agents: [
      {
        id: "ingestor",
        name: { en: "Ingestor", ar: "المستوعب" },
        role: { en: "Ingests SharePoint, Confluence, Notion and mailboxes into the document graph.", ar: "يستوعب شيربوينت وConfluence ونوشن وصناديق البريد في رسم الوثائق." },
        kind: "retriever",
        reads: [
          { en: "SharePoint, Confluence, Notion, mailboxes", ar: "شيربوينت، Confluence، نوشن، صناديق البريد" },
        ],
        writes: [{ en: "Indexed document graph", ar: "رسم وثائق مفهرس" }],
      },
      {
        id: "permission-filter",
        name: { en: "Permission Filter", ar: "مرشّح الصلاحيات" },
        role: { en: "Filters the document graph against the asker's identity and classification rights.", ar: "يرشّح رسم الوثائق وفق هوية السائل وحقوق التصنيف." },
        kind: "router",
        reads: [{ en: "User identity, permission graph, classification labels", ar: "هوية المستخدم، رسم الصلاحيات، وسوم التصنيف" }],
        writes: [{ en: "Permitted document subset", ar: "مجموعة الوثائق المسموحة" }],
      },
      {
        id: "semantic-retriever",
        name: { en: "Semantic Retriever", ar: "مسترجع دلالي" },
        role: { en: "Retrieves the candidate passages for the query from the permitted subset.", ar: "يسترجع المقاطع المرشّحة للاستعلام من المجموعة المسموحة." },
        kind: "retriever",
        writes: [{ en: "Candidate passages", ar: "مقاطع مرشّحة" }],
      },
      {
        id: "grounded-drafter",
        name: { en: "Grounded Drafter", ar: "كاتب موثَّق" },
        role: { en: "Drafts the answer with inline citations to source document, page and last-updated date.", ar: "يصوغ الإجابة مع مراجع داخلية للوثيقة المصدرية والصفحة وتاريخ آخر تحديث." },
        kind: "drafter",
        writes: [{ en: "Cited answer", ar: "إجابة موثّقة" }],
      },
      {
        id: "coverage-monitor",
        name: { en: "Coverage Monitor", ar: "مراقب التغطية" },
        role: { en: "Tracks query hit-rate and surfaces knowledge domains that need human curation.", ar: "يتعقّب نسبة العثور ويبرز المجالات التي تحتاج تنسيقاً بشرياً." },
        kind: "monitor",
        writes: [{ en: "Source coverage map and gaps", ar: "خريطة تغطية المصادر والفجوات" }],
      },
    ],
    edges: [
      { from: "ingestor", to: "permission-filter" },
      { from: "permission-filter", to: "semantic-retriever" },
      { from: "semantic-retriever", to: "grounded-drafter" },
      { from: "ingestor", to: "coverage-monitor" },
    ],
    humanCheckpoints: [
      {
        id: "knowledge-steward-curates",
        name: { en: "Knowledge Steward", ar: "أمين المعرفة" },
        decision: {
          en: "Reviews coverage gaps weekly and assigns curation work.",
          ar: "يراجع فجوات التغطية أسبوعياً ويوزّع عمل التنسيق.",
        },
      },
      {
        id: "compliance-reviews-withholds",
        name: { en: "Compliance Reviewer", ar: "مراجع الامتثال" },
        decision: {
          en: "Reviews the withhold log to confirm the permission filter is calibrated correctly.",
          ar: "يراجع سجل الحجب للتأكد من ضبط مرشّح الصلاحيات.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "ingestor" },
      { kind: "agent", id: "permission-filter" },
      { kind: "agent", id: "semantic-retriever" },
      { kind: "agent", id: "grounded-drafter" },
      { kind: "agent", id: "coverage-monitor" },
      { kind: "human", id: "knowledge-steward-curates" },
      { kind: "human", id: "compliance-reviews-withholds" },
    ],
    rationale: {
      en: "Indexing, permission filtering, retrieval, drafting and coverage monitoring are distinct concerns. Bundling them into one model would lose the audit trail that makes the agent legally deployable in regulated environments.",
      ar: "الفهرسة، وترشيح الصلاحيات، والاسترجاع، والصياغة، ومراقبة التغطية، شؤون متمايزة. دمجها في نموذج واحد يُفقد مسار التدقيق الذي يجعل الوكيل قابلاً للنشر قانونياً في البيئات المنظَّمة.",
    },
  },
};

/** Returns the cast for a tool slug, or undefined if none registered. */
export function getAgentCast(slug: string): AgentCast | undefined {
  return marketplaceAgentCasts[slug];
}
