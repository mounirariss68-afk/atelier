# Telecom — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._
_Time horizon: short-term = 2026–2027 · medium-term = 2027–2028 · long-term = 2029–2030._

---

## 1. State of play in mid-2026

As of May 2026, the global telecoms industry has moved decisively past the GenAI pilot phase and into production-grade agentic AI deployment, though adoption depth varies sharply by operator tier and geography. The inflection point arrived in late 2025, when a cohort of Tier-1 operators — including Vodafone, AT&T, SK Telecom, and Orange — transitioned AI from isolated use-cases (churn prediction, chatbots) into orchestrated, multi-agent systems touching network operations, customer care, and revenue assurance simultaneously. The TM Forum's Autonomous Networks framework, which defines maturity levels from L0 (manual) to L5 (fully autonomous), placed the industry median at L2–L3 in 2024; by mid-2026 leading operators have credibly demonstrated L3 closed-loop automation in selective RAN domains and are piloting L4 intent-based networking in controlled environments [^1]. Hyperscaler-telco partnerships — notably Microsoft Azure with AT&T, Google Cloud with Vodafone, and NVIDIA's AI-RAN Alliance encompassing Samsung, Ericsson, and Nokia — have become the dominant infrastructure paradigm, providing the GPU compute and LLM orchestration layer that most operators cannot economically build internally [^2]. Customer-facing generative AI, which consumed the majority of 2024–2025 executive attention, is now table-stakes for customer care deflection; competitive differentiation in 2026 sits at the network layer, in B2B/IoT monetisation, and in the energy-efficiency gains unlocked by AI-driven RAN optimisation. The residual frontier — 6G standards definition, fully autonomous L5 network operation, and AI-native core networks — remains genuinely emergent and is the subject of active R&D investment from Bell Labs (Nokia), Ericsson Research, and national 6G programmes in South Korea, the EU, and Japan [^3].

---

## 2. Trends shaping 2026–2028

- **AI-RAN becomes a capital allocation priority, not a research project.** The NVIDIA AI-RAN Alliance, formalised in 2024 and expanded through 2025, crossed from proof-of-concept into commercial vendor offerings in early 2026. Softwarised, GPU-accelerated RAN processing enables real-time inference at the baseband layer — optimising beam management, interference coordination, and energy sleep modes simultaneously. The mechanism is straightforward: moving from ASIC-fixed RAN to programmable AI-RAN collapses the traditional separation between network control and AI inference, allowing continuous closed-loop learning. Operators pursuing this path are projecting 20–30% RAN energy savings alongside capacity gains, addressing both the energy cost crisis and capex intensity pressures [^4]. _Outlook: By 2027–2028, AI-RAN will feature in the majority of Tier-1 greenfield 5G-Advanced densification projects._

- **Autonomous network operations advance from L3 to L4 at domain level.** TM Forum's Autonomous Networks initiative reported in 2025 that over 40 member operators had active L3 (conditional autonomy, human on the loop) deployments in at least one domain [^1]. The 2026–2027 vector is cross-domain L4 — where intent-based policies set by humans are executed and adapted entirely by AI agents without per-event approval. The enabling mechanism is multi-agent orchestration: specialised agents for RAN, transport, core, and service assurance negotiate resource allocation via shared context and API contracts. This reduces mean-time-to-restore for major incidents and enables dynamic SLA assurance for enterprise 5G slices — a critical B2B revenue unlock.

- **Generative AI in customer operations shifts from deflection to revenue generation.** Through 2024–2025, telco GenAI in care primarily targeted call deflection and handle-time reduction. By mid-2026, leading operators have re-instrumented their conversational AI stacks (Vodafone's EvaBot successor, AT&T's Ask AT&T, Telefónica Aura) as revenue agents — proactively identifying upsell moments, personalising bundle offers, and executing plan migrations without human intervention [^5]. The mechanism: LLM-powered agents with access to real-time customer data platforms (CDPs), billing APIs, and inventory systems can close a transaction end-to-end, not merely route it. Accenture's Technology Vision 2025 identified "agent as the new interface" as the defining enterprise pattern, and telco care is its clearest large-scale manifestation [^6].

