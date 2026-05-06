# Telecom — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._

---

## 1. Global AI & Agentic Transformation Trends (2024–2026)

- **From narrow automation to orchestrated agentic networks.** The telecom sector has moved from rule-based RPA and predictive analytics into the early orchestration phase of agentic AI, where autonomous agents manage network self-healing, churn intervention, and fraud response with minimal human approval loops. TM Forum's *AI & Autonomous Networks* programme (2024) places most Tier 1 operators at Autonomous Network Level 2–3 on its five-level maturity scale, with a target of Level 4 ("intent-driven") by 2026.[^1]

- **AI-RAN emerges as a structural capex catalyst.** The convergence of AI and Radio Access Network (RAN) architecture—branded AI-RAN—is the most capital-intensive AI inflection point for operators since the 4G build-out. GSMA Intelligence's *The Mobile Economy 2025* projects that AI-driven RAN optimisation and the associated infrastructure spend will be a primary driver of the ~$700 billion in mobile capex committed globally through 2030.[^2] Nvidia, Ericsson, and Nokia have all announced commercial AI-RAN reference architectures, signalling vendor ecosystem maturity. (_Specific partnership revenue figures — unsourced — verify or replace._)

- **Customer-care generative AI achieves mainstream deployment.** Omdia's *AI in Telecoms* tracker (2024) identifies conversational AI and generative-AI-assisted agent copilots as the single most widely deployed AI use case across global operators, ahead of network and fraud applications.[^3] The shift from scripted chatbots to large-language-model (LLM)-powered virtual agents represents a qualitative capability leap in containment rate and first-contact resolution.

- **B2B and IoT monetisation through AI-defined services.** STL Partners' *Telco AI Strategy* research (2024) highlights that operators' largest near-term revenue opportunity from AI is not internal efficiency but the productisation of AI capabilities for enterprise customers — particularly in private 5G, IoT analytics, and edge-AI managed services.[^4]

- **Fraud and revenue assurance reach agentic maturity.** Real-time AI fraud detection, now integrated with agentic response (automatic call blocking, SIM-swap interception), is one of the most commercially justified AI deployments in telecoms. The Communications Fraud Control Association (CFCA) *Global Fraud Loss Survey 2023* estimated industry fraud losses at $38.95 billion annually, providing a clear financial mandate.[^5]

- **Talent and vendor-ecosystem pressure intensify in 2025–2026.** IDC's *FutureScape: Worldwide Telecommunications 2025 Predictions* flags the acute shortage of ML engineers and AI-infrastructure talent within operator organisations as a key constraint on AI scaling, predicting that by 2026 over 60% of operators will rely on hyperscaler or specialist-vendor co-development for core AI capabilities.[^6]

---

## 2. Top Challenges

- **Regulatory fragmentation and AI governance obligations.** Operators are subject to overlapping regimes: the EU AI Act (effective 2024–2026 phased enforcement) classifies certain network-decision and creditworthiness AI systems as high-risk, requiring conformity assessments and human-oversight mechanisms.[^7] In parallel, national telecoms regulators (Ofcom, BNetzA, FCC) are developing AI-specific spectrum and consumer-protection guidance. Compliance cost and legal uncertainty slow deployment timelines across jurisdictions.

- **Legacy OSS/BSS architecture incompatibility.** Most operators run decades-old Operations Support Systems and Business Support Systems that were not designed for real-time ML inference. TM Forum's *Open Digital Architecture* initiative documents the integration complexity as the primary technical barrier to autonomous network operations, noting that data pipeline latency in legacy stacks often negates the value of AI decisioning.[^1]

- **Data silos and poor data quality.** Network telemetry, customer experience data, and billing records are typically held in separate, poorly governed lakes. Without unified, clean, labelled data estates, model performance degrades rapidly in production. Omdia's *AI in Telecoms* survey (2024) found that over 55% of operators cited data quality and accessibility as their top AI implementation barrier.[^3] (_Exact survey percentage — verify against primary report._)

- **Agent governance and model risk in safety-critical environments.** Unlike retail or financial services, telecom networks are critical national infrastructure. An agentic system making autonomous routing or load-balancing decisions creates operational risk if the model hallucinates or overfits to historical traffic patterns. TM Forum's Autonomous Networks working group has published guidance on human-in-the-loop escalation thresholds, but industry standards remain immature.[^1]

- **Spectrum and energy cost pressure limiting AI-RAN investment.** AI-RAN and distributed AI inference at the network edge add significant power consumption. The IEA's *Electricity 2024* report flags data centres and telecoms infrastructure as among the fastest-growing electricity demand categories globally, and operators face capex trade-offs between AI capability and sustainability commitments.[^8]

