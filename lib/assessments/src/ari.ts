import type { AssessmentDefinition } from "./types";

export const ari: AssessmentDefinition = {
  slug: "ari",
  serviceSlug: "agentic-ai-transformation",
  code: "ARI",
  brandColor: "#156082",
  estMinutes: 12,
  title: { en: "Agentic Readiness Index", ar: "مؤشر الجاهزية الوكيلية" },
  subtitle: {
    en: "How ready is your enterprise to put AI agents into production?",
    ar: "ما مدى جاهزية مؤسستك لنشر وكلاء الذكاء الاصطناعي في الإنتاج؟",
  },
  description: {
    en: "Benchmark your organization across the seven capabilities that separate the 2% of GCC enterprises operating agents at scale from the rest.",
    ar: "قارن مؤسستك عبر القدرات السبع التي تميّز نسبة الـ 2% من شركات الخليج المشغّلة للوكلاء على نطاق واسع.",
  },
  memoPromptHint:
    "Frame the memo around agentic operating-model readiness. Reference the 2%-at-scale stat and Gartner's 40%-cancellation finding when relevant.",
  antiVendor: {
    en: [
      "If your priority is full-stack ERP replacement, talk to Accenture or Wipro — that is not our practice.",
      "If you need a country-wide outsourced contact center transition, an offshore BPO partner will outprice us.",
      "If your sponsor demands a 200-page strategy deck before any working software, a Big-4 advisory will fit better.",
    ],
    ar: [
      "إذا كانت أولويتك استبدال نظام ERP بالكامل، فإن أكسنتشر أو ويبرو هي الجهة المناسبة لك.",
      "إذا كنت بحاجة إلى نقل مركز اتصالات بحجم وطني عبر الإسناد الخارجي، فإن شريك BPO سيتفوق علينا في السعر.",
      "إذا كان الراعي يطلب عرضاً استراتيجياً من 200 صفحة قبل أي برنامج عامل، فإن استشارات Big-4 ستكون الأنسب.",
    ],
  },
  dimensions: [
    {
      id: "strategy",
      title: { en: "Strategy, Operating Model & Sponsorship", ar: "الاستراتيجية ونموذج التشغيل والرعاية" },
      weight: 0.15,
      description: {
        en: "Is agentic AI a CEO-sponsored, P&L-owned program — or a side project of the CIO?",
        ar: "هل الذكاء الاصطناعي الوكيلي برنامج يرعاه الرئيس التنفيذي ومسؤول عنه في حساب الأرباح والخسائر — أم مشروع جانبي لرئيس تقنية المعلومات؟",
      },
      questions: [
        {
          id: "ari.s1",
          prompt: { en: "Which best describes your agentic AI sponsorship today?", ar: "أيٌّ من التالي يصف أفضل رعاية الذكاء الاصطناعي الوكيلي لديكم اليوم؟" },
          options: [
            { id: "a", label: { en: "No formal sponsor; experiments live inside individual functions.", ar: "لا يوجد راعٍ رسمي؛ التجارب داخل الوظائف الفردية." }, score: 1 },
            { id: "b", label: { en: "CIO/CTO sponsors AI broadly; agents are not differentiated.", ar: "يرعى رئيس التقنية الذكاء الاصطناعي بشكل عام؛ لا تمييز للوكلاء." }, score: 2 },
            { id: "c", label: { en: "A named executive owns agentic AI but without P&L authority.", ar: "هناك تنفيذي مسمى يقود الوكلاء لكن دون صلاحية حساب الأرباح والخسائر." }, score: 3 },
            { id: "d", label: { en: "P&L-owning business head co-sponsors with the CIO and reports outcomes quarterly.", ar: "قائد أعمال مسؤول عن حساب الأرباح والخسائر يرعى مع رئيس التقنية ويعرض النتائج كل ربع." }, score: 4 },
            { id: "e", label: { en: "CEO-sponsored agentic transformation with board-level KPIs and dedicated funding.", ar: "تحول وكيلي يرعاه الرئيس التنفيذي مع مؤشرات على مستوى المجلس وتمويل مخصص." }, score: 5 },
          ],
        },
        {
          id: "ari.s2",
          prompt: { en: "How clearly is value defined for your agentic initiatives?", ar: "ما مدى وضوح القيمة لمبادرات الوكلاء لديكم؟" },
          options: [
            { id: "a", label: { en: "Value is described qualitatively (productivity, innovation).", ar: "القيمة موصوفة نوعياً (إنتاجية، ابتكار)." }, score: 1 },
            { id: "b", label: { en: "We track output metrics (tickets resolved, lines of code).", ar: "نتابع مقاييس المخرجات (عدد التذاكر، أسطر الكود)." }, score: 2 },
            { id: "c", label: { en: "We tie agents to specific operational KPIs per use case.", ar: "نربط الوكلاء بمؤشرات تشغيلية لكل حالة استخدام." }, score: 3 },
            { id: "d", label: { en: "Each production agent has a financial business case with attribution.", ar: "كل وكيل إنتاجي له حالة عمل مالية مع نسب أداء." }, score: 4 },
            { id: "e", label: { en: "Board-reviewed value tracker links every agent to enterprise EBIT or risk reduction.", ar: "متابع قيمة على مستوى المجلس يربط كل وكيل بأرباح المؤسسة أو خفض المخاطر." }, score: 5 },
          ],
        },
        {
          id: "ari.s3",
          prompt: { en: "How is agentic capability funded?", ar: "كيف يُموَّل بناء قدرات الوكلاء؟" },
          options: [
            { id: "a", label: { en: "Funded ad-hoc out of existing IT budget.", ar: "تمويل ظرفي من ميزانية تقنية المعلومات الحالية." }, score: 1 },
            { id: "b", label: { en: "Annual capex line for AI generally, no agentic split.", ar: "بند رأسمالي سنوي للذكاء الاصطناعي عموماً دون تخصيص للوكلاء." }, score: 2 },
            { id: "c", label: { en: "Dedicated agentic AI program budget renewed annually.", ar: "ميزانية مخصصة لبرنامج وكيلي تُجدد سنوياً." }, score: 3 },
            { id: "d", label: { en: "Multi-year funded transformation with a venture-style stage gate.", ar: "تحول ممول لعدة سنوات مع بوابات تمويل مرحلية." }, score: 4 },
            { id: "e", label: { en: "Outcome-based co-funding model with the business; reinvested savings.", ar: "نموذج تمويل مشترك مع الأعمال يقوم على النتائج وإعادة استثمار الوفورات." }, score: 5 },
          ],
        },
        {
          id: "ari.s4",
          prompt: { en: "How is your senior team aligned on what an 'AI agent' actually is?", ar: "ما مدى توافق الفريق التنفيذي على تعريف 'وكيل الذكاء الاصطناعي' فعلياً؟" },
          options: [
            { id: "a", label: { en: "Confused. Different leaders use the term differently.", ar: "غير متوافقين. يستخدم القادة المصطلح بطرق مختلفة." }, score: 1 },
            { id: "b", label: { en: "Some shared awareness; no formal taxonomy.", ar: "وعي مشترك جزئي؛ لا توجد تصنيفات رسمية." }, score: 2 },
            { id: "c", label: { en: "Working definition published internally.", ar: "تعريف عملي منشور داخلياً." }, score: 3 },
            { id: "d", label: { en: "Maturity-tier taxonomy used across architecture and business reviews.", ar: "تصنيف مستويات نضج مستخدم في مراجعات المعمارية والأعمال." }, score: 4 },
            { id: "e", label: { en: "Shared lexicon, governance posture, and operating playbook used at every level.", ar: "قاموس مشترك ونهج حوكمة ودليل تشغيل يُستخدم في كل المستويات." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "process",
      title: { en: "Process Re-engineering Readiness", ar: "جاهزية إعادة هندسة العمليات" },
      weight: 0.15,
      description: {
        en: "Gartner expects 40% of agentic projects to be cancelled by 2027 — overwhelmingly because the underlying processes were never re-engineered. How ready are yours?",
        ar: "تتوقع جارتنر إلغاء 40% من مشاريع الوكلاء بحلول 2027 — معظمها لأن العمليات الأساسية لم يُعَد تصميمها.",
      },
      questions: [
        {
          id: "ari.p1",
          prompt: { en: "How are processes currently selected for agentic automation?", ar: "كيف يتم حالياً اختيار العمليات للأتمتة الوكيلية؟" },
          options: [
            { id: "a", label: { en: "Chosen opportunistically by individual teams.", ar: "تختارها الفرق بشكل ظرفي." }, score: 1 },
            { id: "b", label: { en: "Selected via a use-case backlog, prioritized by sponsor demand.", ar: "تُختار عبر قائمة استخدامات حسب طلب الراعي." }, score: 2 },
            { id: "c", label: { en: "Filtered against a value/feasibility scoring framework.", ar: "تُنقّى عبر إطار تقييم للقيمة والجدوى." }, score: 3 },
            { id: "d", label: { en: "Process mining + value mapping identifies highest-leverage flows first.", ar: "تعدين العمليات وخرائط القيمة تحدد التدفقات الأعلى رافعة أولاً." }, score: 4 },
            { id: "e", label: { en: "Continuous portfolio steering with kill criteria and reinvestment rules.", ar: "توجيه مستمر للمحفظة مع معايير إيقاف وقواعد إعادة استثمار." }, score: 5 },
          ],
        },
        {
          id: "ari.p2",
          prompt: { en: "When deploying an agent, how is the underlying process treated?", ar: "عند نشر وكيل، كيف تُعامل العملية الأساسية؟" },
          options: [
            { id: "a", label: { en: "Left as-is; agent automates the existing steps.", ar: "تُترك كما هي؛ يقوم الوكيل بأتمتة الخطوات الحالية." }, score: 1 },
            { id: "b", label: { en: "Minor tweaks; we trust the legacy SOP.", ar: "تعديلات بسيطة؛ نثق بإجراءات التشغيل القديمة." }, score: 2 },
            { id: "c", label: { en: "Process simplified before automation.", ar: "تُبسَّط العملية قبل الأتمتة." }, score: 3 },
            { id: "d", label: { en: "End-to-end value stream redesign before agent build.", ar: "إعادة تصميم سلسلة القيمة الكاملة قبل بناء الوكيل." }, score: 4 },
            { id: "e", label: { en: "Process designed agent-first; humans handle exception handling only.", ar: "تصمَّم العملية وفق منطق الوكيل أولاً؛ ويتدخل البشر للاستثناءات فقط." }, score: 5 },
          ],
        },
        {
          id: "ari.p3",
          prompt: { en: "Who owns process change after an agent goes live?", ar: "من يملك تغيير العمليات بعد إطلاق الوكيل؟" },
          options: [
            { id: "a", label: { en: "No one is formally responsible.", ar: "لا أحد مسؤول رسمياً." }, score: 1 },
            { id: "b", label: { en: "The IT/AI team handles it on a best-effort basis.", ar: "يتولاها فريق التقنية/الذكاء الاصطناعي بأفضل جهد." }, score: 2 },
            { id: "c", label: { en: "Process owners exist for major flows.", ar: "يوجد ملاك عمليات للتدفقات الرئيسية." }, score: 3 },
            { id: "d", label: { en: "Cross-functional pods own outcomes including the process.", ar: "فرق متعددة الوظائف تملك النتائج بما في ذلك العملية." }, score: 4 },
            { id: "e", label: { en: "BizOps + product teams continuously evolve agentic flows in production.", ar: "فرق العمليات والمنتج تطوّر تدفقات الوكلاء باستمرار في الإنتاج." }, score: 5 },
          ],
        },
        {
          id: "ari.p4",
          prompt: { en: "How are operating-model implications captured before launch?", ar: "كيف تُلتقط تبعات نموذج التشغيل قبل الإطلاق؟" },
          options: [
            { id: "a", label: { en: "Not at all. We focus on the model and tools.", ar: "لا تُلتقط. نركّز على النموذج والأدوات." }, score: 1 },
            { id: "b", label: { en: "Loose change-management conversation pre-go-live.", ar: "نقاش غير منظم لإدارة التغيير قبل الإطلاق." }, score: 2 },
            { id: "c", label: { en: "RACI updated; some training delivered.", ar: "تحديث RACI وتقديم بعض التدريب." }, score: 3 },
            { id: "d", label: { en: "Operating-model blueprint produced and signed off pre-launch.", ar: "إصدار مخطط نموذج تشغيل واعتماده قبل الإطلاق." }, score: 4 },
            { id: "e", label: { en: "Operating-model and workforce plan revised quarterly with each release.", ar: "تحديث نموذج التشغيل وخطة القوى العاملة كل ربع مع كل إصدار." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "architecture",
      title: { en: "Agent Architecture, Orchestration & Tooling", ar: "بنية الوكلاء والتنسيق والأدوات" },
      weight: 0.15,
      description: { en: "From zero formal stack to a multi-agent platform with policy-driven routing.", ar: "من غياب أي مكدس إلى منصة متعددة الوكلاء بتوجيه قائم على السياسات." },
      questions: [
        {
          id: "ari.a1",
          prompt: { en: "Which best describes your current agent orchestration approach?", ar: "أيٌّ من التالي يصف أفضل أسلوبكم في تنسيق الوكلاء؟" },
          options: [
            { id: "a", label: { en: "We have not deployed any production agents.", ar: "لم ننشر أي وكلاء في الإنتاج." }, score: 1 },
            { id: "b", label: { en: "No-code copilots (Copilot Studio / ChatGPT Enterprise) without a formal orchestration layer.", ar: "أدوات بدون كود (Copilot Studio / ChatGPT Enterprise) دون طبقة تنسيق رسمية." }, score: 2 },
            { id: "c", label: { en: "One orchestration framework chosen (LangGraph, Bedrock Agents) but limited multi-agent patterns.", ar: "إطار تنسيق واحد مختار (LangGraph، Bedrock Agents) مع أنماط محدودة." }, score: 3 },
            { id: "d", label: { en: "Standardized orchestration stack with a tool/skill registry shared across teams.", ar: "مكدس تنسيق موحد مع سجل أدوات/مهارات مشترك بين الفرق." }, score: 4 },
            { id: "e", label: { en: "Multi-agent platform with policy-driven routing, evals, and reusable templates across BUs.", ar: "منصة متعددة الوكلاء مع توجيه قائم على السياسات وتقييمات وقوالب قابلة لإعادة الاستخدام." }, score: 5 },
          ],
        },
        {
          id: "ari.a2",
          prompt: { en: "How are tools/skills exposed to agents?", ar: "كيف تُتاح الأدوات/المهارات للوكلاء؟" },
          options: [
            { id: "a", label: { en: "Hand-coded per agent, no reuse.", ar: "مكتوبة يدوياً لكل وكيل دون إعادة استخدام." }, score: 1 },
            { id: "b", label: { en: "Some shared utilities; no formal registry.", ar: "بعض الأدوات المشتركة دون سجل رسمي." }, score: 2 },
            { id: "c", label: { en: "Tool catalog in a wiki; reused informally.", ar: "كتالوج أدوات في الويكي يُعاد استخدامه بشكل غير رسمي." }, score: 3 },
            { id: "d", label: { en: "Versioned tool registry with auth, observability, and SLAs.", ar: "سجل أدوات بإصدارات مع المصادقة والمراقبة واتفاقيات الخدمة." }, score: 4 },
            { id: "e", label: { en: "Tool marketplace with discovery, governance, and chargeback.", ar: "سوق أدوات مع الاكتشاف والحوكمة وإعادة تحميل التكلفة." }, score: 5 },
          ],
        },
        {
          id: "ari.a3",
          prompt: { en: "Sovereign / on-prem capability for agentic workloads?", ar: "قدرة سيادية/داخلية لأحمال الوكلاء؟", },
          options: [
            { id: "a", label: { en: "Public cloud only; no sovereign option.", ar: "سحابة عامة فقط؛ لا يوجد خيار سيادي." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Considering sovereign but no live capability.", ar: "ندرس الخيار السيادي لكن لا توجد قدرة فعلية." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid posture; some inference on sovereign cloud.", ar: "وضع هجين؛ بعض الاستدلال على السحابة السيادية." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Production agents running on sovereign cloud with policy controls.", ar: "وكلاء إنتاج يعملون على السحابة السيادية مع ضوابط سياسية." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Full sovereign & on-prem capability with multi-region failover.", ar: "قدرة سيادية وداخلية كاملة مع تجاوز فشل متعدد المناطق." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.a4",
          prompt: { en: "Choice of model providers / inference stack?", ar: "اختيار مزودي النماذج/مكدس الاستدلال؟" },
          options: [
            { id: "a", label: { en: "Single vendor lock-in (e.g., one hyperscaler).", ar: "ارتباط بمزود واحد (مثل سحابة كبرى واحدة)." }, score: 1 },
            { id: "b", label: { en: "One primary + one experimental.", ar: "مزود رئيسي وآخر تجريبي." }, score: 2 },
            { id: "c", label: { en: "Multiple providers; routing decided per use case manually.", ar: "عدة مزودين؛ يدوياً يتم اختيار التوجيه لكل استخدام." }, score: 3 },
            { id: "d", label: { en: "Abstracted via gateway with cost/perf-aware routing.", ar: "مجرد عبر بوابة مع توجيه يراعي التكلفة والأداء." }, score: 4 },
            { id: "e", label: { en: "Policy-driven gateway plus self-hosted open weights for sovereign workloads.", ar: "بوابة قائمة على السياسات بالإضافة إلى أوزان مفتوحة مستضافة ذاتياً للأحمال السيادية." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "data",
      title: { en: "Data, APIs & Knowledge Foundations", ar: "أساسات البيانات وواجهات البرمجة والمعرفة" },
      weight: 0.15,
      description: { en: "Agents are only as good as the systems they can read, write to, and reason over.", ar: "قيمة الوكلاء بقدر الأنظمة التي يستطيعون قراءتها والكتابة فيها والاستدلال منها." },
      questions: [
        {
          id: "ari.d1",
          prompt: { en: "Coverage of systems-of-record by stable APIs?", ar: "تغطية أنظمة السجلات بواجهات برمجة مستقرة؟" },
          options: [
            { id: "a", label: { en: "<25% of core systems exposed.", ar: "أقل من 25% من الأنظمة الأساسية متاحة." }, score: 1 },
            { id: "b", label: { en: "25–50% with mixed quality.", ar: "25–50% بجودة متفاوتة." }, score: 2 },
            { id: "c", label: { en: "50–75% with versioned APIs.", ar: "50–75% بواجهات مُصدَرة." }, score: 3 },
            { id: "d", label: { en: ">75% with documented contracts.", ar: "أكثر من 75% بعقود موثقة." }, score: 4 },
            { id: "e", label: { en: "Universal API/event coverage with discoverable contracts and SLAs.", ar: "تغطية شاملة لواجهات/أحداث مع عقود قابلة للاكتشاف واتفاقيات خدمة." }, score: 5 },
          ],
        },
        {
          id: "ari.d2",
          prompt: { en: "Knowledge bases for retrieval (RAG)?", ar: "قواعد المعرفة للاسترجاع المعزز (RAG)؟" },
          options: [
            { id: "a", label: { en: "None. Agents rely on model parametric knowledge.", ar: "لا يوجد. يعتمد الوكلاء على معرفة النموذج فقط." }, score: 1 },
            { id: "b", label: { en: "Ad-hoc PDF/SharePoint indexing per project.", ar: "فهرسة ظرفية لـ PDF/SharePoint لكل مشروع." }, score: 2 },
            { id: "c", label: { en: "Centralized vector store with ingestion pipelines.", ar: "مخزن متجهات مركزي مع أنابيب استيعاب." }, score: 3 },
            { id: "d", label: { en: "Curated knowledge graph + structured + unstructured KBs.", ar: "رسم معرفي منسَّق مع قواعد منظمة وغير منظمة." }, score: 4 },
            { id: "e", label: { en: "Federated knowledge fabric with provenance, freshness SLAs, and Arabic NLP support.", ar: "نسيج معرفي اتحادي مع أصل المعلومة وتحديثات بمستوى خدمة ودعم لمعالجة اللغة العربية." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.d3",
          prompt: { en: "Arabic / multilingual NLP readiness for agents?", ar: "جاهزية معالجة العربية/متعددة اللغات للوكلاء؟" },
          options: [
            { id: "a", label: { en: "English only.", ar: "الإنجليزية فقط." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Translated UIs; underlying agent works in English.", ar: "واجهات مترجمة؛ يعمل الوكيل أساساً بالإنجليزية." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Arabic-capable models in pilot.", ar: "نماذج تدعم العربية في التجربة." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Production Arabic-native agents for select journeys.", ar: "وكلاء عربية أصلية في الإنتاج لرحلات مختارة." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Bilingual EN/AR-native agents across all customer & employee journeys.", ar: "وكلاء ثنائيو اللغة EN/AR لكل رحلات العملاء والموظفين." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "people",
      title: { en: "Human-in-the-loop & Workforce Readiness", ar: "الإنسان في الحلقة وجاهزية القوى العاملة" },
      weight: 0.15,
      description: { en: "Agents change roles, span of control, and incentives — usually in that order.", ar: "تغيّر الوكلاء الأدوار ونطاق الإشراف والحوافز — عادةً بهذا الترتيب." },
      questions: [
        {
          id: "ari.h1",
          prompt: { en: "How is human oversight built into your agents?", ar: "كيف يُبنى الإشراف البشري داخل وكلائكم؟" },
          options: [
            { id: "a", label: { en: "Not designed; humans review only when the agent fails.", ar: "غير مصمَّم؛ يتدخل البشر فقط عند فشل الوكيل." }, score: 1 },
            { id: "b", label: { en: "Manual sampling of outputs by team leads.", ar: "أخذ عينات يدوي من المخرجات من قبل قادة الفريق." }, score: 2 },
            { id: "c", label: { en: "Approval workflows for high-impact actions.", ar: "تدفقات موافقة للإجراءات عالية الأثر." }, score: 3 },
            { id: "d", label: { en: "Risk-tiered HITL policies with audit trails.", ar: "سياسات HITL مبنية على مستويات المخاطر مع سجلات تدقيق." }, score: 4 },
            { id: "e", label: { en: "Adaptive autonomy: confidence + risk scoring decides when human reviews.", ar: "استقلالية تكيفية: نتيجة الثقة والمخاطر تحدد توقيت المراجعة البشرية." }, score: 5 },
          ],
        },
        {
          id: "ari.h2",
          prompt: { en: "Workforce re-skilling around agentic AI?", ar: "إعادة تأهيل القوى العاملة حول الوكلاء؟" },
          options: [
            { id: "a", label: { en: "None planned.", ar: "لا توجد خطط." }, score: 1 },
            { id: "b", label: { en: "Awareness sessions and a few certifications.", ar: "جلسات توعية وبعض الشهادات." }, score: 2 },
            { id: "c", label: { en: "Role-based learning paths underway.", ar: "مسارات تعلم حسب الدور قيد التنفيذ." }, score: 3 },
            { id: "d", label: { en: "Funded reskilling program with measured uptake.", ar: "برنامج إعادة تأهيل ممول مع قياس التبني." }, score: 4 },
            { id: "e", label: { en: "Strategic workforce plan including local talent (Saudization/Emiratization) tied to agent rollout.", ar: "خطة استراتيجية للقوى العاملة تشمل المواهب المحلية مرتبطة بإطلاق الوكلاء." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.h3",
          prompt: { en: "Frontline adoption posture for agents?", ar: "وضع تبني الوكلاء على خط المواجهة؟" },
          options: [
            { id: "a", label: { en: "Mostly skeptical / blocking.", ar: "في الغالب متشككون/معرقلون." }, score: 1 },
            { id: "b", label: { en: "Curious but uncertain about job impact.", ar: "متحمسون لكن غير متأكدين من الأثر على الوظائف." }, score: 2 },
            { id: "c", label: { en: "Selectively engaged; champions emerge.", ar: "اشتراك انتقائي؛ يظهر أبطال." }, score: 3 },
            { id: "d", label: { en: "Frontline co-designs with the agent team.", ar: "خط المواجهة يصمم بالاشتراك مع فريق الوكلاء." }, score: 4 },
            { id: "e", label: { en: "Frontline drives the backlog; agents are seen as a multiplier.", ar: "خط المواجهة يقود القائمة؛ الوكلاء يُعتبرون مضاعِفاً." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "responsible",
      title: { en: "Responsible AI, Guardrails & Evals", ar: "الذكاء الاصطناعي المسؤول والحواجز والتقييمات" },
      weight: 0.15,
      description: { en: "From ethics committee theatre to McKinsey-grade evals for the agentic world.", ar: "من مجرد لجان أخلاقيات إلى تقييمات بمستوى McKinsey للعالم الوكيلي." },
      questions: [
        {
          id: "ari.r1",
          prompt: { en: "How do you evaluate agent quality before promotion?", ar: "كيف تُقيِّمون جودة الوكيل قبل الترقية؟" },
          options: [
            { id: "a", label: { en: "Manual demo to a stakeholder.", ar: "عرض يدوي للجهة المعنية." }, score: 1 },
            { id: "b", label: { en: "Spot-checks of outputs.", ar: "فحوص عشوائية للمخرجات." }, score: 2 },
            { id: "c", label: { en: "Static eval set per use case.", ar: "مجموعة تقييم ثابتة لكل استخدام." }, score: 3 },
            { id: "d", label: { en: "Continuous evals + regression tests in CI.", ar: "تقييمات مستمرة واختبارات تراجع في CI." }, score: 4 },
            { id: "e", label: { en: "Multi-dimensional evals: task success, faithfulness, safety, cost — gated promotions.", ar: "تقييمات متعددة الأبعاد: نجاح المهمة، الإخلاص، السلامة، التكلفة — مع بوابات ترقية." }, score: 5 },
          ],
        },
        {
          id: "ari.r2",
          prompt: { en: "Guardrails on agent behavior in production?", ar: "حواجز سلوك الوكيل في الإنتاج؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد." }, score: 1 },
            { id: "b", label: { en: "Prompt-level instructions only.", ar: "تعليمات على مستوى الأمر فقط." }, score: 2 },
            { id: "c", label: { en: "Input/output filters and basic classifiers.", ar: "فلاتر للمدخلات/المخرجات ومصنفات أساسية." }, score: 3 },
            { id: "d", label: { en: "Policy engine + tool-level allowlists + redaction.", ar: "محرك سياسات + قوائم سماح للأدوات + إخفاء." }, score: 4 },
            { id: "e", label: { en: "End-to-end policy enforcement with PDPL/SAMA/CBUAE-aware controls.", ar: "تطبيق سياسات شامل مع ضوابط واعية بـ PDPL/SAMA/CBUAE." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "ari.r3",
          prompt: { en: "Compliance posture vs. SDAIA/PDPL/SAMA/CBUAE?", ar: "وضع الامتثال مقابل SDAIA/PDPL/SAMA/CBUAE؟" },
          options: [
            { id: "a", label: { en: "Not formally addressed.", ar: "غير معالج رسمياً." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Awareness; gap analysis pending.", ar: "وعي؛ تحليل الفجوات قيد الانتظار." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Gap analysis complete; remediation underway.", ar: "تحليل الفجوات مكتمل؛ المعالجة جارية." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Controls implemented and audited annually.", ar: "ضوابط مطبَّقة ومراجَعة سنوياً." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Continuous compliance with attestation evidence per release.", ar: "امتثال مستمر مع أدلة شهادات لكل إصدار." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "scale",
      title: { en: "Operational Scale, FinOps & Value Realization", ar: "النطاق التشغيلي والمالية والتحقق من القيمة" },
      weight: 0.10,
      description: { en: "Only 2% of GCC enterprises run agents at scale. Are you in or out?", ar: "فقط 2% من شركات الخليج تشغل الوكلاء على نطاق واسع. هل أنتم منهم؟" },
      questions: [
        {
          id: "ari.o1",
          prompt: { en: "How many agents are in true production today?", ar: "كم عدد الوكلاء في الإنتاج الفعلي اليوم؟" },
          options: [
            { id: "a", label: { en: "Zero. All experiments.", ar: "صفر. كلها تجارب." }, score: 1 },
            { id: "b", label: { en: "1–2 in pilot mode.", ar: "1–2 في وضع تجريبي." }, score: 2 },
            { id: "c", label: { en: "3–5 in production with limited scope.", ar: "3–5 في الإنتاج بنطاق محدود." }, score: 3 },
            { id: "d", label: { en: "5–15 in production with measurable outcomes.", ar: "5–15 في الإنتاج بنتائج قابلة للقياس." }, score: 4 },
            { id: "e", label: { en: "15+ enterprise-wide agents with consolidated value tracking.", ar: "أكثر من 15 وكيل على مستوى المؤسسة مع تتبع قيمة موحد." }, score: 5 },
          ],
          skipIf: undefined,
        },
        {
          id: "ari.o2",
          prompt: { en: "FinOps maturity for agentic workloads?", ar: "نضج المالية التشغيلية لأحمال الوكلاء؟", },
          options: [
            { id: "a", label: { en: "No visibility into per-agent cost.", ar: "لا توجد رؤية للتكلفة لكل وكيل." }, score: 1 },
            { id: "b", label: { en: "Aggregate token spend monitored monthly.", ar: "إجمالي إنفاق الرموز يُراقب شهرياً." }, score: 2 },
            { id: "c", label: { en: "Per-team chargeback in place.", ar: "إعادة تحميل تكلفة لكل فريق." }, score: 3 },
            { id: "d", label: { en: "Per-agent unit economics tracked vs. value delivered.", ar: "اقتصاديات وحدة لكل وكيل تُتابع مقابل القيمة." }, score: 4 },
            { id: "e", label: { en: "Real-time cost-aware routing with automated cost controls.", ar: "توجيه واعٍ بالتكلفة في الوقت الحقيقي مع ضوابط آلية." }, score: 5 },
          ],
          skipIf: { questionId: "ari.o1", optionIds: ["a"] },
        },
        {
          id: "ari.o3",
          prompt: { en: "How do you measure realized value from agents?", ar: "كيف تقيسون القيمة المحققة من الوكلاء؟" },
          options: [
            { id: "a", label: { en: "We don't.", ar: "لا نقيس." }, score: 1 },
            { id: "b", label: { en: "Anecdotal stories.", ar: "حكايات." }, score: 2 },
            { id: "c", label: { en: "Productivity metrics per use case.", ar: "مقاييس إنتاجية لكل حالة استخدام." }, score: 3 },
            { id: "d", label: { en: "EBIT/risk-reduction attribution per agent.", ar: "نسب أرباح/خفض مخاطر لكل وكيل." }, score: 4 },
            { id: "e", label: { en: "Board-level value tracker with 3rd-party attestation.", ar: "متابع قيمة على مستوى المجلس مع تصديق طرف ثالث." }, score: 5 },
          ],
          skipIf: { questionId: "ari.o1", optionIds: ["a"] },
        },
      ],
    },
  ],
  recommendations: {
    strategy: {
      Nascent: {
        quickWins90d: [
          { en: "Name a single executive sponsor with P&L authority for one agentic use case.", ar: "تسمية راعٍ تنفيذي واحد بصلاحية حساب الأرباح والخسائر لاستخدام وكيلي واحد." },
          { en: "Run a 2-week value-case sprint to quantify the business outcome of one agent.", ar: "تشغيل سباق حالة قيمة لمدة أسبوعين لقياس النتيجة لوكيل واحد." },
        ],
        roadmap6m: [
          { en: "Stand up a cross-functional agentic council (CEO + CIO + CFO + business head).", ar: "تأسيس مجلس وكيلي متعدد الوظائف (CEO + CIO + CFO + قائد أعمال)." },
          { en: "Publish an internal 'what is an agent' lexicon and maturity tier playbook.", ar: "نشر معجم داخلي لتعريف الوكيل ودليل لمستويات النضج." },
        ],
        strategic12m: [
          { en: "Embed agentic AI as a board-level KPI tied to enterprise EBIT impact.", ar: "تضمين الذكاء الاصطناعي الوكيلي كمؤشر على مستوى المجلس مرتبط بالأثر على أرباح المؤسسة." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Move from CIO-led to business-head co-sponsorship for the top 2 agentic programs.", ar: "الانتقال من قيادة CIO إلى رعاية مشتركة لأهم برنامجين وكيليين." },
        ],
        roadmap6m: [
          { en: "Tie each production agent to a financial business case with attribution.", ar: "ربط كل وكيل إنتاجي بحالة عمل مالية ذات نسب أداء." },
        ],
        strategic12m: [
          { en: "Refresh corporate strategy to make agentic operating model an explicit enterprise pillar.", ar: "تحديث الاستراتيجية المؤسسية لتجعل النموذج الوكيلي ركيزة صريحة." },
        ],
      },
      Established: {
        quickWins90d: [
          { en: "Add an outcome-based co-funding clause with the business for the next 2 agent releases.", ar: "إضافة بند تمويل مشترك قائم على النتائج للأعمال للإطلاقين القادمين." },
        ],
        roadmap6m: [
          { en: "Stand up an enterprise agentic value tracker reviewed by the executive committee monthly.", ar: "تأسيس متابع قيمة وكيلي مؤسسي تراجعه اللجنة التنفيذية شهرياً." },
        ],
        strategic12m: [
          { en: "Position the firm as a regional agentic reference; pursue published case studies and Maven AI Verified status.", ar: "تموضع الشركة كمرجع وكيلي إقليمي؛ السعي لدراسات حالة منشورة وشهادة Maven AI Verified." },
        ],
      },
    },
    process: {
      Nascent: {
        quickWins90d: [
          { en: "Run process mining on one high-volume flow to identify agentic candidates.", ar: "تشغيل تعدين عمليات على تدفق عالي الحجم لتحديد المرشحين للوكلاء." },
        ],
        roadmap6m: [
          { en: "Re-engineer 3 end-to-end value streams agent-first before next agent goes live.", ar: "إعادة هندسة 3 سلاسل قيمة شاملة بمنطق الوكيل أولاً قبل إطلاق الوكيل التالي." },
        ],
        strategic12m: [
          { en: "Embed BizOps + product pods that own agentic flows in production end-to-end.", ar: "إنشاء فرق BizOps والمنتج تملك تدفقات الوكلاء في الإنتاج." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Kill 3 agent pilots whose underlying processes were not redesigned.", ar: "إلغاء 3 تجارب وكلاء لم يُعَد تصميم عملياتها." },
        ],
        roadmap6m: [
          { en: "Adopt a 'no agent without process redesign' rule, enforced at intake.", ar: "اعتماد قاعدة 'لا وكيل بدون إعادة تصميم العملية' عند الاستلام." },
        ],
        strategic12m: [
          { en: "Stand up a continuous portfolio steering function with kill criteria.", ar: "تأسيس وظيفة توجيه محفظة مستمرة بمعايير إيقاف." },
        ],
      },
    },
    architecture: {
      Nascent: {
        quickWins90d: [
          { en: "Pick one orchestration framework (LangGraph, Bedrock Agents, or AI Refinery) and standardize.", ar: "اختر إطار تنسيق واحداً ووحّد عليه." },
        ],
        roadmap6m: [
          { en: "Build a versioned tool/skill registry with auth and observability.", ar: "بناء سجل أدوات بإصدارات مع المصادقة والمراقبة." },
        ],
        strategic12m: [
          { en: "Stand up a multi-agent platform with policy-driven routing and a tool marketplace.", ar: "تأسيس منصة متعددة الوكلاء بتوجيه قائم على السياسات وسوق أدوات." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Introduce a model gateway for cost/performance routing.", ar: "إدخال بوابة نموذج للتوجيه حسب التكلفة/الأداء." },
        ],
        roadmap6m: [
          { en: "Add sovereign-cloud or on-prem option for regulated workloads.", ar: "إضافة خيار سحابة سيادية أو داخلية للأحمال المنظمة." },
        ],
        strategic12m: [
          { en: "Operate self-hosted open-weight models alongside frontier APIs for sovereign workloads.", ar: "تشغيل نماذج مفتوحة الأوزان مستضافة ذاتياً إلى جانب واجهات APIs الحدودية." },
        ],
      },
    },
    data: {
      Nascent: {
        quickWins90d: [
          { en: "Inventory APIs across the top 5 systems-of-record; close the most painful gaps.", ar: "حصر واجهات APIs لأهم 5 أنظمة سجلات وإغلاق أكبر الفجوات إيلاماً." },
        ],
        roadmap6m: [
          { en: "Build a centralized vector store with managed ingestion pipelines.", ar: "بناء مخزن متجهات مركزي بأنابيب استيعاب مُدارة." },
        ],
        strategic12m: [
          { en: "Stand up a federated knowledge fabric with provenance and Arabic NLP.", ar: "تأسيس نسيج معرفي اتحادي مع أصل المعلومة ومعالجة العربية." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Deploy a managed Arabic-capable embedding model behind your retrieval layer.", ar: "نشر نموذج تضمين يدعم العربية خلف طبقة الاسترجاع." },
        ],
        roadmap6m: [
          { en: "Achieve >75% API/event coverage for systems an agent might touch.", ar: "تحقيق تغطية تتجاوز 75% للأنظمة التي قد يتعامل معها الوكيل." },
        ],
        strategic12m: [
          { en: "Operate a curated knowledge graph spanning structured + unstructured sources.", ar: "تشغيل رسم معرفي منسَّق يغطي مصادر منظمة وغير منظمة." },
        ],
      },
    },
    people: {
      Nascent: {
        quickWins90d: [
          { en: "Define HITL policy tiers based on action risk; document for engineers.", ar: "تعريف مستويات HITL بناءً على مخاطر الإجراء وتوثيقها." },
        ],
        roadmap6m: [
          { en: "Launch role-based reskilling for the top 3 affected functions.", ar: "إطلاق إعادة تأهيل حسب الدور لأكثر 3 وظائف تأثراً." },
        ],
        strategic12m: [
          { en: "Tie agent rollout to a strategic workforce plan including local talent.", ar: "ربط نشر الوكلاء بخطة استراتيجية للقوى العاملة تشمل المواهب المحلية." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Move from sampling to risk-tiered HITL with audit trails.", ar: "الانتقال من العينات إلى HITL بمستويات مخاطر مع سجلات تدقيق." },
        ],
        roadmap6m: [
          { en: "Co-design next 2 agents with frontline teams from day one.", ar: "تصميم الوكيلين القادمين بالاشتراك مع فرق خط المواجهة من اليوم الأول." },
        ],
        strategic12m: [
          { en: "Adaptive autonomy controls — confidence + risk decide when humans review.", ar: "ضوابط استقلالية تكيفية — الثقة والمخاطر تحدد المراجعة البشرية." },
        ],
      },
    },
    responsible: {
      Nascent: {
        quickWins90d: [
          { en: "Stand up a continuous eval harness for the top 2 agents (faithfulness, safety, cost).", ar: "إنشاء أداة تقييم مستمرة لأهم وكيلين (الإخلاص، السلامة، التكلفة)." },
        ],
        roadmap6m: [
          { en: "Implement a policy engine with tool-level allowlists and PII redaction.", ar: "تطبيق محرك سياسات مع قوائم سماح للأدوات وإخفاء PII." },
        ],
        strategic12m: [
          { en: "Achieve continuous PDPL/SAMA/CBUAE attestation per agent release.", ar: "تحقيق تصديق مستمر لـ PDPL/SAMA/CBUAE لكل إصدار وكيل." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Add gated promotions: agent cannot ship to prod without passing eval thresholds.", ar: "إضافة بوابات ترقية: لا ينتقل الوكيل للإنتاج دون تجاوز عتبات التقييم." },
        ],
        roadmap6m: [
          { en: "Wire SDAIA / PDPL controls into the policy engine.", ar: "ربط ضوابط SDAIA / PDPL داخل محرك السياسات." },
        ],
        strategic12m: [
          { en: "Publish a Maven AI Verified responsible-AI report to clients and regulators.", ar: "نشر تقرير Maven AI Verified للذكاء الاصطناعي المسؤول للعملاء والمنظمين." },
        ],
      },
    },
    scale: {
      Nascent: {
        quickWins90d: [
          { en: "Pick one production agent and define unit economics (cost per task vs. value).", ar: "اختيار وكيل إنتاج واحد وتعريف اقتصاديات الوحدة (التكلفة لكل مهمة مقابل القيمة)." },
        ],
        roadmap6m: [
          { en: "Move from aggregate token spend to per-team chargeback.", ar: "الانتقال من إجمالي إنفاق الرموز إلى إعادة تحميل التكلفة لكل فريق." },
        ],
        strategic12m: [
          { en: "Operate 5+ agents with EBIT/risk-reduction attribution per agent.", ar: "تشغيل 5+ وكلاء مع نسب أرباح/خفض مخاطر لكل وكيل." },
        ],
      },
      Emerging: {
        quickWins90d: [
          { en: "Add cost-aware routing across model providers.", ar: "إضافة توجيه واعٍ بالتكلفة عبر مزودي النماذج." },
        ],
        roadmap6m: [
          { en: "Stand up a board-level value tracker; quarterly attestation.", ar: "تأسيس متابع قيمة على مستوى المجلس؛ تصديق ربع سنوي." },
        ],
        strategic12m: [
          { en: "Become a published GCC reference for agentic at scale (15+ agents).", ar: "أن تصبح مرجع إقليمياً منشور للوكلاء على نطاق واسع (15+ وكيل)." },
        ],
      },
    },
  },
};