- **B2B and IoT monetisation becomes the primary GenAI revenue thesis.** Consumer ARPU pressure has persisted; the 2026 growth thesis for Tier-1 operators is private 5G networks, IoT platform services, and AI-enhanced managed connectivity for enterprise clients. AI agents that monitor SLA compliance, predict device failure in IoT fleets, and auto-provision network slices reduce the human professional-services cost of B2B delivery — improving margin on what has historically been a labour-intensive segment. STL Partners' 2025 research on telco platform strategies documented the shift from connectivity-as-product to connectivity-as-platform, with AI as the operational glue [^7].

- **Energy cost and sustainability pressure reshapes AI investment calculus.** AI inference at scale consumes significant power — a double bind for operators who are simultaneously deploying AI and running increasingly energy-hungry 5G networks. The IEA flagged in its 2024 Electricity report that data centre and network energy demand was rising faster than renewable supply in most OECD markets [^8]. In response, leading operators are co-designing AI deployment architectures around energy budgets: using smaller, distilled models at the edge (on-device or base-station inference), reserving large-model inference for back-office batch workloads, and integrating AI-RAN sleep-cycle optimisation to offset the energy cost of AI itself. This energy-aware AI architecture is an emerging best-practice pattern in 2026.

- **Vendor concentration and hyperscaler dependency become board-level risk items.** As telcos accelerate AI adoption via hyperscaler platforms (Azure OpenAI, Google Vertex, AWS Bedrock), concerns about data sovereignty, negotiating leverage, and single-vendor lock-in have intensified. The EU AI Act (entered into application in August 2025) places obligations on operators deploying high-risk AI in critical infrastructure, requiring transparency, human oversight, and documentation that is difficult to achieve when core models are opaque hyperscaler APIs [^9]. Operators in the Middle East and Asia-Pacific are additionally facing government mandates to host AI workloads on sovereign cloud infrastructure — pushing some, including stc (Saudi Telecom), toward hybrid architectures with national cloud partnerships [^10].

- **Fraud and revenue assurance AI matures into a fully agentic domain.** Telecoms fraud — particularly SIM swap, Wangiri, and interconnect bypass fraud — cost the industry an estimated USD 38.95 billion in 2023 according to the GSMA's Communications Fraud Control Association baseline [^11]. By 2026, leading operators have deployed multi-agent fraud systems that combine real-time signalling analytics, graph neural networks for identity clustering, and automated response agents that can suspend accounts, reroute traffic, and trigger regulatory reporting without human approval. The speed advantage is the mechanism: fraud events unfold in seconds; rule-based systems operating on batch cycles could not match the temporal window.

---

## 3. Top challenges

- **Regulatory compliance under the EU AI Act and emerging equivalents.** The EU AI Act's full application since August 2025 classifies certain network-security and customer-scoring AI as high-risk, requiring conformity assessments, logging, and human oversight mechanisms [^9]. Telcos operating across jurisdictions face a patchwork: the UK's FCA has separate AI governance expectations for financial products bundled with telecoms (handset credit, insurance); the ITU's AI standards work (Focus Group on AI for 5G) creates additional technical compliance layers [^12]. Compliance overhead is non-trivial and slows the agent deployment velocity that operators need for ROI.

- **Data fragmentation across OSS/BSS and legacy stacks.** Most Tier-1 operators carry 20–30 years of accumulated OSS/BSS debt — siloed data stores, proprietary network element interfaces, and CRM systems with poor real-time API surfaces. Agentic AI systems require clean, low-latency access to network telemetry, customer records, and billing data simultaneously. Without a unified data fabric or network data platform, agents cannot act on coherent context, and hallucination risk rises. This is the single most commonly cited internal barrier in Deloitte's State of GenAI in the Enterprise surveys [^13].

