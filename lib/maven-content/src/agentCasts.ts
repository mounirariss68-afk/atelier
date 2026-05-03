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
