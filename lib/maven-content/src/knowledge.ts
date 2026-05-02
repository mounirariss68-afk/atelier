/**
 * Maven AI knowledge base — used by:
 *  - the chat assistant on the server (system-prompt grounding)
 *  - the chat widget on the client (suggestion cards / linking)
 *
 * Keep this lean: titles, slugs, one-line summaries, audience.
 * For long-form content (HTML, vignettes), refer the user to the
 * canonical pages. The chat assistant must never invent a slug.
 */

export interface ServiceEntry {
  slug: string;
  title: string;
  tagline: string;
  buyer: string;
  summary: string;
}

export interface IndustryEntry {
  id: string;
  title: string;
  subtitle: string;
}

export interface InsightEntry {
  slug: string;
  title: string;
  category: string;
  type: string;
  summary: string;
}

export interface AssessmentEntry {
  slug: "ari" | "mvi" | "dafi" | "uvr";
  code: string;
  name: string;
  summary: string;
  estMinutes: number;
}

export interface FounderEntry {
  name: string;
  title: string;
  location: string;
  summary: string;
}

export type MarketplaceClass =
  | "value-realization"
  | "pmo-delivery-copilot"
  | "supply-chain-agent"
  | "fpa-forecaster"
  | "customer-ops-agent"
  | "knowledge-decision-copilot"
  | "risk-compliance-agent"
  | "sovereign-data-workbench";

export type MarketplaceHorizontal = "pmo" | "supply-chain" | "fpa";

export type MarketplaceStatus = "live" | "coming-soon";

/** Bilingual string used by every marketplace tool field. */
export interface BiText {
  en: string;
  ar: string;
}

export interface MarketplaceScreen {
  title: BiText;
  caption: BiText;
}

export interface MarketplaceDataModel {
  inputs: BiText[];
  internal: BiText[];
  outputs: BiText[];
}

export interface MarketplaceToolEntry {
  /** Stable id (matches slug). */
  id: string;
  /** URL slug under /marketplace/:slug. */
  slug: string;
  title: BiText;
  /** Demo class — drives the class filter on the index. */
  class: MarketplaceClass;
  /** Industries this tool serves (uses IndustryEntry.id). */
  industries: string[];
  /** Horizontal disciplines this tool serves. */
  horizontals: MarketplaceHorizontal[];
  /** Named buyer — surfaced on cards and in the chat prompt. */
  buyer: BiText;
  /** One-line pitch. */
  pitch: BiText;
  /** Three-paragraph longer description (rendered on the detail page). */
  longDescription: BiText[];
  /** Captioned screen descriptions. 3–5 per tool. */
  screens: MarketplaceScreen[];
  /** Data model bullets shown on the detail page. */
  dataModel: MarketplaceDataModel;
  /** Live = interactive demo lives at /marketplace/:slug. Coming-soon = detail page only. */
  status: MarketplaceStatus;
  /** Hex accent colour used for chips and card spines. */
  accent: string;
  /** Lucide icon name (resolved on the client). */
  icon: string;
  /** Relevant Maven AI service slug, used for cross-linking on the detail page. */
  relatedService?: string;
  /** Relevant assessment slug, used for cross-linking on the detail page. */
  relatedAssessment?: AssessmentEntry["slug"];
  /**
   * Sample portfolio used by the live Value Realization demo. Set ONLY on
   * the value-realization tool — the demo reads it as its canonical sample
   * dataset so the same numbers are also visible to the chat assistant via
   * the shared knowledge module.
   */
  samplePortfolio?: ValueRealizationInitiative[];
}

export type ValueInitiativeType = "cost-out" | "revenue" | "risk" | "experience";

export type ValueInitiativeStatus = "idea" | "pilot" | "scaling" | "in-production";

export interface ValueRealizationInitiative {
  id: string;
  name: BiText;
  businessUnit: BiText;
  /** What kind of value this initiative claims. */
  type: ValueInitiativeType;
  /** Cumulative AED invested in the initiative to date. */
  investedToDate: number;
  /** Annualised AED value the business case promised. */
  expectedAnnualValue: number;
  /** Annualised AED value the P&L is currently seeing (run-rate). */
  realizedAnnualValue: number;
  /** Sponsor's confidence the realised value will hold (0–100 %). */
  confidence: number;
  status: ValueInitiativeStatus;
  /** ISO date (YYYY-MM-DD) the initiative kicked off. */
  startDate: string;
  /** ISO date the initiative went live in production (or its planned date). */
  goLiveDate: string;
}

export interface MarketplaceClassMeta {
  id: MarketplaceClass;
  title: BiText;
  description: BiText;
}

export interface MarketplaceHorizontalMeta {
  id: MarketplaceHorizontal;
  title: BiText;
}

export const services: ServiceEntry[] = [
  {
    slug: "agentic-ai-transformation",
    title: "Agentic AI Transformation",
    tagline: "Reimagining operations with agents at the core",
    buyer: "CEO, COO, CXO",
    summary:
      "Production AI agents that own end-to-end work — deciding, acting, learning, coordinating with humans. Not chatbots, not workflows. 90 days from kickoff to production MVP.",
  },
  {
    slug: "ai-driven-sdlc",
    title: "AI-Driven SDLC & Legacy Modernization",
    tagline: "Unlock your legacy — AI-first, on-prem capable",
    buyer: "CIO, CTO",
    summary:
      "Spec-from-legacy methodology: AI-driven extraction and re-engineering of Siebel, COBOL, legacy Java estates. 40–60% SDLC reduction. Sovereign on-prem capable.",
  },
  {
    slug: "data-governance-foundations",
    title: "Data & Governance Foundations",
    tagline: "The foundation that makes AI trustworthy",
    buyer: "CDO, CRO",
    summary:
      "Data platforms, lineage, mastering, and governance frameworks engineered (not advised) so AI agents are trustworthy. Aligned to UAE AI Charter, Saudi PDPL, SAMA.",
  },
  {
    slug: "ai-product-studio",
    title: "AI Product Studio",
    tagline: "From idea to production in 90 days",
    buyer: "CXO, Business Heads",
    summary:
      "Productized AI: regulatory intelligence, procurement intelligence, HR-ops AI, smart-contract analysis. 90-day MVP, reusable IP that compounds margin.",
  },
];

export const industries: IndustryEntry[] = [
  { id: "public-sector", title: "Public Sector", subtitle: "Accelerating national vision through production AI" },
  { id: "telecom", title: "Telecommunications", subtitle: "From legacy infrastructure to AI-native operations" },
  { id: "financial-services", title: "Financial Services", subtitle: "AI-grade governance for the region's most demanding regulators" },
  { id: "energy-commodities", title: "Energy & Commodities", subtitle: "Powering the energy transition with production AI" },
  { id: "retail-consumer", title: "Retail & Consumer Products", subtitle: "From dukan to D2C — AI-native retail for the GCC consumer" },
  { id: "travel-hospitality", title: "Travel & Hospitality", subtitle: "AI for the GCC's tourism megaprojects and global hospitality brands" },
  { id: "automotive", title: "Automotive", subtitle: "Building the GCC's mobility future, from EV mandates to autonomous" },
];

export const insights: InsightEntry[] = [
  {
    slug: "the-agentic-enterprise",
    title: "The Agentic Enterprise: From Pilot to Production",
    category: "Agentic AI",
    type: "Report",
    summary:
      "MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact. We examine the four-layer architecture (Value Case, Data & AI Foundations, Agentic AI, Change Management) that closes the gap.",
  },
  {
    slug: "ai-governance-gulf",
    title: "AI Governance in the Gulf: Building Trust at Scale",
    category: "Data & Governance",
    type: "Report",
    summary:
      "Governance frameworks for enterprise-grade AI deployment in the GCC, aligned to UAE AI Charter, Saudi PDPL, and SAMA guidelines.",
  },
  {
    slug: "legacy-modernization-playbook",
    title: "Legacy Modernization Playbook: AI-Driven SDLC for GCC Enterprises",
    category: "Legacy Modernization",
    type: "Report",
    summary:
      "The spec-from-legacy methodology that unlocks modernization for GCC enterprises — sovereign, on-prem capable delivery for national security environments.",
  },
  {
    slug: "gcc-ai-spending-outlook",
    title: "GCC AI Spending Outlook 2025–2030",
    category: "Industry Trends",
    type: "Research Report",
    summary:
      "Data-rich analysis of AI investment trends across GCC public sector, telecom, and financial services — spending forecasts through 2030.",
  },
  {
    slug: "agentic-workforce",
    title: "The Agentic Workforce: Human-AI Collaboration in Public Sector Operations",
    category: "Agentic AI",
    type: "Perspective",
    summary:
      "How GCC government entities can redesign operating models around human-AI collaboration — from AI tools to AI teammates that own work end-to-end.",
  },
  {
    slug: "cdo-to-cao",
    title: "From CDO to CAO: Rethinking the Chief Data Officer Role in the Age of AI",
    category: "Data & Governance",
    type: "Opinion",
    summary:
      "The CDO role was defined for a world that no longer exists. The new mandate — Chief AI Officer or Chief Analytics Officer — requires a different skillset and organizational mandate.",
  },
  {
    slug: "sovereign-ai",
    title: "Building Sovereign AI: On-Prem Agentic Deployment for National Security Clients",
    category: "Agentic AI",
    type: "Technical Brief",
    summary:
      "A technical framework for deploying production-grade agentic AI in air-gapped, sovereign data environments — without compromising capability or security posture.",
  },
  {
    slug: "90-day-mvp",
    title: "The 90-Day MVP: How Boutique AI Firms Outpace Tier-1 Consultancies",
    category: "Industry Trends",
    type: "Thought Leadership",
    summary:
      "Why lean, senior-delivery AI firms consistently outperform Tier-1 competitors on the dimension that matters most: time from contract to working software in production.",
  },
];

// Source assessment metadata from the canonical @workspace/assessments
// definitions so slug/code/name/estMinutes can never drift between the
// scoring engine and the chat knowledge base. The one-line `summary` copy
// is the only thing local to this file (the assessments lib doesn't carry
// chat-tuned summaries).
import { assessmentsList } from "@workspace/assessments";

const ASSESSMENT_SUMMARIES: Record<string, string> = {
  ari: "Diagnoses how ready your organisation is to move agentic AI from pilot to production. 8 dimensions, ~12 minutes.",
  mvi: "Rates the velocity at which your legacy estate can be modernised with AI-driven SDLC and spec-from-legacy. ~10 minutes.",
  dafi: "Scores the data readiness, lineage, mastering, and governance posture beneath your AI ambition. ~14 minutes.",
  uvr: "A short rating of any single AI use case — value, feasibility, governance fit. ~6 minutes.",
};

export const assessments: AssessmentEntry[] = assessmentsList.map((a) => ({
  slug: a.slug,
  code: a.code,
  name: a.title.en,
  summary: ASSESSMENT_SUMMARIES[a.slug] ?? a.description.en,
  estMinutes: a.estMinutes,
}));