- **Talent scarcity at the ML-telecom intersection.** Building and operating AI-RAN, autonomous network agents, and LLM-based care platforms requires engineers who understand both deep learning (particularly reinforcement learning for closed-loop control) and telecoms domain specifics (RAN protocols, 3GPP standards, network slicing). This hybrid profile is scarce globally. McKinsey's State of AI 2025 edition noted that AI talent acquisition costs rose 40% year-on-year in 2024 [^14], and telcos — traditionally lower-compensation employers than hyperscalers — face structural disadvantage.

- **Agent governance and the "autonomous action" trust deficit.** As agents move from advisory to autonomous action (modifying network configurations, closing customer transactions, suppressing fraud events), operator risk functions and regulators demand audit trails, rollback capabilities, and explainability. The multi-agent orchestration pattern — where agent A instructs agent B which calls agent C — creates chains of causality that are difficult to log coherently. TM Forum's work on the Autonomous Networks governance framework is the most structured industry response, but implementation lags capability [^1].

- **Compute and energy cost of agentic inference at scale.** Running hundreds of concurrent tool-calling LLM agents across a large operator's operations — network, care, fraud, provisioning — generates GPU and energy costs that are only partially offset by the labour and incident costs saved. CFOs reviewing 2025 AI budgets found that inference costs had been systematically underestimated in business cases that focused on training. _Outcome figures for operator-level AI inference cost as a proportion of IT opex: unsourced — verify or replace._

- **Agent-to-agent trust and API security.** Multi-agent architectures introduce new attack surfaces: a compromised or manipulated subordinate agent can propagate malicious instructions through the orchestration stack. Telcos, as critical national infrastructure, face elevated threat actor attention. Industry standards for agent identity, message signing, and permission scoping (analogous to OAuth for human users) are nascent as of mid-2026.

- **Vendor and hyperscaler concentration risk.** Three hyperscalers supply the dominant share of LLM APIs, vector databases, and GPU compute consumed by telco AI programs. Pricing power, terms changes, and outage risk are board-level concerns, particularly for operators in markets where regulators view telecoms as sovereign infrastructure.

- **Change management and workforce transition.** Network engineers, care agents, and fraud analysts whose workflows are being partially or fully automated require retraining, role redesign, and in some cases redundancy management. Union negotiations (particularly in European markets) have slowed agent rollout timelines. Deloitte's 2025 survey waves identified change management as the top reason GenAI programs delivered below projected business value [^13].

---

## 4. Top strategic priorities (2026–2027 budget cycle)

- **Unified network data platform as the AI foundation layer.** Before advanced agents can function, operators are investing in real-time data fabrics that unify OSS telemetry, customer records, and external signals. Gartner's 2025 Hype Cycle for AI highlighted that "AI-ready data architecture" had reached the Plateau of Productivity for large enterprises — meaning investment is now about execution, not experimentation [^15]. Budget allocation for data engineering and platform modernisation is outpacing model spend at several Tier-1 operators. _Specific operator budget splits: unsourced — verify or replace._

- **Agentic network operations for RAN and core.** Operators are funding multi-agent NOC (Network Operations Centre) transformation programs, pairing AI agent orchestration platforms (from vendors including Ericsson, Nokia, and Amdocs) with upskilled network engineers acting as intent authors rather than incident responders. The target operating model is L3–L4 autonomy in 2026–2027, with L5 aspirations framed for 2029–2030.

- **Generative AI-powered customer care at scale, with revenue-agent capability.** Following positive ROI signals from 2024–2025 pilots, care AI budgets are being scaled. The 2026–2027 priority is closing the gap between deflection (cost avoidance) and transaction completion (revenue generation) — requiring tighter integration between conversational AI, CDPs, and billing systems [^6].

