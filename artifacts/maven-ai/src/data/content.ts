// Long-form marketing copy. Structural identifiers (slugs, ids, titles)
// live in `@workspace/maven-content`; the assertions at the bottom of
// this file catch drift at module load.
import {
  services as sharedServices,
  industries as sharedIndustries,
  insights as sharedInsights,
  assessments as sharedAssessments,
  marketplaceTools as sharedMarketplaceTools,
  marketplaceClasses as sharedMarketplaceClasses,
  marketplaceHorizontals as sharedMarketplaceHorizontals,
  marketplaceAgentCasts as sharedAgentCasts,
  homepageStats,
} from "@workspace/maven-content";

export {
  sharedServices as servicesIndex,
  sharedIndustries as industriesIndex,
  sharedInsights as insightsIndex,
  sharedAssessments as assessmentsIndex,
  sharedMarketplaceTools as marketplaceTools,
  sharedMarketplaceClasses as marketplaceClasses,
  sharedMarketplaceHorizontals as marketplaceHorizontals,
  sharedAgentCasts as marketplaceAgentCasts,
};

// Single source of truth for which slugs ship a real interactive demo
// component. Imported here AND by `pages/MarketplaceDetail.tsx`, where the
// DEMOS dispatch map asserts at module load that its keys exactly match this
// list — so adding to one without the other fails fast at startup rather
// than silently 404ing the route.
import { REGISTERED_DEMO_SLUG_SET as REGISTERED_DEMO_SLUGS } from "./registeredDemoSlugs";

function assertSharedAlignment(
  kind: string,
  localKeys: string[],
  sharedKeys: string[],
): void {
  const local = new Set(localKeys);
  const shared = new Set(sharedKeys);
  for (const k of shared) {
    if (!local.has(k)) {
      throw new Error(
        `[content.ts] ${kind} "${k}" exists in @workspace/maven-content but not in the local marketing copy. Update one or the other so the chat allow-list stays in sync.`,
      );
    }
  }
  for (const k of local) {
    if (!shared.has(k)) {
      throw new Error(
        `[content.ts] ${kind} "${k}" exists locally but not in @workspace/maven-content. Add it to lib/maven-content/src/knowledge.ts so the chat assistant can link to it.`,
      );
    }
  }
}

export const founders = [
  {
    id: "mounir-aris",
    name: "Mounir Aris",
    title: "Senior Partner",
    location: "Dubai, UAE",
    image: "/images/founder-mounir.png",
    bio: "Mounir Aris brings over 20 years of strategy and digital transformation experience across GCC and MENA. Previously a Partner at a Big-4 advisory firm, he led national AI strategy engagements for sovereign wealth funds, government ministries, and major financial institutions. A trusted C-suite advisor, Mounir has shaped enterprise AI roadmaps for some of the region's largest organizations — from public safety infrastructure to national financial platforms. He founded Maven AI to solve the problem he witnessed throughout his career: world-class AI ambitions collapsing at the point of execution.",
    shortBio: "20+ years in strategy and AI transformation across GCC. Former Big-4 Partner. Advisor to sovereign funds and government ministries.",
    quote: "The organizations that will win the next decade are not the ones that started AI first — they are the ones that moved AI from the slide deck to production. That is the only gap we exist to close.",
    expertise: ["AI Strategy", "Enterprise Transformation", "C-Suite Advisory", "Sovereign Fund Engagement"],
    linkedin: "https://linkedin.com/in/mouniraris",
  },
  {
    id: "gokhan-guney",
    name: "Gokhan Guney",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    image: "/images/founder-gokhan.png",
    bio: "Gokhan Guney is a technology architect and delivery leader with 15+ years building enterprise AI systems across the MENA region and Europe. His expertise spans agentic AI platforms, LLM orchestration, and cloud-native engineering for large-scale government and enterprise clients. Previously, he led engineering delivery at a global technology consultancy, where he was responsible for some of the most complex AI implementations in GCC's public sector. Gokhan joined Maven AI to build the engineering practice he always wished existed: one that values senior technical judgment, sovereign-capable delivery, and production outcomes over slide decks.",
    shortBio: "15+ years in enterprise AI engineering. Expert in agentic AI platforms and LLM orchestration for MENA public sector.",
    quote: "Every client we work with has 10 to 30 AI pilots running. Almost none of them are in production. The bottleneck is never the model — it's the data, the governance, and the courage to re-engineer the operating model around the agent.",
    expertise: ["Agentic AI Architecture", "LLM Orchestration", "Cloud Engineering", "On-Prem AI Deployment"],
    linkedin: "https://linkedin.com/in/gokhanguney",
  },
  {
    id: "alper-kulak",
    name: "Alper Kulak",
    title: "Senior Partner",
    location: "Dubai, UAE",
    image: "/images/founder-alper.png",
    bio: "Alper Kulak is one of the GCC's foremost experts in data platform modernization, AI governance, and data mesh architectures. Over 15 years, he has built data foundations for telecoms, banks, and government entities across the Gulf and Europe — the unglamorous but essential infrastructure that makes AI trustworthy. As former Head of Data Practice at a global systems integrator, Alper has seen firsthand how AI ambition is defeated by unmastered data, broken lineage, and governance gaps. At Maven AI, he leads the Data & Governance practice, ensuring every agent the firm builds stands on solid data foundations.",
    shortBio: "Data platform and AI governance expert. 15+ years building data foundations for GCC telecoms, banks, and government.",
    quote: "AI exposes your data debt on day one. You cannot build trustworthy agents on top of fragmented, unmastered data. We fix the foundation while the business case is still live — not three years later.",
    expertise: ["Data Governance", "Data Mesh Architecture", "AI Foundations", "Lineage & Mastering"],
    linkedin: "https://linkedin.com/in/alperkulak",
  },
  {
    id: "khalid-al-khudairi",
    name: "Khalid Al Khudairi",
    title: "Senior Partner",
    location: "Riyadh, KSA",
    image: "/images/founder-khalid.png",
    bio: "Khalid Al Khudairi is a Saudi national with deep relationships across the Kingdom's government, sovereign fund, and private sector ecosystem. With 12+ years advising on Vision 2030 programs, he has been at the center of Saudi Arabia's most consequential digital transformation initiatives — from national health platforms to smart city infrastructure. Khalid's specialization in change management, AI adoption, and organizational transformation fills the gap that most technology firms ignore: the human and institutional change required to make AI actually work inside large organizations. He brings to Maven AI the relationships and regional credibility that open doors, and the change expertise that keeps clients.",
    shortBio: "KSA Vision 2030 advisor with deep PIF and government relationships. 12+ years in AI adoption and organizational transformation.",
    quote: "Vision 2030 and the UAE AI Charter are not aspirations — they are procurement mandates. The organizations that embed AI in their operating fabric today will define the public sector benchmarks for a generation.",
    expertise: ["Change Management", "Vision 2030 Programs", "AI Adoption", "Organizational Transformation"],
    linkedin: "https://linkedin.com/in/khalidAlKhudairi",
  },
];

export const services = [
  {
    id: "agentic-ai",
    slug: "agentic-ai-transformation",
    title: "Agentic AI Transformation",
    tagline: "Reimagining operations with agents at the core",
    icon: "Brain",
    color: "#156082",
    buyer: "CEO, COO, CXO",
    description: "We help organizations reimagine how they operate — with AI agents owning end-to-end work: deciding, acting, learning, and coordinating with humans in production. Not chatbots. Not workflows. Agents that own outcomes.",
    longDescription: "Maven AI's Agentic AI Transformation practice sits at the intersection of business strategy and production engineering. We start by quantifying the value case — the specific decisions, actions, and outcomes that agents will own — before a single line of code is written. Then we build, deploy, and run production agents that measurably change how the organization operates.",
    useCases: [
      "Automated regulatory compliance agents for financial institutions — detecting, validating, and filing without human intervention",
      "Agentic procurement and vendor management for government entities, from RFP generation to contract monitoring",
      "Customer service transformation: multi-agent systems handling tier-1 and tier-2 resolution end-to-end",
      "National safety operations: AI agents managing incident detection, dispatch routing, and regulatory notification in real time",
    ],
    engagementModel: [
      { phase: "Discover & Value-Case", duration: "2–3 weeks", description: "Identify high-value agentic opportunities, quantify outcomes, prioritize the engagement backlog" },
      { phase: "Prototype", duration: "3–4 weeks", description: "Working agent demonstrating core capability, integrated with 1–2 production data sources" },
      { phase: "Production MVP", duration: "8–12 weeks", description: "Production-grade agent with governance layer, observability, and human-in-the-loop design" },
      { phase: "Scale & Operate", duration: "Ongoing", description: "Additional use cases, model iteration, telemetry, and continuous improvement" },
    ],
    relatedReport: "the-agentic-enterprise",
    stats: [
      { value: "95%", label: "of enterprise GenAI pilots deliver no measurable P&L impact (MIT NANDA, 2025)" },
      { value: "3 weeks", label: "from scope to working prototype" },
      { value: "90 days", label: "from kickoff to production MVP" },
    ],
  },
  {
    id: "legacy-mod",
    slug: "ai-driven-sdlc",
    title: "AI-Driven SDLC & Legacy Modernization",
    tagline: "Unlock your legacy — AI-first, on-prem capable",
    icon: "Code2",
    color: "#F5A623",
    buyer: "CIO, CTO",
    description: "Industry research puts 60–80% of IT budgets into maintaining existing systems. We use AI-driven engineering to spec legacy systems, accelerate modernization, and reduce technical debt — with on-prem capability for sovereign data clients.",
    longDescription: "Most organizations know their legacy systems are slowing them down. What they don't have is a safe, fast path out. Maven AI's spec-from-legacy methodology uses AI to extract, document, and re-engineer legacy codebases — dramatically accelerating modernization timelines while preserving institutional logic. For sovereign clients who cannot move workloads to public cloud, we deliver on-prem at scale.",
    useCases: [
      "Siebel CRM migration: AI-driven specification extraction and on-prem re-engineering for telecoms",
      "Banking core system documentation: generating complete functional specs from COBOL and legacy Java systems",
      "Government platform modernization: end-to-end re-engineering of citizen service platforms with AI-driven testing",
      "SDLC acceleration: reducing development cycle times by 40–60% using agentic coding and automated QA",
    ],
    engagementModel: [
      { phase: "Legacy Audit & Spec Extraction", duration: "3–6 weeks", description: "AI-powered documentation of existing system logic, data structures, and integration points" },
      { phase: "Architecture & Modernization Blueprint", duration: "2–4 weeks", description: "Target architecture design, migration sequencing, risk assessment" },
      { phase: "Accelerated Build", duration: "12–24 weeks", description: "AI-assisted development of replacement systems with continuous integration" },
      { phase: "Cutover & Stabilization", duration: "4–8 weeks", description: "Parallel running, cutover management, post-migration optimization" },
    ],
    relatedReport: "legacy-modernization-playbook",
    stats: [
      { value: "60–80%", label: "of IT budgets globally trapped maintaining existing systems (EY, 2024)" },
      { value: "40–60%", label: "reduction in SDLC cycle times with AI engineering" },
      { value: "On-prem", label: "capable for sovereign data environments" },
    ],
  },
  {
    id: "data-governance",
    slug: "data-governance-foundations",
    title: "Data & Governance Foundations",
    tagline: "The foundation that makes AI trustworthy",
    icon: "Database",
    color: "#F5A623",
    buyer: "CDO, CRO",
    description: "AI exposes data debt on day one. We build the data platforms, lineage, masters, and governance frameworks that make AI agents trustworthy — activation work, not strategy decks.",
    longDescription: "Every AI project surfaces the same problem within weeks: the data isn't ready. Fragmented sources, unmastered identities, absent lineage, broken governance. Maven AI's Data & Governance practice is built for this exact problem. We treat data foundations as engineering work, not advisory — and we deliver activated platforms, not reports about platforms.",
    useCases: [
      "Data platform modernization for national telecoms: unified data mesh across operational, customer, and network domains",
      "AI-grade governance implementation for sovereign wealth funds: lineage, mastering, and policy enforcement for investment data",
      "Healthcare data platform: federated patient data architecture with privacy-preserving AI analytics for national health authorities",
      "Financial services MDM: customer identity mastering across 14 legacy systems for a regional bank",
    ],
    engagementModel: [
      { phase: "Data Discovery & Debt Assessment", duration: "2–4 weeks", description: "Inventory of data assets, quality assessment, governance gap analysis, AI-readiness scoring" },
      { phase: "Architecture & Standards", duration: "3–5 weeks", description: "Data mesh or lakehouse design, governance framework, mastering strategy, tooling selection" },
      { phase: "Platform Build & Activation", duration: "10–20 weeks", description: "Data platform implementation, lineage deployment, master data management, governance enforcement" },
      { phase: "AI Enablement", duration: "4–8 weeks", description: "Feeding governance layer into AI inference pipelines, agent context stores, and retrieval systems" },
    ],
    relatedReport: "ai-governance-gulf",
    stats: [
      { value: "Day 1", label: "AI exposes your data debt — we fix it while the business case is live" },
      { value: "14+", label: "data systems consolidated in typical enterprise MDM engagement" },
      { value: "100%", label: "of Maven AI engagements start with a data readiness assessment" },
    ],
  },
  {
    id: "ai-product-studio",
    slug: "ai-product-studio",
    title: "AI Product Studio",
    tagline: "From idea to production in 90 days",
    icon: "Rocket",
    color: "#196B24",
    buyer: "CXO, Business Heads",
    description: "Productized AI solutions for repeatable vertical use cases. We go from idea to MVP in 90 days — reusable IP that compounds margin and shortens the path from business case to deployed product.",
    longDescription: "Maven AI's Product Studio takes a fundamentally different approach to AI product development: we treat AI solutions as products, not projects. That means version control, telemetry, product management discipline, and roadmaps — not just delivery milestones. Our 90-day MVP sprint gets working software in front of users fast enough to learn before the business case expires.",
    useCases: [
      "Regulatory intelligence platform: AI-powered monitoring and analysis of GCC regulatory changes for compliance teams",
      "Procurement intelligence agent: automated vendor discovery, qualification, and comparison for government procurement offices",
      "HR operations AI suite: candidate screening, onboarding coordination, and performance analytics for large enterprises",
      "Smart contract analysis: AI-powered contract review and risk flagging for legal and commercial teams in financial services",
    ],
    engagementModel: [
      { phase: "Sprint 0: Define & Scope", duration: "1–2 weeks", description: "Product definition, success metrics, technical scoping, MVP feature set, user story mapping" },
      { phase: "Sprint 1–6: Build", duration: "6–8 weeks", description: "Agile development sprints with weekly demos, continuous integration, user feedback integration" },
      { phase: "Sprint 7–8: Harden & Launch", duration: "2–3 weeks", description: "Production hardening, security review, deployment, monitoring and observability setup" },
      { phase: "Post-launch: Iterate", duration: "Ongoing", description: "Product telemetry review, model improvement, feature expansion, roadmap prioritization" },
    ],
    relatedReport: "90-day-mvp",
    stats: [
      { value: "90 days", label: "from kickoff to production MVP — guaranteed" },
      { value: "3×", label: "faster than Tier-1 firm delivery timelines" },
      { value: "Reusable IP", label: "compounds margin across subsequent engagements" },
    ],
  },
];

type InsightLang = "en" | "ar" | "tr";
type InsightLike = { title: string; summary: string; content: string; titleAr?: string; titleTr?: string; summaryAr?: string; summaryTr?: string; contentAr?: string; contentTr?: string };
export function insightTitle(i: InsightLike, lang: InsightLang): string {
  if (lang === "ar") return i.titleAr ?? i.title;
  if (lang === "tr") return i.titleTr ?? i.title;
  return i.title;
}
export function insightSummary(i: InsightLike, lang: InsightLang): string {
  if (lang === "ar") return i.summaryAr ?? i.summary;
  if (lang === "tr") return i.summaryTr ?? i.summary;
  return i.summary;
}
export function insightContent(i: InsightLike, lang: InsightLang): string {
  if (lang === "ar") return i.contentAr ?? i.content;
  if (lang === "tr") return i.contentTr ?? i.content;
  return i.content;
}

