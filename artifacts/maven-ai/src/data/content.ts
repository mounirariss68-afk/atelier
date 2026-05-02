export const founders = [
  {
    id: "mounir-aris",
    name: "Mounir Aris",
    title: "CEO & Co-Founder",
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
    title: "Founding Partner",
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
    title: "Founding Partner",
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
    title: "Founding Partner",
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
      { value: "80%", label: "of enterprise AI pilots never reach production" },
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
    color: "#E97132",
    buyer: "CIO, CTO",
    description: "70% of enterprise IT spend is trapped in legacy maintenance. We use AI-driven engineering to spec legacy systems, accelerate modernization, and reduce technical debt — with on-prem capability for sovereign data clients.",
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
      { value: "70%", label: "of enterprise IT spend trapped in legacy maintenance" },
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
    color: "#0F9ED5",
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
    summary: "Why 80% of enterprise AI pilots never reach production — and the four-layer architecture that closes the gap. A definitive GCC implementation roadmap.",
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
<p>The GCC regulatory environment for AI is maturing rapidly, and organizations that treat compliance as a checkbox exercise will find themselves repeatedly caught off-guard by evolving requirements.</p>
<h3>UAE: AI Charter and Emerging Regulation</h3>
<p>The UAE's approach to AI governance combines aspirational AI adoption with an emerging regulatory framework. The UAE AI Charter establishes principles — human-centricity, safety, transparency, accountability — that increasingly translate into procurement requirements for government and quasi-government organizations. The UAE's Personal Data Protection Law (PDPL), effective 2022, creates specific obligations around automated decision-making that directly affect AI deployment.</p>
<h3>Saudi Arabia: PDPL and SAMA AI Guidelines</h3>
<p>Saudi Arabia's Personal Data Protection Law (PDPL), enforced by the Saudi Data & AI Authority (SDAIA), creates a comprehensive framework for data processing that has significant implications for AI systems. SAMA's AI guidelines for the financial sector add sector-specific requirements around model governance, fairness testing, and explainability that are among the most mature in the region.</p>
<h2>Building a GCC-Ready AI Governance Framework</h2>
<p>Effective AI governance in the GCC context requires five integrated capability domains:</p>
<h3>1. Data Lineage and Provenance</h3>
<p>Every AI system must be able to answer: where did this data come from, how was it transformed, and who authorized its use? Data lineage is not merely a technical feature — it is a regulatory requirement under both UAE and Saudi data protection frameworks, and a practical prerequisite for auditable AI decision-making.</p>
<h3>2. Model Risk Management</h3>
<p>AI models degrade, drift, and fail in ways that differ fundamentally from traditional software. Governance frameworks must include model inventory, performance monitoring, drift detection, and clear escalation protocols for model failures.</p>
<h3>3. Explainability and Audit Trails</h3>
<p>AI systems in regulated industries — financial services, healthcare, public safety — must be able to explain their decisions in human-readable terms. This is not always technically possible with complex models, but the governance framework must be designed with explainability as a design constraint, not an afterthought.</p>
<h3>4. Human Oversight and Escalation</h3>
<p>Agentic AI systems that act autonomously must have clear boundaries — defined decision authority, human escalation triggers, and override mechanisms. The governance framework must specify exactly where human judgment is required and how it is invoked.</p>
<h3>5. Ethics and Bias Management</h3>
<p>GCC organizations deploying AI in hiring, lending, public services, and law enforcement must have systematic processes for identifying and mitigating bias. This is both a regulatory expectation under UAE and Saudi frameworks and a risk management imperative.</p>
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
    `,
  },
];

export const industries = [
  {
    id: "public-sector",
    title: "Public Sector",
    subtitle: "Accelerating national vision through production AI",
    icon: "Building2",
    color: "#156082",
    heroStat: "$33B",
    heroStatLabel: "projected GCC public sector AI spend 2025–2030",
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
      title: "National Public Safety Platform",
      client: "A GCC national authority",
      challenge: "Modernize incident management across 400+ field units with AI-powered dispatch and evidence processing — entirely on-prem",
      approach: "Deployed agentic AI platform on sovereign cloud infrastructure, integrating with national ANPR, communications, and case management systems",
      outcome: "47% reduction in incident-to-dispatch latency. 100% sovereign data compliance. Full production deployment in 18 months.",
    },
    stats: [
      { value: "47", label: "GCC government entities actively procuring AI platforms" },
      { value: "$12B+", label: "NEOM AI infrastructure commitment alone" },
      { value: "Arabic-first", label: "AI capability for regional language and context requirements" },
    ],
  },
  {
    id: "telecom",
    title: "Telecommunications",
    subtitle: "From legacy infrastructure to AI-native operations",
    icon: "Wifi",
    color: "#E97132",
    heroStat: "$7.3B",
    heroStatLabel: "GCC telecom AI investment projected through 2028",
    description: "GCC telecoms are at a critical inflection point. 5G monetization requires AI-native operations. Legacy system debt is consuming 60–70% of IT budgets. Customer experience competition is intensifying. Maven AI brings the combination of legacy modernization capability and agentic AI delivery that telecoms need.",
    challenges: [
      "Massive legacy estates — Siebel CRM, custom BSS/OSS, COBOL billing — consuming IT budget at unsustainable levels",
      "5G monetization requires AI-native network operations and customer experience capabilities not present in current systems",
      "High customer acquisition and retention costs driving need for AI-powered personalization and churn prevention",
      "Data quality and integration challenges across siloed operational, customer, and network data domains",
      "On-prem delivery requirements for sensitive network operations data",
    ],
    approach: "Maven AI's telecom practice combines two distinctive capabilities: our spec-from-legacy methodology for cost-effective legacy modernization, and our agentic AI delivery for network operations and customer experience. We have delivered, with Thoughtworks AI/works, the most complex telecom legacy modernization programs in the GCC.",
    caseVignette: {
      title: "CRM Modernization at Scale",
      client: "A major GCC national telecom",
      challenge: "Migrate 15-year-old Siebel CRM serving 28M subscribers — on-prem, without service disruption",
      approach: "AI-driven spec extraction of 2.3M lines of Siebel customization code, followed by cloud-native rebuild with AI-assisted development",
      outcome: "62% reduction in CRM operational cost. 35% improvement in agent handle time. 100% on-prem delivery with zero public cloud exposure.",
    },
    stats: [
      { value: "60–70%", label: "of telecom IT budgets consumed by legacy maintenance" },
      { value: "62%", label: "CRM operational cost reduction in flagship engagement" },
      { value: "28M+", label: "subscribers served by systems we have modernized" },
    ],
  },
  {
    id: "financial-services",
    title: "Financial Services",
    subtitle: "AI-grade governance for the region's most demanding regulators",
    icon: "TrendingUp",
    color: "#0F9ED5",
    heroStat: "$11.7B",
    heroStatLabel: "projected GCC financial services AI investment through 2030",
    description: "GCC financial services institutions operate under some of the world's most demanding AI governance requirements — SAMA guidelines, CBUAE frameworks, and PDPL compliance — while simultaneously investing in AI at a pace that matches global financial centers. Maven AI brings the rare combination of deep financial services domain knowledge and AI governance expertise.",
    challenges: [
      "SAMA and CBUAE AI governance requirements demand model explainability, fairness testing, and audit trails that most organizations are not yet able to produce",
      "Islamic finance structures create unique AI modeling challenges not addressed by standard financial AI frameworks",
      "Customer data quality and identity mastering issues across legacy core banking and CRM systems prevent AI deployment",
      "Capital markets AI requires integration with global data infrastructure while maintaining sovereign data compliance",
      "Regulatory reporting automation faces challenges from fragmented data systems and incomplete data lineage",
    ],
    approach: "Maven AI's financial services practice is anchored in two capabilities: regulatory-grade AI governance (aligned to SAMA, CBUAE, and PDPL requirements), and data platform modernization that makes AI deployment technically feasible. We have designed governance frameworks for Saudi and UAE financial institutions that have passed regulatory examination — and we have built the data infrastructure to support them.",
    caseVignette: {
      title: "AI Governance for Regional Bank",
      client: "A GCC regional bank",
      challenge: "Prepare AI governance framework for SAMA examination, covering 12 production AI models across credit, fraud, and customer experience",
      approach: "Full model inventory, explainability framework, bias testing protocol, and audit trail implementation — aligned to SAMA AI Guidelines",
      outcome: "Passed SAMA model governance examination first attempt. Governance framework now serving as template across the bank's AI program.",
    },
    stats: [
      { value: "51%", label: "CAGR for GCC financial services AI compliance tools" },
      { value: "12", label: "AI models governed in flagship financial services engagement" },
      { value: "100%", label: "SAMA examination pass rate for governance frameworks we have designed" },
    ],
  },
];

export const stats = [
  { value: "200+", label: "Consultants via Maven Insights bench" },
  { value: "4", label: "GCC offices" },
  { value: "$50M+", label: "AI programs advised" },
  { value: "90 days", label: "MVP delivery commitment" },
  { value: "6", label: "Anchor accounts in Year 1" },
];

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
      color: "#0F9ED5",
    },
    {
      name: "RING 3",
      description: "Partners and contractors: Thoughtworks for platform-IP work, vetted contractor pool for surge specialization. Entirely variable — pay-per-engagement.",
      headcount: "Variable — pay-per-engagement",
      color: "#E97132",
    },
  ],
};

export const platformPartners = [
  "Microsoft Copilot Studio", "Google Vertex AI", "LangGraph / LangChain", "Anthropic Claude",
  "AWS", "Microsoft Azure", "Google Cloud", "G42 Sovereign Cloud",
  "Snowflake", "Databricks", "Thoughtworks AI/works", "GitHub Copilot Enterprise",
];