export const founders: FounderEntry[] = [
  {
    name: "Mounir Aris",
    title: "Senior Partner",
    location: "Dubai, UAE",
    summary:
      "20+ years in strategy and AI transformation across GCC. Former Big-4 Partner. Advises sovereign funds and government ministries.",
  },
  {
    name: "Gokhan Guney",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    summary:
      "15+ years in enterprise AI engineering. Expert in agentic AI platforms, LLM orchestration, and sovereign on-prem AI.",
  },
  {
    name: "Alper Kulak",
    title: "Senior Partner",
    location: "Dubai, UAE",
    summary:
      "Data platform and AI governance expert. 15+ years building data foundations for GCC telecoms, banks, and government.",
  },
  {
    name: "Khalid Al Khudairi",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    summary:
      "KSA Vision 2030 advisor with deep PIF and government relationships. 12+ years in AI adoption and organisational transformation.",
  },
];

export interface HomepageStat {
  value: string;
  label: string;
  source: { name: string; year: number; url: string };
}

/**
 * Canonical homepage hero stats. Each is a real, sourced figure from the
 * published GCC AI research that Maven Insights tracks — the same body of
 * evidence cited across the industries pages — so the home page carries the
 * same evidentiary weight as the rest of the site.
 */
export const homepageStats: HomepageStat[] = [
  {
    value: "$320B",
    label: "projected economic gains from AI across the Middle East by 2030",
    source: {
      name: "PwC Middle East — The potential impact of AI in the Middle East",
      year: 2018,
      url: "https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html",
    },
  },
  {
    value: "$23.5B",
    label: "annual GenAI economic impact projected across the GCC by 2030",
    source: {
      name: "Strategy& — Reshaping the Middle East: A CEO's playbook to win the $23.5B GenAI opportunity",
      year: 2023,
      url: "https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping.html",
    },
  },
  {
    value: "$22.4B",
    label: "projected total GCC AI market size by 2033",
    source: {
      name: "IMARC Group — GCC Artificial Intelligence Market 2025–2033",
      year: 2024,
      url: "https://www.imarcgroup.com/gcc-artificial-intelligence-market",
    },
  },
];

export const marketplaceClasses: MarketplaceClassMeta[] = [
  {
    id: "value-realization",
    title: { en: "Value Realization", ar: "تحقيق القيمة" },
    description: {
      en: "Tracks realised vs expected $ impact across an AI portfolio. The CFO-grade scoreboard for an enterprise AI book of work.",
      ar: "يتتبع القيمة المحققة مقابل المتوقعة عبر محفظة الذكاء الاصطناعي — لوحة قياس بمستوى المدير المالي.",
    },
  },
  {
    id: "pmo-delivery-copilot",
    title: { en: "PMO & Delivery Copilot", ar: "مساعد إدارة البرامج والتسليم" },
    description: {
      en: "Programme health, RAID surfacing, and steering-pack drafting for enterprise EPMOs.",
      ar: "صحة البرنامج ورصد المخاطر وصياغة عبوات التوجيه لمكاتب البرامج المؤسسية.",
    },
  },
  {
    id: "supply-chain-agent",
    title: { en: "Supply Chain Agent", ar: "وكيل سلسلة التوريد" },
    description: {
      en: "Demand sensing, supplier-risk scoring, and expediting agents for procurement and supply chain leaders.",
      ar: "استشعار الطلب وتصنيف مخاطر الموردين ووكلاء التسريع لقادة المشتريات وسلاسل التوريد.",
    },
  },
  {
    id: "fpa-forecaster",
    title: { en: "FP&A Forecaster", ar: "متنبئ التخطيط والتحليل المالي" },
    description: {
      en: "Driver-based rolling forecasts, variance commentary, and scenario flexing for finance teams.",
      ar: "تنبؤات متجددة قائمة على المحركات وتعليقات الانحرافات وتمرين السيناريوهات لفِرق المالية.",
    },
  },
  {
    id: "customer-ops-agent",
    title: { en: "Customer Ops Agent", ar: "وكيل عمليات العملاء" },
    description: {
      en: "Bilingual EN/AR multi-channel customer agents with cost-to-serve telemetry and quality assurance.",
      ar: "وكلاء عملاء متعددو القنوات بالعربية والإنجليزية مع قياسات التكلفة وضمان الجودة.",
    },
  },
  {
    id: "knowledge-decision-copilot",
    title: { en: "Knowledge & Decision Copilot", ar: "مساعد المعرفة والقرار" },
    description: {
      en: "Grounded internal Q&A with citation trails — the operating memory of the firm.",
      ar: "إجابات داخلية موثوقة مع مراجع مصدرية — الذاكرة التشغيلية للمؤسسة.",
    },
  },
  {
    id: "risk-compliance-agent",
    title: { en: "Risk & Compliance Agent", ar: "وكيل المخاطر والامتثال" },
    description: {
      en: "Continuous monitoring against SAMA, PDPL, and the UAE AI Charter, with audit-ready evidence packs.",
      ar: "مراقبة مستمرة وفق ساما ولوائح حماية البيانات وميثاق الإمارات للذكاء الاصطناعي مع حزم أدلة للتدقيق.",
    },
  },
  {
    id: "sovereign-data-workbench",
    title: { en: "Sovereign Data Workbench", ar: "منصة البيانات السيادية" },
    description: {
      en: "Air-gapped agentic data engineering, lineage, and mastering for sovereign and on-prem environments.",
      ar: "هندسة بيانات وكيلية معزولة وتتبع نسب البيانات وضبطها للبيئات السيادية والداخلية.",
    },
  },
];

export const marketplaceHorizontals: MarketplaceHorizontalMeta[] = [
  { id: "pmo", title: { en: "PMO", ar: "مكتب إدارة المشاريع" } },
  { id: "supply-chain", title: { en: "Supply Chain", ar: "سلسلة التوريد" } },
  { id: "fpa", title: { en: "FP&A", ar: "التخطيط والتحليل المالي" } },
];