export const insights = [
    {
      id: "the-agentic-enterprise",
      slug: "the-agentic-enterprise",
      title: "The Agentic Enterprise: From Pilot to Production",
      category: "Agentic AI",
      type: "Report",
      date: "Updated May 2026",
      readTime: "16 min read",
      author: "Maven AI Research & Advisory",
      coverImage: "/images/report-1.png",
      summary: "MIT NANDA finds ~95% of enterprise GenAI pilots deliver no measurable P&L impact and BCG places only 26% of firms past pilots. We synthesise the published research and set out the four-layer architecture and GCC implementation sequence that close the gap.",
      featured: true,
      tags: ["Agentic AI", "Enterprise", "GCC", "Production"],
      content: `
  <h2>Thesis</h2>
  <p>The pilot-to-production gap in enterprise GenAI is now well documented, and it is not closing on its own. MIT NANDA's <em>State of AI in Business 2025</em> reports that roughly 95% of enterprise GenAI pilots deliver no measurable P&L impact, and that fewer than ~5% of integrated systems generate meaningful value (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>). BCG's 2024 <em>Where's the Value in AI?</em> places only 26% of companies past pilots and just 4% at the elite frontier (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>). The bottleneck is not the model. It is the layered work — value framing, governed data, agent design, change management — that turns a working demo into work the enterprise actually trusts.</p>
  <h2>What the Evidence Shows</h2>
  <p>Three findings are now consistent across the major published surveys:</p>
  <ul>
  <li><strong>Workflow redesign drives EBIT impact.</strong> McKinsey's <em>State of AI</em> 2024 survey identifies workflow redesign as the single practice most strongly correlated with material bottom-line impact from GenAI (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
  <li><strong>Adoption has run ahead of governance.</strong> Stanford HAI's <em>2025 AI Index</em> reports that 78% of organizations now use AI in at least one function, while responsible-AI investment has not kept pace (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>).</li>
  <li><strong>Agentic AI is a near-term enterprise pattern.</strong> Gartner places agentic AI at the top of its 2025 strategic technology trends and projects that a meaningful share of enterprise software decisions will be made autonomously by agents by 2028 (<a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">Gartner, 2024</a>).</li>
  </ul>
  <p>EY's <em>AI Pulse Survey</em> adds the sober counterpart: leaders' largest barriers are not model selection but data readiness, governance, and integration (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">EY, 2024</a>). For GCC enterprises, this matches what we see in delivery: the work that closes the gap is unglamorous and almost entirely upstream of the agent itself.</p>
  <h2>Why Pilots Stall — Four Failure Modes</h2>
  <ul>
  <li><strong>Data readiness collapse.</strong> Fragmented sources, unmastered identities, missing lineage, and policies that block the data the agent needs.</li>
  <li><strong>Governance vacuum.</strong> Production AI without the policy, monitoring, and audit layer that GCC regulators — SAMA, CBUAE, SDAIA — increasingly require for material decisions.</li>
  <li><strong>Operating-model resistance.</strong> Roles, processes, and incentives left untouched while the agent is bolted on. McKinsey's research is explicit that this pattern is the dominant predictor of zero EBIT impact (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
  <li><strong>Architecture mismatch.</strong> Demo-grade prototypes that cannot be observed, evaluated, scaled, or upgraded.</li>
  </ul>
  <h2>A Four-Layer Architecture</h2>
  <p>Maven AI's framework is a deliberate response to those four failure modes. None of the layers is novel on its own; the discipline is treating all four as in-scope from day one rather than retrofitting the missing ones after a pilot stalls.</p>
  <h3>Layer 0 — Value Case</h3>
  <p>Outcome-led shaping. Specific decisions and actions the agent will own, with measurable before/after metrics. If the value case cannot be quantified, the engagement does not advance.</p>
  <h3>Layer 1 — Data &amp; AI Foundations</h3>
  <p>Lineage, masters, governed context, and the retrieval infrastructure agents depend on. Investment here is what makes the resulting agent both auditable and trustworthy.</p>
  <h3>Layer 2 — Agentic AI</h3>
  <p>Production agents that decide, act, learn, and coordinate — built on the appropriate platform for the client's cloud and sovereignty posture (LangGraph, LangChain, Microsoft Copilot Studio, or sovereign open-weight models such as TII's Falcon and Inception's Jais where on-prem is required) (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">TII Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Inception Jais</a>).</p>
  <h3>Layer 3 — Change, Adoption, Upskilling</h3>
  <p>Process redesign, role redesign, and training. The layer most providers under-resource — and the one McKinsey's evidence singles out as the difference between AI investment and AI return.</p>
  <h2>A GCC Implementation Sequence</h2>
  <p>The phases are stable across organizations; the duration varies with data maturity.</p>
  <ul>
  <li><strong>Weeks 1–3 — Value case &amp; pilot selection.</strong> Quantified business case, executive sponsorship, single bounded use case.</li>
  <li><strong>Weeks 4–7 — Data readiness sprint.</strong> Even well-scoped pilots surface data problems; address them before integration, not during.</li>
  <li><strong>Weeks 8–12 — Prototype build.</strong> Working agent on production data, not synthetic.</li>
  <li><strong>Weeks 13–20 — Production hardening.</strong> Governance, observability, security review, regulator-grade audit logs.</li>
  <li><strong>Weeks 21–26 — Change &amp; launch.</strong> Process redesign, role mapping, training, go-live with monitoring.</li>
  </ul>
  <h2>The Regulatory Frame Is Already Here</h2>
  <p>Production GCC AI deployments now operate under a real regulatory frame. The UAE AI Office's <em>National AI Strategy 2031</em> and the <em>UAE Charter for the Development &amp; Use of AI</em> set the principle layer (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">UAE AI Office</a>). UAE Federal Decree-Law No. 45 of 2021 (PDPL) and Saudi Arabia's PDPL administered by SDAIA set the data layer (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">UAE PDPL</a>; <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">Saudi PDPL via SDAIA</a>). SAMA's published frameworks for cyber resilience and IT governance set the financial-services bar (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>). CBUAE plays an equivalent role in the UAE (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>).</p>
  <h2>Recommendations</h2>
  <ul>
  <li><strong>Audit data readiness before selecting the use case.</strong> The use case can be perfect and still fail on broken data.</li>
  <li><strong>Build the governance layer before the agent, not after.</strong> Retrofitting governance onto a production system is structurally more expensive and more risky than building it in.</li>
  <li><strong>Resource change management at parity with engineering.</strong> A change-to-engineering ratio below 1:2 is the most common predictor of post-launch under-utilisation.</li>
  <li><strong>Choose a delivery partner whose economics align with production.</strong> Partners that profit from extended advisory have no structural incentive to cut their own engagement short.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>The GenAI Divide: State of AI in Business 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu/ai_report_2025.pdf</a></li>
  <li>McKinsey &amp; Company, <em>The State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Boston Consulting Group, <em>Where's the Value in AI?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>Gartner, <em>Top 10 Strategic Technology Trends for 2025</em>. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>EY, <em>AI Pulse Survey</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>UAE AI Office — <em>National AI Strategy 2031 &amp; UAE Charter for AI</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>UAE Federal Decree-Law No. 45 of 2021 (PDPL). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>SDAIA — <em>Saudi PDPL</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>SAMA — <em>Rules &amp; Instructions</em>. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>Central Bank of the UAE. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  </ol>
      `,
      contentAr: `
  <h2>الأطروحة</h2>
  <p>الفجوة بين النماذج التجريبية والإنتاج في تطبيقات الذكاء الاصطناعي التوليدي بالمؤسسات وثّقت جيداً الآن، وهي لا تغلق من تلقاء نفسها. تقرير ميت ناندا <em>حالة الذكاء الاصطناعي في الأعمال 2025</em> يُفيد بأن تقريباً 95% من النماذج التجريبية للذكاء الاصطناعي التوليدي بالمؤسسات لا تحقق تأثيراً قابلاً للقياس على الربح والخسارة، وأن أقل من ~5% من الأنظمة المدمجة تولد قيمة حقيقية (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">ميت ناندا، 2025</a>). يضع تقرير بي سي جي 2024 <em>أين تكمن القيمة في الذكاء الاصطناعي؟</em> فقط 26% من الشركات بعد المرحلة التجريبية و 4% فقط في الحدود النخبوية (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">بي سي جي، 2024</a>). الاختناق ليس في النموذج. بل هو العمل الطبقي - تحديد القيمة، البيانات المُحكومة، تصميم الوكيل، إدارة التغيير - الذي يحول عرضاً توضيحياً فعالاً إلى عمل تثق به المؤسسة فعلاً.</p>
  <h2>ما تُظهره الأدلة</h2>
  <p>ثلاثة نتائج متسقة الآن عبر الدراسات الاستقصائية الكبرى المنشورة:</p>
  <ul>
  <li><strong>إعادة تصميم سير العمل تدفع تأثير الأرباح قبل الفائدة.</strong> تحدد دراسة ماكينزي <em>حالة الذكاء الاصطناعي</em> 2024 إعادة تصميم سير العمل باعتبارها الممارسة الوحيدة الأقوى ارتباطاً بالتأثير المادي على صافي الربح من الذكاء الاصطناعي التوليدي (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">ماكينزي، 2024</a>).</li>
  <li><strong>تجاوزت الاعتماد الحوكمة.</strong> يُفيد <em>مؤشر الذكاء الاصطناعي 2025</em> من ستانفورد إتش إيه آي بأن 78% من المنظمات تستخدم الذكاء الاصطناعي في وظيفة واحدة على الأقل، بينما لم تواكب استثمارات الذكاء الاصطناعي المسؤول الخطى (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">ستانفورد إتش إيه آي، 2025</a>).</li>
  <li><strong>الذكاء الاصطناعي الوكيل هو نمط مؤسسي قريب الأجل.</strong> يضع جارتنر الذكاء الاصطناعي الوكيل في أعلى اتجاهات التكنولوجيا الإستراتيجية 2025 ويتنبأ بأن حصة ذات معنى من قرارات برامج المؤسسات الحالية ستُتخذ بشكل مستقل من قبل الوكلاء بحلول 2028 (<a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">جارتنر، 2024</a>).</li>
  </ul>
  <p>تضيف دراسة <em>مسح الذكاء الاصطناعي النبضي</em> من إي واي نظيراً متزناً: أكبر العوائق التي يواجهها القادة ليست اختيار النموذج بل جاهزية البيانات والحوكمة والتكامل (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">إي واي، 2024</a>). بالنسبة لمؤسسات مجلس التعاون الخليجي، هذا يتطابق مع ما نراه في التسليم: العمل الذي يسد الفجوة غير براق وحتماً سابق للوكيل نفسه تماماً.</p>
  <h2>لماذا تتعثر النماذج التجريبية - أربع أنماط فشل</h2>
  <ul>
  <li><strong>انهيار جاهزية البيانات.</strong> مصادر مجزأة، هويات غير مُتقنة، سلالة مفقودة، وسياسات تمنع البيانات التي يحتاجها الوكيل.</li>
  <li><strong>فراغ الحوكمة.</strong> ذكاء اصطناعي إنتاجي بدون طبقة السياسة والمراقبة والتدقيق التي يطلبها منظمو مجلس التعاون الخليجي بشكل متزايد - ساما، مصرف الإمارات المركزي، سدايا - للقرارات ذات الأهمية.</li>
  <li><strong>مقاومة نموذج التشغيل.</strong> الأدوار والعمليات والحوافز تُترك دون تغيير بينما يتم ربط الوكيل كإضافة. بحث ماكينزي واضح جداً بأن هذا النمط هو المتنبئ السائد بصفر تأثير أرباح قبل الفائدة (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">ماكينزي، 2024</a>).</li>
  <li><strong>عدم تطابق البنية.</strong> نماذج أولية بدرجة عرض توضيحي لا يمكن ملاحظتها أو تقييمها أو توسيع نطاقها أو ترقيتها.</li>
  </ul>
  <h2>بنية ذات أربع طبقات</h2>
  <p>إطار عمل Maven AI هو رد متعمد على أنماط الفشل الأربعة تلك. لا شيء من الطبقات جديد من تلقاء نفسه؛ الانضباط هو التعامل مع الأربعة جميعاً كضمن الإطاق من اليوم الأول بدلاً من تثبيت الناقصة منها بعد توقف النموذج التجريبي.</p>
  <h3>الطبقة 0 - حالة القيمة</h3>
  <p>تشكيل موجه بالنتائج. القرارات والإجراءات المحددة التي سيملكها الوكيل، مع مقاييس قبل وبعد قابلة للقياس. إذا لم يتمكن من تحديد كمي لحالة القيمة، فإن المشاركة لا تتقدم.</p>
  <h3>الطبقة 1 - أسس البيانات والذكاء الاصطناعي</h3>
  <p>السلالة والرئيسيات والسياق المحكوم والبنية الأساسية للاسترجاع التي يعتمد عليها الوكلاء. الاستثمار هنا هو ما يجعل الوكيل الناتج قابلاً للتدقيق وموثوقاً.</p>
  <h3>الطبقة 2 - الذكاء الاصطناعي الوكيل</h3>
  <p>وكلاء إنتاجيين يقررون ويعملون ويتعلمون ويتنسقون - مبني على المنصة المناسبة لموقف السحابة والسيادة لدى العميل (LangGraph، LangChain، Microsoft Copilot Studio، أو نماذج مفتوحة الوزن السيادية مثل Falcon من TII و Jais من Inception حيث يُطلب الداخلي) (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">TII Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Inception Jais</a>).</p>
  <h3>الطبقة 3 - التغيير والاعتماد والرفع من الكفاءات</h3>
  <p>إعادة تصميم العملية وإعادة تصميم الدور والتدريب. الطبقة التي لا يخصص لها معظم مقدمي الخدمات موارد كافية - والطبقة التي يفرق بحث ماكينزي بينها باعتبارها الفرق بين استثمار الذكاء الاصطناعي وعودة الذكاء الاصطناعي.</p>
  <h2>تسلسل التنفيذ بمجلس التعاون الخليجي</h2>
  <p>المراحل مستقرة عبر المنظمات؛ المدة تختلف مع نضج البيانات.</p>
  <ul>
  <li><strong>الأسابيع 1–3 — حالة القيمة واختيار النموذج التجريبي.</strong> حالة عمل كمية، رعاية تنفيذية، حالة استخدام محدودة واحدة.</li>
  <li><strong>الأسابيع 4–7 — سباق جاهزية البيانات.</strong> حتى النماذج التجريبية المحددة بشكل جيد تكشف عن مشاكل البيانات؛ عالجها قبل التكامل، لا أثناءه.</li>
  <li><strong>الأسابيع 8–12 — بناء النموذج الأولي.</strong> وكيل عامل على بيانات إنتاجية، لا مركبة.</li>
  <li><strong>الأسابيع 13–20 — تصلب الإنتاج.</strong> الحوكمة والقابلية للملاحظة وتدقيق الأمان وسجلات التدقيق بدرجة منظم.</li>
  <li><strong>الأسابيع 21–26 — التغيير والإطلاق.</strong> إعادة تصميم العملية ورسم الأدوار والتدريب والإطلاق مع المراقبة.</li>
  </ul>
  <h2>الإطار التنظيمي موجود بالفعل</h2>
  <p>تعمل نشرات الذكاء الاصطناعي الإنتاجية بمجلس التعاون الخليجي الآن في إطار تنظيمي حقيقي. <em>الإستراتيجية الوطنية للذكاء الاصطناعي 2031</em> لمكتب الذكاء الاصطناعي بدولة الإمارات و<em>ميثاق الإمارات لتطوير واستخدام الذكاء الاصطناعي</em> يحددان طبقة المبدأ (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">مكتب الذكاء الاصطناعي بدولة الإمارات</a>). قانون الإمارات الاتحادي رقم 45 لسنة 2021 (PDPL) والقانون السعودي (PDPL) الذي تديره سدايا يحددان طبقة البيانات (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">قانون الإمارات PDPL</a>; <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">القانون السعودي PDPL عبر سدايا</a>). تحدد أطر ساما المنشورة للقدرة على الصمود السيبراني والحوكمة الإلكترونية معيار الخدمات المالية (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">ساما</a>). يلعب مصرف الإمارات المركزي دوراً معادلاً في دولة الإمارات (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">مصرف الإمارات المركزي</a>).</p>
  <h2>التوصيات</h2>
  <ul>
  <li><strong>دقّق جاهزية البيانات قبل اختيار حالة الاستخدام.</strong> يمكن لحالة الاستخدام أن تكون مثالية وتفشل بسبب بيانات معطلة.</li>
  <li><strong>بناء طبقة الحوكمة قبل الوكيل، لا بعده.</strong> تثبيت الحوكمة على نظام إنتاجي أغلى من الناحية الهيكلية وأخطر من بنائها فيه.</li>
  <li><strong>تخصيص إدارة التغيير بالتوازي مع الهندسة.</strong> نسبة التغيير إلى الهندسة أقل من 1:2 هي المتنبئ الأكثر شيوعاً باستخدام ما بعد الإطلاق الناقص.</li>
  <li><strong>اختر شريك تسليم اقتصادياته متوافقة مع الإنتاج.</strong> الشركاء الذين يستفيدون من المشورة الممتدة ليس لديهم حافز هيكلي لتقصير مشاركتهم الخاصة.</li>
  </ul>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>ميت ناندا، <em>انقسام الذكاء الاصطناعي التوليدي: حالة الذكاء الاصطناعي في الأعمال 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu/ai_report_2025.pdf</a></li>
  <li>ماكينزي وشركاه، <em>حالة الذكاء الاصطناعي</em>، 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>مجموعة بوسطن الاستشارية، <em>أين تكمن القيمة في الذكاء الاصطناعي؟</em>، 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>ستانفورد إتش إيه آي، <em>تقرير مؤشر الذكاء الاصطناعي 2025</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>جارتنر، <em>أفضل 10 اتجاهات تكنولوجيا إستراتيجية لعام 2025</em>. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>إي واي، <em>مسح الذكاء الاصطناعي النبضي</em>، 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>مكتب الذكاء الاصطناعي بدولة الإمارات — <em>الإستراتيجية الوطنية للذكاء الاصطناعي 2031 وميثاق الإمارات للذكاء الاصطناعي</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>قانون الاتحادي الإماراتي رقم 45 لسنة 2021 (PDPL). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>سدايا — <em>القانون السعودي PDPL</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>ساما — <em>القواعد والتعليمات</em>. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>مصرف الإمارات المركزي. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  </ol>
      
`,
      contentTr: `
  <h2>Tez</h2>
  <p>Kurumsal GenAI'deki pilot-üretim boşluğu artık iyi belgelenmiştir ve kendi başına kapanmamaktadır. MIT NANDA'nın <em>İş Dünyasında AI Durumu 2025</em> raporuna göre, kurumsal GenAI pilot projelerinin kabaca %95'i ölçülebilir bir kâr/zarar etkisi sağlamaz ve entegre sistemlerin %5'ten azı anlamlı değer üretir (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>). BCG'nin 2024 <em>AI'de Değer Nerede?</em> raporu, şirketlerin yalnızca %26'sinin pilot aşamasının ötesine geçtiğini ve %4'ünün de elit sınırda olduğunu göstermektedir (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>). Sorun model değildir. Sorun, çalışan bir demoyu kurumun gerçekten güvendiği işe dönüştüren katmanlı çalışmadır: değer belirleme, yönetilen veri, ajan tasarımı ve değişim yönetimi.</p>
  <h2>Kanıtlar Neler Gösteriyor</h2>
  <p>Üç bulgu artık büyük yayınlanmış anketler arasında tutarlıdır:</p>
  <ul>
  <li><strong>İş akışı yeniden tasarımı EBIT etkisini yönlendirir.</strong> McKinsey'nin <em>AI Durumu</em> 2024 anketine göre, iş akışı yeniden tasarımı GenAI'dan gelen maddi alt satır etkisi ile en güçlü şekilde ilişkili tek uygulamadır (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
  <li><strong>Benimseme yönetişimi geride bırakmıştır.</strong> Stanford HAI'nin <em>2025 AI Endeksi</em> raporuna göre kuruluşların %78'i en az bir işlevde AI kullanırken, sorumlu AI yatırımı aynı hızda ilerlememiştir (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>).</li>
  <li><strong>Agentic AI yakın vadeli bir kurumsal modeldir.</strong> Gartner, agentic AI'ı 2025'in ilk 10 stratejik teknoloji trendi arasında bulundurmakta ve 2028'e kadar anlamlı bir payın kurumsal yazılım kararlarının ajan tarafından özerkçe alınacağını öngörmektedir (<a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">Gartner, 2024</a>).</li>
  </ul>
  <p>EY'nin <em>AI Nabız Anketi</em> konusunda önemli bir ek bulgu getirmektedir: liderler için en büyük engeller model seçimi değil, veri hazırlığı, yönetişim ve entegrasyondur (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">EY, 2024</a>). GCC kurumları için bu, teslimatımızda gördüğümüz durumla eşleşmektedir: boşluğu kapatan çalışma sıra dışı değil ve neredeyse tamamen ajanın kendisinin ötesindedir.</p>
  <h2>Pilot Projeler Neden Takılıyor — Dört Başarısızlık Modu</h2>
  <ul>
  <li><strong>Veri hazırlığı çöküşü.</strong> Bölünmüş kaynaklar, yönetilmeyen kimlikler, eksik soy ağacı ve ajanın ihtiyaç duyduğu verileri engelleyen politikalar.</li>
  <li><strong>Yönetişim boşluğu.</strong> GCC düzenleyicileri (SAMA, CBUAE, SDAIA) tarafından maddi kararlar için giderek artan şekilde talep edilen politika, izleme ve denetim katmanı olmaksızın üretim AI'ı.</li>
  <li><strong>İşletim modeli direnci.</strong> Ajan eklenirken rol, süreç ve teşvikler değiştirilmemeden bırakılır. McKinsey'nin araştırması bu modelin sıfır EBIT etkisinin baskın tahmincisi olduğunu açıkça ortaya koymaktadır (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
  <li><strong>Mimari uyumsuzluk.</strong> Gözlemlenemeyen, değerlendirilemeyen, ölçeklendirilemeyen veya yükseltilemeyecek demo seviyesi prototipler.</li>
  </ul>
  <h2>Dört Katmanlı Bir Mimari</h2>
  <p>Maven AI'nin çerçevesi bu dört başarısızlık moduna kasıtlı bir yanıttır. Katmanların hiçbiri kendi başına yenidir; disiplin, pilot projenin takılması sonra eksik olanları onarıyor olmak yerine, dördünü de birinci günden itibaren kapsam içinde tutmaktır.</p>
  <h3>Katman 0 — Değer Vakası</h3>
  <p>Sonuç yönelimli şekillendirme. Ajanın sahibi olacağı spesifik kararlar ve eylemler, ölçülebilir öncesi/sonrası metriklerle. Değer vakası nicelendirilmezse, katılım ilerlemez.</p>
  <h3>Katman 1 — Veri ve AI Temelleri</h3>
  <p>Soy ağacı, ana veriler, yönetilen bağlam ve ajanların bağlı olduğu alım altyapısı. Buraya yapılan yatırım, elde edilen ajanı hem denetlenebilir hem de güvenilir kılar.</p>
  <h3>Katman 2 — Agentic AI</h3>
  <p>Karar veren, hareket eden, öğrenen ve koordine eden üretim ajanları (istemcinin bulut ve egemenlik durumu için uygun platform üzerine inşa edilmiş: LangGraph, LangChain, Microsoft Copilot Studio veya şirket içi gerektiğinde TII'nin Falcon ve Inception'ın Jais gibi egemen açık ağırlık modeller) (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">TII Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Inception Jais</a>).</p>
  <h3>Katman 3 — Değişim, Benimseme, Yeteneklendirme</h3>
  <p>Süreç yeniden tasarımı, rol yeniden tasarımı ve eğitim. En az kaynak ayıran katman - ve McKinsey'nin kanıtının AI yatırımı ile AI getirisi arasında fark yaratan katman.</p>
  <h2>GCC Uygulama Sırası</h2>
  <p>Aşamalar kuruluşlar arasında sabitdir; süre veri olgunluğuyla değişir.</p>
  <ul>
  <li><strong>1–3. Haftalar — Değer vakası ve pilot seçimi.</strong> Nicelendirilmiş iş durumu, yönetim desteği, tek sınırlandırılmış kullanım durumu.</li>
  <li><strong>4–7. Haftalar — Veri hazırlığı sprint.</strong> İyi kapsamlı pilot projeler bile veri sorunlarını ortaya çıkarır; entegrasyon sırasında değil, öncesinde ele alın.</li>
  <li><strong>8–12. Haftalar — Prototip inşa.</strong> Sentetik değil, üretim verisi üzerinde çalışan ajan.</li>
  <li><strong>13–20. Haftalar — Üretim sertleştirme.</strong> Yönetişim, gözlemlenebilirlik, güvenlik incelemesi, düzenleyici seviye denetim günlükleri.</li>
  <li><strong>21–26. Haftalar — Değişim ve başlatma.</strong> Süreç yeniden tasarımı, rol haritalaması, eğitim, izleme ile devreye alma.</li>
  </ul>
  <h2>Düzenleyici Çerçeve Zaten Mevcuttur</h2>
  <p>GCC üretim AI dağıtımları artık gerçek bir düzenleyici çerçeve altında çalışmaktadır. BAE AI Ofisi'nin <em>Ulusal AI Stratejisi 2031</em>'i ve <em>BAE AI Geliştirme ve Kullanımı Tüzüğü</em> prensip katmanını belirlemektedir (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">BAE AI Ofisi</a>). BAE Federal Kararnamesi No. 45 / 2021 (PDPL) ve SDAIA tarafından yönetilen Suudi Arabistan PDPL veri katmanını belirlemektedir (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">BAE PDPL</a>; <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">Suudi PDPL SDAIA aracılığıyla</a>). SAMA'nın siber esneklik ve BT yönetişimi için yayınlanmış çerçeveleri, mali hizmetler standardını belirlemektedir (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>). CBUAE, BAE'de eşdeğer bir rol oynamaktadır (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>).</p>
  <h2>Öneriler</h2>
  <ul>
  <li><strong>Kullanım durumu seçmeden önce veri hazırlığını denetleyin.</strong> Kullanım durumu mükemmel olabilir ama bozuk veri nedeniyle başarısız olabilir.</li>
  <li><strong>Ajanın sonra değil, öncesinde yönetişim katmanını inşa edin.</strong> Yönetişimi üretim sistemine eklemek, inşa etmekten yapısal olarak daha maliyetli ve daha risklidir.</li>
  <li><strong>Değişim yönetimini mühendislikle eşit olarak kaynaklayın.</strong> Değişim-mühendislik oranı 1:2'nin altında, başlatma sonrası eksik kullanımın en yaygın tahmincisidir.</li>
  <li><strong>ekonomisi üretimle uyumlu bir dağıtım ortağı seçin.</strong> Uzun süreli danışmanlıktan kâr sağlayan ortaklar kendi katılımlarını kısa tutmak için yapısal teşvike sahip değildirler.</li>
  </ul>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>GenAI Ayrışması: İş Dünyasında AI Durumu 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu/ai_report_2025.pdf</a></li>
  <li>McKinsey & Company, <em>AI Durumu</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Boston Consulting Group, <em>AI'de Değer Nerede?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>Stanford HAI, <em>2025 AI Endeksi Raporu</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>Gartner, <em>2025 için İlk 10 Stratejik Teknoloji Trendi</em>. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>EY, <em>AI Nabız Anketi</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>BAE AI Ofisi — <em>Ulusal AI Stratejisi 2031 ve BAE AI Tüzüğü</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>BAE Federal Kararnamesi No. 45 / 2021 (PDPL). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>SDAIA — <em>Suudi PDPL</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>SAMA — <em>Kurallar ve Talimatlar</em>. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>BAE Merkez Bankası. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  </ol>
      
`,
    },
    {
      id: "ai-governance-gulf",
      slug: "ai-governance-gulf",
      title: "AI Governance in the Gulf: Why GCC Organizations Need a Different Playbook",
      category: "Data & Governance",
      type: "Report",
      date: "Updated May 2026",
      readTime: "14 min read",
      author: "Alper Kulak, Founding Partner",
      coverImage: "/images/report-2.png",
      summary: "An audit-ready posture for AI governance in the GCC, mapped against SDAIA, SAMA, CBUAE, the UAE AI Office, NIST AI RMF and the EU AI Act — with a five-level maturity model and the capability domains every regulated GCC AI deployment now needs.",
      featured: true,
      tags: ["AI Governance", "GCC", "SDAIA", "SAMA", "Compliance"],
      content: `
  <h2>Thesis</h2>
  <p>The GCC's AI ambition is now backed by a maturing regulatory stack: SDAIA in Saudi Arabia, the UAE AI Office and CBUAE, SAMA for KSA financial services, plus enforceable personal-data laws in both jurisdictions. Organizations that treat governance as a checkbox project running parallel to AI delivery are the ones being caught off-guard. Organizations that treat governance as the design constraint that makes AI deployable at scale are pulling ahead. This report sets out the regulatory frame as it actually stands today and what an audit-ready GCC AI governance posture looks like.</p>
  <h2>The Regulatory Stack</h2>
  <h3>UAE</h3>
  <p>The UAE AI Office's <em>National Strategy for AI 2031</em> and the <em>UAE Charter for the Development &amp; Use of AI</em> establish the principle layer — human-centricity, safety, transparency, accountability — that increasingly shows up in government and quasi-government procurement (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">UAE AI Office</a>). Federal Decree-Law No. 45 of 2021 (PDPL) sets binding obligations around lawful processing, transparency, and automated decision-making (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">UAE PDPL</a>). CBUAE supervises financial stability and cyber posture for licensed institutions (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>). DIFC and ADGM publish their own data-protection regimes for in-zone entities (<a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">DIFC DP Law</a>; <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">ADGM Office of Data Protection</a>).</p>
  <h3>Saudi Arabia</h3>
  <p>SDAIA administers the <em>National Strategy for Data &amp; AI</em> and the Personal Data Protection Law (<a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">SDAIA PDPL</a>). SAMA's published <em>Cyber Resilience Framework</em> and IT-governance instructions set the operational bar for banks, insurers, and capital-markets firms; SAMA has also issued specific guidance on cloud and emerging-technology risk applicable to AI use (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA Rules &amp; Instructions</a>).</p>
  <h3>Qatar, Bahrain, Kuwait, Oman</h3>
  <p>Qatar's MCIT publishes the <em>Qatar National AI Strategy</em> and operates a national data-protection law (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">Qatar MCIT</a>). Bahrain's PDPL (Law No. 30 of 2018) is in force; Kuwait and Oman are converging on similar regimes. For organizations operating cross-GCC, building to the highest common denominator — SAMA-grade model governance, UAE PDPL transparency, SDAIA registration where required — is both the most efficient and the most defensible posture.</p>
  <h2>Why Governance Is the AI Strategy</h2>
  <p>Stanford HAI's <em>2025 AI Index</em> reports that 78% of organizations now use AI in at least one function — but responsible-AI evaluation and incident reporting have not scaled at the same rate (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>). The OECD AI Incidents Monitor records a steady rise in AI-related harms, the majority of which trace to inadequate testing, monitoring, or oversight rather than to model capability (<a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">OECD AI Incidents Monitor</a>). For GCC organizations, the regulator-side risk is real and increasing.</p>
  <h2>Five Capability Domains</h2>
  <h3>1. Data Lineage &amp; Provenance</h3>
  <p>Where the data came from, how it was transformed, who authorized its use. A pre-condition under both UAE and Saudi PDPL — and the foundation every other governance domain depends on.</p>
  <h3>2. Model Risk Management</h3>
  <p>Model inventory, performance monitoring, drift detection, and documented escalation. SAMA's IT-governance and cyber-resilience instructions require board-level oversight of material technology risk; AI risk now falls inside that frame.</p>
  <h3>3. Explainability &amp; Audit Trails</h3>
  <p>For regulated decisions — credit, insurance underwriting, healthcare triage, public-service eligibility — the system must produce a human-readable trace from outcome back to data. EU AI Act experience (a useful reference even where not directly binding) shows that explainability is more cheaply designed in than retrofitted (<a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">EU AI Act, Regulation 2024/1689</a>).</p>
  <h3>4. Human Oversight &amp; Escalation</h3>
  <p>Defined decision authority, escalation triggers, and override paths for any agent acting autonomously on consequential decisions. Both SAMA and CBUAE have been explicit that human oversight is mandatory for material credit and customer-facing decisions.</p>
  <h3>5. Bias &amp; Ethics Management</h3>
  <p>Documented testing for disparate impact across protected groups, with a process that runs continuously rather than once at launch. NIST's AI Risk Management Framework provides a structured pattern that maps cleanly onto UAE/Saudi expectations (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>).</p>
  <h2>A Five-Level Maturity Model</h2>
  <p>Maven AI uses a five-level model to assess where organizations sit. Level 1: AI in production without documented governance. Level 2: policies exist but are not operationalised. Level 3: governance processes running but not measured. Level 4: governance metrics tracked and reported to the board. Level 5: governance continuously enforced inside the AI delivery pipeline. In our delivery experience across GCC clients, the majority sit at Level 1 or Level 2; the regulatory bar is moving toward Level 4.</p>
  <h2>Recommendations</h2>
  <ul>
  <li><strong>Inventory first.</strong> You cannot govern what you have not catalogued. Most organizations are surprised by how many AI systems — including vendor-supplied AI inside enterprise software — they are running without oversight.</li>
  <li><strong>Build data lineage as the foundation.</strong> Every other governance requirement ultimately routes through it.</li>
  <li><strong>Engage SDAIA, SAMA, and CBUAE proactively.</strong> Regional regulators have consistently been more receptive to organizations that present a credible roadmap than to those waiting for examination findings to drive change.</li>
  <li><strong>Map your posture to NIST AI RMF and the EU AI Act risk categories.</strong> Even where neither is directly binding, both give a defensible reference language for board reporting.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>UAE AI Office — <em>National Strategy for AI 2031</em> &amp; <em>UAE Charter for AI</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>UAE Federal Decree-Law No. 45 of 2021 (PDPL). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>SDAIA — <em>Personal Data Protection Law</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>SAMA — <em>Rules &amp; Instructions</em> (Cyber Resilience Framework, IT Governance). <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>Central Bank of the UAE. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  <li>DIFC Data Protection Law. <a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">difc.ae</a></li>
  <li>ADGM Office of Data Protection. <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">adgm.com</a></li>
  <li>Qatar MCIT — National AI Strategy. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>OECD AI Incidents Monitor. <a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">oecd.ai/en/incidents</a></li>
  <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>EU AI Act — Regulation 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
  </ol>
      `,
      contentAr: `
    <h2>الأطروحة</h2>
    <p>تدعم دول مجلس التعاون الخليج الآن طموحها في مجال الذكاء الاصطناعي بإطار تنظيمي ناضج: هيئة سدايا في المملكة العربية السعودية، ومكتب الإمارات للذكاء الاصطناعي ومصرف الإمارات المركزي، وساما للخدمات المالية في المملكة، بالإضافة إلى قوانين حماية البيانات الشخصية القابلة للتنفيذ في كلا الاختصاصين. المنظمات التي تتعامل مع الحوكمة كمشروع إداري يعمل بالتوازي مع تسليم الذكاء الاصطناعي هي التي تُفاجأ بالمشاكل. المنظمات التي تتعامل مع الحوكمة كقيد تصميمي يجعل الذكاء الاصطناعي قابلاً للنشر على نطاق واسع تتقدم الآن. يحدد هذا التقرير الإطار التنظيمي كما هو قائم اليوم وما يبدو عليه موقف حوكمة الذكاء الاصطناعي الجاهز للتدقيق في دول مجلس التعاون الخليج.</p>
    <h2>الإطار التنظيمي</h2>
    <h3>الإمارات العربية المتحدة</h3>
    <p>تضع استراتيجية مكتب الإمارات للذكاء الاصطناعي <em>الاستراتيجية الوطنية للذكاء الاصطناعي 2031</em> و<em>ميثاق الإمارات لتطوير واستخدام الذكاء الاصطناعي</em> الطبقة الأساسية — الأولوية للإنسان والسلامة والشفافية والمساءلة — التي تظهر بشكل متزايد في مشتريات حكومية وشبه حكومية (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">مكتب الإمارات للذكاء الاصطناعي</a>). يضع المرسوم بقانون اتحادي رقم 45 لسنة 2021 (قانون حماية البيانات الشخصية) التزامات ملزمة بشأن المعالجة القانونية والشفافية واتخاذ القرارات الآلية (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">قانون حماية البيانات الشخصية بالإمارات</a>). يشرف مصرف الإمارات المركزي على الاستقرار المالي والموقف الإلكتروني للمؤسسات المرخصة (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">مصرف الإمارات المركزي</a>). ينشر مركز دبي المالي العالمي (DIFC) وسلطة منطقة أبوظبي الحرة (ADGM) أنظمتهما الخاصة بحماية البيانات للكيانات داخل المنطقة (<a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">قانون حماية البيانات بـ DIFC</a>؛ <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">مكتب حماية البيانات بـ ADGM</a>).</p>
    <h3>المملكة العربية السعودية</h3>
    <p>تدير هيئة سدايا <em>الاستراتيجية الوطنية للبيانات والذكاء الاصطناعي</em> وقانون حماية البيانات الشخصية (<a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">قانون حماية البيانات الشخصية بـ سدايا</a>). تحدد تعليمات ساما المنشورة <em>الإطار الشامل للمرونة الإلكترونية</em> وحوكمة تكنولوجيا المعلومات معايير العمل للبنوك وشركات التأمين وشركات الأسواق المالية؛ أصدرت ساما أيضاً إرشادات محددة بشأن السحابة والمخاطر الناشئة من التكنولوجيا التي تنطبق على استخدام الذكاء الاصطناعي (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">قواعد وتعليمات ساما</a>).</p>
    <h3>قطر والبحرين والكويت وعمان</h3>
    <p>تنشر وزارة الاتصالات وتكنولوجيا المعلومات في قطر <em>الاستراتيجية الوطنية القطرية للذكاء الاصطناعي</em> وتدير قانون حماية البيانات الوطني (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">وزارة الاتصالات وتكنولوجيا المعلومات في قطر</a>). قانون حماية البيانات الشخصية في البحرين (القانون رقم 30 لسنة 2018) نافذ المفعول؛ والكويت وعمان يتقاربان نحو أنظمة مماثلة. بالنسبة للمنظمات التي تعمل عبر دول مجلس التعاون الخليج، فإن البناء بالقياس الأعلى المشترك — حوكمة النماذج من درجة ساما والشفافية بموجب قانون حماية البيانات الشخصية بالإمارات والتسجيل لدى سدايا حيث لزم الأمر — هو الموقف الأكثر كفاءة والأكثر قابلية للدفاع.</p>
    <h2>لماذا الحوكمة هي استراتيجية الذكاء الاصطناعي</h2>
    <p>يفيد <em>مؤشر الذكاء الاصطناعي 2025</em> من ستانفورد إتش إيه آي أن 78% من المنظمات تستخدم الآن الذكاء الاصطناعي في وظيفة واحدة على الأقل — لكن التقييم المسؤول للذكاء الاصطناعي والإبلاغ عن الحوادث لم يتطورا بنفس المعدل (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">ستانفورد إتش إيه آي، 2025</a>). يسجل مراقب منظمة التعاون الاقتصادي والتنمية لحوادث الذكاء الاصطناعي ارتفاعاً مستمراً في الأضرار المرتبطة بالذكاء الاصطناعي، معظمها يتتبع إلى اختبار غير كاف أو مراقبة أو إشراف بدلاً من قدرات النموذج (<a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">مراقب حوادث منظمة التعاون الاقتصادي والتنمية للذكاء الاصطناعي</a>). بالنسبة للمنظمات في دول مجلس التعاون الخليج، فإن مخاطر الجانب التنظيمي حقيقية ومتزايدة.</p>
    <h2>خمس مجالات قدرة</h2>
    <h3>1. سلسلة البيانات والمصدر</h3>
    <p>من أين جاءت البيانات وكيف تم تحويلها ومن صرح باستخدامها. شرط أساسي بموجب كل من قانون حماية البيانات الشخصية بالإمارات والسعودية — والأساس الذي يعتمد عليه كل مجال حوكمة آخر.</p>
    <h3>2. إدارة مخاطر النموذج</h3>
    <p>جرد النماذج ومراقبة الأداء والكشف عن الانجراف والتصعيد الموثق. تتطلب تعليمات تكنولوجيا المعلومات والمرونة الإلكترونية من ساما إشرافاً على مستوى المجلس على المخاطر التكنولوجية الجوهرية؛ مخاطر الذكاء الاصطناعي تندرج الآن ضمن هذا الإطار.</p>
    <h3>3. القابلية للشرح والمسارات التدقيقية</h3>
    <p>بالنسبة للقرارات المنظمة — الائتمان والتأمين والفحص والتدرج الصحي والأهلية للخدمات العامة — يجب أن ينتج النظام مسار يمكن للإنسان قراءته من النتيجة مرة أخرى إلى البيانات. تُظهر تجربة قانون الذكاء الاصطناعي بالاتحاد الأوروبي (مرجع مفيد حتى حيث لا تنطبق مباشرة) أن القابلية للشرح يتم تصميمها برخص أقل من إعادة التكييف (<a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">قانون الذكاء الاصطناعي بالاتحاد الأوروبي، اللائحة 2024/1689</a>).</p>
    <h3>4. الإشراف البشري وممرات التصعيد</h3>
    <p>سلطة القرار المحددة وأسباب التصعيد وممرات المراجعة للعامل الذي يتصرف بشكل مستقل بشأن القرارات ذات العواقب. كانت كل من ساما ومصرف الإمارات المركزي واضحتان بشأن أن الإشراف البشري إلزامي للقرارات الائتمانية والعملاء الجوهرية.</p>
    <h3>5. إدارة التحيز والأخلاقيات</h3>
    <p>الاختبار الموثق للتأثير المتفاوت عبر المجموعات المحمية، مع عملية تعمل بشكل مستمر وليس مرة واحدة عند الإطلاق. يوفر إطار إدارة مخاطر الذكاء الاصطناعي من NIST نمطاً منظماً يتطابق بنظافة مع توقعات الإمارات والسعودية (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">إطار إدارة مخاطر الذكاء الاصطناعي من NIST</a>).</p>
    <h2>نموذج النضج ذو المستويات الخمسة</h2>
    <p>تستخدم Maven AI نموذجاً ذا مستويات خمسة لتقييم موضع المنظمات. المستوى 1: الذكاء الاصطناعي في الإنتاج بدون حوكمة موثقة. المستوى 2: السياسات موجودة لكن لا تُطبق. المستوى 3: عمليات الحوكمة تعمل لكن لا تُقاس. المستوى 4: يتم تتبع مقاييس الحوكمة والإبلاغ عنها للمجلس. المستوى 5: يتم تطبيق الحوكمة بشكل مستمر داخل خط أنابيب تسليم الذكاء الاصطناعي. في تجربة التسليم لدينا عبر عملاء دول مجلس التعاون الخليج، يجلس معظمهم في المستوى 1 أو المستوى 2؛ يتحرك المعيار التنظيمي نحو المستوى 4.</p>
    <h2>التوصيات</h2>
    <ul>
    <li><strong>ابدأ بالجرد.</strong> لا يمكنك حوكمة ما لم تقم بفهرسته. تُفاجأ معظم المنظمات بعدد أنظمة الذكاء الاصطناعي — بما في ذلك الذكاء الاصطناعي الذي يوفره البائع داخل برامج المؤسسات — التي تعمل بدون إشراف.</li>
    <li><strong>بناء سلسلة البيانات كالأساس.</strong> كل متطلب حوكمة آخر يعبر الطريق من خلاله في النهاية.</li>
    <li><strong>تفاعل سدايا وساما ومصرف الإمارات المركزي بشكل استباقي.</strong> كانت المنظمات التنظيمية الإقليمية متقبلة بشكل مستمر للمنظمات التي تقدم خارطة طريق معقولة بدلاً من تلك التي تنتظر نتائج الفحص لتحفيز التغيير.</li>
    <li><strong>خريطة موقفك إلى إطار إدارة مخاطر الذكاء الاصطناعي من NIST وفئات مخاطر قانون الذكاء الاصطناعي بالاتحاد الأوروبي.</strong> حتى حيث لا يكون أي منهما ملزماً مباشرة، يعطي كلاهما لغة مرجعية قابلة للدفاع لإعادة المجلس.</li>
    </ul>
    <h2>المصادر والمراجع</h2>
    <ol class="sources-list">
    <li>مكتب الإمارات للذكاء الاصطناعي — <em>الاستراتيجية الوطنية للذكاء الاصطناعي 2031</em> و<em>ميثاق الإمارات للذكاء الاصطناعي</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
    <li>المرسوم بقانون اتحادي رقم 45 لسنة 2021 (قانون حماية البيانات الشخصية). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
    <li>هيئة سدايا — <em>قانون حماية البيانات الشخصية</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
    <li>ساما — <em>القواعس والتعليمات</em> (إطار المرونة الإلكترونية وحوكمة تكنولوجيا المعلومات). <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
    <li>مصرف الإمارات المركزي. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
    <li>قانون حماية البيانات بـ DIFC. <a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">difc.ae</a></li>
    <li>مكتب حماية البيانات بـ ADGM. <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">adgm.com</a></li>
    <li>وزارة الاتصالات وتكنولوجيا المعلومات في قطر — الاستراتيجية الوطنية للذكاء الاصطناعي. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
    <li>ستانفورد إتش إيه آي، <em>تقرير مؤشر الذكاء الاصطناعي 2025</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
    <li>مراقب حوادث الذكاء الاصطناعي بمنظمة التعاون الاقتصادي والتنمية. <a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">oecd.ai/en/incidents</a></li>
    <li>NIST، <em>إطار إدارة مخاطر الذكاء الاصطناعي</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
    <li>قانون الذكاء الاصطناعي بالاتحاد الأوروبي — اللائحة 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
    </ol>
        `,
      contentTr: `
    <h2>Tez</h2>
    <p>Körfez İşbirliği Konseyi (KİK) ülkelerinin yapay zeka tutkusu artık olgunlaşan bir düzenleyici yığın tarafından desteklenmektedir: Suudi Arabistan'da SDAIA, BAE Yapay Zeka Ofisi ve CBUAE, KSA finansal hizmetleri için SAMA, ayrıca her iki yargı alanında uygulanabilir kişisel veri yasaları. Yönetişimi yapay zeka sunumuna paralel olarak çalışan bir kontrol projesi olarak ele alan kuruluşlar şaşkınlığa düçar olanlar. Yönetişimi yapay zekayı ölçekte dağıtılabilir kılan tasarım kısıtlaması olarak ele alan kuruluşlar öne geçiyor. Bu rapor düzenleyici çerçeveyi bugün gerçekten nasıl olduğunu ve KİK yapay zeka yönetişimi duruşunun denetim hazır neye benzediğini açıklamaktadır.</p>
    <h2>Düzenleyici Yığın</h2>
    <h3>BAE</h3>
    <p>BAE Yapay Zeka Ofisinin <em>2031 Ulusal Yapay Zeka Stratejisi</em> ve <em>BAE Yapay Zeka Geliştirme ve Kullanım Tüzüğü</em> ilke katmanını — insan merkeziliği, güvenlik, şeffaflık, hesap verebilirlik — oluştururlar ve bu, gittikçe hükümet ve yarı-hükümet satın almalarında görülmektedir (<a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">BAE Yapay Zeka Ofisi</a>). Federal Kararname-Kanun No. 45 of 2021 (PDPL), uygun işleme, şeffaflık ve otomatik karar verme konusunda bağlayıcı yükümlülükler belirler (<a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">BAE PDPL</a>). CBUAE, lisanslı kurumlar için finansal istikrar ve siber duruşu denetler (<a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>). DIFC ve ADGM, bölge içi kuruluşlar için kendi veri koruma rejimlerini yayınlar (<a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">DIFC DP Law</a>; <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">ADGM Office of Data Protection</a>).</p>
    <h3>Suudi Arabistan</h3>
    <p>SDAIA, <em>Veri ve Yapay Zeka Ulusal Stratejisi</em> ve Kişisel Veri Koruma Yasasını yönetir (<a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">SDAIA PDPL</a>). SAMA'nın yayınlanan <em>Siber Esneklik Çerçevesi</em> ve BT yönetimi talimatları, bankalar, sigortacılar ve sermaye piyasası firmaları için operasyonel barı belirler; SAMA ayrıca yapay zeka kullanımına uygulanabilir bulut ve ortaya çıkan teknoloji riski konusunda özel rehberlik yayınlamıştır (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA Kuralları ve Talimatları</a>).</p>
    <h3>Katar, Bahreyn, Kuveyt, Umman</h3>
    <p>Katar'ın İletişim ve BT Bakanlığı, <em>Katar Ulusal Yapay Zeka Stratejisini</em> yayınlar ve ulusal bir veri koruma yasasını yönetir (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">Katar İletişim ve BT Bakanlığı</a>). Bahreyn'in PDPL (2018 Yılı No. 30 Yasası) yürürlüktedir; Kuveyt ve Umman benzer rejimler yönünde yakınlaşmaktadır. KİK'nin tamamı üzerinde faaliyet gösteren kuruluşlar için, en yüksek ortak paydaya göre inşa etmek — SAMA derecesi model yönetişimi, BAE PDPL şeffaflığı, gerekli yerlerde SDAIA kaydı — hem en verimli hem de en savunulabilir duruş.</p>
    <h2>Yönetişim Neden Yapay Zeka Stratejisidir</h2>
    <p>Stanford HAI'in <em>2025 Yapay Zeka Endeksi</em>, kuruluşların şimdi 78% oranında en az bir işlevde yapay zeka kullandığını bildiriyor — ancak sorumlu yapay zeka değerlendirmesi ve olay raporlaması aynı oranda ölçeklendirilmemiştir (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>). OECD Yapay Zeka Olayları İzleme Sistemi, yapay zeka ile ilgili zararların, çoğunluğu model yeteneğinden ziyade yetersiz test, izleme veya denetim çerçevesinde izlenen istikrarlı bir artış kaydeder (<a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">OECD Yapay Zeka Olayları İzleme Sistemi</a>). KİK kuruluşları için, düzenleyici taraf riski gerçek ve artmaktadır.</p>
    <h2>Beş Yetkinlik Alanı</h2>
    <h3>1. Veri Soyağacı ve Kaynağı</h3>
    <p>Verilerin nereden geldiği, nasıl dönüştürüldüğü, kullanımını kim yetkilendirdi. BAE ve Suudi PDPL'nin her ikisi altında ön koşul — ve diğer her yönetişim alanının bağlı olduğu temel.</p>
    <h3>2. Model Risk Yönetimi</h3>
    <p>Model envanteri, performans izleme, kayma tespiti ve belgelenmiş ilerleme. SAMA'nın BT yönetimi ve siber esneklik talimatları, malzeme teknoloji riskinin kurul düzeyindeki gözetimini gerektirir; yapay zeka riski şimdi bu çerçeve içinde yer alır.</p>
    <h3>3. Açıklanabilirlik ve Denetim İzleri</h3>
    <p>Düzenlenmiş kararlar için — kredi, sigorta sigortalama, sağlık triaj, kamu hizmeti uygunluğu — sistem, sonuçtan verilere geri veri gidebilen insan tarafından okunabilir bir izleme sağlamalıdır. AB Yapay Zeka Yasası deneyimi (doğrudan bağlayıcı olmadığı yerlerde bile yararlı bir referans), açıklanabilirliğin tasarlanmadan çok daha ucuz olduğunu gösterir (<a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">AB Yapay Zeka Yasası, Düzenleme 2024/1689</a>).</p>
    <h3>4. İnsan Gözetimi ve Yükseltme</h3>
    <p>Tanımlı karar yetkilisi, yükseltme tetikleyicileri ve sonuç taşıyan kararlar üzerinde bağımsız olarak hareket eden her etmen için geçersiz kılma yolları. Hem SAMA hem de CBUAE, insan gözetiminin önemli kredi ve müşteriye yönelik kararlar için zorunlu olduğu konusunda açık olmuştur.</p>
    <h3>5. Yanlılık ve Etik Yönetimi</h3>
    <p>Korunan gruplar arasında ayrımcı etki için belgelenmiş test, başlatmada bir kez değil sürekli çalışan bir işlemle. NIST'in Yapay Zeka Risk Yönetimi Çerçevesi, BAE/Suudi beklentileriyle temiz bir şekilde eşlenen yapılandırılmış bir desen sağlar (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST Yapay Zeka RMF</a>).</p>
    <h2>Beş Seviyeli Olgunluk Modeli</h2>
    <p>Maven AI, kuruluşların nerede oturduğunu değerlendirmek için beş seviyeli bir model kullanır. Seviye 1: Belgelenmiş yönetişim olmadan üretimde yapay zeka. Seviye 2: İlkeler vardır ancak operasyonel değildir. Seviye 3: Yönetişim işlemleri çalışır ancak ölçülmez. Seviye 4: Yönetişim ölçümleri izlenir ve kurul'a raporlanır. Seviye 5: Yönetişim yapay zeka teslim hattı içinde sürekli uygulanır. KİK istemcileri arasındaki teslim deneyimimizde çoğunluk Seviye 1 veya Seviye 2'de oturmaktadır; düzenleyici bar Seviye 4'e doğru hareket etmektedir.</p>
    <h2>Öneriler</h2>
    <ul>
    <li><strong>Önce envanter yapın.</strong> Katalog haline getirmediğiniz şeyi yönetemezsiniz. Çoğu kuruluş, denetim olmadan çalıştırdıkları kaç yapay zeka sisteminin — kurumsal yazılım içindeki satıcı tarafından sağlanan yapay zeka da dahil olmak üzere — olduğunu öğrenince şaşırırlar.</li>
    <li><strong>Veri soyağacını temel olarak oluşturun.</strong> Diğer her yönetişim gereksinimi sonunda bunun aracılığıyla yönlendirilir.</li>
    <li><strong>SDAIA, SAMA ve CBUAE'yi proaktif olarak iletişim kurun.</strong> Bölgesel düzenleyiciler, inceleme bulguları değişimi sürmek yerine güvenilir bir yol haritası sunan kuruluşlara sürekli olarak daha karşılanabilir.</li>
    <li><strong>Duruşunuzu NIST Yapay Zeka RMF'ye ve AB Yapay Zeka Yasası risk kategorilerine haritalandırın.</strong> İkisi de doğrudan bağlayıcı olmasa bile, her ikisi de kurul raporlaması için savunulabilir bir referans dili verir.</li>
    </ul>
    <h2>Kaynaklar ve Referanslar</h2>
    <ol class="sources-list">
    <li>BAE Yapay Zeka Ofisi — <em>2031 Ulusal Yapay Zeka Stratejisi</em> ve <em>BAE Yapay Zeka Tüzüğü</em>. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
    <li>BAE Federal Kararname-Kanun No. 45 of 2021 (PDPL). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
    <li>SDAIA — <em>Kişisel Veri Koruma Yasası</em>. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
    <li>SAMA — <em>Kurallar ve Talimatlar</em> (Siber Esneklik Çerçevesi, BT Yönetimi). <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
    <li>BAE Merkez Bankası. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
    <li>DIFC Veri Koruma Yasası. <a href="https://www.difc.ae/business/laws-and-regulations" target="_blank" rel="noopener noreferrer">difc.ae</a></li>
    <li>ADGM Veri Koruma Ofisi. <a href="https://www.adgm.com/operating-in-adgm/office-of-data-protection" target="_blank" rel="noopener noreferrer">adgm.com</a></li>
    <li>Katar İletişim ve BT Bakanlığı — Ulusal Yapay Zeka Stratejisi. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
    <li>Stanford HAI, <em>2025 Yapay Zeka Endeksi Raporu</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
    <li>OECD Yapay Zeka Olayları İzleme Sistemi. <a href="https://oecd.ai/en/incidents" target="_blank" rel="noopener noreferrer">oecd.ai/en/incidents</a></li>
    <li>NIST, <em>Yapay Zeka Risk Yönetimi Çerçevesi</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
    <li>AB Yapay Zeka Yasası — Düzenleme 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
    </ol>
        `,
    },
    {
      id: "legacy-modernization-playbook",
      slug: "legacy-modernization-playbook",
      title: "The Legacy Modernization Playbook: AI-Driven Spec Generation",
      category: "Data & Governance",
      type: "Report",
      date: "Updated May 2026",
      readTime: "13 min read",
      author: "Gokhan Dagli, Founding Partner",
      coverImage: "/images/report-3.png",
      summary: "Legacy systems remain the binding constraint on enterprise AI in the GCC. AI-assisted SDLC compresses the most expensive phase of modernisation — understanding what the existing system actually does — and a sovereign-first delivery model makes it deployable in regulated environments.",
      featured: false,
      tags: ["Legacy", "Modernization", "SDLC", "Sovereign AI"],
      content: `
  <h2>Thesis</h2>
  <p>Legacy systems remain the binding constraint on enterprise AI in the GCC. Telecoms run customer billing, charging, and provisioning on platforms designed in the 1990s and early 2000s. Banks run core ledgers and risk engines on COBOL or aging Java. Public-sector platforms encode regulation and entitlement logic accumulated over two decades of customisation. AI-driven SDLC — using large language models to read, document, and rebuild from these systems — is now mature enough to compress what used to be the most expensive phase of modernisation: understanding what the existing system actually does. This report sets out the discipline that turns that capability into deliverable outcomes.</p>
  <h2>The Cost of Doing Nothing</h2>
  <p>McKinsey estimates that technical debt accounts for roughly 20–40% of the technology-asset value of typical enterprises and represents a hidden tax on every new initiative — including AI (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">McKinsey, 2020</a>). Stripe's research with developers indicates that engineering teams spend roughly a third of their time on maintenance of legacy systems and bad code (<a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">Stripe, <em>The Developer Coefficient</em></a>). Standish Group's <em>CHAOS</em> reporting finds that large transformation programs continue to fail or run materially over budget at high rates (<a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">Standish Group</a>). These conditions are exactly what our methodology is designed for.</p>
  <h2>Why Previous Modernization Programs Failed</h2>
  <p>Most large GCC enterprises carry the scar tissue of at least one failed modernization. The published evidence on enterprise IT failure points to three recurring causes: insufficient documentation of the existing system, underestimation of business-logic complexity, and inadequate testing coverage at the boundary between old and new (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">McKinsey on large IT projects</a>). The discipline below is built specifically around those three root causes.</p>
  <h2>Spec-from-Legacy: The Methodology</h2>
  <h3>Phase 1 — AI-Assisted Extraction</h3>
  <p>Code-analysis agents trained on the target legacy stack — COBOL, SAP ABAP, legacy Java, custom platforms — systematically document business logic, data structures, integration points, and exceptional flows. Stanford HAI's <em>2025 AI Index</em> and GitHub's <em>Octoverse</em> both record measurable engineering productivity gains from code-aware LLMs in real codebases (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>; <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">GitHub Octoverse, 2024</a>). The engineering judgment remains human; the assistant compresses the lift.</p>
  <h3>Phase 2 — Specification Validation</h3>
  <p>The extracted specification is validated against institutional knowledge — business stakeholders, system operators, historical change records. This phase surfaces the gap between what the code says and what the business actually needs.</p>
  <h3>Phase 3 — Architecture &amp; Migration Planning</h3>
  <p>With a validated specification in hand, the target architecture is designed — cloud-native where the data classification permits, on-premises where sovereign requirements demand — and the migration is sequenced to minimise operational risk.</p>
  <h2>Sovereign &amp; On-Prem Delivery</h2>
  <p>For GCC public-sector clients in defence, intelligence, and critical national infrastructure, code, data, and system specifications cannot leave the secure perimeter. Maven AI's modernization practice runs entirely on-prem in those contexts, drawing on regional sovereign AI infrastructure where appropriate — including TII's open-weight Falcon family from Abu Dhabi and the Arabic-capable Jais models from Inception/G42 (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). Recent regional sovereign-AI announcements — Microsoft's $1.5B investment in G42 in April 2024 and the launch of HUMAIN under PIF — have meaningfully expanded the in-region infrastructure available for sovereign workloads (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">Microsoft–G42, 2024</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>Arabic &amp; Regional Context</h2>
  <p>Legacy systems in GCC enterprises frequently encode Arabic-language business logic, regional process variants, and locally customised workflows that are invisible to extraction tools trained primarily on Western codebases. In our delivery experience, COBOL billing systems with Arabic character encodings and SAP ABAP customisations implementing Zakat or Hijri-calendar logic both regularly defeat off-the-shelf extraction tools. Arabic-aware analysis and Arabic-speaking subject-matter experts in the validation phase are not optional in this market.</p>
  <h2>Testing for High-Stakes Systems</h2>
  <p>Legacy systems in production have, by definition, accumulated years of edge-case handling, exception logic, and undocumented business rules. The objective is not 100% code coverage — it is 100% business-outcome coverage: every material business result the legacy system produces must be reproducible by the new system. This is where AI-assisted test generation grounded in production transaction analysis pays back, not in the specification alone.</p>
  <h2>Illustrative Engagement Shape</h2>
  <p>A representative shape of this work — drawn from the engagement patterns we see most often in GCC telecoms and banks, presented as a hypothetical to protect client confidentiality — looks like a multi-million-line legacy stack documented in 8–12 weeks rather than 6–18 months, a 1,000+ page validated specification that becomes the contract between business and engineering, and a total program timeline 30–40% shorter than industry benchmarks for comparable scope. The economics are driven primarily by avoided rework in the build phase, not by speed of the spec phase itself.</p>
  <h2>Recommendations</h2>
  <ul>
  <li><strong>Do the specification first, always.</strong> The most common cause of modernization failure remains starting the rebuild before fully understanding what is being replaced.</li>
  <li><strong>Treat on-prem capability as a procurement requirement.</strong> If your data classification includes sovereign categories, verify the delivery partner's on-prem capability before contract signature.</li>
  <li><strong>Scope change management at the start.</strong> Technical modernization is the easier half; business-process redesign and adoption is the half that determines whether the new system gets used.</li>
  <li><strong>Build Arabic-language validation in as a formal phase.</strong> A workshop with Arabic-speaking business stakeholders reviewing the specification is non-negotiable for GCC organizations with Arabic-language process logic.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>McKinsey &amp; Company, <em>Tech debt: Reclaiming tech equity</em>, 2020. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>McKinsey &amp; Company, <em>Delivering large-scale IT projects on time, on budget, and on value</em>. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Stripe, <em>The Developer Coefficient</em>. <a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">stripe.com</a></li>
  <li>Standish Group, <em>CHAOS Report</em>. <a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">standishgroup.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>GitHub, <em>Octoverse 2024</em>. <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">github.blog</a></li>
  <li>EY, <em>Key strategies for modernizing OSS transformation</em>, 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>TII, <em>Falcon LLM</em>. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42), <em>Jais</em>. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>Microsoft &amp; G42, <em>$1.5B Strategic Investment</em>, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  </ol>
      `,
      contentAr: `
  <h2>الأطروحة</h2>
  <p>تظل الأنظمة الموروثة بمثابة القيد الأساسي على الذكاء الاصطناعي في المؤسسات في منطقة الخليج. تدير شركات الاتصالات فواتير العملاء والرسوم والتجهيز على منصات صُممت في التسعينيات والعقد الأول من القرن الحادي والعشرين. تدير البنوك دفاتر الحسابات الأساسية ومحركات إدارة المخاطر على COBOL أو لغة Java القديمة. تُشفر منصات القطاع العام منطق التنظيم والاستحقاقات المتراكمة على مدى عقدين من التخصيص. نضجت الدورة التطوير البرمجية بمساعدة الذكاء الاصطناعي — استخدام نماذج اللغة الكبيرة لقراءة وتوثيق وإعادة بناء هذه الأنظمة — بما يكفي لضغط ما كان يُعتبر بسابق الأوان أغلى مرحلة في التحديث: فهم ما يفعله النظام الموجود بالفعل. تضع هذه التقارير المنهجية التي تحول هذه الإمكانية إلى نتائج قابلة للتسليم.</p>
  <h2>تكلفة عدم الفعل</h2>
  <p>تقدر ماكينزي أن الديون التقنية تمثل تقريباً 20-40% من قيمة الأصول التكنولوجية للمؤسسات النموذجية وتمثل ضريبة مخفية على كل مبادرة جديدة — بما في ذلك الذكاء الاصطناعي (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">ماكينزي، 2020</a>). يشير بحث Stripe لدى المطورين إلى أن فرق الهندسة تقضي تقريباً ثلث وقتها على صيانة الأنظمة الموروثة والكود الرديء (<a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">Stripe، <em>The Developer Coefficient</em></a>). يجد تقرير Standish Group <em>CHAOS</em> أن برامج التحول الكبيرة تستمر في الفشل أو تتجاوز الميزانية بمعدلات عالية (<a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">مجموعة Standish</a>). هذه الظروف بالضبط ما صُممت منهجيتنا من أجله.</p>
  <h2>لماذا فشلت برامج التحديث السابقة</h2>
  <p>تحمل معظم المؤسسات الكبرى في منطقة الخليج ندوب بسبب فشل تحديث واحد على الأقل. تشير الأدلة المنشورة على فشل تكنولوجيا المعلومات المؤسسية إلى ثلاث أسباب متكررة: توثيق غير كافٍ للنظام الموجود، والتقليل من تقدير تعقيد منطق الأعمال، والاختبار غير الكافي عند الحد بين القديم والجديد (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">ماكينزي حول مشاريع تكنولوجيا المعلومات الكبيرة</a>). تم بناء المنهجية أدناه بشكل خاص حول هذه الأسباب الجذرية الثلاثة.</p>
  <h2>Spec-from-Legacy: المنهجية</h2>
  <h3>المرحلة 1 — الاستخراج بمساعدة الذكاء الاصطناعي</h3>
  <p>وكلاء تحليل الكود المدربون على مكدس البرامج الموروثة المستهدفة — COBOL و SAP ABAP و Java القديمة والمنصات المخصصة — يوثقون بشكل منهجي منطق الأعمال وهياكل البيانات ونقاط التكامل والتدفقات الاستثنائية. يسجل مؤشر Stanford HAI <em>2025 AI Index</em> و <em>Octoverse</em> من GitHub كسباً قابلاً للقياس في إنتاجية الهندسة من نماذج لغة كبيرة تدرك الكود في أكواد حقيقية (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">ستانفورد إتش إيه آي، 2025</a>; <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">GitHub Octoverse، 2024</a>). الحكم الهندسي يبقى إنساني؛ المساعد يضغط على الرفع.</p>
  <h3>المرحلة 2 — التحقق من المواصفات</h3>
  <p>يتم التحقق من المواصفات المستخرجة مقابل المعرفة المؤسسية — أصحاب المصلحة في الأعمال وعاملي النظام والسجلات التاريخية للتغييرات. تكشف هذه المرحلة عن الفجوة بين ما يقوله الكود وما تحتاجه الأعمال بالفعل.</p>
  <h3>المرحلة 3 — تخطيط المعمارية والهجرة</h3>
  <p>مع وجود مواصفات موثوقة في متناول اليد، يتم تصميم المعمارية المستهدفة — أصلية للسحابة حيث تسمح تصنيفات البيانات، في الموقع حيث تتطلب متطلبات السيادة — ويتم ترتيب الهجرة لتقليل المخاطر التشغيلية.</p>
  <h2>توصيل السيادة والموقع</h2>
  <p>بالنسبة لعملاء القطاع العام في منطقة الخليج في الدفاع والاستخبارات والبنية التحتية الحيوية الوطنية، لا يمكن أن تترك الأكواد والبيانات والمواصفات النظامية المحيط الآمن. تعمل ممارسة التحديث في Maven AI بالكامل في الموقع في تلك السياقات، مستفيدة من بنية الذكاء الاصطناعي ذات السيادة الإقليمية حيث يكون مناسباً — بما في ذلك عائلة Falcon مفتوحة الوزن من Abu Dhabi من TII و نماذج Jais القادرة على اللغة العربية من Inception/G42 (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). استعلانات الذكاء الاصطناعي ذات السيادة الإقليمية الأخيرة — استثمار Microsoft بقيمة 1.5 مليار دولار في G42 في أبريل 2024 وإطلاق HUMAIN تحت PIF — وسعت بشكل كبير البنية التحتية المتاحة في المنطقة لأعباء العمل ذات السيادة (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">Microsoft–G42، 2024</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>السياق العربي والإقليمي</h2>
  <p>تقوم الأنظمة الموروثة في المؤسسات في منطقة الخليج بتشفير منطق الأعمال باللغة العربية والمتغيرات الإقليمية للعمليات والسير العمل المخصص محلياً التي تكون غير مرئية لأدوات الاستخراج المدربة بشكل أساسي على أكواد غربية. في خبرة تسليمنا، أنظمة فواتير COBOL مع ترميز الأحرف العربية و تخصيصات SAP ABAP التي تطبق منطق Zakat أو Hijri-calendar كلاهما بانتظام يهزم أدوات الاستخراج جاهزة من الرف. التحليل الذي يدرك اللغة العربية و الخبراء في الموضوع الناطقون بالعربية في مرحلة التحقق ليسوا اختياريين في هذا السوق.</p>
  <h2>الاختبار للأنظمة عالية الحصة</h2>
  <p>الأنظمة الموروثة في الإنتاج تراكمت، بحكم التعريف، سنوات من معالجة الحالات الحدية ومنطق الاستثناء والقواعد التجارية غير الموثقة. الهدف ليس 100% تغطية كود — إنه 100% تغطية النتائج التجارية: كل نتيجة تجارية مادية ينتجها النظام الموروث يجب أن تكون قابلة للتكاثر من قبل النظام الجديد. هنا حيث توليد الاختبار بمساعدة الذكاء الاصطناعي المستند إلى تحليل معاملات الإنتاج يسدد، وليس في المواصفات وحدها.</p>
  <h2>شكل المشاركة التوضيحي</h2>
  <p>شكل تمثيلي لهذا العمل — مستمد من أنماط المشاركة التي نراها في أغلب الأحيان في شركات الاتصالات والبنوك في منطقة الخليج، مقدم كفرضية لحماية سرية العميل — يبدو وكأنه مكدس موروث متعدد الملايين من الأسطر موثق في 8-12 أسبوع بدلاً من 6-18 شهر، مواصفات موثوقة بأكثر من 1000 صفحة تصبح العقد بين الأعمال والهندسة، وإجمالي الجدول الزمني للبرنامج أقصر بنسبة 30-40% من معايير الصناعة للنطاق المماثل. يتم قيادة الاقتصاد بشكل أساسي بواسطة إعادة العمل المتجنبة في مرحلة البناء، وليس بسرعة مرحلة المواصفات نفسها.</p>
  <h2>التوصيات</h2>
  <ul>
  <li><strong>افعل المواصفات أولاً، دائماً.</strong> السبب الأكثر شيوعاً لفشل التحديث يبقى بدء إعادة البناء قبل فهم كامل لما يتم استبداله.</li>
  <li><strong>تعامل مع القدرة على الموقع كمتطلب التوريد.</strong> إذا كان تصنيف البيانات الخاص بك يشمل فئات سيادية، تحقق من قدرة شريك التسليم على الموقع قبل توقيع العقد.</li>
  <li><strong>نطاق إدارة التغيير في البداية.</strong> التحديث التقني هو النصف الأسهل؛ إعادة تصميم العملية التجارية والاعتماد هي النصف التي تحدد ما إذا كان يتم استخدام النظام الجديد.</li>
  <li><strong>بناء التحقق باللغة العربية كمرحلة رسمية.</strong> ورشة عمل مع أصحاب المصلحة في الأعمال الناطقين بالعربية يراجعون المواصفات أمر لا يمكن التفاوض عليه للمؤسسات في منطقة الخليج مع منطق العملية باللغة العربية.</li>
  </ul>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>ماكينزي و Company، <em>Tech debt: Reclaiming tech equity</em>، 2020. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>ماكينزي و Company، <em>Delivering large-scale IT projects on time, on budget, and on value</em>. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Stripe، <em>The Developer Coefficient</em>. <a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">stripe.com</a></li>
  <li>Standish Group، <em>CHAOS Report</em>. <a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">standishgroup.com</a></li>
  <li>ستانفورد إتش إيه آي، <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>GitHub، <em>Octoverse 2024</em>. <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">github.blog</a></li>
  <li>EY، <em>Key strategies for modernizing OSS transformation</em>، 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>TII، <em>Falcon LLM</em>. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42)، <em>Jais</em>. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>Microsoft و G42، <em>$1.5B Strategic Investment</em>، April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  </ol>
`,
      contentTr: `
  <h2>Tez</h2>
  <p>Eski sistem, GCC'deki kurumsal yapay zeka için en temel kısıtlamadır. Telekomünikasyon şirketleri müşteri faturalandırması, ücretlendirme ve sağlama işlemlerini 1990'lar ve 2000'li yılların başında tasarlanan platformlarda çalıştırmaktadırlar. Bankalar temel defter ve risk motorlarını COBOL veya eski Java'da çalıştırmaktadırlar. Kamu sektörü platformları, yirmi yıllık özelleştirmeler sonucunda birikmiş düzenleme ve hak mantığını kodlamaktadırlar. Yapay zeka tarafından yönlendirilen SDLC — bu sistemleri okumak, belgelemek ve yeniden inşa etmek için büyük dil modellerini kullanmak — modernizasyonun tarihsel olarak en pahalı aşamasını sıkıştıracak kadar olgun hale gelmiştir: mevcut sistem ne yaptığını anlamak. Bu rapor, bu yeteneği teslim edilebilir sonuçlara dönüştüren disiplini ortaya koymaktadır.</p>
  <h2>Hiçbir Şey Yapmama Maliyeti</h2>
  <p>McKinsey, teknik borç tahminini tipik kurumların teknoloji varlık değerinin kabaca %20-40'ı olarak tahmin etmektedir ve her yeni girişim üzerinde — yapay zeka dahil olmak üzere — gizli bir vergi oluşturmaktadır (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">McKinsey, 2020</a>). Stripe'ın geliştirici araştırması, mühendislik takımlarının zamanlarının kabaca üçte birini eski sistem ve kötü kod bakımına ayırdığını göstermektedir (<a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">Stripe, <em>The Developer Coefficient</em></a>). Standish Group'un <em>CHAOS</em> raporlaması, büyük dönüştürme programlarının yüksek oranlarda başarısız olduğunu veya materyel olarak bütçeyi aştığını bulmaktadır (<a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">Standish Group</a>). Bu durumlar, metodolojimizin tam olarak tasarlandığı durumlardır.</p>
  <h2>Neden Önceki Modernizasyon Programları Başarısız Oldu</h2>
  <p>Çoğu büyük GCC işletmesi en az bir başarısız modernizasyon girişiminin izini taşımaktadır. Kurumsal BT başarısızlığı hakkında yayınlanan kanıtlar, üç yinelenen neden işaret etmektedir: mevcut sistemin yetersiz belgelenmesi, iş mantığı karmaşıklığının olmaması ve eski ile yeni arasındaki sınırda yetersiz test kapsamı (<a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">McKinsey büyük BT projeleri hakkında</a>). Aşağıdaki disiplin, bu üç temel nedenin etrafında özel olarak oluşturulmuştur.</p>
  <h2>Spec-from-Legacy: Metodoloji</h2>
  <h3>Aşama 1 — Yapay Zeka Destekli Çıkarma</h3>
  <p>Hedef eski yığın üzerinde eğitilen kod analiz ajanları — COBOL, SAP ABAP, eski Java, özel platformlar — iş mantığını, veri yapılarını, entegrasyon noktalarını ve istisnai akışları sistematik olarak belgelendirmektedir. Stanford HAI'nin <em>2025 AI Index</em> ve GitHub'ın <em>Octoverse</em>, gerçek kod tabanlarında kod-sahibi LLM'lerden ölçülebilir mühendislik verimlilik kazançları kaydetmektedir (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>; <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">GitHub Octoverse, 2024</a>). Mühendislik kararı insan kalır; asistan kaldırmayı sıkıştırır.</p>
  <h3>Aşama 2 — Spesifikasyon Doğrulama</h3>
  <p>Çıkarılan spesifikasyon, kurumsal bilgiye karşı doğrulanmaktadır — iş paydaşları, sistem operatörleri, tarihsel değişim kayıtları. Bu aşama, kod söyleyenler ile işletme gerçekten ihtiyaç duyarken arasındaki boşluğu ortaya çıkarmaktadır.</p>
  <h3>Aşama 3 — Mimari ve Göç Planlaması</h3>
  <p>Elinde doğrulanmış spesifikasyon ile hedef mimari tasarlanmakta — veri sınıflandırması izin verirse bulut-yerel, egemenlik gerekleri talep ederse şirket içi — ve göç, operasyonel riski en aza indirmek için sıralanmaktadır.</p>
  <h2>Egemen ve Şirket İçi Teslimat</h2>
  <p>GCC kamu sektörü müşterileri savunma, istihbarat ve kritik ulusal altyapıda, kod, veri ve sistem spesifikasyonları güvenli çevreden ayrılamaz. Maven AI'nin modernizasyon uygulaması, bu bağlamlarda tamamen şirket içi çalışmakta ve uygun olan yerlerde bölgesel egemen yapay zeka altyapısından yararlanmakta — Abu Dhabi'den TII'nin açık ağırlık Falcon ailesini ve Inception/G42'den Arapça yetenekli Jais modellerini içermektedir (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). Son bölgesel egemen yapay zeka duyuruları — Microsoft'un Nisan 2024'te G42'ye 1.5 milyar dolar yatırımı ve PIF altında HUMAIN'in lansmanı — bölgesel egemen iş yükleri için mevcut altyapıyı anlamlı bir şekilde genişletmiştir (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">Microsoft–G42, 2024</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>Arapça ve Bölgesel Bağlam</h2>
  <p>GCC işletmelerindeki eski sistemler sıklıkla Arapça iş mantığı, bölgesel işlem değişkenleri ve yerel olarak özelleştirilmiş iş akışları kodlamaktadır ve bunlar temel olarak Batı kod tabanları üzerinde eğitilen çıkarma araçları tarafından görülmemektedir. Teslimat deneyimimizde, Arapça karakter kodlaması ve Zakat veya Hijri takvimi mantığı uygulayan SAP ABAP özelleştirmeleri olan COBOL fatura sistemleri, ikisi de düzenli olarak hazır çıkarma araçlarını başarısız hale getirmektedir. Arapça-farkında analiz ve doğrulama aşamasında Arapça konuşan konu uzmanları bu pazarda isteğe bağlı değildir.</p>
  <h2>Yüksek Riskli Sistemler İçin Test</h2>
  <p>Üretim ortamında eski sistemler, tanım gereği, yıllar boyunca kenar durum işlemesi, istisna mantığı ve belgelenmemiş iş kurallarını biriktirmiştir. Hedef %100 kod kapsamı değildir — %100 iş sonucu kapsamıdır: eski sistem üreten her materyel iş sonucu yeni sistem tarafından çoğaltılabilir olmalıdır. Üretim işlem analizi tarafından zemin edilen yapay zeka destekli test üretimi, spesifikasyon başına değil, burada ödeme yapıldığı yerdir.</p>
  <h2>Örnek Katılım Biçimi</h2>
  <p>Bu çalışmanın temsili bir biçimi — GCC telekom ve bankaları en sık gördüğümüz katılım modellerinden çizilen, müşteri gizliliğini korumak için varsayımsal olarak sunulan — sekiz ila on iki haftada belgelenen milyonlarca satırlık eski yığın yerine altı ila on sekiz ay, işletme ile mühendislik arasındaki sözleşme haline gelen 1000+ sayfa doğrulanmış spesifikasyon ve toplam program zaman çizelgesi karşılaştırılabilir kapsam için endüstri ölçütlerinden %30-40 daha kısadır. Ekonomi, temel olarak spesifikasyon aşamasının hızı değil, inşaat aşamasında kaçınılan yeniden yapılma tarafından yönlendirilmektedir.</p>
  <h2>Tavsiyeler</h2>
  <ul>
  <li><strong>Spesifikasyonu yapın ilk, her zaman.</strong> Modernizasyon başarısızlığının en yaygın nedeni, nelerin değiştirileceğini tam olarak anlamadan yeniden inşaatı başlamak kalır.</li>
  <li><strong>Şirket içi yeteneği tedarik gereksinimi olarak ele alınız.</strong> Veri sınıflandırmanız egemen kategoriler içeriyorsa, sözleşme imzasından önce teslimat ortağının şirket içi yeteneğini doğrulayınız.</li>
  <li><strong>Değişim yönetimini başlangıçta kapsamlı hale getiriniz.</strong> Teknik modernizasyon daha kolay yarısıdır; işletme süreci yeniden tasarımı ve benimseme, yeni sistem kullanılıp kullanılmayacağını belirleyen yarısıdır.</li>
  <li><strong>Arapça dil doğrulamasını resmi aşama olarak oluşturunuz.</strong> Spesifikasyonu gözden geçiren Arapça konuşan iş paydaşlarıyla bir çalıştay, Arapça işlem mantığı olan GCC kuruluşları için müzakere edilemezdir.</li>
  </ul>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>McKinsey &amp; Company, <em>Tech debt: Reclaiming tech equity</em>, 2020. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>McKinsey &amp; Company, <em>Delivering large-scale IT projects on time, on budget, and on value</em>. <a href="https://www.mckinsey.com/capabilities/mckinsey-digital/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Stripe, <em>The Developer Coefficient</em>. <a href="https://stripe.com/files/reports/the-developer-coefficient.pdf" target="_blank" rel="noopener noreferrer">stripe.com</a></li>
  <li>Standish Group, <em>CHAOS Report</em>. <a href="https://www.standishgroup.com/" target="_blank" rel="noopener noreferrer">standishgroup.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>GitHub, <em>Octoverse 2024</em>. <a href="https://github.blog/news-insights/octoverse/octoverse-2024/" target="_blank" rel="noopener noreferrer">github.blog</a></li>
  <li>EY, <em>Key strategies for modernizing OSS transformation</em>, 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>TII, <em>Falcon LLM</em>. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42), <em>Jais</em>. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>Microsoft &amp; G42, <em>$1.5B Strategic Investment</em>, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  </ol>
`,
    },
    {
      id: "gcc-ai-spending-outlook",
      slug: "gcc-ai-spending-outlook",
      title: "GCC AI Spending Outlook: Anchor Programs, Sectors, Implications",
      category: "Industry Trends",
      type: "Research Report",
      date: "Updated May 2026",
      readTime: "16 min read",
      author: "Maven AI Research & Advisory",
      coverImage: "/images/report-4.png",
      summary: "PwC ME estimates ~$320B GCC GDP impact from AI by 2030; Strategy& sizes the GenAI opportunity at ~$23.5B annually. We anchor the procurement reality in named, public commitments — HUMAIN under PIF, Microsoft–G42, Aramco–Groq — and set out what it means for technology providers.",
      featured: false,
      tags: ["GCC", "AI Spending", "Vision 2030", "Sovereign AI"],
      content: `
  <h2>Thesis</h2>
  <p>The GCC's AI investment story is not a forecast — it is a procurement reality already underway, anchored in publicly committed sovereign capital and announced strategic partnerships. PwC Middle East estimates that AI could contribute roughly $320 billion to GCC GDP by 2030, with Saudi Arabia (~$135B) and the UAE (~$96B) capturing the largest share (<a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">PwC ME, 2018</a>). Strategy&amp;'s 2023 work sizes the GCC GenAI opportunity at roughly $23.5B annually by 2030 (<a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">Strategy&amp;, 2023</a>). What has changed since those estimates were published is the speed at which sovereign capital has moved from policy to deployment.</p>
  <h2>Anchor Programs &amp; Commitments</h2>
  <ul>
  <li><strong>Saudi Arabia — HUMAIN under PIF.</strong> Launched as PIF's vehicle for end-to-end AI capability — data centres, foundation models, and downstream products (<a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>; <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">PIF</a>).</li>
  <li><strong>Saudi Arabia — SDAIA.</strong> Operates the National Strategy for Data &amp; AI and the National Data Bank (<a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">SDAIA</a>).</li>
  <li><strong>Saudi Arabia — Aramco AI.</strong> Aramco has publicly committed to using AI across its upstream and downstream operations and announced a $1.5B partnership with Groq to expand AI inference capacity in the Kingdom (<a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">Aramco</a>; <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">Groq–Aramco, 2025</a>).</li>
  <li><strong>UAE — G42 ecosystem.</strong> Microsoft's April 2024 $1.5B strategic investment in G42 anchors a large in-region compute and applied-AI build-out (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">Microsoft–G42, 2024</a>). G42-controlled Inception publishes the Arabic-capable Jais foundation models (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>).</li>
  <li><strong>UAE — Falcon &amp; National AI Strategy 2031.</strong> TII's open-weight Falcon family and the UAE AI Office's strategy commit the UAE to a top-tier AI position by 2031 (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">UAE AI Office</a>).</li>
  <li><strong>Qatar — National AI Strategy.</strong> MCIT-led, anchoring sector use-cases in healthcare, energy, and financial services (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">Qatar MCIT</a>).</li>
  </ul>
  <h2>Sector Concentration</h2>
  <p>IDC's regional AI and GenAI spending guides consistently identify three sectors capturing the majority of GCC AI spend: government and public services, banking and financial services, and telecommunications (<a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">IDC</a>). McKinsey's regional analysis points to the same concentration, with the additional observation that workflow redesign — not model selection — is the binding determinant of value capture (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</p>
  <h3>Saudi Arabia: Vision 2030 as Procurement Engine</h3>
  <p>Saudi Arabia's National AI Strategy is embedded in <em>Vision 2030</em>, with the Kingdom's AI ambition backed by PIF's stated capital commitment to technology and giga-projects (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">Vision 2030</a>; <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">PIF Giga-Projects</a>). NEOM and the broader giga-project portfolio represent a structurally large source of demand for AI-enabled infrastructure, autonomous-operations, and predictive-maintenance capability (<a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">NEOM</a>).</p>
  <h3>UAE: Ecosystem Investment</h3>
  <p>The UAE's AI investment is distributed across an ecosystem rather than centralised in a single sovereign vehicle — Abu Dhabi's G42, Dubai's tech economy, free-zone innovation hubs, and a growing base of AI-native firms — with the UAE AI Charter and PDPL setting the compliance frame.</p>
  <h3>Telecommunications</h3>
  <p>GCC telecoms — STC, e&amp;, du, Ooredoo, Zain — have publicly committed to network-AI, customer-experience AI, and BSS modernisation programs, each issuing investor-facing communications on AI as a core element of their multi-year strategies. EY's published work on OSS transformation captures the pattern (<a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">EY, 2024</a>).</p>
  <h3>Financial Services</h3>
  <p>SAMA's <em>Cyber Resilience Framework</em> and IT-governance instructions, plus the SAMA-supervised Open Banking Framework, set the bar for GCC financial-services AI deployment (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>). McKinsey's analysis of GCC corporate and investment banking identifies AI as one of five accelerators (<a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">McKinsey GCC CIB</a>). Investment is concentrated in fraud, risk, conduct surveillance, and customer-care automation.</p>
  <h2>The Islamic Finance AI Frontier</h2>
  <p>Murabaha pricing, Ijara analytics, Sukuk portfolio optimisation, and Zakat-compliant wealth management require modelling frameworks distinct from conventional finance. Off-the-shelf financial AI built for conventional structures regularly fails Shariah review when applied directly. Institutions investing in genuinely Shariah-compliant AI modelling — done in collaboration with Shariah boards from the start — gain a durable advantage in a market where Islamic banking assets continue to grow at high single-digit rates globally (<a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">Islamic Financial Services Board</a>).</p>
  <h2>What This Means for Technology Providers</h2>
  <ul>
  <li><strong>Regulatory alignment is table stakes.</strong> Vendors without credible SAMA/CBUAE/PDPL alignment will be excluded from the largest procurement categories.</li>
  <li><strong>Arabic-language performance is a benchmark requirement.</strong> Falcon and Jais are now credible regional reference points (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>).</li>
  <li><strong>Sovereign-deployment capability is a differentiator.</strong> A meaningful share of the highest-value contracts requires on-prem or air-gapped delivery — a profile most global vendors cannot credibly offer.</li>
  </ul>
  <h2>Recommendations for CIOs &amp; CTOs</h2>
  <ul>
  <li>Allocate explicit budget to data-foundation work before deploying production AI.</li>
  <li>Prioritise use cases that generate proprietary data as a byproduct of their operation.</li>
  <li>Build internal AI-governance capability rather than relying solely on vendor-managed compliance.</li>
  <li>Treat Arabic performance as a benchmark requirement on every customer-facing or regulator-facing deployment.</li>
  </ul>
  <h2>A Note on Methodology</h2>
  <p>The figures in this report are reproduced as published by the cited sources. Maven AI does not produce its own GCC AI spending forecast: the dispersion across published forecasts (PwC ME, Strategy&amp;, IDC, IMARC, Mordor Intelligence) is wide enough that adding a tenth number would mislead more than it would inform. Readers should treat the cited ranges as bounds, not point estimates.</p>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>PwC Middle East, <em>The Potential Impact of AI in the Middle East</em>, 2018. <a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">pwc.com/m1</a></li>
  <li>Strategy&amp;, <em>Reshaping the Middle East with Generative AI</em>, 2023. <a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">strategyand.pwc.com</a></li>
  <li>HUMAIN. <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>Public Investment Fund. <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>PIF Giga-Projects portfolio. <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>Saudi Aramco — Building the AI future. <a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">aramco.com</a></li>
  <li>Groq — Saudi Arabia $1.5B AI expansion announcement, 2025. <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">groq.com</a></li>
  <li>Microsoft &amp; G42 Strategic Investment, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>UAE AI Office — National AI Strategy 2031. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>SDAIA — National Strategy for Data &amp; AI. <a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>Saudi Vision 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>NEOM. <a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">neom.com</a></li>
  <li>Qatar MCIT — National AI Strategy. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
  <li>SAMA — Rules &amp; Instructions. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>McKinsey — Five accelerators for corporate &amp; investment banking in the GCC. <a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>EY — Key strategies for modernizing OSS transformation, 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>TII — Falcon LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception — Jais. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>IDC. <a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">idc.com</a></li>
  <li>McKinsey, <em>State of AI</em>. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Islamic Financial Services Board. <a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">ifsb.org</a></li>
  </ol>
      `,
      contentAr: `  <h2>الرؤية الأساسية</h2>
  <p>قصة استثمار الذكاء الاصطناعي في دول مجلس التعاون الخليج ليست توقعاً بل هي واقع المشتريات القائم بالفعل، حيث يعتمد على رأس مال سيادي ملتزم به علناً وشراكات استراتيجية معلنة. تقدّر شركة برايس ووتر هاوس كوبرز الشرق الأوسط أن الذكاء الاصطناعي قد يساهم بحوالي 320 مليار دولار في الناتج المحلي الإجمالي لدول مجلس التعاون الخليج بحلول عام 2030، مع استحواذ المملكة العربية السعودية (حوالي 135 مليار دولار) والإمارات العربية المتحدة (حوالي 96 مليار دولار) على أكبر حصة (<a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">برايس ووتر هاوس كوبرز الشرق الأوسط، 2018</a>). يقدّر عمل ستراتيجي اند الصادر سنة 2023 فرصة الذكاء الاصطناعي التوليدي في دول مجلس التعاون الخليج بحوالي 23.5 مليار دولار سنوياً بحلول عام 2030 (<a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">ستراتيجي اند، 2023</a>). ما تغيّر منذ نشر تلك التقديرات هو السرعة التي انتقل بها رأس المال السيادي من السياسة إلى النشر الفعلي.</p>
  <h2>البرامج والالتزامات الأساسية</h2>
  <ul>
  <li><strong>المملكة العربية السعودية — همائن تحت صندوق الاستثمارات العامة.</strong> أُطلقت كأداة صندوق الاستثمارات العامة للقدرة الشاملة للذكاء الاصطناعي — مراكز البيانات والنماذج الأساسية والمنتجات النهائية (<a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">همائن</a>؛ <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">صندوق الاستثمارات العامة</a>).</li>
  <li><strong>المملكة العربية السعودية — سدايا.</strong> تدير الاستراتيجية الوطنية للبيانات والذكاء الاصطناعي والبنك الوطني للبيانات (<a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">سدايا</a>).</li>
  <li><strong>المملكة العربية السعودية — أرامكو الذكاء الاصطناعي.</strong> التزمت أرامكو علناً باستخدام الذكاء الاصطناعي في عملياتها الاستكشافية والتكريرية وأعلنت عن شراكة بقيمة 1.5 مليار دولار مع غروق لتوسيع قدرات الاستدلال الذكي في المملكة (<a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">أرامكو</a>؛ <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">غروق–أرامكو، 2025</a>).</li>
  <li><strong>الإمارات العربية المتحدة — نظام بيئة جي 42.</strong> يُرسّخ استثمار مايكروسوفت الاستراتيجي البالغ 1.5 مليار دولار في جي 42 في أبريل 2024 بناء الحوسبة الإقليمية والذكاء الاصطناعي التطبيقي على نطاق واسع (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">مايكروسوفت–جي 42، 2024</a>). تنشر إنسبشن بالتحكم من جي 42 نماذج جايس الأساسية القادرة على معالجة اللغة العربية (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">جايس</a>).</li>
  <li><strong>الإمارات العربية المتحدة — فالكون والاستراتيجية الوطنية للذكاء الاصطناعي 2031.</strong> عائلة فالكون مفتوحة الأوزان من معهد التكنولوجيا والاستراتيجية الوطنية للذكاء الاصطناعي من مكتب الإمارات للذكاء الاصطناعي تلتزمان دولة الإمارات بمركز رفيع المستوى في الذكاء الاصطناعي بحلول عام 2031 (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">فالكون</a>؛ <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">مكتب الإمارات للذكاء الاصطناعي</a>).</li>
  <li><strong>قطر — الاستراتيجية الوطنية للذكاء الاصطناعي.</strong> بقيادة وزارة المواصلات والتكنولوجيا، حيث تثبّت حالات الاستخدام في الرعاية الصحية والطاقة والخدمات المالية (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">وزارة المواصلات والتكنولوجيا القطرية</a>).</li>
  </ul>
  <h2>تركيز القطاع</h2>
  <p>تحدّد أدلة إنفاق الذكاء الاصطناعي والذكاء الاصطناعي التوليدي الإقليمية التابعة لـ IDC باستمرار ثلاثة قطاعات تستحوذ على غالبية نفقات الذكاء الاصطناعي في دول مجلس التعاون الخليج: الحكومة والخدمات العامة والخدمات المصرفية والمالية والاتصالات (<a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">IDC</a>). يشير التحليل الإقليمي لـ ماكينزي إلى نفس التركيز، مع الملاحظة الإضافية بأن إعادة تصميم سير العمل — وليس اختيار النموذج — هو العامل الحاسم لالتقاط القيمة (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">ماكينزي، 2024</a>).</p>
  <h3>المملكة العربية السعودية: رؤية 2030 كمحرك مشتريات</h3>
  <p>الاستراتيجية الوطنية للذكاء الاصطناعي في المملكة العربية السعودية مدمجة في <em>رؤية 2030</em>، حيث يدعم طموح المملكة للذكاء الاصطناعي التزام صندوق الاستثمارات العامة برأس مال معلن للتكنولوجيا والمشاريع الضخمة (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">رؤية 2030</a>؛ <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">مشاريع صندوق الاستثمارات العامة الضخمة</a>). تمثل نيوم ومحفظة المشاريع الضخمة الأوسع مصدراً كبيراً هيكلياً من الطلب على البنية التحتية المدعومة بالذكاء الاصطناعي والعمليات المستقلة وقدرات الصيانة التنبؤية (<a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">نيوم</a>).</p>
  <h3>الإمارات العربية المتحدة: استثمار النظام البيئي</h3>
  <p>استثمار الإمارات في الذكاء الاصطناعي موزّع عبر نظام بيئي بدلاً من التركيز المركزي في أداة سيادية واحدة — جي 42 في أبو ظبي واقتصاد دبي التقني ومراكز التميز والابتكار بلا حدود وقاعدة متنامية من الشركات المتخصصة في الذكاء الاصطناعي — مع ميثاق الإمارات للذكاء الاصطناعي وقانون حماية البيانات الشخصية التي تحدد إطار الامتثال.</p>
  <h3>الاتصالات</h3>
  <p>التزمت شركات الاتصالات في دول مجلس التعاون الخليج — STC و e&amp; و du و Ooredoo و Zain — علناً ببرامج الذكاء الاصطناعي للشبكات والذكاء الاصطناعي لتجربة العملاء وبرامج تحديث نظم دعم الأعمال، حيث تصدر كل منها اتصالات موجهة للمستثمرين حول الذكاء الاصطناعي كعنصر أساسي في استراتيجياتها متعددة السنوات. يوضح العمل المنشور لشركة إي واي حول تحويل نظام تشغيل الشبكة هذا النمط (<a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">إي واي، 2024</a>).</p>
  <h3>الخدمات المالية</h3>
  <p>حدّد إطار ساما <em>للمرونة السيبرانية</em> وتعليمات حوكمة التكنولوجيا، بالإضافة إلى إطار العمل المصرفي المفتوح الذي تشرف عليه ساما، المعيار لنشر الذكاء الاصطناعي في الخدمات المالية في دول مجلس التعاون الخليج (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">ساما</a>). يحدّد تحليل ماكينزي للبنوك التجارية والاستثمارية في دول مجلس التعاون الخليج الذكاء الاصطناعي كأحد خمسة معجّلات (<a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">ماكينزي البنوك التجارية والاستثمارية في دول مجلس التعاون الخليج</a>). ينصب الاستثمار على أتمتة الاحتيال والمخاطر ومراقبة السلوك والعناية بالعملاء.</p>
  <h2>حدود التمويل الإسلامي بالذكاء الاصطناعي</h2>
  <p>تسعير المرابحة، وتحليلات الإجارة، وتحسين محفظة الصكوك، وإدارة الثروة الموافقة للزكاة تتطلب أطر نمذجة مختلفة عن التمويل التقليدي. البرامج المالية للذكاء الاصطناعي الجاهزة والمبنية للهياكل التقليدية تفشل بانتظام عند مراجعة الشريعة عند تطبيقها مباشرة. المؤسسات التي تستثمر في نمذجة ذكاء اصطناعي موافقة حقاً للشريعة — تم إنجازها بالتعاون مع هيئات الشريعة من البداية — تحقق ميزة دائمة في سوق حيث تستمر أصول المصارف الإسلامية في النمو بمعدلات أحادية الرقم عالية عالمياً (<a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">مجلس خدمات المالية الإسلامية</a>).</p>
  <h2>ما يعنيه هذا لموفري التكنولوجيا</h2>
  <ul>
  <li><strong>التوافق التنظيمي هو أساسي.</strong> سيتم استبعاد البائعين الذين لا يملكون توافقاً موثوقاً مع ساما ومصرف الإمارات المركزي وقانون حماية البيانات الشخصية من أكبر فئات المشتريات.</li>
  <li><strong>الأداء بلغة عربية هو متطلب معياري.</strong> أصبحت فالكون وجايس الآن نقاط مرجعية إقليمية موثوقة (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">فالكون</a>؛ <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">جايس</a>).</li>
  <li><strong>قدرة النشر السيادي هي محرك للتمييز.</strong> جزء كبير من العقود ذات أعلى قيمة يتطلب نشراً محلياً أو معزول الهواء — ملف تعريفي لا يمكن لمعظم البائعين العالميين تقديمه بصدقية.</li>
  </ul>
  <h2>التوصيات لرؤساء قطاع المعلومات والمسؤولين التقنيين</h2>
  <ul>
  <li>خصص ميزانية صريحة لعمل أساس البيانات قبل نشر الذكاء الاصطناعي الإنتاجي.</li>
  <li>أولوية لحالات الاستخدام التي تولّد بيانات مملوكة كمنتج ثانوي لعملياتها.</li>
  <li>بناء قدرة حوكمة ذكاء اصطناعي داخلية بدلاً من الاعتماد فقط على الامتثال الذي تديره جهات البيع.</li>
  <li>عامل الأداء بلغة عربية كمتطلب معياري في كل نشر يواجه العميل أو المنظّم.</li>
  </ul>
  <h2>ملاحظة حول المنهجية</h2>
  <p>تُعاد الأرقام في هذا التقرير كما نُشرت من قبل المصادر المقتبسة. لا تقدّم Maven AI توقعاتها الخاصة لنفقات الذكاء الاصطناعي في دول مجلس التعاون الخليج: التشتت عبر التنبؤات المنشورة (برايس ووتر هاوس كوبرز الشرق الأوسط، ستراتيجي اند، IDC، IMARC، Mordor Intelligence) واسع بما يكفي بحيث أن إضافة رقم عاشر ستضلل أكثر مما ستوضح. يجب على القرّاء التعامل مع النطاقات المقتبسة كحدود، وليس تقديرات نقطية.</p>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>برايس ووتر هاوس كوبرز الشرق الأوسط، <em>الأثر المحتمل للذكاء الاصطناعي في الشرق الأوسط</em>، 2018. <a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">pwc.com/m1</a></li>
  <li>ستراتيجي اند، <em>إعادة تشكيل الشرق الأوسط بالذكاء الاصطناعي التوليدي</em>، 2023. <a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">strategyand.pwc.com</a></li>
  <li>همائن. <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>صندوق الاستثمارات العامة. <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>محفظة مشاريع صندوق الاستثمارات العامة الضخمة. <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>أرامكو السعودية — بناء مستقبل الذكاء الاصطناعي. <a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">aramco.com</a></li>
  <li>غروق — إعلان توسع الذكاء الاصطناعي بـ 1.5 مليار دولار في المملكة العربية السعودية، 2025. <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">groq.com</a></li>
  <li>مايكروسوفت وجي 42 الاستثمار الاستراتيجي، أبريل 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>مكتب الإمارات للذكاء الاصطناعي — الاستراتيجية الوطنية للذكاء الاصطناعي 2031. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>سدايا — الاستراتيجية الوطنية للبيانات والذكاء الاصطناعي. <a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>رؤية المملكة العربية السعودية 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>نيوم. <a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">neom.com</a></li>
  <li>وزارة المواصلات والتكنولوجيا القطرية — الاستراتيجية الوطنية للذكاء الاصطناعي. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
  <li>ساما — القواعد والتعليمات. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>ماكينزي — خمسة معجّلات للبنوك التجارية والاستثمارية في دول مجلس التعاون الخليج. <a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>إي واي — الاستراتيجيات الرئيسية لتحديث تحويل نظام تشغيل الشبكة، 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>معهد التكنولوجيا — فالكون LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>إنسبشن — جايس. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>IDC. <a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">idc.com</a></li>
  <li>ماكينزي، <em>حالة الذكاء الاصطناعي</em>. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>مجلس خدمات المالية الإسلامية. <a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">ifsb.org</a></li>
  </ol>`,
      contentTr: `  <h2>Tez</h2>
  <p>GCC'nin yapay zeka yatırım hikayesi bir tahmin değil — halihazırda devam eden bir satın alma gerçeğidir ve kamuya duyurulan egemen sermaye ile ilan edilen stratejik ortaklıklar tarafından desteklenmektedir. PwC Orta Doğu, yapay zekanın 2030 yılına kadar GCC GSYİH'sine kabaca 320 milyar dolar katkıda bulunabileceğini tahmin etmektedir; Suudi Arabistan (yaklaşık 135 milyar dolar) ve Birleşik Arap Emirlikleri (yaklaşık 96 milyar dolar) en büyük payı almaktadır (<a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">PwC ME, 2018</a>). Strategy&'nin 2023 çalışması GCC GenAI fırsatını 2030 yılına kadar yaklaşık 23,5 milyar dolar olarak yıllık olarak boyutlandırmaktadır (<a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">Strategy&, 2023</a>). Bu tahminlerin yayınlanmasından bu yana değişen şey, egemen sermayenin politikadan dağıtıma doğru hareket ettiği hızdır.</p>
  <h2>Temel Programlar ve Taahhütler</h2>
  <ul>
  <li><strong>Suudi Arabistan — PIF'nin altında HUMAIN.</strong> PIF'nin uçtan uca yapay zeka yeteneği için aracı olarak başlatılmış — veri merkezleri, temel modeller ve akış aşağı ürünler (<a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>; <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">PIF</a>).</li>
  <li><strong>Suudi Arabistan — SDAIA.</strong> Ulusal Veri ve Yapay Zeka Stratejisini ve Ulusal Veri Bankasını işletmektedir (<a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">SDAIA</a>).</li>
  <li><strong>Suudi Arabistan — Aramco Yapay Zeka.</strong> Aramco, yapay zekayı yukarı ve aşağı akış operasyonlarında kullanma konusunda kamuya açık olarak taahhüt etmiş ve Krallıkta yapay zeka çıkarım kapasitesini genişletmek için Groq ile 1,5 milyar dolarlık bir ortaklık duyurmuştur (<a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">Aramco</a>; <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">Groq–Aramco, 2025</a>).</li>
  <li><strong>Birleşik Arap Emirlikleri — G42 ekosistemi.</strong> Microsoft'un Nisan 2024'teki G42'ye 1,5 milyar dolarlık stratejik yatırımı geniş ölçekli bölge içi bilgisayar ve uygulamalı yapay zeka inşaatını sabitlemektedir (<a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">Microsoft–G42, 2024</a>). G42 kontrolü altındaki Inception, Arapça kapasitesi olan Jais temel modellerini yayınlamaktadır (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>).</li>
  <li><strong>Birleşik Arap Emirlikleri — Falcon ve Ulusal Yapay Zeka Stratejisi 2031.</strong> TII'nin açık ağırlık Falcon ailesi ve BAE Yapay Zeka Ofisinin stratejisi, BAE'yi 2031 yılına kadar üst düzey bir yapay zeka konumuna taahhüt etmektedir (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">BAE Yapay Zeka Ofisi</a>).</li>
  <li><strong>Katar — Ulusal Yapay Zeka Stratejisi.</strong> MCIT liderliğinde, sağlık, enerji ve finansal hizmetler sektörü kullanım örneklerini sabitleyen (<a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">Katar MCIT</a>).</li>
  </ul>
  <h2>Sektör Konsantrasyonu</h2>
  <p>IDC'nin bölgesel yapay zeka ve GenAI harcama kılavuzları tutarlı olarak GCC yapay zeka harcamalarının çoğunluğunu yakalayan üç sektörü tanımlamaktadır: hükümet ve kamu hizmetleri, bankacılık ve finansal hizmetler ile telekomünikasyon (<a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">IDC</a>). McKinsey'nin bölgesel analizi aynı konsantrasyonu göstermektedir; ek gözlemle model seçimi değil — iş akışı yeniden tasarımı — yapay zekadan değer yakalama için belirleyici faktördür (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</p>
  <h3>Suudi Arabistan: Vizyon 2030 Satın Alma Motoru Olarak</h3>
  <p>Suudi Arabistan'ın Ulusal Yapay Zeka Stratejisi <em>Vizyon 2030</em>'a gömülüdür; Krallığın yapay zeka tutkusu PIF'nin teknoloji ve mega-projeler için açıklanan sermaye taahhüdü tarafından desteklenmektedir (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">Vizyon 2030</a>; <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">PIF Mega-Projeler</a>). NEOM ve daha geniş mega-proje portföyü yapay zeka destekli altyapı, otonom operasyonlar ve tahmine dayalı bakım yeteneği için yapısal olarak geniş bir talep kaynağını temsil etmektedir (<a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">NEOM</a>).</p>
  <h3>Birleşik Arap Emirlikleri: Ekosistem Yatırımı</h3>
  <p>BAE'nin yapay zeka yatırımı merkezi bir egemen araçta değil bir ekosistem genelinde dağıtılmıştır — Abu Dabi'nin G42'si, Dubai'nin tekno ekonomisi, serbest bölge inovasyonu merkezleri ve büyüyen bir yapay zeka-natiif şirket tabanı — BAE Yapay Zeka Tüzüğü ve kişisel veri koruma yasası uyum çerçevesini belirlemektedir.</p>
  <h3>Telekomünikasyon</h3>
  <p>GCC telekomları — STC, e&, du, Ooredoo, Zain — ağ yapay zekası, müşteri deneyimi yapay zekası ve İşletme Destek Sistemi modernizasyon programlarına kamuya açık olarak taahhüt etmiş; her biri yapay zekanın çok yıllık stratejilerinin temel bir unsuru olduğu hakkında yatırımcı iletişimleri yayınlamaktadır. EY'nin OSS dönüşümü hakkında yayınlanan çalışması deseni yakalmaktadır (<a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">EY, 2024</a>).</p>
  <h3>Finansal Hizmetler</h3>
  <p>SAMA'nın <em>Siber Dayanıklılık Çerçevesi</em> ve BT yönetişim talimatları; ayrıca SAMA-denetimli Açık Bankacılık Çerçevesi GCC finansal hizmetler yapay zeka dağıtımı için çubuğu ayarlamaktadır (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>). McKinsey'nin GCC kurumsal ve yatırım bankacılığı analizi yapay zekayı beş hızlandırıcıdan biri olarak tanımlamaktadır (<a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">McKinsey GCC CIB</a>). Yatırım, dolandırıcılık, risk, davranış gözetimi ve müşteri bakım otomasyonunda yoğunlaşmıştır.</p>
  <h2>İslami Finans Yapay Zeka Sınırı</h2>
  <p>Murabaha fiyatlandırması, İcara analitiği, Sukuk portföyü optimizasyonu ve Zakat uyumlu servet yönetimi geleneksel finanstan farklı modelleme çerçeveleri gerektirmektedir. Geleneksel yapılar için yapılmış hazır finansal yapay zeka doğrudan uygulandığında Şeriaat incelemesinde düzenli olarak başarısız olmaktadır. Baştan Şeriaat kurullarıyla işbirliğinde yapılmış gerçekten Şeriaat uyumlu yapay zeka modellemesine yatırım yapan kurumlar; İslami bankacılık varlıklarının küresel olarak yüksek tek haneli oranlarda büyümeye devam ettiği bir piyasada dayanıklı bir avantaj elde etmektedir (<a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">İslami Finansal Hizmetler Kurulu</a>).</p>
  <h2>Teknoloji Sağlayıcıları İçin Bunun Anlamı</h2>
  <ul>
  <li><strong>Düzenleyici uyum temel gereksinimdir.</strong> SAMA/CBUAE/PDPL uyumluluğu olmayan satıcılar en büyük satın alma kategorilerinden hariç tutulacaktır.</li>
  <li><strong>Arapça dil performansı bir kıyaslama gereksinimidir.</strong> Falcon ve Jais artık güvenilir bölgesel referans noktasıdır (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>; <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>).</li>
  <li><strong>Egemen dağıtım yeteneği bir ayırt edicidir.</strong> En yüksek değerli sözleşmelerin anlamlı bir payı şirket içi veya hava geçirmez dağıtım gerektirmektedir — çoğu küresel satıcının inandırıcı olarak sunabileceği olmayan bir profil.</li>
  </ul>
  <h2>BT Direktörleri ve CTO'lar İçin Tavsiyeler</h2>
  <ul>
  <li>Üretim yapay zeka dağıtımından önce veri-temel çalışması için açık bütçe ayırın.</li>
  <li>operasyonun bir yan ürünü olarak tescilli veri üretecek kullanım örneklerini öncelendirin.</li>
  <li>sadece satıcı tarafından yönetilen uyumluluğa güvenmek yerine dahili yapay zeka yönetişim yeteneği oluşturun.</li>
  <li>Arapça performansını her müşteri veya düzenleyici tarafı dağıtımında bir kıyaslama gereksinimidir olarak ele alın.</li>
  </ul>
  <h2>Metodoloji Hakkında Bir Not</h2>
  <p>Bu rapordaki rakamlar alıntı yapılan kaynaklar tarafından yayınlandığı şekilde yeniden üretilmektedir. Maven AI kendi GCC yapay zeka harcama tahmini üretmemektedir: yayınlanan tahminler arasında dağılım (PwC ME, Strategy&, IDC, IMARC, Mordor Intelligence) yeterince geniştir ki onuncu bir sayı eklemek bilgilendirmekten daha fazla yanıltacaktır. Okuyucular alıntı yapılan aralıkları nokta tahminler değil sınırlar olarak ele almalıdır.</p>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>PwC Orta Doğu, <em>Orta Doğu'da Yapay Zekanın Olası Etkisi</em>, 2018. <a href="https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html" target="_blank" rel="noopener noreferrer">pwc.com/m1</a></li>
  <li>Strategy&, <em>Yapay Zeka ile Orta Doğu'yu Yeniden Şekillendirmek</em>, 2023. <a href="https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping-the-middle-east-genai.html" target="_blank" rel="noopener noreferrer">strategyand.pwc.com</a></li>
  <li>HUMAIN. <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>Kamu Yatırım Fonu. <a href="https://www.pif.gov.sa/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>PIF Mega-Projeler portföyü. <a href="https://www.pif.gov.sa/en/our-investments/" target="_blank" rel="noopener noreferrer">pif.gov.sa</a></li>
  <li>Saudi Aramco — Yapay Zekanın Geleceğini İnşa Etmek. <a href="https://www.aramco.com/en/what-we-do/energy-innovation/digitalization" target="_blank" rel="noopener noreferrer">aramco.com</a></li>
  <li>Groq — Suudi Arabistan 1,5 Milyar Dolarlık Yapay Zeka Genişlemesi Duyurusu, 2025. <a href="https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq" target="_blank" rel="noopener noreferrer">groq.com</a></li>
  <li>Microsoft ve G42 Stratejik Yatırım, Nisan 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>BAE Yapay Zeka Ofisi — Ulusal Yapay Zeka Stratejisi 2031. <a href="https://ai.gov.ae/" target="_blank" rel="noopener noreferrer">ai.gov.ae</a></li>
  <li>SDAIA — Ulusal Veri ve Yapay Zeka Stratejisi. <a href="https://sdaia.gov.sa/" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>Suudi Vizyon 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>NEOM. <a href="https://www.neom.com/" target="_blank" rel="noopener noreferrer">neom.com</a></li>
  <li>Katar MCIT — Ulusal Yapay Zeka Stratejisi. <a href="https://www.mcit.gov.qa/en/national-ai-strategy" target="_blank" rel="noopener noreferrer">mcit.gov.qa</a></li>
  <li>SAMA — Kurallar ve Talimatlar. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>McKinsey — GCC'de kurumsal ve yatırım bankacılığı için beş hızlandırıcı. <a href="https://www.mckinsey.com/industries/financial-services/our-insights" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>EY — OSS dönüşümünü modernize etmek için anahtar stratejiler, 2024. <a href="https://www.ey.com/en_gl/insights/telecommunications" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>TII — Falcon LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception — Jais. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org</a></li>
  <li>IDC. <a href="https://www.idc.com/" target="_blank" rel="noopener noreferrer">idc.com</a></li>
  <li>McKinsey, <em>Yapay Zeka Durumu</em>. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>İslami Finansal Hizmetler Kurulu. <a href="https://www.ifsb.org/" target="_blank" rel="noopener noreferrer">ifsb.org</a></li>
  </ol>`,
    },
    {
      id: "agentic-workforce",
      slug: "agentic-workforce",
      title: "The Agentic Workforce: Human-AI Collaboration in Public Sector Operations",
      category: "Agentic AI",
      type: "Perspective",
      date: "Updated May 2026",
      readTime: "12 min read",
      author: "Khalid Al Khudairi, Founding Partner",
      coverImage: "/images/report-5.png",
      summary: "How GCC government entities can redesign operating models around human-AI collaboration — anchored in Vision 2030's Saudization and UAE Centennial 2071's Emiratisation, and grounded in WEF Future of Jobs and McKinsey State of AI evidence.",
      featured: false,
      tags: ["Public Sector", "Workforce", "Human-AI Collaboration", "Government"],
      content: `
  <h2>Thesis</h2>
  <p>The framing "AI will take jobs" has produced more anxiety than insight. The more useful framing — and the one that maps onto the GCC public-sector mandate — is that AI will take <em>tasks</em>, and the public-sector organizations that redesign roles and processes around this reality will be more productive, more attractive employers, and more aligned with national workforce strategies than those that do not. The World Economic Forum's <em>Future of Jobs Report 2025</em> finds that 86% of employers expect AI to transform their business by 2030, and that the highest-growth roles are those involving AI complementarity, not AI replacement (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">WEF, 2025</a>).</p>
  <h2>The GCC Workforce Frame</h2>
  <p>For Saudi public-sector organizations, the human-AI collaboration question is anchored in <em>Vision 2030</em>'s Saudization objectives, which require specific participation rates of Saudi nationals across the economy (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">Vision 2030</a>; <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">Ministry of Human Resources &amp; Social Development</a>). For the UAE, the equivalent frame is <em>UAE Centennial 2071</em> and the Emiratisation targets administered through the Ministry of Human Resources &amp; Emiratisation (<a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">MoHRE</a>). In both cases, automation that simply eliminates routine roles works against national policy. Automation that elevates nationals into higher-value advisory, oversight, and relationship work supports it.</p>
  <h2>Three Models of Human-AI Collaboration</h2>
  <h3>Model 1 — AI Handles, Human Reviews</h3>
  <p>The agent owns the case end-to-end; the human reviews edge cases flagged by the agent. Appropriate for high-volume, policy-driven decisions where the agent's measured accuracy is high and the cost of an error is bounded.</p>
  <h3>Model 2 — AI Recommends, Human Decides</h3>
  <p>The agent gathers, analyses, and recommends; the human makes the final decision. Appropriate where human accountability is legally required or judgment dimensions are genuinely complex. SAMA and CBUAE positions on consequential financial decisions sit firmly in this model (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>; <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>).</p>
  <h3>Model 3 — Human Leads, AI Supports</h3>
  <p>The human leads; the agent provides real-time information and analysis. Appropriate for senior advisory, complex negotiations, and crisis management where AI augments rather than replaces.</p>
  <h2>Process Redesign Is the Hidden Work</h2>
  <p>Deploying an AI agent into an unredesigned process is the most common high-cost failure mode in public-sector AI adoption. McKinsey's <em>State of AI</em> identifies workflow redesign as the practice most strongly correlated with measurable EBIT impact in the private sector (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>). The pattern transfers directly to public-sector productivity: an agent that automates a broken process produces wrong answers faster.</p>
  <p>Process redesign in public-sector contexts is constrained in ways the private sector is not — regulatory mandates that specify steps rather than outcomes, accountability structures embedded in approval hierarchies, civil-service rules on role redesign. None of these is insurmountable; all of them require deliberate executive sponsorship that cannot be delegated to the AI delivery team.</p>
  <h2>The Saudization &amp; Emiratisation Dimension</h2>
  <p>Properly deployed agentic AI accelerates Saudization and Emiratisation rather than threatening them. When document processing, routine citizen inquiries, and case management move to the agent, nationals previously consumed by that work can be redeployed to advisory, oversight, and relationship roles — exactly the kind of value-adding work that Vision 2030 and Centennial 2071 envision for nationals. This is the framing we recommend for executive committees evaluating AI workforce programs in GCC government.</p>
  <h2>The First 90 Days</h2>
  <ul>
  <li><strong>Days 1–30 — Process selection &amp; alignment.</strong> Choose a single bounded process: high-volume, policy-driven, currently consuming significant national-workforce time. Get genuine executive sponsorship, not just approval. Map the current process before designing the future state.</li>
  <li><strong>Days 31–60 — Pilot build &amp; controlled deployment.</strong> Build the agent against the mapped process. Deploy to a pilot group of 10–20 employees. Collect feedback on both agent performance and the human experience of working alongside the agent.</li>
  <li><strong>Days 61–90 — Refinement &amp; scale prep.</strong> Incorporate feedback. Redesign the surrounding process based on what the pilot revealed. Prepare change-management and training materials. Define the governance and monitoring frame for production.</li>
  </ul>
  <h2>Measuring Transformation, Not Just Efficiency</h2>
  <p>Time saved and cost per transaction are necessary metrics, but they do not capture the value of public-sector workforce transformation. The more important measures are outcome quality (are decisions better?), employee experience (are nationals doing more meaningful work?), and citizen experience (are public services improving?). Organizations that track all three are more committed to long-term success — and more likely to achieve it.</p>
  <h2>Recommendations</h2>
  <ul>
  <li>Frame agentic-AI workforce programs explicitly against Vision 2030 / Centennial 2071, not against generic productivity metrics.</li>
  <li>Make process redesign a board-level workstream, not a delivery-team responsibility.</li>
  <li>Engage civil-service and HR leadership at the start, not at deployment.</li>
  <li>Track outcome quality and citizen experience alongside efficiency from day one.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>World Economic Forum, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>Saudi Vision 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>KSA Ministry of Human Resources &amp; Social Development. <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">hrsd.gov.sa</a></li>
  <li>UAE Ministry of Human Resources &amp; Emiratisation. <a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">mohre.gov.ae</a></li>
  <li>UAE Centennial 2071. <a href="https://u.ae/en/about-the-uae/strategies-initiatives-and-awards" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>McKinsey, <em>State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>SAMA — Rules &amp; Instructions. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>Central Bank of the UAE. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  <li>OECD AI Principles. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>
      `,
      contentAr: `
  <h2>الأساس المنطقي</h2>
  <p>إن صياغة "الذكاء الاصطناعي سيأخذ الوظائف" أنتجت قلقاً أكثر من الرؤية الثاقبة. الصياغة الأكثر فائدة — والصياغة التي تتماشى مع ولاية دول مجلس التعاون الخليجي للقطاع العام — هي أن الذكاء الاصطناعي سيأخذ <em>المهام</em>، والمنظمات في القطاع العام بدول مجلس التعاون الخليجي التي تعيد تصميم الأدوار والعمليات حول هذه الحقيقة ستكون أكثر إنتاجية وجاذبية كأصحاب عمل، وأكثر توافقاً مع الاستراتيجيات الوطنية للقوى العاملة من تلك التي لا تفعل ذلك. تقرير <em>مستقبل الوظائف 2025</em> من المنتدى الاقتصادي العالمي يجد أن 86% من أصحاب العمل يتوقعون أن يحول الذكاء الاصطناعي أعمالهم بحلول عام 2030، وأن الأدوار ذات النمو الأعلى هي تلك التي تتضمن التكامل مع الذكاء الاصطناعي، وليس استبدال الذكاء الاصطناعي (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">المنتدى الاقتصادي العالمي، 2025</a>).</p>
  <h2>إطار القوى العاملة بدول مجلس التعاون الخليجي</h2>
  <p>بالنسبة لمنظمات القطاع العام السعودي، فإن سؤال التعاون بين الإنسان والذكاء الاصطناعي مرتبط برؤية <em>رؤية 2030</em> للمملكة العربية السعودية، والتي تتطلب معدلات مشاركة محددة للمواطنين السعوديين عبر الاقتصاد (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">رؤية 2030</a>؛ <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">وزارة الموارد البشرية والتنمية الاجتماعية</a>). بالنسبة للإمارات العربية المتحدة، الإطار المعادل هو <em>الإمارات 2071</em> وأهداف التوطين التي تدار من خلال وزارة الموارد البشرية والتوطين (<a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">وزارة الموارد البشرية</a>). في كلا الحالتين، الأتمتة التي ببساطة تزيل الأدوار الروتينية تعمل ضد السياسة الوطنية. الأتمتة التي ترفع المواطنين إلى العمل الاستشاري والإشرافي والعلاقات الأعلى قيمة تدعمها.</p>
  <h2>ثلاثة نماذج للتعاون بين الإنسان والذكاء الاصطناعي</h2>
  <h3>النموذج 1 — الذكاء الاصطناعي يتعامل، الإنسان يراجع</h3>
  <p>يملك الوكيل القضية بشكل شامل؛ يراجع الإنسان الحالات الحدية التي يشير إليها الوكيل. مناسب للقرارات ذات الحجم العالي والمدفوعة بالسياسة حيث تكون دقة الوكيل المقاسة عالية وتكلفة الخطأ محدودة.</p>
  <h3>النموذج 2 — الذكاء الاصطناعي يوصي، الإنسان يقرر</h3>
  <p>يجمع الوكيل البيانات ويحللها ويوصي؛ يتخذ الإنسان القرار النهائي. مناسب حيث تكون المساءلة الإنسانية مطلوبة قانوناً أو حيث تكون أبعاد الحكم معقدة حقاً. تقف مواقف ساما ومصرف الإمارات المركزي بشأن القرارات المالية المهمة بقوة في هذا النموذج (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">ساما</a>؛ <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">مصرف الإمارات المركزي</a>).</p>
  <h3>النموذج 3 — الإنسان يقود، الذكاء الاصطناعي يدعم</h3>
  <p>يقود الإنسان؛ يوفر الوكيل معلومات وتحليل في الوقت الفعلي. مناسب للاستشارات العليا والمفاوضات المعقدة وإدارة الأزمات حيث يزيد الذكاء الاصطناعي من الإمكانيات بدلاً من الاستبدال.</p>
  <h2>إعادة تصميم العملية هي العمل المخفي</h2>
  <p>نشر وكيل الذكاء الاصطناعي في عملية لم يتم إعادة تصميمها هو أكثر أنماط الفشل عالي التكلفة شيوعاً في اعتماد الذكاء الاصطناعي في القطاع العام. تحدد <em>حالة الذكاء الاصطناعي</em> من ماكينزي إعادة تصميم سير العمل كأكثر الممارسات ارتباطاً قوياً بتأثير EBIT قابل للقياس في القطاع الخاص (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">ماكينزي، 2024</a>). ينتقل النمط مباشرة إلى الإنتاجية في القطاع العام: وكيل يؤتمت عملية معطوبة ينتج إجابات خاطئة أسرع.</p>
  <p>يخضع إعادة تصميم العملية في سياقات القطاع العام لقيود لا يخضع لها القطاع الخاص — ولايات تنظيمية تحدد الخطوات بدلاً من النتائج، وهياكل المساءلة المضمنة في التسلسلات الهرمية للموافقة، والقواعد الخاصة بالخدمة المدنية بشأن إعادة تصميم الأدوار. لا شيء من هذا غير قابل للتخطي؛ كل منها يتطلب رعاية تنفيذية متعمدة لا يمكن تفويضها لفريق تسليم الذكاء الاصطناعي.</p>
  <h2>بعد السعودة والتوطين الإماراتي</h2>
  <p>يسرع الذكاء الاصطناعي الوكيل المنتشر بشكل صحيح من السعودة والتوطين بدلاً من تهديدهما. عندما ينتقل معالجة المستندات والاستفسارات الروتينية للمواطنين وإدارة القضايا إلى الوكيل، يمكن إعادة نشر المواطنين الذين تم استهلاكهم سابقاً بهذا العمل إلى الأدوار الاستشارية والإشرافية والعلاقات — بالضبط نوع العمل الذي يضيف قيمة وتتصوره رؤية 2030 والتقويم 2071 للمواطنين. هذا هو الإطار الذي نوصي به لأعضاء اللجان التنفيذية الذين يقيمون برامج القوى العاملة للذكاء الاصطناعي في حكومة دول مجلس التعاون الخليجي.</p>
  <h2>الأيام الـ 90 الأولى</h2>
  <ul>
  <li><strong>الأيام 1–30 — اختيار العملية والمحاذاة.</strong> اختر عملية واحدة محدودة: حجم عالي، مدفوعة بالسياسة، تستهلك حالياً وقت القوى العاملة الوطنية بشكل كبير. احصل على رعاية تنفيذية حقيقية، وليس مجرد موافقة. خريطة العملية الحالية قبل تصميم الحالة المستقبلية.</li>
  <li><strong>الأيام 31–60 — بناء التجربة الاختبارية والنشر المنضبط.</strong> بناء الوكيل ضد العملية المعروضة. نشر لمجموعة تجريبية من 10–20 موظف. جمع ملاحظات حول أداء الوكيل وتجربة الإنسان في العمل جنباً إلى جنب مع الوكيل.</li>
  <li><strong>الأيام 61–90 — التحسين وإعداد الحجم.</strong> إدراج الملاحظات. إعادة تصميم العملية المحيطة بناءً على ما كشفت عنه المجموعة التجريبية. تحضير مواد إدارة التغيير والتدريب. تحديد الحوكمة والإطار الرصد للإنتاج.</li>
  </ul>
  <h2>قياس التحول، وليس فقط الكفاءة</h2>
  <p>الوقت الموفر وتكلفة لكل معاملة مقاييس ضرورية، لكنها لا تعكس قيمة تحول القوى العاملة في القطاع العام. التدابير الأكثر أهمية هي جودة النتائج (هل القرارات أفضل؟) وتجربة الموظف (هل يقوم المواطنون بعمل أكثر معنى؟) وتجربة المواطن (هل تتحسن الخدمات العامة؟). المنظمات التي تتبع جميع الثلاثة ملتزمة أكثر بالنجاح على المدى الطويل — وأكثر احتمالاً لتحقيقه.</p>
  <h2>التوصيات</h2>
  <ul>
  <li>إطار برامج القوى العاملة للذكاء الاصطناعي الوكيل صراحة ضد رؤية 2030 / التقويم 2071، وليس ضد مقاييس الإنتاجية العامة.</li>
  <li>جعل إعادة تصميم العملية جزء عمل على مستوى مجلس الإدارة، وليس مسؤولية فريق التسليم.</li>
  <li>تعامل مع القيادة في الخدمة المدنية والموارد البشرية في البداية، وليس عند النشر.</li>
  <li>تتبع جودة النتائج وتجربة المواطن جنباً إلى جنب مع الكفاءة من اليوم الأول.</li>
  </ul>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>المنتدى الاقتصادي العالمي، <em>تقرير مستقبل الوظائف 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>رؤية المملكة العربية السعودية 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>وزارة الموارد البشرية والتنمية الاجتماعية بالمملكة. <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">hrsd.gov.sa</a></li>
  <li>وزارة الموارد البشرية والتوطين بالإمارات. <a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">mohre.gov.ae</a></li>
  <li>الإمارات 2071. <a href="https://u.ae/en/about-the-uae/strategies-initiatives-and-awards" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>ماكينزي، <em>حالة الذكاء الاصطناعي</em>، 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>ساما — القواعس والتعليمات. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>البنك المركزي لدولة الإمارات العربية المتحدة. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  <li>مبادئ منظمة التعاون الاقتصادي والتنمية للذكاء الاصطناعي. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>
      `,
      contentTr: `
  <h2>Tez</h2>
  <p>"Yapay zeka işleri alacak" çerçevesi, anlayıştan daha fazla kaygı üretmiştir. Daha faydalı çerçeve — ve GCC kamu sektörü yetkisine uygun olan — yapay zekanın <em>görevleri</em> alacağı, ve bu gerçeğin etrafında rolleri ve süreçleri yeniden tasarlayan GCC kamu sektörü kuruluşlarının bunu yapmayan kuruluşlardan daha üretken, daha çekici işverenler olacağı ve ulusal işgücü stratejileriyle daha iyi uyumlu olacağıdır. Dünya Ekonomik Forumu'nun <em>İşlerin Geleceği Raporu 2025</em>, işverenlerin %86'sının yapay zekanın 2030'a kadar işlerini dönüştüreceğini beklediğini ve en yüksek büyüme oranları olan rollerin yapay zeka yerine koyma değil, yapay zeka tamamlayıcılığını içerdiğini bulmuştur (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">WEF, 2025</a>).</p>
  <h2>GCC İşgücü Çerçevesi</h2>
  <p>Suudi Arabistan kamu sektörü kuruluşları için insan-yapay zeka işbirliği sorusu <em>Vizyon 2030</em>'un Suudileştirme hedefleriyle bağlantılıdır ve ekonomi genelinde Suudi vatandaşlarının belirli katılım oranlarını gerektirmektedir (<a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">Vizyon 2030</a>; <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">İnsan Kaynakları ve Sosyal Kalkınma Bakanlığı</a>). BAE için eşdeğer çerçeve <em>BAE Yüzyılsonu 2071</em> ve İnsan Kaynakları ve Emiratileştirme Bakanlığı tarafından yönetilen Emiratileştirme hedefleridir (<a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">MoHRE</a>). Her iki durumda da, yalnızca rutin rolleri ortadan kaldıran otomasyon ulusal politikaya karşı çalışır. Vatandaşları daha yüksek değerli danışmanlık, gözetim ve ilişki çalışmalarına yükselten otomasyon bunu destekler.</p>
  <h2>İnsan-Yapay Zeka İşbirliğinin Üç Modeli</h2>
  <h3>Model 1 — Yapay Zeka İşi Yapar, İnsan Gözden Geçirir</h3>
  <p>Ajan davayı başından sonuna yönetir; insan ajan tarafından işaretlenen kenar durumlarını gözden geçirir. Yüksek hacimli, politika odaklı kararlar için uygun; burada ajanın ölçülen doğruluğu yüksek ve bir hatanın maliyeti sınırlandırılmıştır.</p>
  <h3>Model 2 — Yapay Zeka Önerir, İnsan Karar Verir</h3>
  <p>Ajan bilgileri toplar, analiz eder ve önerir; insan son kararı verir. İnsan sorumluluğun yasal olarak gerekli olduğu veya yargı boyutlarının gerçekten karmaşık olduğu durumlarda uygun. SAMA ve CBUAE'nin önemli finansal kararlarla ilgili konumları kesin olarak bu modelde yer almaktadır (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>; <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>).</p>
  <h3>Model 3 — İnsan Öncülük Eder, Yapay Zeka Destekler</h3>
  <p>İnsan öncülük eder; ajan gerçek zamanlı bilgi ve analiz sağlar. Kıdemli danışmanlık, karmaşık müzakereler ve kriz yönetimi için uygun; burada yapay zeka yerine koyma yerine yeteneği artırır.</p>
  <h2>Süreç Yeniden Tasarımı Gizli İştir</h2>
  <p>Yapay zeka ajanını yeniden tasarlanmamış bir sürece yerleştirmek, GCC kamu sektörü yapay zeka benimsemesinde en yaygın yüksek maliyetli başarısızlık modudur. McKinsey'in <em>Yapay Zekanın Durumu</em> iş süreci yeniden tasarımını özel sektörde yapay zekadan ölçülebilir EBIT etkisiyle en güçlü şekilde ilişkili pratik olarak tanımlamaktadır (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>). Desen doğrudan GCC kamu sektörü üretkenliğine taşınır: kusurlu bir süreci otomatikleştiren ajan daha hızlı yanlış cevaplar üretir.</p>
  <p>GCC kamu sektörü bağlamlarında süreç yeniden tasarımı, özel sektörün olmadığı yollardan sınırlandırılmıştır — sonuçlar yerine adımları belirten düzenleyici görevler, onay hiyerarşilerine gömülü sorumluluk yapıları, rol yeniden tasarımı konusunda memurluk kuralları. Bunlardan hiçbiri aşılamaz değildir; tümü yapay zeka teslimat ekibine devredilemeyen kasıtlı üst düzey sponsorluğu gerektirir.</p>
  <h2>Suudileştirme ve Emiratileştirme Boyutu</h2>
  <p>Düzgün şekilde konuşlandırılmış agentic yapay zeka Suudileştirme ve Emiratileştirme hızlandırır — bunlara tehdit oluşturmaktan ziyade. Belge işleme, rutin vatandaş soruları ve dava yönetimi ajan tarafından alındığında, daha önce bu çalışma tarafından tüketilen vatandaşlar danışmanlık, gözetim ve ilişki rollerine yeniden yerleştirilebilirler — tam olarak Vizyon 2030 ve Yüzyılsonu 2071'in vatandaşlar için öngördüğü değer katacak çalışma türü. Bu, GCC hükümetinde yapay zeka işgücü programlarını değerlendiren yönetici komiteleri için önerdiğimiz çerçevedir.</p>
  <h2>İlk 90 Gün</h2>
  <ul>
  <li><strong>Günler 1–30 — Süreç seçimi ve uyumlaştırma.</strong> Tek bir sınırlı süreci seçin: yüksek hacim, politika odaklı, şu anda önemli ulusal işgücü zamanını tüketmektedir. Gerçek üst düzey sponsorluğu alın, sadece onay değil. Gelecek durumu tasarlamadan önce mevcut süreci eşleyin.</li>
  <li><strong>Günler 31–60 — Pilot inşa etme ve kontrollü dağıtım.</strong> Eşlenen süreçe karşı ajan inşa edin. 10–20 çalışandan oluşan bir pilot grubuna dağıtın. Hem ajan performansı hem de ajanla çalışmanın insani deneyimi hakkında geribildirim toplayın.</li>
  <li><strong>Günler 61–90 — İyileştirme ve ölçek hazırlığı.</strong> Geri bildirimi birleştirin. Pilot ortaya koyan şeye dayalı olarak çevreleyen süreci yeniden tasarlayın. Değişim yönetimi ve eğitim materyalleri hazırlayın. Üretim için yönetişim ve izleme çerçevesini tanımlayın.</li>
  </ul>
  <h2>Dönüşüm Ölçümü, Yalnızca Verimlilik Değil</h2>
  <p>Tasarruf edilen zaman ve işlem başına maliyet gerekli metriklerdir, ancak GCC kamu sektörü işgücü dönüşümünün değerini yakalamaz. Daha önemli ölçüler sonuç kalitesi (kararlar daha iyi mi?), çalışan deneyimi (vatandaşlar daha anlamlı çalışma yapıyor mu?) ve vatandaş deneyimi (kamu hizmetleri geliştiriliyor mu?). Her üçünü de izleyen kuruluşlar uzun vadeli başarıya daha çok kararlıdır — ve bunu başarma olasılığı daha yüksektir.</p>
  <h2>Öneriler</h2>
  <ul>
  <li>Agentic yapay zeka işgücü programlarını açıkça Vizyon 2030 / Yüzyılsonu 2071'e karşı çerçevelendirin, genel üretkenlik metriklerine karşı değil.</li>
  <li>Süreç yeniden tasarımını teslimat takımı sorumluluğu değil, yönetim kurulu düzeyinde çalışma akışı yapın.</li>
  <li>Sivil hizmet ve İK liderliğini dağıtımda değil başlangıçta katılımcı yapın.</li>
  <li>Birinci günden itibaren sonuç kalitesi ve vatandaş deneyimini verimlilik yanında izleyin.</li>
  </ul>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>Dünya Ekonomik Forumu, <em>İşlerin Geleceği Raporu 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>Suudi Arabistan Vizyon 2030. <a href="https://www.vision2030.gov.sa/" target="_blank" rel="noopener noreferrer">vision2030.gov.sa</a></li>
  <li>KSA İnsan Kaynakları ve Sosyal Kalkınma Bakanlığı. <a href="https://www.hrsd.gov.sa/" target="_blank" rel="noopener noreferrer">hrsd.gov.sa</a></li>
  <li>BAE İnsan Kaynakları ve Emiratileştirme Bakanlığı. <a href="https://www.mohre.gov.ae/" target="_blank" rel="noopener noreferrer">mohre.gov.ae</a></li>
  <li>BAE Yüzyılsonu 2071. <a href="https://u.ae/en/about-the-uae/strategies-initiatives-and-awards" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>McKinsey, <em>Yapay Zekanın Durumu</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>SAMA — Kurallar ve Talimatlar. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>Birleşik Arap Emirlikleri Merkez Bankası. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  <li>OECD Yapay Zeka İlkeleri. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>
      `,
    },
    {
      id: "cdo-to-cao",
      slug: "cdo-to-cao",
      title: "From CDO to CAO: Rethinking the Chief Data Officer Role in the Age of AI",
      category: "Data & Governance",
      type: "Opinion",
      date: "Updated May 2026",
      readTime: "10 min read",
      author: "Alper Kulak, Founding Partner",
      coverImage: "/images/report-6.png",
      summary: "The Chief Data Officer mandate was built for the data-warehousing era. Three converging pressures — board-level AI accountability, regulatory frameworks, and short historical CDO tenure — make the case for elevating the role to a Chief AI/Analytics Officer with the authority the new mandate requires.",
      featured: false,
      tags: ["Leadership", "CDO", "CAO", "Data Strategy"],
      content: `
  <h2>Thesis</h2>
  <p>The Chief Data Officer role was designed for the data-warehousing and master-data era. The mandate organizations actually need now is different: someone accountable for activating data as AI infrastructure, building the governance to deploy autonomous systems safely, and owning the productivity outcomes that follow. Whether the title becomes Chief AI Officer, Chief Analytics Officer, or simply an expanded CDO mandate matters less than whether the organisational authority and the technical depth move with it. This piece sets out what the new role actually demands — and how to staff it in the GCC context, where the talent market is genuinely thin.</p>
  <h2>Where the Pressure Is Coming From</h2>
  <p>Three converging trends are making the traditional CDO role insufficient. First, AI-related responsibilities are now showing up at board level — McKinsey's <em>State of AI</em> finds that the C-suite is increasingly held accountable for AI risk and value capture (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>). Second, AI governance frameworks — UAE PDPL, Saudi PDPL, NIST AI RMF, and the EU AI Act as a reference standard — require an executive accountable end-to-end for AI risk (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>; <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">EU AI Act</a>). Third, the average tenure of CDOs has historically been short — Gartner's research has consistently shown CDO tenure averaging well below comparable C-suite roles, a signal that the original mandate is structurally hard to discharge (<a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">Gartner CDAO research</a>).</p>
  <h2>What the New Mandate Demands</h2>
  <ul>
  <li><strong>From data governance to AI governance.</strong> Beyond data quality: model risk, agent behaviour, automated-decision ethics.</li>
  <li><strong>From data platforms to AI infrastructure.</strong> Vector stores, retrieval pipelines, context management, inference infrastructure — the substrate agents actually run on.</li>
  <li><strong>From internal service to commercial capability.</strong> Treating data and AI as a source of competitive advantage and, in the GCC, sovereign capability.</li>
  <li><strong>From reporting to acting.</strong> Moving from data products (dashboards, reports) to AI products (agents, automated processes) that do work, not just describe it.</li>
  </ul>
  <h2>The GCC Organisational Argument</h2>
  <p>In financial services especially, SAMA and CBUAE expectations now create board-level accountability for AI risk (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>; <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>). A CDO positioned two or three levels below the board cannot credibly discharge that accountability. The CAO mandate — on the executive committee with a direct line to the CEO — can. This is the structural case for elevation, distinct from any specific individual's capability.</p>
  <h2>Talent Reality in the GCC</h2>
  <p>The CDO talent market in the GCC has matured; there is now a reasonable supply of experienced data-governance and platform leaders. The CAO market is structurally thin. Organisations seeking a fully-formed CAO with depth in AI governance, agent architecture, inference infrastructure, and organisational change will find very few candidates. The pragmatic conclusion is that most organisations will need to develop the CAO from inside the data function — and that the institutions that began investing in AI-governance capability in 2023–2024 are the ones now well-positioned to elevate that leader. WEF's <em>Future of Jobs 2025</em> documents AI-related skills as among the top growing skill demands globally, and the supply gap in MENA is wider than the global average (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">WEF, 2025</a>).</p>
  <h2>What the Transition Requires</h2>
  <p>Expanded scope requires expanded authority. CDOs who have spent their careers as internal service providers will find the CAO mandate uncomfortable: it requires the authority to say no to AI deployments that fail governance standards, to retire AI systems that are not performing, and to make architectural decisions that affect every business unit. The organisations that have made the transition successfully share a pattern: they invested in board-level AI-governance education before changing the mandate, ensuring that the conversations the CAO needed to have were welcomed rather than resisted.</p>
  <h2>Recommendations</h2>
  <ul>
  <li>Assess the current CDO honestly against the new mandate. Title change without genuine investment in capability fails predictably.</li>
  <li>Define the CAO's authority before appointing. The most common reason new appointments fail is missing organisational authority.</li>
  <li>Set a 24-month transition timeline. The incumbent must maintain existing data-governance responsibilities while building new AI capabilities.</li>
  <li>Invest in board-level AI-governance education in parallel with the role redesign.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>McKinsey, <em>State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Gartner — Chief Data &amp; Analytics Officer research. <a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>EU AI Act — Regulation 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
  <li>SAMA — Rules &amp; Instructions. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
  <li>Central Bank of the UAE. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
  <li>UAE PDPL (Federal Decree-Law No. 45 of 2021). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
  <li>SDAIA — Saudi PDPL. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
  <li>WEF, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  </ol>
      `,
      contentAr: `
    <h2>الأطروحة</h2>
    <p>دور كبير مسؤولي البيانات تم تصميمه في عصر المستودعات والبيانات الرئيسية. الولاية التي تحتاجها المنظمات فعلياً الآن مختلفة: شخص مسؤول عن تفعيل البيانات كبنية تحتية للذكاء الاصطناعي، وبناء الحوكمة لنشر الأنظمة المستقلة بأمان، والمسؤولية عن نواتج الإنتاجية التي تتبع ذلك. سواء أصبح العنوان كبير مسؤولي الذكاء الاصطناعي أو كبير مسؤولي التحليلات أو ببساطة ولاية كبير مسؤولي البيانات الموسعة، الأمر الأقل أهمية من أن تنتقل السلطة التنظيمية والعمق التقني معها. تحدد هذه الوثيقة ما تتطلبه الولاية الجديدة فعلياً — وكيفية تعيينها في سياق دول مجلس التعاون الخليج، حيث أن سوق المواهب رقيقة حقاً.</p>
    <h2>من أين يأتي الضغط</h2>
    <p>ثلاثة اتجاهات متقاربة تجعل دور كبير مسؤولي البيانات التقليدي غير كافٍ. أولاً، المسؤوليات المتعلقة بالذكاء الاصطناعي تظهر الآن على مستوى مجلس الإدارة — تجد ماكينزي في دراسة <em>State of AI</em> أن الإدارة العليا تتحمل مسؤولية متزايدة عن مخاطر الذكاء الاصطناعي واستيعاب القيمة (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">ماكينزي، 2024</a>). ثانياً، أطر الحوكمة — قانون حماية البيانات الشخصية الإماراتي وقانون حماية البيانات الشخصية السعودي و NIST AI RMF والاتحاد الأوروبي قانون الذكاء الاصطناعي كمعيار مرجعي — تتطلب مسؤولاً تنفيذياً مسؤولاً من البداية إلى النهاية عن مخاطر الذكاء الاصطناعي (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>; <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">قانون الاتحاد الأوروبي للذكاء الاصطناعي</a>). ثالثاً، متوسط مدة خدمة كبار مسؤولي البيانات كان دائماً قصيراً — أبحاث جارتنر أظهرت باستمرار أن متوسط مدة خدمة كبير مسؤولي البيانات يقل عن الأدوار المماثلة في الإدارة العليا، وهي إشارة إلى أن الولاية الأصلية صعبة البناء هيكلياً (<a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">بحث جارتنر CDAO</a>).</p>
    <h2>ما تتطلبه الولاية الجديدة</h2>
    <ul>
    <li><strong>من حوكمة البيانات إلى حوكمة الذكاء الاصطناعي.</strong> ما وراء جودة البيانات: مخاطر النماذج وسلوك الوكلاء الذكية والأخلاقيات الموحدة للقرارات.</li>
    <li><strong>من منصات البيانات إلى البنية التحتية للذكاء الاصطناعي.</strong> متاجر المتجهات وأنابيب الاسترجاع وإدارة السياق والبنية التحتية للاستدلال — الركيزة التي تعمل عليها الوكلاء الذكية فعلياً.</li>
    <li><strong>من الخدمة الداخلية إلى القدرة التجارية.</strong> معاملة البيانات والذكاء الاصطناعي كمصدر لميزة تنافسية وفي دول مجلس التعاون الخليج، قدرة سيادية.</li>
    <li><strong>من التقارير إلى العمل.</strong> الانتقال من منتجات البيانات (لوحات المعلومات والتقارير) إلى منتجات الذكاء الاصطناعي (الوكلاء والعمليات الآلية) التي تنجز العمل، وليس فقط تصفه.</li>
    </ul>
    <h2>الحجة التنظيمية لدول مجلس التعاون الخليج</h2>
    <p>في الخدمات المالية خاصة، توقعات ساما ومصرف الإمارات المركزي تخلق الآن المسؤولية على مستوى مجلس الإدارة عن مخاطر الذكاء الاصطناعي (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">ساما</a>; <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">مصرف الإمارات المركزي</a>). كبير مسؤول البيانات الموضوع على مستويين أو ثلاثة مستويات تحت مجلس الإدارة لا يمكنه تحمل تلك المسؤولية بمصداقية. يمكن لولاية كبير مسؤول الذكاء الاصطناعي — في اللجنة التنفيذية برابط مباشر إلى الرئيس التنفيذي. هذه هي الحالة الهيكلية للترقية، مختلفة عن قدرات أي فرد محدد.</p>
    <h2>واقع المواهب في دول مجلس التعاون الخليج</h2>
    <p>سوق المواهب لكبار مسؤولي البيانات في دول مجلس التعاون الخليج نضج؛ هناك الآن عرض معقول من قادة حوكمة البيانات والمنصات ذوي الخبرة. سوق كبار مسؤولي الذكاء الاصطناعي رقيق هيكلياً. المنظمات التي تسعى إلى كبير مسؤول ذكاء اصطناعي متشكل بالكامل مع عمق في حوكمة الذكاء الاصطناعي وعمارة الوكلاء والبنية التحتية للاستدلال والتغيير التنظيمي سوف تجد عدداً قليلاً جداً من المرشحين. الاستنتاج العملي هو أن معظم المنظمات سوف تحتاج إلى تطوير كبير مسؤول الذكاء الاصطناعي من داخل وظيفة البيانات — وأن المؤسسات التي بدأت الاستثمار في قدرة حوكمة الذكاء الاصطناعي في 2023–2024 هي تلك التي تتمتع الآن بموقع جيد للترقية لهذا القائد. وثيقة WEF's <em>Future of Jobs 2025</em> تسجل المهارات المرتبطة بالذكاء الاصطناعي كواحدة من أعلى الطلبات على المهارات الناشئة عالمياً، وفجوة الإمداد في منطقة الشرق الأوسط وشمال أفريقيا أوسع من المتوسط العالمي (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">WEF، 2025</a>).</p>
    <h2>ما يتطلبه الانتقال</h2>
    <p>النطاق الموسع يتطلب سلطة موسعة. كبار مسؤولي البيانات الذين أمضوا حياتهم المهنية كمزودي خدمات داخليين سوف يجدون ولاية كبير مسؤول الذكاء الاصطناعي مريحة: تتطلب السلطة للقول لا لنشرات الذكاء الاصطناعي التي تفشل معايير الحوكمة، وإلغاء أنظمة الذكاء الاصطناعي التي لا تعمل، واتخاذ قرارات معمارية تؤثر على كل وحدة أعمال. المنظمات التي أنجزت الانتقال بنجاح تشارك نمطاً: استثمرت في التعليم على مستوى مجلس الإدارة حول حوكمة الذكاء الاصطناعي قبل تغيير الولاية، مما يضمن أن المحادثات التي احتاج كبير مسؤول الذكاء الاصطناعي إلى إجرائها كانت مرحباً بها وليس مقاومة.</p>
    <h2>التوصيات</h2>
    <ul>
    <li>قيم كبير مسؤول البيانات الحالي بصراحة مقابل الولاية الجديدة. تغيير العنوان بدون استثمار حقيقي في القدرة يفشل بشكل قابل للتنبؤ.</li>
    <li>حدد سلطة كبير مسؤول الذكاء الاصطناعي قبل التعيين. السبب الأكثر شيوعاً لفشل التعيينات الجديدة هو غياب السلطة التنظيمية.</li>
    <li>ضع جدول زمني للانتقال لمدة 24 شهراً. يجب على الموظف الحالي الحفاظ على مسؤوليات حوكمة البيانات الحالية مع بناء قدرات الذكاء الاصطناعي الجديدة.</li>
    <li>استثمر في التعليم على مستوى مجلس الإدارة حول حوكمة الذكاء الاصطناعي بالتوازي مع إعادة تصميم الدور.</li>
    </ul>
    <h2>المصادر والمراجع</h2>
    <ol class="sources-list">
    <li>ماكينزي، <em>State of AI</em>، 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
    <li>جارتنر — Chief Data & Analytics Officer research. <a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
    <li>NIST، <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
    <li>قانون الاتحاد الأوروبي للذكاء الاصطناعي — Regulation 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
    <li>ساما — Rules & Instructions. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
    <li>مصرف الإمارات المركزي. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
    <li>UAE PDPL (Federal Decree-Law No. 45 of 2021). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
    <li>سدايا — Saudi PDPL. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
    <li>WEF، <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
    </ol>
        
  `,
      contentTr: `
    <h2>Tez</h2>
    <p>Başkan Veri Görevlisi rolü veri depolama ve ana veri çağı için tasarlanmıştır. Kuruluşların şu anda gerçekten ihtiyaç duyduğu görev farklıdır: veriyi yapay zeka altyapısı olarak etkinleştirmekten sorumlu biri, otonom sistemleri güvenle dağıtmak için yönetişim oluşturma ve bunu takip eden verimlilik sonuçlarının sahibi. Başlık Başkan Yapay Zeka Görevlisi, Başkan Analitik Görevlisi olsun veya basitçe genişletilmiş Başkan Veri Görevlisi yetkisi olsun, örgütsel yetkinin ve teknik derinliğin bununla hareket etmesinden daha az önemlidir. Bu belge yeni rolün gerçekten ne talep ettiğini — ve GCC bağlamında bunu nasıl yapılandıracağını ortaya koymaktadır; burada yetenek pazarı gerçekten sınırlıdır.</p>
    <h2>Baskı Nereden Geliyor</h2>
    <p>Üç yakınsayan eğilim, geleneksel Başkan Veri Görevlisi rolünü yetersiz kılmaktadır. Birincisi, yapay zeka ile ilgili sorumluluklar şu anda yönetim kurulu düzeyinde ortaya çıkmaktadır — McKinsey's <em>State of AI</em>, C-suite'in yapay zeka riski ve değer yakalama için giderek daha fazla sorumlu tutulduğunu bulmuştur (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>). İkincisi, yapay zeka yönetişim çerçeveleri — UAE PDPL, Saudi PDPL, NIST AI RMF ve AB Yapay Zeka Yasası referans standardı olarak — yapay zeka riskinden baştan sona sorumlu bir yöneticiyi gerektirir (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>; <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">AB Yapay Zeka Yasası</a>). Üçüncüsü, Başkan Veri Görevlilerinin ortalama görev süresi tarihsel olarak kısa olmuştur — Gartner'ın araştırması tutarlı olarak Başkan Veri Görevlilerinin ortalama görev süresinin karşılaştırılabilir C-suite rollerinden daha kısa olduğunu göstermiştir; bu da orijinal görevin yapısal olarak işletilmesinin zor olduğunun bir göstergesidir (<a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">Gartner CDAO araştırması</a>).</p>
    <h2>Yeni Görev Ne Talep Ediyor</h2>
    <ul>
    <li><strong>Veri yönetişiminden yapay zeka yönetişimine.</strong> Veri kalitesinin ötesinde: model riski, ajan davranışı, otomatikleştirilmiş karar etiği.</li>
    <li><strong>Veri platformlarından yapay zeka altyapısına.</strong> Vektör depoları, geri çekme boru hatları, bağlam yönetimi, çıkarım altyapısı — ajanların gerçekten çalıştığı alt yapı.</li>
    <li><strong>İç hizmetten ticari yeteneğe.</strong> Veriyi ve yapay zekai rekabet avantajının kaynağı olarak ve GCC'de egemen yetenek olarak ele almak.</li>
    <li><strong>Raporlamadan eyleme.</strong> Veri ürünlerinden (panolar, raporlar) yapay zeka ürünlerine (ajanlar, otomatikleştirilmiş işlemler) hareket — sadece tanımlayan değil, işi yapan.</li>
    </ul>
    <h2>GCC Örgütsel Argümanı</h2>
    <p>Özellikle finansal hizmetlerde SAMA ve CBUAE beklentileri şu anda yapay zeka riski için yönetim kurulu düzeyinde sorumluluğu oluşturmaktadır (<a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">SAMA</a>; <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">CBUAE</a>). Yönetim kurulunun iki veya üç seviyeleri altına yerleştirilen bir Başkan Veri Görevlisi bu sorumluluğu inandırıcı bir şekilde yerine getiremez. Başkan Yapay Zeka Görevlisi yetkisi — yönetim kurulunda CEO'ya doğrudan bağlantı ile — olabilir. Bu, herhangi bir bireyin yeteneğinden farklı olan yapısal yükseltme durumudur.</p>
    <h2>GCC'de Yetenek Gerçekliği</h2>
    <p>GCC'deki Başkan Veri Görevlisi yetenek pazarı olgunlaşmıştır; şimdi deneyimli veri yönetişimi ve platform liderlerinin makul bir arzı vardır. Başkan Yapay Zeka Görevlisi pazarı yapısal olarak sınırlıdır. Yapay zeka yönetişimi, ajan mimarisi, çıkarım altyapısı ve örgütsel değişikte derinlik ile tamamen oluşturulmuş bir Başkan Yapay Zeka Görevlisi arayan kuruluşlar çok az aday bulacaktır. Pratik sonuç, çoğu kuruluşun Başkan Yapay Zeka Görevlisini veri işlevi içinden geliştirmesi gerektiğidir — ve 2023–2024'te yapay zeka yönetişimi yeteneğine yatırım yapmaya başlayan kurumlar şu anda bu lideri yükseltmek için iyi konumlandırılmıştır. WEF's <em>Future of Jobs 2025</em>, yapay zeka ile ilgili becerileri küresel olarak en hızlı büyüyen beceri taleplerinin başında belgelemektedir ve MENA'da tedarik açığı küresel ortalamadan daha geniştir (<a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">WEF, 2025</a>).</p>
    <h2>Geçiş Ne Gerektirir</h2>
    <p>Genişletilmiş kapsam genişletilmiş yetki gerektirir. Kariyerlerini iç hizmet sağlayıcı olarak geçiren Başkan Veri Görevlileri Başkan Yapay Zeka Görevlisi görevini rahatsız edici bulacaklardır: yönetişim standartlarında başarısız olan yapay zeka dağıtımlarına hayır deme, çalışmayan yapay zeka sistemlerini devre dışı bırakma ve her işletme birimini etkileyen mimari kararlar alma yetkisi gerektirir. Geçişi başarıyla yapan kuruluşlar bir desen paylaşır: görev değiştirilmeden önce yönetim kurulu düzeyinde yapay zeka yönetişimi eğitimine yatırım yaptılar; bu, Başkan Yapay Zeka Görevlisinin yapması gereken konuşmaların karşılandığından emin olmak yerine direnç görmedi.</p>
    <h2>Öneriler</h2>
    <ul>
    <li>Mevcut Başkan Veri Görevlisini yeni görev karşısında dürüstçe değerlendirin. Yetkide gerçek yatırım olmaksızın başlık değişikliği öngörülebilir şekilde başarısız olur.</li>
    <li>Başkan Yapay Zeka Görevlisinin yetkilendirmesini tanımlamadan önce tanımlayın. Yeni atamaların başarısız olmasının en yaygın nedeni örgütsel yetkinin eksikliğidir.</li>
    <li>24 aylık bir geçiş zaman çizelgesi belirleyin. Mevcut görevli, yeni yapay zeka yetenekleri geliştirirken mevcut veri yönetişimi sorumluluklarını korumalıdır.</li>
    <li>Rol yeniden tasarımı ile paralel olarak yönetim kurulu düzeyinde yapay zeka yönetişimi eğitimine yatırım yapın.</li>
    </ul>
    <h2>Kaynaklar ve Referanslar</h2>
    <ol class="sources-list">
    <li>McKinsey, <em>State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
    <li>Gartner — Chief Data & Analytics Officer research. <a href="https://www.gartner.com/en/information-technology/role/data-analytics-leaders" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
    <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
    <li>AB Yapay Zeka Yasası — Regulation 2024/1689. <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj" target="_blank" rel="noopener noreferrer">eur-lex.europa.eu</a></li>
    <li>SAMA — Rules & Instructions. <a href="https://www.sama.gov.sa/en-US/RulesInstructions/Pages/default.aspx" target="_blank" rel="noopener noreferrer">sama.gov.sa</a></li>
    <li>Central Bank of the UAE. <a href="https://www.centralbank.ae/" target="_blank" rel="noopener noreferrer">centralbank.ae</a></li>
    <li>UAE PDPL (Federal Decree-Law No. 45 of 2021). <a href="https://u.ae/en/about-the-uae/digital-uae/data/data-protection-laws" target="_blank" rel="noopener noreferrer">u.ae</a></li>
    <li>SDAIA — Saudi PDPL. <a href="https://sdaia.gov.sa/en/SDAIA/about/Pages/Regulations.aspx" target="_blank" rel="noopener noreferrer">sdaia.gov.sa</a></li>
    <li>WEF, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
    </ol>
        
  `,
    },
    {
      id: "sovereign-ai",
      slug: "sovereign-ai",
      title: "Sovereign Agentic AI: A Technical Architecture for GCC National Security",
      category: "Sovereign AI",
      type: "Technical Brief",
      date: "Updated May 2026",
      readTime: "12 min read",
      author: "Gokhan Dagli, Founding Partner",
      coverImage: "/images/report-7.png",
      summary: "A practical architecture for sovereign agentic AI — five principles, the Falcon/Jais open-weight stack, the regional sovereign-cloud anchors (G42, HUMAIN), and the procurement realities created by US export-control rules including the 2025 AI Diffusion Framework.",
      featured: false,
      tags: ["Sovereign AI", "National Security", "On-Prem", "Architecture"],
      content: `
  <h2>Thesis</h2>
  <p>For GCC national-security clients, intelligence services, and critical-infrastructure operators, the question is not whether to adopt AI but whether AI can be adopted without compromising the sovereignty, security, and secrecy that the mission requires. The answer is yes — but only with a sovereign-first architecture, the right open-weight model stack, and a delivery partner with the capability to execute inside the secure perimeter. This brief sets out the architectural principles and the available regional infrastructure that make sovereign agentic AI deliverable today.</p>
  <h2>Five Architectural Principles</h2>
  <h3>1. Model Sovereignty</h3>
  <p>The model itself must be controlled by the client. In practice this means open-weight models on client-controlled infrastructure — Meta's Llama family (<a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">Llama</a>), Mistral (<a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral</a>), TII's Falcon family from Abu Dhabi (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>), or Inception/G42's Arabic-capable Jais (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). API-only models from major US providers are excluded from sovereign use cases by definition.</p>
  <h3>2. Inference Isolation</h3>
  <p>Inference must occur entirely inside the secure perimeter. This requires on-prem GPU infrastructure capable of serving the chosen model at production latency and throughput.</p>
  <h3>3. Context Segmentation</h3>
  <p>Retrieved documents, conversation history, and tool outputs must be stored and retrieved entirely inside the perimeter, with strict access controls matched to the classification of the underlying data.</p>
  <h3>4. Audit &amp; Observability</h3>
  <p>Every action taken by the agent must be logged, attributable, and forensically auditable — inside the secure environment, with no log data leaving the perimeter. The observability infrastructure must itself be classified at the appropriate level. NIST's AI RMF is a useful structuring reference for the controls (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>).</p>
  <h3>5. Sovereignty Preservation Through Upgrade</h3>
  <p>The pace of capability development creates pressure to upgrade frequently; the security requirements of sovereign environments create pressure to change slowly. Managing that tension through a structured security-review process for AI updates is one of the most consequential ongoing governance disciplines in sovereign operations.</p>
  <h2>The Hardware Reality</h2>
  <p>NVIDIA H100 and H200 clusters remain the gold standard for sovereign LLM inference at scale. US export-control rules — including the AI Diffusion Framework published in January 2025 — directly affect availability and procurement timelines for advanced GPUs in the GCC, and require careful procurement planning (<a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">US Bureau of Industry &amp; Security, AI Diffusion Framework, 2025</a>). NVIDIA's L40S and L4 product line offers a more accessible footprint suitable for purpose-built agents that can be right-sized to specific tasks. Regional sovereign-cloud options — anchored by G42's infrastructure in the UAE and HUMAIN under PIF in Saudi Arabia — provide cloud-like operational simplicity while keeping data inside the relevant jurisdiction (<a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">G42</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>Open-Weight Model Selection for Arabic-Capable Sovereign Workloads</h2>
  <p>For Arabic-language use cases — which dominate in the GCC sovereign context — Jais and the Falcon Arabic-tuned variants are now credible production-grade options (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>; <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>). Both publish weights under licences that permit on-prem deployment without external dependencies; both have been benchmarked against major closed Arabic models with competitive results in the published evaluations.</p>
  <h2>Illustrative Engagement Shape</h2>
  <p>A representative shape of this work — drawn from the patterns we see in GCC sovereign engagements, presented as a hypothetical to protect confidentiality — looks like a sovereign agentic system for classified-document analysis: open-weight Arabic-capable model fine-tuned on declassified domain documents, retrieval over a permission-aware vector store, observability inside the secure perimeter, and a delivery footprint of senior engineers operating entirely inside the client's environment. Timeline from architecture through operational deployment is typically 6–12 months depending on classification regime and infrastructure readiness.</p>
  <h2>Recommendations</h2>
  <ul>
  <li><strong>Architect for sovereignty from day one.</strong> Retrofitting sovereign architecture onto a system originally designed for public cloud is structurally more expensive and disruptive than building sovereign-first.</li>
  <li><strong>Evaluate open-weight models systematically before selecting an architecture.</strong> The sovereign model landscape is moving fast; a structured evaluation against your specific use case — including Arabic performance and hardware footprint — pays back many times over.</li>
  <li><strong>Plan observability infrastructure with the same rigour as the AI infrastructure.</strong> Sovereign audit and governance requirements are as complex as the technical requirements.</li>
  <li><strong>Plan procurement around US export-control timelines.</strong> The AI Diffusion Framework and prior controls materially affect availability of advanced GPUs in the GCC.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>US Bureau of Industry &amp; Security, <em>Framework for Artificial Intelligence Diffusion</em>, January 2025. <a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">federalregister.gov</a></li>
  <li>TII — Falcon LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42) — Jais. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org/jais</a></li>
  <li>Meta — Llama. <a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">ai.meta.com/llama</a></li>
  <li>Mistral AI. <a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">mistral.ai</a></li>
  <li>G42. <a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">g42.ai</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>Microsoft &amp; G42 Strategic Investment, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>NVIDIA — Data Center GPU portfolio. <a href="https://www.nvidia.com/en-us/data-center/" target="_blank" rel="noopener noreferrer">nvidia.com</a></li>
  </ol>
      `,
      contentAr: `
  <h2>الرؤية</h2>
  <p>بالنسبة لعملاء الأمن القومي بدول مجلس التعاون الخليج، والأجهزة الاستخباراتية، وشركات البنية التحتية الحرجة، فإن السؤال ليس ما إذا كان يجب اعتماد الذكاء الاصطناعي، بل ما إذا كان يمكن اعتماده دون المساس بالسيادة والأمان والسرية التي تتطلبها المهمة. والإجابة هي نعم — لكن فقط من خلال معمارية تعطي الأولوية للسيادة، ومجموعة النماذج المفتوحة الصحيحة، وشريك تسليم لديه القدرة على التنفيذ داخل المحيط الآمن. يحدد هذا الموجز المبادئ المعمارية والبنية التحتية الإقليمية المتاحة التي تجعل الذكاء الاصطناعي الموكل السيادي قابلاً للتسليم اليوم.</p>
  <h2>المبادئ المعمارية الخمسة</h2>
  <h3>1. سيادة النموذج</h3>
  <p>يجب أن يكون النموذج نفسه خاضعاً للسيطرة من قبل العميل. في الممارسة العملية يعني هذا نماذج مفتوحة الأوزان على البنية التحتية التي يتحكم بها العميل — عائلة Llama من Meta (<a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">Llama</a>)، Mistral (<a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral</a>)، عائلة Falcon من TII من أبوظبي (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>)، أو Jais القادر على اللغة العربية من Inception/G42 (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). يتم استبعاد النماذج التي تعتمد على واجهات برمجية فقط من مزودي الخدمات الأمريكيين الكبار من حالات الاستخدام السيادية بحكم التعريف.</p>
  <h3>2. عزل الاستدلال</h3>
  <p>يجب أن يحدث الاستدلال بالكامل داخل المحيط الآمن. يتطلب هذا بنية تحتية GPU في الموقع قادرة على خدمة النموذج المختار بزمن انتقال الإنتاج والإنتاجية.</p>
  <h3>3. تقسيم السياق</h3>
  <p>يجب تخزين وواسترجاع المستندات المسترجعة وسجل المحادثة ومخرجات الأدوات بالكامل داخل المحيط، مع ضوابط وصول صارمة تطابق تصنيف البيانات الأساسية.</p>
  <h3>4. التدقيق والرصد</h3>
  <p>يجب تسجيل كل إجراء يتخذه الوكيل، وإسناده، والتحقق منه بشكل شرعي — داخل البيئة الآمنة، دون انتقال بيانات السجل خارج المحيط. يجب أن تصنف البنية التحتية للرصد نفسها على المستوى المناسب. إطار NIST لإدارة مخاطر الذكاء الاصطناعي هو مرجع مفيد لهيكلة الضوابط (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>).</p>
  <h3>5. الحفاظ على السيادة من خلال الترقية</h3>
  <p>يخلق نمو القدرات الضغط للترقية بشكل متكرر؛ متطلبات الأمان في البيئات السيادية تخلق ضغطاً للتغيير ببطء. إدارة هذا التوتر من خلال عملية مراجعة أمان منظمة لتحديثات الذكاء الاصطناعي هي واحدة من أهم تخصصات الحوكمة الجارية في العمليات السيادية.</p>
  <h2>واقع الأجهزة</h2>
  <p>تظل مجموعات NVIDIA H100 و H200 المعيار الذهبي للاستدلال بـ LLM السيادي على نطاق واسع. قواعد التحكم بالصادرات الأمريكية — بما في ذلك إطار نشر الذكاء الاصطناعي المنشور في يناير 2025 — تؤثر مباشرة على التوفر والجداول الزمنية للشراء للمعالجات الرسومية المتقدمة في دول مجلس التعاون الخليج، وتتطلب تخطيطاً شراء دقيقاً (<a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">US Bureau of Industry &amp; Security, AI Diffusion Framework, 2025</a>). تقدم خط منتجات NVIDIA L40S و L4 بصمة أكثر سهولة في الوصول مناسبة للوكلاء المبنيين بغرض معين التي يمكن مواءمتها لمهام محددة. خيارات السحابة السيادية الإقليمية — مرساة بقوة من خلال البنية التحتية لـ G42 في الإمارات وHUMAIN تحت PIF في المملكة العربية السعودية — توفر بساطة تشغيلية تشبه السحابة مع الحفاظ على البيانات داخل الولاية القضائية ذات الصلة (<a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">G42</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>اختيار نموذج مفتوح الأوزان للأحمال العملية السيادية القادرة على اللغة العربية</h2>
  <p>بالنسبة لحالات استخدام اللغة العربية — التي تهيمن في السياق السيادي بدول مجلس التعاون الخليج — يعتبر Jais والمتغيرات المضبوطة الخاصة بـ Falcon الآن خيارات موثوقة لمستوى الإنتاج (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>; <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>). ينشر كلاهما الأوزان تحت تراخيص تسمح بالنشر في الموقع دون تبعيات خارجية؛ تم قياس كلاهما مقابل نماذج عربية مغلقة رئيسية مع نتائج تنافسية في التقييمات المنشورة.</p>
  <h2>شكل المشاركة التوضيحي</h2>
  <p>شكل تمثيلي لهذا العمل — مستخلص من الأنماط التي نراها في التعاقدات السيادية بدول مجلس التعاون الخليج، مقدم كافتراضي لحماية السرية — يبدو وكأنه نظام موكل سيادي لتحليل المستندات المصنفة: نموذج مفتوح الأوزان قادر على اللغة العربية معبأ بدقة على المستندات المجال مصرح بها، استرجاع على متجر متجهات يدرك الأذونات، الرصد داخل المحيط الآمن، وبصمة تسليم من مهندسي كبار يعملون بالكامل داخل بيئة العميل. الجدول الزمني من المعمارية من خلال النشر التشغيلي عادة ما يكون 6-12 شهراً حسب نظام التصنيف وجاهزية البنية التحتية.</p>
  <h2>التوصيات</h2>
  <ul>
  <li><strong>العمارة من أجل السيادة من اليوم الأول.</strong> إعادة تركيب معمارية السيادة على نظام تم تصميمه في الأصل للسحابة العامة هو أكثر تكلفة وتعطيلاً من حيث الهيكل من البناء المركز للسيادة أولاً.</li>
  <li><strong>تقييم نماذج مفتوحة الأوزان بشكل منهجي قبل اختيار معمارية.</strong> ينتقل منظر النموذج السيادي بسرعة؛ التقييم المنظم مقابل حالة الاستخدام المحددة الخاصة بك — بما في ذلك الأداء العربي والبصمة الجهازية — يؤتي ثماره عدة مرات.</li>
  <li><strong>الخطة البنية التحتية للرصد بنفس الدقة كما البنية التحتية للذكاء الاصطناعي.</strong> متطلبات التدقيق والحوكمة السيادية معقدة مثل المتطلبات التقنية.</li>
  <li><strong>خطة الشراء حول جداول التحكم بالصادرات الأمريكية.</strong> يؤثر إطار نشر الذكاء الاصطناعي والضوابط السابقة بشكل جوهري على توفر المعالجات الرسومية المتقدمة في دول مجلس التعاون الخليج.</li>
  </ul>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>US Bureau of Industry &amp; Security, <em>Framework for Artificial Intelligence Diffusion</em>, January 2025. <a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">federalregister.gov</a></li>
  <li>TII — Falcon LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42) — Jais. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org/jais</a></li>
  <li>Meta — Llama. <a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">ai.meta.com/llama</a></li>
  <li>Mistral AI. <a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">mistral.ai</a></li>
  <li>G42. <a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">g42.ai</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>Microsoft &amp; G42 Strategic Investment, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>NVIDIA — Data Center GPU portfolio. <a href="https://www.nvidia.com/en-us/data-center/" target="_blank" rel="noopener noreferrer">nvidia.com</a></li>
  </ol>
      
`,
      contentTr: `
  <h2>Tez</h2>
  <p>GCC ulusal güvenlik müşterileri, istihbarat hizmetleri ve kritik altyapı operatörleri için soru, yapay zekayı benimseyip benimsememeğimiz değil, misyonun gerektirdiği egemenliği, güvenliği ve gizliliği tehlikeye atmadan yapay zekanın benimsenebilip benimsenmeyeceğidir. Cevap evet — ancak yalnızca egemenliği ön plana alan bir mimariye, doğru açık ağırlık modeli yığınına ve güvenli çevre içinde yürütme yeteneğine sahip bir teslim ortağına sahipseniz. Bu kısa rapor, egemen ajentik yapay zekayı bugün teslim edilebilir kılan mimari ilkeler ve mevcut bölgesel altyapıyı ortaya koymaktadır.</p>
  <h2>Beş Mimari İlke</h2>
  <h3>1. Model Egemenliği</h3>
  <p>Model kendisi müşteri tarafından kontrol edilmelidir. Uygulamada bu, müşteri tarafından kontrol edilen altyapıda açık ağırlık modelleri anlamına gelir — Meta'nın Llama ailesi (<a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">Llama</a>), Mistral (<a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">Mistral</a>), TII'nin Abu Dhabi'deki Falcon ailesi (<a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>) veya Inception/G42'nin Arapça özellikli Jais (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>). Büyük ABD sağlayıcılarından yalnızca API tabanlı modeller, tanım gereği egemen kullanım durumlarından hariç tutulur.</p>
  <h3>2. Çıkarım İzolasyonu</h3>
  <p>Çıkarım tamamen güvenli çevre içinde gerçekleşmelidir. Bu, seçilen modeli üretim gecikmesi ve üretim veriminde sunma yeteneğine sahip şirket içi GPU altyapısı gerektirir.</p>
  <h3>3. Bağlam Segmentasyonu</h3>
  <p>Alınan belgeler, konuşma geçmişi ve araç çıktıları tamamen çevre içinde saklanmalı ve alınmalı, temel verilerin sınıflandırmasıyla eşleşen katı erişim denetimleriyle.</p>
  <h3>4. Denetim ve Gözlenebilirlik</h3>
  <p>Ajan tarafından gerçekleştirilen her eylem günlüğe kaydedilmeli, atfedilmeli ve adli açıdan denetlenebilir olmalı — güvenli ortam içinde, çevre dışında hiçbir günlük verisi olmaksızın. Gözlenebilirlik altyapısının kendisinin uygun seviyede sınıflandırılması gerekir. NIST'in AI RMF denetimlerin yapılandırılması için faydalı bir referanstır (<a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">NIST AI RMF</a>).</p>
  <h3>5. Yükseltme Yoluyla Egemenlik Korunması</h3>
  <p>Yetenek geliştirme hızı sık sık yükseltme baskısı yaratır; egemen ortamların güvenlik gereklilikleri yavaş değişim baskısı yaratır. Bu gerilimi yapay zeka güncellemeleri için yapılandırılmış bir güvenlik incelemesi süreciyle yönetmek, egemen operasyonlarda en önemli devam eden yönetişim disiplinlerinden biridir.</p>
  <h2>Donanım Gerçeği</h2>
  <p>NVIDIA H100 ve H200 kümeleri, ölçekteki egemen LLM çıkarımı için altın standart olmaya devam etmektedir. ABD ihracat kontrol kuralları — Ocak 2025'te yayınlanan AI Yayılım Çerçevesi de dahil olmak üzere — GCC'de gelişmiş GPU'lar için kullanılabilirliği ve satın alma zaman çizelgelerini doğrudan etkiler ve dikkatli satın alma planlaması gerektirir (<a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">US Bureau of Industry &amp; Security, AI Diffusion Framework, 2025</a>). NVIDIA'nın L40S ve L4 ürün satırı, belirli görevlere göre doğru boyutlandırılabilen amaca yönelik ajanlar için uygun olan daha erişilebilir bir ayak izi sunar. Bölgesel egemen bulut seçenekleri — UAE'de G42'nin altyapısı ve Suudi Arabistan'da PIF altında HUMAIN'i merkezine alan — buluta benzer operasyonel basitlik sağlarken verileri ilgili yetki alanı içinde tutar (<a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">G42</a>; <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">HUMAIN</a>).</p>
  <h2>Arapça Özellikli Egemen İş Yükleri için Açık Ağırlık Modeli Seçimi</h2>
  <p>Arapça kullanım durumları için — GCC egemen bağlamında hakim olanlar — Jais ve Falcon Arapça ayarlanmış varyantları artık güvenilir üretim derecesi seçeneklerdir (<a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">Jais</a>; <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">Falcon</a>). Her ikisi de şirket içi dağıtıma izin veren lisanslar altında ağırlıklar yayınlar; her ikisi de yayınlanan değerlendirmelerde rekabetçi sonuçlarla büyük kapalı Arapça modellere karşı karşılaştırılmıştır.</p>
  <h2>Açıklayıcı Katılım Şekli</h2>
  <p>Bu çalışmanın temsili şekli — GCC egemen katılımlarında gördüğümüz kalıplardan çıkarılan, gizliliği korumak için varsayımsal olarak sunulan — sınıflandırılmış belge analizi için egemen bir ajentik sistem gibi görünüyor: gizliliği açıklanan alan belgelerine ince ayar yapılmış açık ağırlık Arapça özellikli modeli, izin farkında vektör mağazası üzerinde alma, güvenli çevre içinde gözlenebilirlik ve müşterinin ortamı tamamen içinde çalışan kıdemli mühendislerin teslim ayak izi. Mimariden operasyonel dağıtıma kadar olan zaman çizelgesi tipik olarak sınıflandırma rejimi ve altyapı hazırlığına bağlı olarak 6-12 aydır.</p>
  <h2>Öneriler</h2>
  <ul>
  <li><strong>Günden başlayarak egemenlik için mimar.</strong> Egemen mimariyi orijinal olarak genel bulut için tasarlanmış bir sisteme sığdırmak, egemenliği önce inşa etmekten yapısal olarak daha pahalı ve yıkıcıdır.</li>
  <li><strong>Mimari seçmeden önce açık ağırlık modellerini sistematik olarak değerlendirin.</strong> Egemen model ortamı hızlı hareket etmektedir; spesifik kullanım durumunuza karşı yapılandırılmış bir değerlendirme — Arapça performans ve donanım ayak izi dahil — birçok kez geri öder.</li>
  <li><strong>Gözlenebilirlik altyapısını yapay zeka altyapısıyla aynı hassasiyetle planlayın.</strong> Egemen denetim ve yönetişim gereklilikleri teknik gereklilikler kadar karmaşıktır.</li>
  <li><strong>ABD ihracat kontrol zaman çizelgeleri etrafında satın alma planlayın.</strong> AI Yayılım Çerçevesi ve önceki kontroller, GCC'de gelişmiş GPU'ların mevcudiyetini önemli ölçüde etkiler.</li>
  </ul>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>NIST, <em>AI Risk Management Framework</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>US Bureau of Industry &amp; Security, <em>Framework for Artificial Intelligence Diffusion</em>, January 2025. <a href="https://www.federalregister.gov/documents/2025/01/15/2025-00636/framework-for-artificial-intelligence-diffusion" target="_blank" rel="noopener noreferrer">federalregister.gov</a></li>
  <li>TII — Falcon LLM. <a href="https://falconllm.tii.ae/" target="_blank" rel="noopener noreferrer">falconllm.tii.ae</a></li>
  <li>Inception (G42) — Jais. <a href="https://inceptioniai.org/jais/" target="_blank" rel="noopener noreferrer">inceptioniai.org/jais</a></li>
  <li>Meta — Llama. <a href="https://ai.meta.com/llama/" target="_blank" rel="noopener noreferrer">ai.meta.com/llama</a></li>
  <li>Mistral AI. <a href="https://mistral.ai/" target="_blank" rel="noopener noreferrer">mistral.ai</a></li>
  <li>G42. <a href="https://www.g42.ai/" target="_blank" rel="noopener noreferrer">g42.ai</a></li>
  <li>HUMAIN (PIF AI subsidiary). <a href="https://www.humain.ai/" target="_blank" rel="noopener noreferrer">humain.ai</a></li>
  <li>Microsoft &amp; G42 Strategic Investment, April 2024. <a href="https://news.microsoft.com/2024/04/16/microsoft-and-g42-announce-1-5-billion-strategic-investment-to-accelerate-ai-development-and-global-expansion/" target="_blank" rel="noopener noreferrer">news.microsoft.com</a></li>
  <li>NVIDIA — Data Center GPU portfolio. <a href="https://www.nvidia.com/en-us/data-center/" target="_blank" rel="noopener noreferrer">nvidia.com</a></li>
  </ol>
      
`,
    },
    {
      id: "two-paths-to-outcomes",
      slug: "two-paths-to-outcomes",
      title: "Two Paths to Outcomes: Project-Led and Asset-Led AI Delivery",
      titleAr: "مساران للوصول إلى النتائج: تسليم الذكاء الاصطناعي القائم على المشاريع والقائم على الأصول",
      titleTr: "Sonuçlara Giden İki Yol: Proje Öncülüğünde ve Varlık Öncülüğünde AI Teslimi",
      category: "Agentic AI",
      type: "Perspective",
      date: "May 2026",
      readTime: "17 min read",
      author: "Mounir Aris, Senior Partner",
      coverImage: "/images/report-9.png",
      summary: "Maven's POV on how clients should choose between custom transformation engagements (project-led) and productized agents from the Marketplace (asset-led) — with a decision framework drawn from BCG, MIT, McKinsey, Gartner and EY research, and the blending patterns most engagements actually follow.",
      summaryAr: "وجهة نظر مافن حول كيفية اختيار العملاء بين ارتباطات التحول المخصصة (القائمة على المشاريع) والوكلاء الجاهزين من السوق (القائمة على الأصول) — مع إطار قرار مستمد من أبحاث BCG وMIT وMcKinsey وGartner وEY، وأنماط الدمج التي تتبعها معظم الارتباطات فعلياً.",
      summaryTr: "Müşterilerin özel dönüşüm çalışmaları (proje öncülüğünde) ile Marketplace'ten ürünleştirilmiş ajanlar (varlık öncülüğünde) arasında nasıl seçim yapması gerektiğine dair Maven'in bakış açısı — BCG, MIT, McKinsey, Gartner ve EY araştırmalarından alınan bir karar çerçevesi ve çoğu çalışmanın gerçekte izlediği harmanlama desenleri ile.",
      featured: true,
      tags: ["Agentic AI", "Operating Model", "Strategy", "GCC"],
      contentAr: `
<h2>وجهة نظر مافن</h2>
<p>تقدم مافن للذكاء الاصطناعي النتائج عبر مسارين متكاملين، لا مسار واحد. <strong>الارتباطات القائمة على المشاريع</strong> — العمل الاستراتيجي والتحول واسع النطاق وعمليات البناء المخصصة — تقع على أحد المسارين. <strong>الاعتماد القائم على الأصول</strong> للوكلاء والأدوات الجاهزة من سوقنا يقع على الآخر. كلا المسارين يلتقيان عند الوجهة ذاتها: ذكاء اصطناعي يعمل فعلياً في الإنتاج ويمتلك عملاً قابلاً للقياس داخل المؤسسة.</p>
<p>لا نعتقد أن هذين خيارين متكافئين يختار العميل بينهما عشوائياً. المسار الصحيح يعتمد على الموقف: حجم الميزانية، والرعاية التنفيذية، والإلحاح، ونضج الذكاء الاصطناعي والبيانات، وشهية المخاطر، وما إذا كانت المشكلة الأساسية عامة أم مخصصة. معظم الارتباطات في النهاية تمزج المسارين — والمستشار الموثوق ينبغي أن يكون صريحاً بشأن التسلسل المناسب للعميل أمامه.</p>
<blockquote>القائم على المشاريع يثمر عندما تكون المشكلة فريدة والراعي تنفيذياً ونموذج التشغيل مضطراً للتغير. القائم على الأصول يثمر عندما تكون المشكلة مشتركة عبر القطاع وضغط الوقت لتحقيق القيمة شديداً والإجابة قابلة للتهيئة لا للابتكار من الصفر.</blockquote>
<h2>ماذا تقول الأبحاث فعلاً</h2>
<p>الأدلة المنشورة حول تسليم الذكاء الاصطناعي المؤسسي متسقة بشكل لافت عبر الشركات. ثلاثة نتائج تشكل وجهة نظرنا:</p>
<ul>
<li><strong>معظم التجارب لا تصل إلى الإنتاج.</strong> تجد دراسة MIT NANDA لعام 2025 أن 95% من تجارب الذكاء التوليدي المؤسسية لا تحقق أثراً مالياً قابلاً للقياس؛ فقط ~5% من الأنظمة المتكاملة تولد قيمة ذات معنى (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>).</li>
<li><strong>عنق الزجاجة هو التسليم وليس النماذج.</strong> دراسة BCG <em>Where's the Value in AI?</em> تجد أن 26% فقط من الشركات تجاوزت التجارب لتوليد قيمة على نطاق واسع، و4% فقط في النخبة (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>).</li>
<li><strong>الإنتاج الجاهز يضاعف العوائد.</strong> استطلاع McKinsey <em>State of AI</em> يجد أن المؤسسات التي تنسب أكبر أثر EBIT للذكاء الاصطناعي أعادت تصميم سير العمل وأعادت استخدام القدرات عبر حالات الاستخدام (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
</ul>
<p>سوقان مختلفان ينبثقان من هذه النتائج. تغطية Gartner لـ"الذكاء الاصطناعي الوكيل" تتعامل معه كتحول منصة قادم مع توفر وكلاء جاهزين بشكل متزايد (<a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">Gartner, 2024–2025</a>). في الوقت ذاته، استطلاع EY <em>AI Pulse</em> يُظهر أن المؤسسات الكبرى تواصل تكليف برامج تحول مخصصة لأن سياق بياناتها وتنظيمها وتشغيلها فريد بحق (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">EY, 2024</a>).</p>
<h2>المساران، تعريفاً</h2>
<h3>القائم على المشاريع</h3>
<p>ارتباط مخصص محدد النطاق لتحقيق نتيجة بعينها داخل مؤسسة بعينها. تجلب مافن شركاء كبار ومهندسين ومن مافن إنسايتس عند الحاجة لتصميم وبناء وتشغيل قدرة ذكاء اصطناعي لم تكن موجودة من قبل. أشكال نموذجية: برامج التحول الوكيلة، ودورة حياة تطوير البرمجيات المدفوعة بالذكاء الاصطناعي وتحديث الأنظمة القديمة، وأسس البيانات والحوكمة، وMVP لمدة 90 يوماً في استوديو منتجات الذكاء الاصطناعي.</p>
<h3>القائم على الأصول</h3>
<p>اعتماد وتهيئة وكيل أو أداة جاهزة من السوق. الملكية الفكرية مبنية مسبقاً؛ العمل هو ملاءمتها لبيانات العميل وعملياته ووضع الحوكمة لديه. أشكال نموذجية: أداة تحقيق القيمة، وكوبايلوت تسليم PMO، ووكيل تفاوض المشتريات، وخلية رعاية العملاء، وحارس البيانات السيادي.</p>
<h2>إطار القرار</h2>
<p>نستخدم خمسة عوامل لإرشاد العملاء حول المسار الأنسب. لا أحد منها حاسم بمفرده؛ التركيبة هي ما يهم.</p>
<ul>
<li><strong>خصوصية المشكلة:</strong> فريدة → قائم على المشاريع؛ مشتركة في القطاع → قائم على الأصول.</li>
<li><strong>الرعاية والتفويض:</strong> راعٍ تنفيذي وتغيير نموذج التشغيل → قائم على المشاريع؛ رئيس وظيفي بميزانية → قائم على الأصول.</li>
<li><strong>الوقت لتحقيق القيمة:</strong> 12–26 أسبوعاً مقبول → قائم على المشاريع؛ أسابيع مطلوبة → قائم على الأصول.</li>
<li><strong>نضج الذكاء الاصطناعي والبيانات:</strong> الأسس بحاجة إلى بناء → قائم على المشاريع؛ جاهزة للتوصيل → قائم على الأصول.</li>
<li><strong>شهية المخاطر والملكية الفكرية:</strong> ملكية حصرية وسيادية → قائم على المشاريع؛ ملكية مشتركة ومهيأة → قائم على الأصول.</li>
</ul>
<p>ثلاثة عوامل أو أكثر تميل في الاتجاه ذاته إشارة واضحة عادةً. الصورة المنقسمة فعلاً عادةً ما تشير إلى دخول <em>مدمج</em>، لا إلى رمي عملة.</p>
<h2>محوران يصقلان الاختيار</h2>
<p>تنطوي العوامل الخمسة عملياً على محورين نرسمهما على السبورة مع كل عميل تقريباً: <strong>خصوصية المشكلة</strong> (عام ↔ مخصص) و<strong>نضج الذكاء الاصطناعي والرعاية</strong> (منخفض ↔ عالٍ). الأرباع الأربعة تعطي توصية انطلاق:</p>
<ul>
<li><strong>عام · نضج منخفض:</strong> ابدأ بالقائم على الأصول. هيّئ أداة من السوق وأثبت القيمة وابنِ الثقة الداخلية.</li>
<li><strong>عام · نضج عالٍ:</strong> القائم على الأصول على نطاق واسع. وزّع الوكيل عبر وحدات الأعمال واستخدم الوفورات لتمويل الخطوة التالية.</li>
<li><strong>مخصص · نضج منخفض:</strong> اكتشاف قائم على المشاريع أولاً. ارتباط قصير بقيادة كبار يسمي المشكلة الحقيقية ويعيد بناء الأسس اللازمة.</li>
<li><strong>مخصص · نضج عالٍ:</strong> تحول قائم على المشاريع. لدى العميل الرعاية والبيانات؛ ما ينقص هو بناء مخصص وعضلة إدارة التغيير.</li>
</ul>
<h2>أنماط الدمج التي نراها عملياً</h2>
<p>تقريباً كل علاقة طويلة الأمد مع مافن تمزج المسارين في النهاية. السؤال المثير هو التسلسل. ثلاثة أنماط متكررة:</p>
<h3>النمط 1 — تجربة أصول → نطاق مشروع</h3>
<p>يعتمد رئيس وظيفي وكيلاً من السوق (مثل كوبايلوت تسليم PMO أو وكيل تفاوض المشتريات)، يثبت القيمة داخل فريق واحد في 8–12 أسبوعاً، ويستخدم هذا الدليل لإطلاق رعاية تنفيذية لتحول قائم على المشاريع يعيد هندسة نموذج التشغيل حول الوكيل.</p>
<h3>النمط 2 — اكتشاف مشروع → نشر أصول</h3>
<p>يكلف راعٍ تنفيذي اكتشافاً قائماً على المشاريع — عادةً سرعة حالة قيمة وبناء أسس بيانات وحوكمة — ويُظهر الاكتشاف خمس إلى ست حالات استخدام. اثنتان مخصصتان بحق وتبقيان قائمتين على المشاريع؛ والباقي بشكل أدوات سوق موجودة وتُنشر قائمة على الأصول بسرعة أكبر بكثير وتكلفة أقل.</p>
<h3>النمط 3 — مساران متوازيان</h3>
<p>يدير العملاء الأكبر كلا المسارين بالتوازي من اليوم الأول: برنامج قائم على المشاريع يعيد بناء أساس البيانات ووكيل رئيسي مخصص، بينما تنزل ثلاث أو أربع أدوات قائمة على الأصول في وظائف مجاورة لإبقاء قيمة مرئية تتدفق بينما تنضج أعمال الأساس.</p>
<h2>المقايضات الصادقة</h2>
<ul>
<li><strong>التكلفة.</strong> القائم على المشاريع أغلى لكل نتيجة في اليوم الأول؛ القائم على الأصول أرخص لكل نتيجة لكنه يراكم تكلفة تهيئة وتكامل مع نمو الكتالوج.</li>
<li><strong>الوقت لتحقيق القيمة.</strong> القائم على الأصول يقدم نتيجة أولى مفيدة في أسابيع؛ القائم على المشاريع في أشهر.</li>
<li><strong>التخصيص.</strong> القائم على المشاريع ينتج ملكية فكرية مشكلة بدقة للعميل؛ القائم على الأصول ينتج ملكية فكرية مشكلة للقطاع ومهيأة للعميل.</li>
<li><strong>عبء إدارة التغيير.</strong> القائم على المشاريع يحمل عبئاً أثقل لأنه عادة يعيد توصيل نموذج التشغيل.</li>
<li><strong>ملكية الملكية الفكرية.</strong> القائم على المشاريع ينتج ملكية يملكها العميل؛ القائم على الأصول يبقي الملكية مع مافن.</li>
</ul>
<h2>التوصيات</h2>
<ul>
<li>طبّق عدسة العوامل الخمسة قبل تحديد نطاق أي مبادرة ذكاء اصطناعي جديدة.</li>
<li>تعامل مع السوق كمحفظة، لا ككتالوج مشتريات.</li>
<li>للمشكلات المخصصة بأسس بيانات ضعيفة، لا تتخطَّ الاكتشاف القائم على المشاريع.</li>
<li>للمشكلات العامة برعاية قوية، قاوم رغبة الإفراط في الهندسة.</li>
</ul>
<h2>المصادر والاستشهادات</h2>
  <ol class="sources-list">
  <li>MIT NANDA، <em>State of AI in Business 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>BCG، <em>Where's the Value in AI?</em>، 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>McKinsey، <em>The State of AI</em>، 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Gartner — الذكاء الاصطناعي الوكيل وتوجهات التكنولوجيا. <a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>EY، <em>AI Pulse Survey</em>، 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>Stanford HAI، <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>المنتدى الاقتصادي العالمي، <em>تقرير مستقبل الوظائف 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>منظمة التعاون الاقتصادي والتنمية (OECD)، <em>مبادئ الذكاء الاصطناعي</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  <li>المعهد الوطني للمعايير والتكنولوجيا (NIST)، <em>إطار إدارة مخاطر الذكاء الاصطناعي (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  </ol>
    `,
      contentTr: `
<h2>Maven'in Bakış Açısı</h2>
<p>Maven AI sonuçları tek bir yoldan değil, birbirini tamamlayan iki yoldan teslim eder. <strong>Proje öncülüğünde</strong> çalışmalar — strateji, büyük ölçekli dönüşüm, özel inşa — bir rayda yer alır. Marketplace'imizden ürünleştirilmiş ajan ve araçların <strong>varlık öncülüğünde</strong> benimsenmesi diğer rayda durur. Her iki ray da aynı varış noktasında birleşir: kurum içinde ölçülebilir bir işin sahibi olan, gerçekten üretimde çalışan AI.</p>
<p>Bunların müşterinin rastgele seçtiği eşdeğer seçenekler olduğunu düşünmüyoruz. Doğru yol duruma bağlıdır: bütçe zarfı, üst düzey sponsorluk, aciliyet, AI ve veri olgunluğu, risk iştahı ve altta yatan sorunun jenerik mi yoksa özel mi olduğu. Çoğu çalışma sonunda ikisini harmanlar — ve güvenilir bir danışman, karşısındaki müşteriye hangi sıralamanın uyduğu konusunda dürüst olmalıdır.</p>
<blockquote>Sorun özel, sponsor üst düzey ve işletim modelinin değişmesi gerekiyorsa proje öncülüğünde teslim sonuç verir. Sorun sektörde paylaşılıyorsa, değer süresi baskısı yüksekse ve cevap icat edilmek yerine yapılandırılabiliyorsa varlık öncülüğünde teslim sonuç verir.</blockquote>
<h2>Araştırmaların Söylediği</h2>
<p>Kurumsal AI teslimi üzerine yayımlanmış kanıtlar, firmalar arasında alışılmadık ölçüde tutarlıdır. Üç bulgu bakış açımızı şekillendiriyor:</p>
<ul>
<li><strong>Pilotların çoğu üretime ulaşmıyor.</strong> MIT NANDA'nın 2025 <em>State of AI in Business</em> raporu, kurumsal GenAI pilotlarının %95'inin ölçülebilir bir K/Z etkisi sağlamadığını; entegre sistemlerin yalnızca yaklaşık %5'inin anlamlı değer ürettiğini ortaya koyuyor (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>).</li>
<li><strong>Darboğaz modellerde değil, teslimattadır.</strong> BCG'nin <em>Where's the Value in AI?</em> çalışması, şirketlerin yalnızca %26'sının pilotları aşıp ölçekte değer üretebildiğini, yalnızca %4'ünün ise elit sınırda olduğunu gösteriyor (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>).</li>
<li><strong>Ürünleştirme getirileri katlar.</strong> McKinsey'in <em>State of AI</em> anketi, AI'a en yüksek FAVÖK etkisini atfeden kuruluşların izole pilotlar yürütenler değil, iş akışlarını yeniden tasarlayan ve yetenekleri kullanım alanları arasında yeniden kullananlar olduğunu buluyor (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
</ul>
<p>Bu bulgulardan iki farklı pazar ortaya çıkıyor. Gartner'in "ajansal AI" üzerine analizleri bunu, paketlenmiş ajanların giderek raftan ulaşılabilir hale geldiği bir sonraki platform geçişi olarak ele alıyor (<a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">Gartner, 2024–2025</a>). Aynı zamanda EY'nin <em>AI Pulse Survey</em> çalışması, büyük kurumların veri, regülasyon ve işletim modeli bağlamı gerçekten özel olduğu için özel dönüşüm programları sipariş etmeye devam ettiğini gösteriyor (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">EY, 2024</a>). Dürüst okuma şudur: her iki teslim biçimi de kalıcıdır ve müşterilerin aralarında seçim yapmak için bir çerçeveye ihtiyacı vardır.</p>
<h2>İki Yolun Tanımı</h2>
<h3>Proje Öncülüğünde</h3>
<p>Belirli bir kuruluşun içinde belirli bir sonuca odaklanmış özel bir çalışma. Maven; kıdemli ortaklarını, mühendislerini ve (yararlı olduğunda) Maven Insights yedek gücünü müşterinin ortamına getirerek daha önce var olmayan bir AI yeteneğini tasarlar, kurar ve işletir. Tipik şekiller: ajansal dönüşüm programları, AI destekli SDLC ve eski sistem modernizasyonu, veri ve yönetişim temelleri ve AI Ürün Stüdyosu'nda 90 günlük MVP'ler. Proje öncülüğünde çalışma; sorun özelse, veri hassas veya egemen ise, işletim modelinin değişmesi gerekiyorsa veya müşteri uçtan uca sorumlu bir partner istiyorsa uygundur.</p>
<h3>Varlık Öncülüğünde</h3>
<p>Marketplace'ten ürünleştirilmiş bir ajan veya aracın benimsenmesi ve yapılandırılması. Fikri mülkiyet önceden inşa edilmiştir; iş, onu müşterinin verisine, süreçlerine ve yönetişim duruşuna uyarlamaktır. Tipik şekiller: Değer Gerçekleştirme Aracı, PMO Teslim Yardımcı Pilotu, Tedarik Müzakere Ajanı, Müşteri Hizmetleri Kovanı, Egemen Veri Bekçisi. Varlık öncülüğünde teslim; sorun sektörde paylaşılıyorsa, değer süresi baskısı yüksekse, bütçe kısıtlıysa veya müşteri küçük başlayıp daha büyük bir çalışmaya bağlanmadan önce değer kanıtlamak istiyorsa uygundur.</p>
<h2>Karar Çerçevesi</h2>
<p>Müşterilere hangi yolun en uygun olduğu konusunda öneride bulunmak için beş faktör kullanıyoruz. Tek başına hiçbiri belirleyici değildir; önemli olan kombinasyondur.</p>
<div class="overflow-x-auto my-6">
<table class="min-w-full border border-gray-200 text-sm">
<thead class="bg-[#0E2841] text-white">
<tr>
<th class="text-left p-3 font-bold">Faktör</th>
<th class="text-left p-3 font-bold">Proje Öncülüğüne Yaklaş…</th>
<th class="text-left p-3 font-bold">Varlık Öncülüğüne Yaklaş…</th>
</tr>
</thead>
<tbody>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Sorun özgüllüğü</td>
<td class="p-3 text-gray-700">Sorun kuruluşunuza, düzenleyicinize veya coğrafyanıza özeldir.</td>
<td class="p-3 text-gray-700">Sorun sektörde paylaşılıyor ve büyük ölçüde zaten çözülmüş.</td>
</tr>
<tr class="border-t border-gray-200 bg-gray-50">
<td class="p-3 font-semibold text-[#0E2841]">Sponsorluk ve yetki</td>
<td class="p-3 text-gray-700">Sonucun sahibi bir C-seviyesi sponsor ve işletim modelini değiştirebiliyor.</td>
<td class="p-3 text-gray-700">Bütçesi olan bir fonksiyon başkanı, ekibinin elinde çalışan bir araç istiyor.</td>
</tr>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Değer süresi</td>
<td class="p-3 text-gray-700">Üretim MVP'sine 12–26 hafta kabul edilebilir.</td>
<td class="p-3 text-gray-700">İlk faydalı çıktı için haftalar gerekiyor; iş gerekçesini canlı tutmak için.</td>
</tr>
<tr class="border-t border-gray-200 bg-gray-50">
<td class="p-3 font-semibold text-[#0E2841]">AI ve veri olgunluğu</td>
<td class="p-3 text-gray-700">Veri temelleri veya yönetişim, çalışmanın bir parçası olarak inşa veya yeniden inşa edilmeli.</td>
<td class="p-3 text-gray-700">Veri ve yönetişim, ürünleştirilmiş bir ajanı bağlamak için yeterince iyi.</td>
</tr>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Risk ve fikri mülkiyet iştahı</td>
<td class="p-3 text-gray-700">Özel fikri mülkiyet, egemen dağıtım veya savunulabilir bir hendek istiyorsunuz.</td>
<td class="p-3 text-gray-700">Paylaşılan fikri mülkiyeti benimseyip kendi bağlamınıza yapılandırmaktan rahatsınız.</td>
</tr>
</tbody>
</table>
</div>
<p>Üç veya daha fazla faktörün aynı yöne eğilmesi genellikle net bir sinyaldir. Gerçekten bölünmüş bir tablo — ikiye iki ve bir faktör eşikte — genellikle yazı tura atmayı değil, <em>harmanlanmış</em> bir girişi işaret eder.</p>
<h2>Seçimi Keskinleştiren İki Eksen</h2>
<p>Yukarıdaki beş faktör pratikte, neredeyse her müşteriyle tahtaya çizdiğimiz iki eksene indirgenir: <strong>Sorun Özgüllüğü</strong> (jenerik ↔ özel) ve <strong>AI Olgunluğu ve Sponsorluk</strong> (düşük ↔ yüksek). Dört çeyrek bir başlangıç önerisi sunar:</p>
<div class="my-8 not-prose">
  <div class="relative bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
    <div class="text-center text-[11px] font-bold uppercase tracking-widest text-[#0E2841] mb-3">Sorun Özgüllüğü →</div>
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border-2 border-[#F5A623] bg-[#F5A623]/5 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#F5A623] mb-1">Jenerik · Düşük olgunluk</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Varlık öncülüğünde başla</div>
        <div class="text-xs text-gray-600">Bir Marketplace aracı yapılandır, değeri kanıtla, iç güveni inşa et.</div>
      </div>
      <div class="rounded-lg border-2 border-[#156082] bg-[#156082]/5 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#156082] mb-1">Özel · Düşük olgunluk</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Proje öncülüğünde keşif</div>
        <div class="text-xs text-gray-600">Gerçek sorunu adlandıran ve temelleri yeniden inşa eden, kıdemli liderliğinde çalışma.</div>
      </div>
      <div class="rounded-lg border-2 border-[#F5A623] bg-[#F5A623]/10 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#F5A623] mb-1">Jenerik · Yüksek olgunluk</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Ölçekte varlık öncülüğünde</div>
        <div class="text-xs text-gray-600">Ürünleştirilmiş ajanı iş birimleri arasında yay; tasarruflarla bir sonraki adımı finanse et.</div>
      </div>
      <div class="rounded-lg border-2 border-[#156082] bg-[#156082]/10 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#156082] mb-1">Özel · Yüksek olgunluk</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Proje öncülüğünde dönüşüm</div>
        <div class="text-xs text-gray-600">Özel inşa artı onu hayata geçirecek değişim yönetimi kası.</div>
      </div>
    </div>
    <div class="text-center text-[11px] font-bold uppercase tracking-widest text-[#0E2841] mt-3">↑ AI Olgunluğu ve Sponsorluk</div>
  </div>
</div>
<h2>Pratikte Gördüğümüz Harmanlama Desenleri</h2>
<p>Maven'in uzun süreli neredeyse her ilişkisi sonunda iki yolu harmanlar. İlginç soru sıralamadır. Üç desen tekrar eder:</p>
<h3>Desen 1 — Varlık Pilotu → Proje Ölçeği</h3>
<div class="my-5 not-prose">
  <div class="flex flex-col sm:flex-row items-stretch gap-2 text-xs">
    <div class="flex-1 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-3">
      <div class="font-bold text-[#F5A623] uppercase tracking-wider text-[10px] mb-1">Varlık</div>
      <div class="text-[#0E2841] font-semibold">Tek ekipte Marketplace ajanı</div>
      <div class="text-gray-600 mt-1">8–12 hafta · fonksiyon başkanı bütçesi</div>
    </div>
    <div class="flex items-center justify-center text-[#0E2841] font-bold">→</div>
    <div class="flex-1 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-3">
      <div class="font-bold text-[#156082] uppercase tracking-wider text-[10px] mb-1">Proje</div>
      <div class="text-[#0E2841] font-semibold">C-seviyesi sponsorluğu açıldı</div>
      <div class="text-gray-600 mt-1">İşletim modeli ajan etrafında yeniden tasarlandı</div>
    </div>
  </div>
</div>
<p>Bir fonksiyon başkanı Marketplace'ten bir ajan benimser (örneğin PMO Teslim Yardımcı Pilotu veya Tedarik Müzakere Ajanı), 8–12 hafta içinde tek bir ekipte değeri kanıtlar ve bu kanıtı, işletim modelini ajan etrafında yeniden tasarlayan proje öncülüğünde bir dönüşüm için C-seviyesi sponsorluğunu açmak amacıyla kullanır. Varlık kamadır; proje ölçeklemedir.</p>
<h3>Desen 2 — Proje Keşfi → Varlık Yaygınlaştırması</h3>
<div class="my-5 not-prose">
  <div class="flex flex-col sm:flex-row items-stretch gap-2 text-xs">
    <div class="flex-1 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-3">
      <div class="font-bold text-[#156082] uppercase tracking-wider text-[10px] mb-1">Proje</div>
      <div class="text-[#0E2841] font-semibold">Değer-örneği sprinti + temeller</div>
      <div class="text-gray-600 mt-1">5–6 aday kullanım alanını ortaya çıkarır</div>
    </div>
    <div class="flex items-center justify-center text-[#0E2841] font-bold">→</div>
    <div class="flex-1 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-3">
      <div class="font-bold text-[#F5A623] uppercase tracking-wider text-[10px] mb-1">Varlık × N</div>
      <div class="text-[#0E2841] font-semibold">Marketplace araçları fonksiyonlara yayıldı</div>
      <div class="text-gray-600 mt-1">2'si proje öncülüğünde kalır; gerisi düşük maliyetle yapılandırılır</div>
    </div>
  </div>
</div>
<p>Bir C-seviyesi sponsor proje öncülüğünde bir keşif sipariş eder — genellikle bir değer-örneği sprinti artı veri ve yönetişim temelleri inşası — ve keşif beş veya altı kullanım alanını ortaya çıkarır. İkisi gerçekten özeldir ve proje öncülüğünde kalır; gerisi mevcut Marketplace araçlarının tam şeklindedir ve varlık öncülüğünde, çok daha hızlı ve çok daha düşük maliyetle yaygınlaştırılır.</p>
<h3>Desen 3 — Paralel Raylar</h3>
<div class="my-5 not-prose">
  <div class="space-y-2 text-xs">
    <div class="flex items-stretch gap-2">
      <div class="w-20 sm:w-28 flex-shrink-0 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-2 flex items-center justify-center font-bold text-[10px] uppercase tracking-wider text-[#156082]">Proje rayı</div>
      <div class="flex-1 rounded-lg bg-[#156082]/5 border border-[#156082]/30 p-3 text-[#0E2841]">Veri temelinin yeniden inşası + bir öncü özel ajan</div>
      <div class="flex items-center px-1 text-[#196B24] font-bold">⇢</div>
      <div class="flex-1 rounded-lg bg-[#196B24]/10 border border-[#196B24]/40 p-3 text-[#0E2841] font-semibold">Akımlar birleşir — ajanlar yönetilen veriyi tüketir</div>
    </div>
    <div class="flex items-stretch gap-2">
      <div class="w-20 sm:w-28 flex-shrink-0 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-2 flex items-center justify-center font-bold text-[10px] uppercase tracking-wider text-[#F5A623]">Varlık rayı</div>
      <div class="flex-1 rounded-lg bg-[#F5A623]/5 border border-[#F5A623]/30 p-3 text-[#0E2841]">3–4 Marketplace aracı komşu fonksiyonlara iner, görünür değer akar</div>
      <div class="flex items-center px-1 text-transparent">⇢</div>
      <div class="flex-1 rounded-lg bg-transparent border border-transparent p-3"></div>
    </div>
  </div>
</div>
<p>Daha büyük müşteriler her iki yolu da ilk günden paralel yürütür: veri temelini ve bir öncü ajanı yeniden inşa eden proje öncülüğünde bir program, bunun yanında temel çalışma olgunlaşırken görünür değerin akmasını sağlamak için komşu fonksiyonlarda inen üç veya dört varlık öncülüğünde araç. İki akım, temel devreye girip ürünleştirilmiş ajanlar yeni yönetilen veriyi tüketmeye başladıkça birleşir.</p>
<h2>Dürüst Ödünleşimler</h2>
<p>Her yolun müşteriye neye mal olduğu konusunda açık olmaya çalışıyoruz.</p>
<ul>
<li><strong>Maliyet.</strong> Proje öncülüğünde teslim ilk gün sonuç başına daha pahalıdır; varlık öncülüğünde teslim sonuç başına daha ucuzdur ancak katalog büyüdükçe yapılandırma ve entegrasyon maliyeti birikir.</li>
<li><strong>Değer süresi.</strong> Varlık öncülüğünde teslim genellikle ilk faydalı çıktıyı haftalar içinde verir; proje öncülüğünde aylar içinde. Bazı sorunlarda haftalar yapısal olarak imkânsızdır — veri hazır değildir.</li>
<li><strong>Özelleştirme.</strong> Proje öncülüğünde teslim, müşteriye tam olarak şekillendirilmiş fikri mülkiyet üretir; varlık öncülüğünde teslim, sektöre şekillendirilmiş ve müşteriye yapılandırılmış fikri mülkiyet üretir. Yapılandırmanın sınırları vardır.</li>
<li><strong>Değişim yönetimi yükü.</strong> Proje öncülüğünde teslim, genellikle işletim modelini yeniden bağladığı için daha ağır değişim yönetimi yükü taşır; varlık öncülüğünde teslim, mevcut bir sürece indiği için daha hafif (ama sıfır olmayan) değişim yönetimi yükü taşır.</li>
<li><strong>Fikri mülkiyet sahipliği.</strong> Proje öncülüğünde teslim genellikle müşteriye ait fikri mülkiyet üretir; varlık öncülüğünde teslim fikri mülkiyeti Maven'de bırakır (müşteri kataloğun sürekli iyileştirilmesinden faydalanır). Egemen ve hava boşluklu dağıtımlar her iki yolda da mevcuttur.</li>
</ul>
<h2>Bu, Müşteriyle Yapılan Konuşma İçin Ne Anlama Gelir</h2>
<p>Müşteri için pratik sonuç şudur: ilk konuşma "proje mi yoksa araç mı istiyorsunuz?" olmamalıdır — "beş faktörde neredesiniz ve önümüzdeki 6–18 ay için harman nasıl görünür?" olmalıdır. Maven için pratik sonuç şudur: kısa vadede proje öncülüğünde bir çalışma daha kazançlı olsa bile varlık öncülüğünde yolu önermeye istekli olmalıyız ve <em>neredeyse</em> uygun bir Marketplace aracı bulunsa bile proje öncülüğünde yolu önermeye istekli olmalıyız. Bu konudaki güvenilirlik, bu bakış açısının tüm anlamıdır.</p>
<h2>Tavsiyeler</h2>
<ul>
<li>Yeni bir AI girişimini kapsamadan önce beş faktörlü karar merceğini uygulayın. Varsayılan sıralama ("önce bir strateji projesi yaparız, sonra araçları çözeriz") sorunun aslında jenerik olup olmadığını öğrenmenin en pahalı yoludur.</li>
<li>Marketplace'i bir tedarik kataloğu olarak değil, bir portföy olarak ele alın. Bir aracı benimseyin, ondan öğrenin ve bu öğrenmenin proje öncülüğünde sonraki adımı şekillendirmesine izin verin.</li>
<li>Veri temelleri zayıf olan özel sorunlarda proje öncülüğünde keşfi atlamayın. Bozuk veriyle varlık öncülüğünde teslim, hizmet verdiğimiz Körfez kurumlarında en sık gördüğümüz başarısızlık biçimidir.</li>
<li>Güçlü sponsorluğu olan jenerik sorunlarda aşırı mühendislik dürtüsüne direnin. Bu çeyrek üretime giren yapılandırılmış bir Marketplace aracı, gelecek yıl inen özel bir inşadan daha iyidir.</li>
</ul>
<h2>Kaynaklar ve Atıflar</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>State of AI in Business 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>BCG, <em>Where's the Value in AI?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>McKinsey, <em>The State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Gartner — Agentic AI ve Stratejik Teknoloji Trendleri. <a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>EY, <em>AI Pulse Survey</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>World Economic Forum, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>OECD, <em>AI Principles</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  <li>NIST, <em>AI Risk Management Framework (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  </ol>
    `,
      content: `
<h2>Maven's Point of View</h2>
<p>Maven AI delivers outcomes through two complementary paths, not one. <strong>Project-led</strong> engagements — strategy work, large-scale transformation, custom builds — sit on one rail. <strong>Asset-led</strong> adoption of productized agents and tools from our Marketplace sits on the other. Both rails converge on the same destination: AI that is actually in production, owning measurable work inside the enterprise.</p>
<p>We do not believe these are equivalent options the client picks at random. The right path depends on the situation: budget envelope, senior sponsorship, urgency, AI and data maturity, risk appetite, and whether the underlying problem is generic or bespoke. Most engagements eventually blend the two — and a credible advisor should be honest about which sequence fits the client in front of them.</p>
<blockquote>Project-led delivers when the problem is bespoke, the sponsor is senior, and the operating model has to change. Asset-led delivers when the problem is shared across the industry, the time-to-value pressure is acute, and the answer can be configured rather than invented.</blockquote>
<h2>What the Research Actually Says</h2>
<p>The published evidence on enterprise AI delivery is unusually consistent across firms. Three findings shape our POV:</p>
<ul>
<li><strong>Most pilots never reach production.</strong> MIT NANDA's 2025 <em>State of AI in Business</em> report finds 95% of enterprise GenAI pilots deliver no measurable P&amp;L impact; only ~5% of integrated systems generate meaningful value (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>).</li>
<li><strong>The bottleneck is delivery, not models.</strong> BCG's <em>Where's the Value in AI?</em> finds only 26% of companies have moved past pilots to generate any value at scale, and just 4% sit at the elite frontier (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>).</li>
<li><strong>Productization compounds returns.</strong> McKinsey's <em>State of AI</em> survey finds that organizations attributing the largest EBIT impact to AI redesigned workflows and reused capabilities across use cases — not those that ran the most isolated pilots (<a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">McKinsey, 2024</a>).</li>
</ul>
<p>Two different markets are emerging from these findings. Gartner's coverage of "agentic AI" treats it as the next platform shift, with packaged agents increasingly available off the shelf (<a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">Gartner, 2024–2025</a>). At the same time, EY's <em>AI Pulse Survey</em> shows large enterprises continuing to commission custom transformation programs because their data, regulatory, and operating-model context is genuinely bespoke (<a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">EY, 2024</a>). The honest reading: both delivery shapes are durable, and clients need a framework for choosing between them.</p>
<h2>The Two Paths, Defined</h2>
<h3>Project-Led</h3>
<p>A custom engagement scoped to a specific outcome inside a specific organization. Maven brings senior partners, engineers, and (where it helps) Maven Insights bench depth into the client's environment to design, build, and run an AI capability that did not exist before. Typical shapes: agentic transformation programs, AI-driven SDLC and legacy modernization, data &amp; governance foundations, and 90-day MVPs in the AI Product Studio. Project-led work is appropriate when the problem is bespoke, the data is sensitive or sovereign, the operating model has to change, or the client needs a partner accountable end-to-end.</p>
<h3>Asset-Led</h3>
<p>Adoption and configuration of a productized agent or tool from the Marketplace. The IP is pre-built; the work is fitting it to the client's data, processes, and governance posture. Typical shapes: the Value Realization Tool, the PMO Delivery Copilot, the Procurement Negotiation Agent, the Customer Care Hive, the Sovereign Data Steward. Asset-led delivery is appropriate when the problem is shared across the industry, the time-to-value pressure is acute, the budget envelope is constrained, or the client wants to start small and prove value before committing to a larger engagement.</p>
<h2>A Decision Framework</h2>
<p>We use five factors to advise clients on which path fits best. None is decisive on its own; the combination is what matters.</p>
<div class="overflow-x-auto my-6">
<table class="min-w-full border border-gray-200 text-sm">
<thead class="bg-[#0E2841] text-white">
<tr>
<th class="text-left p-3 font-bold">Factor</th>
<th class="text-left p-3 font-bold">Lean Project-Led When…</th>
<th class="text-left p-3 font-bold">Lean Asset-Led When…</th>
</tr>
</thead>
<tbody>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Problem specificity</td>
<td class="p-3 text-gray-700">The problem is bespoke to your organization, regulator, or geography.</td>
<td class="p-3 text-gray-700">The problem is shared across your industry and largely solved already.</td>
</tr>
<tr class="border-t border-gray-200 bg-gray-50">
<td class="p-3 font-semibold text-[#0E2841]">Sponsorship &amp; mandate</td>
<td class="p-3 text-gray-700">A C-suite sponsor owns the outcome and can change the operating model.</td>
<td class="p-3 text-gray-700">A function head owns a budget and wants a working tool in the team's hands.</td>
</tr>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Time-to-value</td>
<td class="p-3 text-gray-700">12–26 weeks to a production MVP is acceptable.</td>
<td class="p-3 text-gray-700">Weeks to first useful output is required to keep the business case alive.</td>
</tr>
<tr class="border-t border-gray-200 bg-gray-50">
<td class="p-3 font-semibold text-[#0E2841]">AI &amp; data maturity</td>
<td class="p-3 text-gray-700">Data foundations or governance need to be built or rebuilt as part of the work.</td>
<td class="p-3 text-gray-700">Data and governance are good enough to plug a productized agent in.</td>
</tr>
<tr class="border-t border-gray-200">
<td class="p-3 font-semibold text-[#0E2841]">Risk &amp; IP appetite</td>
<td class="p-3 text-gray-700">You want exclusive IP, sovereign deployment, or a defensible moat.</td>
<td class="p-3 text-gray-700">You are comfortable adopting shared IP and configuring it to your context.</td>
</tr>
</tbody>
</table>
</div>
<p>Three or more factors leaning the same way is usually a clear signal. A genuinely split picture — two and two with one factor on the fence — typically points to a <em>blended</em> entry, not a coin flip.</p>
<h2>Two Axes That Sharpen the Choice</h2>
<p>The five factors above collapse, in practice, into two axes that we draw on a whiteboard with almost every client: <strong>Problem Specificity</strong> (generic ↔ bespoke) and <strong>AI Maturity &amp; Sponsorship</strong> (low ↔ high). The four quadrants give a starting recommendation:</p>
<div class="my-8 not-prose">
  <div class="relative bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
    <div class="text-center text-[11px] font-bold uppercase tracking-widest text-[#0E2841] mb-3">Problem Specificity →</div>
    <div class="grid grid-cols-2 gap-3">
      <div class="rounded-lg border-2 border-[#F5A623] bg-[#F5A623]/5 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#F5A623] mb-1">Generic · Low maturity</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Start asset-led</div>
        <div class="text-xs text-gray-600">Configure a Marketplace tool, prove value, build internal confidence.</div>
      </div>
      <div class="rounded-lg border-2 border-[#156082] bg-[#156082]/5 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#156082] mb-1">Bespoke · Low maturity</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Project-led discovery</div>
        <div class="text-xs text-gray-600">Senior-led engagement that names the real problem and rebuilds foundations.</div>
      </div>
      <div class="rounded-lg border-2 border-[#F5A623] bg-[#F5A623]/10 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#F5A623] mb-1">Generic · High maturity</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Asset-led at scale</div>
        <div class="text-xs text-gray-600">Roll the productized agent across business units; fund the next move from savings.</div>
      </div>
      <div class="rounded-lg border-2 border-[#156082] bg-[#156082]/10 p-4">
        <div class="text-[10px] font-bold uppercase tracking-wider text-[#156082] mb-1">Bespoke · High maturity</div>
        <div class="text-sm font-bold text-[#0E2841] mb-1">Project-led transformation</div>
        <div class="text-xs text-gray-600">Custom build plus change-management muscle to land it.</div>
      </div>
    </div>
    <div class="text-center text-[11px] font-bold uppercase tracking-widest text-[#0E2841] mt-3">↑ AI Maturity &amp; Sponsorship</div>
  </div>
</div>
<h2>Blending Patterns We See in Practice</h2>
<p>Almost every long-running Maven relationship eventually blends both paths. The interesting question is the sequence. Three patterns recur:</p>
<h3>Pattern 1 — Asset Pilot → Project Scale</h3>
<div class="my-5 not-prose">
  <div class="flex flex-col sm:flex-row items-stretch gap-2 text-xs">
    <div class="flex-1 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-3">
      <div class="font-bold text-[#F5A623] uppercase tracking-wider text-[10px] mb-1">Asset</div>
      <div class="text-[#0E2841] font-semibold">Marketplace agent in one team</div>
      <div class="text-gray-600 mt-1">8–12 weeks · function-head budget</div>
    </div>
    <div class="flex items-center justify-center text-[#0E2841] font-bold">→</div>
    <div class="flex-1 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-3">
      <div class="font-bold text-[#156082] uppercase tracking-wider text-[10px] mb-1">Project</div>
      <div class="text-[#0E2841] font-semibold">C-suite sponsorship unlocked</div>
      <div class="text-gray-600 mt-1">Operating model re-engineered around the agent</div>
    </div>
  </div>
</div>
<p>A function head adopts a Marketplace agent (say, the PMO Delivery Copilot or the Procurement Negotiation Agent), proves value inside one team in 8–12 weeks, and uses that evidence to unlock C-suite sponsorship for a project-led transformation that re-engineers the operating model around the agent. The asset is the wedge; the project is the scale-up.</p>
<h3>Pattern 2 — Project Discovery → Asset Rollout</h3>
<div class="my-5 not-prose">
  <div class="flex flex-col sm:flex-row items-stretch gap-2 text-xs">
    <div class="flex-1 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-3">
      <div class="font-bold text-[#156082] uppercase tracking-wider text-[10px] mb-1">Project</div>
      <div class="text-[#0E2841] font-semibold">Value-case sprint + foundations</div>
      <div class="text-gray-600 mt-1">Surfaces 5–6 candidate use cases</div>
    </div>
    <div class="flex items-center justify-center text-[#0E2841] font-bold">→</div>
    <div class="flex-1 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-3">
      <div class="font-bold text-[#F5A623] uppercase tracking-wider text-[10px] mb-1">Asset × N</div>
      <div class="text-[#0E2841] font-semibold">Marketplace tools rolled across functions</div>
      <div class="text-gray-600 mt-1">2 stay project-led; rest configured at lower cost</div>
    </div>
  </div>
</div>
<p>A C-suite sponsor commissions a project-led discovery — usually a value-case sprint plus a data &amp; governance foundations build — and the discovery surfaces five or six use cases. Two are genuinely bespoke and stay project-led; the rest are exactly the shape of existing Marketplace tools and get rolled out asset-led, much faster and at much lower cost.</p>
<h3>Pattern 3 — Parallel Rails</h3>
<div class="my-5 not-prose">
  <div class="space-y-2 text-xs">
    <div class="flex items-stretch gap-2">
      <div class="w-20 sm:w-28 flex-shrink-0 rounded-lg bg-[#156082]/10 border border-[#156082]/40 p-2 flex items-center justify-center font-bold text-[10px] uppercase tracking-wider text-[#156082]">Project rail</div>
      <div class="flex-1 rounded-lg bg-[#156082]/5 border border-[#156082]/30 p-3 text-[#0E2841]">Data foundation rebuild + one flagship custom agent</div>
      <div class="flex items-center px-1 text-[#196B24] font-bold">⇢</div>
      <div class="flex-1 rounded-lg bg-[#196B24]/10 border border-[#196B24]/40 p-3 text-[#0E2841] font-semibold">Streams converge — agents consume governed data</div>
    </div>
    <div class="flex items-stretch gap-2">
      <div class="w-20 sm:w-28 flex-shrink-0 rounded-lg bg-[#F5A623]/10 border border-[#F5A623]/40 p-2 flex items-center justify-center font-bold text-[10px] uppercase tracking-wider text-[#F5A623]">Asset rail</div>
      <div class="flex-1 rounded-lg bg-[#F5A623]/5 border border-[#F5A623]/30 p-3 text-[#0E2841]">3–4 Marketplace tools land in adjacent functions, visible value flowing</div>
      <div class="flex items-center px-1 text-transparent">⇢</div>
      <div class="flex-1 rounded-lg bg-transparent border border-transparent p-3"></div>
    </div>
  </div>
</div>
<p>Larger clients run both paths in parallel from day one: a project-led programme rebuilding the data foundation and one flagship agent, while three or four asset-led tools land in adjacent functions to keep visible value flowing while the foundation work matures. The two streams converge as the foundation comes online and the productized agents start consuming the new governed data.</p>
<h2>The Honest Trade-Offs</h2>
<p>We try to be explicit about what each path costs the client.</p>
<ul>
<li><strong>Cost.</strong> Project-led is more expensive per outcome on day one; asset-led is cheaper per outcome but accumulates configuration and integration cost as the catalogue grows.</li>
<li><strong>Time-to-value.</strong> Asset-led typically delivers first useful output in weeks; project-led in months. For some problems, weeks is structurally impossible — the data isn't ready.</li>
<li><strong>Customization.</strong> Project-led produces IP shaped exactly to the client; asset-led produces IP shaped to the industry, configured to the client. Configuration has limits.</li>
<li><strong>Change-management load.</strong> Project-led carries heavier change-management work because it usually rewires the operating model; asset-led carries lighter (but non-zero) change-management work because it lands inside an existing process.</li>
<li><strong>IP ownership.</strong> Project-led typically produces client-owned IP; asset-led leaves IP with Maven (with the client benefiting from continuous improvement to the catalogue). Sovereign and air-gapped deployments are available on either path.</li>
</ul>
<h2>What This Means for the Engagement Conversation</h2>
<p>For the client, the practical implication is that the first conversation should not be "do you want a project or a tool?" — it should be "where are you on the five factors, and what does the blend look like for the next 6–18 months?" For Maven, the practical implication is that we have to be willing to recommend the asset-led path even when a project-led engagement would be more lucrative in the short term, and willing to recommend the project-led path even when a Marketplace tool exists that is <em>almost</em> the right fit. Credibility on this is the whole point of the POV.</p>
<h2>Recommendations</h2>
<ul>
<li>Run the five-factor decision lens before scoping any new AI initiative. The default sequence ("we'll do a strategy project, then figure out the tools") is the most expensive way to learn whether the problem was generic all along.</li>
<li>Treat the Marketplace as a portfolio, not a procurement catalogue. Adopt one tool, learn from it, and let that learning shape the next project-led move.</li>
<li>For bespoke problems with weak data foundations, do not skip the project-led discovery. Asset-led delivery on broken data is the most common failure mode we see in the GCC enterprises we serve.</li>
<li>For generic problems with strong sponsorship, resist the urge to over-engineer. A configured Marketplace tool in production this quarter beats a custom build that lands next year.</li>
</ul>
<h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>The GenAI Divide: State of AI in Business 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>BCG, <em>Where's the Value in AI?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>McKinsey, <em>The State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>Gartner — Agentic AI &amp; Strategic Technology Trends. <a href="https://www.gartner.com/en/articles/what-are-ai-agents" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>EY, <em>AI Pulse Survey</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>World Economic Forum, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>OECD, <em>AI Principles</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  <li>NIST, <em>AI Risk Management Framework (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  </ol>
    `,
    },
    {
      id: "90-day-mvp",
      slug: "90-day-mvp",
      title: "The 90-Day MVP: How Boutique AI Firms Outpace Tier-1 Consultancies",
      category: "Industry Trends",
      type: "Thought Leadership",
      date: "Updated May 2026",
      readTime: "9 min read",
      author: "Mounir Aris, Senior Partner",
      coverImage: "/images/report-8.png",
      summary: "Why lean, senior-delivery AI firms outperform Tier-1 competitors on the dimension that matters: time from contract to working software in production. Grounded in MIT NANDA, BCG, Stanford HAI evidence on enterprise AI delivery.",
      featured: false,
      tags: ["Boutique", "Delivery", "Speed", "Tier-1"],
      content: `
  <h2>Thesis</h2>
  <p>The conventional logic of professional services — bigger is safer — has been systematically dismantled in the AI era. The firms shipping enterprise AI into production at the rate the GCC actually requires are, with increasing frequency, specialist boutiques delivering senior-led engagements on compressed timelines. The Tier-1 delivery model was optimised for multi-year IT transformation programs with stable requirements; AI delivery is fast, experimental, and judgment-intensive. This piece sets out why size now works against Tier-1 firms in AI delivery, the four levers boutiques can pull that Tier-1s structurally cannot, and the procurement implications for GCC buyers.</p>
  <h2>What the Evidence Says About Time-to-Production</h2>
  <p>MIT NANDA's <em>State of AI in Business 2025</em> finds that the median enterprise GenAI pilot does not reach production at all; only ~5% of integrated systems generate measurable value (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>). BCG's <em>Where's the Value in AI?</em> places only 26% of companies past pilots and 4% at the elite frontier, with elite firms moving from idea to production in months rather than years (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>). Stanford HAI's <em>2025 AI Index</em> documents that smaller, AI-native organisations are deploying production AI faster than large incumbents (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>). Speed is not a vanity metric — it is the variable most closely associated with whether an AI initiative ever reaches production at all.</p>
  <h2>Why Size Works Against Tier-1 Firms in AI Delivery</h2>
  <p>The Tier-1 pyramid — in our delivery experience, partners selling the work and a much larger pool of junior consultants doing it — creates a structural disconnect between the people who shape the engagement and the people who build it. Clients buy access to a Partner with twenty years of experience; the day-to-day delivery team is staffed at meaningfully more junior levels. In AI delivery, where the difference between a working architecture and a non-working one frequently turns on judgment at the point of build, that gap is consequential.</p>
  <h2>Four Levers Boutiques Pull</h2>
  <h3>Lever 1 — Senior Delivery</h3>
  <p>Every Maven engagement has a Partner or Principal as the day-to-day delivery lead — in the working sessions, the architecture reviews, and the troubleshooting calls when something breaks. The seniority sold is the seniority delivered.</p>
  <h3>Lever 2 — Speed to Value</h3>
  <p>Three-day scoping. Three-week prototype. 90-day MVP. Boutiques can mobilise while Tier-1s are still building project-management plans. Business cases expire, executive attention drifts, and political windows close — speed converts these from risks into manageable parameters.</p>
  <h3>Lever 3 — Pricing</h3>
  <p>A lean structure allows senior-led work at rates meaningfully below Tier-1 equivalents — not because corners are cut, but because boutiques are not maintaining the pyramid of junior staff, the global office network, and the marketing budgets that Tier-1 overhead requires.</p>
  <h3>Lever 4 — Partner Leverage</h3>
  <p>Where platform-specific depth is required — Thoughtworks AI/works for SDLC acceleration, hyperscalers for cloud infrastructure, specialist data partners — boutiques bring in best-of-breed and coordinate. Tier-1s have similar relationships, but partner economics tied to the firm's own revenue maximisation, not the client's best outcome.</p>
  <h2>Why Speed Matters More in the GCC</h2>
  <p>National AI programs in the GCC operate on government fiscal years and political cycles. Initiatives that do not produce visible results within a fiscal year risk losing funding, sponsorship, or ministerial support. The window for demonstrating value is often twelve months or less — a timeline that structurally excludes the Tier-1 engagement model from many of the most important GCC AI opportunities. This is Maven AI's house view, not a borrowed claim — and it is the single most important reason we built the firm around the boutique delivery model.</p>
  <h2>The Quality Argument</h2>
  <p>The conventional wisdom that larger teams produce higher-quality outcomes inverts in AI delivery. The highest-quality AI systems are built by small teams of very senior engineers who carry the full technical context in their heads, make consistent architectural decisions, and write code they personally stand behind. The leveraged Tier-1 delivery model — many junior engineers per senior architect — creates structural quality risks we have observed first-hand on remediation engagements: inconsistent architecture across sub-teams, integration bugs at module boundaries, technical debt accumulated by engineers rotated off the project before consequences appear. These are not character flaws; they are predictable consequences of a delivery model optimised for margin.</p>
  <h2>When to Choose a Tier-1 Anyway</h2>
  <p>Intellectual honesty requires the cases where Tier-1 firms genuinely outperform. For very large multi-year programs requiring simultaneous global delivery across many countries and languages, Tier-1 footprint and bench depth provide real value. For procurement situations where political risk demands a name-recognition decision, Tier-1 brand provides cover. For engagements where the deliverable is a strategy document rather than working software, Tier-1 methodology may be worth the price. The distinction that matters: choose Tier-1 when the deliverable is advice, coverage, or coordination; choose a delivery-led boutique when the deliverable is working AI in production.</p>
  <h2>Recommendations for GCC Procurement Leaders</h2>
  <ul>
  <li><strong>Define "done" as working AI in production</strong>, not a completed assessment or a strategy document. Procurement specifications that define completion in terms of deliverable documents structurally favour the Tier-1 model.</li>
  <li><strong>Require senior delivery commitment in the contract</strong>, not in the pitch. Specify the minimum seniority of the day-to-day delivery lead.</li>
  <li><strong>Measure speed to prototype as a selection criterion.</strong> Ask short-listed firms how quickly they can have a working prototype on production data. The answer is one of the most reliable predictors of production delivery capability.</li>
  </ul>
  <h2>Sources &amp; Citations</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>State of AI in Business 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>BCG, <em>Where's the Value in AI?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>Stanford HAI, <em>2025 AI Index Report</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>McKinsey, <em>State of AI</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>EY, <em>AI Pulse Survey</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>Gartner — Strategic Technology Trends for 2025. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>World Economic Forum, <em>Future of Jobs Report 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>NIST, <em>AI Risk Management Framework (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>OECD, <em>AI Principles</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>
      `,
      contentAr: `  <h2>الأطروحة</h2>
  <p>لقد تم تفكيك منطق الخدمات المهنية التقليدية — حيث الحجم الأكبر أكثر أماناً — بشكل منهجي في عصر الذكاء الاصطناعي. الشركات التي تطرح الذكاء الاصطناعي للمؤسسات في الإنتاج بالمعدل الذي يتطلبه مجلس التعاون الخليجي هي، بشكل متزايد، شركات متخصصة boutique توفر انخراطات بقيادة كبار في جداول زمنية مضغوطة. تم تحسين نموذج تسليم Tier-1 من أجل برامج تحويل تكنولوجيا المعلومات متعددة السنوات مع متطلبات مستقرة؛ تسليم الذكاء الاصطناعي سريع وتجريبي وغني بالحكم. يحدد هذا المقال السبب في أن الحجم الآن يعمل ضد شركات Tier-1 في تسليم الذكاء الاصطناعي، والرافعات الأربع التي يمكن لشركات boutique سحبها بالطريقة التي لا يمكن لـ Tier-1s أن تفعلها من الناحية الهيكلية، والآثار الشرائية لمشترين مجلس التعاون الخليجي.</p>
  <h2>ما يقوله الدليل عن الوقت حتى الإنتاج</h2>
  <p>تكتشف ميت ناندا <em>حالة الذكاء الاصطناعي في الأعمال 2025</em> أن تجربة الذكاء الاصطناعي النموذجية للمؤسسة لا تصل إلى الإنتاج على الإطلاق؛ فقط ~5% من الأنظمة المتكاملة تولد قيمة قابلة للقياس (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">ميت ناندا، 2025</a>). يضع تقرير بي سي جي <em>أين القيمة في الذكاء الاصطناعي؟</em> فقط 26% من الشركات بعد التجارب و4% في الحدود النخبة، مع تحرك الشركات النخبة من الفكرة إلى الإنتاج في أشهر بدلاً من السنوات (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">بي سي جي، 2024</a>). توثق ستانفورد إتش إيه آي <em>تقرير مؤشر الذكاء الاصطناعي لعام 2025</em> أن المنظمات الأصغر والمحلية في الذكاء الاصطناعي تنشر الذكاء الاصطناعي الإنتاجي بشكل أسرع من الشركات الكبرى الراسخة (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">ستانفورد إتش إيه آي، 2025</a>). السرعة ليست مقياساً غرورياً — إنها المتغير الأكثر ارتباطاً بما إذا كان مبادرة الذكاء الاصطناعي تصل إلى الإنتاج على الإطلاق.</p>
  <h2>لماذا يعمل الحجم ضد شركات Tier-1 في تسليم الذكاء الاصطناعي</h2>
  <p>يخلق هرم Tier-1 — وفقاً لتجربتنا في التسليم، حيث يبيع الشركاء العمل ويقوم به مجموعة أكبر بكثير من المستشارين المبتدئين — انفصالاً هيكلياً بين من يصوغ الارتباط ومن يبنيه. يشتري العملاء الوصول إلى شريك لديه عشرون عاماً من الخبرة؛ بينما يُشكَّل فريق التسليم اليومي بمستويات أصغر سناً بشكل ملموس. في تسليم الذكاء الاصطناعي، حيث الفرق بين العمارة التي تعمل والعمارة التي لا تعمل غالباً ما يعتمد على الحكم عند نقطة البناء، هذه الفجوة مهمة.</p>
  <h2>الرافعات الأربع التي تسحبها Boutiques</h2>
  <h3>الرافعة 1 — التسليم الكبير</h3>
  <p>كل انخراط في Maven له شريك أو مدير كرئيس تسليم يومي — في جلسات العمل وتقييمات العمارة واستدعاءات استكشاف الأخطاء عند كسر شيء ما. الأقدمية المباعة هي الأقدمية المسلمة.</p>
  <h3>الرافعة 2 — السرعة إلى القيمة</h3>
  <p>نطاق ثلاثة أيام. نموذج أولي لثلاثة أسابيع. 90 يوماً MVP. يمكن لشركات boutique الانتقال بينما لا تزال Tier-1s تبني خطط إدارة المشروع. تنتهي الحالات التجارية، الاهتمام التنفيذي ينجرف، والنوافذ السياسية تغلق — السرعة تحول هذه من مخاطر إلى معاملات قابلة للإدارة.</p>
  <h3>الرافعة 3 — التسعير</h3>
  <p>تسمح البنية الخفيفة بعمل بقيادة كبار بأسعار أقل بكثير من المعادلات Tier-1 — ليس لأن الزوايا مقطوعة، بل لأن boutiques لا تحتفظ بهرم الموظفين الجونيور وشبكة المكتب العالمية وميزانيات التسويق التي تتطلبها النفقات العامة Tier-1.</p>
  <h3>الرافعة 4 — النفوذ الشريك</h3>
  <p>حيث يلزم العمق الخاص بالمنصة — Thoughtworks AI/works لتسريع SDLC، hyperscalers لبنية التحتية السحابية، شركاء بيانات متخصصون — تجلب boutiques أفضل الأنواع والتنسيق. لدى Tier-1s علاقات مماثلة، لكن اقتصاديات الشركاء مرتبطة بتعظيم إيرادات الشركة الخاصة، وليس بأفضل نتيجة للعميل.</p>
  <h2>لماذا تكون السرعة أكثر أهمية في مجلس التعاون الخليجي</h2>
  <p>تعمل برامج الذكاء الاصطناعي الوطنية في مجلس التعاون الخليجي على السنوات المالية الحكومية والدورات السياسية. المبادرات التي لا تنتج نتائج مرئية خلال سنة مالية تخاطر بفقدان التمويل أو الرعاية أو الدعم الوزاري. نافذة إظهار القيمة غالباً ما تكون اثني عشر شهراً أو أقل — جدول زمني يستبعد من الناحية الهيكلية نموذج الانخراط Tier-1 من العديد من فرص الذكاء الاصطناعي الأكثر أهمية في مجلس التعاون الخليجي. هذه وجهة نظر Maven AI الداخلية، وليست مطالبة مستعارة — وهي السبب الأكثر أهمية لبناء الشركة حول نموذج تسليم boutique.</p>
  <h2>حجة الجودة</h2>
  <p>تقلب الحكمة التقليدية التي تقول إن الفريق الأكبر ينتج نتائج أعلى جودة في تسليم الذكاء الاصطناعي. تُبنى أعلى أنظمة الذكاء الاصطناعي جودة بواسطة فريق صغير من مهندسين كبار جداً يحملون السياق التقني الكامل في رؤوسهم، ويتخذون قرارات معمارية متسقة، ويكتبون رمزاً يقفون خلفه شخصياً. نموذج تسليم Tier-1 المرفوع بالعدد — العديد من المهندسين المبتدئين لكل مهندس معماري كبير — يخلق مخاطر جودة هيكلية رصدناها مباشرةً في ارتباطات إصلاحية: عمارة غير متسقة عبر الفرق الفرعية، أخطاء تكامل عند حدود الوحدات، ديون تقنية يتراكم رصيدها بواسطة مهندسين تم تدويرهم خارج المشروع قبل ظهور العواقب. هذه ليست عيوباً في الشخصية؛ إنها نتائج متوقعة من نموذج تسليم محسّن للهامش.</p>
  <h2>متى يجب اختيار Tier-1 على أي حال</h2>
  <p>يتطلب الصراحة الفكرية الحالات التي تتفوق فيها شركات Tier-1 بحق. بالنسبة للبرامج الكبيرة جداً متعددة السنوات التي تتطلب تسليماً عالمياً متزامناً عبر عدة دول ولغات، توفر بصمة Tier-1 وعمق المقاعد قيمة حقيقية. بالنسبة لحالات الشراء حيث المخاطرة السياسية تتطلب قرار الاعتراف بالاسم، توفر علامة Tier-1 غطاء. بالنسبة للانخراطات حيث يكون المسلم الفكري عبارة عن وثيقة إستراتيجية بدلاً من البرنامج العامل، قد تكون طريقة Tier-1 تستحق السعر. التمييز الذي يهم: اختر Tier-1 عندما يكون المسلم النصيحة أو الغطاء أو التنسيق؛ اختر boutique بقيادة التسليم عندما يكون المسلم عمل الذكاء الاصطناعي في الإنتاج.</p>
  <h2>التوصيات لقادة الشراء في مجلس التعاون الخليجي</h2>
  <ul>
  <li><strong>حدّد "تم" كـ عمل الذكاء الاصطناعي في الإنتاج</strong>، وليس تقييماً مكتملاً أو وثيقة إستراتيجية. تحدد المواصفات الشرائية التي تحدد الإكمال من حيث مستندات المسلم تفضل نموذج Tier-1 بشكل هيكلي.</li>
  <li><strong>اطلب الالتزام بالتسليم الكبير في العقد</strong>، وليس في الملعب. حدد الحد الأدنى من أقدمية رئيس التسليم اليومي.</li>
  <li><strong>قياس السرعة إلى النموذج الأولي كمعيار اختيار.</strong> اسأل الشركات المختارة بقائمة قصيرة كم بسرعة يمكن أن يكون لديهم نموذج أولي عامل على بيانات الإنتاج. الإجابة هي واحدة من أكثر المتنبئات الموثوقة لقدرة تسليم الإنتاج.</li>
  </ul>
  <h2>المصادر والمراجع</h2>
  <ol class="sources-list">
  <li>ميت ناندا، <em>حالة الذكاء الاصطناعي في الأعمال 2025</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>بي سي جي، <em>أين القيمة في الذكاء الاصطناعي؟</em>، 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>ستانفورد إتش إيه آي، <em>تقرير مؤشر الذكاء الاصطناعي لعام 2025</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>ماكينزي، <em>حالة الذكاء الاصطناعي</em>، 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>إي واي، <em>مسح نبض الذكاء الاصطناعي</em>، 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>جارتنر — اتجاهات التكنولوجيا الإستراتيجية لعام 2025. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>المنتدى الاقتصادي العالمي، <em>تقرير مستقبل الوظائف 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>المعهد الوطني للمعايير والتكنولوجيا (NIST)، <em>إطار إدارة مخاطر الذكاء الاصطناعي (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>منظمة التعاون الاقتصادي والتنمية (OECD)، <em>مبادئ الذكاء الاصطناعي</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>`,
      contentTr: `  <h2>Tez</h2>
  <p>Profesyonel hizmetlerin geleneksel mantığı — daha büyük daha güvenlidir — yapay zeka döneminde sistematik olarak çöküntüye uğramıştır. Kurumsal yapay zekayı üretim ortamına GCC'nin gerektirdiği hızda gönderen firmalar, gittikçe artan bir şekilde, sıkıştırılmış zaman çizelgelerinde kıdemli liderliğe sahip engelli danışmanlık şirketleridir. Tier-1 teslimat modeli, istikrarlı gereksinimlerle çok yıllı BT dönüşüm programları için optimize edilmiştir; yapay zeka teslimatı hızlı, deneyseldir ve yargı yoğundur. Bu makale, Tier-1 firmaları yapay zeka teslimatında neden boyutun işlemlerine karşı çalıştığını, danışmanlık firmalarının çekebileceği dört kaldıracı belirtir Tier-1'lerin yapısal olarak alamayacağı ve GCC alıcıları için satın alma etkilerini açıklar.</p>
  <h2>Üretime Kalan Süre Hakkında Kanıtlar Neler Diyor</h2>
  <p>MIT NANDA'nın <em>2025 Işletmede Yapay Zeka Durumu</em> raporuna göre, kurumsal yapay zeka pilot programının medyan değeri hiçbir zaman üretime ulaşmaz; entegre sistemlerin yalnızca ~%5'i ölçülebilir değer üretir (<a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">MIT NANDA, 2025</a>). BCG'nin <em>Yapay Zekada Değer Nerede?</em> raporu, şirketlerin yalnızca %26'sinin pilot aşamalarından sonra ve %4'ünün elit sınırda olduğunu, elit firmaların fikraden üretime aylar içinde taşındığını belirtir (<a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">BCG, 2024</a>). Stanford HAI'nin <em>2025 Yapay Zeka İndeksi Raporu</em>, daha küçük, yapay zeka tarafından yerel bir kütüphanede kurulan kuruluşların büyük yerleşik şirketlerden daha hızlı bir üretime dağıtılan yapay zeka değerini konumlandığını belgelemektedir (<a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">Stanford HAI, 2025</a>). Hız bir gurur metriği değildir — yapay zeka inisiyatifinin hiç üretime ulaşıp ulaşmadığı ile en yakından ilgili değişkendir.</p>
  <h2>Tier-1 Firmalarında Neden Boyut Yapay Zeka Teslimatında İşlemlerine Karşı Çalışıyor</h2>
  <p>Tier-1 piramidi — teslim deneyimimize göre, işi satan ortaklar ile onu yapan çok daha geniş bir kıdemsiz danışman havuzu — çalışmayı şekillendirenler ile inşa edenler arasında yapısal bir kopukluk oluşturur. Müşteriler yirmi yıllık deneyime sahip bir Ortakla erişim satın alır; günlük teslimat ekibi ise anlamlı şekilde daha kıdemsiz seviyelerde kadrolanır. Yapay zeka teslimatında, çalışan bir mimari ile çalışmayan bir mimari arasındaki fark sıklıkla yapı anındaki yargıya bağlı olduğundan, bu fark sonuç doğurur.</p>
  <h2>Danışmanlık Firmalarının Çekebileceği Dört Kaldıraç</h2>
  <h3>Kaldıraç 1 — Kıdemli Teslimat</h3>
  <p>Her Maven görüşmesi, çalışma oturumlarında, mimari incelemelerinde ve bir şey kırıldığında sorun giderme çağrılarında günlük teslimat lideri olarak bir Ortak veya Müdürü vardır. Satılan kıdemlilik teslimat edilen kıdemliliktir.</p>
  <h3>Kaldıraç 2 — Değere Yönelik Hız</h3>
  <p>Üç gün kapsama. Üç hafta prototip. 90 günlük MVP. Danışmanlık firmaları Tier-1'lerin hala proje yönetimi planlarını oluştururken harekete geçebilirler. İş vakaları sona erer, yönetici dikkati kayıyor ve siyasi pencereler kapanır — hız bunları risklerden yönetilebilir parametrelere dönüştürür.</p>
  <h3>Kaldıraç 3 — Fiyatlandırma</h3>
  <p>Hafif bir yapı, Tier-1 eşdeğerlerinin anlamlı bir şekilde altında kıdemli liderliğe sahip çalışma yapılmasını sağlar — köşeler kesildiği için değil, danışmanlık firmaları genç personel piramidini, küresel ofis ağını ve Tier-1 ek yükünün gerektirdiği pazarlama bütçelerini koruyan bir kuruluş olduğu için.</p>
  <h3>Kaldıraç 4 — Ortak Kaldıraç</h3>
  <p>Platform spesifik derinlik gerekli olduğu yerde — SDLC hızlandırması için Thoughtworks AI/works, bulut altyapısı için hiper ölçekleyiciler, uzman veri ortakları — danışmanlık firmaları sınıf ve koordinasyon getirirler. Tier-1'lerin benzer ilişkileri vardır, ancak ortak ekonomikler firmanın kendi gelir maksimizasyonuna bağlı olduğunda, müşterinin en iyi sonucunu değil.</p>
  <h2>Neden Hız GCC'de Daha Önemli</h2>
  <p>GCC'deki ulusal yapay zeka programları hükümet mali yılları ve siyasi döngülerde çalışır. Bir mali yıl içinde görünür sonuçlar üretmeyen inisiyatifler finansman, sponsorluk veya bakanlar desteği kaybetme riski altındadır. Değer gösterme penceresi sıklıkla on iki ay veya daha az olur — Tier-1 görüşme modelini yapısal olarak GCC'nin en önemli yapay zeka fırsatlarının çoğundan hariç tutacak bir zaman çizelgesi. Bu Maven AI'nin kendi görüşü, ödünç alınmış bir iddia değildir — ve firmayı danışmanlık teslimat modeli etrafında inşa etmemizin en önemli sebebi budur.</p>
  <h2>Kalite Argümanı</h2>
  <p>Daha büyük takımların daha yüksek kaliteli sonuçlar ürettiği yönündeki geleneksel bilgelik, yapay zeka teslimatında tersine döner. En yüksek kaliteli yapay zeka sistemleri, tüm teknik bağlamı kafalarında taşıyan, tutarlı mimari kararlar veren ve şahsen arkasında durdukları kodu yazan çok kıdemli mühendislerden oluşan küçük takımlar tarafından inşa edilir. Tier-1'in kaldıraçlı teslim modeli — bir kıdemli mimar başına çok sayıda kıdemsiz mühendis — iyileştirme çalışmalarımızda doğrudan gözlemlediğimiz yapısal kalite risklerini doğurur: alt takımlar arasında tutarsız mimari, modül sınırlarında entegrasyon hataları, sonuçlar görülmeden projeden döndürülen mühendislerin biriktirdiği teknik borç. Bunlar karakter kusurları değildir; marj için optimize edilmiş bir teslim modelinin öngörülebilir sonuçlarıdır.</p>
  <h2>Yine de Bir Tier-1'i Ne Zaman Seçeceğiz</h2>
  <p>Entelektüel dürüstlük, Tier-1 firmaların gerçekten ön perforans yaptığı vakaları gerektirir. Çok geniş, çok yıllı programlar için birçok ülke ve dilde aynı anda küresel teslimat gerektiren, Tier-1 ayak izi ve tezgah derinliği gerçek değer sağlar. Siyasi risk karar vermede bir ad tanıma gerektiren satın alma durumları için Tier-1 markası kapak sağlar. Teslimattesi bir strateji belgesi yerine çalışan yazılım olduğu görüşmeler için, Tier-1 metodolojisi fiyata değer olabilir. Önemli ayrım: danışmanlık teslimatı modelini seçin; danışmanlık firmasında çalışan yapay zeka üretime yapılır seçin.</p>
  <h2>GCC Tedarik Liderleri İçin Tavsiyeler</h2>
  <ul>
  <li><strong>"Yapılmış" olarak üretime yapay zeka çalıştırmayı tanımlayın</strong>, tamamlanmış bir değerlendirme veya strateji belgesi değil. Teslimattaki tamamlama koşullarını belge temelinde tanımlayan tedarik spesifikasyonları Tier-1 modeli yapısal olarak tercih eder.</li>
  <li><strong>Sözleşmede kıdemli teslimat taahhüdü gerektirir</strong>, haraç içinde değil. Günlük teslimat liderinin en düşük kıdemliliğini belirtin.</li>
  <li><strong>Prototip hızını seçim kriteri olarak ölçün.</strong> Kısa listedeki firmalardan, üretime veri üzerinde çalışan bir prototip ne kadar hızlı bir şekilde yapabilecekleri hakkında soru sorun. Cevap, üretime teslimat yeteneğinin en güvenilir tahmin edicilerinden biridir.</li>
  </ul>
  <h2>Kaynaklar ve Referanslar</h2>
  <ol class="sources-list">
  <li>MIT NANDA, <em>2025 Işletmede Yapay Zeka Durumu</em>. <a href="https://nanda.media.mit.edu/ai_report_2025.pdf" target="_blank" rel="noopener noreferrer">nanda.media.mit.edu</a></li>
  <li>BCG, <em>Yapay Zekada Değer Nerede?</em>, 2024. <a href="https://www.bcg.com/publications/2024/wheres-value-in-ai" target="_blank" rel="noopener noreferrer">bcg.com</a></li>
  <li>Stanford HAI, <em>2025 Yapay Zeka İndeksi Raporu</em>. <a href="https://hai.stanford.edu/ai-index/2025-ai-index-report" target="_blank" rel="noopener noreferrer">hai.stanford.edu</a></li>
  <li>McKinsey, <em>Yapay Zeka Durumu</em>, 2024. <a href="https://www.mckinsey.com/capabilities/quantumblack/our-insights/the-state-of-ai" target="_blank" rel="noopener noreferrer">mckinsey.com</a></li>
  <li>EY, <em>Yapay Zeka Nabzı Anketi</em>, 2024. <a href="https://www.ey.com/en_gl/insights/ai" target="_blank" rel="noopener noreferrer">ey.com</a></li>
  <li>Gartner — 2025 İçin Stratejik Teknoloji Eğilimleri. <a href="https://www.gartner.com/en/newsroom/press-releases/2024-10-21-gartner-identifies-the-top-10-strategic-technology-trends-for-2025" target="_blank" rel="noopener noreferrer">gartner.com</a></li>
  <li>WEF, <em>Geleceğin İşleri Raporu 2025</em>. <a href="https://www.weforum.org/publications/the-future-of-jobs-report-2025/" target="_blank" rel="noopener noreferrer">weforum.org</a></li>
  <li>NIST, <em>Yapay Zeka Risk Yönetimi Çerçevesi (AI RMF 1.0)</em>. <a href="https://www.nist.gov/itl/ai-risk-management-framework" target="_blank" rel="noopener noreferrer">nist.gov</a></li>
  <li>OECD, <em>Yapay Zeka İlkeleri</em>. <a href="https://oecd.ai/en/ai-principles" target="_blank" rel="noopener noreferrer">oecd.ai</a></li>
  </ol>`,
    },
  ];

  
