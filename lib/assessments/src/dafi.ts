import type { AssessmentDefinition } from "./types";

export const dafi: AssessmentDefinition = {
  slug: "dafi",
  serviceSlug: "data-governance-foundations",
  code: "DAFI",
  brandColor: "#0F9ED5",
  estMinutes: 13,
  title: { en: "Data & AI Foundations Index", ar: "مؤشر أساسات البيانات والذكاء الاصطناعي" },
  subtitle: {
    en: "How sound are the data and governance foundations underneath your AI ambitions?",
    ar: "ما مدى متانة أساسات البيانات والحوكمة تحت طموحاتكم في الذكاء الاصطناعي؟",
  },
  description: {
    en: "Aligned with Deloitte's 5×28 Digital Maturity Model, McKinsey's Data Quotient, and the EDM Council DCAM — adapted for GCC sovereign realities.",
    ar: "متوافق مع نموذج Deloitte الرقمي 5×28، ومعامل البيانات لـ McKinsey، وإطار DCAM — مع تكييف للواقع السيادي الخليجي.",
  },
  memoPromptHint:
    "Frame the memo around data foundations as the first thing AI exposes. Reference PDPL, SAMA, CBUAE, SDAIA where relevant.",
  antiVendor: {
    en: [
      "If your goal is a multi-year data warehouse modernization with a single hyperscaler, talk to Deloitte or PwC.",
      "If you need an SAP MDM rollout exclusively, an SAP-certified SI is the right fit.",
      "If you're optimizing for the lowest tooling license cost, you'll find cheaper data integrators than us.",
    ],
    ar: [
      "إذا كان الهدف تحديث مستودع بيانات لعدة سنوات مع مزود سحابي واحد، تحدثوا مع Deloitte أو PwC.",
      "إذا كنتم بحاجة لطرح SAP MDM حصراً، فإن SI معتمداً من SAP هو الأنسب.",
      "إذا كنتم تبحثون عن أرخص رخص أدوات، ستجدون مكاملي بيانات أرخص منا.",
    ],
  },
  dimensions: [
    {
      id: "strategy",
      title: { en: "Data Strategy & Operating Model", ar: "استراتيجية البيانات ونموذج التشغيل" },
      weight: 0.15,
      description: { en: "CDO/CAO role, data product orientation, federated vs. centralized.", ar: "دور CDO/CAO، توجه منتج البيانات، اتحادي مقابل مركزي." },
      questions: [
        {
          id: "dafi.s1",
          prompt: { en: "Senior accountability for data?", ar: "المساءلة العليا عن البيانات؟" },
          options: [
            { id: "a", label: { en: "No senior owner.", ar: "لا يوجد مالك أعلى." }, score: 1 },
            { id: "b", label: { en: "CIO carries it informally.", ar: "يتولاها CIO بشكل غير رسمي." }, score: 2 },
            { id: "c", label: { en: "CDO/CAO appointed but limited mandate.", ar: "CDO/CAO معيّن لكن صلاحيته محدودة." }, score: 3 },
            { id: "d", label: { en: "CDO with P&L authority and seat at ExCo.", ar: "CDO بصلاحية P&L ومقعد في ExCo." }, score: 4 },
            { id: "e", label: { en: "CDO + Chief AI Officer with shared OKRs and board reporting.", ar: "CDO + Chief AI Officer بأهداف مشتركة وتقارير للمجلس." }, score: 5 },
          ],
        },
        {
          id: "dafi.s2",
          prompt: { en: "Data product orientation?", ar: "توجه منتج البيانات؟" },
          options: [
            { id: "a", label: { en: "Pure project delivery.", ar: "تسليم مشاريع فقط." }, score: 1 },
            { id: "b", label: { en: "Some named datasets treated as assets.", ar: "بعض مجموعات البيانات تُعامل كأصول." }, score: 2 },
            { id: "c", label: { en: "Data product owners on key domains.", ar: "ملاك منتج بيانات للمجالات الرئيسية." }, score: 3 },
            { id: "d", label: { en: "Data products with SLAs, contracts, and feedback loops.", ar: "منتجات بيانات بـ SLAs وعقود وحلقات تغذية راجعة." }, score: 4 },
            { id: "e", label: { en: "Federated data mesh with chargeback and discoverability.", ar: "Data mesh اتحادي مع إعادة تحميل تكلفة واكتشاف." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "platform",
      title: { en: "Data Architecture & Platforms", ar: "معمارية ومنصات البيانات" },
      weight: 0.15,
      description: { en: "Lakehouse, mesh, real-time, vector store, sovereign-cloud posture.", ar: "Lakehouse، mesh، الزمن الحقيقي، مخزن متجهات، الوضع السيادي." },
      questions: [
        {
          id: "dafi.p1",
          prompt: { en: "Primary analytic data platform?", ar: "منصة البيانات التحليلية الرئيسية؟" },
          options: [
            { id: "a", label: { en: "Mostly RDBMS / file shares.", ar: "غالباً RDBMS / مشاركات ملفات." }, score: 1 },
            { id: "b", label: { en: "On-prem warehouse.", ar: "مستودع داخلي." }, score: 2 },
            { id: "c", label: { en: "Cloud warehouse + lake.", ar: "مستودع سحابي + بحيرة." }, score: 3 },
            { id: "d", label: { en: "Lakehouse (Databricks/Snowflake/Fabric).", ar: "Lakehouse (Databricks/Snowflake/Fabric)." }, score: 4 },
            { id: "e", label: { en: "Lakehouse + mesh + production vector store + real-time.", ar: "Lakehouse + mesh + مخزن متجهات إنتاجي + زمن حقيقي." }, score: 5 },
          ],
        },
        {
          id: "dafi.p2",
          prompt: { en: "Sovereign / on-prem analytic capability?", ar: "قدرة تحليلية سيادية/داخلية؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا توجد." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Limited; on-prem warehouse only.", ar: "محدود؛ مستودع داخلي فقط." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Hybrid; sensitive data stays sovereign.", ar: "هجين؛ البيانات الحساسة على السيادي." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Sovereign-first lakehouse with public cloud burst.", ar: "Lakehouse سيادي أولاً مع توسعة سحابة عامة." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Multi-region sovereign + air-gapped capability.", ar: "متعدد المناطق سيادي + قدرة معزولة هوائياً." }, score: 5, sovereign: 5 },
          ],
        },
      ],
    },
    {
      id: "mdm",
      title: { en: "Master & Reference Data / Lineage", ar: "البيانات الرئيسية والمرجعية / النسب" },
      weight: 0.15,
      description: { en: "Customer/product/party MDM, lineage tooling, golden source.", ar: "MDM للعميل/المنتج/الطرف، أدوات النسب، المصدر الذهبي." },
      questions: [
        {
          id: "dafi.m1",
          prompt: { en: "Master data on critical entities (customer/party/product)?", ar: "البيانات الرئيسية للكيانات الحرجة؟" },
          options: [
            { id: "a", label: { en: "Multiple sources, no mastering.", ar: "مصادر متعددة بدون توحيد." }, score: 1 },
            { id: "b", label: { en: "Some manual reconciliation.", ar: "بعض التوفيق اليدوي." }, score: 2 },
            { id: "c", label: { en: "MDM tooling for 1–2 domains.", ar: "MDM لمجال أو اثنين." }, score: 3 },
            { id: "d", label: { en: "Mastered customer + product + party.", ar: "موحَّد للعميل + المنتج + الطرف." }, score: 4 },
            { id: "e", label: { en: "AI-assisted mastering with continuous identity resolution.", ar: "توحيد بمساعدة AI مع حل هوية مستمر." }, score: 5 },
          ],
        },
        {
          id: "dafi.m2",
          prompt: { en: "Data lineage tooling?", ar: "أدوات نسب البيانات؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Manual lineage for compliance use cases only.", ar: "نسب يدوي لحالات الامتثال فقط." }, score: 2 },
            { id: "c", label: { en: "Catalog-driven lineage on top platforms.", ar: "نسب بقيادة الكاتالوج على المنصات الرئيسية." }, score: 3 },
            { id: "d", label: { en: "End-to-end automated lineage including BI and ML features.", ar: "نسب آلي شامل يضم BI وميزات ML." }, score: 4 },
            { id: "e", label: { en: "Real-time lineage feeding AI guardrails and impact analysis.", ar: "نسب لحظي يغذي حواجز AI وتحليل الأثر." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "quality",
      title: { en: "Data Quality & Observability", ar: "جودة البيانات والمراقبة" },
      weight: 0.10,
      description: { en: "DQ rules, profiling, SLAs, observability tools.", ar: "قواعد جودة البيانات، التوصيف، SLAs، أدوات المراقبة." },
      questions: [
        {
          id: "dafi.q1",
          prompt: { en: "Data quality measurement?", ar: "قياس جودة البيانات؟" },
          options: [
            { id: "a", label: { en: "None.", ar: "لا يوجد." }, score: 1 },
            { id: "b", label: { en: "Periodic profiling on key tables.", ar: "توصيف دوري للجداول الرئيسية." }, score: 2 },
            { id: "c", label: { en: "DQ rules in critical pipelines.", ar: "قواعد جودة في الأنابيب الحرجة." }, score: 3 },
            { id: "d", label: { en: "DQ SLAs with alerting and accountability.", ar: "SLAs لجودة البيانات مع تنبيه ومساءلة." }, score: 4 },
            { id: "e", label: { en: "Data observability platform with anomaly detection across all critical assets.", ar: "منصة مراقبة بيانات مع كشف الشذوذ عبر جميع الأصول الحرجة." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "governance",
      title: { en: "Data Governance, Privacy & Compliance", ar: "حوكمة البيانات والخصوصية والامتثال" },
      weight: 0.15,
      description: { en: "PDPL, SAMA, CBUAE, SDAIA, classification, consent.", ar: "PDPL، SAMA، CBUAE، SDAIA، التصنيف، الموافقة." },
      questions: [
        {
          id: "dafi.g1",
          prompt: { en: "PDPL (KSA/UAE) compliance posture?", ar: "وضع الامتثال لـ PDPL (السعودية/الإمارات)؟" },
          options: [
            { id: "a", label: { en: "Awareness only.", ar: "وعي فقط." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Gap analysis underway.", ar: "تحليل فجوات قيد التنفيذ." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Controls implemented in major systems.", ar: "ضوابط مطبقة في الأنظمة الرئيسية." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with annual third-party audit.", ar: "امتثال مستمر مع تدقيق سنوي من طرف ثالث." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "PDPL-aware controls embedded by default; attested per release.", ar: "ضوابط واعية بـ PDPL افتراضياً؛ مصدّقة لكل إصدار." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "dafi.g2",
          prompt: { en: "Sectoral compliance (SAMA / CBUAE / SDAIA / NHRA)?", ar: "الامتثال القطاعي (SAMA / CBUAE / SDAIA / NHRA)؟" },
          options: [
            { id: "a", label: { en: "Not applicable or not addressed.", ar: "غير منطبق أو غير معالج." }, score: 1, sovereign: 1 },
            { id: "b", label: { en: "Limited to one regulation set.", ar: "محدود بمجموعة تنظيمية واحدة." }, score: 2, sovereign: 2 },
            { id: "c", label: { en: "Mapped controls across required regulators.", ar: "ضوابط معينة عبر المنظمين المطلوبين." }, score: 3, sovereign: 3 },
            { id: "d", label: { en: "Continuous compliance with regulator-grade reporting.", ar: "امتثال مستمر مع تقارير بمستوى المنظم." }, score: 4, sovereign: 4 },
            { id: "e", label: { en: "Regulator-praised posture; reference engagements published.", ar: "وضع يثني عليه المنظم؛ نشر مرجعيات." }, score: 5, sovereign: 5 },
          ],
        },
        {
          id: "dafi.g3",
          prompt: { en: "Data classification and consent?", ar: "تصنيف البيانات والموافقة؟" },
          options: [
            { id: "a", label: { en: "No formal classification.", ar: "لا تصنيف رسمي." }, score: 1 },
            { id: "b", label: { en: "Manual labels in some systems.", ar: "تسميات يدوية في بعض الأنظمة." }, score: 2 },
            { id: "c", label: { en: "Tag-based classification on critical stores.", ar: "تصنيف بالعلامات على المخازن الحرجة." }, score: 3 },
            { id: "d", label: { en: "Automated classification + consent management.", ar: "تصنيف آلي + إدارة موافقة." }, score: 4 },
            { id: "e", label: { en: "Continuous classification + consent honored across AI inference.", ar: "تصنيف مستمر + احترام الموافقة عبر استدلال AI." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "mlops",
      title: { en: "AI/ML Engineering & MLOps", ar: "هندسة الذكاء الاصطناعي و MLOps" },
      weight: 0.15,
      description: { en: "Feature store, model registry, eval pipelines, GenAI ops.", ar: "متجر الميزات، سجل النماذج، أنابيب التقييم، عمليات GenAI." },
      questions: [
        {
          id: "dafi.o1",
          prompt: { en: "Model registry + lifecycle management?", ar: "سجل النماذج + إدارة دورة الحياة؟" },
          options: [
            { id: "a", label: { en: "None; models live on engineer laptops.", ar: "لا يوجد؛ النماذج على أجهزة المهندسين." }, score: 1 },
            { id: "b", label: { en: "Notebooks committed to git.", ar: "Notebooks في git." }, score: 2 },
            { id: "c", label: { en: "Model registry (MLflow / Vertex / Bedrock).", ar: "سجل نماذج." }, score: 3 },
            { id: "d", label: { en: "Registry + automated promotion + drift monitoring.", ar: "سجل + ترقية آلية + مراقبة انحراف." }, score: 4 },
            { id: "e", label: { en: "End-to-end MLOps incl. GenAI ops, eval suites, prompt registries.", ar: "MLOps شامل بما في ذلك GenAI، تقييمات، سجل أوامر." }, score: 5 },
          ],
        },
        {
          id: "dafi.o2",
          prompt: { en: "Feature store?", ar: "متجر الميزات؟" },
          options: [
            { id: "a", label: { en: "Not used.", ar: "غير مستخدم." }, score: 1 },
            { id: "b", label: { en: "Considering it.", ar: "قيد الدراسة." }, score: 2 },
            { id: "c", label: { en: "Feature store in pilot.", ar: "متجر ميزات تجريبي." }, score: 3 },
            { id: "d", label: { en: "Feature store powering production models.", ar: "متجر ميزات يقود نماذج إنتاج." }, score: 4 },
            { id: "e", label: { en: "Online + offline feature parity with governance.", ar: "تكافؤ ميزات أونلاين/أوفلاين مع حوكمة." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "ethics",
      title: { en: "Trust, Ethics & Responsible AI", ar: "الثقة والأخلاق والذكاء الاصطناعي المسؤول" },
      weight: 0.10,
      description: { en: "Bias testing, explainability, model cards, human oversight.", ar: "اختبار التحيز، القابلية للتفسير، بطاقات النماذج، الإشراف البشري." },
      questions: [
        {
          id: "dafi.e1",
          prompt: { en: "Bias and fairness testing?", ar: "اختبار التحيز والإنصاف؟" },
          options: [
            { id: "a", label: { en: "Not done.", ar: "غير مُجرى." }, score: 1 },
            { id: "b", label: { en: "Manual reviews.", ar: "مراجعات يدوية." }, score: 2 },
            { id: "c", label: { en: "Bias tests on high-risk models.", ar: "اختبارات تحيز للنماذج عالية المخاطر." }, score: 3 },
            { id: "d", label: { en: "Standardized fairness suite gating production.", ar: "مجموعة إنصاف موحدة كبوابة للإنتاج." }, score: 4 },
            { id: "e", label: { en: "Fairness + explainability + monitoring across the model lifecycle.", ar: "إنصاف + تفسير + مراقبة عبر دورة حياة النموذج." }, score: 5 },
          ],
        },
      ],
    },
    {
      id: "literacy",
      title: { en: "Talent, Literacy & Culture", ar: "المواهب والإلمام والثقافة" },
      weight: 0.05,
      description: { en: "Data literacy, citizen-developer enablement, hiring pipeline.", ar: "إلمام البيانات، تمكين المطور المواطن، خط التوظيف." },
      questions: [
        {
          id: "dafi.l1",
          prompt: { en: "Enterprise data literacy?", ar: "إلمام البيانات على مستوى المؤسسة؟" },
          options: [
            { id: "a", label: { en: "Low; tools used by specialists only.", ar: "منخفض؛ تستخدمها فئات متخصصة فقط." }, score: 1 },
            { id: "b", label: { en: "Some BI self-service for analysts.", ar: "بعض BI الذاتي للمحللين." }, score: 2 },
            { id: "c", label: { en: "Citizen-developer enablement + training tracks.", ar: "تمكين المطور المواطن + مسارات تدريب." }, score: 3 },
            { id: "d", label: { en: "Data literacy KPIs by function.", ar: "مؤشرات إلمام بالبيانات حسب الوظيفة." }, score: 4 },
            { id: "e", label: { en: "Data + AI fluency considered baseline for every hire.", ar: "إلمام بالبيانات والذكاء الاصطناعي كأساس لكل توظيف." }, score: 5 },
          ],
        },
      ],
    },
  ],
  recommendations: {
    strategy: {
      Nascent: {
        quickWins90d: [{ en: "Appoint a CDO with explicit P&L authority and ExCo seat.", ar: "تعيين CDO بصلاحية P&L ومقعد في ExCo." }],
        roadmap6m: [{ en: "Define data products on top 5 domains with SLAs and contracts.", ar: "تعريف منتجات بيانات لأهم 5 مجالات بـ SLAs وعقود." }],
        strategic12m: [{ en: "Stand up a federated data mesh with chargeback and discoverability.", ar: "تأسيس data mesh اتحادي مع إعادة تحميل واكتشاف." }],
      },
    },
    platform: {
      Nascent: {
        quickWins90d: [{ en: "Stand up a managed lakehouse (Databricks / Fabric) for one priority domain.", ar: "تأسيس lakehouse مُدار لمجال أولوية واحد." }],
        roadmap6m: [{ en: "Adopt sovereign-first hybrid posture for sensitive data.", ar: "اعتماد وضع هجين سيادي أولاً للبيانات الحساسة." }],
        strategic12m: [{ en: "Production vector store + real-time pipelines feeding agents.", ar: "مخزن متجهات إنتاج + أنابيب لحظية تغذي الوكلاء." }],
      },
    },
    mdm: {
      Nascent: {
        quickWins90d: [{ en: "Run identity-resolution proof on customer entity in 60 days.", ar: "إثبات حل هوية للعميل خلال 60 يوماً." }],
        roadmap6m: [{ en: "Mastered customer + product domains live.", ar: "توحيد مجالات العميل والمنتج في الإنتاج." }],
        strategic12m: [{ en: "AI-assisted mastering + automated lineage feeding AI guardrails.", ar: "توحيد بمساعدة AI + نسب آلي يغذي حواجز AI." }],
      },
    },
    quality: {
      Nascent: {
        quickWins90d: [{ en: "Wire DQ rules into the top 3 critical pipelines.", ar: "وصل قواعد جودة في أهم 3 أنابيب." }],
        roadmap6m: [{ en: "Stand up DQ SLAs with alerting and accountability.", ar: "تأسيس SLAs لجودة البيانات مع تنبيه ومساءلة." }],
        strategic12m: [{ en: "Adopt a data observability platform with anomaly detection.", ar: "تبنّي منصة مراقبة بيانات مع كشف شذوذ." }],
      },
    },
    governance: {
      Nascent: {
        quickWins90d: [{ en: "Complete a PDPL gap analysis across the top 5 systems.", ar: "إكمال تحليل فجوات PDPL لأعلى 5 أنظمة." }],
        roadmap6m: [{ en: "Implement automated classification + consent management.", ar: "تطبيق تصنيف آلي + إدارة موافقة." }],
        strategic12m: [{ en: "PDPL/SAMA/CBUAE-aware controls attested per release.", ar: "ضوابط واعية بالأنظمة مصدّقة لكل إصدار." }],
      },
      Emerging: {
        quickWins90d: [{ en: "Map controls across all required regulators in 60 days.", ar: "ربط الضوابط بكل المنظمين خلال 60 يوماً." }],
        roadmap6m: [{ en: "Stand up regulator-grade reporting and quarterly attestations.", ar: "تقارير بمستوى المنظم وشهادات ربع سنوية." }],
        strategic12m: [{ en: "Become a published regulator reference for AI governance posture.", ar: "أن تصبحوا مرجعاً منشوراً للمنظم في حوكمة AI." }],
      },
    },
    mlops: {
      Nascent: {
        quickWins90d: [{ en: "Adopt a model registry (MLflow / Vertex / Bedrock) for all production models.", ar: "تبنّي سجل نماذج لكل النماذج الإنتاجية." }],
        roadmap6m: [{ en: "Add automated promotion + drift monitoring + GenAI eval suites.", ar: "إضافة ترقية آلية + مراقبة انحراف + تقييمات GenAI." }],
        strategic12m: [{ en: "End-to-end MLOps incl. prompt registries and feature store parity.", ar: "MLOps شامل يضم سجل أوامر وتكافؤ ميزات." }],
      },
    },
    ethics: {
      Nascent: {
        quickWins90d: [{ en: "Standardize a fairness suite for high-risk models gating production.", ar: "توحيد مجموعة إنصاف للنماذج عالية المخاطر كبوابة." }],
        roadmap6m: [{ en: "Add explainability + monitoring across the model lifecycle.", ar: "إضافة تفسير + مراقبة عبر دورة حياة النموذج." }],
        strategic12m: [{ en: "Publish a Maven AI Verified responsible-AI report annually.", ar: "نشر تقرير Maven AI Verified للذكاء المسؤول سنوياً." }],
      },
    },
    literacy: {
      Nascent: {
        quickWins90d: [{ en: "Mandatory data literacy baseline for all managers within 90 days.", ar: "تدريب أساسي إلزامي لإلمام البيانات لجميع المديرين." }],
        roadmap6m: [{ en: "Stand up citizen-developer paths with funded training.", ar: "مسارات مطور مواطن بتدريب ممول." }],
        strategic12m: [{ en: "Data + AI fluency in every job description.", ar: "إلمام بالبيانات والذكاء في كل توصيف وظيفة." }],
      },
    },
  },
};
