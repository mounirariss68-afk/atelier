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

// Slugs of tools that ship a real interactive demo component. Kept here so
// the validator below can prove every "live" tool resolves to a registered
// React component in `MarketplaceDetail`'s dispatch map. Update this set in
// lockstep with the DEMOS map in `pages/MarketplaceDetail.tsx`.
const REGISTERED_DEMO_SLUGS = new Set<string>([
  "value-realization",
  "programme-health-copilot",
  "citizen-services-agent",
  "procurement-intelligence",
  "network-ops-agent",
  "sama-compliance-agent",
  "energy-trading-copilot",
  "retail-demand-forecaster",
  "hospitality-revenue-optimizer",
  "ev-battery-health-agent",
  "fpa-rolling-forecast",
  "customer-care-multi-agent",
  "sovereign-data-workbench",
  "knowledge-memory-agent",
]);

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

export const insights = [
  {
    id: "the-agentic-enterprise",
    slug: "the-agentic-enterprise",
    title: "The Agentic Enterprise: From Pilot to Production",
    category: "Agentic AI",
    type: "Report",
    date: "April 2025",
    readTime: "24 min read",
    author: "Maven AI Research",
    coverImage: "/images/report-1.png",
    summary: "MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact. We examine the four-layer architecture that closes the gap — and the GCC implementation roadmap to ship into production.",
    featured: true,
    tags: ["Agentic AI", "Enterprise", "GCC", "Production"],
    content: `
<h2>The Production Gap Is Real — And Growing</h2>
<p>Across the GCC, enterprise organizations have collectively launched thousands of AI pilots in the past three years. From intelligent document processing to customer service chatbots, from predictive maintenance to fraud detection — the ambition has been extraordinary. The execution record has not matched it.</p>
<p>Our research across 47 enterprise organizations in Saudi Arabia, UAE, Qatar, and Kuwait reveals a consistent pattern: organizations are running an average of 14 concurrent AI pilots at any given time. Of those, fewer than 2 reach production within 12 months. The rest die in the pilot graveyard — killed by data problems, governance gaps, organizational resistance, or simply the expiry of executive attention.</p>
<blockquote>The bottleneck is never the model. The model works. The bottleneck is always the data, the governance, and the organization's willingness to redesign how work actually gets done.</blockquote>
<h2>Why Pilots Fail: The Four Failure Modes</h2>
<p>Our analysis identifies four systematic failure modes that account for over 90% of AI pilot failures in enterprise settings:</p>
<ul>
<li><strong>Data readiness collapse:</strong> 67% of failures trace to data that is not AI-ready — fragmented sources, unmastered identities, absent lineage, or governance policies that prevent the AI from accessing what it needs</li>
<li><strong>Governance vacuum:</strong> Organizations deploy AI without the policy layer — guardrails, audit trails, compliance monitoring — required for enterprise-grade deployment</li>
<li><strong>Operating model resistance:</strong> AI that works technically but cannot be embedded into how work is actually done — process designs, role responsibilities, and workflows remain unchanged</li>
<li><strong>Architecture mismatch:</strong> Proof-of-concept architectures that cannot scale, cannot be maintained, and cannot evolve — building for demo, not for production</li>
</ul>
<h2>The Four-Layer Agentic Architecture</h2>
<p>Maven AI's production framework addresses all four failure modes through a deliberately layered architecture:</p>
<h3>Layer 0: Value Case Creation</h3>
<p>Outcome-led shaping. Every engagement starts with a quantified business case — specific decisions, actions, and outcomes the agent will own, with measurable before/after metrics. This layer determines whether it is worth building at all, and anchors the entire engagement to measurable impact.</p>
<h3>Layer 1: Data & AI Foundations</h3>
<p>Lineage, masters, knowledge, governed context. AI agents are only as good as the data they consume and the context they carry. This layer establishes the data infrastructure — clean, governed, lineage-tracked data that agents can trust and regulators can audit.</p>
<h3>Layer 2: Agentic AI</h3>
<p>Production agents that decide, act, learn, and coordinate. Built on the appropriate platform for the client's cloud and sovereignty requirements — LangGraph, LangChain, Copilot Studio, or sovereign model deployments. These are not chatbots. They own complete workflows end-to-end.</p>
<h3>Layer 3: Change Management, Adoption & Upskilling</h3>
<p>Process redesign, role redesign, training. The layer that most providers skip entirely — and the one most likely to determine whether the agent actually gets used. Agents do not land themselves. Organizations require deliberate change management to absorb new operating models.</p>
<h2>The GCC Implementation Roadmap</h2>
<p>For GCC enterprises, the path to agentic production follows a consistent sequence. The specific timeline varies by organization size and data maturity, but the phases do not change:</p>
<p><strong>Weeks 1–3:</strong> Value case development and pilot selection. Choose high-value, bounded use cases where the data already exists, the business case is quantifiable, and executive sponsorship is committed.</p>
<p><strong>Weeks 4–7:</strong> Data readiness sprint. Even the best-scoped pilot will surface data problems. Address them now — do not wait until prototype integration.</p>
<p><strong>Weeks 8–12:</strong> Prototype build. Working agent on production data, demonstrating the core capability. Not a demo environment. Not sample data.</p>
<p><strong>Weeks 13–20:</strong> Production hardening. Governance layer, observability, security review, compliance validation. The work most firms skip in their rush to demonstrate.</p>
<p><strong>Weeks 21–26:</strong> Change management and launch. Process redesign, role mapping, training, communications, and go-live with full monitoring in place.</p>
<h2>Recommendations</h2>
<p>Based on our research and delivery experience across GCC enterprises, we offer four recommendations for organizations seeking to close the pilot-to-production gap:</p>
<ul>
<li>Start with a data readiness audit before selecting your first agentic use case. The use case can be perfectly chosen and still fail if the data is not ready.</li>
<li>Build the governance layer before the agent, not after. Governance retrofitted onto a live production system is significantly more costly and risky.</li>
<li>Staff the change management work as seriously as the technical work. Ratio of change and adoption effort to technical effort should be at minimum 1:2, ideally 1:1.</li>
<li>Choose a delivery partner whose economic model is aligned with production outcomes, not pilot activity. Firms that profit from extended advisory engagements have no structural incentive to move you to production quickly.</li>
</ul>
    `,
  },
  {
    id: "ai-governance-gulf",
    slug: "ai-governance-gulf",
    title: "AI Governance in the Gulf: Building Trust at Scale",
    category: "Data & Governance",
    type: "Report",
    date: "March 2025",
    readTime: "18 min read",
    author: "Alper Kulak, Founding Partner",
    coverImage: "/images/report-2.png",
    summary: "How GCC organizations can build the governance frameworks required for enterprise-grade AI deployment — aligned to UAE AI Charter, Saudi PDPL, and SAMA guidelines.",
    featured: true,
    tags: ["Governance", "Compliance", "UAE", "Saudi Arabia"],
    content: `
<h2>The Governance Imperative</h2>
<p>The Gulf Cooperation Council has emerged as one of the world's most ambitious AI investment regions. The UAE AI Charter, Saudi Arabia's National AI Strategy, Qatar's AI roadmap — these are not merely policy documents. They represent sovereign commitments to AI-enabled economies, backed by real capital and regulatory intent.</p>
<p>Yet as investment accelerates, a structural gap has emerged between AI ambition and AI governance. Organizations are deploying AI systems faster than they are building the governance frameworks to manage them. The consequences — for organizations, for citizens, and for the region's AI credibility — are significant.</p>
<blockquote>Governance is not a constraint on AI deployment. It is the infrastructure that makes AI trustworthy enough to deploy at scale.</blockquote>
<h2>The GCC Regulatory Landscape</h2>
<p>The GCC regulatory environment for AI is maturing rapidly, and organizations that treat compliance as a checkbox exercise will find themselves repeatedly caught off-guard by evolving requirements. What was an informal expectation in 2022 is a contractual obligation in 2025. The trajectory is clear: governance requirements will only become more specific, more enforceable, and more consequential.</p>
<h3>UAE: AI Charter and Emerging Regulation</h3>
<p>The UAE's approach to AI governance combines aspirational AI adoption with an emerging regulatory framework. The UAE AI Charter establishes principles — human-centricity, safety, transparency, accountability — that increasingly translate into procurement requirements for government and quasi-government organizations. The UAE's Personal Data Protection Law (PDPL), effective 2022, creates specific obligations around automated decision-making that directly affect AI deployment. Organizations in the UAE that cannot demonstrate compliance with PDPL's transparency and purpose limitation requirements in their AI systems are increasingly finding themselves excluded from government procurement.</p>
<h3>Saudi Arabia: PDPL and SAMA AI Guidelines</h3>
<p>Saudi Arabia's Personal Data Protection Law (PDPL), enforced by the Saudi Data & AI Authority (SDAIA), creates a comprehensive framework for data processing that has significant implications for AI systems. SAMA's AI guidelines for the financial sector add sector-specific requirements around model governance, fairness testing, and explainability that are among the most mature in the region. Banks, insurance companies, and capital markets firms operating under SAMA oversight face the most rigorous AI governance expectations in the GCC — and, in our experience, the most consequential examination processes.</p>
<h3>Qatar, Kuwait, and the Emerging Regional Standard</h3>
<p>Qatar's national AI strategy and Kuwait's emerging digital governance frameworks are converging on a set of common standards that appear designed to harmonize GCC-wide AI regulation. For organizations operating across multiple GCC markets, building to the highest common standard — SAMA-grade model governance, UAE PDPL compliance, SDAIA registration — is both the most efficient and the most defensible approach.</p>
<h2>Building a GCC-Ready AI Governance Framework</h2>
<p>Effective AI governance in the GCC context requires five integrated capability domains. Organizations that treat these as independent workstreams will find they conflict at the point of integration; they must be designed together.</p>
<h3>1. Data Lineage and Provenance</h3>
<p>Every AI system must be able to answer: where did this data come from, how was it transformed, and who authorized its use? Data lineage is not merely a technical feature — it is a regulatory requirement under both UAE and Saudi data protection frameworks, and a practical prerequisite for auditable AI decision-making. In our experience, fewer than 20% of GCC organizations can answer this question for their AI production systems today. Building this capability is the first and often most time-consuming governance investment.</p>
<h3>2. Model Risk Management</h3>
<p>AI models degrade, drift, and fail in ways that differ fundamentally from traditional software. A credit scoring model that was 91% accurate in 2023 may be 78% accurate in 2025 if the economic environment has shifted in ways not represented in training data. Governance frameworks must include model inventory, performance monitoring, drift detection, and clear escalation protocols for model failures. SAMA requires quarterly model performance reviews for models used in credit decisioning; many banks are not yet able to produce this documentation.</p>
<h3>3. Explainability and Audit Trails</h3>
<p>AI systems in regulated industries — financial services, healthcare, public safety — must be able to explain their decisions in human-readable terms. This is not always technically possible with the most complex models, but the governance framework must be designed with explainability as a design constraint, not an afterthought. When a lending decision is challenged, when a procurement award is questioned, when a public safety action is scrutinized — the organization needs an audit trail that traces the AI's reasoning to the data that informed it.</p>
<h3>4. Human Oversight and Escalation</h3>
<p>Agentic AI systems that act autonomously must have clear boundaries — defined decision authority, human escalation triggers, and override mechanisms. The governance framework must specify exactly where human judgment is required and how it is invoked. Regulators in both Saudi Arabia and the UAE have been explicit: for decisions with material consequences for individuals — loan approvals, social benefit determinations, law enforcement actions — human oversight is not optional.</p>
<h3>5. Ethics and Bias Management</h3>
<p>GCC organizations deploying AI in hiring, lending, public services, and law enforcement must have systematic processes for identifying and mitigating bias. This is both a regulatory expectation under UAE and Saudi frameworks and a risk management imperative. The consequences of biased AI in public sector contexts — where AI decisions may affect millions of citizens' access to services — are reputational, legal, and political. Building bias testing into the AI development lifecycle, not as a one-time pre-launch check but as an ongoing governance process, is the minimum standard.</p>
<h2>The Governance Maturity Model</h2>
<p>Maven AI uses a five-level governance maturity model to assess where GCC organizations stand and what they need to build. Level 1 is informal — AI deployed without documented governance. Level 2 is documented — policies exist but are not operationalized. Level 3 is operationalized — governance processes running but not systematically measured. Level 4 is measured — governance metrics tracked and reported to the board. Level 5 is optimized — governance is continuous and automatically enforced in the AI development and deployment pipeline.</p>
<p>Our assessment of 40+ GCC organizations suggests that the majority sit at Level 1 or Level 2. The gap between where organizations are and where regulators expect them to be is significant — and closing faster than most organizations appreciate.</p>
<h2>Recommendations</h2>
<p>For GCC organizations building or operating AI systems, we offer three priority recommendations for 2025:</p>
<ul>
<li>Conduct a model inventory before anything else. You cannot govern what you have not catalogued. Most organizations are surprised by how many AI systems — including vendor-supplied AI in enterprise software — they are operating without governance oversight.</li>
<li>Build data lineage infrastructure as a prerequisite, not a follow-on. Every AI governance requirement ultimately traces back to data — where it came from, how it was used, who authorized its collection. Building this infrastructure first dramatically reduces the cost of all subsequent governance work.</li>
<li>Engage with SDAIA, SAMA, and CBUAE proactively. Regulators in the GCC have been consistently more receptive to organizations that engage early, demonstrate good faith, and show a credible roadmap to compliance than to those that wait for examination findings to drive change.</li>
</ul>
    `,
  },
  {
    id: "legacy-modernization-playbook",
    slug: "legacy-modernization-playbook",
    title: "Legacy Modernization Playbook: AI-Driven SDLC for GCC Enterprises",
    category: "Legacy Modernization",
    type: "Report",
    date: "February 2025",
    readTime: "20 min read",
    author: "Gokhan Guney, Founding Partner",
    coverImage: "/images/report-3.png",
    summary: "The spec-from-legacy methodology that unlocks modernization for GCC enterprises — including sovereign, on-prem capable delivery for national security environments.",
    featured: false,
    tags: ["Legacy Modernization", "SDLC", "On-Prem", "Engineering"],
    content: `
<h2>The Legacy Problem in the GCC</h2>
<p>The GCC's enterprise technology estate is, in many ways, a monument to the region's economic ambition. Massive ERP deployments, complex billing systems, custom-built government platforms — these systems were built to serve organizations that were growing at extraordinary speed, often faster than modern software architecture could handle.</p>
<p>The consequence is a technical debt burden that is, by our estimates, consuming between 65% and 75% of IT operating budgets across major GCC enterprises. Every dirham spent maintaining legacy is a dirham not spent building the AI capabilities that the next decade demands.</p>
<blockquote>The path out of legacy is not a rip-and-replace project. It is a systematic, AI-powered excavation of institutional knowledge — followed by a principled rebuild.</blockquote>
<h2>Why Previous Modernization Attempts Failed</h2>
<p>GCC enterprises have attempted legacy modernization before. Most large organizations have at least one failed modernization program in their history — a multi-year ERP migration that went over budget, a custom application rebuild that was abandoned, a cloud migration that stalled at 30% completion.</p>
<p>These failures share common causes: insufficient documentation of the existing system, underestimation of business logic complexity, inadequate testing coverage, and change management failures that left the new system unused even after it was built.</p>
<h2>The Spec-from-Legacy Methodology</h2>
<p>Maven AI's spec-from-legacy approach uses AI to extract, structure, and validate the functional specification of existing systems — dramatically accelerating the first and most expensive phase of modernization: understanding what the current system actually does.</p>
<h3>Phase 1: AI-Assisted Extraction</h3>
<p>We deploy code analysis agents trained on the target legacy stack — whether COBOL, SAP ABAP, legacy Java, or custom-built systems — to systematically document business logic, data structures, integration points, and exceptional flows. This work, which might take a human team six to twelve months, can be completed in three to six weeks with AI assistance.</p>
<h3>Phase 2: Specification Validation</h3>
<p>The extracted specification is validated against the organization's institutional knowledge — business stakeholders, system operators, and historical change records. This phase surfaces the gaps between what the code says and what the business actually needs.</p>
<h3>Phase 3: Architecture and Migration Planning</h3>
<p>With a validated specification in hand, we design the target architecture — cloud-native where possible, on-prem where sovereign data requirements demand it — and sequence the migration to minimize operational risk.</p>
<h2>Sovereign and On-Prem Delivery</h2>
<p>A distinctive capability of Maven AI's modernization practice is our ability to deliver entirely on-premises for clients with sovereign data requirements. Many GCC public sector clients — particularly in defense, intelligence, and critical national infrastructure — cannot send code, data, or system specifications to public cloud environments. Our Thoughtworks partnership provides the platform-IP capability; our team provides the delivery capability, entirely within the client's secure perimeter.</p>
<h2>The Arabic Language and Regional Context Challenge</h2>
<p>Legacy systems in GCC enterprises frequently contain Arabic-language business logic, regional process variants, and locally customized workflows that are invisible to AI extraction tools trained primarily on Western enterprise codebases. Maven AI's extraction methodology includes Arabic-aware code analysis, consultation with regional subject matter experts, and validation processes specifically designed to surface regional business logic that standard extraction tools miss.</p>
<p>This capability is not theoretical — we have encountered COBOL billing systems with Arabic character encoding that defeated standard extraction tools entirely, and SAP ABAP customizations that implemented Zakat-compliant tax logic in ways that required regional domain expertise to understand and document. Missing this logic in the specification phase leads to the most expensive class of modernization failure: systems that pass technical testing but fail business acceptance.</p>
<h2>Testing and Validation for High-Stakes Systems</h2>
<p>Legacy systems in production have, by definition, accumulated years of edge case handling, exception logic, and undocumented business rules. The testing challenge in modernization is not just verifying that the new system passes test cases — it is verifying that the new system handles the full complexity of the production environment it is replacing.</p>
<p>Maven AI's AI-assisted testing methodology generates test cases from the extracted specification, supplemented by production transaction data analysis. The goal is not 100% code coverage — it is 100% business outcome coverage: every material business result the legacy system produces must be reproducible by the new system, including the edge cases, the exceptions, and the not-quite-legal business rules that organizations always discover they depended upon.</p>
<h2>Case Study: National Telecom Billing Modernization</h2>
<p>In our most complex legacy modernization engagement, we worked with a national GCC telecom to extract, document, and modernize a billing system that had been in production for 17 years, processed 28 million subscriber accounts monthly, and contained an estimated 4.7 million lines of custom COBOL and ABAP code.</p>
<p>The specification extraction phase — which a human team had estimated at 18 months — was completed in 11 weeks using our AI-assisted methodology, with three dedicated AI engineers and two senior business analysts. The extracted specification ran to 1,400 pages of documented business logic, 230 identified integration points, and 47 identified regulatory compliance requirements. This document became the contract between the delivery team and the business — every dispute about what the new system should do was resolved by reference to the specification, not by negotiation.</p>
<p>The total modernization program — specification, architecture, rebuild, testing, migration, and production cutover — was completed in 22 months, against an industry benchmark of 36–48 months for programs of comparable complexity. The client calculated a ROI of 340% over five years, driven primarily by the elimination of legacy maintenance cost.</p>
<h2>Recommendations</h2>
<p>For GCC enterprise and government technology leaders considering legacy modernization in 2025, we offer four recommendations:</p>
<ul>
<li>Do the specification first, always. The most common cause of modernization failure is beginning the rebuild before fully understanding what is being replaced. The specification investment pays back many times over in avoided rework.</li>
<li>Treat on-prem capability as a procurement requirement, not an afterthought. If your data classification requirements include any sovereign or restricted categories, verify your delivery partner's on-prem capability before contract signature — not during delivery.</li>
<li>Scope the change management effort at the beginning. The technical modernization is the easier half of the program. The business process redesign, training, and organizational adoption work is what determines whether the new system gets used.</li>
<li>Build in Arabic language validation as a formal phase. For GCC organizations with Arabic-language business processes, an Arabic language validation workshop — with business stakeholders who speak Arabic reviewing the specification — is non-negotiable.</li>
</ul>
    `,
  },
  {
    id: "gcc-ai-spending-outlook",
    slug: "gcc-ai-spending-outlook",
    title: "GCC AI Spending Outlook 2025–2030",
    category: "Industry Trends",
    type: "Research Report",
    date: "January 2025",
    readTime: "22 min read",
    author: "Maven AI Research",
    coverImage: "/images/report-4.png",
    summary: "A data-rich analysis of AI investment trends across GCC public sector, telecom, and financial services — with spending forecasts through 2030 and sector-by-sector implications.",
    featured: true,
    tags: ["GCC", "Market Research", "Investment", "Outlook"],
    content: `
<h2>Executive Summary</h2>
<p>The Gulf Cooperation Council is positioned to become one of the world's top five AI investment regions by 2027. Our analysis of announced programs, procurement activity, and technology budgets across Saudi Arabia, UAE, Qatar, Kuwait, Bahrain, and Oman projects cumulative AI-related spending of $47–58 billion between 2025 and 2030 — representing a compound annual growth rate of 34% from a 2024 base.</p>
<p>This growth is not evenly distributed. Three sectors account for over 65% of projected spend: public sector and government, telecommunications, and financial services. Understanding the dynamics of each sector is essential for technology providers seeking to participate in the opportunity.</p>
<blockquote>The GCC's AI investment is uniquely driven by national vision programs — making it more stable, more predictable, and more resistant to economic cycles than AI investment in any comparable region.</blockquote>
<h2>Saudi Arabia: Vision 2030 as AI Procurement Engine</h2>
<p>Saudi Arabia's National AI Strategy, embedded within Vision 2030, commits the Kingdom to becoming a global AI hub by 2030 — a goal backed by PIF's $100 billion technology investment program and SDAIA's mandate to transform public services through AI.</p>
<p>Our analysis identifies six priority areas driving the majority of Saudi AI procurement through 2030:</p>
<ul>
<li><strong>Smart government services:</strong> National digitization of 1,000 government services with AI augmentation — estimated $8.5B commitment</li>
<li><strong>NEOM and giga-project infrastructure:</strong> AI-enabled smart city systems, autonomous operations, and predictive infrastructure management — $12B+ over the period</li>
<li><strong>Public safety and national security:</strong> AI-powered surveillance, forensics, and incident management — $3.5B commitment</li>
<li><strong>Healthcare AI:</strong> Clinical decision support, genomics, predictive population health — $2.8B commitment</li>
<li><strong>Financial services AI:</strong> Capital markets intelligence, fraud prevention, Islamic finance optimization — $4.2B commitment</li>
<li><strong>Education and workforce:</strong> AI tutoring, skills assessment, labor market analytics — $2.1B commitment</li>
</ul>
<h2>UAE: Ecosystem-Driven AI Investment</h2>
<p>The UAE's AI investment model differs from Saudi Arabia's in important ways. Rather than centralized sovereign fund commitments, UAE AI investment is distributed across a sophisticated ecosystem: Abu Dhabi's G42, Dubai's tech economy, free zone innovation hubs, and a growing base of AI-native companies.</p>
<p>UAE AI spending is projected to reach $7.8B annually by 2028, up from $2.9B in 2024. The UAE AI Charter's translation into procurement requirements is accelerating this growth — organizations seeking government contracts increasingly need to demonstrate AI governance capabilities that require significant infrastructure investment.</p>
<h2>Sector Deep-Dive: Telecommunications</h2>
<p>GCC telecoms are among the most active AI investors in the region, driven by three converging pressures: network modernization for 5G and beyond, customer experience competition, and the need to fundamentally restructure cost bases as revenue per user plateaus.</p>
<p>The three major GCC telecom AI use cases by investment volume are: network operations and predictive maintenance ($3.4B projected through 2030), customer experience and churn prevention ($2.1B), and SDLC automation for legacy system modernization ($1.8B). The last category is particularly significant for specialized AI delivery firms — telecom legacy modernization is complex, sovereign, and volume-intensive.</p>
<h2>Sector Deep-Dive: Financial Services</h2>
<p>GCC financial services AI investment is shaped by a distinctive institutional context: sovereign wealth funds with multi-decade investment horizons, Islamic finance requirements that create unique analytical challenges, and SAMA/CBUAE regulatory frameworks that mandate model governance at a level of maturity that most organizations are still working toward.</p>
<p>Investment banking and capital markets AI — trading analytics, portfolio optimization, risk modeling — is the largest category at $5.2B projected through 2030. Consumer banking AI — fraud prevention, credit decisioning, customer service — represents $4.1B. Compliance and regulatory AI — SAMA-mandated model governance, AML analytics, PDPL compliance tooling — represents $2.4B and is growing fastest at 51% CAGR.</p>
<h2>The Islamic Finance AI Frontier</h2>
<p>One of the most underappreciated dimensions of GCC financial services AI is the specific challenge posed by Islamic finance structures. Murabaha pricing, Ijara lease analytics, Sukuk portfolio optimization, and Zakat-compliant wealth management all require AI modeling frameworks that are fundamentally different from conventional finance applications. The majority of off-the-shelf financial AI tools are built for conventional finance; GCC institutions that deploy them directly risk both compliance failures and missed revenue optimization opportunities.</p>
<p>The organizations that invest in genuinely Shariah-compliant AI modeling — working directly with Shariah boards to define compliant optimization objectives — gain a durable competitive advantage in a market where Islamic banking assets are growing at 10–12% annually and where conventional financial AI solutions remain structurally inadequate.</p>
<h2>Investment Implications for Technology Providers</h2>
<p>For AI technology vendors and delivery firms, the GCC spending outlook has three clear implications. First, regulatory alignment is table stakes: organizations without credible SAMA/CBUAE/PDPL compliance offerings will be excluded from the largest and fastest-growing procurement categories. Second, Arabic language capability matters at every layer — not just for customer-facing AI but for internal knowledge management, regulatory reporting, and workforce productivity tools. Third, the sovereign data requirement is real and non-negotiable for the majority of the highest-value contracts: capability to deliver on-prem, in air-gapped environments, is a competitive differentiator that most global vendors cannot credibly offer.</p>
<h2>Recommendations for CIOs and CTOs</h2>
<p>Based on our analysis, we recommend the following priorities for GCC technology leaders planning AI investment through 2027:</p>
<ul>
<li>Allocate a minimum of 20% of AI budgets to data foundation work before deploying production AI. The organizations that invest in data infrastructure first consistently reach production AI faster and at lower total cost than those that attempt to build AI on top of unprepared data.</li>
<li>Prioritize use cases that generate their own data. AI systems that create new, proprietary datasets as a byproduct of their operation compound in value over time. These are the use cases that create sustainable competitive advantage, not just operational efficiency.</li>
<li>Build internal AI governance capability, not just vendor-managed compliance. Regulatory requirements are evolving faster than vendor governance frameworks. Organizations with internal competency in AI governance are more resilient to regulatory change.</li>
<li>Treat Arabic language performance as a benchmark requirement, not a nice-to-have. AI systems that perform significantly worse in Arabic than in English are not suitable for customer-facing or regulatory-reporting use cases in the GCC context.</li>
</ul>
    `,
  },
  {
    id: "agentic-workforce",
    slug: "agentic-workforce",
    title: "The Agentic Workforce: Human-AI Collaboration in Public Sector Operations",
    category: "Agentic AI",
    type: "Perspective",
    date: "December 2024",
    readTime: "14 min read",
    author: "Khalid Al Khudairi, Founding Partner",
    coverImage: "/images/report-5.png",
    summary: "How GCC government entities can redesign their operating models around human-AI collaboration — moving from AI tools to AI teammates that own work end-to-end.",
    featured: false,
    tags: ["Public Sector", "Workforce", "Human-AI Collaboration", "Government"],
    content: `
<h2>The Workforce Transformation Imperative</h2>
<p>The phrase "AI will take jobs" has generated more anxiety than insight. A more useful framing: AI will take tasks — and the organizations that redesign roles and processes around this reality will be more productive, more capable, and more attractive to talent than those that do not.</p>
<p>For GCC public sector organizations, this is not merely a productivity question. It is a national mandate. Vision 2030's Saudization objectives require that Saudi nationals fill high-value roles — which means automation must absorb routine work to free Saudi workforce capacity for the judgment-intensive work that human beings do best.</p>
<blockquote>The organizations that redesign around AI-human collaboration are not eliminating jobs. They are eliminating the routine work that was preventing their people from doing the meaningful work they were hired to do.</blockquote>
<h2>Three Models of Human-AI Collaboration</h2>
<p>Our work across GCC public sector clients has revealed three distinct models of human-AI collaboration, each appropriate for different types of work:</p>
<h3>Model 1: AI Handles, Human Reviews</h3>
<p>The agent handles the complete case — gathering information, applying policy, making a determination, and taking action. The human reviews only edge cases flagged by the agent. Appropriate for high-volume, policy-driven decisions where the agent's accuracy is measurably high and the cost of errors is manageable.</p>
<h3>Model 2: AI Recommends, Human Decides</h3>
<p>The agent gathers, analyzes, and recommends — but the human makes the final decision. Appropriate for higher-stakes decisions where human accountability is legally required or where the judgment dimension is genuinely complex.</p>
<h3>Model 3: Human Leads, AI Supports</h3>
<p>The human leads the work; the agent provides real-time information, analysis, and suggestions. Appropriate for complex, relationship-intensive work — senior advisory, complex negotiations, crisis management — where AI augments human judgment without replacing it.</p>
<h2>Process Redesign: The Hidden Work</h2>
<p>Deploying an AI agent into an existing process without redesigning the process is one of the most common and costly mistakes in public sector AI adoption. An agent that automates a broken process just produces wrong answers faster. The real opportunity — and the real work — is redesigning the process itself around the new capabilities the agent provides.</p>
<p>Process redesign in the public sector context is complicated by several factors unique to government organizations: regulatory mandates that specify process steps rather than outcomes, approval hierarchies that reflect accountability structures rather than efficiency, and union and civil service constraints on role redesign. None of these constraints is insurmountable, but all of them require deliberate management — the kind of management that cannot be delegated to the AI team.</p>
<h2>The Saudization Dimension</h2>
<p>For Saudi government entities, the human-AI collaboration question has an additional dimension that is absent in most other markets: Saudization. Vision 2030's Saudization objectives require specific participation rates of Saudi nationals in the workforce — which means automation cannot simply eliminate roles. It must be designed to elevate Saudi nationals into higher-value work while automating the routine tasks that currently occupy a disproportionate share of their time.</p>
<p>Our work with Saudi public sector clients has consistently shown that agentic AI, properly deployed with appropriate change management, accelerates Saudization rather than threatening it. When an agent handles document processing, routine citizen inquiries, and case management, the Saudi officials who were doing that work can be redeployed to advisory, oversight, and relationship roles — exactly the kind of value-adding work that Vision 2030 envisions for the Saudi national workforce.</p>
<h2>Implementation: The First 90 Days</h2>
<p>For public sector organizations beginning their human-AI collaboration journey, we recommend a structured 90-day launch program designed to build confidence, demonstrate value, and establish the governance foundations for sustainable scaling:</p>
<p><strong>Days 1–30:</strong> Process selection and stakeholder alignment. Choose a single, bounded process — one that is high-volume, policy-driven, and currently consuming significant human time. Get genuine executive sponsorship, not just approval. Map the current process in detail before designing the future state.</p>
<p><strong>Days 31–60:</strong> Pilot build and controlled deployment. Build the agent against the mapped process. Deploy to a pilot group of 10–20 employees. Collect systematic feedback — not just on agent performance, but on the human experience of working alongside the agent. Most process redesign insights emerge in this phase.</p>
<p><strong>Days 61–90:</strong> Process refinement and scale preparation. Incorporate pilot feedback. Redesign the surrounding process based on what the pilot revealed. Prepare the change management and training materials for organizational rollout. Define the governance and monitoring framework that will support the production system.</p>
<h2>Measuring Transformation, Not Just Efficiency</h2>
<p>The natural temptation is to measure human-AI collaboration programs in terms of efficiency — time saved, cost per transaction, throughput. These metrics matter, but they are not sufficient to capture the full value of the transformation. The more important measures are outcome quality (are the decisions better?), employee experience (are people doing more meaningful work?), and citizen experience (are public services improving?). In our experience, the organizations that track all three are more committed to the program's long-term success — and more likely to achieve it.</p>
    `,
  },
  {
    id: "cdo-to-cao",
    slug: "cdo-to-cao",
    title: "From CDO to CAO: Rethinking the Chief Data Officer Role in the Age of AI",
    category: "Data & Governance",
    type: "Opinion",
    date: "November 2024",
    readTime: "12 min read",
    author: "Alper Kulak, Founding Partner",
    coverImage: "/images/report-6.png",
    summary: "The Chief Data Officer role was defined for a world that no longer exists. The new executive mandate — Chief AI Officer or Chief Analytics Officer — requires a fundamentally different skillset and organizational mandate.",
    featured: false,
    tags: ["Leadership", "CDO", "CAO", "Data Strategy"],
    content: `
<h2>The CDO Role Was Designed for Yesterday's Problem</h2>
<p>The Chief Data Officer position emerged in the early 2010s in response to a specific problem: organizations had accumulated massive amounts of data and had no one accountable for governing it. The CDO was, essentially, a data janitor with a C-suite title — responsible for data quality, data governance, data lineage, and the organizational politics of getting competing business units to share information.</p>
<p>That problem still exists. But it is no longer the most important problem. The most important problem, in 2025, is this: how do we activate data as AI infrastructure? How do we build the data systems, governance frameworks, and contextual knowledge stores that allow AI agents to act reliably on behalf of the organization?</p>
<blockquote>The CDO who cannot speak the language of AI inference pipelines, agent context stores, and retrieval-augmented generation is a CDO whose mandate is already obsolete — even if the org chart doesn't know it yet.</blockquote>
<h2>What the New Role Demands</h2>
<p>The evolution from CDO to CAO — Chief AI Officer or Chief Analytics Officer, depending on the organization — is not merely a title change. It reflects a genuine shift in what the role needs to deliver:</p>
<ul>
<li><strong>From data governance to AI governance:</strong> Managing not just data quality but model risk, agent behavior, and the organizational ethics of automated decision-making</li>
<li><strong>From data platforms to AI infrastructure:</strong> Building the vector stores, RAG pipelines, context management systems, and inference infrastructure that AI agents require</li>
<li><strong>From internal service to commercial capability:</strong> Treating data and AI as a source of competitive advantage and — in the GCC context — sovereign capability, not just an operational necessity</li>
<li><strong>From reporting to acting:</strong> Moving from data products (dashboards, reports, analytics) to AI products (agents, automated processes, intelligent applications) that do work, not just show information</li>
</ul>
<h2>The Organizational Case for Change</h2>
<p>Beyond the capability argument, there is a structural organizational argument for the CDO-to-CAO transition. The CDO role has historically sat in a reporting line that positioned data as a support function — useful, necessary, but not strategic. The CAO role, where it has been implemented effectively, sits at the same level as the CTO and CFO — because AI decisions are business decisions, and the executive accountable for AI should have the organizational authority to make them.</p>
<p>In the GCC context, this matters particularly in financial services and public sector organizations, where AI governance requirements from SAMA, CBUAE, and SDAIA create board-level accountability for AI risk. The CDO model, typically positioned two to three levels below the board, cannot credibly discharge this accountability. The CAO model, with a seat at the executive committee and a direct reporting line to the CEO, can.</p>
<h2>What the Transition Requires in Practice</h2>
<p>The CDO-to-CAO transition is not just a title change. It requires a genuine expansion of scope, a different talent profile, and — critically — a different relationship with the business. CDOs who have spent their careers as internal service providers to the business will find the CAO mandate uncomfortable: it requires the authority to say no to AI deployments that fail governance standards, to retire AI systems that are not performing, and to make organization-wide architectural decisions that affect every business unit.</p>
<p>The organizations that have made this transition successfully share a common pattern: they invested in AI governance education at the board level before changing the CDO's mandate, ensuring that the governance conversations the CAO would need to have were welcomed rather than resisted.</p>
<h2>Talent Implications</h2>
<p>The CDO talent market in the GCC is maturing — there is a reasonable supply of experienced data governance and data platform professionals who can fill the traditional CDO role. The CAO talent market, by contrast, is extremely thin. Organizations seeking to hire a CAO with genuine depth in AI governance, agent architecture, inference infrastructure, and organizational change will find very few candidates who combine all of these capabilities.</p>
<p>The practical implication is that most organizations will need to develop their CAO from within, or bring in a CDO who is genuinely committed to the AI pivot and invest in their development. External hiring for a fully-formed CAO is likely to disappoint. The organizations that started building AI governance capability within their data function in 2023 and 2024 are now well-positioned to elevate those leaders into the CAO mandate. Those that did not face a more difficult path.</p>
<h2>Recommendations</h2>
<p>For GCC boards and CEOs evaluating the CDO-to-CAO transition:</p>
<ul>
<li>Assess your current CDO against the new mandate honestly. The capability gap between a strong traditional CDO and a capable CAO is significant. The transition requires genuine investment in the individual, not just a title change.</li>
<li>Define the CAO's authority clearly before appointing. The most common reason CAO appointments fail is that the new executive does not have the organizational authority to make the governance decisions the role requires. Define the mandate before filling it.</li>
<li>Set a 24-month transition timeline. The CDO-to-CAO transition requires the incumbent to simultaneously maintain existing data governance responsibilities while building new AI capabilities. Eighteen to twenty-four months is realistic; less than twelve is not.</li>
</ul>
    `,
  },
  {
    id: "sovereign-ai",
    slug: "sovereign-ai",
    title: "Building Sovereign AI: On-Prem Agentic Deployment for National Security Clients",
    category: "Agentic AI",
    type: "Technical Brief",
    date: "October 2024",
    readTime: "16 min read",
    author: "Gokhan Guney, Founding Partner",
    coverImage: "/images/report-7.png",
    summary: "A technical framework for deploying production-grade agentic AI systems in air-gapped, sovereign data environments — without compromising capability or security posture.",
    featured: false,
    tags: ["Sovereign AI", "On-Prem", "Security", "Technical"],
    content: `
<h2>The Sovereign AI Imperative</h2>
<p>For GCC national security clients, intelligence services, and critical national infrastructure operators, the question is not whether to adopt AI. It is whether AI can be adopted without compromising the sovereignty, security, and secrecy that their missions require.</p>
<p>The answer is yes — but only with the right architecture, the right tooling, and delivery partners with the capability to execute in these constrained environments.</p>
<blockquote>Sovereign AI is not a compromised version of public cloud AI. It is a different architecture built for a different threat model — and, for certain use cases, it is the only architecture that is acceptable.</blockquote>
<h2>The Sovereign AI Architecture</h2>
<p>Maven AI's sovereign AI framework is built around five architectural principles designed specifically for air-gapped and data-sovereign environments:</p>
<h3>Principle 1: Model Sovereignty</h3>
<p>In sovereign environments, the AI model itself must be controlled by the client organization. This means either open-weight models (Llama 3, Mistral, Falcon) deployed on client-controlled infrastructure, or regional sovereign models (Jais for Arabic-language use cases, G42's sovereign model stack) that are contractually guaranteed to be non-extractable and non-observable by the model developer.</p>
<h3>Principle 2: Inference Isolation</h3>
<p>Inference — the process by which the model generates outputs — must occur entirely within the secure perimeter. This rules out API-based model access (OpenAI, Anthropic, Google) for sovereign use cases, and requires on-prem GPU infrastructure capable of serving the model at the required performance level.</p>
<h3>Principle 3: Context Segmentation</h3>
<p>Agentic AI systems use large amounts of contextual information — retrieved documents, conversation history, tool outputs — to generate their responses. In sovereign environments, this context must be stored and retrieved entirely within the secure perimeter, with strict access controls matching the classification of the underlying data.</p>
<h3>Principle 4: Audit and Observability</h3>
<p>Every action taken by a sovereign AI agent must be logged, attributable, and auditable — within the secure environment, without any log data leaving the perimeter. This requires purpose-built observability infrastructure that captures agent reasoning chains, tool invocations, data accesses, and decision outputs in a format that supports both operational monitoring and forensic investigation. The observability infrastructure must itself be classified and secured at the appropriate level.</p>
<h3>Principle 5: Sovereignty Preservation Through Upgrade</h3>
<p>Sovereign AI deployments face a challenge that public cloud deployments do not: every model update, library upgrade, and capability addition must be validated against the sovereign architecture before deployment. The pace of AI capability development creates pressure to upgrade frequently; the security requirements of sovereign environments create pressure to change slowly. Managing this tension — through a structured security review process for AI updates — is one of the most important ongoing governance challenges in sovereign AI operations.</p>
<h2>The Hardware Stack for Sovereign AI</h2>
<p>On-prem AI deployment requires dedicated GPU infrastructure capable of serving large language models at acceptable latency and throughput levels. The hardware choices for sovereign AI have evolved significantly in 2024 and 2025, with options now available at price points that were not accessible two years ago. The current sovereign AI hardware landscape includes:</p>
<p><strong>NVIDIA A100/H100 clusters:</strong> The gold standard for sovereign LLM inference. High acquisition cost, but proven performance for models up to 70B parameters. Required for the most capable open-weight models at production throughput. Subject to export controls that require careful procurement planning for GCC clients.</p>
<p><strong>NVIDIA L40S and L4 configurations:</strong> More cost-efficient options suitable for smaller models or inference workloads that can be distributed across multiple GPUs. Appropriate for purpose-built agents where the model can be right-sized to the task, rather than general-purpose large-scale AI.</p>
<p><strong>Regional sovereign GPU infrastructure:</strong> G42's Falcon infrastructure and Saudi Arabia's ARAMCO AI infrastructure both offer sovereign GPU-as-a-service options that provide cloud-like operational simplicity while maintaining data sovereignty within the relevant jurisdiction. For clients where air-gapping is not required but data sovereignty is, these regional sovereign cloud options represent an attractive middle ground.</p>
<h2>Case Study: Intelligence Agency Document Processing</h2>
<p>Among our most technically demanding engagements, we deployed a sovereign agentic AI system for a GCC intelligence agency to automate the analysis and summarization of classified documents across multiple security compartments. The system processes Arabic and English documents, applies classification-aware context controls to ensure no cross-compartment data leakage, and produces structured analytical summaries with full audit trails.</p>
<p>The entire system — from GPU infrastructure to model weights to application code to vector stores — is deployed within the agency's secure perimeter. No element of the system communicates with any external service. The system was delivered in nine months, from architecture design to operational deployment, using open-weight Arabic-capable models fine-tuned on declassified government documents to improve domain relevance.</p>
<h2>Recommendations</h2>
<p>For GCC national security and critical infrastructure organizations considering agentic AI deployment:</p>
<ul>
<li>Architect for sovereignty from day one. Retrofitting sovereign architecture onto a system originally designed for public cloud is significantly more expensive and disruptive than building sovereign-first. The security architecture must be the starting point, not a constraint applied after the fact.</li>
<li>Invest in open-weight model evaluation before selecting a model. The sovereign AI model landscape is evolving rapidly. A systematic evaluation of available open-weight models against your specific use case — including Arabic language performance, instruction-following quality, and hardware requirements — is worth the time before committing to an architecture.</li>
<li>Plan the observability infrastructure as carefully as the AI infrastructure. The audit and governance requirements of sovereign environments are as complex as the technical requirements. Organizations that invest equally in both are the ones that pass security reviews and build institutional confidence in the system.</li>
</ul>
    `,
  },
  {
    id: "90-day-mvp",
    slug: "90-day-mvp",
    title: "The 90-Day MVP: How Boutique AI Firms Outpace Tier-1 Consultancies",
    category: "Industry Trends",
    type: "Thought Leadership",
    date: "September 2024",
    readTime: "10 min read",
    author: "Mounir Aris, CEO",
    coverImage: "/images/report-8.png",
    summary: "Why lean, senior-delivery AI firms are consistently outperforming their Tier-1 competitors on the dimension that matters most: time from contract to working software in production.",
    featured: false,
    tags: ["Boutique", "Delivery", "Speed", "Tier-1"],
    content: `
<h2>The Paradox of Scale</h2>
<p>The conventional logic of professional services says: bigger is better. Bigger firms have more resources, more expertise, more geographic reach. They can throw people at a problem until it is solved. They can absorb the risk of large engagements. They are, in every conventional sense, safer.</p>
<p>This logic has been systematically dismantled in the AI era. The firms that are winning the most important AI engagements — the ones that actually reach production — are, with increasing frequency, not the Tier-1 firms. They are specialized boutiques with fewer than 50 people, delivering outcomes the Tier-1s cannot match.</p>
<blockquote>Three days to scope. Three weeks to prototype. 90 days to MVP. While a Tier-1 is still negotiating the statement of work, we are in the client's production environment.</blockquote>
<h2>Why Size Works Against Tier-1 Firms in AI Delivery</h2>
<p>The Tier-1 delivery model was optimized for a different era — the era of large, predictable IT transformation programs with multi-year timelines and stable requirements. AI delivery is none of these things. It is fast, experimental, iterative, and deeply dependent on the quality of judgment at the point of delivery.</p>
<p>The Tier-1 pyramid — senior-to-junior ratios of 1:8 or worse — creates a structural disconnect between the people who sell the work and the people who do it. Clients buy access to a Partner with 20 years of experience; they get an Analyst with 2 years of experience and a methodology manual. In AI delivery, this gap is lethal.</p>
<h2>The Four Levers Boutiques Pull That Tier-1s Cannot</h2>
<h3>Lever 1: Senior Delivery</h3>
<p>At Maven AI, every engagement has a Partner or Principal as the day-to-day delivery lead — not just in the kickoff presentation, but in the working sessions, the architecture reviews, and the troubleshooting calls at 10pm when something breaks. Our clients bought access to senior judgment, and that is what they get.</p>
<h3>Lever 2: Speed to Value</h3>
<p>Our engagement model is built for speed. Three-day scoping. Three-week prototype. 90-day MVP. We mobilize while Tier-1s are still building their project management plans. In AI, speed is not just an operational virtue — it is a competitive differentiator. Business cases expire. Executive attention drifts. The window for organizational change closes.</p>
<h3>Lever 3: Pricing Wedge</h3>
<p>Our lean structure allows us to deliver senior-led work at rates that are meaningfully below Tier-1 equivalents. Not because we are cutting corners — because we are not maintaining the pyramid of junior staff, the global offices, the training academies, the internal systems, and the marketing budgets that Tier-1 overhead demands.</p>
<h3>Lever 4: Partner Leverage</h3>
<p>We do not pretend to build everything ourselves. Where platform expertise is required — Thoughtworks AI/works for SDLC acceleration, hyperscalers for cloud infrastructure, specialist data partners — we bring in best-of-breed partners and coordinate delivery. Tier-1s have some of these relationships too, but their partner economics are tied to their own revenue maximization, not the client's best outcome.</p>
<h2>The GCC Context: Why Speed Matters More Here</h2>
<p>In most markets, the argument for boutique speed over Tier-1 depth is primarily economic. In the GCC, it is also strategic. National AI programs operate on government fiscal years and political cycles. An AI initiative that does not produce visible results within a fiscal year risks losing funding, executive sponsorship, or ministerial support. The window for demonstrating value is often 12 months or less — a timeline that eliminates the Tier-1 engagement model from consideration for many of the most important GCC AI opportunities.</p>
<p>Khalid Al Khudairi, our Founding Partner based in Riyadh, articulates this well: "When a minister or a PIF investment committee wants to see an AI system in operation, they are not interested in a Phase 1 assessment report. They want to see it running. That is where the boutique model wins every time — because we can show something real in the timeframe that the client's political environment demands."</p>
<h2>The Quality Argument</h2>
<p>Speed alone does not explain the boutique advantage. There is also a quality argument — and it is counterintuitive. The conventional wisdom holds that larger teams produce higher-quality outcomes. In AI delivery, the opposite is frequently true. The highest-quality AI systems are built by small teams of very senior engineers who carry the full technical context of the system in their heads, make consistent architectural decisions, and write code they are personally willing to put their names on.</p>
<p>The 1:8 senior-to-junior ratio of Tier-1 delivery creates quality problems that manifest in specific, predictable ways: inconsistent architectural decisions made by junior engineers who did not attend the design sessions, integration bugs at the boundaries between modules built by different sub-teams, and technical debt accumulated by engineers who know they will be rotated off the project before the consequences of their shortcuts become visible. These are not character flaws — they are structural consequences of a delivery model that prioritizes margin over quality.</p>
<h2>When to Choose a Tier-1</h2>
<p>Intellectual honesty requires acknowledging the cases where Tier-1 firms genuinely outperform boutiques. For very large, multi-year transformation programs that require simultaneous global delivery across dozens of countries and languages, the Tier-1 geographic footprint and bench depth provide real value. For procurement situations where organizational risk appetite demands a "no one ever got fired for hiring McKinsey" decision, the Tier-1 brand provides political cover that boutiques cannot replicate. For engagements where the primary deliverable is a strategy document rather than working software, the Tier-1 methodology and brand premium may be worth the price.</p>
<p>The distinction that matters is this: choose a Tier-1 when the primary deliverable is advice, coverage, or global coordination. Choose Maven AI when the primary deliverable is working AI in production.</p>
<h2>The Evidence: What Clients Report</h2>
<p>Our clients who have previously worked with Tier-1 firms on AI initiatives consistently report the same experience: they were impressed by the quality of the framing, the sophistication of the strategy document, and the seniority of the people in the room during the sales process. They were less impressed when the delivery team arrived and was composed primarily of recent graduates following a methodology manual. The handoff from strategy to delivery — where Tier-1 firms lose most of their value — is precisely where the boutique model concentrates its strength.</p>
<h2>Recommendations for Procurement Leaders</h2>
<ul>
<li>Define "done" as working software in production, not a completed assessment or a strategy report. Procurement specifications that define completion in terms of deliverable documents, rather than operational AI systems, structurally favor the Tier-1 model and systematically exclude the delivery-first boutique model.</li>
<li>Require senior delivery commitment in the contract, not just in the pitch. Specify the minimum seniority level of the day-to-day delivery lead. A Partner-level delivery commitment in the contract is worth more than a Partner-level presence in the kickoff meeting.</li>
<li>Measure speed to prototype as a selection criterion. Ask short-listed firms: how quickly can you have a working prototype on our production data? The answer is revealing — and it is one of the most reliable predictors of production delivery capability.</li>
</ul>
    `,
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
    url: "https://www.ey.com/en_us/insights/telecommunications/key-strategies-for-modernizing-oss-transformation",
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
    url: "https://www.mckinsey.com/industries/financial-services/our-insights/five-accelerators-for-corporate-and-investment-banking-in-the-gcc",
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
    url: "https://www.aramco.com/en/what-we-do/energy-innovation/digitalization/building-the-ai-future",
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
    url: "https://www.pif.gov.sa/en/our-investments/giga-projects/",
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
}

export const platformPartners = [
  "Microsoft Copilot Studio", "Google Vertex AI", "LangGraph / LangChain", "Anthropic Claude",
  "AWS", "Microsoft Azure", "Google Cloud", "G42 Sovereign Cloud",
  "Snowflake", "Databricks", "Thoughtworks AI/works", "GitHub Copilot Enterprise",
];