- **Private 5G and AI-managed network slicing for enterprise.** B2B AI-managed connectivity is the highest-margin growth vector. Operators are building AI orchestration layers for enterprise 5G slices — automated provisioning, SLA monitoring agents, and self-healing capabilities — to reduce the professional services cost of enterprise delivery and compete with hyperscaler-native SD-WAN and SASE offerings.

- **AI-driven energy optimisation across RAN and data centres.** Sustainability commitments and rising energy costs (electricity representing 20–25% of operator opex in many markets, _unsourced — verify or replace_) are driving dedicated AI programs for energy: sleep-mode scheduling, dynamic capacity reallocation, and cooling optimisation in data centres. This is positioned both as cost reduction and ESG reporting material.

- **Sovereign and hybrid AI architecture for regulatory compliance.** Operators in the EU, Gulf states, and Southeast Asia are restructuring AI deployment to satisfy data residency and AI Act obligations — building on-premises or national-cloud inference endpoints, fine-tuning open-weight models (Mistral, LLaMA derivatives) for telco-specific tasks rather than relying solely on hyperscaler APIs, and establishing model registries for audit purposes.

---

## 5. Best-practice patterns for AI/agentic adoption

**1. Intent-based policy governance for autonomous networks.**
Rather than programming specific automation rules, leading operators author high-level "intents" (e.g., "maintain enterprise slice latency below 10ms during business hours") and allow AI agents to select and execute the appropriate network actions. This pattern, formalised in TM Forum's Intent NBI (Northbound Interface) specifications, separates human strategic intent from machine tactical execution — enabling L3–L4 autonomy without requiring humans to anticipate every operational scenario [^1].

**2. Closed-loop RAN optimisation with reinforcement learning.**
Operators including SK Telecom and Ericsson have deployed RL-based agents that continuously tune antenna tilt, transmission power, and handover thresholds based on live KPI feedback — without human per-action approval. The telco-specific driver is that RAN parameter spaces are too large and too dynamic for manual tuning at 5G-Advanced densities; RL is the only approach that scales. The closed-loop must include guardrails (KPI degradation tripwires that revert to a safe state) to satisfy network reliability obligations [^4].

**3. Customer data platform integration as the prerequisite for care AI.**
Operators who achieved the strongest care-AI outcomes in 2024–2025 had invested in CDPs that provided a unified, real-time customer view before deploying LLM agents. Without this, conversational agents hallucinate customer context or provide stale offer information. The pattern: CDP as the "ground truth" context injected into every agent prompt, with billing and inventory APIs as tool-call targets — not static knowledge bases.

**4. Telco-domain fine-tuning of foundation models.**
General-purpose LLMs underperform on telco-specific tasks (3GPP standard interpretation, network alarm taxonomy, tariff logic) without domain adaptation. Best-practice operators in 2026 maintain a library of fine-tuned or retrieval-augmented models trained on proprietary network logs, call transcripts, and technical documentation — reducing hallucination on domain tasks and improving agent reliability. SK Telecom's A.X platform and Telefónica's internal LLM program both followed this pattern [^5].

**5. AI energy budget as a first-class architecture constraint.**
Energy-aware AI design — selecting model size, inference location (edge vs. core vs. cloud), and batching strategy based on energy cost per inference — is an emerging telco-specific pattern driven by operator sustainability commitments and the double pressure of running AI on top of already energy-intensive 5G. Base-station-level inference for latency-sensitive tasks (beam management) and cloud-batch inference for back-office tasks (churn scoring) represent the emerging bifurcation.

**6. Fraud agent with automated response authority within bounded parameters.**
Telco fraud systems in 2026 operate most effectively when agents have pre-authorised response authority for specific, bounded actions (SIM suspension below a revenue threshold, traffic rerouting for bypass fraud) without requiring human approval for each event. The telco-specific driver is sub-second fraud event windows. Human oversight is preserved via mandatory review queues for actions above the authority threshold and complete audit logs — satisfying both operational speed and regulatory accountability [^11].