type IndustrySource = { name: string; year: number; url: string };

const SOURCES = {
  pwcImpact: {
    name: "PwC Middle East — The potential impact of AI in the Middle East",
    year: 2018,
    url: "https://www.pwc.com/m1/en/publications/potential-impact-artificial-intelligence-middle-east.html",
  },
  strategyAndGenAI: {
    name: "Strategy& — Reshaping the Middle East: A CEO's playbook to win the $23.5B GenAI opportunity",
    year: 2023,
    url: "https://www.strategyand.pwc.com/m1/en/strategic-foresight/sector-strategies/technology/reshaping.html",
  },
  sdaiaNSDAI: {
    name: "SDAIA — National Strategy for Data & AI",
    year: 2020,
    url: "https://sdaia.gov.sa/en/SDAIA/SdaiaStrategies/Pages/NationalStrategyForDataAndAI.aspx",
  },
  eyTelcoLegacy: {
    name: "EY — Key strategies for modernizing OSS transformation",
    year: 2024,
    url: "https://www.ey.com/en_gl/insights/telecommunications",
  },
  mordorICT: {
    name: "Mordor Intelligence — GCC ICT Market 2025–2030",
    year: 2025,
    url: "https://www.mordorintelligence.com/industry-reports/gcc-ict-market",
  },
  imarcGccAI: {
    name: "IMARC Group — GCC Artificial Intelligence Market 2025–2033",
    year: 2024,
    url: "https://www.imarcgroup.com/gcc-artificial-intelligence-market",
  },
  mckinseyGccCIB: {
    name: "McKinsey — Five accelerators for corporate and investment banking in the GCC",
    year: 2025,
    url: "https://www.mckinsey.com/industries/financial-services/our-insights",
  },
  mckinseyBankingReview: {
    name: "McKinsey — Global Banking Annual Review 2025",
    year: 2025,
    url: "https://www.mckinsey.com/industries/financial-services/our-insights/global-banking-annual-review",
  },
  bcgRetailBankingAI: {
    name: "BCG — Retail banking AI profit potential",
    year: 2025,
    url: "https://www.bcg.com/press/5november2025-300-billion-profit-potential-retail-banks-via-ai",
  },
  aramcoAI: {
    name: "Saudi Aramco — Building the AI future",
    year: 2024,
    url: "https://www.aramco.com/en/what-we-do/energy-innovation/digitalization",
  },
  aramcoGroq: {
    name: "Groq — Saudi Arabia announces $1.5B expansion to fuel AI-powered economy with Groq (press release)",
    year: 2025,
    url: "https://groq.com/newsroom/saudi-arabia-announces-1-5-billion-expansion-to-fuel-ai-powered-economy-with-ai-tech-leader-groq",
  },
  mckinseyRetailPersonalization: {
    name: "McKinsey — The state of retail personalization",
    year: 2024,
    url: "https://www.mckinsey.com/industries/retail/our-insights/the-state-of-retail-personalization",
  },
  saudiTourism: {
    name: "Saudi Tourism Authority — Vision 2030 tourism pillar",
    year: 2024,
    url: "https://www.sta.gov.sa/en/vision2030",
  },
  pifGigaProjects: {
    name: "Public Investment Fund — Giga-Projects portfolio",
    year: 2024,
    url: "https://www.pif.gov.sa/en/our-investments/",
  },
  saudiEvVision: {
    name: "Bloomberg — Saudi Arabia to Start Electric-Vehicle Push in Capital Riyadh",
    year: 2021,
    url: "https://www.bloomberg.com/news/articles/2021-10-23/saudi-arabia-to-start-electric-vehicle-push-in-capital-riyadh",
  },
  saudiEvLucid: {
    name: "Arab News — Lucid becomes first global automotive manufacturer to join 'Made in Saudi' program",
    year: 2024,
    url: "https://www.arabnews.com/node/2585574/business-economy",
  },
  saudiEvCeer: {
    name: "Arab News — Saudi Arabia's EV dreams transitioning to reality, say CEER and Lucid officials",
    year: 2024,
    url: "https://www.arabnews.com/node/2455031/business-economy",
  },
  mitNanda: {
    name: "MIT NANDA — The GenAI Divide: State of AI in Business 2025",
    year: 2025,
    url: "https://nanda.media.mit.edu/ai_report_2025.pdf",
  },
  bcgValueAI: {
    name: "BCG — Where's the Value in AI?",
    year: 2024,
    url: "https://www.bcg.com/publications/2024/wheres-value-in-ai",
  },
} satisfies Record<string, IndustrySource>;

