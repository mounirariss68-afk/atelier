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
  "programme-war-room": {
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

  // ─── 3. Tender Response Studio ───────────────────────────────────────
    "tender-response-studio": {
      agents: [
        {
          id: "bid-conductor",
          name: { en: "Bid Conductor", ar: "منسّق العطاء" },
          role: { en: "Plans the response, sequences the specialists, gates every checkpoint.", ar: "يخطّط الاستجابة، يرتّب الأخصائيين، ويراقب كل نقطة موافقة." },
          kind: "planner",
          reads: [{ en: "RFP / ITT, addenda, prior-bid library", ar: "كرّاسة الشروط، الملاحق، مكتبة العطاءات السابقة" }],
          writes: [{ en: "Bid plan, section assignments, checkpoint schedule", ar: "خطة العطاء، توزيع الأقسام، جدول الموافقات" }],
        },
        {
          id: "rfp-ingestor",
          name: { en: "RFP Ingestor", ar: "محلّل كرّاسة الشروط" },
          role: { en: "Parses the RFP into mandatory requirements, evaluation weights, and submission rules.", ar: "يحلّل كرّاسة الشروط إلى متطلبات إلزامية ومعايير تقييم وقواعد تقديم." },
          kind: "retriever",
          reads: [{ en: "RFP document set, addenda, Q&A logs", ar: "وثائق كرّاسة الشروط، الملاحق، سجلات الأسئلة والأجوبة" }],
          writes: [{ en: "Structured requirement matrix", ar: "مصفوفة متطلبات مهيكلة" }],
        },
        {
          id: "qualifier",
          name: { en: "Qualifier", ar: "المُقيّم" },
          role: { en: "Scores fit-to-win and capacity-to-deliver — recommends bid or no-bid with rationale.", ar: "يقيس ملاءمة الفوز والقدرة على التسليم — ويوصي بالتقديم أو الانسحاب مع التبرير." },
          kind: "scorer",
          writes: [{ en: "Bid/no-bid memo with score breakdown", ar: "مذكّرة قرار التقديم مع تفصيل الدرجات" }],
        },
        {
          id: "section-drafter",
          name: { en: "Section Drafters", ar: "كتّاب الأقسام" },
          role: { en: "Parallel lanes that draft technical, commercial, and governance sections to the bidder's house style.", ar: "مسارات متوازية تصوغ الأقسام التقنية والتجارية والحوكمة بأسلوب مقدّم العطاء." },
          kind: "drafter",
          writes: [{ en: "Per-section draft with citation trail", ar: "مسوّدة لكل قسم مع سلسلة مراجع" }],
        },
        {
          id: "pricing-modeller",
          name: { en: "Pricing Modeller", ar: "محاكي التسعير" },
          role: { en: "Builds the scenario range — base, aggressive, defensive — with margin and partner cost-share.", ar: "يبني نطاق سيناريوهات التسعير — أساسي، طموح، دفاعي — مع الهامش وتقاسم تكلفة الشريك." },
          kind: "scorer",
          writes: [{ en: "Pricing scenario pack", ar: "حزمة سيناريوهات التسعير" }],
        },
        {
          id: "partner-outreach",
          name: { en: "Partner Outreach", ar: "تواصل الشركاء" },
          role: { en: "Drafts LOI and cost-card requests to subcontractors and consortium partners.", ar: "يصوغ خطابات النوايا وطلبات بطاقات التكلفة للمقاولين من الباطن وشركاء التحالف." },
          kind: "compiler",
          writes: [{ en: "Outbound partner asks, captured responses", ar: "طلبات صادرة للشركاء، ردود مُلتقطة" }],
        },
        {
          id: "legal-reviewer",
          name: { en: "Legal Reviewer", ar: "المراجع القانوني" },
          role: { en: "Red-teams every drafted section and the pricing pack against the legal clause library.", ar: "يراجع جميع الأقسام المسوّدة وحزمة التسعير مقابل مكتبة البنود القانونية." },
          kind: "critic",
          writes: [{ en: "Legal flags and required edits", ar: "ملاحظات قانونية وتعديلات مطلوبة" }],
        },
        {
          id: "packet-compiler",
          name: { en: "Packet Compiler", ar: "مُجمّع الحزمة" },
          role: { en: "Stitches cover letter, sections, pricing, legal annexes, and partner LOIs into the final submission packet.", ar: "يجمع خطاب التغطية والأقسام والتسعير والملاحق القانونية ورسائل النوايا في حزمة التقديم النهائية." },
          kind: "compiler",
          writes: [{ en: "Final submission packet (PDF + appendices)", ar: "حزمة التقديم النهائية (PDF + ملاحق)" }],
        },
      ],
      edges: [
        { from: "bid-conductor", to: "rfp-ingestor" },
        { from: "rfp-ingestor", to: "qualifier" },
        { from: "qualifier", to: "section-drafter" },
        { from: "qualifier", to: "pricing-modeller" },
        { from: "qualifier", to: "partner-outreach" },
        { from: "section-drafter", to: "legal-reviewer" },
        { from: "pricing-modeller", to: "legal-reviewer" },
        { from: "partner-outreach", to: "legal-reviewer" },
        { from: "legal-reviewer", to: "packet-compiler" },
      ],
      humanCheckpoints: [
        {
          id: "bid-no-bid",
          name: { en: "Bid Director", ar: "مدير العطاءات" },
          decision: {
            en: "Reads the Qualifier's bid/no-bid memo and decides whether to commit the team to a full response.",
            ar: "يقرأ مذكّرة التقييم ويقرّر ما إذا كان الفريق سيلتزم بصياغة استجابة كاملة.",
          },
        },
        {
          id: "pricing-signoff",
          name: { en: "CFO", ar: "المدير المالي" },
          decision: {
            en: "Selects the pricing scenario and signs off on margin before the price enters the packet.",
            ar: "يختار سيناريو التسعير ويوقّع على الهامش قبل دخول السعر إلى الحزمة.",
          },
        },
        {
          id: "legal-release",
          name: { en: "General Counsel", ar: "المستشار العام" },
          decision: {
            en: "Clears the final packet for submission after reviewing the Legal Reviewer's flags.",
            ar: "يجيز الحزمة النهائية للتقديم بعد مراجعة ملاحظات المراجع القانوني.",
          },
        },
      ],
      flowOrder: [
        { kind: "agent", id: "bid-conductor" },
        { kind: "agent", id: "rfp-ingestor" },
        { kind: "agent", id: "qualifier" },
        { kind: "human", id: "bid-no-bid" },
        { kind: "agent", id: "section-drafter" },
        { kind: "agent", id: "pricing-modeller" },
        { kind: "human", id: "pricing-signoff" },
        { kind: "agent", id: "partner-outreach" },
        { kind: "agent", id: "legal-reviewer" },
        { kind: "human", id: "legal-release" },
        { kind: "agent", id: "packet-compiler" },
      ],
      rationale: {
        en: "A mega-tender response cannot be one prompt. Parsing the RFP, qualifying the opportunity, drafting parallel sections, modelling pricing, courting partners, and red-teaming legal are six different skills with three different signers. Splitting the work makes every output auditable, lets specialist agents run in parallel, and keeps human authority exactly where the bidder needs it — at bid/no-bid, pricing, and legal release.",
        ar: "لا يمكن أن تكون الاستجابة لمناقصة كبرى مطالبة واحدة. تحليل كرّاسة الشروط، وتأهيل الفرصة، وصياغة أقسام متوازية، ونمذجة التسعير، وتجنيد الشركاء، ومراجعة الجوانب القانونية ست مهارات مختلفة بثلاث جهات تواقيع. تقسيم العمل يجعل كل مخرج قابلاً للتدقيق، ويتيح للوكلاء المتخصّصين العمل بالتوازي، ويحفظ السلطة البشرية حيث يحتاجها مقدّم العطاء — عند قرار التقديم والتسعير والإفراج القانوني.",
      },
    },

    // ─── 3. Sovereign Citizen Services Agent ────────────────────────────────
  "citizen-services-concierge": {
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
  "procurement-negotiation-agent": {
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
  "network-ops-war-room": {
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
  "sama-compliance-sentinel": {
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

  // ─── 12. Customer Care Multi-Agent ──────────────────────────────────────
  "customer-care-hive": {
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
  "sovereign-data-steward": {
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
  "enterprise-knowledge-concierge": {
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

  // ─── 15. Arçelik Pricing Intelligence ─────────────────────────────────
  "arcelik-fiyat-istihbarati": {
    agents: [
      {
        id: "pricing-orchestrator",
        name: { en: "Fiyatlandırma Orkestratörü", ar: "Fiyatlandırma Orkestratörü" },
        role: { en: "Plans the pricing run, dispatches specialist agents, and gates every human checkpoint.", ar: "Plans the pricing run, dispatches specialist agents, and gates every human checkpoint." },
        kind: "planner",
        reads: [{ en: "Workflow trigger, pricing calendar, agent status", ar: "Workflow trigger, pricing calendar, agent status" }],
        writes: [{ en: "Run plan, agent assignments, checkpoint schedule", ar: "Run plan, agent assignments, checkpoint schedule" }],
      },
      {
        id: "price-monitor",
        name: { en: "Fiyat İzleme Ajanı", ar: "Fiyat İzleme Ajanı" },
        role: { en: "Scrapes competitor prices across 8 brands, 80+ product SKUs, and multiple retail channels.", ar: "Scrapes competitor prices across 8 brands, 80+ product SKUs, and multiple retail channels." },
        kind: "monitor",
        reads: [{ en: "Competitor websites, retail aggregators, dealer field reports", ar: "Competitor websites, retail aggregators, dealer field reports" }],
        writes: [{ en: "Competitor price matrix with trend data", ar: "Competitor price matrix with trend data" }],
      },
      {
        id: "competitor-analyst",
        name: { en: "Rakip Analiz Ajanı", ar: "Rakip Analiz Ajanı" },
        role: { en: "Analyses competitive positioning, price gaps, and recommends optimal pricing per city × category.", ar: "Analyses competitive positioning, price gaps, and recommends optimal pricing per city × category." },
        kind: "scorer",
        reads: [{ en: "Competitor price matrix, demand signals, margin targets", ar: "Competitor price matrix, demand signals, margin targets" }],
        writes: [{ en: "Price recommendations, competitive position score", ar: "Price recommendations, competitive position score" }],
      },
      {
        id: "demand-forecaster",
        name: { en: "Talep Tahmin Ajanı", ar: "Talep Tahmin Ajanı" },
        role: { en: "Forecasts demand by city and category using seasonal patterns, events, and search trends.", ar: "Forecasts demand by city and category using seasonal patterns, events, and search trends." },
        kind: "retriever",
        reads: [{ en: "Sales history, seasonal patterns, search trends, event calendar", ar: "Sales history, seasonal patterns, search trends, event calendar" }],
        writes: [{ en: "City × category demand forecast, demand signal heatmap", ar: "City × category demand forecast, demand signal heatmap" }],
      },
      {
        id: "campaign-strategist",
        name: { en: "Kampanya Stratejisti", ar: "Kampanya Stratejisti" },
        role: { en: "Generates campaign briefs with creative copy, target cities, projected ROI, and dealer POS materials.", ar: "Generates campaign briefs with creative copy, target cities, projected ROI, and dealer POS materials." },
        kind: "drafter",
        reads: [{ en: "Price recommendations, demand forecast, campaign templates, brand guidelines", ar: "Price recommendations, demand forecast, campaign templates, brand guidelines" }],
        writes: [{ en: "Campaign brief with creative, projected ROI, dealer materials", ar: "Campaign brief with creative, projected ROI, dealer materials" }],
      },
      {
        id: "dealer-network-mgr",
        name: { en: "Bayi Ağı Yöneticisi", ar: "Bayi Ağı Yöneticisi" },
        role: { en: "Pushes approved pricing and campaign materials to 3,000+ dealers, monitors compliance.", ar: "Pushes approved pricing and campaign materials to 3,000+ dealers, monitors compliance." },
        kind: "compiler",
        reads: [{ en: "Approved price lists, campaign materials, dealer profiles", ar: "Approved price lists, campaign materials, dealer profiles" }],
        writes: [{ en: "Dealer price updates, SMS/WhatsApp notifications, compliance report", ar: "Dealer price updates, SMS/WhatsApp notifications, compliance report" }],
      },
    ],
    edges: [
      { from: "pricing-orchestrator", to: "price-monitor" },
      { from: "pricing-orchestrator", to: "demand-forecaster" },
      { from: "price-monitor", to: "competitor-analyst" },
      { from: "demand-forecaster", to: "competitor-analyst" },
      { from: "competitor-analyst", to: "campaign-strategist" },
      { from: "campaign-strategist", to: "dealer-network-mgr" },
    ],
    humanCheckpoints: [
      {
        id: "pricing-director-approves",
        name: { en: "Fiyatlandırma Direktörü", ar: "Fiyatlandırma Direktörü" },
        decision: {
          en: "Reviews and approves recommended price changes before they are pushed to the dealer network. The agent never changes a price without this sign-off.",
          ar: "Reviews and approves recommended price changes before they are pushed to the dealer network. The agent never changes a price without this sign-off.",
        },
      },
      {
        id: "marketing-director-approves",
        name: { en: "Pazarlama Direktörü", ar: "Pazarlama Direktörü" },
        decision: {
          en: "Reviews and approves campaign creative, messaging, and budget allocation before launch. The agent never publishes a campaign without this gate.",
          ar: "Reviews and approves campaign creative, messaging, and budget allocation before launch. The agent never publishes a campaign without this gate.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "pricing-orchestrator" },
      { kind: "agent", id: "price-monitor" },
      { kind: "agent", id: "demand-forecaster" },
      { kind: "agent", id: "competitor-analyst" },
      { kind: "human", id: "pricing-director-approves" },
      { kind: "agent", id: "campaign-strategist" },
      { kind: "human", id: "marketing-director-approves" },
      { kind: "agent", id: "dealer-network-mgr" },
    ],
    rationale: {
      en: "Price monitoring, demand forecasting, competitive analysis, campaign strategy, and dealer coordination are five fundamentally different skills with different data sources. Splitting them lets each agent be auditable on its own, lets the pricing director intervene at exactly the right step, and means the marketing director signs off on creative separately from pricing — which is how Arçelik's organisation actually works.",
      ar: "مراقبة الأسعار والتنبؤ بالطلب والتحليل التنافسي واستراتيجية الحملات وتنسيق الوكلاء خمس مهارات مختلفة جذرياً بمصادر بيانات مختلفة. تقسيمها يتيح تدقيق كل وكيل على حدة، ويتيح لمدير التسعير التدخّل في الخطوة الصحيحة، ويعني أن مدير التسويق يوافق على الإبداع منفصلاً عن التسعير — وهذا ما يحدث فعلاً في هيكل أرتشيليك.",
    },
  },

  // ─── 16. Tasama Payroll Intelligence Hub ──────────────────────────────
  "tasama-payroll-hub": {
    agents: [
      {
        id: "payroll-orchestrator",
        name: { en: "Payroll Orchestrator", ar: "منسّق الرواتب" },
        role: { en: "Plans the monthly payroll cycle, dispatches the 9 specialist agents, gates the 3 human checkpoints, and maintains the full audit trail across all clients.", ar: "يخطط دورة الرواتب الشهرية، ويُوزع المهام على الوكلاء التسعة المتخصصين، ويُدير نقاط المراجعة البشرية الثلاث، ويحتفظ بمسار التدقيق الكامل عبر جميع العملاء." },
        kind: "planner",
        reads: [{ en: "Payroll calendar, client roster, agent status, regulatory deadlines", ar: "تقويم الرواتب، وقائمة العملاء، وحالة الوكلاء، والمواعيد التنظيمية" }],
        writes: [{ en: "Cycle plan, agent assignments, human checkpoint queue, run audit log", ar: "خطة الدورة، وتعيينات الوكلاء، وقائمة نقاط المراجعة البشرية، وسجل تدقيق الدورة" }],
      },
      {
        id: "document-intelligence",
        name: { en: "Document Intelligence Agent", ar: "وكيل ذكاء الوثائق" },
        role: { en: "Extracts structured data (employee details, contract terms, salary, dates, signatures) from contracts, letters and HR documents with field-level confidence scores.", ar: "يستخرج البيانات المهيكلة (تفاصيل الموظف، شروط العقد، الراتب، التواريخ، التوقيعات) من العقود والرسائل ووثائق الموارد البشرية مع درجات ثقة على مستوى الحقل." },
        kind: "retriever",
        reads: [{ en: "Uploaded PDF documents (employment contracts, termination letters, salary letters, certificates)", ar: "وثائق PDF المرفوعة (عقود العمل، ورسائل إنهاء الخدمة، ورسائل الرواتب، والشهادات)" }],
        writes: [{ en: "Structured fields with per-field confidence scores, document classification, extraction audit", ar: "حقول مهيكلة مع درجات ثقة لكل حقل، وتصنيف الوثيقة، وتدقيق الاستخراج" }],
      },
      {
        id: "salary-calculation",
        name: { en: "Salary Calculation Agent", ar: "وكيل حساب الرواتب" },
        role: { en: "Computes gross-to-net for every employee: basic + housing + transport + allowances + overtime + bonuses, minus GOSI deductions and other deductions, with retroactive adjustments.", ar: "يحسب الإجمالي للصافي لكل موظف: الأساسي + السكن + النقل + البدلات + الإضافي + المكافآت، ناقص خصومات التأمينات والخصومات الأخرى، مع التعديلات بأثر رجعي." },
        kind: "scorer",
        reads: [{ en: "Salary components, attendance, leave records, overtime logs, bonus letters, salary increase letters", ar: "مكونات الراتب، والحضور، وسجلات الإجازات، وسجلات العمل الإضافي، ورسائل المكافآت، ورسائل زيادة الراتب" }],
        writes: [{ en: "Per-employee payslip with full breakdown, total payroll cost per client, exception list", ar: "كشف راتب لكل موظف مع تفصيل كامل، وإجمالي تكلفة الرواتب لكل عميل، وقائمة الاستثناءات" }],
      },
      {
        id: "gosi-compliance",
        name: { en: "GOSI Compliance Agent", ar: "وكيل امتثال التأمينات" },
        role: { en: "Calculates GOSI contributions (Saudi: 12% employer + 10% employee annuity; All: 2% OHRP employer; Non-Saudi: OHRP only) and generates the monthly GOSI filing file.", ar: "يحسب اشتراكات التأمينات (السعوديون: 12% صاحب العمل + 10% الموظف للتقاعد؛ الجميع: 2% OHRP صاحب العمل؛ غير السعوديين: OHRP فقط) وينتج ملف التقديم الشهري للتأمينات." },
        kind: "scorer",
        reads: [{ en: "Employee nationality, basic + housing salary base, GOSI registration status", ar: "جنسية الموظف، وقاعدة راتب الأساسي + السكن، وحالة التسجيل في التأمينات" }],
        writes: [{ en: "GOSI contribution records per employee, GOSI monthly filing file, deadline alerts", ar: "سجلات اشتراك التأمينات لكل موظف، وملف التقديم الشهري للتأمينات، وتنبيهات المواعيد" }],
      },
      {
        id: "mudad-bank-transfer",
        name: { en: "Mudad Bank Transfer Agent", ar: "وكيل تحويلات مُدد البنكية" },
        role: { en: "Generates Mudad-compliant wage protection files with employee IBANs and net salaries, submits to MOHRS-registered banks, and reconciles rejections.", ar: "ينشئ ملفات حماية الأجور المتوافقة مع مُدد مع آيبان الموظفين وصافي الرواتب، ويرسلها للبنوك المسجلة لدى الموارد البشرية، ويسوّي الرفوضات." },
        kind: "compiler",
        reads: [{ en: "Approved payslips, employee IBAN data, payment date, Mudad bank registry", ar: "كشوف الرواتب المعتمدة، وبيانات آيبان الموظفين، وتاريخ الدفع، وسجل بنوك مُدد" }],
        writes: [{ en: "Mudad submission file, payment status per employee, rejection reconciliation log", ar: "ملف تقديم مُدد، وحالة الدفع لكل موظف، وسجل تسوية الرفوضات" }],
      },
      {
        id: "eosb-provision",
        name: { en: "EOSB Provision Agent", ar: "وكيل مخصصات نهاية الخدمة" },
        role: { en: "Accrues End-of-Service Benefit provisions monthly per employee under Article 84, and computes final settlements (EOSB + leave encashment + remaining salary) on separation.", ar: "يستحقّ مخصصات نهاية الخدمة شهرياً لكل موظف وفق المادة 84، ويحسب التسويات النهائية (نهاية الخدمة + صرف الإجازات + الراتب المتبقي) عند الانفصال." },
        kind: "scorer",
        reads: [{ en: "Years of service, last basic + housing, separation type, contract type", ar: "سنوات الخدمة، والأساسي + السكن الأخير، ونوع الانفصال، ونوع العقد" }],
        writes: [{ en: "Monthly EOSB accrual per employee, cumulative provision, final settlement statements", ar: "استحقاق نهاية الخدمة الشهري لكل موظف، والمخصصات التراكمية، وكشوف التسوية النهائية" }],
      },
      {
        id: "leave-management",
        name: { en: "Leave Management Agent", ar: "وكيل إدارة الإجازات" },
        role: { en: "Tracks annual / sick / maternity / paternity / Hajj / Iddah leave balances, processes leave requests, and computes vacation salary advances.", ar: "يتتبع أرصدة الإجازات السنوية والمرضية والأمومة والأبوة والحج والعدة، ويعالج طلبات الإجازات، ويحسب مقدمات راتب الإجازة." },
        kind: "scorer",
        reads: [{ en: "Leave requests, attendance, Saudi labour law leave entitlements, employee tenure", ar: "طلبات الإجازات، والحضور، واستحقاقات الإجازات في نظام العمل السعودي، ومدة خدمة الموظف" }],
        writes: [{ en: "Updated leave balances, vacation salary advance amounts, leave approval recommendations", ar: "أرصدة إجازات محدّثة، ومبالغ مقدم راتب الإجازة، وتوصيات اعتماد الإجازات" }],
      },
      {
        id: "saudization-monitor",
        name: { en: "Saudization Monitor Agent", ar: "وكيل مراقبة السعودة" },
        role: { en: "Tracks Saudization ratios per client against Nitaqat bands (Platinum / Green-High/Mid/Low / Yellow / Red), forecasts band changes, and recommends actions to maintain or improve standing.", ar: "يتتبع نسب السعودة لكل عميل مقابل نطاقات نطاقات (بلاتيني / أخضر مرتفع/متوسط/منخفض / أصفر / أحمر)، ويتنبأ بتغيرات النطاق، ويوصي بإجراءات للحفاظ على المستوى أو تحسينه." },
        kind: "monitor",
        reads: [{ en: "Employee nationality, Saudi minimum-wage compliance (SAR 4,000), MOHRS Nitaqat thresholds", ar: "جنسية الموظف، وقاعدة راتب الأساسي + السكن، وعتبات نطاقات في الموارد البشرية" }],
        writes: [{ en: "Per-client Saudization ratio + band, forecast trajectory, action recommendations", ar: "نسبة السعودة لكل عميل + النطاق، ومسار التوقعات، وتوصيات الإجراءات" }],
      },
      {
        id: "performance-audit",
        name: { en: "Performance & Audit Agent", ar: "وكيل الأداء والتدقيق" },
        role: { en: "Scores every other agents accuracy, speed, autonomy, and confidence calibration; flags drift; and generates per-cycle audit packs for compliance review.", ar: "يصنّف دقة وسرعة واستقلالية ومعايرة ثقة كل وكيل آخر؛ ويرصد الانحراف؛ وينشئ حزم تدقيق لكل دورة لمراجعة الامتثال." },
        kind: "monitor",
        reads: [{ en: "Agent decision history, human override rates, latency metrics, error logs, confidence scores", ar: "سجل قرارات الوكلاء، ومعدلات تجاوز البشر، ومقاييس زمن الاستجابة، وسجلات الأخطاء، ودرجات الثقة" }],
        writes: [{ en: "Per-agent scorecards, drift alerts, audit packs, calibration curves", ar: "بطاقات أداء لكل وكيل، وتنبيهات الانحراف، وحزم التدقيق، ومنحنيات المعايرة" }],
      },
      {
        id: "client-communications",
        name: { en: "Client Communications Agent", ar: "وكيل اتصالات العملاء" },
        role: { en: "Drafts client-facing communications: payroll-run summaries, settlement statements, regulatory deadline reminders, and personalised AI insights for each client portal.", ar: "يصوغ المراسلات للعملاء: ملخصات دورة الرواتب، وكشوف التسويات، وتذكيرات المواعيد التنظيمية، ورؤى ذكاء اصطناعي مخصصة لبوابة كل عميل." },
        kind: "drafter",
        reads: [{ en: "Approved payroll runs, client preferences, language (EN/AR), employee events, calendar deadlines", ar: "دورات الرواتب المعتمدة، وتفضيلات العميل، واللغة (إن/ع)، وأحداث الموظفين، ومواعيد التقويم" }],
        writes: [{ en: "Client emails (bilingual), portal notifications, AI insight cards, client-specific recommendations", ar: "بريد العملاء (ثنائي اللغة)، وإشعارات البوابة، وبطاقات الرؤى الذكية، وتوصيات خاصة بالعميل" }],
      },
    ],
    edges: [
      { from: "payroll-orchestrator", to: "document-intelligence" },
      { from: "payroll-orchestrator", to: "leave-management" },
      { from: "payroll-orchestrator", to: "saudization-monitor" },
      { from: "document-intelligence", to: "salary-calculation" },
      { from: "leave-management", to: "salary-calculation" },
      { from: "salary-calculation", to: "gosi-compliance" },
      { from: "salary-calculation", to: "eosb-provision" },
      { from: "gosi-compliance", to: "mudad-bank-transfer" },
      { from: "salary-calculation", to: "mudad-bank-transfer" },
      { from: "mudad-bank-transfer", to: "client-communications" },
      { from: "saudization-monitor", to: "client-communications" },
      { from: "payroll-orchestrator", to: "performance-audit" },
      { from: "performance-audit", to: "client-communications" },
    ],
    humanCheckpoints: [
      {
        id: "payroll-manager-approves-run",
        name: { en: "Payroll Manager", ar: "مدير الرواتب" },
        decision: {
          en: "Reviews the calculated payroll run for each client (gross totals, exceptions, retroactive adjustments) and approves it before bank transfer. The agent never settles a run without this sign-off.",
          ar: "يراجع دورة الرواتب المحسوبة لكل عميل (الإجماليات، والاستثناءات، والتعديلات بأثر رجعي) ويعتمدها قبل التحويل البنكي. الوكيل لا يسوّي أي دورة دون هذا الاعتماد.",
        },
      },
      {
        id: "finance-controller-approves-settlements",
        name: { en: "Finance Controller", ar: "المراقب المالي" },
        decision: {
          en: "Reviews and authorises final settlement statements (EOSB + leave encashment + remaining salary) for separated employees. Material settlements above SAR 50,000 require this gate.",
          ar: "يراجع ويعتمد كشوف التسوية النهائية (نهاية الخدمة + صرف الإجازات + الراتب المتبقي) للموظفين المنفصلين. التسويات الجوهرية فوق 50,000 ريال تتطلب هذه البوابة.",
        },
      },
      {
        id: "compliance-officer-signs-submissions",
        name: { en: "Compliance Officer", ar: "ضابط الامتثال" },
        decision: {
          en: "Reviews and digitally signs every regulatory submission (GOSI monthly filing, Mudad wage protection file, Saudization corrective actions) before they are sent to MOHRS or GOSI.",
          ar: "يراجع ويوقع رقمياً كل تقديم تنظيمي (التقديم الشهري للتأمينات، وملف حماية الأجور عبر مُدد، وإجراءات تصحيح السعودة) قبل إرسالها للموارد البشرية أو التأمينات.",
        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "payroll-orchestrator" },
      { kind: "agent", id: "document-intelligence" },
      { kind: "agent", id: "leave-management" },
      { kind: "agent", id: "saudization-monitor" },
      { kind: "agent", id: "salary-calculation" },
      { kind: "human", id: "payroll-manager-approves-run" },
      { kind: "agent", id: "gosi-compliance" },
      { kind: "agent", id: "eosb-provision" },
      { kind: "human", id: "finance-controller-approves-settlements" },
      { kind: "agent", id: "mudad-bank-transfer" },
      { kind: "human", id: "compliance-officer-signs-submissions" },
      { kind: "agent", id: "performance-audit" },
      { kind: "agent", id: "client-communications" },
    ],
    rationale: {
      en: "KSA/UAE payroll and GOSI/Mudad compliance is a high-stakes domain where accuracy and human-in-the-loop auditability are non-negotiable. Splitting the logic into 10 specialist agents (Document Intelligence, Calculation, GOSI, Mudad, etc.) ensures that each part of the regulatory machine is auditable, drift-monitored, and gated by the appropriate human authority — mirroring the organisation of a professional shared-services centre.",
      ar: "يُعد نظام الرواتب في السعودية والإمارات والامتثال للتأمينات ومُدد مجالاً عالي المخاطر حيث تُعد الدقة وقابلية التدقيق البشري أمراً غير قابل للتفاوض. تقسيم المنطق إلى 10 وكلاء متخصصين (ذكاء الوثائق، الحساب، التأمينات، مُدد، إلخ) يضمن أن كل جزء من الآلة التنظيمية قابل للتدقيق، ومراقب من حيث الانحراف، وتحت رقابة السلطة البشرية المناسبة — مما يعكس تنظيم مركز الخدمات المشتركة الاحترافي.",
    },
  },
  // ─── 12. Maven Personal Agent (Workforce / Personal Agent) ─────────────
  "maven-personal-agent": {
    agents: [
      {
        id: "personal-planner",
        name: { en: "Personal Planner", ar: "المخطّط الشخصي", tr: "Kişisel Planlayıcı" },
        role: {
          en: "The named per-employee planner (Atlas for Sales, Ember for HR). Reads the day's calendar, inbox, tasks and the Personal Context Graph, then dispatches sub-agents to do the work.",
          ar: "المخطّط المسمّى الخاص بكل موظف (أطلس للمبيعات، إمبر للموارد البشرية). يقرأ تقويم اليوم والصندوق والمهام ورسم السياق الشخصي، ثم يوزّع المهام على الوكلاء الفرعيين.",
          tr: "Çalışana özel adlandırılmış planlayıcı (Satış için Atlas, İK için Ember). Günün takvimini, gelen kutusunu, görevleri ve Kişisel Bağlam Grafiği'ni okur, ardından alt-ajanlara iş dağıtır.",
        },
        kind: "planner",
        reads: [{ en: "Calendar, inbox, tasks, PCG", ar: "التقويم، البريد، المهام، الرسم", tr: "Takvim, gelen kutusu, görevler, PCG" }],
        writes: [{ en: "Daily plan, sub-agent dispatches, glass-box receipts", ar: "خطة اليوم، توزيع الوكلاء، إيصالات شفّافة", tr: "Günlük plan, alt-ajan görevleri, cam-kutu makbuzları" }],
      },
      {
        id: "observation-extractor",
        name: { en: "Observation Extractor", ar: "مستخرج الملاحظات", tr: "Gözlem Çıkarıcı" },
        role: {
          en: "Listens to meeting transcripts, emails, chat threads and document edits. Extracts entities, preferences and relationships, then proposes new PCG nodes.",
          ar: "يستمع لنسخ الاجتماعات والبريد ومحادثات الدردشة وتعديلات الوثائق. يستخرج الكيانات والتفضيلات والعلاقات ويقترح عقد رسم جديدة.",
          tr: "Toplantı transkriptlerini, e-postaları, sohbet konularını ve doküman düzenlemelerini dinler. Varlıkları, tercihleri ve ilişkileri çıkarır ve yeni PCG düğümleri önerir.",
        },
        kind: "classifier",
        reads: [{ en: "Transcripts, mail, chat, docs", ar: "النسخ، البريد، الدردشة، الوثائق", tr: "Transkriptler, e-posta, sohbet, dokümanlar" }],
        writes: [{ en: "Proposed PCG nodes & edges", ar: "عقد ورؤوس مقترحة", tr: "Önerilen PCG düğümleri ve kenarları" }],
      },
      {
        id: "graph-curator",
        name: { en: "Graph Curator", ar: "أمين الرسم", tr: "Grafik Küratörü" },
        role: {
          en: "Owns the Personal Context Graph: dedupes, scores confidence, decays stale facts, resolves contradictions, tags scope (work vs personal).",
          ar: "يدير رسم السياق الشخصي: يزيل التكرار ويصنّف الثقة ويُلاشي القديم ويحلّ التناقض ويصنّف النطاق (عمل/شخصي).",
          tr: "Kişisel Bağlam Grafiği'nin sahibi: tekrarları temizler, güveni puanlar, eskiyenleri zayıflatır, çelişkileri çözer, kapsam (iş/kişisel) etiketler.",
        },
        kind: "compiler",
        reads: [{ en: "Proposed nodes, current PCG, employee corrections", ar: "العقد المقترحة، الرسم الحالي، تصحيحات الموظف", tr: "Önerilen düğümler, mevcut PCG, çalışan düzeltmeleri" }],
        writes: [{ en: "Authoritative PCG state", ar: "الحالة المرجعية للرسم", tr: "Yetkili PCG durumu" }],
      },
      {
        id: "context-retriever",
        name: { en: "Context Retriever", ar: "مسترجع السياق", tr: "Bağlam Getirici" },
        role: {
          en: "For every chat turn or autonomous task, picks the smallest sufficient subset of PCG nodes (graph traversal + embedding match) and hands them to the planner as the grounding bundle.",
          ar: "لكل دورة محادثة أو مهمة آلية، يختار أصغر مجموعة كافية من عقد الرسم ويسلّمها للمخطّط كحزمة تأصيل.",
          tr: "Her sohbet sırası veya özerk görev için PCG düğümlerinin yeterli en küçük alt kümesini seçer ve planlayıcıya temellendirme paketi olarak verir.",
        },
        kind: "retriever",
        reads: [{ en: "PCG, current intent, recent activity", ar: "الرسم، النية الحالية، النشاط الأخير", tr: "PCG, mevcut niyet, son etkinlik" }],
        writes: [{ en: "Grounding bundle (top-N nodes)", ar: "حزمة تأصيل (أعلى N عقد)", tr: "Temellendirme paketi (ilk N düğüm)" }],
      },
      {
        id: "drafter",
        name: { en: "Drafter", ar: "الكاتب", tr: "Taslakçı" },
        role: {
          en: "Drafts the artefact the human would otherwise type — emails, follow-ups, offer letters, FAQs, briefs — grounded in the retrieved PCG nodes and the persona's voice.",
          ar: "يصوغ الناتج الذي كان البشر سيكتبونه — رسائل، متابعات، خطابات عرض، أسئلة شائعة، موجزات — مؤصّلاً بعقد الرسم وأسلوب الشخص.",
          tr: "İnsanın yazacağı çıktıyı taslak olarak hazırlar — e-postalar, takipler, teklif mektupları, SSS'ler, brifingler — getirilen PCG düğümlerine ve kişinin sesine dayalı olarak.",
        },
        kind: "drafter",
        reads: [{ en: "Grounding bundle, persona voice profile", ar: "حزمة التأصيل، ملف أسلوب الشخص", tr: "Temellendirme paketi, kişi ses profili" }],
        writes: [{ en: "Drafts pending approval", ar: "مسودات بانتظار الموافقة", tr: "Onay bekleyen taslaklar" }],
      },
      {
        id: "autonomy-gate",
        name: { en: "Autonomy Gate", ar: "بوابة الاستقلالية", tr: "Özerklik Kapısı" },
        role: {
          en: "Enforces the per-capability autonomy ladder (L0 informational → L4 fully autonomous). Routes every action to either auto-execute, propose-with-undo, or ask-the-human-first.",
          ar: "يطبّق سلّم الاستقلالية لكل قدرة (L0 معلوماتي → L4 ذاتي بالكامل). يوجّه كل إجراء إلى تنفيذ آلي، أو اقتراح مع تراجع، أو سؤال البشري أولاً.",
          tr: "Her yetenek için özerklik merdivenini uygular (L0 bilgi → L4 tamamen özerk). Her eylemi ya otomatik yürütmeye, ya geri-al ile öneriye, ya da önce-insana-sor'a yönlendirir.",
        },
        kind: "router",
        reads: [{ en: "Action proposal, autonomy policy, scope", ar: "اقتراح الإجراء، سياسة الاستقلالية، النطاق", tr: "Eylem önerisi, özerklik politikası, kapsam" }],
        writes: [{ en: "Routed action with audit receipt", ar: "إجراء موجّه مع إيصال تدقيق", tr: "Denetim makbuzlu yönlendirilmiş eylem" }],
      },
      {
        id: "receipt-keeper",
        name: { en: "Receipt Keeper", ar: "أمين الإيصالات", tr: "Makbuz Kayıtçısı" },
        role: {
          en: "Writes the glass-box receipt for every autonomous action: what was done, which PCG nodes informed it, the confidence, the value (time saved), and a one-click undo.",
          ar: "يكتب الإيصال الشفّاف لكل إجراء آلي: ما تمّ، أي عقد الرسم استُخدمت، الثقة، القيمة (الوقت الموفّر)، وزر تراجع واحد.",
          tr: "Her özerk eylem için cam-kutu makbuzunu yazar: ne yapıldı, hangi PCG düğümleri bilgi verdi, güven, değer (kazanılan zaman) ve tek-tıkla geri alma.",
        },
        kind: "compiler",
        reads: [{ en: "Action log, PCG citations, time-saved heuristic", ar: "سجل الإجراءات، استشهادات الرسم، تقدير الوقت الموفّر", tr: "Eylem günlüğü, PCG atıfları, zaman-tasarrufu sezgisi" }],
        writes: [{ en: "Glass-box receipts, undo handles", ar: "إيصالات شفّافة، مفاتيح تراجع", tr: "Cam-kutu makbuzları, geri-al tutamaçları" }],
      },
    ],
    edges: [
      { from: "personal-planner", to: "context-retriever", label: { en: "needs context", ar: "يحتاج سياقاً", tr: "bağlam gerekiyor" } },
      { from: "context-retriever", to: "drafter", label: { en: "grounding bundle", ar: "حزمة تأصيل", tr: "temellendirme paketi" } },
      { from: "drafter", to: "autonomy-gate", label: { en: "draft ready", ar: "مسودة جاهزة", tr: "taslak hazır" } },
      { from: "autonomy-gate", to: "receipt-keeper", label: { en: "execute or propose", ar: "تنفيذ أو اقتراح", tr: "yürüt veya öner" } },
      { from: "observation-extractor", to: "graph-curator", label: { en: "proposed nodes", ar: "عقد مقترحة", tr: "önerilen düğümler" } },
      { from: "graph-curator", to: "context-retriever", label: { en: "writes PCG", ar: "يكتب الرسم", tr: "PCG yazar" } },
      { from: "personal-planner", to: "observation-extractor", label: { en: "tap streams", ar: "ربط القنوات", tr: "akışlara bağlan" } },
    ],
    humanCheckpoints: [
      {
        id: "employee-approves",
        name: { en: "Employee", ar: "الموظف", tr: "Çalışan" },
        decision: {
          en: "Approves any L2-or-higher action before it ships. Owns personal-scope autonomy at all levels. Can edit, undo, forget any PCG node at any time.",
          ar: "يوافق على أي إجراء بمستوى L2 أو أعلى قبل إرساله. يملك الاستقلالية الشخصية بكل المستويات. يمكنه تعديل أو تراجع أو نسيان أي عقدة في أي وقت.",
          tr: "Gönderilmeden önce L2 ve üstü herhangi bir eylemi onaylar. Kişisel kapsam özerkliğine her seviyede sahiptir. Herhangi bir PCG düğümünü dilediği zaman düzenleyebilir, geri alabilir veya unutturabilir.",
        },
      },
      {
        id: "manager-policy",
        name: { en: "Manager / Org policy owner", ar: "المدير / مالك سياسة المؤسسة", tr: "Yönetici / Kurum politika sahibi" },
        decision: {
          en: "Sets the work-scope autonomy ceiling per capability (e.g. \"L3 for follow-up emails, L1 for offer letters\"). Sees aggregate outcomes only — never raw observations or chat content.",
          ar: "يحدّد سقف الاستقلالية لنطاق العمل لكل قدرة (مثل \"L3 لمتابعات البريد، L1 لخطابات العرض\"). يرى النتائج الإجمالية فقط — لا الملاحظات الخام ولا محتوى الدردشة.",
          tr: "Her yetenek için iş-kapsamı özerklik tavanını belirler (ör. \"takip e-postaları için L3, teklif mektupları için L1\"). Yalnızca toplu sonuçları görür — ham gözlemleri veya sohbet içeriğini asla görmez.",

        },
      },
    ],
    flowOrder: [
      { kind: "agent", id: "personal-planner" },
      { kind: "agent", id: "observation-extractor" },
      { kind: "agent", id: "graph-curator" },
      { kind: "agent", id: "context-retriever" },
      { kind: "agent", id: "drafter" },
      { kind: "agent", id: "autonomy-gate" },
      { kind: "human", id: "employee-approves" },
      { kind: "agent", id: "receipt-keeper" },
      { kind: "human", id: "manager-policy" },
    ],
    rationale: {
      en: "A single chatbot cannot be the planner, the listener, the librarian, the writer and the safety gate at once — and trust collapses if the same model that drafts an offer letter also decides whether to send it. Splitting these roles lets the employee see exactly which agent did what, lets the autonomy-gate be policy-governed independently of the drafter's quality, and lets the graph curator (the only writer to the PCG) be audited end-to-end. The receipt-keeper is non-optional because glass-box trust is a product-level promise, not an opt-in feature.",
      ar: "لا يمكن لمحادثة واحدة أن تكون المخطّط والمستمع وأمين المكتبة والكاتب وبوابة الأمان دفعة واحدة — وتنهار الثقة إذا كان النموذج نفسه الذي يصوغ خطاب العرض هو الذي يقرّر إرساله. تقسيم الأدوار يجعل الموظف يرى من فعل ماذا، ويجعل بوابة الاستقلالية مُحكمة بسياسة مستقلة عن جودة الكاتب، ويتيح تدقيق أمين الرسم (الكاتب الوحيد للسجل) من الطرف للطرف. أمين الإيصالات ليس اختيارياً لأن الثقة الشفّافة وعد على مستوى المنتج لا ميزة اختيارية.",
      tr: "Tek bir sohbet robotu aynı anda planlayıcı, dinleyici, kütüphaneci, yazar ve güvenlik kapısı olamaz — ve teklif mektubunu yazan model onu göndermeye de karar veriyorsa güven çöker. Bu rolleri ayırmak çalışanın hangi ajanın ne yaptığını görmesini sağlar, özerklik-kapısının taslakçının kalitesinden bağımsız olarak politika ile yönetilmesini ve grafik küratörünün (PCG'ye tek yazan) baştan sona denetlenmesini sağlar. Makbuz-kayıtçısı isteğe bağlı değildir çünkü cam-kutu güveni ürün düzeyinde bir vaattir, isteğe bağlı bir özellik değil.",
    },
  },
};

/** Returns the cast for a tool slug, or undefined if none registered. */
// ---------------------------------------------------------------------------
// Architectural note
//
// Agent casts live in their own module (this file), keyed by marketplace tool
// slug, instead of being embedded into `MarketplaceToolEntry` in
// `knowledge.ts`. This was a deliberate decision:
//
//   1. `knowledge.ts` is consumed by both the marketing site and the chat
//      assistant; keeping the heavyweight cast metadata (agents, edges,
//      flowOrder, human checkpoints, rationale) in a separate module keeps the
//      tool catalogue itself lean and easy to scan.
//   2. The casts are validated *against* the tool catalogue in
//      `artifacts/maven-ai/src/data/content.ts` — every tool slug must have a
//      cast (forward parity) and every cast slug must resolve to a tool
//      (reverse parity). The two files are therefore coupled at validation
//      time even though they are physically separate.
//   3. The chat route imports `getAgentCast(slug)` to enrich the system
//      prompt, so the cast metadata is reachable from both the React app and
//      the API server without round-tripping through the catalogue.
//
// If a future refactor wants `agentCast` directly on `MarketplaceToolEntry`,
// keep the validator parity rules and the `getAgentCast(slug)` accessor — the
// rest of the app only depends on those two contracts.
// ---------------------------------------------------------------------------

export function getAgentCast(slug: string): AgentCast | undefined {
  return marketplaceAgentCasts[slug];
}