**7. Hyperscaler partnership with sovereign escape valve.**
Best-practice operators structure hyperscaler AI partnerships with explicit data portability, model exportability, and the capability to run open-weight model alternatives on alternative infrastructure. This is not anti-hyperscaler sentiment but regulatory necessity in an increasing number of markets, and commercial leverage in contract negotiations [^9].

---

## 6. Public case studies (named, verifiable)

### AT&T — USA — "Ask AT&T"
**What they built:** AT&T deployed Ask AT&T, an internal-facing generative AI assistant built on Microsoft Azure OpenAI Service, initially targeting software development (code generation, test automation) and network operations support. The system was expanded through 2025 into a multi-agent configuration where network engineers can query natural-language interfaces to retrieve fault diagnostics, suggest remediation actions, and generate change-request documentation — integrating with AT&T's OSS and ticketing systems via API tool-calls. The partnership with Microsoft also includes Azure-hosted AI workloads supporting AT&T's FirstNet public-safety network operations. [^16]
**Reported outcome:** AT&T reported developer productivity improvements and accelerated incident documentation. _Specific MTTR or productivity percentage figures: outcome figure unverified._
**Source:** AT&T press releases and Microsoft partnership announcements, 2024–2025.

### Vodafone — Pan-European / Global — TOBi / EvaBot Evolution
**What they built:** Vodafone's customer-facing AI began as TOBi, a rule-based chatbot. Through 2024–2025 the platform was rebuilt on a generative AI foundation (EvaBot and successor architectures on Google Cloud Vertex AI), incorporating retrieval-augmented generation over Vodafone's product catalogue and customer data, and multi-turn conversational agents capable of executing plan changes, billing disputes, and technical troubleshooting end-to-end without human escalation for a defined transaction set. Vodafone's partnership with Microsoft also extended AI into its internal IT operations. [^17]
**Reported outcome:** Vodafone reported contact deflection rate improvements and customer satisfaction score maintenance. _Specific deflection percentage figures: outcome figure unverified._
**Source:** Vodafone Group Annual Reports 2024–2025; Google Cloud partnership announcements.

### SK Telecom — South Korea — A.X Platform / A. Dot
**What they built:** SK Telecom developed the A.X (AI Transformation) enterprise platform and the A. Dot personal AI agent, the latter built on a multimodal LLM fine-tuned with telco-domain data and integrated with the operator's network, IPTV, and subscription services. A. Dot functions as a personal AI agent that can manage subscriptions, provide network diagnostics, and surface personalised content recommendations — representing one of the earliest operator-native personal AI agent deployments at scale. Internally, SK Telecom also deployed RL-based RAN optimisation agents across its 5G network. [^18]
**Reported outcome:** SK Telecom cited significant user engagement with A. Dot post-launch in South Korea. _Specific MAU or revenue attribution figures: outcome figure unverified._
**Source:** SK Telecom investor presentations and press releases, 2024–2025; STL Partners telco AI case database.

### Orange — France / Pan-African — Live Intelligence Platform
**What they built:** Orange deployed its "Live Intelligence" data and AI platform, consolidating network telemetry across its European and African footprints into a unified data lakehouse (on hybrid cloud). On top of this, Orange built AI agents for predictive network maintenance (detecting fibre degradation and 4G/5G cell anomalies before customer-impacting failure), and a generative AI layer for its Orange Business enterprise division targeting B2B customer service automation and managed network SLA monitoring. The platform uses a combination of proprietary ML models and fine-tuned open-weight LLMs. [^19]
**Reported outcome:** Orange reported reductions in proactive maintenance dispatch costs and improvement in network anomaly detection lead time. _Specific cost or lead-time figures: outcome figure unverified._
**Source:** Orange Group strategic communications and Orange Business press releases, 2024–2025.