export const SITE_SOURCES = SOURCES;

export const industries = [
  {
    id: "public-sector",
    title: "Public Sector",
    subtitle: "Accelerating national vision through production AI",
    icon: "Building2",
    color: "#156082",
    heroStat: "$135B",
    heroStatLabel: "projected AI contribution to Saudi Arabia's GDP by 2030 — the largest country-level contribution in the Middle East",
    heroStatSource: SOURCES.pwcImpact,
    description: "GCC governments are not just adopting AI — they are building national AI infrastructure. Vision 2030, UAE AI Charter, Qatar AI Roadmap — these programs represent the largest coordinated AI investment in public sector history. Maven AI is built to deliver in this environment.",
    challenges: [
      "Sovereign data requirements preclude public cloud deployment for many critical workloads",
      "Complex organizational structures and approval chains slow delivery timelines",
      "Arabic language and regional context requirements for AI models and datasets",
      "National security classification requirements for sensitive government AI",
      "Procurement complexity and long contracting cycles typical of government clients",
    ],
    approach: "Maven AI's public sector practice is specifically designed for GCC government delivery. Our on-prem and sovereign AI capability addresses data classification requirements. Our senior delivery model navigates the organizational complexity of large government entities. Our regional relationships, anchored by Khalid Al Khudairi, open doors and maintain momentum through procurement cycles.",
    caseVignette: {
      title: "National Public Safety AI",
      framing: "How agentic AI can deliver value for a national-security-classified workload — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A national authority operating across hundreds of field units needs to modernize incident management with AI-assisted dispatch and evidence processing — deployed entirely on sovereign infrastructure, with no operational data leaving the national perimeter.",
      approach: "An agentic platform deployed on national-cloud infrastructure, integrating with ANPR, communications, and case-management estates. Senior delivery navigates classification reviews, organizational sign-offs, and procurement gates that defeat most outside vendors.",
      outcome: "Public-safety AI deployments globally report meaningful reductions in incident-to-dispatch latency and gains in evidence-processing throughput. For GCC governments, the defining wins are usually full sovereign-data compliance and an audit trail credible to the regulator — not a single point KPI.",
    },
    stats: [
      { value: "$23.5B", label: "annual GenAI economic impact projected across the GCC by 2030", source: SOURCES.strategyAndGenAI },
      { value: "Top 15", label: "Saudi Arabia's stated AI global-ranking ambition under the National Strategy for Data & AI", source: SOURCES.sdaiaNSDAI },
      { value: "Arabic-first", label: "AI capability required across the six GCC markets — not a feature most global vendors ship by default" },
    ],
  },
  {
    id: "telecom",
    title: "Telecommunications",
    subtitle: "From legacy infrastructure to AI-native operations",
    icon: "Wifi",
    color: "#F5A623",
    heroStat: "60–80%",
    heroStatLabel: "share of IT budgets globally consumed by maintaining existing systems (cross-industry, with telcos at the higher end)",
    heroStatSource: SOURCES.eyTelcoLegacy,
    description: "GCC telecoms are at a critical inflection point. 5G monetization requires AI-native operations. Legacy system debt is consuming 60–80% of IT budgets. Customer experience competition is intensifying. Maven AI brings the combination of legacy modernization capability and agentic AI delivery that telecoms need.",
    challenges: [
      "Massive legacy estates — Siebel CRM, custom BSS/OSS, COBOL billing — consuming IT budget at unsustainable levels",
      "5G monetization requires AI-native network operations and customer experience capabilities not present in current systems",
      "High customer acquisition and retention costs driving need for AI-powered personalization and churn prevention",
      "Data quality and integration challenges across siloed operational, customer, and network data domains",
      "On-prem delivery requirements for sensitive network operations data",
    ],
    approach: "Maven AI's telecom practice combines two distinctive capabilities: our spec-from-legacy methodology for cost-effective legacy modernization, and our agentic AI delivery for network operations and customer experience. We have delivered, with Thoughtworks AI/works, the most complex telecom legacy modernization programs in the GCC.",
    caseVignette: {
      title: "Legacy CRM / BSS Modernization at Scale",
      framing: "How spec-from-legacy and agentic AI can deliver value for a national telecom — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A national telecom operates a 15+ year-old CRM with millions of lines of bespoke customization, serving tens of millions of subscribers. The board has approved migration — but it must happen on-prem, without service disruption, and without a five-year nightmare.",
      approach: "AI-driven spec extraction from the legacy estate, agentic AI to assist cloud-native rebuild, and continuous on-prem deployment to preserve sovereignty for network and customer data — delivered by senior engineers on every call.",
      outcome: "Public benchmarks for AI-assisted legacy modernization report meaningful reductions in CRM operational cost and substantially compressed delivery timelines versus traditional rewrite projects. The operational headroom unlocked is typically what funds the operator's broader AI agenda.",
    },
    stats: [
      { value: "$222B", label: "projected GCC ICT market size by 2030", source: SOURCES.mordorICT },
      { value: "$22.4B", label: "projected total GCC AI market size by 2033", source: SOURCES.imarcGccAI },
      { value: "Operator-led", label: "every major GCC national telecom (stc, e&, du, Ooredoo, Zain, Mobily) has publicly committed to AI / agentic AI roadmaps" },
    ],
  },
  {
    id: "financial-services",
    title: "Financial Services",
    subtitle: "AI-grade governance for the region's most demanding regulators",
    icon: "TrendingUp",
    color: "#F5A623",
    heroStat: "$90–100B",
    heroStatLabel: "projected GCC corporate & investment banking revenue by 2030",
    heroStatSource: SOURCES.mckinseyGccCIB,
    description: "GCC financial services institutions operate under some of the world's most demanding AI governance requirements — SAMA guidelines, CBUAE frameworks, and PDPL compliance — while simultaneously investing in AI at a pace that matches global financial centers. Maven AI brings the rare combination of deep financial services domain knowledge and AI governance expertise.",
    challenges: [
      "SAMA and CBUAE AI governance requirements demand model explainability, fairness testing, and audit trails that most organizations are not yet able to produce",
      "Islamic finance structures create unique AI modeling challenges not addressed by standard financial AI frameworks",
      "Customer data quality and identity mastering issues across legacy core banking and CRM systems prevent AI deployment",
      "Capital markets AI requires integration with global data infrastructure while maintaining sovereign data compliance",
      "Regulatory reporting automation faces challenges from fragmented data systems and incomplete data lineage",
    ],
    approach: "Maven AI's financial services practice is anchored in two capabilities: regulatory-grade AI governance (aligned to SAMA, CBUAE, and PDPL requirements), and data platform modernization that makes AI deployment technically feasible. Our governance work is designed to meet regulator expectations on the first review — not the third.",
    caseVignette: {
      title: "AI Governance Readiness for a Regional Bank",
      framing: "How agentic AI and disciplined governance can deliver value for a regulated bank — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A GCC bank running a portfolio of production AI models in credit, fraud, and customer experience needs governance documentation, model inventory, explainability, fairness testing, and audit trails ready for SAMA and CBUAE examination — at examination-grade quality, not best-effort.",
      approach: "A full model-inventory exercise, an explainability and bias-testing framework aligned to SAMA AI Guidelines, and an audit-trail layer that turns the bank's existing AI estate into examination-ready material — designed to be reused across the rest of the AI program.",
      outcome: "GCC regulators are tightening AI governance expectations rapidly. Banks that arrive at examinations with full model lineage, monitoring evidence, and bias testing in place tend to convert that work into a reusable governance template across the rest of their AI program — turning compliance cost into platform leverage.",
    },
    stats: [
      { value: "Up to 20%", label: "banking-industry cost reduction projected from AI adoption", source: SOURCES.mckinseyBankingReview },
      { value: "$370B+", label: "additional annual profit potential from AI for retail banks worldwide by 2030", source: SOURCES.bcgRetailBankingAI },
      { value: "SAMA + CBUAE", label: "two of the most prescriptive AI governance regimes for banks globally — explainability, fairness testing, and audit trails are mandated, not optional" },
    ],
  },
  {
    id: "energy-commodities",
    title: "Energy & Commodities",
    subtitle: "Powering the energy transition with production AI",
    icon: "Zap",
    color: "#156082",
    heroStat: "$1.8B",
    heroStatLabel: "AI-driven Technology Realized Value reported by Saudi Aramco in 2024 alone",
    heroStatSource: SOURCES.aramcoAI,
    description: "Aramco, ADNOC, KPC, QatarEnergy, and the region's commodities trading houses are deploying AI at industrial scale — across upstream operations, refinery optimization, trading floors, and the energy transition portfolio. Sovereignty, safety classification, and decades-old operational technology make this the most demanding industrial AI environment in the GCC. Maven AI is built for it.",
    challenges: [
      "Operational technology (OT) data is siloed across upstream, midstream, and downstream estates — difficult to unify for AI without compromising plant safety",
      "Sovereign and national-security classifications on energy infrastructure data preclude public cloud AI for the most valuable workloads",
      "Predictive maintenance and reliability AI must integrate with decades-old SCADA, DCS, and PLC systems that were never designed for streaming telemetry",
      "Energy transition mandates demand new AI capabilities for hydrogen production, carbon capture, methane monitoring, and renewable yield optimization",
      "Commodities trading AI requires real-time low-latency processing on regulated market data — with auditability and explainability that satisfy compliance",
    ],
    approach: "Maven AI's energy practice combines industrial AI engineering with on-prem and sovereign deployment capability. We deploy agentic AI across the energy value chain — upstream production optimization, refinery reliability, downstream supply, commodities trading, and emerging energy-transition workloads — meeting the security and classification requirements of national energy champions. Our spec-from-legacy methodology unlocks SCADA and DCS estates that have resisted modernization for years.",
    caseVignette: {
      title: "Refinery Reliability AI",
      framing: "How spec-from-legacy and agentic AI can deliver value across an industrial energy estate — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A national oil company needs to modernize predictive maintenance across multiple refinery complexes, integrating decades-old SCADA, DCS, and PLC estates with on-prem AI inference and continuous learning from operational telemetry — without ever breaching plant safety boundaries.",
      approach: "Spec-from-legacy extraction of refinery control logic, agentic AI deployed on sovereign on-prem infrastructure, with continuous learning from cross-site reliability patterns and tight integration with operations and safety teams.",
      outcome: "Industrial AI deployments at IOCs and NOCs report material reductions in unplanned downtime and avoided-loss savings measured in tens of millions of dollars annually. For GCC NOCs, the equally important outcome is full on-prem compliance with national energy data classification.",
    },
    stats: [
      { value: "442", label: "AI use cases identified by Aramco, with 200+ solutions already deployed across operations", source: SOURCES.aramcoAI },
      { value: "$1.5B", label: "Aramco's strategic investment in Groq for AI compute infrastructure", source: SOURCES.aramcoGroq },
      { value: "Sovereign", label: "energy-infrastructure AI workloads carry national-security classifications that preclude public cloud — on-prem and sovereign delivery is mandatory, not preferred" },
    ],
  },
  {
    id: "retail-consumer",
    title: "Retail & Consumer Products",
    subtitle: "From dukan to D2C — AI-native retail for the GCC consumer",
    icon: "ShoppingBag",
    color: "#F5A623",
    heroStat: "$23.5B",
    heroStatLabel: "annual GenAI economic impact projected across the GCC by 2030 (all sectors combined)",
    heroStatSource: SOURCES.strategyAndGenAI,
    description: "GCC retail is in dramatic flux. Q-commerce platforms, premium D2C brands, and digitally-native marketplaces are taking share from established hypermarket and department-store groups, while LuLu, Almarai, Al-Futtaim, and the region's family-owned conglomerates modernize legacy ERP and merchandising systems they have run for two decades. Maven AI delivers AI across both ends of this transition — Arabic-first, GCC-native.",
    challenges: [
      "Customer data is fragmented across physical stores, e-commerce, marketplaces, and loyalty platforms — preventing the unified view that personalization requires",
      "Arabic-first NLP for product search, customer service, and review analysis remains underdeveloped relative to English equivalents",
      "Demand forecasting must absorb Ramadan, Eid, back-to-school, and tourism-driven surges with limited clean historical data",
      "Localization and consumer-protection compliance vary materially across the six GCC markets — what works in UAE often fails in KSA",
      "Legacy SAP, Oracle, and JDA merchandising estates consume IT budget while AI-native competitors scale unencumbered by technical debt",
    ],
    approach: "Maven AI's retail practice pairs spec-from-legacy modernization for established players with agentic AI delivery for personalization, demand sensing, dynamic pricing, and conversational commerce. Our Arabic-first capability is uniquely valuable in retail, where customer engagement is a core competitive lever — and where most regional AI providers default to English-only models that fail on real GCC consumer language.",
    caseVignette: {
      title: "Q-Commerce Personalization",
      framing: "How agentic AI can deliver value for a quick-commerce or marketplace platform serving GCC consumers — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A GCC quick-commerce or marketplace platform serving millions of monthly active users across multiple markets needs Arabic-first personalization built into the recommendation, search, and conversational layers — and an honest path off the English-defaulted incumbents.",
      approach: "An agentic recommendation system trained on Arabic-first product taxonomy and observed shopping behaviour, deployed alongside loyalty and dynamic-pricing platforms with continuous A/B testing.",
      outcome: "Public benchmarks across global retail report 5–15% revenue uplift and meaningful basket-size gains from AI-driven personalization. For GCC platforms, the differentiator is whether the personalization actually works in Arabic — the difference between a published case study and an undifferentiated launch.",
    },
    stats: [
      { value: "$22.4B", label: "projected total GCC AI market size by 2033, with retail among the fastest-growing application areas", source: SOURCES.imarcGccAI },
      { value: "5–15%", label: "revenue uplift global retailers report from AI-driven personalization", source: SOURCES.mckinseyRetailPersonalization },
      { value: "Arabic-first", label: "required for real GCC consumer engagement — most off-the-shelf NLP defaults to English-only and fails on regional dialect" },
    ],
  },
  {
    id: "travel-hospitality",
    title: "Travel & Hospitality",
    subtitle: "AI for the GCC's tourism megaprojects and global hospitality brands",
    icon: "Plane",
    color: "#0F9ED5",
    heroStat: "150M",
    heroStatLabel: "Saudi Arabia's revised annual visitor target by 2030",
    heroStatSource: SOURCES.saudiTourism,
    description: "NEOM, Diriyah, Red Sea Project, Qiddiya, AlUla — the GCC's tourism ambitions are unprecedented in scale and pace. National carriers (Emirates, Qatar Airways, Saudia, Etihad) operate at the leading edge of global aviation. Established hospitality groups (Jumeirah, Rotana, Mövenpick) compete intensely for the high-margin regional and inbound traveller. Maven AI delivers the AI behind these flagship experiences — for both greenfield megaprojects and legacy modernization.",
    challenges: [
      "Tourism megaproject operating models are being designed greenfield — no playbook exists for AI-native hospitality at this scale or with this guest profile",
      "Multi-language guest engagement (Arabic, English, Mandarin, Russian, Hindi) demands sophisticated conversational AI that mainstream platforms cannot deliver",
      "Yield management and dynamic pricing AI must respect Islamic finance principles, regional regulatory price controls, and government tourism mandates",
      "Loyalty, CRM, and booking systems are fragmented across hotel groups, airlines, and ground services even within the same parent conglomerate",
      "Distinctive guest privacy expectations in luxury, royal, and high-net-worth hospitality preclude public cloud AI for the most valuable customer data",
    ],
    approach: "Maven AI partners with tourism megaproject developers and established hospitality groups to design and ship agentic AI for guest experience, revenue optimization, and operational excellence. Our work spans concept-design AI for greenfield destinations through to legacy modernization for groups operating across 30+ properties. Sovereign on-prem deployment is available where guest privacy classification demands it.",
    caseVignette: {
      title: "Megaproject Guest Experience AI",
      framing: "How agentic AI can deliver value for a tourism megaproject or hospitality group — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A tourism developer with multiple luxury properties opening over a 24-month window needs an agentic guest experience platform across booking, concierge, F&B, transport, and activity curation — in four or more languages, with full data sovereignty for high-net-worth guest data.",
      approach: "An agentic platform that integrates booking, concierge, F&B, transport, and activity curation, with sovereign on-prem deployment for guest data, a multi-lingual conversational layer, and revenue-management agents tied to property occupancy.",
      outcome: "Hospitality AI deployments globally report high automation rates on routine guest requests and meaningful uplift in measured guest satisfaction. For GCC megaprojects, the harder outcomes — language coverage, sovereign data compliance, multi-property orchestration — are the ones that determine whether the platform actually opens with the property.",
    },
    stats: [
      { value: "$500B+", label: "NEOM's stated investment commitment via the Public Investment Fund", source: SOURCES.pifGigaProjects },
      { value: "70M", label: "inbound international visitor target for Saudi Arabia by 2030", source: SOURCES.saudiTourism },
      { value: "10%", label: "tourism's targeted contribution to Saudi GDP by 2030", source: SOURCES.saudiTourism },
    ],
  },
  {
    id: "automotive",
    title: "Automotive",
    subtitle: "Building the GCC's mobility future, from EV mandates to autonomous",
    icon: "Car",
    color: "#E97132",
    heroStat: "30%",
    heroStatLabel: "Saudi Arabia's electric-vehicle adoption target for Riyadh by 2030",
    heroStatSource: SOURCES.saudiEvVision,
    description: "The GCC automotive landscape is being rebuilt. Saudi Arabia's 30% EV target by 2030, Lucid's local manufacturing, the Ceer national EV brand, and UAE autonomous-mobility programs in Dubai and Abu Dhabi are reshaping demand. Established dealer groups (Al-Futtaim, Petromin, Juffali, AlGhanim) are modernizing legacy DMS estates while EV-natives build greenfield platforms. Maven AI delivers AI across the entire value chain.",
    challenges: [
      "Connected-vehicle telemetry generates data volumes that legacy dealer management systems cannot ingest, store, or monetize at scale",
      "EV battery health, charging, and energy-grid AI requires integration across vehicle, charging infrastructure, and utility systems that no single vendor controls",
      "Autonomous mobility pilots demand sovereign AI compliance for safety-critical systems, plus Arabic road-sign and pedestrian-context recognition that off-the-shelf models lack",
      "Aftermarket and service AI must navigate the complex multi-brand, multi-region dealer network dynamics that define GCC automotive distribution",
      "Talent shortage in automotive-specific AI engineering — most regional AI talent has come from BFSI or telecom, with limited deep-domain automotive exposure",
    ],
    approach: "Maven AI's automotive practice supports OEMs, national EV champions, dealer groups, and mobility-as-a-service operators with agentic AI for connected vehicles, predictive service, and customer experience. Our spec-from-legacy capability accelerates DMS and aftermarket modernization, while our sovereign delivery model serves autonomous and ADAS programs that cannot leave the national perimeter.",
    caseVignette: {
      title: "Connected Fleet Telemetry AI",
      framing: "How agentic AI can deliver value for a multi-brand automotive group — illustrative scenario, not a delivered Maven AI engagement.",
      challenge: "A regional automotive group with multiple OEM brands needs to ingest connected-vehicle telemetry from a large fleet, drive predictive service and parts forecasting, and run personalized customer-engagement workflows across the dealer network — without forcing a single-vendor lock-in across brands.",
      approach: "A multi-brand telemetry pipeline feeding agentic AI for service prediction and parts forecasting, with a customer-engagement agent layer driving proactive outreach for service intervals, recalls, and trade-in opportunities.",
      outcome: "Automotive aftermarket AI deployments globally report material increases in service revenue per vehicle and parts-forecast accuracy gains in the high-teens to mid-20s percent range. For GCC groups, the platform's payoff depends on whether it can serve the multi-brand, multi-region dealer network without forcing a single-vendor lock-in.",
    },
    stats: [
      { value: "$50B+", label: "Saudi Arabia's stated commitment to EV manufacturing and infrastructure under Vision 2030", source: SOURCES.saudiEvLucid },
      { value: "500K", label: "annual EV production capacity Saudi Arabia is targeting by 2030 across Lucid, Ceer and joint ventures", source: SOURCES.saudiEvCeer },
      { value: "$20B", label: "targeted EV-sector contribution to Saudi GDP by 2030", source: SOURCES.saudiEvLucid },
    ],
  },
];

