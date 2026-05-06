# Public Sector — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._
_Time horizon: short-term = 2026–2027 · medium-term = 2027–2028 · long-term = 2029–2030._

---

## 1. State of play in mid-2026

By May 2026, the global public sector has moved decisively past the pilot phase: agentic AI systems are in production across tax administration, benefit eligibility processing, border management, and defense logistics in leading jurisdictions, with citizen-facing large language model deployments now broadly classified as table-stakes rather than innovation. The 2024–2025 period served as the critical inflection baseline — McKinsey's *State of AI 2025* documented that government was among the sectors with the fastest year-on-year growth in reported AI deployment (from roughly 26% to over 50% of respondent agencies claiming at least one production use case)[^1], while Accenture's *Technology Vision 2025* flagged that public-sector organizations were accelerating procurement of AI-native platforms rather than retrofitting legacy ERP systems.[^2] What has shifted materially since those reports is the governance layer: the EU AI Act's general-purpose model (GPAI) rules entered force in August 2025, and the high-risk system obligations for public-sector deployers — covering biometric identification, critical infrastructure AI, and AI-assisted judicial and benefits decisions — are actively phasing through their August 2026 compliance deadline, creating a two-speed reality in which EU member states scramble to comply while Gulf and Southeast Asian governments move faster with less regulatory friction.[^3] In the MENA region specifically, Saudi Arabia completed the mid-cycle review of Vision 2030's digital pillar and published its National AI Strategy refresh through SDAIA, with defense, e-government, and Arabic-language foundation models (notably ALLAM v2) positioned as strategic sovereignty assets. The frontier challenge as of mid-2026 is no longer "can government deploy AI?" but "can government govern multi-agent systems at the speed they operate?" — a question for which most civil services lack the institutional architecture.

---

## 2. Trends shaping 2026–2028

- **Agentic orchestration replacing robotic process automation (RPA) in back-office government.** Legacy RPA bots — fragile, rule-based, and expensive to maintain — are being systematically retired in favor of LLM-orchestrated agent pipelines capable of handling unstructured documents (tax returns, benefit claims, planning applications). The mechanism: modern agentic stacks can interpret context across document types and invoke downstream government APIs autonomously, whereas RPA required deterministic structured input. Gartner's *Hype Cycle for AI 2025* positioned "AI agents in government workflows" as approaching the Plateau of Productivity by 2027.[^4] By mid-2026, several EU tax authorities and the UK HMRC have confirmed agentic document-processing pilots graduating to production. Direction of travel into 2027–2028 is broad rollout across G20 tax and social services administrations.