- **Talent scarcity and organisational capability gaps.** The World Economic Forum's *Future of Jobs Report 2025* identifies AI and machine learning specialists as among the most in-demand but hardest-to-hire roles across all sectors.[^9] Telecom's historically engineering-heavy culture, often without strong data-science functions, makes internal upskilling particularly slow.

- **Vendor lock-in risk in AI platform selection.** Many operators are consolidating AI/ML workloads onto one of three hyperscaler platforms (AWS, Azure, Google Cloud). STL Partners warns that without an explicit multi-cloud or open-RAN-aligned strategy, operators risk surrendering negotiating leverage and strategic autonomy over their own network intelligence.[^4]

- **Customer trust and explainability in AI-driven offers.** Regulators and consumer advocacy groups are increasingly scrutinising personalised pricing and churn-based offers generated by AI models. The EU AI Act's transparency requirements for consumer-facing AI systems apply directly to operator marketing and care use cases.[^7]

---

## 3. Top Strategic Priorities

- **Autonomous Network Operations (Level 3–4 programmes).** Leading operators are investing in closed-loop AI systems for network fault prediction, self-healing, and capacity management. TM Forum estimates that Level 4 autonomous operations could reduce network operations costs by up to 20–30%, driving the business case for multi-year transformation programmes.[^1] (_Exact cost-reduction estimate — verify against current TM Forum Autonomous Networks report._)

- **Generative AI copilots for customer care and field operations.** Budget allocation for LLM-based agent-assist tools is accelerating, targeting both contact-centre cost reduction and improved CSAT/NPS. The near-term agentic extension — where virtual agents resolve tickets end-to-end without human hand-off — is the 2025–2026 competitive differentiator for operators with mature chatbot programmes. [^3]

- **AI-driven capex optimisation and network planning.** Operators are deploying ML models to predict traffic demand, optimise site selection, and dynamically allocate RAN resources, reducing unnecessary infrastructure spend. Bell Labs' *Technology Journal* research has consistently shown that AI-based traffic engineering can improve spectral efficiency by double-digit percentage points. (_Specific efficiency figure — unsourced — verify or replace._)[^10]

- **Fraud and revenue assurance automation.** Following the CFCA's quantification of the fraud loss universe[^5], operators are prioritising agentic fraud-management systems that move from detect-and-alert to detect-and-act, embedding autonomous blocking and adaptive model retraining pipelines.

- **Enterprise AI services and private-network monetisation.** As internal AI matures, forward-leaning operators are packaging AI capabilities (edge inference, network slicing analytics, IoT anomaly detection) as billable enterprise services. GSMA's *Network as a Service* framework provides the commercial and API standardisation layer underpinning this strategy.[^2]

- **Data platform modernisation as an AI pre-condition.** Recognising that model quality is bounded by data quality, leading operators are prioritising investment in cloud-native data mesh architectures, real-time streaming pipelines, and unified customer data platforms before scaling model deployment. IDC's telco predictions cite this as a top-three IT priority for 2025.[^6]

---

## 4. Best-Practice Patterns for AI/Agentic Adoption

**1. Closed-Loop RAN Optimisation with Human Escalation Thresholds**
Deploy AI agents that autonomously adjust antenna tilt, power, and handover parameters within pre-defined operational envelopes, escalating to human engineers only when confidence scores fall below threshold or impact exceeds defined KPIs. TM Forum's Autonomous Networks Level 3 specification provides a reference architecture for defining these escalation boundaries.[^1]

**2. LLM-Orchestrated Omnichannel Care with Intent Routing**
Rather than routing customers to separate bots per channel, leading operators deploy a single LLM-orchestrated intent layer that triages across voice, chat, and app interactions, maintaining session context and passing enriched intent data to specialist downstream agents (billing resolution, network fault, device support). This reduces average handling time and eliminates context-loss at channel boundaries. (_Outcome benchmarks for this pattern — unsourced — verify or replace._)

**3. Federated Fraud Intelligence Across Network Layers**
Operators achieving best-in-class fraud detection share fraud signals across voice, SMS, data, and roaming layers in a unified feature store, enabling ensemble models to catch cross-channel fraud patterns (e.g., SIM-swap followed by SMS OTP interception) that single-layer models miss. GSMA's *Fraud Intelligence* programme documents this architectural approach.[^2]

**4. AI-First Network-as-Code for Capex Governance**
Network planning teams at advanced operators version-control AI-generated network configuration changes alongside financial impact models, enabling automated rollback if predicted KPIs are not achieved post-deployment. This "network-as-code" discipline is emerging as a best practice in Bell Labs' applied research community.[^10]