### Saudi Telecom (stc) — Saudi Arabia — Tali AI / AI Platform
**What they built:** stc launched Tali, an Arabic-language conversational AI agent for customer care, built on a foundation model fine-tuned for Gulf Arabic dialectal variation and integrated with stc's CRM and billing systems. Beyond customer care, stc has invested in an internal AI platform supporting network operations AI and has partnered with hyperscalers and NVIDIA to build sovereign AI infrastructure in Saudi Arabia aligned with Vision 2030 digital objectives. The Tali deployment represents one of the most prominent Arabic-native telco AI care agents in the MENA region. [^20]
**Reported outcome:** stc reported improved first-contact resolution rates for Tali-handled interactions. _Specific resolution rate figures: outcome figure unverified._
**Source:** stc Group corporate announcements and Saudi Vision 2030 digital programme documentation, 2024–2025.

---

## 7. Key metrics & benchmarks

| Metric | Value | Unit | Date | Source / Note |
|---|---|---|---|---|
| Global telecoms fraud losses | 38.95 | USD billion / year | 2023 | GSMA / CFCA Communications Fraud Loss Survey 2023 [^11] |
| TM Forum: operators at L3+ autonomous network maturity | >40 | Number of member operators | 2025 | TM Forum Autonomous Networks Progress Report 2025 [^1] |
| AI-RAN energy saving projection (NVIDIA AI-RAN Alliance claims) | 20–30 | % RAN energy reduction | 2025–2026 | NVIDIA AI-RAN Alliance technical documentation [^4] — _outcome figure unverified at industry scale_ |
| Telco AI market size (global) | ~9.5 | USD billion | 2024 | IDC / Omdia estimates — _unsourced at this precise figure — verify or replace_ |
| Average telco electricity as % of opex (European Tier-1 operators) | 20–25 | % of total opex | 2024 | _unsourced — verify or replace_ |
| McKinsey: AI talent acquisition cost increase YoY | ~40 | % year-on-year increase | 2024 | McKinsey "State of AI" 2025 edition [^14] |
| Operators with production GenAI in customer care | Majority of Tier-1 | Qualitative | Mid-2026 | TM Forum / GSMA Mobile Economy 2025 [^2] — _precise count unsourced_ |
| 5G standalone (SA) core deployments globally | 300+ | Number of operator networks | 2025 | GSMA Intelligence 2025 [^2] — _verify current count_ |

---

## 8. Implications for Maven's positioning

- **The network data platform gap is Maven's most immediate entry point** (from §3 — data fragmentation as the top agentic AI barrier, and §4 — unified data platform as the top 2026–2027 budget priority). Operators cannot advance to L3–L4 autonomous network operations or deploy revenue-generating care agents without a coherent, real-time data fabric. Maven's capability in data architecture and AI readiness assessment is directly applicable to the scoping and vendor-selection phase that most Tier-2 and Tier-3 operators are navigating now.

- **Agent governance and audit-trail frameworks are a billable advisory gap that hyperscalers and system integrators are not filling well** (from §3 — agent governance trust deficit, EU AI Act compliance obligations, and §5 — intent-based governance pattern). As operators accelerate multi-agent deployment, they face regulatory pressure (EU AI Act, ITU standards) without mature internal governance frameworks. Maven can offer structured agent governance design — covering authority boundaries, audit logging standards, and human-oversight operating models — as a distinct practice.

- **The sovereign AI architecture question is creating a consultancy opportunity in MENA, Southeast Asia, and the EU that is distinct from the hyperscaler-led engagements** (from §2 — vendor concentration and sovereignty trend, §4 — sovereign AI architecture as a 2026–2027 priority, and §6 — stc case). Operators in these markets are actively seeking advisors who are not commercially aligned with any single hyperscaler and can design genuinely hybrid or multi-cloud architectures. Maven's vendor-neutral positioning is a structural advantage here.