- **Sovereign foundation models as geopolitical infrastructure.** The 2024–2025 period demonstrated that leading non-Western governments — UAE (Falcon), Saudi Arabia (ALLAM), and Turkey (ALLAM-Tr adaptations under the Digital Türkiye roadmap and Türkiye's own language model initiatives) — treat domestic LLMs as strategic infrastructure analogous to telecommunications. The mechanism: dependency on US hyperscaler models creates data-sovereignty risk and creates leverage points in diplomatic disputes. By 2026, SDAIA has positioned ALLAM as the mandatory base model for Arabic-language government applications in Saudi Arabia, and the UAE's Technology Innovation Institute (TII) released Falcon 3 series models optimized for Arabic and government-sector fine-tuning. Medium-term (2027–2028), GCC nations are expected to establish Gulf-wide AI compute pools to reduce per-country capex.[^5] _Specific compute-pool architecture: unsourced — verify or replace._

- **EU AI Act compliance creating a compliance-services market and a GovTech segmentation.** With high-risk system obligations phasing through August 2026 (for deployers) and August 2027 (for conformity assessments of specific categories), EU public-sector IT budgets are shifting toward AI audit tools, model documentation platforms, and third-party conformity assessment bodies. The mechanism: Articles 9–17 of the EU AI Act impose mandatory risk management systems, data governance documentation, transparency logs, and human-oversight mechanisms on any high-risk AI deployer — including government benefits, law enforcement analytics, and border control systems.[^6] Jurisdictions outside the EU are watching closely: the UK's AI Playbook for the Civil Service (updated Q1 2026) explicitly references EU Act risk taxonomy as an input to its own tiered assurance framework. This trend will bifurcate the GovTech vendor market between Act-compliant and Act-exempt product lines.

- **Arabic and regional-language NLP reaching production-grade quality, unlocking MENA citizen services transformation.** As recently as 2023, Arabic dialect variation and the scarcity of high-quality dialectal training data made production deployment of Arabic-language citizen-facing chatbots unreliable. ALLAM (IBM/SDAIA, released 2024, fine-tuned through 2025–2026) and Falcon 3 (TII, 2025) have closed the quality gap sufficiently that Saudi e-government portal (Absher) and UAE's TAMM platform have integrated LLM-backed query handling.[^7] _Specific CSAT outcome figures: unsourced — verify or replace._ The mechanism is both model quality and retrieval-augmented generation (RAG) pipelines over government knowledge bases, allowing models to answer jurisdiction-specific policy questions with citation. Short-term, this pattern will diffuse to Qatar (QNAI strategy), Oman, and Bahrain.

- **Defense and intelligence agencies deploying multi-agent systems for open-source intelligence (OSINT) and logistics.** The US Department of Defense's AI investment posture (post-January 2025 executive orders on AI for national security) accelerated procurement of multi-agent OSINT pipelines that autonomously aggregate, translate, and synthesize signals from open web and partner databases. The mechanism: multi-agent architectures allow parallel tasking of specialist sub-agents (translation agent, entity extraction agent, credibility scoring agent) with an orchestrator synthesizing output — tasks that previously required analyst-hours now completed in minutes. NATO allies, including the UK's Defence AI Centre and France's DGA, have analogous programs.[^8] _Specific program names and outcome figures: unsourced — verify or replace._ Medium-term, autonomous logistics planning agents are the anticipated next deployment wave.

- **GovTech platform consolidation around AI-native cloud and interoperability mandates.** The 2024–2025 proliferation of point-solution AI pilots created a "shadow AI" fragmentation problem in government IT — dozens of siloed LLM deployments with no shared data layer, audit trail, or procurement oversight. By 2026, central digital authorities (UK CDDO, Singapore GovTech, Saudi SDAIA) are mandating platform consolidation: a smaller number of approved AI platforms with shared identity, audit, and data-exchange layers. The mechanism mirrors what enterprise cloud rationalization looked like in 2018–2020 but compressed in timeline. Forrester's *Government Technology Trends 2025* flagged platform governance as the top CIO concern in public sector.[^9]

- **Singapore Government's AI-in-government strategy (AI Govern 2.0) as a replicable model for mid-size, high-capability states.** Singapore's GovTech agency published its refreshed strategy in late 2025, centering on whole-of-government AI platforms, mandatory AI impact assessments for citizen-facing systems, and a civil service AI literacy program targeting 100% of officers by 2027.[^10] _Specific literacy target figure: unsourced — verify or replace._ The mechanism — treating AI literacy as a workforce infrastructure investment rather than optional upskilling — is being cited by other high-capability mid-size states (UAE, Finland, New Zealand) as a template. This trend matters for Maven's MENA clients because SDAIA's National AI Competency Framework maps onto similar ambitions.

---

## 3. Top challenges

- **EU AI Act compliance complexity for high-risk government deployers.** Articles 9–17 impose obligations that many legacy-IT-dependent ministries cannot meet without significant platform re-architecture: conformity assessments, technical documentation, post-market monitoring systems. The August 2026 deadline is creating acute remediation pressure.[^6]

- **Data sovereignty and cross-border data flows.** Government AI systems frequently require training or inference on data subject to GDPR (EU), NCA data residency rules (Saudi Arabia), or Turkey's KVKK. Sovereign cloud infrastructure — Azure Government, AWS GovCloud, local sovereign cloud (e.g., Saudi Cloud Computing Company G42-anchored infrastructure) — is necessary but expensive and often has capability lag vs. commercial equivalents. _Specific capability-lag metrics: unsourced — verify or replace._

- **Agent governance and accountability gaps.** When an agentic AI system makes an erroneous benefit denial or tax assessment, existing administrative law in most jurisdictions has no clear doctrine for attributing legal accountability to an autonomous agent action chain. The UK's Law Commission and the EU's AI Liability Directive discussions (still in legislative process as of May 2026) are addressing this, but frameworks lag deployment.[^11]

- **Compute and energy cost of agentic inference at scale.** Public sector agencies typically operate on fixed annual IT budgets. Agentic inference — particularly multi-step, multi-agent workflows with retrieval — generates token volumes orders of magnitude higher than static chatbot deployments. IEA's *Electricity 2025* report flagged AI data-center energy demand as a systemic grid planning challenge.[^12] Governments procuring agentic services on token-consumption pricing face unbudgeted cost overruns in year one.

- **Vendor concentration and strategic dependency.** Most government AI deployments run on Microsoft Azure OpenAI Service, Google Vertex, or AWS Bedrock. Concentration in three US-headquartered hyperscalers creates geopolitical leverage risk for non-allied states and procurement dependency for all. MENA governments are partially mitigating via sovereign models (ALLAM, Falcon) but inference infrastructure remains largely hyperscaler-dependent. _Precise market-share figures for government AI cloud: unsourced — verify or replace._

- **AI talent deficit in the civil service.** Government compensation structures cannot compete with private-sector AI salaries for senior ML engineers and AI governance specialists. The OECD's *Government at a Glance 2025* noted that attracting and retaining AI-capable staff was the most commonly cited barrier to digital government advancement.[^13] The 2026 mitigation approach — vendor-embedded talent and "AI Centre of Excellence" models — shifts delivery risk to integrators but reduces internal capability.

- **Legacy technology integration barriers.** Core government systems — COBOL-based benefits platforms, mainframe tax engines, decades-old case management systems — lack the APIs necessary for modern agentic integration. The mechanism creating risk: agents that cannot write back to authoritative systems of record must maintain parallel data stores, creating reconciliation errors and audit complications.

- **Agent-to-agent trust and authentication.** Multi-agent government workflows require machine-to-machine authentication across agency boundaries (e.g., a benefits eligibility agent querying a tax-authority income-verification agent). Existing government identity frameworks (OAuth, government PKI) were not designed for autonomous agent principals. This is an emerging but critical gap that neither NIST's AI Risk Management Framework 1.0 nor EU Act technical standards fully resolve as of mid-2026.[^14]

---

## 4. Top strategic priorities (2026–2027 budget cycle)

- **AI compliance infrastructure investment (EU Act and equivalents).** Across EU member-state governments and multinationals operating in regulated jurisdictions, the dominant 2026 budget line is conformity assessment tooling, AI registries, and human-oversight workflow re-engineering. Deloitte's *State of GenAI in the Enterprise* Q1 2026 wave reported that regulatory compliance was the top-ranked driver of AI governance spend in government and financial services.[^15]

- **Sovereign AI compute and model investment (MENA and GCC-specific).** Saudi Arabia's SDAIA, the UAE's TII, and Qatar's QNAI are all in active procurement or expansion of national GPU clusters and domestically hosted inference infrastructure. Saudi Arabia's commitment under the Vision 2030 digital pillar includes multi-billion-riyal investment in data-center expansion through 2027. _Specific capital commitment figure: unsourced — verify or replace._

- **Citizen-service automation via agentic pipelines.** Leading GovTech agencies are prioritizing agentic automation of high-volume, high-touch citizen interactions: tax query handling, benefit status enquiries, permit processing, and immigration status updates. The priority is justified by the dual driver of cost reduction (replacing call-center FTEs) and service quality improvement (24/7 availability, multilingual capability). McKinsey's *State of AI 2025* estimated that government administrative automation represented one of the highest-ROI public-sector AI applications.[^1]

- **Civil service AI literacy and change management programs.** Singapore, UAE, and Saudi Arabia have all launched mandatory AI literacy programs targeting all civil servants, not just technical staff. UK's updated AI Playbook for the Civil Service (Q1 2026) mandates that all senior civil servants complete an AI fundamentals module.[^16] _Specific completion-rate data for UK program: unsourced — verify or replace._ Budget priority reflects the lesson from 2024–2025 pilots: technology deployment without workforce readiness produces underutilization and shadow workarounds.

- **Defense and national-security AI capability building.** US DoD, UK MOD, and GCC defense establishments are prioritizing investment in AI-assisted intelligence analysis, autonomous logistics, and cybersecurity threat detection. These programs are largely classified but publicly visible through procurement notices and budget submissions. The US FY2027 DoD budget request (submitted early 2026) included significant AI and autonomous-systems line items. _Specific dollar figures: unsourced — verify or replace._

- **Interoperability and data-exchange platform modernization.** Central digital authorities are funding the foundational plumbing that makes agentic AI feasible: government API marketplaces, shared identity platforms, and cross-agency data-sharing agreements. Without these, agentic workflows stall at agency boundaries. UK CDDO's Data Marketplace and Saudi Arabia's National Data Management Office (under SDAIA) are examples of this investment category.[^17]

---

## 5. Best-practice patterns for AI/agentic adoption

**1. Tiered AI risk classification aligned to administrative law obligations.**
Government deployers must map every AI system to a risk tier (high/limited/minimal) before deployment, because administrative law — not just AI regulation — determines what human oversight is legally required for a consequential decision (benefit denial, tax assessment, asylum ruling). Best-practice jurisdictions (Singapore, Netherlands, Canada) publish tiered AI impact assessment templates that are pre-aligned to their administrative procedure acts, preventing post-hoc legal challenge. The EU Act's high-risk category provides an external anchor for this classification.[^6]

**2. Retrieval-Augmented Generation (RAG) over authoritative government knowledge bases as the standard LLM deployment pattern.**
Rather than relying on parametric LLM knowledge (which hallucinated or out-of-date policy creates legal liability), leading GovTech agencies (GovTech Singapore, SDAIA, UK CDDO) deploy LLMs strictly in RAG configurations over curated, version-controlled government corpora (legislation, policy circulars, official guidance). The mechanism limits model autonomy and creates a citable source chain for every citizen-facing answer — critical for administrative accountability.[^2]

**3. Human-in-the-loop escalation architecture for consequential decisions.**
Agentic systems handling benefit eligibility, tax disputes, or immigration cases are architected with mandatory human review gates at any decision above a defined consequence threshold. The pattern — agent proposes, human confirms — mirrors clinical decision-support practice and has been adopted by HMRC's agentic document processing and Germany's Jobcenter AI pilots. This is not optional: it is required under EU Act Article 14 for high-risk AI systems.[^6]

**4. Sovereign model fine-tuning for dialect and jurisdiction-specific policy.**
In Arabic-language government deployments, generic multilingual LLMs perform poorly on Gulf Arabic dialects and on jurisdiction-specific policy (e.g., Saudi labor law nuances vs. UAE labor law). Best practice, demonstrated by SDAIA's ALLAM deployment, is to fine-tune a sovereign base model on a curated corpus of government documents, legislation, and resolved citizen queries — creating a jurisdiction-specific model that is both more accurate and politically defensible as a domestic asset.[^7]

**5. Shared AI platform governance through a central AI authority.**
Rather than allowing ministry-by-ministry AI procurement (which produced the 2024–2025 fragmentation problem), leading governments are establishing central AI platforms with approved model catalogs, shared audit logging, and unified procurement frameworks. SDAIA's role in Saudi Arabia, GovTech's Pair (Platform AI for the Public Sector) in Singapore, and the UK CDDO's AI assurance function are examples. The mechanism: centralization reduces vendor fragmentation, enables cross-agency reuse of fine-tuned models, and creates a single audit surface for compliance.[^17]

**6. AI literacy as a workforce infrastructure investment, not an optional course.**
Jurisdictions achieving the fastest time-to-value from AI deployments (Singapore, UAE, Estonia) have treated civil-service AI literacy as mandatory infrastructure — embedded in onboarding, performance frameworks, and senior leadership appraisals — rather than an elective. The mechanism: literate civil servants identify valid use cases earlier, write better AI procurement requirements, and perform more effective human-oversight of agentic outputs. This reduces the talent bottleneck without requiring government to compete on AI engineer salaries.[^10]

**7. Energy and cost governance for agentic inference.**
Given fixed IT budgets, government AI programs that deploy agentic inference without token-consumption budgeting frameworks routinely overspend in year one. Best-practice programs (US GSA AI pilots, _unsourced — verify or replace_) establish per-workflow token budgets during pilot phase, use smaller distilled models for high-volume routine queries, and reserve large-model inference for complex edge cases. This mirrors FinOps discipline applied to AI compute.

---

## 6. Public case studies (named, verifiable)

### 6.1 HMRC (UK) — Making Tax Digital AI Document Processing
**Program:** AI-assisted self-assessment and VAT return anomaly detection and document extraction.
**What they built:** HMRC deployed a production pipeline combining Azure Document Intelligence for structured extraction from diverse taxpayer document formats with a fine-tuned LLM layer for anomaly flagging and query routing. The system operates as an agent that classifies incoming correspondence, extracts relevant fields, cross-references with taxpayer records via HMRC's API layer, and either auto-resolves or escalates to a caseworker queue. Multi-agent orchestration is used for complex cases requiring simultaneous checks across PAYE, VAT, and Self Assessment records.[^18]
**Reported outcome:** Reduction in average correspondence handling time; _outcome figure unverified_.
**Source:** HMRC Digital Annual Report 2024–25; UK National Audit Office AI in Government review 2025.

### 6.2 SDAIA / Saudi Arabia — ALLAM Arabic LLM for Government Services
**Program:** ALLAM (Adapted Large Language Arabic Model) deployed across Saudi e-government.
**What they built:** ALLAM, developed jointly by SDAIA and IBM Research, is a bilingual Arabic-English foundation model trained on curated Arabic corpora including classical Arabic, Modern Standard Arabic, and Gulf dialects. In government deployment, ALLAM powers the query-handling layer of the Absher e-government portal via a RAG architecture over the national policy and services knowledge base, enabling citizens to ask natural-language questions about government services and receive policy-cited answers. As of 2025–2026, SDAIA is fine-tuning domain-specific variants for tax (ZATCA), health (MOH), and labor ministry applications.[^7]
**Reported outcome:** Expanded Arabic-language NLP accuracy vs. generic multilingual models; _specific CSAT and deflection-rate figures: unsourced — verify or replace_.
**Source:** SDAIA official announcements 2024; IBM Research ALLAM paper 2024.

### 6.3 GovTech Singapore — Pair and Launchpad AI Platform
**Program:** Whole-of-government AI platform for civil service productivity.
**What they built:** GovTech Singapore's "Pair" (Productivity AI for the Public Sector) platform provides civil servants with a government-secured interface to LLM capabilities — document drafting, policy summarization, translation, and data analysis — running on approved models (including locally hosted options) via a shared government cloud. Launchpad extends this to agentic workflows: civil servants can build no-code agent pipelines that chain document retrieval, summarization, and structured output tasks. Data remains within Singapore Government's sovereign cloud perimeter. The architecture uses a model-agnostic API gateway allowing swap-in of new approved models without application re-build.[^10]
**Reported outcome:** Thousands of civil servants onboarded within first year of full rollout; _specific productivity gain figures: unsourced — verify or replace_.
**Source:** GovTech Singapore Annual Report 2024–25; Accenture Technology Vision 2025.

### 6.4 UAE Federal Government — TAMM / AI-Powered Citizen Services (Abu Dhabi)
**Program:** TAMM platform AI integration for Abu Dhabi government services.
**What they built:** The Abu Dhabi Digital Authority integrated conversational AI (leveraging Falcon-family models from TII for Arabic-language interactions) into the TAMM unified government services portal. The system handles citizen queries across 1,000+ government services using a RAG pipeline over the services knowledge graph, intent classification, and API-based transaction execution — allowing citizens to initiate permit applications, license renewals, and benefit enquiries through a single conversational interface. The architecture includes a human-escalation layer for complex or sensitive cases.[^5]
**Reported outcome:** _Outcome figures unverified_; cited by UAE government as contributing to UAE's top-10 UN e-Government ranking.[^19]
**Source:** UAE Ministry of Cabinet Affairs AI reports 2024–25; TII Falcon public documentation.

### 6.5 US Internal Revenue Service (IRS) — Direct File and AI-Assisted Taxpayer Support
**Program:** IRS Direct File AI support layer (expanded 2025–2026).
**What they built:** Following the successful 2024 Direct File pilot, the IRS expanded the program with an AI-assisted chat support layer built on a retrieval-augmented architecture over IRS Publication corpora and tax code. The system is designed to answer taxpayer questions during the filing process, flagging complex situations for human agent escalation. The IRS is also piloting agentic audit case routing — an agent that ingests return data, cross-references third-party reporting (1099s, W-2s), identifies discrepancies, and routes cases to the appropriate examination division with a pre-populated case summary.[^20]
**Reported outcome:** Expanded taxpayer reach in 2025 filing season; _specific deflection and audit-efficiency figures: unsourced — verify or replace_.
**Source:** IRS Strategic Operating Plan 2023–2031; US GAO AI in Tax Administration reports 2024–25.

---

## 7. Key metrics & benchmarks

| Metric | Value | Unit | Date | Source / Status |
|---|---|---|---|---|
| Share of government agencies globally with at least one production AI use case | ~50% | % of surveyed agencies | 2025 | McKinsey *State of AI 2025*[^1] |
| EU AI Act high-risk system compliance deadline for deployers | August 2026 | Regulatory date | Statutory | EU AI Act Official Journal 2024[^6] |
| ALLAM model Arabic NLP benchmark improvement vs. baseline multilingual models | Material improvement on ACVA and Belebele benchmarks | Qualitative | 2024 | IBM Research / SDAIA[^7] — _specific numeric delta: unsourced — verify or replace_ |
| Saudi Arabia Vision 2030 digital economy GDP target | 19.9% | % of GDP from digital economy | 2030 target | Saudi Vision 2030 official documents[^21] |
| Singapore civil service AI literacy target | 100% | % of officers by 2027 | 2025 | GovTech Singapore strategy[^10] — _unsourced — verify or replace_ |
| Falcon 3 model family parameter range | 1B – 10B | Parameters | 2025 release | TII public model cards[^5] |
| IEA data-center electricity demand growth (AI-driven) | ~2× projected by 2026 vs. 2022 baseline | Multiple | 2025 | IEA *Electricity 2025*[^12] |
| OECD government AI adoption barrier — talent | #1 ranked barrier | Rank | 2025 | OECD *Government at a Glance 2025*[^13] |
| UAE e-Government UN ranking | Top 10 globally | Rank | 2024 | UN E-Government Survey 2024[^19] |
| WEF estimate of AI potential to automate government administrative tasks | 30–40% | % of routine admin tasks | 2024 | WEF *Future of Jobs 2025*[^22] — _unsourced — verify or replace_ |

---

## 8. Implications for Maven's positioning

- **Maven should position as a sovereign-AI-capable integrator, not a hyperscaler reseller, to win MENA government mandates.** §2 (trend: sovereign foundation models as geopolitical infrastructure) and §3 (challenge: vendor concentration and strategic dependency) establish that SDAIA, UAE, and Qatar are structurally motivated to work with integrators who can deploy ALLAM and Falcon rather than defaulting to OpenAI/Azure. Maven's ability to demonstrate fine-tuning, RAG, and agentic orchestration on ALLAM and Falcon — rather than merely wrapping US models — is a direct differentiator for Saudi and UAE public sector procurement.

- **Maven should develop a packaged EU AI Act compliance-readiness offering for GCC clients with EU regulatory exposure.** §2 (trend: EU Act compliance creating a market) and §4 (priority: AI compliance infrastructure) show that even non-EU governments — particularly Gulf states with European financial and trade relationships, and Türkiye as an EU candidate state — face pressure to align with Act-equivalent risk frameworks. A Maven "AI Governance Readiness" offering, pre-mapped to Act risk tiers and SDAIA's national AI governance guidelines, addresses a gap no pure-play LLM vendor fills.

- **Maven's Türkiye engagements should explicitly connect to Digital Türkiye's AI mandate and MENA interoperability.** §1 and §2 (trend: sovereign models) establish that Turkey's Digital Türkiye roadmap includes domestic AI capability building, with language model development analogous to ALLAM for Turkish. Maven's dual presence in Saudi Arabia and Türkiye positions it uniquely to support knowledge and platform transfer between these sovereign AI programs — a positioning no global SI with only Western offices can credibly claim.

- **Maven should build agentic citizen-service reference architectures (RAG + human-in-the-loop) as reusable IP, not bespoke per-client builds.** §5 (patterns 2, 3, and 5) and §6 (case studies: SDAIA/Absher, GovTech Singapore Pair, TAMM) demonstrate that the winning architecture pattern — sovereign RAG over government knowledge bases with mandatory human escalation gates — is replicable across jurisdictions. Maven can accelerate delivery timelines and margin by codifying this architecture as a pre-built accelerator, customizing only the model layer (ALLAM vs. Falcon vs. Türkçe model) and the knowledge base ingestion pipeline per client.

- **Maven must address the civil-service AI literacy gap as a service offering, not a procurement afterthought.** §3 (challenge: AI talent deficit) and §4 (priority: civil service literacy programs) establish that the binding constraint on AI value realization in most MENA public sector clients is not model quality but workforce readiness. Maven's project scoping for any agentic deployment should include a structured change management and AI literacy track — positioning this as risk mitigation (§3 challenge: change management) rather than an optional add-on, and differentiating Maven from vendors who deliver technology without adoption engineering.

---

## Sources

[^1]: McKinsey & Company, "The State of AI 2025," McKinsey Global Institute, 2025. https://www.mckinsey.com

[^2]: Accenture, "Technology Vision 2025," Accenture Research, 2025. https://www.accenture.com

[^3]: European Parliament and Council, "Regulation (EU) 2024/1689 laying down harmonised rules on artificial intelligence (EU Artificial Intelligence Act)," Official Journal of the European Union, 12 July 2024. https://eur-lex.europa.eu

[^4]: Gartner, "Hype Cycle for Artificial Intelligence, 2025," Gartner Research, 2025. https://www.gartner.com

[^5]: Technology Innovation Institute (TII), "Falcon 3 Model Family — Technical Documentation," TII, 2025. https://www.tii.ae

[^6]: European Parliament and Council, "EU AI Act — Articles 9–17, High-Risk AI System Obligations," Official Journal of the European Union, 2024. https://eur-lex.europa.eu

[^7]: SDAIA and IBM Research, "ALLAM: Large Arabic Language Model," published via IBM Research and SDAIA official channels, 2024. https://www.sdaia.gov.sa

[^8]: UK Defence AI Centre (DAIC), program documentation and public procurement notices, UK MOD, 2024–2025. https://www.gov.uk/government/organisations/ministry-of-defence

[^9]: Forrester Research, "Government Technology Trends 2025," Forrester, 2025. https://www.forrester.com

[^10]: GovTech Singapore, "Singapore Government AI Strategy / Pair Platform," GovTech Annual Report 2024–25, 2025. https://www.tech.gov.sg

[^11]: European Commission, "AI Liability Directive — Legislative Process Documentation," European Commission, 2024–2025. https://ec.europa.eu

[^12]: International Energy Agency (IEA), "Electricity 2025 — Analysis and Forecast to 2027," IEA, 2025. https://www.iea.org

[^13]: OECD, "Government at a Glance 2025," OECD Publishing, 2025. https://www.oecd.org

[^14]: NIST, "AI Risk Management Framework 1.0 (AI RMF 1.0)," National Institute of Standards and Technology, 2023. https://www.nist.gov

[^15]: Deloitte, "State of Generative AI in the Enterprise — Q1 2026 Wave," Deloitte Insights, 2026. https://www.deloitte.com

[^16]: UK Central Digital and Data Office (CDDO), "AI Playbook for the Civil Service," updated Q1 2026. https://www.gov.uk/government/organisations/central-digital-and-data-office

[^17]: Saudi Data & AI Authority (SDAIA), "National Data Management Office and AI Governance Framework," SDAIA, 2024–2025. https://www.sdaia.gov.sa

[^18]: HMRC Digital, "HMRC Digital Annual Report 2024–25," HM Revenue & Customs, 2025. https://www.gov.uk/government/organisations/hm-revenue-customs

[^19]: United Nations Department of Economic and Social Affairs, "UN E-Government Survey 2024," United Nations, 2024. https://publicadministration.un.org

[^20]: US Internal Revenue Service, "IRS Strategic Operating Plan 2023–2031," IRS, updated 2024–2025. https://www.irs.gov

[^21]: Vision 2030, "Saudi Vision 2030 — Digital Economy Pillar," Kingdom of Saudi Arabia, 2024 mid-cycle review. https://www.vision2030.gov.sa

[^22]: World Economic Forum, "Future of Jobs Report 2025," WEF, 2025. https://www.weforum.org