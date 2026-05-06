import type { AgentCast } from "./agentCasts";

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
  /**
   * Optional Arabic / Turkish translations for the title and one-line
   * summary. The chat KB system-prompt currently grounds in English, but
   * any consumer that wants localized cards (suggestion chips, multilingual
   * indexes) can fall back to these fields. Missing translations fall
   * back to the English string.
   */
  titleAr?: string;
  titleTr?: string;
  summaryAr?: string;
  summaryTr?: string;
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
  | "tender-response-studio"
  | "supply-chain-agent"
  | "customer-ops-agent"
  | "knowledge-decision-copilot"
  | "risk-compliance-agent"
  | "sovereign-data-steward"
  | "pricing-intelligence"
  | "shared-services-agent"
  | "personal-agent";

export type MarketplaceHorizontal = "pmo" | "supply-chain" | "fpa" | "hr-payroll";

export type MarketplaceStatus = "live" | "coming-soon";

/** Bilingual string used by every marketplace tool field. */
export interface BiText {
  en: string;
  ar: string;
  /**
   * Optional Turkish translation. Added for the Personal Agent surface and
   * any future tools that need full TR coverage. Missing TR falls back to EN
   * via the lang helper so existing EN/AR content keeps working unchanged.
   */
  tr?: string;
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

export interface DemoVariant {
  id: string;
  label: BiText;
  audience: BiText;
  description: BiText;
  icon: string;
  route: string;
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
  demoVariants?: DemoVariant[];
  /**
   * Named cast of agents (and human checkpoints) that delivers this tool.
   * Powers the "How does this work?" explainer modal and the in-demo
   * AgentTrace panel. Attached at module load from `./agentCasts.ts` so the
   * tool entry itself is the single source of truth for cast metadata.
   */
  agentCast: AgentCast;
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
  {
    slug: "two-paths-to-outcomes",
    title: "Two Paths to Outcomes: Project-Led and Asset-Led AI Delivery",
    titleAr:
      "مساران للوصول إلى النتائج: تسليم الذكاء الاصطناعي القائم على المشاريع والقائم على الأصول",
    titleTr:
      "Sonuçlara Giden İki Yol: Proje Öncülüğünde ve Varlık Öncülüğünde AI Teslimi",
    category: "Agentic AI",
    type: "Perspective",
    summary:
      "Maven's POV on how clients should choose between custom transformation engagements (project-led) and productized agents from the Marketplace (asset-led) — with a decision framework drawn from BCG, MIT, McKinsey, Gartner and EY research, and the blending patterns most engagements actually follow.",
    summaryAr:
      "وجهة نظر مافن حول كيفية اختيار العملاء بين ارتباطات التحول المخصصة (القائمة على المشاريع) والوكلاء الجاهزين من السوق (القائمة على الأصول) — مع إطار قرار مستمد من أبحاث BCG وMIT وMcKinsey وGartner وEY، وأنماط الدمج التي تتبعها معظم الارتباطات فعلياً.",
    summaryTr:
      "Müşterilerin özel dönüşüm çalışmaları (proje öncülüğünde) ile Marketplace'ten ürünleştirilmiş ajanlar (varlık öncülüğünde) arasında nasıl seçim yapması gerektiğine dair Maven'in bakış açısı — BCG, MIT, McKinsey, Gartner ve EY araştırmalarından alınan bir karar çerçevesi ve çoğu çalışmanın gerçekte izlediği harmanlama desenleri ile.",
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
    id: "tender-response-studio",
    title: { en: "Tender Response Studio", ar: "استوديو الاستجابة للمناقصات" },
    description: {
      en: "End-to-end orchestration of mega-tender responses: parse RFP, qualify bid/no-bid, draft sections in parallel, model pricing, run legal red-team, compile submission packet.",
      ar: "تنسيق شامل للاستجابة للمناقصات الكبرى: تحليل كرّاسة الشروط، تقييم قرار التقديم، صياغة الأقسام بالتوازي، نمذجة التسعير، مراجعة قانونية، وإصدار حزمة التقديم النهائية.",
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
    id: "sovereign-data-steward",
    title: { en: "Sovereign Data Steward", ar: "حارس البيانات السيادي" },
    description: {
      en: "Air-gapped agentic data engineering, lineage, and mastering for sovereign and on-prem environments.",
      ar: "هندسة بيانات وكيلية معزولة وتتبع نسب البيانات وضبطها للبيئات السيادية والداخلية.",
    },
  },
  {
    id: "pricing-intelligence",
    title: { en: "Pricing Intelligence", ar: "ذكاء التسعير" },
    description: {
      en: "Real-time competitive price monitoring, demand-driven optimisation, campaign generation, and dealer coordination for consumer goods manufacturers.",
      ar: "مراقبة أسعار تنافسية آنية وتحسين مبني على الطلب وإنشاء حملات وتنسيق مع الوكلاء لمصنّعي السلع الاستهلاكية.",
    },
  },
  {
    id: "shared-services-agent",
    title: { en: "Shared Services Agent", ar: "وكيل الخدمات المشتركة" },
    description: {
      en: "End-to-end agent platforms for BPOs and shared-services centres — payroll, HR ops, finance back-office — with regulator-grade audit trails and human checkpoints.",
      ar: "منصات وكلاء شاملة لمراكز الخدمات المشتركة وشركات التعهيد — الرواتب والموارد البشرية والمالية الخلفية — مع مسارات تدقيق تنظيمية ونقاط مراجعة بشرية.",
    },
  },
  {
    id: "personal-agent",
    title: {
      en: "Workforce / Personal Agent",
      ar: "وكيل القوى العاملة / المساعد الشخصي",
      tr: "İşgücü / Kişisel Ajan",
    },
    description: {
      en: "An always-on, per-employee AI agent that learns each person's job and personal life, stores it in an employee-owned Personal Context Graph, and acts autonomously under a glass-box trust model.",
      ar: "مساعد ذكاء اصطناعي شخصي لكل موظف يتعلّم عمله وحياته الشخصية، ويخزّنها في رسم سياق شخصي مملوك للموظف، ويعمل ذاتياً ضمن نموذج ثقة زجاجي شفّاف.",
      tr: "Her çalışana özel, her zaman açık bir yapay zekâ ajanı: kişinin işini ve kişisel yaşamını öğrenir, çalışana ait Kişisel Bağlam Grafiği'nde saklar ve cam-kutu güven modeli altında özerk biçimde hareket eder.",
    },
  },
];

export const marketplaceHorizontals: MarketplaceHorizontalMeta[] = [
  { id: "pmo", title: { en: "PMO", ar: "مكتب إدارة المشاريع" } },
  { id: "supply-chain", title: { en: "Supply Chain", ar: "سلسلة التوريد" } },
  { id: "fpa", title: { en: "FP&A", ar: "التخطيط والتحليل المالي" } },
  { id: "hr-payroll", title: { en: "HR & Payroll", ar: "الموارد البشرية والرواتب" } },
];

// Raw catalogue without `agentCast` — we attach the cast at module load
// from `./agentCasts.ts` so the tool entry itself owns the cast metadata
// (the schema contract) without bloating this file. See
// `marketplaceTools` below for the consumer-facing array.
const marketplaceToolsBase: Omit<MarketplaceToolEntry, "agentCast">[] = [
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
        audience: { en: "Transformation & PMO", ar: "فريق التحوّل ومكتب البرامج" },
        description: { en: "Watch the Realization Conductor coordinate scoring, attribution and re-baseline agents end-to-end on a single board pack — for the technical and PMO teams operating the system.", ar: "شاهد منسّق تحقيق القيمة وهو ينسّق وكلاء التقييم والإسناد وإعادة الاحتساب على حزمة مجلس واحدة — للفرق التقنية ومكتب البرامج المشغّلة للنظام." },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "cockpit",
        label: { en: "CFO Benefits Cockpit", ar: "قمرة المدير المالي" },
        audience: { en: "CFOs & Heads of Transformation", ar: "المدراء الماليون ورؤساء التحوّل" },
        description: { en: "A CFO's daily-driver dashboard for the AI portfolio — promised vs realised AED, stalled initiatives, recommendations awaiting sign-off, and an AI assistant that briefs you for the board.", ar: "لوحة العمل اليومية للمدير المالي على محفظة الذكاء — الموعود مقابل المحقّق بالدرهم، والمبادرات المتعثّرة، والتوصيات بانتظار الاعتماد، ومساعد ذكي يحضّر ملخّص المجلس." },
        icon: "LayoutDashboard",
        route: "cockpit",
      },
    ],
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
    id: "programme-war-room",
    slug: "programme-war-room",
    title: { en: "Programme War Room", ar: "غرفة عمليات البرنامج" },
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Agent Cockpit", ar: "قمرة الوكلاء" },
        audience: { en: "Technical teams", ar: "الفرق التقنية" },
        description: { en: "Cockpit view of the orchestrator + four specialist agents producing the weekly steering pack — for technical teams monitoring agent performance.", ar: "عرض المنسّق والوكلاء الأربعة المتخصّصين أثناء إعداد عبوة التوجيه الأسبوعية — للفرق التقنية." },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "console",
        label: { en: "EPMO Command Console", ar: "قمرة قيادة المكتب التنفيذي" },
        audience: { en: "EPMO Director (Mariam Saleh)", ar: "مديرة المكتب التنفيذي (مريم صالح)" },
        description: { en: "Operator console with portfolio heatmap, programme detail, approvals queue, dependency map, decision log and audit log — for the EPMO Director running the Tuesday Steerco war room.", ar: "وحدة تشغيل تجمع خريطة المحفظة وتفاصيل البرنامج وقائمة الموافقات وخريطة الاعتماديات وسجل القرارات وسجل التدقيق — لمديرة المكتب التنفيذي." },
        icon: "LayoutDashboard",
        route: "console",
      },
    ],
  },
  {
    id: "tender-response-studio",
    slug: "tender-response-studio",
    title: { en: "Tender Response Studio", ar: "استوديو الاستجابة للمناقصات" },
    class: "tender-response-studio",
    industries: ["public-sector", "telecom", "energy-commodities"],
    horizontals: [],
    buyer: { en: "Head of Bid Management", ar: "رئيس إدارة العطاءات" },
    pitch: {
      en: "End-to-end orchestration of mega-tender responses — parse the RFP, qualify bid/no-bid, draft sections in parallel, model pricing, run a legal red-team, compile the submission packet. Three human checkpoints: bid-no-bid, pricing sign-off, legal release.",
      ar: "تنسيق شامل للاستجابة للمناقصات الكبرى — تحليل كرّاسة الشروط، تقييم قرار التقديم، صياغة الأقسام بالتوازي، نمذجة التسعير، مراجعة قانونية، وإصدار حزمة التقديم. ثلاث نقاط موافقة بشرية: قرار التقديم، اعتماد التسعير، الإفراج القانوني.",
    },
    longDescription: [
      {
        en: "A mega-tender response is a multi-week, multi-team orchestration problem. The Bid Conductor reads the RFP end-to-end, calls the Qualifier to recommend bid/no-bid, then fans out parallel Section Drafters, a Pricing Modeller, and a Partner Outreach agent — every output flows through a Legal Reviewer before the Packet Compiler stitches the final submission.",
        ar: "تُعدّ الاستجابة للمناقصات الكبرى مشكلة تنسيق متعدّد الفرق على مدى أسابيع. يقرأ منسّق العطاء كرّاسة الشروط بالكامل، ويستدعي المُقيّم لاقتراح قرار التقديم، ثم يوزّع كتّاب الأقسام ومحاكي التسعير ومسؤول التواصل مع الشركاء — وتمرّ جميع المخرجات على المراجع القانوني قبل أن يجمعها مُجمّع الحزمة في عرض التقديم النهائي.",
      },
      {
        en: "The agent never submits on the bidder's behalf. It pauses at three explicit checkpoints — Bid Director on bid/no-bid, CFO on pricing, General Counsel on legal release — so the bidder retains full accountability for every commercial and legal commitment.",
        ar: "لا يقدّم الوكيل العطاء نيابةً عن مقدّمه أبداً. يتوقّف عند ثلاث نقاط موافقة صريحة — مدير العطاءات لقرار التقديم، المدير المالي للتسعير، المستشار العام للإفراج القانوني — حتى يحتفظ مقدّم العطاء بالمساءلة الكاملة عن كل التزام تجاري وقانوني.",
      },
      {
        en: "Designed for EPC, telecom, and IT-services bidders responding to GCC government, telecom, and energy mega-tenders — Etimad, ADNOC e-Tender, ARAMCO procurement, STC and e&.",
        ar: "مصمَّم لمقدّمي عروض EPC والاتصالات وخدمات IT الذين يستجيبون للمناقصات الحكومية والاتصالاتية والطاقة في الخليج — اعتماد، مناقصات أدنوك الإلكترونية، مشتريات أرامكو، STC وe&.",
      },
    ],
    screens: [
      {
        title: { en: "RFP intake & qualifier", ar: "استلام كرّاسة الشروط والتقييم" },
        caption: {
          en: "Parsed RFP with mandatory requirements, evaluation weights, and the Qualifier's bid/no-bid recommendation with rationale.",
          ar: "كرّاسة شروط محلَّلة مع المتطلبات الإلزامية ومعايير التقييم وتوصية المُقيّم بقرار التقديم وتبريرها.",
        },
      },
      {
        title: { en: "Parallel section drafting board", ar: "لوحة صياغة الأقسام بالتوازي" },
        caption: {
          en: "Section Drafter lanes — technical, commercial, governance — running in parallel with status, draft preview, and Legal Reviewer flags.",
          ar: "مسارات كتّاب الأقسام — التقني والتجاري والحوكمة — تعمل بالتوازي مع الحالة ومعاينة المسوّدة وملاحظات المراجع القانوني.",
        },
      },
      {
        title: { en: "Pricing model & checkpoint", ar: "نموذج التسعير ونقطة الموافقة" },
        caption: {
          en: "Pricing Modeller's scenario range with margin sensitivity, partner cost-share, and the CFO sign-off gate before the price goes into the packet.",
          ar: "نطاق سيناريوهات محاكي التسعير مع حساسية الهامش وتقاسم تكلفة الشريك وبوابة موافقة المدير المالي قبل دخول السعر إلى الحزمة.",
        },
      },
      {
        title: { en: "Submission packet preview", ar: "معاينة حزمة التقديم" },
        caption: {
          en: "Compiler-assembled packet — cover letter, technical, commercial, legal annexes, partner LOIs — with citation trail back to the source RFP clause.",
          ar: "حزمة مُجمّعة — خطاب التغطية والتقني والتجاري والملاحق القانونية ورسائل نوايا الشركاء — مع سلسلة مراجع إلى بنود كرّاسة الشروط المصدرية.",
        },
      },
    ],
    dataModel: {
      inputs: [
        { en: "RFP / ITT document set, addenda, Q&A logs", ar: "وثائق كرّاسة الشروط، الملاحق، سجلات الأسئلة والأجوبة" },
        { en: "Bidder past-performance library, partner pricing cards, legal clause library", ar: "مكتبة الأداء السابق لمقدّم العطاء، بطاقات تسعير الشركاء، مكتبة البنود القانونية" },
      ],
      internal: [
        { en: "Bid Conductor planner, Qualifier scorer, Section Drafters, Pricing Modeller, Partner Outreach, Legal Reviewer, Packet Compiler", ar: "منسّق العطاء، المُقيّم، كتّاب الأقسام، محاكي التسعير، مسؤول الشركاء، المراجع القانوني، مُجمّع الحزمة" },
      ],
      outputs: [
        { en: "Bid/no-bid memo, drafted section pack, pricing scenario range, compiled submission packet, audit log of every checkpoint", ar: "مذكّرة قرار التقديم، حزمة الأقسام المسوّدة، نطاق سيناريوهات التسعير، حزمة التقديم المجمّعة، سجل تدقيق لكل نقطة موافقة" },
      ],
    },
    status: "live",
    accent: "#196B24",
    icon: "FileText",
    relatedService: "ai-product-studio",
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
        audience: { en: "Technical teams", ar: "الفرق التقنية" },
        description: { en: "Agent cockpit showing the Bid Conductor, specialist agents, tool calls, and the full event trace — for technical teams monitoring agent performance.", ar: "لوحة قيادة الوكلاء تعرض منسّق العطاء والوكلاء المتخصّصين واستدعاءات الأدوات وسلسلة الأحداث الكاملة — للفرق التقنية." },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "studio",
        label: { en: "Bid Manager Studio", ar: "استوديو مدير العطاءات" },
        audience: { en: "Head of Bid Management", ar: "رئيس إدارة العطاءات" },
        description: { en: "Bid manager workspace — pipeline of active tenders, question drafting, approvals, compliance gates, content library, and audit log.", ar: "مساحة عمل مدير العطاءات — مسار المناقصات النشطة، وصياغة الأسئلة، والموافقات، وبوابات الامتثال، ومكتبة المحتوى، وسجل التدقيق." },
        icon: "ClipboardCheck",
        route: "studio",
      },
    ],
  },
  {
    id: "procurement-negotiation-agent",
    slug: "procurement-negotiation-agent",
    title: { en: "Procurement Negotiation Agent", ar: "وكيل التفاوض على المشتريات" },
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
    accent: "#D9534F",
    icon: "ShoppingCart",
    relatedService: "ai-product-studio",
    demoVariants: [
      {
        id: "cockpit",
        label: { en: "Agent Cockpit", ar: "لوحة الوكلاء" },
        audience: { en: "Technical & operations teams", ar: "الفرق التقنية والتشغيلية" },
        description: { en: "Six-agent negotiation cockpit showing the conductor, specialist agents, tool calls, and the live event trace — for technical teams monitoring autonomous sourcing.", ar: "لوحة قيادة من ستة وكلاء تعرض المنسّق والوكلاء المتخصّصين واستدعاءات الأدوات وسلسلة الأحداث المباشرة — للفرق التقنية." },
        icon: "Activity",
        route: "",
      },
      {
        id: "desk",
        label: { en: "Category Manager Desk", ar: "مكتب مدير الفئة" },
        audience: { en: "Category managers & CPOs", ar: "مديرو الفئات وكبير مسؤولي المشتريات" },
        description: { en: "User-facing sourcing console with the bid matrix, round timeline, allocation slider, approvals queue, supplier 360, counter-bid composer, and audit log — for the category manager negotiating live events.", ar: "وحدة توريد للمستخدم النهائي تشمل مصفوفة العروض والخط الزمني للجولات وشريط الترسية وقائمة الموافقات وملف المورد والكاتب المضادّ وسجلّ التدقيق — لمدير الفئة في الأحداث المباشرة." },
        icon: "Briefcase",
        route: "desk",
      },
    ],
  },
  {
    id: "network-ops-war-room",
    slug: "network-ops-war-room",
    title: { en: "Network Ops War Room", ar: "غرفة عمليات الشبكة" },
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
    demoVariants: [
      {
        id: "cockpit",
        route: "cockpit",
        icon: "Activity",
        label: { en: "Agent cockpit", ar: "كوكبيت الوكلاء" },
        audience: { en: "NOC engineer · scenario walkthrough", ar: "مهندس غرفة العمليات · جولة سيناريو" },
        description: {
          en: "Watch the orchestrator and the four specialist agents triage the Sharjah-South fibre cut, with two human checkpoints.",
          ar: "شاهد المنسّق والوكلاء الأربعة وهم يفرزون قطع ألياف جنوب الشارقة، مع نقطتَي توقّف بشريّتَين.",
        },
      },
      {
        id: "noc",
        route: "noc",
        icon: "LayoutDashboard",
        label: { en: "NOC Director Console", ar: "قمرة قيادة مدير مركز عمليات الشبكة" },
        audience: { en: "Reem Al-Dosari · NOC Director, Sahara Telecom", ar: "ريم الدوسري · مدير NOC، صحارى تيليكوم" },
        description: {
          en: "Live GCC map, incident workspace, AI approval queue, enterprise SLA tracking, field-crew dispatch and a complete audit trail — the daily console for a pan-GCC NOC director.",
          ar: "خريطة الخليج الحية، مساحة الحوادث، قائمة الموافقات الذكية، متابعة اتفاقيات الأعمال، إرسال الفِرق، وسجل تدقيق كامل — الكونسول اليومي لمدير NOC إقليمي.",
        },
      },
    ],
  },
  {
    id: "sama-compliance-sentinel",
    slug: "sama-compliance-sentinel",
    title: { en: "SAMA Compliance Sentinel", ar: "حارس الامتثال لمؤسسة النقد" },
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Agent Cockpit", ar: "قمرة الوكلاء" },
        audience: { en: "Risk-platform engineers", ar: "مهندسو منصّة المخاطر" },
        description: {
          en: "Replay the full agent topology — orchestrator, monitor, policy mapper, memo drafter, evidence stager — as it ingests SAMA circular CRU-2026-04 overnight, with checkpoints for the CRO.",
          ar: "إعادة تشغيل كامل مخطط الوكلاء — المنسّق والمراقب وكاتب السياسة وكاتب المذكّرات وقوّام الأدلّة — أثناء استلامه لتعميم ساما CRU-2026-04 ليلاً مع نقاط مراجعة لرئيس المخاطر.",
        },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "console",
        label: { en: "CRO Obligations Console", ar: "قمرة الالتزامات لرئيس المخاطر" },
        audience: { en: "Chief Risk Officer", ar: "رئيس إدارة المخاطر" },
        description: {
          en: "Noura Al-Saif's daily home — 240 obligations, the controls library, returns calendar, approvals queue, and an audit log she'd happily hand to SAMA, in EN/AR.",
          ar: "الصفحة اليومية لنورا السيف — 240 التزاماً ومكتبة الضوابط وتقويم الإيداعات وقائمة الاعتمادات وسجل تدقيق تثق بتسليمه لساما — بالعربية والإنجليزية.",
        },
        icon: "ShieldCheck",
        route: "console",
      },
    ],
  },
  {
      id: "citizen-services-concierge",
      slug: "citizen-services-concierge",
      title: { en: "Citizen Services Concierge", ar: "كونسيرج خدمات المواطنين" },
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
      accent: "#5BA98A",
      icon: "Users",
      relatedService: "agentic-ai-transformation",
      relatedAssessment: "ari",
      demoVariants: [
        {
          id: "teknik",
          label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
          audience: { en: "Technical teams", ar: "الفرق التقنية" },
          description: {
            en: "Agent cockpit showing the Service Conductor, six specialist agents, tool calls, and the full event trace — for technical teams monitoring agent performance.",
            ar: "لوحة قيادة الوكلاء تعرض منسّق الكونسيرج وستة وكلاء متخصّصين واستدعاءات الأدوات وسلسلة الأحداث الكاملة — للفرق التقنية.",
          },
          icon: "Activity",
          route: "teknik",
        },
        {
          id: "officer",
          label: { en: "Case Officer Console", ar: "قمرة موظف الخدمة" },
          audience: { en: "Senior case officers & directors", ar: "موظفو الخدمة الكبار والمديرون" },
          description: {
            en: "Senior Case Officer console with bilingual queue, cross-agency case workspace, agent recommendations, director heatmap, and a policy-grounded AI assistant — what Yousef Al-Harbi sees every morning.",
            ar: "قمرة موظف الخدمة الأول مع قائمة ثنائية اللغة وملف القضيّة عبر الجهات وتوصيات الوكلاء وخريطة المديرة ومساعد ذكي يستند إلى السياسات — ما يراه يوسف الحربي كل صباح.",
          },
          icon: "Inbox",
          route: "officer",
        },
      ],
    },
    {
    id: "customer-care-hive",
    slug: "customer-care-hive",
    title: { en: "Customer Care Hive", ar: "خلية رعاية العملاء" },
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Cockpit", ar: "القمرة التقنية" },
        audience: { en: "Care operations leadership", ar: "قيادة عمليات الرعاية" },
        description: { en: "Agent cockpit showing the Hive Conductor, six specialist care agents, intent classification, QA scoring, and the full event trace — for operations teams.", ar: "قمرة الوكلاء تعرض منسّق الخلية وستة وكلاء متخصّصين والتصنيف وتقييم الجودة وسلسلة الأحداث الكاملة — لفِرَق العمليات." },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "desk",
        label: { en: "Care Agent Desk", ar: "مكتب موظف الرعاية" },
        audience: { en: "Senior care agents (Aisha persona)", ar: "موظفو الرعاية الأوائل (شخصية عائشة)" },
        description: { en: "Three-pane Zendesk-style desk with conversation timeline, AI draft, customer 360, knowledge hits, supervisor strip and approvals — what a senior care agent uses every shift.", ar: "مكتب من ثلاث لوحات على نمط Zendesk مع خط زمني للمحادثة ومسوّدة ذكية وملف العميل 360 ومعرفة مقترحة وشريط مشرف واعتمادات — ما يستخدمه موظف الرعاية كل وردية." },
        icon: "Headphones",
        route: "desk",
      },
    ],
  },
  {
    id: "sovereign-data-steward",
    slug: "sovereign-data-steward",
    title: { en: "Sovereign Data Steward", ar: "حارس البيانات السيادي" },
    class: "sovereign-data-steward",
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
        audience: { en: "Technical teams", ar: "الفرق التقنية" },
        description: {
          en: "Agent cockpit showing the orchestrator, six specialist agents, tool calls, and the full event trace — for technical teams monitoring agent performance.",
          ar: "لوحة قيادة الوكلاء تعرض المنسّق وستة وكلاء متخصّصين واستدعاءات الأدوات وسلسلة الأحداث الكاملة — للفرق التقنية.",
        },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "console",
        label: { en: "CDO Sovereign Console", ar: "قمرة المدير الرقمي السيادية" },
        audience: { en: "CDO + Head of AI Foundations", ar: "المدير الرقمي ورئيس أُسس الذكاء" },
        description: {
          en: "Catalogue of 32 data products with KPI tiles, decision queue, lineage map, obligations register, and audit log — what Mansour, the CDO, lives in every day.",
          ar: "كتالوج 32 منتج بيانات مع مؤشرات وقائمة قرارات وخريطة نسب وسجل التزامات وسجل تدقيق — ما يعيش فيه منصور، المدير الرقمي، يومياً.",
        },
        icon: "Database",
        route: "console",
      },
    ],
  },
  {
    id: "enterprise-knowledge-concierge",
    slug: "enterprise-knowledge-concierge",
    title: { en: "Enterprise Knowledge Concierge", ar: "كونسيرج المعرفة المؤسسية" },
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
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
        audience: { en: "AI engineering & governance teams", ar: "فرق هندسة الذكاء الاصطناعي والحوكمة" },
        description: {
          en: "Agent cockpit showing the Concierge Conductor and five specialist agents (Permission Filter, Retriever, Drafter, Citation Auditor, Confidence Scorer), every tool call and the full event trace — for technical teams monitoring agent behaviour.",
          ar: "لوحة قيادة الوكلاء تعرض منسّق الكونسيرج وخمسة وكلاء متخصّصين (فلتر الصلاحيات، المسترجِع، الكاتب، مدقّق الاستشهاد، مصنّف الثقة) واستدعاءات الأدوات وسلسلة الأحداث الكاملة — للفرق التقنية.",
        },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "chat",
        label: { en: "Knowledge Chat", ar: "محادثة المعرفة" },
        audience: { en: "CFOs, analysts, treasury, legal counsel, external consultants", ar: "المديرون الماليون والمحلّلون والخزينة والمستشارون القانونيون والاستشاريون الخارجيون" },
        description: {
          en: "Persona-aware enterprise knowledge chat: pick a persona, ask in plain language, see grounded answers with inline citations, withhold disclosures, a confidence chip, and a defensible refusal when the asker's ACL is too narrow.",
          ar: "دردشة معرفة مؤسسيّة واعية بالشخصية: اختر شخصية، اسأل بلغة طبيعية، واطّلع على إجابات مؤصّلة بمراجع داخلية، وإفصاحات عمّا حُجب، ورقاقة ثقة، ورفض مبرّر حين تكون صلاحيات السائل ضيّقة.",
        },
        icon: "MessageSquare",
        route: "chat",
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
  {
    id: "arcelik-fiyat-istihbarati",
    slug: "arcelik-fiyat-istihbarati",
    title: { en: "Arçelik Pricing Intelligence", ar: "ذكاء تسعير أرتشيليك" },
    class: "pricing-intelligence",
    industries: ["retail-consumer"],
    horizontals: [],
    buyer: { en: "Pricing Director", ar: "مدير التسعير" },
    pitch: {
      en: "AI-powered competitive pricing intelligence for Turkey's largest white goods manufacturer — real-time competitor monitoring across 8 brands, demand-driven pricing for 60+ product lines, automated campaign generation with dealer-ready creative, and coordinated push to 3,000+ exclusive dealers.",
      ar: "ذكاء تسعير تنافسي مدعوم بالذكاء الاصطناعي لأكبر مصنّع أجهزة منزلية في تركيا — مراقبة آنية للمنافسين عبر 8 علامات تجارية وتسعير مبني على الطلب لأكثر من 60 خط إنتاج وإنشاء حملات آلي مع إبداعات جاهزة للوكلاء وتنسيق مع أكثر من 3,000 وكيل حصري.",
    },
    longDescription: [
      {
        en: "Arçelik — Turkey's largest white goods manufacturer — manages competitive pricing across 60+ product lines, 7 categories, and 8 major competitor brands, while coordinating pricing and promotions through a network of 3,000+ exclusive dealers in 81 provinces. Manual price monitoring misses competitor moves, regional demand shifts, and promotional gaps — costing market share points every quarter.",
        ar: "أرتشيليك — أكبر مصنّع للأجهزة المنزلية في تركيا — تدير التسعير التنافسي عبر أكثر من 60 خط منتج و7 فئات و8 علامات تجارية منافسة رئيسية، بينما تنسّق التسعير والعروض عبر شبكة تضم أكثر من 3,000 وكيل حصري في 81 ولاية. المراقبة اليدوية للأسعار تُفوّت تحرّكات المنافسين وتغيّرات الطلب الإقليمي والفجوات الترويجية — ممّا يكلّف نقاط حصة سوقية كل ربع سنة.",
      },
      {
        en: "The Pricing Intelligence platform deploys six specialised AI agents — from real-time competitor price scraping to campaign creative generation to dealer push — coordinated by an orchestrator that gates every pricing decision and campaign launch through human checkpoints. The result: a pricing director who sees every competitor move within hours, not days, and can respond with a targeted campaign before the market adjusts.",
        ar: "تنشر منصة ذكاء التسعير ستة وكلاء ذكاء اصطناعي متخصّصين — من رصد أسعار المنافسين آنياً إلى إنشاء إبداعات الحملات وصولاً إلى التنسيق مع الوكلاء — بقيادة منسّق يمرّر كل قرار تسعيري وإطلاق حملة عبر نقاط موافقة بشرية. النتيجة: مدير تسعير يرى كل تحرّك منافس خلال ساعات وليس أيام ويستطيع الاستجابة بحملة موجّهة قبل أن يتكيّف السوق.",
      },
      {
        en: "Purpose-built for the Turkish white goods market — the platform natively understands ÖTV and KDV tax incentive dynamics, seasonal patterns from Ramazan to the summer wedding season, regional demand variation across 20 major cities, and the trade-in programmes that drive dealer incentives. Three demo experiences show the platform from every stakeholder's perspective: the technical team, the business user, and the dealer.",
        ar: "مصمّمة خصيصاً لسوق الأجهزة المنزلية التركي — تفهم المنصة بشكل أصيل ديناميكيات ضرائب ÖTV وKDV والأنماط الموسمية من رمضان إلى موسم الأعراس الصيفي وتفاوت الطلب الإقليمي عبر 20 مدينة رئيسية وبرامج الاستبدال التي تحفّز الوكلاء. ثلاث تجارب عرض تُظهر المنصة من منظور كل صاحب مصلحة: الفريق التقني والمستخدم التجاري والوكيل.",
      },
    ],
    screens: [
      {
        title: { en: "Competitor radar", ar: "رادار المنافسين" },
        caption: { en: "Real-time price comparison across 8 competitor brands with sparkline trends, city-by-city breakdowns, and automated price-drop alerts.", ar: "مقارنة أسعار آنية عبر 8 علامات منافسة مع رسوم بيانية للاتجاهات وتحليل حسب المدينة وتنبيهات تلقائية بانخفاض الأسعار." },
      },
      {
        title: { en: "Turkey pricing heatmap", ar: "خريطة حرارية لأسعار تركيا" },
        caption: { en: "Interactive SVG map of Turkey showing market share, price indices, and demand signals across 20 cities — click any city to drill down.", ar: "خريطة SVG تفاعلية لتركيا تعرض الحصة السوقية ومؤشرات الأسعار وإشارات الطلب عبر 20 مدينة — انقر على أي مدينة للتعمّق." },
      },
      {
        title: { en: "Campaign studio", ar: "استوديو الحملات" },
        caption: { en: "AI-generated campaign briefs with creative headlines, dealer POS materials, SMS notifications, and projected ROI — ready for the marketing director to approve.", ar: "موجزات حملات مُنشأة بالذكاء الاصطناعي مع عناوين إبداعية ومواد نقاط البيع للوكلاء وإشعارات SMS وعائد استثمار متوقّع — جاهزة لموافقة مدير التسويق." },
      },
      {
        title: { en: "Dealer compliance dashboard", ar: "لوحة التزام الوكلاء" },
        caption: { en: "Dealer network health — compliance scores, sales targets, stock levels, and commission tracking across 3,000+ exclusive dealers.", ar: "صحة شبكة الوكلاء — درجات الالتزام وأهداف المبيعات ومستويات المخزون وتتبّع العمولات عبر أكثر من 3,000 وكيل حصري." },
      },
      {
        title: { en: "What-if pricing simulator", ar: "محاكي ماذا-لو للتسعير" },
        caption: { en: "Drag a price slider and watch cascading impact projections — market share, revenue, margin, predicted competitor response, and dealer satisfaction.", ar: "اسحب شريط السعر وشاهد توقعات الأثر المتتالي — الحصة السوقية والإيرادات والهامش واستجابة المنافس المتوقّعة ورضا الوكلاء." },
      },
    ],
    dataModel: {
      inputs: [
        { en: "Competitor price feeds (8 brands, 80+ SKUs), dealer sales data (3,000+ dealers)", ar: "بيانات أسعار المنافسين (8 علامات، أكثر من 80 وحدة)، بيانات مبيعات الوكلاء (أكثر من 3,000 وكيل)" },
        { en: "Market research reports, ÖTV/KDV tax tables, seasonal demand patterns", ar: "تقارير أبحاث السوق، جداول ضريبة ÖTV/KDV، أنماط الطلب الموسمي" },
        { en: "Promotional calendar (Arçelik + competitor campaigns)", ar: "التقويم الترويجي (حملات أرتشيليك + المنافسين)" },
      ],
      internal: [
        { en: "Price optimisation model, demand forecasting engine, campaign ROI model", ar: "نموذج تحسين الأسعار، محرّك التنبؤ بالطلب، نموذج عائد الحملات" },
        { en: "Competitor response predictor, dealer compliance scorer", ar: "متنبّئ استجابة المنافسين، مصنّف التزام الوكلاء" },
      ],
      outputs: [
        { en: "Price recommendations (city × category × product), campaign briefs with creative", ar: "توصيات أسعار (مدينة × فئة × منتج)، موجزات حملات مع إبداعات" },
        { en: "Dealer price lists, POS materials, SMS/WhatsApp dealer notifications", ar: "قوائم أسعار الوكلاء، مواد نقاط البيع، إشعارات SMS/واتساب للوكلاء" },
      ],
    },
    status: "live",
    accent: "#E30613",
    icon: "LineChart",
    demoVariants: [
      {
        id: "teknik",
        label: { en: "Technical Monitoring Panel", ar: "لوحة المراقبة التقنية" },
        audience: { en: "Technical teams", ar: "الفرق التقنية" },
        description: { en: "Agent cockpit showing the orchestrator, six specialist agents, tool calls, and the full event trace — for technical teams monitoring agent performance.", ar: "لوحة قيادة الوكلاء تعرض المنسّق وستة وكلاء متخصّصين واستدعاءات الأدوات وسلسلة الأحداث الكاملة — للفرق التقنية." },
        icon: "Activity",
        route: "teknik",
      },
      {
        id: "dashboard",
        label: { en: "Business User Dashboard", ar: "لوحة تحكّم المستخدم التجاري" },
        audience: { en: "Pricing directors & category managers", ar: "مديرو التسعير ومديرو الفئات" },
        description: { en: "Interactive pricing dashboard with competitor radar, campaign studio, what-if simulator, promotional calendar, and an AI assistant — for pricing directors.", ar: "لوحة تسعير تفاعلية مع رادار المنافسين واستوديو الحملات ومحاكي ماذا-لو والتقويم الترويجي ومساعد ذكي — لمديري التسعير." },
        icon: "BarChart3",
        route: "dashboard",
      },
      {
        id: "bayi",
        label: { en: "Dealer Portal", ar: "بوابة الوكلاء" },
        audience: { en: "Arçelik's 3,000+ exclusive dealers", ar: "أكثر من 3,000 وكيل حصري لأرتشيليك" },
        description: { en: "Dealer-facing portal with price lists, campaigns, targets, stock management, and a conversational assistant — what Arçelik's 3,000+ exclusive dealers see.", ar: "بوابة للوكلاء تشمل قوائم الأسعار والحملات والأهداف وإدارة المخزون ومساعد محادثة — ما يراه أكثر من 3,000 وكيل حصري." },
        icon: "Users",
        route: "bayi",
      },
    ],
  },
  {
    id: "tasama-payroll-hub",
    slug: "tasama-payroll-hub",
    title: { en: "Payroll Intelligence Hub", ar: "مركز ذكاء الرواتب" },
    class: "shared-services-agent",
    industries: ["financial-services", "public-sector"],
    horizontals: ["hr-payroll", "fpa"],
    buyer: { en: "Head of Shared Services / CFO", ar: "رئيس الخدمات المشتركة / المدير المالي" },
    pitch: {
      en: "Ten autonomous agents orchestrate end-to-end payroll for your clients — from document ingestion through GOSI filing and Mudad transfers — with human checkpoints where trust matters.",
      ar: "عشرة وكلاء ذاتيون ينسقون مسيّرات الرواتب من البداية إلى النهاية — من استلام الوثائق حتى تقديم التأمينات وتحويلات مُدد — مع نقاط مراجعة بشرية حيث تهم الثقة.",
    },
    longDescription: [
      {
        en: "Saudi payroll is uniquely complex: GOSI contributions split between Saudi annuity tracks and OHRP-only expat tracks, EOSB provisions accruing under Article 84, Mudad wage protection submissions, Saudization band monitoring under Nitaqat, Iqama renewals, and dozens of edge cases per pay cycle. For BPOs running shared-services payroll across multiple clients, the manual workload compounds — and a single missed GOSI filing or Mudad rejection cascades into compliance penalties and client churn.",
        ar: "الرواتب في المملكة العربية السعودية معقدة بشكل فريد: اشتراكات التأمينات الاجتماعية المقسمة بين مسارات تقاعد السعوديين ومسارات OHRP للوافدين، ومخصصات نهاية الخدمة وفق المادة 84، وتقديمات حماية الأجور عبر مُدد، ومراقب نطاقات السعودة، وتجديدات الإقامة، وعشرات الحالات الاستثنائية في كل دورة. بالنسبة لشركات التعهيد التي تدير الرواتب المشتركة عبر عدة عملاء، يتراكم العبء اليدوي — وأي تقديم فائت للتأمينات أو رفض من مُدد يتسبب في غرامات امتثال وفقدان عملاء.",
      },
      {
        en: "The Payroll Intelligence Hub deploys ten specialised agents — Document Intelligence, Salary Calculation, GOSI Compliance, Mudad Bank Transfer, EOSB Provision, Leave Management, Saudization Monitor, Performance & Audit, Client Communications, and an Orchestrator that coordinates them — gated by three human checkpoints: the Payroll Manager who approves each run, the Finance Controller who signs off settlements, and the Compliance Officer who authorises every regulatory submission. Each agents output is auditable, every decision is logged, and confidence scores are calibrated so reviewers know exactly when to trust the agent and when to drill in.",
        ar: "ينشر مركز ذكاء الرواتب عشرة وكلاء متخصصين — ذكاء الوثائق، وحساب الرواتب، وامتثال التأمينات، وتحويلات مُدد البنكية، ومخصصات نهاية الخدمة، وإدارة الإجازات، ومراقب السعودة، والأداء والتدقيق، واتصالات العملاء، ومنسّق ينسق بينهم جميعاً — تحت رقابة ثلاث نقاط مراجعة بشرية: مدير الرواتب الذي يعتمد كل دورة، والمراقب المالي الذي يوقع على التسويات، وضابط الامتثال الذي يجيز كل تقديم تنظيمي. مخرجات كل وكيل قابلة للتدقيق، وكل قرار موثّق، ودرجات الثقة معايرة بحيث يعرف المراجعون متى يثقون بالوكيل ومتى يتعمقون.",
      },
      {
        en: "Three perspectives bring the platform to life. The Digital Team experience shows the 10-agent topology processing a live monthly cycle for three demo clients — Al-Nakhla Construction (18 employees), Luma Retail (14), and Vertex Tech (10) — with full event traces and agent performance scorecards. The Client Portal lets each client upload documents, track their employees, and see AI-generated insights specific to their roster. The Manager Dashboard gives the Tasama operations team agent performance management, decision analytics, the regulatory calendar, and a what-if simulator for headcount, salary, and compliance scenarios.",
        ar: "ثلاث منظورات تُحيي المنصة. تجربة الفريق الرقمي تُظهر مخطط الوكلاء العشرة وهو يعالج دورة شهرية حية لثلاثة عملاء تجريبيين — النخلة للمقاولات (18 موظفاً)، ولوما للتجزئة (14)، وفيرتكس للتقنية (10) — مع مسارات أحداث كاملة وبطاقات أداء الوكلاء. بوابة العميل تتيح لكل عميل تحميل الوثائق وتتبع موظفيه ورؤية رؤى مولّدة بالذكاء الاصطناعي خاصة بقائمته. لوحة المدير تمنح فريق عمليات تسامة إدارة أداء الوكلاء وتحليلات القرارات والتقويم التنظيمي ومحاكي ماذا-لو لسيناريوهات أعداد الموظفين والرواتب والامتثال.",
      },
    ],
    screens: [
        {
          title: { en: "Agent Orchestration", ar: "تنسيق الوكلاء" },
          caption: { en: "Watch 10 specialised agents coordinate a monthly payroll cycle in real time, with full audit trail and human checkpoints.", ar: "شاهد 10 وكلاء متخصصين ينسقون دورة رواتب شهرية في الوقت الفعلي، مع مسار تدقيق كامل ونقاط مراجعة بشرية." },
        },
        {
          title: { en: "Document Intelligence", ar: "ذكاء الوثائق" },
          caption: { en: "Upload employment contracts, termination letters, and HR documents — the Document Intelligence Agent extracts structured data with field-level confidence scores.", ar: "حمّل عقود العمل ورسائل إنهاء الخدمة ووثائق الموارد البشرية — يستخرج وكيل ذكاء الوثائق البيانات المهيكلة مع درجات ثقة على مستوى الحقل." },
        },
        {
          title: { en: "GOSI & Mudad Compliance", ar: "امتثال التأمينات ومُدد" },
          caption: { en: "Automated GOSI contribution calculations, filing generation, and Mudad wage protection submissions with regulatory deadline tracking.", ar: "حساب آلي لاشتراكات التأمينات وإنشاء التقديمات وإرسال حماية الأجور عبر مُدد مع تتبع المواعيد التنظيمية." },
        },
        {
          title: { en: "Agent Performance Management", ar: "إدارة أداء الوكلاء" },
          caption: { en: "Monitor each agent's accuracy, speed, autonomy, and confidence calibration. Track human override rates and identify performance drift before it impacts operations.", ar: "راقب دقة كل وكيل وسرعته واستقلاليته ومعايرة ثقته. تتبع معدلات تجاوز البشر وحدد انحراف الأداء قبل أن يؤثر على العمليات." },
        },
        {
          title: { en: "Payroll Simulator", ar: "محاكي الرواتب" },
          caption: { en: "Model headcount changes, salary adjustments, and compliance scenarios. See instant impact on GOSI costs, Saudization ratios, and total payroll.", ar: "نمذج تغييرات أعداد الموظفين وتعديلات الرواتب وسيناريوهات الامتثال. شاهد التأثير الفوري على تكاليف التأمينات ونسب السعودة وإجمالي الرواتب." },
        },
      ],
      dataModel: {
        inputs: [
          { en: "Employee master records (42 employees across 3 clients)", ar: "السجلات الرئيسية للموظفين (42 موظفاً عبر 3 عملاء)" },
          { en: "Employment contracts and HR letters (PDF, bilingual EN/AR)", ar: "عقود العمل ورسائل الموارد البشرية (PDF، ثنائية اللغة)" },
          { en: "Bank details and IBAN numbers, leave requests and attendance data", ar: "بيانات البنك وأرقام الآيبان وطلبات الإجازات وبيانات الحضور" },
          { en: "Client company profiles, Saudization ratios, regulatory calendar", ar: "ملفات الشركات العميلة ونسب السعودة والتقويم التنظيمي" },
        ],
        internal: [
          { en: "GOSI contribution calculation engine (Saudi annuity + OHRP)", ar: "محرك حساب اشتراكات التأمينات (تقاعد السعوديين + OHRP)" },
          { en: "EOSB provision and settlement formulas (Article 84 Saudi Labor Law)", ar: "صيغ مخصصات وتسوية نهاية الخدمة (المادة 84 من نظام العمل السعودي)" },
          { en: "Saudization ratio monitoring (Nitaqat band classification)", ar: "مراقبة نسب السعودة (تصنيف نطاقات نطاقات)" },
          { en: "Agent performance scoring model and document extraction confidence model", ar: "نموذج تسجيل أداء الوكلاء ونموذج ثقة استخراج الوثائق" },
        ],
        outputs: [
          { en: "Monthly payslips with full gross-to-net breakdown", ar: "كشوف رواتب شهرية مع تفصيل كامل من الإجمالي للصافي" },
          { en: "GOSI monthly filing files and Mudad wage protection submissions", ar: "ملفات تقديم التأمينات الشهرية وتقديمات حماية الأجور عبر مُدد" },
          { en: "Final settlement statements (EOSB + leave encashment + remaining salary)", ar: "كشوف التسوية النهائية (نهاية الخدمة + صرف الإجازات + الراتب المتبقي)" },
          { en: "Regulatory compliance reports and agent performance scorecards", ar: "تقارير الامتثال التنظيمي وبطاقات أداء الوكلاء" },
        ],
      },
      status: "live",
      accent: "#2563EB",
      icon: "Wallet",
      demoVariants: [
        {
          id: "teknik",
          label: { en: "Agent Operations", ar: "عمليات الوكلاء" },
          audience: { en: "Digital Team", ar: "الفريق الرقمي" },
          description: { en: "Watch the 10-agent payroll pipeline process a monthly cycle end-to-end.", ar: "شاهد خط أنابيب الرواتب المكون من 10 وكلاء يعالج دورة شهرية كاملة." },
          icon: "Bot",
          route: "teknik",
        },
        {
          id: "client",
          label: { en: "Client Portal", ar: "بوابة العميل" },
          audience: { en: "Tasama Clients", ar: "عملاء تسامة" },
          description: { en: "Upload documents, track employees, and monitor your payroll — with AI agent insights throughout.", ar: "حمّل الوثائق، وتابع الموظفين، وراقب رواتبك — مع رؤى الوكلاء الذكية في كل خطوة." },
          icon: "Building2",
          route: "client",
        },
        {
          id: "manager",
          label: { en: "Operations Dashboard", ar: "لوحة العمليات" },
          audience: { en: "Payroll Managers", ar: "مديرو الرواتب" },
          description: { en: "Manage agent performance, approve recommendations, run compliance checks, and simulate scenarios.", ar: "أدِر أداء الوكلاء، ووافق على التوصيات، ونفّذ فحوصات الامتثال، وحاكِ السيناريوهات." },
          icon: "LayoutDashboard",
          route: "manager",
        },
      ],
    },
  // ── Maven Personal Agent ────────────────────────────────────────────────
    // Per-employee AI agent with an employee-owned Personal Context Graph.
    // Two killer demos: the Cockpit (chat + workspace + glass-box) and
    // the Mind (interactive PCG visualisation with time scrubber).
    {
      id: "maven-personal-agent",
      slug: "maven-personal-agent",
      title: {
        en: "Maven Personal Agent",
        ar: "مساعد Maven الشخصي",
        tr: "Maven Kişisel Ajan",
      },
      class: "personal-agent",
      industries: ["financial-services", "telecom", "retail-consumer", "public-sector"],
      horizontals: ["pmo"],
      buyer: {
        en: "CHRO, CIO, CDO — and ultimately every employee",
        ar: "الرئيس التنفيذي للموارد البشرية، الرئيس التنفيذي للمعلومات، الرئيس التنفيذي للبيانات — والموظف نفسه في النهاية",
        tr: "İK Direktörü, Bilgi Direktörü, Veri Direktörü — ve nihayetinde her çalışan",
      },
      pitch: {
        en: "An always-on AI agent for every employee. Learns the job and the person, stores it in a Personal Context Graph the employee owns and can port between employers, and acts autonomously under a glass-box trust model.",
        ar: "مساعد ذكاء اصطناعي دائم العمل لكل موظف. يتعلّم العمل والشخص، يخزّن المعرفة في رسم سياق شخصي يملكه الموظف وينقله بين أصحاب العمل، ويعمل ذاتياً ضمن نموذج ثقة زجاجي شفّاف.",
        tr: "Her çalışana özel, her zaman açık bir yapay zekâ ajanı. İşi ve kişiyi öğrenir, çalışanın sahip olduğu ve işverenler arasında taşıyabildiği Kişisel Bağlam Grafiği'nde saklar ve cam-kutu güven modeli altında özerk biçimde hareket eder.",
      },
      longDescription: [
        {
          en: "Today every AI assistant — Cedric, Microsoft 365 Copilot Memory, ChatGPT Memory — locks the employee's accumulated context inside the vendor's or employer's silo. When the employee changes tools or jobs, they start over. The Personal Agent inverts this: the Personal Context Graph (PCG) is owned by the employee, scoped to work and personal life with a clean privacy boundary, and exportable as JSON-LD on demand. The employer pays for work-scope access, not for the memory itself.",
          ar: "اليوم، كل مساعد ذكاء اصطناعي — سيدريك، ذاكرة Microsoft 365 Copilot، ذاكرة ChatGPT — يحبس السياق المتراكم للموظف داخل صومعة المورد أو صاحب العمل. عند تغيير الأداة أو الوظيفة يبدأ الموظف من الصفر. يقلب المساعد الشخصي هذا: رسم السياق الشخصي مملوك للموظف، مفصول بين العمل والحياة الخاصة بحدود خصوصية واضحة، وقابل للتصدير كـ JSON-LD عند الطلب. يدفع صاحب العمل مقابل وصول نطاق العمل لا مقابل الذاكرة نفسها.",
          tr: "Bugün her yapay zekâ asistanı — Cedric, Microsoft 365 Copilot Memory, ChatGPT Memory — çalışanın biriktirdiği bağlamı satıcının veya işverenin silosunda kilitler. Çalışan araç veya iş değiştirince sıfırdan başlar. Kişisel Ajan bunu tersine çevirir: Kişisel Bağlam Grafiği (PCG) çalışana aittir, iş ve kişisel yaşam arasında net bir gizlilik sınırıyla ayrılır ve istek üzerine JSON-LD olarak dışa aktarılabilir. İşveren bellek için değil, iş-kapsamı erişim için öder.",
        },
        {
          en: "Every assistant answer is grounded in the exact PCG nodes that informed it, surfaced live in a Glass-box rail. Every autonomous action drops a receipt: what was done, which nodes informed the decision, the confidence, the time saved, and a one-click undo. This is the antidote to the surveillance and black-box anxiety that plagues enterprise AI today.",
          ar: "كل إجابة من المساعد مؤصّلة في عقد الرسم نفسها التي استُخدمت لتوليدها، وتُعرض مباشرة في شريط الصندوق الزجاجي. كل إجراء آلي يترك إيصالاً: ما تمّ، أي عقد استُند إليها، الثقة، الوقت الموفّر، وزر تراجع واحد. هذا هو الترياق لقلق المراقبة والصندوق الأسود الذي يثقل الذكاء الاصطناعي المؤسسي اليوم.",
          tr: "Her asistan yanıtı, onu bilgilendiren tam PCG düğümlerine dayalıdır ve canlı olarak Cam-kutu şeridinde görünür. Her özerk eylem bir makbuz bırakır: ne yapıldı, hangi düğümler kararı bilgilendirdi, güven, kazanılan zaman ve tek-tıkla geri al. Bu, kurumsal yapay zekâyı bugün rahatsız eden gözetim ve kara-kutu kaygısının panzehiridir.",
        },
        {
          en: "The Personal Agent is one agent for the whole person. It can draft your offer letter and remember your daughter's recital. The employee owns personal-scope autonomy at all times; the employer sees only aggregate work-scope outcomes — never raw observations or chat content. Two demos make this concrete: the Cockpit (the agent's chat + workspace + glass-box receipts) and the Mind (the live PCG with a Day-1-to-Year-1 time scrubber).",
          ar: "المساعد الشخصي وكيل واحد للشخص بأكمله. يمكنه صياغة خطاب عرضك وتذكّر حفلة ابنتك. يملك الموظف الاستقلالية الشخصية دوماً؛ يرى صاحب العمل النتائج المجمّعة لنطاق العمل فقط — لا الملاحظات الخام ولا محتوى الدردشة. عرضان تفاعليان يجعلان ذلك ملموساً: القمرة (دردشة + مساحة عمل + إيصالات شفّافة) والعقل (رسم السياق الحي مع شريط زمني من اليوم الأول إلى السنة الأولى).",
          tr: "Kişisel Ajan, tüm insan için tek bir ajandır. Teklif mektubunuzu yazabilir ve kızınızın konserini hatırlayabilir. Çalışan kişisel-kapsam özerkliğine her zaman sahiptir; işveren yalnızca toplu iş-kapsamı sonuçları görür — ham gözlemleri veya sohbet içeriğini asla görmez. İki demo bunu somutlaştırır: Kokpit (ajanın sohbeti + çalışma alanı + cam-kutu makbuzları) ve Zihin (Gün-1'den Yıl-1'e zaman kaydırıcılı canlı PCG).",
        },
      ],
      screens: [
        {
          title: { en: "The Cockpit — chat, workspace, glass-box rail", ar: "القمرة — دردشة ومساحة عمل وشريط زجاجي", tr: "Kokpit — sohbet, çalışma alanı, cam-kutu şeridi" },
          caption: { en: "Three-pane assistant UI: real Claude chat (grounded in the PCG), four workspace modules (learnings, pending approvals, in-progress tasks, personal nudges), and a live Context-used rail that shows exactly which graph nodes the agent consulted.", ar: "واجهة مساعد بثلاث لوحات: دردشة كلود حقيقية (مؤصّلة في الرسم)، أربع وحدات في مساحة العمل (التعلّمات، انتظار الموافقة، قيد التنفيذ، تنبيهات شخصية)، وشريط السياق المستخدم الحي الذي يُظهر العقد التي استشارها المساعد.", tr: "Üç panelli asistan arayüzü: gerçek Claude sohbeti (PCG'ye dayalı), dört çalışma alanı modülü (öğrenmeler, bekleyen onaylar, sürmekte olan görevler, kişisel hatırlatmalar) ve ajanın hangi grafik düğümlerine danıştığını gösteren canlı Kullanılan Bağlam şeridi." },
        },
        {
          title: { en: "The Mind — Personal Context Graph", ar: "العقل — رسم السياق الشخصي", tr: "Zihin — Kişisel Bağlam Grafiği" },
          caption: { en: "Constellation-style force-directed graph. Categories cluster (Role, Skills, Relationships, Preferences, Personal, Projects, Tools). Time scrubber animates Day 1 → Year 1. Click a node to see what was learned, when, source, confidence, and how the agent has used it.", ar: "رسم قوة مجموعات على شكل كوكبات. تتجمّع الفئات (الدور، المهارات، العلاقات، التفضيلات، الشخصي، المشاريع، الأدوات). شريط زمني يحرّك من اليوم الأول إلى السنة الأولى. انقر عقدة لترى ماذا تعلّم المساعد ومتى ومن أي مصدر وبأي ثقة وكيف استخدمها.", tr: "Takım-yıldız tarzı kuvvet-yönlendirmeli grafik. Kategoriler kümelenir (Rol, Beceriler, İlişkiler, Tercihler, Kişisel, Projeler, Araçlar). Zaman kaydırıcısı Gün 1 → Yıl 1 animasyonu yapar. Bir düğüme tıklayarak neyin, ne zaman, hangi kaynaktan, hangi güvenle öğrenildiğini ve ajanın bunu nasıl kullandığını görün." },
        },
        {
          title: { en: "Glass-box receipts and one-click undo", ar: "إيصالات شفّافة وزر تراجع واحد", tr: "Cam-kutu makbuzları ve tek-tıkla geri alma" },
          caption: { en: "Every autonomous action — a sent follow-up, a booked slot, a drafted offer letter — drops a receipt that lists the PCG nodes consulted, the autonomy level, the time saved, and an Undo button. No black boxes.", ar: "كل إجراء آلي — متابعة أُرسلت، موعد حُجز، خطاب عرض صيغ — يترك إيصالاً يذكر عقد الرسم المستشارة ومستوى الاستقلالية والوقت الموفّر وزر تراجع. لا صناديق سوداء.", tr: "Her özerk eylem — gönderilen bir takip, ayrılan bir randevu, taslağı çıkarılan bir teklif mektubu — danışılan PCG düğümlerini, özerklik seviyesini, kazanılan zamanı ve bir Geri-al düğmesini listeleyen bir makbuz bırakır. Kara kutu yok." },
        },
        {
          title: { en: "Privacy scope toggle (Work / Personal / Both)", ar: "مفتاح نطاق الخصوصية (عمل / شخصي / كلاهما)", tr: "Gizlilik kapsamı düğmesi (İş / Kişisel / Her ikisi)" },
          caption: { en: "Toggling Personal off fades all personal-scope nodes from the Mind — the exact slice the employer would ever see in production. The employee owns the personal scope at all autonomy levels.", ar: "إيقاف شخصي يُلاشي كل العقد ذات النطاق الشخصي من العقل — الشريحة الوحيدة التي قد يراها صاحب العمل في الإنتاج. يملك الموظف النطاق الشخصي في كل مستويات الاستقلالية.", tr: "Kişisel'i kapatmak Zihin'deki tüm kişisel-kapsam düğümlerini soldurur — işverenin üretimde göreceği tek dilim. Çalışan, kişisel kapsama tüm özerklik düzeylerinde sahiptir." },
        },
        {
          title: { en: "Export my graph (employee-owned, portable)", ar: "تصدير رسمي (مملوك للموظف وقابل للنقل)", tr: "Grafiğimi dışa aktar (çalışana ait, taşınabilir)" },
          caption: { en: "One click exports the PCG as JSON-LD — the employee's portable memory wallet. When they change jobs, the graph leaves with them; the new employer can import the work-scope subset they sign for.", ar: "نقرة واحدة تصدّر الرسم بصيغة JSON-LD — محفظة الذاكرة المحمولة للموظف. عند تغيير الوظيفة يأخذ الموظف الرسم معه؛ يستطيع صاحب العمل الجديد استيراد شريحة العمل التي يوقّع عليها.", tr: "Tek tık PCG'yi JSON-LD olarak dışa aktarır — çalışanın taşınabilir bellek cüzdanı. İş değiştirdiğinde grafik onunla gider; yeni işveren imzaladığı iş-kapsamı alt kümesini içe aktarabilir." },
        },
      ],
      dataModel: {
        inputs: [
          { en: "Calendar, email, chat, meeting transcripts, doc edits, ATS / CRM activity (read-only by scope)", ar: "تقويم، بريد، دردشة، نسخ اجتماعات، تعديلات وثائق، نشاط ATS/CRM (قراءة فقط بحسب النطاق)", tr: "Takvim, e-posta, sohbet, toplantı transkriptleri, doküman düzenlemeleri, ATS / CRM etkinliği (kapsama göre salt okunur)" },
          { en: "Employee corrections and explicit teach-me snippets", ar: "تصحيحات الموظف ومقاطع تعليم صريحة", tr: "Çalışan düzeltmeleri ve açık öğretici parçalar" },
          { en: "Per-capability autonomy policy (employee for personal scope; manager for work scope)", ar: "سياسة استقلالية لكل قدرة (الموظف للنطاق الشخصي؛ المدير للعمل)", tr: "Yetenek başına özerklik politikası (kişisel kapsam için çalışan; iş kapsamı için yönetici)" },
        ],
        internal: [
          { en: "Personal Context Graph: nodes (entity / preference / skill / relationship / personal / project / tool / domain) and edges with confidence + decay", ar: "رسم السياق الشخصي: عقد (كيان/تفضيل/مهارة/علاقة/شخصي/مشروع/أداة/مجال) ورؤوس بثقة وانحلال", tr: "Kişisel Bağlam Grafiği: düğümler (varlık / tercih / beceri / ilişki / kişisel / proje / araç / alan) ve güven + zayıflama ile kenarlar" },
          { en: "Per-node provenance log: source, learnedAt, lastUsedAt, useCount, scope (work/personal)", ar: "سجل أصل لكل عقدة: المصدر، تاريخ التعلّم، آخر استخدام، عدّاد الاستخدام، النطاق (عمل/شخصي)", tr: "Düğüm başına köken günlüğü: kaynak, öğrenildiği zaman, son kullanım, kullanım sayısı, kapsam (iş/kişisel)" },
          { en: "Glass-box receipt for every autonomous action — undoable", ar: "إيصال شفّاف لكل إجراء آلي — قابل للتراجع", tr: "Her özerk eylem için cam-kutu makbuzu — geri alınabilir" },
        ],
        outputs: [
          { en: "Drafts (emails, follow-ups, offer letters, FAQs, briefs) for human approval or autonomous send", ar: "مسودات (بريد، متابعات، خطابات عرض، أسئلة شائعة، موجزات) لموافقة بشرية أو إرسال آلي", tr: "Taslaklar (e-postalar, takipler, teklif mektupları, SSS'ler, brifingler) insan onayı veya özerk gönderim için" },
          { en: "Personal nudges (cross-life: book the florist, draft the toast, block calendar)", ar: "تنبيهات شخصية (عبر الحياة: حجز محل الزهور، صياغة الكلمة، حجز التقويم)", tr: "Kişisel hatırlatmalar (yaşamlar arası: çiçekçiyi ayırt, konuşmayı taslakla, takvimi blokla)" },
          { en: "Aggregate manager-observability metrics (hours saved, automated task types, satisfaction)", ar: "مقاييس مرئية للمدير مجمّعة (الساعات الموفّرة، أنواع المهام الآلية، الرضا)", tr: "Toplu yönetici-gözlemlenebilirlik metrikleri (kazanılan saatler, otomatik görev türleri, memnuniyet)" },
          { en: "Portable PCG export (JSON-LD) — employee-owned, free at any time", ar: "تصدير رسم محمول (JSON-LD) — مملوك للموظف، مجاني في أي وقت", tr: "Taşınabilir PCG dışa aktarımı (JSON-LD) — çalışana ait, her zaman ücretsiz" },
        ],
      },
      status: "live",
      accent: "#a78bfa",
      icon: "BrainCircuit",
      relatedService: "agentic-ai-transformation",
      demoVariants: [
        {
          id: "cockpit",
          label: { en: "Open the Cockpit", ar: "افتح القمرة", tr: "Kokpit'i aç" },
          audience: { en: "Day-in-the-life of the agent in action", ar: "يوم في حياة المساعد أثناء العمل", tr: "Ajanın iş başındaki bir günü" },
          description: {
            en: "Chat + workspace + glass-box rail. Switch persona (Sales · HR) and language (EN · AR · TR) up top. Approve a drafted follow-up, watch the receipt land with the PCG citations and undo button, then ask the chat a question and see exactly which nodes were consulted.",
            ar: "دردشة + مساحة عمل + شريط زجاجي. بدّل الشخصية (مبيعات · موارد بشرية) واللغة (EN · AR · TR) من الأعلى. وافق على متابعة مصاغة، شاهد الإيصال يصل مع استشهادات الرسم وزر التراجع، ثم اسأل الدردشة وشاهد أي عقد تم استشارتها.",
            tr: "Sohbet + çalışma alanı + cam-kutu şeridi. Üstten kişiyi (Satış · İK) ve dili (EN · AR · TR) değiştirin. Hazırlanmış bir takibi onaylayın, makbuzun PCG atıfları ve geri-al düğmesiyle düştüğünü izleyin, ardından sohbete bir soru sorun ve hangi düğümlerin danışıldığını tam olarak görün.",
          },
          icon: "MessageSquare",
          route: "cockpit",
        },
        {
          id: "mind",
          label: { en: "Open the Mind", ar: "افتح العقل", tr: "Zihni aç" },
          audience: { en: "Watch a PCG grow from Day 1 to Year 1", ar: "شاهد الرسم ينمو من اليوم الأول إلى السنة الأولى", tr: "Bir PCG'nin Gün 1'den Yıl 1'e büyümesini izleyin" },
          description: {
            en: "Force-directed PCG with category constellations. Drag the time scrubber Day 1 → Year 1 and watch nodes/edges fade in. Click any node for provenance and how the agent has been using it. Toggle Work / Personal / Both to see the privacy boundary. Export the graph as JSON-LD.",
            ar: "رسم قوة مجموعات بـ كوكبات الفئات. اسحب شريط الزمن من اليوم الأول إلى السنة الأولى وشاهد العقد والرؤوس تظهر تباعاً. انقر أي عقدة لمعرفة الأصل وكيف يستخدمها المساعد. بدّل عمل/شخصي/كلاهما لرؤية حدود الخصوصية. صدّر الرسم بصيغة JSON-LD.",
            tr: "Kategori takım-yıldızlarıyla kuvvet-yönlendirmeli PCG. Zaman kaydırıcısını Gün 1 → Yıl 1 sürükleyin ve düğümlerin/kenarların görünmesini izleyin. Köken ve ajanın nasıl kullandığını görmek için herhangi bir düğüme tıklayın. Gizlilik sınırını görmek için İş / Kişisel / Her ikisi'ni değiştirin. Grafiği JSON-LD olarak dışa aktarın.",
          },
          icon: "BrainCircuit",
          route: "mind",
        },
      ],
    },
];

// Attach the agent cast for each tool so the consumer-facing
// `marketplaceTools` array is the single source of truth for cast metadata.
// `agentCasts.ts` only `import type`s from this file, so importing it here
// does not create a runtime cycle.
import { marketplaceAgentCasts } from "./agentCasts";

export const marketplaceTools: MarketplaceToolEntry[] = marketplaceToolsBase.map(
  (t) => {
    const cast = marketplaceAgentCasts[t.slug];
    if (!cast) {
      throw new Error(
        `[knowledge.ts] Marketplace tool "${t.slug}" has no agentCast in agentCasts.ts. Every tool must declare its named agent cast.`,
      );
    }
    return { ...t, agentCast: cast };
  },
);

/**
 * Look up the marketplace card accent for a given tool slug.
 *
 * Demo headers and the accents that flow through their tokens.ts read from
 * this single source of truth so the colour shown on the marketplace card
 * carries through into the launched demo.
 */
export function getDemoAccent(slug: string, fallback = "#156082"): string {
  const tool = marketplaceTools.find((t) => t.slug === slug);
  return tool?.accent ?? fallback;
}

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