**5. Agent Governance Frameworks Borrowed from Financial Services**
Given the critical-infrastructure status of telecom networks, leading operators are adapting model risk management frameworks (model inventory, champion-challenger testing, drift monitoring, explainability documentation) from banking-sector practice — analogous to the SR 11-7 model risk management guidance in the US — and applying them to network AI agents. (_Specific operator adoption of this pattern — unsourced — verify or replace._)

**6. Progressive Autonomy Pilots in Non-Production Network Slices**
Best-practice operators trial new agentic network capabilities in isolated 5G network slices or digital twin environments before promoting to production, reducing blast radius and accelerating regulatory approval for autonomous operation. Ericsson and Nokia both document this approach in their AI-RAN reference designs. (_Specific publication references — verify against vendor documentation._)

---

## 5. Public Case Studies

### 5.1 Vodafone — TOBi Virtual Agent & EvaBot (Europe/Global)
**Program:** Conversational AI for customer care (copilot + self-serve virtual agent)
**What they built:** Vodafone deployed TOBi as an LLM-enhanced virtual agent across 13 markets, handling billing queries, fault triage, and plan changes. EvaBot (internal) assists call-centre agents with real-time knowledge retrieval.
**Reported outcome:** Vodafone has publicly stated TOBi handles tens of millions of customer interactions per month. Containment rate improvement and CSAT figures have been referenced in earnings calls. _Outcome figure unverified — verify against Vodafone investor relations or TM Forum case study._
**Source:** Vodafone Group press releases; TM Forum Inform case study library (https://www.tmforum.org)

### 5.2 AT&T — "Ask AT&T" Internal GenAI Assistant (USA)
**Program:** Enterprise-wide generative AI copilot for employees
**What they built:** AT&T deployed an internal LLM-based assistant ("Ask AT&T") enabling employees across network engineering, customer service, and IT to query internal documentation, generate code, and summarise tickets. AT&T's Chief Data Officer has publicly described the programme in interviews and conference presentations.
**Reported outcome:** AT&T reported productivity gains in developer and care workflows. _Specific productivity percentage — outcome figure unverified — verify against AT&T public statements or earnings calls._
**Source:** AT&T Investor Relations; public executive statements at industry conferences (https://www.att.com)

### 5.3 Telefónica — Aura AI Platform (Spain/LATAM)
**Program:** Aura — cognitive intelligence platform
**What they built:** Telefónica built Aura as a data-driven, privacy-by-design AI layer exposed to customers across Movistar and O2 brands, offering personalised network insights, usage summaries, and predictive recommendations. Aura is also federated across Telefónica's operating companies using a common API layer.
**Reported outcome:** Telefónica has reported Aura active across multiple markets with hundreds of millions of data interactions processed. _Specific user or revenue figures — outcome figure unverified — verify against Telefónica annual report or GSMA case study._
**Source:** Telefónica public blog and annual reports (https://www.telefonica.com); GSMA Intelligence

### 5.4 SK Telecom — "A." (A Dot) AI Personal Agent (South Korea)
**Program:** A. (A Dot) — LLM-powered personal AI agent for consumers
**What they built:** SK Telecom launched A. as a conversational personal AI agent integrated with its subscriber platform, leveraging partnership with Anthropic and its own telco-domain LLM (SKT-LLM). The agent handles scheduling, call summarisation, and proactive personalised recommendations, positioning SKT as an "AI telco" rather than a connectivity provider.
**Reported outcome:** SKT publicly reported subscriber adoption metrics for A. in its 2024 earnings disclosures. _Specific adoption percentage or ARPU impact — outcome figure unverified — verify against SKT investor relations._
**Source:** SK Telecom Investor Relations; public product announcements (https://www.sktelecom.com)

### 5.5 Orange — Live Intelligence & Network AI (France/Africa)
**Program:** Orange Live Intelligence (network AI) and AI-driven customer experience platform
**What they built:** Orange has deployed machine-learning models for predictive network maintenance, QoE (Quality of Experience) optimisation, and AI-driven customer value management across its European and African operations. Orange's AI and Data division has been presented at TM Forum and GSMA events as a case study in at-scale network AI deployment.
**Reported outcome:** Orange has cited reductions in customer-impacting network incidents through predictive maintenance. _Specific incident reduction percentage — outcome figure unverified — verify against Orange annual report or TM Forum case study._
**Source:** Orange Group annual reports and press releases (https://www.orange.com); TM Forum Inform

---

## 6. Key Metrics & Benchmarks

| Metric | Value | Source |
|---|---|---|
| Global telco AI market size (2024) | ~$2.5 billion, projected to grow at ~30% CAGR to 2030 | _unsourced — verify or replace; check IDC or Omdia market sizing_ |
| Estimated global telecom fraud losses (2023) | $38.95 billion | CFCA *Global Fraud Loss Survey 2023* [^5] |
| Global mobile capex commitment through 2030 | ~$700 billion | GSMA Intelligence, *The Mobile Economy 2025* [^2] |
| Share of operators at Autonomous Network Level 2+ (2024) | Majority of Tier 1 operators | TM Forum *AI & Autonomous Networks* (2024) [^1] |
| Operators relying on hyperscaler co-development for AI by 2026 | >60% (predicted) | IDC *FutureScape: Worldwide Telecommunications 2025* [^6] |
| Operators citing data quality as top AI barrier | >55% | Omdia *AI in Telecoms* (2024) [^3] (_verify exact figure_) |
| Potential network opex reduction from Level 4 autonomy | 20–30% | TM Forum Autonomous Networks programme [^1] (_verify exact range_) |
| Average telco AI investment as % of total IT budget (2025) | _unsourced — verify or replace; check Gartner CIO survey or IDC_ | — |
| Number of 5G private network deployments globally (2024) | >1,000 enterprise deployments | _unsourced — verify or replace; check GSMA or Omdia private 5G tracker_ |
| GenAI adoption rate among telco CIOs (2024–2025) | _unsourced — verify or replace; check Deloitte State of GenAI in Enterprise 2024_ | — |

---

## 7. Implications for Maven's Positioning

- **Agentic orchestration is the battleground, not point AI tools.** The TM Forum and STL Partners evidence shows that operators have already deployed first-generation AI (chatbots, predictive models) and are now struggling to orchestrate these into coherent, governed agentic workflows across OSS/BSS, care, and network domains. Maven's agentic transformation proposition — connecting multiple AI agents under a unified governance and orchestration layer — is precisely the capability gap that operator CDOs and CTOs are trying to fill in 2025–2026.

- **Governance and model risk are non-negotiable differentiators.** Given the critical-infrastructure designation of telecom networks and the EU AI Act's phased enforcement timeline, operators cannot deploy autonomous agents without rigorous model risk management, audit trails, and explainability. Maven should position its governance framework explicitly against the TM Forum Autonomous Networks Level 3–4 requirements and EU AI Act high-risk system obligations — this is a procurement-level differentiator versus hyperscaler-native tooling.

- **Enterprise AI productisation creates a second beachhead.** Beyond operators as buyers of AI transformation services, telcos are becoming sellers of AI-enabled managed services to enterprise customers. Maven can position as the enabler of this "AI-as-a-service over network" model — helping operators package, govern, and monetise AI capabilities through their B2B channels, not just optimise internal operations.

- **Data platform readiness is the pre-sale conversation.** The data-quality and OSS/BSS integration barriers documented above mean that many operators are not yet ready to deploy production-grade agentic systems. Maven should lead discovery engagements with a data-maturity assessment, building pipeline and trust before the core agentic deployment engagement — positioning this as a rapid value sprint rather than a multi-year infrastructure overhaul.

- **Reference architecture from financial services AI governance accelerates telco credibility.** The pattern of adapting banking-grade model risk management (champion-challenger, drift monitoring, model inventory) to telecom AI agents is an underexploited narrative. If Maven has relevant financial-services AI governance credentials, this cross-industry transfer story is both differentiated and directly relevant to telco CROs and regulators.

---

## Sources

[^1]: TM Forum, *AI & Autonomous Networks Programme Reports*, TM Forum, 2024, https://www.tmforum.org

[^2]: GSMA Intelligence, *The Mobile Economy 2025*, GSMA, 2025, https://www.gsma.com

[^3]: Omdia, *AI in Telecoms — Market Tracker and Survey*, Omdia/Informa, 2024, https://omdia.tech.informa.com

[^4]: STL Partners, *Telco AI Strategy Research*, STL Partners, 2024, https://stlpartners.com

[^5]: Communications Fraud Control Association (CFCA), *Global Fraud Loss Survey 2023*, CFCA, 2023, https://www.cfca.org

[^6]: IDC, *FutureScape: Worldwide Telecommunications 2025 Predictions*, IDC, 2024, https://www.idc.com

[^7]: European Commission, *Regulation (EU) 2024/1689 — Artificial Intelligence Act*, Official Journal of the European Union, 2024, https://eur-lex.europa.eu

[^8]: International Energy Agency (IEA), *Electricity 2024: Analysis and Forecast to 2026*, IEA, 2024, https://www.iea.org

[^9]: World Economic Forum, *Future of Jobs Report 2025*, WEF, 2025, https://www.weforum.org

[^10]: Nokia Bell Labs, *Bell Labs Technical Journal / Research Publications on AI-Driven Network Engineering*, Nokia Bell Labs, ongoing, https://www.bell-labs.com