export const marketplaceTools: MarketplaceToolEntry[] = [
  {
    id: "value-realization",
    slug: "value-realization",
    title: { en: "Value Realization Tool", ar: "أداة تحقيق القيمة" },
    class: "value-realization",
    industries: [
      "public-sector",
      "telecom",
      "financial-services",
      "energy-commodities",
      "retail-consumer",
      "travel-hospitality",
      "automotive",
    ],
    horizontals: ["pmo", "fpa"],
    buyer: { en: "CFO, COO", ar: "المدير المالي، المدير التنفيذي للعمليات" },
    pitch: {
      en: "The CFO-grade scoreboard for an enterprise AI portfolio — realised vs expected value, value-at-risk, ROI gauge, time-to-value, and a leakage callout that names the bleeding initiatives.",
      ar: "لوحة قياس بمستوى المدير المالي لمحفظة ذكاء اصطناعي مؤسسية — القيمة المحققة مقابل المتوقعة، والقيمة المعرضة للخطر، ومقياس العائد، والزمن حتى القيمة، ومؤشر تسرّب القيمة.",
    },
    longDescription: [
      {
        en: "The Value Realization Tool answers the one question every CFO asks an AI portfolio: am I getting the dollars I was promised? It tracks expected value, realised value, and value-at-risk for every initiative in the book of work, then aggregates the picture into a single scoreboard the CFO can defend in a board meeting.",
        ar: "تجيب أداة تحقيق القيمة على السؤال الذي يطرحه كل مدير مالي على محفظة الذكاء الاصطناعي: هل أحصل على الدولارات التي وُعدت بها؟ تتعقّب الأداة القيمة المتوقعة والقيمة المحققة والقيمة المعرضة للخطر لكل مبادرة في كتاب العمل، ثم تجمّع الصورة في لوحة قياس واحدة يستطيع المدير المالي الدفاع عنها في اجتماع مجلس الإدارة.",
      },
      {
        en: "Every initiative card opens a drawer. Drag the realised-value slider, change the status, edit the risk drivers — the charts and the leakage callout re-render live. The Reset to sample button restores the canonical Maven demo book of work so you can hand the tool to a colleague without losing the demo state.",
        ar: "تفتح كل بطاقة مبادرة درجاً. اسحب شريط القيمة المحققة، وغيّر الحالة، وعدّل عوامل المخاطرة — وتُعاد رسم المخططات ومؤشر التسرّب فوراً. يستعيد زر «إعادة تعيين إلى العيّنة» كتاب العمل التجريبي القياسي حتى يمكنك تسليم الأداة لزميل دون أن تفقد حالة العرض.",
      },
      {
        en: "Built on Maven Insights' UVR scoring engine. The same value-realisation lens we use inside our delivery engagements, exposed in the browser so you can pressure-test it against your own portfolio before booking a partner readout.",
        ar: "مبنية على محرك تصنيف UVR من Maven Insights. هي العدسة نفسها التي نستخدمها داخل ارتباطات التسليم، مكشوفة في المتصفّح لتختبرها على محفظتك قبل حجز جلسة مع شريك.",
      },
    ],
    screens: [
      {
        title: { en: "Portfolio scoreboard", ar: "لوحة قياس المحفظة" },
        caption: {
          en: "Realised vs expected value across the entire book of work, with ROI gauge, time-to-value, and total value-at-risk.",
          ar: "القيمة المحققة مقابل المتوقعة عبر كامل كتاب العمل، مع مقياس العائد والزمن حتى القيمة وإجمالي القيمة المعرضة للخطر.",
        },
      },
      {
        title: { en: "Initiative drawer", ar: "درج المبادرة" },
        caption: {
          en: "Every card opens an editable drawer — sliders for expected $, realised $, and confidence; chips for status and risk drivers.",
          ar: "تفتح كل بطاقة درجاً قابلاً للتحرير — أشرطة للتوقعات والقيمة المحققة والثقة، وشارات للحالة وعوامل المخاطرة.",
        },
      },
      {
        title: { en: "Value leakage callout", ar: "مؤشر تسرّب القيمة" },
        caption: {
          en: "Names the initiatives bleeding the most expected value and the dominant reason — stalled rollout, governance block, or scope creep.",
          ar: "يحدّد المبادرات الأكثر تسرباً للقيمة المتوقعة والسبب الغالب — تعثّر الإطلاق أو حواجز الحوكمة أو توسّع النطاق.",
        },
      },
      {
        title: { en: "Printable CFO summary", ar: "ملخّص قابل للطباعة للمدير المالي" },
        caption: {
          en: "Print-styled one-pager built for the board pack. Numbers carry the same provenance the dashboard uses.",
          ar: "صفحة واحدة بنمط الطباعة معدّة لحزمة مجلس الإدارة، بنفس مصدر الأرقام التي تستخدمها لوحة القياس.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Initiative metadata: name, sponsor, business unit, target outcome", ar: "بيانات المبادرة: الاسم، الراعي، وحدة العمل، النتيجة المستهدفة" },
        { en: "Expected value (USD), realised value to date (USD), confidence band", ar: "القيمة المتوقعة (دولار)، والقيمة المحققة حتى تاريخه (دولار)، ومستوى الثقة" },
        { en: "Time-to-value milestones and current status (on-track / at-risk / stalled / done)", ar: "محطات الزمن حتى القيمة والحالة الحالية (على المسار / معرّض للخطر / متعثّر / مكتمل)" },
      ],
      internal: [
        { en: "UVR scoring engine — value, feasibility, governance fit", ar: "محرك تصنيف UVR — القيمة، الجدوى، توافق الحوكمة" },
        { en: "Leakage rules: stalled status, large delta vs expected, governance block, missed milestone", ar: "قواعد التسرّب: التعثّر، الفرق الكبير عن المتوقع، حواجز الحوكمة، تفويت المحطّات" },
        { en: "Browser-local edits — no backend persistence; Reset to sample restores demo state", ar: "تعديلات محلية في المتصفّح — دون تخزين على الخادم؛ يعيد زرّ إعادة التعيين الحالة التجريبية" },
      ],
      outputs: [
        { en: "Portfolio ROI %, total realised vs expected, total value-at-risk", ar: "نسبة العائد على المحفظة، إجمالي القيمة المحققة مقابل المتوقعة، إجمالي القيمة المعرضة للخطر" },
        { en: "Per-initiative leakage callouts with dominant cause", ar: "مؤشّرات تسرّب لكل مبادرة مع السبب الغالب" },
        { en: "Printable CFO one-pager", ar: "صفحة ملخّص قابلة للطباعة للمدير المالي" },
      ],
    },
    status: "live",
    accent: "#F5A623",
    icon: "TrendingUp",
    relatedService: "agentic-ai-transformation",
    relatedAssessment: "uvr",
    samplePortfolio: [
      {
        id: "vr-citizen-services",
        name: { en: "Citizen-services agent (front line)", ar: "وكيل الخدمات الحكومية للجمهور" },
        businessUnit: { en: "Digital Government", ar: "الحكومة الرقمية" },
        type: "cost-out",
        investedToDate: 1_200_000,
        expectedAnnualValue: 4_200_000,
        realizedAnnualValue: 3_350_000,
        confidence: 80,
        status: "in-production",
        startDate: "2025-05-15",
        goLiveDate: "2025-09-01",
      },
      {
        id: "vr-network-ops",
        name: { en: "Network-ops copilot (RAN tier-1)", ar: "مساعد عمليات الشبكة (الطبقة الأولى من RAN)" },
        businessUnit: { en: "Network Operations", ar: "عمليات الشبكة" },
        type: "cost-out",
        investedToDate: 1_800_000,
        expectedAnnualValue: 6_800_000,
        realizedAnnualValue: 4_600_000,
        confidence: 75,
        status: "in-production",
        startDate: "2025-08-01",
        goLiveDate: "2025-12-01",
      },
      {
        id: "vr-sama-compliance",
        name: { en: "SAMA compliance copilot", ar: "مساعد الالتزام لمؤسسة النقد السعودي" },
        businessUnit: { en: "Risk & Compliance", ar: "المخاطر والالتزام" },
        type: "risk",
        investedToDate: 900_000,
        expectedAnnualValue: 2_400_000,
        realizedAnnualValue: 1_900_000,
        confidence: 90,
        status: "in-production",
        startDate: "2025-04-01",
        goLiveDate: "2025-07-15",
      },
      {
        id: "vr-procurement-intel",
        name: { en: "Procurement intelligence", ar: "ذكاء المشتريات" },
        businessUnit: { en: "Group Procurement", ar: "المشتريات للمجموعة" },
        type: "cost-out",
        investedToDate: 2_100_000,
        expectedAnnualValue: 9_500_000,
        realizedAnnualValue: 5_200_000,
        confidence: 60,
        status: "scaling",
        startDate: "2025-09-01",
        goLiveDate: "2025-12-15",
      },
      {
        id: "vr-demand-forecaster",
        name: { en: "Demand forecaster (grocery)", ar: "متنبّئ الطلب (السلع الغذائية)" },
        businessUnit: { en: "Supply Chain", ar: "سلسلة الإمداد" },
        type: "revenue",
        investedToDate: 800_000,
        expectedAnnualValue: 3_100_000,
        realizedAnnualValue: 1_400_000,
        confidence: 65,
        status: "pilot",
        startDate: "2025-08-15",
        goLiveDate: "2026-02-01",
      },
      {
        id: "vr-hospitality-revenue",
        name: { en: "Hospitality revenue optimizer", ar: "محسّن إيرادات الضيافة" },
        businessUnit: { en: "Cluster Revenue Mgmt", ar: "إدارة إيرادات المجمّع الفندقي" },
        type: "revenue",
        investedToDate: 700_000,
        expectedAnnualValue: 5_400_000,
        realizedAnnualValue: 0,
        confidence: 40,
        status: "pilot",
        startDate: "2025-09-01",
        goLiveDate: "2026-08-01",
      },
    ],
  },
  {
    id: "programme-health-copilot",
    slug: "programme-health-copilot",
    title: { en: "Programme Health Copilot", ar: "مساعد صحة البرنامج" },
    class: "pmo-delivery-copilot",
    industries: [
      "public-sector",
      "telecom",
      "financial-services",
      "energy-commodities",
      "retail-consumer",
      "travel-hospitality",
      "automotive",
    ],
    horizontals: ["pmo"],
    buyer: { en: "Head of EPMO", ar: "رئيس مكتب إدارة البرامج المؤسسية" },
    pitch: {
      en: "Auto-RAG over Jira, MS Project, Confluence and email — drafts the weekly steering pack: status, RAID delta, forecast cone, ask. The buyer keeps the pen; the agent loads the gun.",
      ar: "يقوم بقراءة جيرا وMS Project وConfluence والبريد لصياغة عبوة التوجيه الأسبوعية: الحالة، تغيّرات RAID، مخروط التنبؤ، الطلب. يحتفظ المشتري بالقلم؛ والوكيل يجهّز الذخيرة.",
    },
    longDescription: [
      {
        en: "Programme Health Copilot reads everything an EPMO already has — Jira tickets, MS Project plans, Confluence pages, status emails — and produces a defensible weekly steering pack: programme status, RAID delta since last week, ETC re-baseline, and the single ask the steering committee needs to decide.",
        ar: "يقرأ مساعد صحة البرنامج كلّ ما لدى مكتب البرامج بالفعل — تذاكر جيرا، وخطط MS Project، وصفحات Confluence، ورسائل البريد — وينتج عبوة توجيه أسبوعية قابلة للدفاع: حالة البرنامج، وتغيّرات سجل المخاطر منذ الأسبوع الماضي، وإعادة معايرة التقدير حتى الإكمال، والطلب الواحد الذي تحتاج لجنة التوجيه إلى البتّ فيه.",
      },
      {
        en: "The agent never sends the pack on your behalf. It hands you a draft. The PMO lead edits it, signs it, owns it. That separation is what makes it deployable inside Tier-1 GCC programmes that cannot tolerate an AI committing the steering committee in writing.",
        ar: "لا يرسل الوكيل العبوة نيابةً عنك. بل يسلّمك مسوّدة. ثم يحرّرها قائد PMO، ويوقّعها، ويتحمّل مسؤوليتها. هذا الفصل هو ما يجعلها قابلة للنشر داخل البرامج الكبرى في الخليج التي لا تحتمل أن يلزمها ذكاء اصطناعي كتابياً.",
      },
      {
        en: "Built on a programme ontology that maps RAID logs, milestone plans, and status narratives across MS Project, Jira, Asana and Smartsheet. Reusable IP that compresses status time by 70% in pilots.",
        ar: "مبنيّ على أنطولوجيا برنامج تربط سجلات RAID وخطط المحطّات والروايات النصّية عبر MS Project وJira وAsana وSmartsheet. ملكية فكرية معاد استخدامها تختصر زمن إعداد التقارير 70% في التجارب.",
      },
    ],
    screens: [
      {
        title: { en: "Programme heatmap", ar: "خريطة حرارية للبرنامج" },
        caption: {
          en: "RAG status across workstreams with the RAID delta from last week pinned to each tile.",
          ar: "حالة أحمر/أصفر/أخضر عبر مسارات العمل مع تغيّرات RAID منذ الأسبوع الماضي مثبّتة على كل مربّع.",
        },
      },
      {
        title: { en: "Steering pack draft", ar: "مسوّدة عبوة التوجيه" },
        caption: {
          en: "A drafted slide deck — status, RAID, asks — with every claim cited back to the source ticket or document.",
          ar: "مسوّدة عرض شرائح — الحالة، RAID، الطلبات — مع توثيق كل ادعاء إلى التذكرة أو الوثيقة المصدرية.",
        },
      },
      {
        title: { en: "Forecast cone", ar: "مخروط التنبؤ" },
        caption: {
          en: "Re-baselined estimate-to-complete with explicit confidence bands the agent can defend in writing.",
          ar: "إعادة معايرة لتقدير الوقت حتى الإكمال مع مستويات ثقة صريحة يمكن للوكيل الدفاع عنها كتابياً.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Jira / MS Project / Asana / Smartsheet via API", ar: "Jira وMS Project وAsana وSmartsheet عبر واجهات البرمجة" },
        { en: "Confluence / SharePoint pages and status emails", ar: "صفحات Confluence وSharePoint ورسائل الحالة" },
      ],
      internal: [
        { en: "Programme ontology, RAID classifier, ETC re-baseline model", ar: "أنطولوجيا البرنامج، مصنّف RAID، نموذج إعادة معايرة التقدير حتى الإكمال" },
      ],
      outputs: [
        { en: "Weekly steering pack draft (PowerPoint or Google Slides)", ar: "مسوّدة عبوة توجيه أسبوعية (باوربوينت أو Google Slides)" },
        { en: "RAID delta log, ETC forecast, and the single recommended ask", ar: "سجل تغيّرات RAID، تنبؤ التقدير حتى الإكمال، والطلب الموصى به" },
      ],
    },
    status: "live",
    accent: "#156082",
    icon: "ClipboardList",
    relatedService: "agentic-ai-transformation",
  },
  {
    id: "citizen-services-agent",
    slug: "citizen-services-agent",
    title: { en: "Sovereign Citizen Services Agent", ar: "وكيل خدمات المواطنين السيادي" },
    class: "customer-ops-agent",
    industries: ["public-sector"],
    horizontals: [],
    buyer: { en: "Director General", ar: "المدير العام" },
    pitch: {
      en: "Bilingual EN/AR multi-turn agent for ministry call centres and chat — routed inside an air-gapped enclave, with full handoff context and provenance.",
      ar: "وكيل ثنائي اللغة بالعربية والإنجليزية متعدد الجولات لمراكز اتصال الوزارات والدردشة — يعمل داخل بيئة معزولة سيادياً مع تسليم كامل السياق والمصدر.",
    },
    longDescription: [
      {
        en: "Citizen-facing services in the Gulf cannot be delivered by a hyperscaler chatbot. They need fluent Arabic, dialect tolerance, an air-gapped runtime, and a regulator-defensible audit trail. This agent does all four.",
        ar: "خدمات المواطنين في الخليج لا يمكن تقديمها عبر روبوت محادثة من مزوّد سحابي عام. فهي تحتاج إلى عربية فصيحة، وقبول لهجات، وبيئة تشغيل معزولة، ومسار تدقيق قابل للدفاع تنظيمياً. يلبّي هذا الوكيل الأربعة.",
      },
      {
        en: "Routes the conversation through the ministry's own Arabic NLU stack, escalates to a human agent with the full context already assembled, and writes a citation trail back to the source policy or service catalogue every time.",
        ar: "يوجّه المحادثة عبر مكدّس فهم اللغة العربية الخاص بالوزارة، ويصعّد إلى موظف بشري مع تسليم كامل السياق المعدّ مسبقاً، ويكتب مسار مصادر يعود إلى السياسة أو كتالوج الخدمة في كل مرة.",
      },
      {
        en: "Designed for sovereign-cloud and on-prem deployment. The model and the data never leave the national perimeter.",
        ar: "مصمَّم للنشر على السحابة السيادية والداخلية. لا يغادر النموذج ولا البيانات النطاق الوطني.",
      },
    ],
    screens: [
      {
        title: { en: "Bilingual conversation pane", ar: "لوحة محادثة ثنائية اللغة" },
        caption: {
          en: "Mid-conversation view with intent, dialect tag, and confidence visible to the supervisor.",
          ar: "عرض في منتصف المحادثة مع نية المتصل ولهجته ومستوى الثقة ظاهرة للمشرف.",
        },
      },
      {
        title: { en: "Agent handoff", ar: "تسليم إلى موظف بشري" },
        caption: {
          en: "Routing screen showing the human agent the full context, citations, and recommended next action.",
          ar: "شاشة التوجيه التي تُظهر للموظف البشري السياق الكامل والمراجع والإجراء التالي الموصى به.",
        },
      },
      {
        title: { en: "Audit trail", ar: "مسار التدقيق" },
        caption: {
          en: "Per-conversation evidence pack regulators can subpoena: prompts, citations, model version, retention policy.",
          ar: "حزمة أدلة لكل محادثة يمكن للجهات التنظيمية طلبها: المطالبات، والمراجع، وإصدار النموذج، وسياسة الاحتفاظ.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Service catalogue, policies, FAQ — all ingested from ministry SharePoint", ar: "كتالوج الخدمات والسياسات والأسئلة الشائعة — تُستوعب من شيربوينت الوزارة" },
        { en: "Live caller transcript (voice or chat)", ar: "نص الاتصال المباشر (صوتي أو محادثة)" },
      ],
      internal: [
        { en: "Sovereign on-prem LLM runtime, Arabic NLU and dialect tagger", ar: "بيئة تشغيل نموذج لغة كبير سيادية داخلية، فهم لغة عربية، وموسم لهجات" },
        { en: "Citation enforcer — every answer must cite a source", ar: "مُلزِم مرجعي — كل إجابة يجب أن تستند إلى مصدر" },
      ],
      outputs: [
        { en: "Resolved request, escalation packet for a human agent, regulator-ready audit pack", ar: "طلب محلول، حزمة تصعيد لموظف بشري، حزمة تدقيق جاهزة للجهات التنظيمية" },
      ],
    },
    status: "live",
    accent: "#0F9ED5",
    icon: "Users",
    relatedService: "agentic-ai-transformation",
    relatedAssessment: "ari",
  },
  {
    id: "procurement-intelligence",
    slug: "procurement-intelligence",
    title: { en: "Procurement Intelligence Agent", ar: "وكيل ذكاء المشتريات" },
    class: "supply-chain-agent",
    industries: ["public-sector", "energy-commodities"],
    horizontals: ["supply-chain"],
    buyer: { en: "Chief Procurement Officer", ar: "كبير مسؤولي المشتريات" },
    pitch: {
      en: "Spend taxonomy, supplier-risk scoring, and contract-cycle compression — maps Etimad and SAP Ariba data, surfaces savings, drafts negotiation talking points.",
      ar: "تصنيف الإنفاق وتقييم مخاطر الموردين وضغط دورة التعاقد — يربط بيانات اعتماد وSAP Ariba، ويبرز الوفورات، ويصوغ نقاط التفاوض.",
    },
    longDescription: [
      {
        en: "Procurement Intelligence Agent compresses the time from tender to award. It reads spend taxonomies, normalises supplier data across multiple ERP and tender platforms, and produces a defensible savings hypothesis for every category — with the supporting analysis the CPO can take to a sourcing committee.",
        ar: "يضغط وكيل ذكاء المشتريات الوقت من المناقصة إلى الترسية. يقرأ تصنيفات الإنفاق ويوحّد بيانات الموردين عبر منصّات تخطيط موارد المؤسسات والمناقصات المختلفة، وينتج فرضية وفورات قابلة للدفاع لكل فئة، مع التحليل الداعم الذي يقدّمه كبير المشتريات إلى لجنة التوريد.",
      },
      {
        en: "Tuned for the GCC reality — Etimad and major regional ERP estates, Arabic-language supplier names, sanction-screened lists, and the country's own supplier-classification frameworks.",
        ar: "مضبوط لواقع الخليج — منصة اعتماد وأنظمة تخطيط موارد المؤسسات الرئيسية، وأسماء الموردين بالعربية، والقوائم المفحوصة للعقوبات، وأطر تصنيف الموردين المحلية.",
      },
      {
        en: "Drafts a negotiation pre-read for every renewal — the supplier's leverage points, the buyer's leverage points, and the BATNA in plain language.",
        ar: "يصوغ ملخّصاً تحضيرياً للتفاوض لكل تجديد — نقاط نفوذ المورد، ونقاط نفوذ المشتري، وأفضل بديل للاتفاق بلغة واضحة.",
      },
    ],
    screens: [
      {
        title: { en: "Category savings map", ar: "خريطة الوفورات حسب الفئة" },
        caption: {
          en: "Heatmap of spend categories sized by spend, coloured by realisable savings hypothesis.",
          ar: "خريطة حرارية لفئات الإنفاق مقاسة بالإنفاق وملوّنة بفرضية الوفورات الممكنة.",
        },
      },
      {
        title: { en: "Supplier-risk dossier", ar: "ملف مخاطر المورد" },
        caption: {
          en: "Per-supplier risk score with the contributing factors — financial, geopolitical, delivery, sanctions.",
          ar: "تصنيف مخاطر لكل مورد مع العوامل المساهمة — مالية، جغرافية سياسية، تسليم، عقوبات.",
        },
      },
      {
        title: { en: "Negotiation pre-read", ar: "ملخّص تحضير التفاوض" },
        caption: {
          en: "Drafted talking points, leverage map, and BATNA — ready for the sourcing committee.",
          ar: "نقاط حوار مسوّدة، وخريطة نفوذ، وأفضل بديل للاتفاق — جاهزة للجنة التوريد.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "ERP spend (SAP, Oracle, Microsoft Dynamics), tender platforms (Etimad, SAP Ariba)", ar: "بيانات الإنفاق من ERP (ساب، أوراكل، مايكروسوفت داينمكس)، ومنصات المناقصات (اعتماد، SAP Ariba)" },
        { en: "Supplier master data, sanctions lists, financial filings", ar: "البيانات الرئيسية للموردين، وقوائم العقوبات، والملفات المالية" },
      ],
      internal: [
        { en: "Spend taxonomy, multi-tier supplier graph, FX-adjusted landed cost model", ar: "تصنيف الإنفاق، رسم بياني متعدد المستويات للموردين، نموذج التكلفة المُسلَّمة المعدّل بسعر الصرف" },
      ],
      outputs: [
        { en: "Category-level savings hypotheses, supplier-risk dossiers, negotiation pre-reads", ar: "فرضيات وفورات على مستوى الفئة، ملفات مخاطر الموردين، ملخّصات تحضير التفاوض" },
      ],
    },
    status: "live",
    accent: "#196B24",
    icon: "ShoppingCart",
    relatedService: "ai-product-studio",
  },
  {
    id: "network-ops-agent",
    slug: "network-ops-agent",
    title: { en: "Telecom Network Ops Agent", ar: "وكيل عمليات شبكات الاتصالات" },
    class: "knowledge-decision-copilot",
    industries: ["telecom"],
    horizontals: [],
    buyer: { en: "CTO Networks", ar: "كبير مسؤولي تكنولوجيا الشبكات" },
    pitch: {
      en: "Reads OSS/BSS alarms, customer-care escalations, and change-management tickets — recommends triage actions with confidence and evidence. NOC dashboards at the speed of conversation.",
      ar: "يقرأ إنذارات OSS/BSS وتصعيدات خدمة العملاء وتذاكر إدارة التغيير — ويوصي بإجراءات الفرز مع الثقة والدليل. لوحات NOC بسرعة المحادثة.",
    },
    longDescription: [
      {
        en: "GCC operators have spent a decade investing in OSS/BSS estates and AIOps platforms. The leverage now is in fusing those signals with customer impact and change-management data so a NOC engineer can ask 'what's hurting my Riyadh customers right now?' and get an answer that links symptoms to root cause to recommended action.",
        ar: "أمضى مشغّلو الخليج عقداً في الاستثمار في أنظمة OSS/BSS ومنصات AIOps. والقيمة الآن في دمج تلك الإشارات مع أثر العميل وبيانات إدارة التغيير، حتى يستطيع مهندس مركز عمليات الشبكة أن يسأل «ما الذي يؤثر على عملائي في الرياض الآن؟» ويحصل على إجابة تربط الأعراض بالسبب الجذري بالإجراء الموصى به.",
      },
      {
        en: "The agent never executes a network-impacting change. It produces a triage recommendation with the supporting evidence — alarm chain, recent changes, customer impact telemetry — for a human network engineer to action.",
        ar: "لا ينفّذ الوكيل أي تغيير يؤثر على الشبكة. بل يقدّم توصية بالفرز مع الأدلة الداعمة — سلسلة الإنذارات، التغييرات الأخيرة، قياسات أثر العملاء — ليتخذ مهندس شبكة بشري الإجراء.",
      },
      {
        en: "Trained on the GCC operator playbooks — RAN/Core/Transport vendor mix, regulator notification thresholds, peak-hour and Hajj-season patterns.",
        ar: "مدرَّب على أدلّة مشغّلي الخليج — مزيج موردي شبكة الراديو والنواة والنقل، عتبات إشعار المنظّم، وأنماط الذروة وموسم الحج.",
      },
    ],
    screens: [
      {
        title: { en: "Live triage console", ar: "وحدة الفرز الحية" },
        caption: {
          en: "Open incidents ranked by customer-impact score, each with the recommended action and the supporting evidence chain.",
          ar: "الحوادث المفتوحة مرتّبة حسب أثر العميل، مع الإجراء الموصى به وسلسلة الأدلة الداعمة لكل منها.",
        },
      },
      {
        title: { en: "Customer impact view", ar: "عرض أثر العميل" },
        caption: {
          en: "Live map of impacted cells and the customer cohorts hitting the contact centre because of them.",
          ar: "خريطة حية للخلايا المتأثرة وفئات العملاء الذين يتصلون بمركز خدمة العملاء بسببها.",
        },
      },
      {
        title: { en: "Change-correlation timeline", ar: "خط زمني لربط التغيير بالأعطال" },
        caption: {
          en: "Stacked timeline of recent changes, alarms, and CSAT dips — the agent's evidence for the recommended action.",
          ar: "خط زمني متراكب للتغييرات الأخيرة والإنذارات وانخفاضات رضا العملاء — وهو دليل الوكيل على الإجراء الموصى به.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "OSS alarms, BSS care tickets, change-management records, CSAT telemetry", ar: "إنذارات OSS، تذاكر خدمة BSS، سجلات إدارة التغيير، قياسات رضا العملاء" },
      ],
      internal: [
        { en: "Vendor-agnostic alarm ontology, change-impact correlator, customer-impact scorer", ar: "أنطولوجيا إنذارات مستقلة عن المورد، رابط أثر التغيير، مصنّف أثر العميل" },
      ],
      outputs: [
        { en: "Triage recommendations with evidence chains; regulator-notifiable incidents flagged", ar: "توصيات فرز مع سلاسل أدلة؛ إشارات على الحوادث الواجب إبلاغ المنظّم بها" },
      ],
    },
    status: "live",
    accent: "#156082",
    icon: "Activity",
    relatedService: "agentic-ai-transformation",
  },
  {
    id: "sama-compliance-agent",
    slug: "sama-compliance-agent",
    title: { en: "SAMA Compliance Agent", ar: "وكيل الامتثال لساما" },
    class: "risk-compliance-agent",
    industries: ["financial-services"],
    horizontals: [],
    buyer: { en: "Chief Risk Officer", ar: "كبير مسؤولي المخاطر" },
    pitch: {
      en: "Continuous-monitoring agent over policy, change, and operational telemetry — generates SAMA inspection-ready evidence packs with bilingual EN/AR narrative.",
      ar: "وكيل مراقبة مستمرة لسياسات وتغييرات وقياسات تشغيل البنك — ينتج حزم أدلة جاهزة لتفتيش ساما مع روايات ثنائية اللغة.",
    },
    longDescription: [
      {
        en: "SAMA inspections demand evidence on demand. This agent turns the bank's policy library, change records, and operational telemetry into a continuously regenerated evidence pack — so when SAMA asks, the answer takes minutes, not weeks.",
        ar: "تفتيشات ساما تتطلب أدلة عند الطلب. يحوّل هذا الوكيل مكتبة سياسات البنك وسجلات التغيير والقياسات التشغيلية إلى حزمة أدلة مُعاد توليدها باستمرار — وحين تطلب ساما، يكون الجواب خلال دقائق لا أسابيع.",
      },
      {
        en: "Cross-mapped to SAMA's circulars, the UAE AI Charter, and PDPL — every recommendation cites the regulatory clause it is responding to. No invented compliance claims.",
        ar: "مُربط بتعميمات ساما وميثاق الإمارات للذكاء الاصطناعي ولوائح حماية البيانات — كل توصية تستشهد بالبند التنظيمي الذي تستجيب له. لا ادعاءات امتثال مختلقة.",
      },
      {
        en: "Built jointly with risk and audit teams in two GCC banks — designed to integrate with the bank's GRC tooling, not replace it.",
        ar: "مبنيّ بالتعاون مع فرق المخاطر والتدقيق في بنكين خليجيين — مصمَّم للتكامل مع أدوات الحوكمة والمخاطر والامتثال للبنك، لا لاستبدالها.",
      },
    ],
    screens: [
      {
        title: { en: "Regulator dashboard", ar: "لوحة المنظّم" },
        caption: {
          en: "Per-regulator obligation status — SAMA, UAE AI Charter, PDPL — with confidence and last-evidence-refresh date.",
          ar: "حالة الالتزامات لكل جهة تنظيمية — ساما، ميثاق الإمارات، حماية البيانات — مع الثقة وآخر تاريخ لتحديث الأدلة.",
        },
      },
      {
        title: { en: "Evidence pack export", ar: "تصدير حزمة الأدلة" },
        caption: {
          en: "One-click export of an inspection-ready PDF pack, bilingual EN/AR, with citations.",
          ar: "تصدير بنقرة واحدة لحزمة PDF جاهزة للتفتيش بالعربية والإنجليزية مع مراجع.",
        },
      },
      {
        title: { en: "Continuous control monitoring", ar: "مراقبة مستمرة للضوابط" },
        caption: {
          en: "Telemetry view showing where controls are degrading and which obligation will breach first.",
          ar: "عرض القياسات يُظهر أين تتدهور الضوابط وأي التزام سينتهك أولاً.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Policy library, change-management records, operational telemetry, GRC tooling", ar: "مكتبة السياسات، سجلات إدارة التغيير، القياسات التشغيلية، أدوات الحوكمة والمخاطر والامتثال" },
        { en: "Regulator rule library — SAMA circulars, UAE AI Charter, PDPL", ar: "مكتبة قواعد الجهات التنظيمية — تعميمات ساما، ميثاق الإمارات، لوائح حماية البيانات" },
      ],
      internal: [
        { en: "Obligation-to-control mapping, evidence-pack generator, citation enforcer", ar: "ربط الالتزامات بالضوابط، مولّد حزم الأدلة، مُلزِم مرجعي" },
      ],
      outputs: [
        { en: "Bilingual inspection-ready PDF evidence packs, control-degradation alerts", ar: "حزم أدلة PDF جاهزة للتفتيش بالعربية والإنجليزية، تنبيهات تدهور الضوابط" },
      ],
    },
    status: "live",
    accent: "#0E2841",
    icon: "ShieldCheck",
    relatedService: "data-governance-foundations",
    relatedAssessment: "dafi",
  },
  {
    id: "energy-trading-copilot",
    slug: "energy-trading-copilot",
    title: { en: "Energy Trading Copilot", ar: "مساعد تداول الطاقة" },
    class: "knowledge-decision-copilot",
    industries: ["energy-commodities"],
    horizontals: [],
    buyer: { en: "Head of Trading", ar: "رئيس التداول" },
    pitch: {
      en: "Reads price feeds, weather, vessel positions and OPEC commentary — surfaces trade ideas with risk-band rationale. Human-in-the-loop only; the agent never executes.",
      ar: "يقرأ مصادر الأسعار والطقس ومواقع الناقلات وتعليقات أوبك — ويبرز أفكار تداول مع تبرير نطاق المخاطر. الإنسان دائماً في الحلقة؛ والوكيل لا ينفّذ أبداً.",
    },
    longDescription: [
      {
        en: "Energy traders drown in feeds. This copilot ingests the lot — Brent / WTI / Dubai / Murban prices, OPEC and JODI commentary, vessel positions, weather forecasts, refinery outages — and surfaces 3–5 trade ideas a day with the rationale spelled out.",
        ar: "يغرق متداولو الطاقة في تدفقات البيانات. يستوعب هذا المساعد الكثير منها — أسعار برنت وWTI ودبي ومربان، وتعليقات أوبك وJODI، ومواقع الناقلات، وتنبؤات الطقس، وانقطاعات المصافي — ويبرز 3–5 أفكار تداول يومياً مع التبرير.",
      },
      {
        en: "The agent never executes. It writes a trade-idea memo with the evidence — the trader decides. That separation makes it deployable inside trading floors with hard regulatory ringfences.",
        ar: "لا ينفّذ الوكيل أبداً. بل يكتب مذكّرة فكرة تداول مع الأدلة — والمتداول يقرّر. هذا الفصل يجعله قابلاً للنشر داخل قاعات تداول لها حواجز تنظيمية صارمة.",
      },
      {
        en: "Risk bands and confidence are explicit. Every recommendation carries the assumption set — the trader can pressure-test the assumptions before committing capital.",
        ar: "نطاقات المخاطر ومستويات الثقة معلنة بوضوح. تحمل كل توصية مجموعة الافتراضات — ويمكن للمتداول اختبارها قبل تخصيص رأس المال.",
      },
    ],
    screens: [
      {
        title: { en: "Trade-idea board", ar: "لوحة أفكار التداول" },
        caption: {
          en: "Today's ideas ranked by conviction and risk band, each with a one-paragraph rationale and the supporting feeds.",
          ar: "أفكار اليوم مرتّبة حسب الاقتناع ونطاق المخاطر، مع تبرير من فقرة واحدة والمصادر الداعمة.",
        },
      },
      {
        title: { en: "Feed monitor", ar: "مراقب التدفقات" },
        caption: {
          en: "Live view of price, weather, vessel and macro feeds — and which idea each new event reinforces or weakens.",
          ar: "عرض حيّ لتدفقات الأسعار والطقس والناقلات والاقتصاد الكلي — وأيّ فكرة يدعمها أو يضعفها كل حدث جديد.",
        },
      },
      {
        title: { en: "Trade memo draft", ar: "مسوّدة مذكّرة التداول" },
        caption: {
          en: "Drafted PDF memo for the trade-floor — assumption set, risk band, exit triggers — for the trader to sign.",
          ar: "مسوّدة مذكّرة PDF لقاعة التداول — مجموعة الافتراضات، نطاق المخاطر، محفّزات الخروج — لتوقيع المتداول.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Price feeds, weather, vessel positions, OPEC and JODI commentary, refinery telemetry", ar: "مصادر الأسعار، الطقس، مواقع الناقلات، تعليقات أوبك وJODI، قياسات المصافي" },
      ],
      internal: [
        { en: "Multi-feed event correlator, risk-band model, citation-enforcing rationale generator", ar: "رابط أحداث متعدد المصادر، نموذج نطاق المخاطر، مولّد تبريرات مع مراجع إلزامية" },
      ],
      outputs: [
        { en: "Trade-idea memos, risk-band table, exit-trigger watchlist", ar: "مذكّرات أفكار التداول، جدول نطاق المخاطر، قائمة مراقبة محفّزات الخروج" },
      ],
    },
    status: "live",
    accent: "#E97132",
    icon: "TrendingUp",
    relatedService: "agentic-ai-transformation",
  },
  {
    id: "retail-demand-forecaster",
    slug: "retail-demand-forecaster",
    title: { en: "Retail Demand Forecaster", ar: "متنبئ طلب التجزئة" },
    class: "supply-chain-agent",
    industries: ["retail-consumer"],
    horizontals: ["supply-chain"],
    buyer: { en: "Head of Merchandising", ar: "رئيس البضائع" },
    pitch: {
      en: "SKU-store-week forecast tuned for GCC seasonality — Ramadan, school-return, summer-exodus. Drives allocation, replenishment and promo planning.",
      ar: "تنبؤ على مستوى المنتج/المتجر/الأسبوع مضبوط لموسمية الخليج — رمضان، عودة المدارس، نزوح الصيف. يقود التخصيص والتزويد وتخطيط العروض.",
    },
    longDescription: [
      {
        en: "GCC retail seasonality is its own problem. Ramadan timing shifts annually, schools return on overlapping calendars across emirates, and the summer exodus moves both volume and channel mix. Generic forecasters fail. This one is tuned for the regional reality.",
        ar: "موسمية التجزئة الخليجية مشكلة قائمة بذاتها. توقيت رمضان يتغيّر سنوياً، وتعود المدارس بتقاويم متداخلة عبر الإمارات، ونزوح الصيف يحرّك الحجم ومزيج القنوات معاً. تفشل المتنبئات العامة. هذا مضبوط للواقع الإقليمي.",
      },
      {
        en: "Forecast at SKU × store × week. Drives allocation, replenishment, and promo cadence. Hands off cleanly to the merchandiser's existing planning system — never replaces it.",
        ar: "تنبؤ على مستوى المنتج × المتجر × الأسبوع. يقود التخصيص والتزويد وإيقاع العروض. يُسلَّم بسلاسة إلى نظام تخطيط البضائع الحالي — ولا يستبدله أبداً.",
      },
      {
        en: "Out-of-the-box adapters for Oracle Retail, SAP Retail, and Microsoft Dynamics — plus a CSV import path for the dukan-to-D2C operators still standardising their stack.",
        ar: "محوّلات جاهزة لـ Oracle Retail وSAP Retail وMicrosoft Dynamics — إضافة إلى استيراد CSV للمشغّلين من «الدكان إلى D2C» الذين ما زالوا يوحّدون أنظمتهم.",
      },
    ],
    screens: [
      {
        title: { en: "Forecast cone by SKU", ar: "مخروط التنبؤ حسب المنتج" },
        caption: {
          en: "26-week cone with the seasonality overlay (Ramadan, schools, summer) toggleable.",
          ar: "مخروط 26 أسبوعاً مع طبقة الموسمية (رمضان، المدارس، الصيف) قابلة للتفعيل.",
        },
      },
      {
        title: { en: "Allocation suggestion", ar: "اقتراح التخصيص" },
        caption: {
          en: "Per-store allocation suggestion against current on-hand and in-transit; merchandiser approves or overrides.",
          ar: "اقتراح تخصيص لكل متجر مقابل المخزون والشحنات قيد النقل؛ يوافق رئيس البضائع أو يتجاوز.",
        },
      },
      {
        title: { en: "Promo lift simulator", ar: "محاكي رفع العروض" },
        caption: {
          en: "Simulate promo cadence and depth, see forecast lift and margin impact before committing.",
          ar: "حاكِ إيقاع العروض وعمقها، وانظر رفع التنبؤ وأثر الهامش قبل الإلزام.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "POS sales history, on-hand and in-transit inventory, promo calendar, store master", ar: "تاريخ مبيعات نقاط البيع، المخزون والشحنات قيد النقل، تقويم العروض، البيانات الرئيسية للمتاجر" },
        { en: "Local calendars: Hijri, school terms by emirate, public holidays", ar: "تقاويم محلية: الهجري، فصول المدارس حسب الإمارة، الإجازات الرسمية" },
      ],
      internal: [
        { en: "Hierarchical forecast (chain → cluster → store), Ramadan-shift overlay, promo-lift model", ar: "تنبؤ هرمي (السلسلة → التجمّع → المتجر)، طبقة إزاحة رمضان، نموذج رفع العروض" },
      ],
      outputs: [
        { en: "SKU × store × week forecast, allocation suggestions, promo lift simulator", ar: "تنبؤ على مستوى المنتج × المتجر × الأسبوع، اقتراحات التخصيص، محاكي رفع العروض" },
      ],
    },
    status: "live",
    accent: "#196B24",
    icon: "BarChart3",
    relatedService: "ai-product-studio",
  },
  {
    id: "hospitality-revenue-optimizer",
    slug: "hospitality-revenue-optimizer",
    title: { en: "Hospitality Revenue Optimizer", ar: "مُحسِّن إيرادات الضيافة" },
    class: "fpa-forecaster",
    industries: ["travel-hospitality"],
    horizontals: ["fpa"],
    buyer: { en: "Chief Commercial Officer", ar: "كبير مسؤولي التجارة" },
    pitch: {
      en: "Property-level rate, length-of-stay and channel-mix optimisation — with event overlays for Riyadh Season, F1, and Hajj cohorts driving demand.",
      ar: "تحسين الأسعار وطول الإقامة ومزيج القنوات على مستوى الفندق — مع طبقات الأحداث لموسم الرياض وF1 وحجاج العمرة.",
    },
    longDescription: [
      {
        en: "GCC hospitality demand is event-driven. The optimiser overlays Riyadh Season, Hajj cohorts, F1, EXPO-class events, and the major business calendar onto property-level demand — so the rate desk and revenue management team can stop reacting and start steering.",
        ar: "الطلب على الضيافة الخليجية يقوده الحدث. يُركّب المُحسِّن طبقات موسم الرياض وحجاج الحرمين وF1 وفعاليات بحجم إكسبو والتقويم التجاري الرئيسي على الطلب على مستوى الفندق — حتى يتوقف مكتب الأسعار وفريق إدارة الإيرادات عن ردود الفعل ويبدؤوا في القيادة.",
      },
      {
        en: "Outputs an explicit recommendation per room-type per day — rate, length-of-stay restrictions, channel mix — with the assumption stack visible to the revenue manager.",
        ar: "ينتج توصية صريحة لكل نوع غرفة لكل يوم — السعر، قيود طول الإقامة، مزيج القنوات — مع إظهار حزمة الافتراضات لمدير الإيرادات.",
      },
      {
        en: "Designed for portfolio operators with multi-brand inventory across the GCC; per-property tuning weighted by brand standard and competitor set.",
        ar: "مصمَّم لمشغّلي المحافظ متعدّدة العلامات عبر الخليج؛ ضبط لكل فندق بترجيح حسب معايير العلامة ومجموعة المنافسين.",
      },
    ],
    screens: [
      {
        title: { en: "Demand calendar", ar: "تقويم الطلب" },
        caption: {
          en: "365-day calendar with event overlays — every cell colour-coded by demand pressure.",
          ar: "تقويم لـ365 يوماً مع طبقات الأحداث — كل خلية ملوّنة حسب ضغط الطلب.",
        },
      },
      {
        title: { en: "Rate recommendation", ar: "توصية الأسعار" },
        caption: {
          en: "Per-room-type per-day rate recommendation with the assumptions and competitor benchmarks visible.",
          ar: "توصية سعر لكل نوع غرفة لكل يوم مع إظهار الافتراضات ومعايير المنافسين.",
        },
      },
      {
        title: { en: "Channel-mix tuner", ar: "موالف مزيج القنوات" },
        caption: {
          en: "Tune the OTA / direct / corporate mix and see the margin impact before publishing.",
          ar: "اضبط مزيج OTA والمباشر والشركات وانظر أثر الهامش قبل النشر.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "PMS data (Opera, Mews, Cloudbeds), competitor rate scrape, event calendar", ar: "بيانات PMS (Opera وMews وCloudbeds)، استخراج أسعار المنافسين، تقويم الأحداث" },
      ],
      internal: [
        { en: "Demand model with Hajj/Ramadan/Riyadh-Season overlays, channel-margin model", ar: "نموذج طلب مع طبقات الحج ورمضان وموسم الرياض، نموذج هامش القناة" },
      ],
      outputs: [
        { en: "Rate, LOS, and channel-mix recommendations per room-type per day", ar: "توصيات السعر وطول الإقامة ومزيج القنوات لكل نوع غرفة لكل يوم" },
      ],
    },
    status: "live",
    accent: "#F5A623",
    icon: "Hotel",
    relatedService: "ai-product-studio",
  },
  {
    id: "ev-battery-health-agent",
    slug: "ev-battery-health-agent",
    title: { en: "EV Battery Health Agent", ar: "وكيل صحة بطارية المركبات الكهربائية" },
    class: "knowledge-decision-copilot",
    industries: ["automotive"],
    horizontals: [],
    buyer: { en: "Head of Aftermarket", ar: "رئيس ما بعد البيع" },
    pitch: {
      en: "Connected-vehicle telemetry → battery state-of-health prediction → proactive service outreach. Designed for the multi-brand dealer network reality of GCC automotive groups.",
      ar: "قياسات المركبات المتصلة → تنبؤ بحالة صحة البطارية → تواصل خدمة استباقي. مصمَّم لواقع الشبكات متعددة العلامات لمجموعات السيارات الخليجية.",
    },
    longDescription: [
      {
        en: "EV battery health is the new aftermarket. This agent ingests connected-vehicle telemetry — temperature, charge cycles, depth-of-discharge — and predicts state-of-health months ahead of the warning lights, so the dealer can reach the customer with a service appointment, not the customer reaching the dealer with a complaint.",
        ar: "صحة بطارية المركبات الكهربائية هي ما بعد البيع الجديد. يستوعب هذا الوكيل قياسات المركبات المتصلة — الحرارة، دورات الشحن، عمق التفريغ — ويتنبّأ بحالة الصحة قبل أشهر من إنذارات اللوحة، فيستطيع الوكيل التواصل مع العميل لتحديد موعد خدمة، بدلاً من أن يتواصل العميل بشكوى.",
      },
      {
        en: "Built for the multi-brand dealer reality of GCC automotive groups — Al-Futtaim, Petromin, Juffali, AlGhanim — where one customer may have BMW, Lucid and Tesla in the same household.",
        ar: "مبنيّ لواقع الشبكات متعددة العلامات لمجموعات السيارات الخليجية — الفطيم، بترومين، جفلي، الغانم — حيث قد يمتلك عميل واحد BMW وLucid وتسلا في نفس المنزل.",
      },
      {
        en: "Plugs into the dealer's CRM — outreach happens through the channel the customer already uses, not a new app the customer will never download.",
        ar: "يتصل بنظام إدارة علاقات العملاء لدى الوكيل — يحدث التواصل عبر القناة التي يستخدمها العميل بالفعل، لا تطبيق جديد لن يحمّله أبداً.",
      },
    ],
    screens: [
      {
        title: { en: "Fleet health map", ar: "خريطة صحة الأسطول" },
        caption: {
          en: "Geographic view of vehicles in service, coloured by predicted battery state-of-health.",
          ar: "عرض جغرافي للمركبات في الخدمة، ملوّنة حسب حالة الصحة المتنبَّأ بها للبطارية.",
        },
      },
      {
        title: { en: "Vehicle deep-dive", ar: "تحليل تفصيلي للمركبة" },
        caption: {
          en: "Per-VIN charge-cycle history, temperature exposure, and the predicted intervention window.",
          ar: "تاريخ دورات الشحن لكل رقم تعريف مركبة، التعرّض الحراري، ونافذة التدخّل المتنبَّأ بها.",
        },
      },
      {
        title: { en: "Outreach orchestration", ar: "تنسيق التواصل" },
        caption: {
          en: "Drafted SMS / WhatsApp / call-script outreach the service advisor can review and send.",
          ar: "مسوّدة تواصل عبر الرسائل القصيرة وواتساب ونص الاتصال يمكن لمستشار الخدمة مراجعتها وإرسالها.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Connected-vehicle telemetry (OEM API), DMS/CRM data", ar: "قياسات المركبات المتصلة (واجهة برمجة OEM)، بيانات DMS/CRM" },
        { en: "Service history, parts availability, charging-network data where available", ar: "تاريخ الخدمة، توفّر القطع، بيانات شبكة الشحن حيث تتوفّر" },
      ],
      internal: [
        { en: "State-of-health model, intervention-window predictor, multi-brand customer graph", ar: "نموذج حالة الصحة، متنبئ نافذة التدخّل، رسم بياني للعميل متعدّد العلامات" },
      ],
      outputs: [
        { en: "Predicted SOH curve per vehicle, intervention recommendations, drafted outreach", ar: "منحنى صحة متنبَّأ لكل مركبة، توصيات التدخّل، مسوّدة التواصل" },
      ],
    },
    status: "live",
    accent: "#0F9ED5",
    icon: "Battery",
    relatedService: "agentic-ai-transformation",
  },
  {
    id: "fpa-rolling-forecast",
    slug: "fpa-rolling-forecast",
    title: { en: "FP&A Rolling Forecast Agent", ar: "وكيل التنبؤ المتجدد للتخطيط المالي" },
    class: "fpa-forecaster",
    industries: [
      "public-sector",
      "telecom",
      "financial-services",
      "energy-commodities",
      "retail-consumer",
      "travel-hospitality",
      "automotive",
    ],
    horizontals: ["fpa"],
    buyer: { en: "CFO", ar: "المدير المالي" },
    pitch: {
      en: "Driver-based rolling forecast — ingests actuals, regenerates the forecast cone, drafts the variance commentary, flags the three things the CFO needs to take to the board.",
      ar: "تنبؤ متجدد قائم على المحركات — يستوعب الفعلي، ويعيد توليد مخروط التنبؤ، ويصوغ تعليق الانحرافات، ويبرز الأشياء الثلاثة التي يجب على المدير المالي رفعها لمجلس الإدارة.",
    },
    longDescription: [
      {
        en: "Most CFOs have a rolling forecast in spreadsheet form. The agent operationalises it: ingest actuals every period, regenerate the forecast cone using the existing driver tree, draft the variance commentary in the CFO's house style, and flag the three things the board needs to see.",
        ar: "معظم المدراء الماليين لديهم تنبؤ متجدد بصيغة جدول بيانات. يقوم الوكيل بتشغيله: استيعاب الفعلي كل فترة، وإعادة توليد مخروط التنبؤ باستخدام شجرة المحركات الحالية، وصياغة تعليق الانحرافات بأسلوب المدير المالي، وإبراز الأشياء الثلاثة التي يجب أن يراها المجلس.",
      },
      {
        en: "Plugs into the existing planning stack — Anaplan, Workday Adaptive, OneStream, or even Excel — without forcing a re-platform.",
        ar: "يتصل بحزمة التخطيط الحالية — Anaplan أو Workday Adaptive أو OneStream أو حتى Excel — دون فرض إعادة بناء النظام.",
      },
      {
        en: "Variance commentary is drafted, not finalised. The CFO retains the pen — the agent loads the gun.",
        ar: "تعليق الانحرافات يُصاغ، لا يُختم. يحتفظ المدير المالي بالقلم — والوكيل يجهّز الذخيرة.",
      },
    ],
    screens: [
      {
        title: { en: "Forecast cone", ar: "مخروط التنبؤ" },
        caption: {
          en: "Regenerated cone with the driver decomposition visible — exactly which assumption moved the line.",
          ar: "مخروط معاد توليده مع تفصيل المحركات — أي افتراض تحديداً حرّك الخط.",
        },
      },
      {
        title: { en: "Variance commentary draft", ar: "مسوّدة تعليق الانحرافات" },
        caption: {
          en: "Drafted MD&A-style narrative in the CFO's house style; every claim cites the underlying figure.",
          ar: "رواية مسوّدة بأسلوب MD&A بأسلوب المدير المالي؛ كل ادعاء يستشهد بالرقم الأساسي.",
        },
      },
      {
        title: { en: "Board-pack flag", ar: "إبراز حزمة مجلس الإدارة" },
        caption: {
          en: "The three items the agent thinks the board must see, with rationale and the underlying transaction-level evidence.",
          ar: "البنود الثلاثة التي يرى الوكيل وجوب عرضها على المجلس، مع التبرير والأدلة على مستوى المعاملات.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Actuals from ERP and revenue subledgers; existing planning model (Anaplan, Adaptive, OneStream, Excel)", ar: "الفعلي من ERP ودفاتر الإيرادات الفرعية؛ نموذج التخطيط الحالي" },
      ],
      internal: [
        { en: "Driver-tree library, MD&A draft generator with house-style retrieval", ar: "مكتبة شجرة المحركات، مولّد مسوّدة MD&A مع استرجاع أسلوب الشركة" },
      ],
      outputs: [
        { en: "Updated forecast cone, drafted variance commentary, top-three board flags", ar: "مخروط تنبؤ محدّث، مسوّدة تعليق انحرافات، أهم ثلاثة بنود لمجلس الإدارة" },
      ],
    },
    status: "live",
    accent: "#156082",
    icon: "LineChart",
    relatedService: "ai-product-studio",
    relatedAssessment: "uvr",
  },
  {
    id: "customer-care-multi-agent",
    slug: "customer-care-multi-agent",
    title: { en: "Customer Care Multi-Agent", ar: "وكلاء خدمة العملاء المتعددون" },
    class: "customer-ops-agent",
    industries: ["telecom", "retail-consumer"],
    horizontals: [],
    buyer: { en: "Head of Customer Care", ar: "رئيس خدمة العملاء" },
    pitch: {
      en: "Bilingual EN/AR intent classifier → resolution agent → quality-assurance agent — with cost-per-contact and CSAT telemetry per channel.",
      ar: "مصنّف نوايا ثنائي اللغة → وكيل حل → وكيل ضمان جودة — مع قياسات التكلفة لكل تواصل ورضا العملاء لكل قناة.",
    },
    longDescription: [
      {
        en: "A three-agent topology — intent classifier in front, resolution agent in the middle, QA agent behind every reply. The QA agent is what makes it deployable: nothing reaches the customer without a quality check the team can audit.",
        ar: "هيكل ثلاثي الوكلاء — مصنّف النوايا في الأمام، وكيل الحل في الوسط، وكيل ضمان الجودة خلف كل ردّ. وكيل الجودة هو ما يجعله قابلاً للنشر: لا شيء يصل إلى العميل دون فحص جودة قابل للتدقيق.",
      },
      {
        en: "Bilingual EN/AR with dialect tolerance — built for the realities of Khaleeji, Hijazi, Egyptian and Levantine customer bases hitting GCC contact centres.",
        ar: "ثنائي اللغة بالعربية والإنجليزية مع تحمّل اللهجات — مبنيّ لواقع قواعد العملاء الخليجية والحجازية والمصرية والشامية التي تتواصل مع مراكز خدمة الخليج.",
      },
      {
        en: "Telemetry per channel — voice, chat, WhatsApp, email — surfaces cost-per-contact and CSAT in one view, so the head of care can re-allocate volume without breaking the SLA.",
        ar: "قياسات لكل قناة — صوت، محادثة، واتساب، بريد — تُظهر التكلفة ورضا العملاء في عرض واحد، فيستطيع رئيس الخدمة إعادة توزيع الحجم دون كسر اتفاقيات الخدمة.",
      },
    ],
    screens: [
      {
        title: { en: "Channel scoreboard", ar: "لوحة قياس القنوات" },
        caption: {
          en: "Per-channel CSAT, deflection rate, cost-per-contact, and SLA breach risk.",
          ar: "رضا العملاء لكل قناة، معدّل الانحراف عن الموظف البشري، التكلفة لكل تواصل، ومخاطر خرق اتفاقيات الخدمة.",
        },
      },
      {
        title: { en: "Conversation timeline", ar: "خط زمني للمحادثة" },
        caption: {
          en: "Three-agent timeline showing intent → resolution → QA decision; the QA agent's reasoning is exposed.",
          ar: "خط زمني ثلاثي الوكلاء يُظهر النية → الحل → قرار الجودة؛ مع كشف منطق وكيل الجودة.",
        },
      },
      {
        title: { en: "QA failure log", ar: "سجل إخفاقات الجودة" },
        caption: {
          en: "Conversations the QA agent blocked, with the rule violated and the recommended training fix.",
          ar: "المحادثات التي حجبها وكيل الجودة، مع القاعدة المنتهكة وإصلاح التدريب الموصى به.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Customer transcripts (voice, chat, WhatsApp, email), CRM context, knowledge-base articles", ar: "نصوص العملاء (صوت، محادثة، واتساب، بريد)، سياق CRM، مقالات قاعدة المعرفة" },
      ],
      internal: [
        { en: "Bilingual EN/AR intent router, resolution agent, QA agent with house-rule enforcement", ar: "موجّه نوايا ثنائي اللغة، وكيل حل، وكيل جودة مع تطبيق قواعد الشركة" },
      ],
      outputs: [
        { en: "Resolved conversation, deflection score, QA pass/fail with reason, cost-per-contact telemetry", ar: "محادثة محلولة، تصنيف انحراف، نجاح/إخفاق جودة مع السبب، قياسات التكلفة لكل تواصل" },
      ],
    },
    status: "live",
    accent: "#0F9ED5",
    icon: "Headphones",
    relatedService: "agentic-ai-transformation",
  },
  {
    id: "sovereign-data-workbench",
    slug: "sovereign-data-workbench",
    title: { en: "Sovereign Data Workbench", ar: "منصة البيانات السيادية" },
    class: "sovereign-data-workbench",
    industries: ["public-sector"],
    horizontals: [],
    buyer: { en: "Chief Data Officer", ar: "كبير مسؤولي البيانات" },
    pitch: {
      en: "Air-gapped agentic data engineering — drafts pipelines, runs lineage, and scaffolds quality contracts inside the customer's perimeter. Built for sovereign-cloud and on-prem.",
      ar: "هندسة بيانات وكيلية معزولة — تصوغ خطوط الأنابيب، وتدير نسب البيانات، وتهيكل عقود الجودة داخل نطاق العميل. مبنية للسحابة السيادية والداخلية.",
    },
    longDescription: [
      {
        en: "The sovereign data workbench is the agent layer over an on-prem or sovereign-cloud data platform. It drafts dbt-style pipelines, walks lineage, and scaffolds data-quality contracts — all without the data ever leaving the national perimeter.",
        ar: "منصة البيانات السيادية هي طبقة الوكلاء فوق منصة بيانات داخلية أو سحابية سيادية. تصوغ خطوط أنابيب بأسلوب dbt، وتسير في نسب البيانات، وتهيكل عقود جودة البيانات — دون أن تغادر البيانات النطاق الوطني أبداً.",
      },
      {
        en: "Includes Arabic NER and an Arabic-script-aware lineage compiler — both required for source systems still operating with mixed Arabic/English data dictionaries.",
        ar: "يتضمّن التعرّف على الكيانات بالعربية ومجمّع نسب بيانات يدرك الحرف العربي — وكلاهما مطلوبان لأنظمة مصدر ما زالت تعمل بقواميس بيانات مختلطة بالعربية والإنجليزية.",
      },
      {
        en: "Designed to be deployed inside the customer's perimeter on Day 1 — no exfiltration of data to a hyperscaler, ever.",
        ar: "مصمَّمة للنشر داخل نطاق العميل من اليوم الأول — دون تسريب أي بيانات إلى مزوّد سحابي عام، أبداً.",
      },
    ],
    screens: [
      {
        title: { en: "Pipeline draft", ar: "مسوّدة خط الأنابيب" },
        caption: {
          en: "Agent-drafted pipeline in dbt-style SQL/Python with the lineage and quality contracts already attached.",
          ar: "خط أنابيب مسوّد بواسطة الوكيل بأسلوب dbt مع نسب البيانات وعقود الجودة مرفقة.",
        },
      },
      {
        title: { en: "Lineage graph", ar: "رسم نسب البيانات" },
        caption: {
          en: "Interactive lineage graph spanning the source-of-truth back to the report — every column annotated.",
          ar: "رسم نسب تفاعلي يمتد من مصدر الحقيقة حتى التقرير — كل عمود معلّق عليه.",
        },
      },
      {
        title: { en: "Quality contract", ar: "عقد الجودة" },
        caption: {
          en: "Drafted data-quality contract for the table — checks, owners, escalation policy, breach SLA.",
          ar: "عقد جودة بيانات مسوّد للجدول — الفحوصات، المسؤولون، سياسة التصعيد، اتفاقية خدمة الخرق.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Source-system schemas (legacy and modern), data dictionaries (English and Arabic)", ar: "مخطّطات أنظمة المصدر (الموروثة والحديثة)، قواميس البيانات (إنجليزية وعربية)" },
      ],
      internal: [
        { en: "On-prem agent runtime, Arabic NER, Arabic-script-aware lineage compiler", ar: "بيئة تشغيل وكلاء داخلية، التعرّف على الكيانات بالعربية، مجمّع نسب يدرك الحرف العربي" },
      ],
      outputs: [
        { en: "Drafted pipelines, lineage graph, data-quality contracts — all stored inside the customer perimeter", ar: "خطوط أنابيب مسوّدة، رسم نسب البيانات، عقود جودة البيانات — كلها مخزّنة داخل نطاق العميل" },
      ],
    },
    status: "live",
    accent: "#0E2841",
    icon: "Database",
    relatedService: "data-governance-foundations",
    relatedAssessment: "dafi",
  },
  {
    id: "knowledge-memory-agent",
    slug: "knowledge-memory-agent",
    title: { en: "Knowledge Memory Agent", ar: "وكيل ذاكرة المعرفة" },
    class: "knowledge-decision-copilot",
    industries: [
      "public-sector",
      "telecom",
      "financial-services",
      "energy-commodities",
      "retail-consumer",
      "travel-hospitality",
      "automotive",
    ],
    horizontals: [],
    buyer: { en: "CIO", ar: "كبير مسؤولي المعلومات" },
    pitch: {
      en: "Cross-industry memory of the firm — ingests SharePoint, Confluence, Notion and email; returns answers with citation trails the audit team can defend.",
      ar: "ذاكرة الشركة عبر القطاعات — يستوعب شيربوينت وConfluence ونوشن والبريد، ويعيد إجابات مع مراجع يمكن لفريق التدقيق الدفاع عنها.",
    },
    longDescription: [
      {
        en: "Every CIO has the same problem: the firm knows things, but no individual knows where. The Knowledge Memory Agent is the memory layer — it ingests the firm's documents, the firm's email, the firm's wikis, and produces grounded answers with citation trails.",
        ar: "لكلّ كبير مسؤولي معلومات المشكلة نفسها: الشركة تعرف أشياء، لكن لا أحد يعرف أين. وكيل ذاكرة المعرفة هو طبقة الذاكرة — يستوعب وثائق الشركة وبريدها وويكيهاتها، وينتج إجابات موثّقة مع مراجع.",
      },
      {
        en: "Hard guardrails on PII and confidential content — every answer is filtered against the requesting employee's data classification rights.",
        ar: "حواجز صارمة على البيانات الشخصية والمحتوى السري — كل إجابة تُفلتر مقابل حقوق تصنيف البيانات للموظف الطالب.",
      },
      {
        en: "Designed to coexist with Microsoft 365 Copilot — focused on the document and process knowledge that Copilot does not own.",
        ar: "مصمَّم للتعايش مع Microsoft 365 Copilot — مع التركيز على معرفة الوثائق والعمليات التي لا يملكها Copilot.",
      },
    ],
    screens: [
      {
        title: { en: "Cited answer", ar: "إجابة مع مراجع" },
        caption: {
          en: "Answer pane with every claim cited back to the source document, page, and last-updated date.",
          ar: "لوحة إجابة مع توثيق كل ادعاء إلى الوثيقة المصدرية والصفحة وتاريخ آخر تحديث.",
        },
      },
      {
        title: { en: "Permission filter view", ar: "عرض مرشّح الصلاحيات" },
        caption: {
          en: "Audit view showing what the agent withheld because the asker didn't have rights to see it.",
          ar: "عرض تدقيق يُظهر ما حجبه الوكيل لأن السائل لا يملك صلاحية رؤيته.",
        },
      },
      {
        title: { en: "Source coverage map", ar: "خريطة تغطية المصادر" },
        caption: {
          en: "Heatmap of which knowledge domains the agent feels confident in, and which still need human curation.",
          ar: "خريطة حرارية للمجالات المعرفية التي يشعر الوكيل بالثقة فيها، وتلك التي ما زالت تحتاج تنسيقاً بشرياً.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "SharePoint, Confluence, Notion, email mailboxes; user identity and permission graph", ar: "شيربوينت، Confluence، نوشن، صناديق البريد؛ هوية المستخدم ورسم الصلاحيات" },
      ],
      internal: [
        { en: "Document semantic graph, citation enforcer, permission-aware retrieval", ar: "رسم دلالي للوثائق، مُلزِم مرجعي، استرجاع مدرك للصلاحيات" },
      ],
      outputs: [
        { en: "Cited answers, source coverage map, audit log of withheld content", ar: "إجابات موثّقة، خريطة تغطية المصادر، سجل تدقيق للمحتوى المحجوب" },
      ],
    },
    status: "live",
    accent: "#156082",
    icon: "BookOpen",
    relatedService: "data-governance-foundations",
  },
];

export const firmFacts = {
  positioning:
    "Maven AI is a boutique GCC AI advisory and engineering firm — sister firm to Maven Insights (~200 consultant bench). We exist to close the gap between enterprise AI ambition and production outcomes.",
  offices: "4 GCC offices (Dubai, Riyadh and partner presence across the Gulf).",
  promise:
    "Senior partners on every call, every deliverable. 90-day MVP commitment from kickoff to production. Sovereign on-prem capable for national security environments.",
  pricing:
    "Engagement-based, scoped per programme. Maven AI does not publish day rates publicly. Use the diagnostics or book a 30-minute readout to discuss scope.",
  contact:
    "Use the Contact page or book a 30-minute partner readout from any assessment results page. Founders' email is reserved for shortlisted scope conversations.",
};

/** Single object exposed for prompt-building convenience. */
export const knowledgeBase = {
  firmFacts,
  homepageStats,
  services,
  industries,
  insights,
  assessments,
  founders,
  marketplaceTools,
  marketplaceClasses,
  marketplaceHorizontals,
};

export type KnowledgeBase = typeof knowledgeBase;

/** Stable suggestion link types the chat widget can render as wouter <Link>s. */
export type ChatSuggestionKind = "service" | "insight" | "assessment" | "industry" | "marketplace" | "page";

export interface KnownLink {
  kind: ChatSuggestionKind;
  href: string;
  label: string;
}

/** Allow-list every link the chat widget is permitted to surface.
 * Important: every href here MUST resolve to a real route in the maven-ai app.
 *  - Industries use in-page anchors (`/industries#<id>`), not subroutes.
 *  - High-intent contact CTAs use `?topic=<slug>` to prefill the form.
 *  - There is no `/founders` page; founders live on `/about`.
 */
export function buildKnownLinks(): KnownLink[] {
  const out: KnownLink[] = [];
  for (const s of services) {
    out.push({ kind: "service", href: `/services/${s.slug}`, label: s.title });
    // High-intent CTA — pre-fills the contact form's "interest" field.
    out.push({
      kind: "page",
      href: `/contact?topic=${s.slug}`,
      label: `Talk to a partner about ${s.title}`,
    });
  }
  for (const i of insights) out.push({ kind: "insight", href: `/insights/${i.slug}`, label: i.title });
  for (const a of assessments) out.push({ kind: "assessment", href: `/assessments/${a.slug}`, label: `${a.code} — ${a.name}` });
  for (const ind of industries) out.push({ kind: "industry", href: `/industries#${ind.id}`, label: ind.title });
  for (const t of marketplaceTools) {
    const liveTag = t.status === "live" ? " — interactive demo" : "";
    out.push({
      kind: "marketplace",
      href: `/marketplace/${t.slug}`,
      label: `${t.title.en}${liveTag}`,
    });
  }
  out.push({ kind: "page", href: "/marketplace", label: "Marketplace — all demo tools" });
  out.push({ kind: "page", href: "/about", label: "About Maven AI (founders, story, operating model)" });
  out.push({ kind: "page", href: "/contact", label: "Contact / book a 30-minute readout" });
  out.push({ kind: "page", href: "/insights", label: "All insights" });
  out.push({ kind: "page", href: "/assessments", label: "All diagnostic assessments" });
  out.push({ kind: "page", href: "/services", label: "All services" });
  out.push({ kind: "page", href: "/industries", label: "All industries we serve" });
  return out;
}