// Canonical, source-cited homepage hero stats — drawn from the same body of
// published GCC AI research the industries pages cite. The numbers live in
// `@workspace/maven-content` so the chat assistant can reference them too.
export const stats = homepageStats;

export const operatingModel = {
  rings: [
    {
      name: "CORE",
      description: "Senior partners providing strategy, delivery, and account leadership on every engagement. On every call. On every deliverable.",
      headcount: "Day 1 — 2 FTE",
      color: "#0E2841",
    },
    {
      name: "RING 1",
      description: "Founding engineering hires: Engineering Lead and Data & Governance Lead. Agentic AI engineers added as we scale. Technical profiles only in Year 1.",
      headcount: "Year 1 — 4 to 6 FTE",
      color: "#156082",
    },
    {
      name: "RING 2",
      description: "Maven Insights bench — advisory, PMO, change management, CX, and people analytics specialists available on demand. Surge capacity without fixed overhead.",
      headcount: "~200 consultants available",
      color: "#F5A623",
    },
    {
      name: "RING 3",
      description: "Partners and contractors: Thoughtworks for platform-IP work, vetted contractor pool for surge specialization. Entirely variable — pay-per-engagement.",
      headcount: "Variable — pay-per-engagement",
      color: "#F5A623",
    },
  ],
};