- **Telco-domain fine-tuning and AI evaluation capability is a medium-term differentiator as the industry moves from generic LLMs to operator-specific models** (from §5 — telco-domain fine-tuning pattern, and §2 — care AI shifting from deflection to revenue generation). As operators build model registries and fine-tuning pipelines for 3GPP documentation, alarm taxonomies, and Arabic/local-language care, they need evaluation frameworks that go beyond generic benchmarks. Maven can develop telco-specific AI evaluation playbooks as a productised offering.

- **The energy-aware AI architecture pattern is an underserved advisory topic that connects Maven to both the sustainability and CTO agendas simultaneously** (from §2 — energy cost trend, §3 — energy cost of agentic inference, and §5 — energy budget as architecture constraint). Few advisors are currently framing AI deployment design through the lens of energy cost per inference and RAN energy offset — yet this is a genuine CFO and sustainability committee concern. A Maven point-of-view on energy-efficient agentic architecture for telecoms would be differentiated positioning.

---

## Sources

[^1]: TM Forum, "Autonomous Networks: Empowering Digital Transformation" / Autonomous Networks Progress Reports, TM Forum (tmforum.org), 2024–2025.

[^2]: GSMA, "The Mobile Economy 2025", GSMA Intelligence (gsma.com), 2025.

[^3]: Nokia Bell Labs, "Future X Network Research" / 6G Vision documentation; Ericsson Research 6G programme publications, 2024–2025. See ericsson.com and nokia.com/bell-labs.

[^4]: NVIDIA, "AI-RAN Alliance" technical documentation and press releases, NVIDIA Corporation (nvidia.com), 2024–2026.

[^5]: STL Partners, "Telco AI strategies: building competitive advantage", STL Partners (stlpartners.com), 2025.

[^6]: Accenture, "Technology Vision 2025", Accenture (accenture.com), 2025.

[^7]: STL Partners, "Telco as a platform: monetising the network", STL Partners (stlpartners.com), 2025.

[^8]: IEA, "Electricity 2024: Analysis and Forecast to 2026", International Energy Agency (iea.org), 2024.

[^9]: European Parliament and Council, "Regulation (EU) 2024/1689 on Artificial Intelligence (EU AI Act)", Official Journal of the European Union, 2024. Full application August 2025.

[^10]: stc Group, Corporate announcements on AI platform and sovereign cloud partnerships, stc (stc.com.sa), 2024–2025.

[^11]: GSMA / CFCA, "Communications Fraud Loss Survey 2023", GSMA (gsma.com), 2023.

[^12]: ITU, "Focus Group on Artificial Intelligence for 5G" outputs and recommendations, International Telecommunication Union (itu.int), 2024.

[^13]: Deloitte, "State of Generative AI in the Enterprise" quarterly survey waves, Deloitte Insights (deloitte.com), 2024–2025.

[^14]: McKinsey & Company, "The State of AI 2025", McKinsey Global Institute (mckinsey.com), 2025.

[^15]: Gartner, "Hype Cycle for Artificial Intelligence 2025", Gartner (gartner.com), 2025.

[^16]: AT&T Inc. / Microsoft Corporation, "AT&T and Microsoft strategic partnership announcements" including Ask AT&T program, AT&T Newsroom (att.com) and Microsoft News (microsoft.com), 2024–2025.

[^17]: Vodafone Group, "Annual Report 2024–2025" and Google Cloud partnership press releases, Vodafone (vodafone.com) and Google Cloud (cloud.google.com), 2024–2025.

[^18]: SK Telecom, "A.X Platform and A. Dot AI Agent" investor and press communications, SK Telecom (skt.co.kr/en), 2024–2025.

[^19]: Orange Group, "Live Intelligence platform" and Orange Business AI communications, Orange (orange.com), 2024–2025.

[^20]: stc Group, "Tali AI customer service agent" corporate announcements, stc (stc.com.sa), 2024–2025.