assertSharedAlignment("service slug", services.map((s) => s.slug), sharedServices.map((s) => s.slug));
assertSharedAlignment("industry id", industries.map((i) => i.id), sharedIndustries.map((i) => i.id));
assertSharedAlignment("insight slug", insights.map((i) => i.slug), sharedInsights.map((i) => i.slug));

// Marketplace tools live entirely in @workspace/maven-content. The checks
// below verify the catalogue stays internally consistent against the OTHER
// shared collections (services, assessments, industries) so a typo in
// knowledge.ts can never break a Marketplace cross-link silently.
{
  const serviceSlugs = new Set(sharedServices.map((s) => s.slug));
  const assessmentSlugs = new Set(sharedAssessments.map((a) => a.slug));
  const industryIds = new Set(sharedIndustries.map((i) => i.id));
  const seenSlugs = new Set<string>();

  for (const t of sharedMarketplaceTools) {
    if (seenSlugs.has(t.slug)) {
      throw new Error(`[content.ts] Marketplace duplicate slug "${t.slug}".`);
    }
    seenSlugs.add(t.slug);

    for (const ind of t.industries) {
      if (!industryIds.has(ind)) {
        throw new Error(
          `[content.ts] Marketplace tool "${t.slug}" references unknown industry id "${ind}".`,
        );
      }
    }
    if (t.relatedService && !serviceSlugs.has(t.relatedService)) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" references unknown service slug "${t.relatedService}".`,
      );
    }
    if (t.relatedAssessment && !assessmentSlugs.has(t.relatedAssessment)) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" references unknown assessment slug "${t.relatedAssessment}".`,
      );
    }
    // The Value Realization tool reads its canonical portfolio from shared
    // content so the chat assistant and the UI agree on every number. Other
    // live demos manage their own per-component state and don't need a
    // samplePortfolio.
    if (
      t.slug === "value-realization" &&
      t.status === "live" &&
      (!t.samplePortfolio || t.samplePortfolio.length === 0)
    ) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" is marked live but has no samplePortfolio.`,
      );
    }

    // Every tool — live or coming-soon — must ship an agent cast so the
    // "How does this work?" explainer is never empty.
    const cast = sharedAgentCasts[t.slug];
    if (!cast) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" has no agentCast in lib/maven-content/src/agentCasts.ts. Every tool needs one so the explainer modal renders.`,
      );
    }
    if (cast.agents.length < 3) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" has only ${cast.agents.length} agents — every cast needs at least 3 named agents to read as agentic-native.`,
      );
    }
    if (cast.humanCheckpoints.length < 1) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" has zero human-in-the-loop checkpoints. Every cast must name at least one human signoff to honour Maven's "human always signs" promise.`,
      );
    }
    const agentIds = new Set(cast.agents.map((a) => a.id));
    const humanIds = new Set(cast.humanCheckpoints.map((h) => h.id));
    for (const e of cast.edges) {
      if (!agentIds.has(e.from) || !agentIds.has(e.to)) {
        throw new Error(
          `[content.ts] Marketplace tool "${t.slug}" agent edge ${e.from} → ${e.to} references an unknown agent id.`,
        );
      }
    }
    for (const step of cast.flowOrder) {
      const ok = step.kind === "agent" ? agentIds.has(step.id) : humanIds.has(step.id);
      if (!ok) {
        throw new Error(
          `[content.ts] Marketplace tool "${t.slug}" flowOrder step ${step.kind}:${step.id} does not match any agent or human checkpoint id.`,
        );
      }
    }

    // Every live tool must have a registered demo component.
    if (t.status === "live" && !REGISTERED_DEMO_SLUGS.has(t.slug)) {
      throw new Error(
        `[content.ts] Marketplace tool "${t.slug}" is marked live but has no entry in REGISTERED_DEMO_SLUGS. Add the demo component to pages/MarketplaceDetail.tsx and update this set.`,
      );
    }
  }

  // Reverse parity: agentCasts.ts must not contain any slug that does not
  // resolve to a published marketplace tool. Stops orphan casts drifting
  // away from the catalogue.
  const toolSlugSet = new Set(sharedMarketplaceTools.map((t) => t.slug));
  for (const castSlug of Object.keys(sharedAgentCasts)) {
    if (!toolSlugSet.has(castSlug)) {
      throw new Error(
        `[content.ts] Agent cast slug "${castSlug}" in lib/maven-content/src/agentCasts.ts has no matching marketplace tool. Either add the tool or remove the cast.`,
      );
    }
  }
  // Live demos in REGISTERED_DEMO_SLUGS must each map to an existing tool.
  for (const liveSlug of REGISTERED_DEMO_SLUGS) {
    if (!toolSlugSet.has(liveSlug)) {
      throw new Error(
        `[content.ts] REGISTERED_DEMO_SLUGS contains "${liveSlug}" but no marketplace tool with that slug exists.`,
      );
    }
  }
}

export const platformPartners = [
  "Microsoft Copilot Studio", "Google Vertex AI", "LangGraph / LangChain", "Anthropic Claude",
  "AWS", "Microsoft Azure", "Google Cloud", "G42 Sovereign Cloud",
  "Snowflake", "Databricks", "Thoughtworks AI/works", "GitHub Copilot Enterprise",
];
