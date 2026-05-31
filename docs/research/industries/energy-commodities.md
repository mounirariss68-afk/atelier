# Energy & Commodities — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Cognirise Research. Status: draft for Parts 2–4._
_Time horizon: short-term = 2026–2027 · medium-term = 2027–2028 · long-term = 2029–2030._

---

## 1. State of play in mid-2026

The energy and commodities sector entered 2026 having completed what most chief digital officers describe as its "pilot graduation": the 2023–2025 period of GenAI experimentation yielded enough measured returns in reservoir characterisation, predictive maintenance, and commodity trading analytics that boards approved large-scale agentic deployment budgets in the 2026 planning cycle. McKinsey's *The State of AI 2025* found energy and resources among the top three sectors by reported AI cost reduction, with upstream O&G and utilities leading in structured-data ML maturity, while trading desks and grid operators had begun deploying autonomous decision agents in sandboxed production environments by late 2025.[^1] The IEA's *World Energy Outlook 2025* elevated AI's role in energy system optimisation from an advisory footnote to a dedicated chapter, citing grid-balancing software and AI-optimised demand forecasting as critical enablers of the accelerating renewables build-out.[^2] What is now table-stakes in mid-2026 includes LLM-assisted well-log interpretation, drone-plus-vision inspection of infrastructure, ML-driven predictive maintenance for turbines and compressors, and AI-augmented commodity price forecasting. What remains genuinely emergent is fully autonomous multi-agent orchestration across the energy value chain—particularly grid-edge load orchestration that can negotiate in real time between distributed energy resources, flexible industrial demand, and wholesale markets—and the organisational rewiring required to trust agent outputs in safety-critical operational contexts. A new board-level concern that crystallised in 2025 and now dominates the 2026 agenda is the electricity demand surge from AI datacentres: hyperscaler load growth has tightened several regional grids, reshaping power purchase agreement (PPA) strategy and accelerating utility capital expenditure cycles.[^3]

---

## 2. Trends shaping 2026–2028

- **Agentic grid orchestration moves from pilot to production.** Grid operators and vertically integrated utilities are deploying multi-agent systems capable of dispatching flexible loads, storage assets, and virtual power plants in sub-second cycles, replacing rules-based SCADA logic. The mechanism is reinforcement-learning agents trained on historical dispatch data and weather forecasts, operating within ISO/RTO market APIs. National Grid ESO's Digital Spine programme and Enel's Gridspert platform are emblematic of this shift.[^4] By 2027–2028, regulatory frameworks in the EU (under the revised Electricity Market Design Directive) and in PJM/ERCOT are expected to formally recognise AI dispatch agents as qualified scheduling entities. _unsourced — verify or replace_

- **AI datacentre electricity demand reshapes PPA and generation investment strategy.** Hyperscalers—Microsoft, Google, Amazon, and Meta—collectively signed more nuclear and geothermal PPAs in 2025 than in the prior decade combined, responding to clean-firm power scarcity and 24/7 carbon-matching commitments.[^5] The mechanism is straightforward: AI inference workloads are always-on, carbon-sensitive, and require locational certainty, making variable renewables alone insufficient. Wood Mackenzie estimated that by end-2025 over 40 GW of new datacentre load had been contracted in the US alone, with a further pipeline extending to 2028.[^6] For energy majors and utilities this is the most significant new revenue signal in a decade, driving investment in small modular reactors (SMRs), enhanced geothermal systems, and long-duration storage.

- **Autonomous haul and mine operations become the benchmark, not the exception, in tier-1 mining.** Rio Tinto's autonomous haulage system (AHS), Caterpillar Command for Hauling, and Komatsu FrontRunner had collectively accumulated hundreds of millions of autonomous kilometres by end-2025.[^7] The 2026–2028 trend is the extension of autonomy from haulage to integrated mine orchestration: blasting pattern optimisation, ore-grade prediction via hyperspectral drone imaging, and autonomous drill-and-blast sequencing using multi-agent planning systems. The mechanism is the convergence of cheap LiDAR, private 5G on mine sites, and foundation model fine-tuning on domain-specific operational data.

- **Commodity trading firms deploy LLM-plus-agent stacks for signal synthesis and execution.** Physical commodity trading—historically reliant on relationship networks and proprietary weather/logistics data—has adopted LLM-based research synthesis agents capable of ingesting satellite imagery, ship-tracking AIS data, refinery maintenance filings, and macroeconomic signals simultaneously. The mechanism is retrieval-augmented generation (RAG) over structured commodity data lakes, feeding agent decision layers that recommend or auto-execute hedging positions within pre-approved risk parameters. S&P Global Commodity Insights reported in 2025 that over 60% of tier-1 commodity trading houses had production RAG deployments for market intelligence.[^8] _outcome figure unverified_

- **Digital twins of subsurface and surface assets become standard upstream infrastructure.** Shell, BP, and Saudi Aramco have each publicly committed to enterprise-scale digital twin programmes that use physics-informed neural networks (PINNs) alongside real-time sensor fusion to simulate reservoir behaviour and surface facility performance. The mechanism is that PINNs allow subsurface simulation at a fraction of the compute cost of traditional reservoir simulators while remaining physically consistent, enabling continuous scenario optimisation rather than periodic engineering studies. By 2027–2028 the competitive differentiator will be the quality and provenance of proprietary training data, not access to the models themselves.[^9]

- **AI-accelerated materials and process discovery in the energy transition.** DeepMind's AlphaFold lineage is being extended to battery electrolyte chemistry and catalyst discovery for green hydrogen. Commonwealth Fusion Systems and TAE Technologies are applying ML-based plasma control—building on DeepMind's 2022 tokamak work—to their respective fusion programmes, with CFS's SPARC device targeting first plasma in the 2027–2028 window.[^10] _outcome figure unverified_ The medium-term implication is that AI compresses the materials R&D cycle from years to months for certain classes of problems, potentially accelerating the cost curve for next-generation storage and hydrogen technologies.

- **Wildfire and climate-physical risk AI becomes a regulated underwriting and operational requirement.** Extreme weather events in 2024–2025—particularly North American and Southern European wildfires and storm surges affecting energy infrastructure—catalysed adoption of AI-based climate-physical risk modelling by utilities, transmission owners, and energy insurers. The mechanism is satellite-plus-IoT sensor fusion feeding probabilistic ML models that score asset-level exposure in near real time, enabling dynamic grid reconfiguration and vegetation management prioritisation. Regulatory pressure from the US Federal Energy Regulatory Commission (FERC) and EU ENTSO-E network codes is making such systems a compliance expectation by 2027. _unsourced — verify or replace_

---

## 3. Top challenges

- **Regulatory fragmentation across energy systems and AI governance frameworks.** The EU AI Act (effective August 2024, published in the *Official Journal of the EU*, 2024) classifies AI systems controlling critical energy infrastructure as high-risk, mandating conformity assessments, human oversight, and audit trails.[^11] US federal agencies (FERC, NERC CIP standards) are still developing equivalent guidance as of mid-2026, creating cross-jurisdictional compliance asymmetry for multinationals. The challenge is not merely legal: conformity assessment timelines may exceed deployment cycles for fast-moving agentic systems.

- **Data quality, silos, and OT/IT integration.** Operational technology (OT) systems in power plants, pipelines, and refineries were designed for reliability, not data interoperability. Historian data (OSIsoft PI, Honeywell PHD) is fragmented, inconsistently timestamped, and rarely contextualised with process metadata. This makes training high-quality predictive maintenance and process optimisation models structurally difficult and expensive—the root cause of why many 2024–2025 pilots stalled at the data engineering layer rather than the modelling layer.

- **Agent-to-agent trust and liability in multi-operator grids.** When a utility's AI dispatch agent interacts with a third-party aggregator's virtual power plant agent and an ISO's market-clearing algorithm, failure attribution is legally ambiguous. No established liability framework exists for multi-agent energy market interactions. The FSB's 2025 report on AI in financial markets touched on analogous issues in commodity derivatives, noting that autonomous agent interactions could amplify price volatility.[^12] _unsourced — verify or replace_

- **Cybersecurity and adversarial risk in agentic OT environments.** Agents with write-access to SCADA or DCS systems present an attack surface that traditional perimeter-security models cannot contain. The 2024 CISA advisories on ICS/SCADA vulnerabilities highlighted the gap between IT-grade AI security practices and OT-grade reliability requirements.[^13] _unsourced — verify or replace_

- **Compute and energy cost of agentic inference at scale.** The paradox of agentic AI in energy is acute: running large-scale inference workloads for grid optimisation, subsurface simulation, and trading analytics consumes significant electricity. For energy companies operating in competitive or regulated markets, the internal carbon and cost accounting of AI workloads is becoming a material consideration that most CFOs had not modelled as of 2025.

- **Talent scarcity at the intersection of domain expertise and AI engineering.** Reservoir engineers who can validate physics-informed neural network outputs, or grid operators who can audit reinforcement-learning dispatch policies, remain extremely scarce. The IEA's *Energy Technology Perspectives 2024* flagged clean energy skills shortages broadly; the AI-domain intersection is a narrower and more acute version of the same structural problem.[^14]

- **Vendor concentration and sovereign AI risk.** A small number of hyperscale cloud providers (Microsoft Azure, AWS, Google Cloud) and foundation model vendors supply the majority of AI infrastructure used by energy companies. For state-owned enterprises in the Middle East, Southeast Asia, and Europe, dependence on US-headquartered AI vendors raises technology sovereignty concerns that are increasingly salient given geopolitical fragmentation post-2024.

- **Model risk and hallucination in high-stakes operational decisions.** LLM outputs used in regulatory filings, reserve estimations, or safety case documentation carry material model risk if not rigorously validated. Downstream errors—e.g., an LLM-drafted well permit citing incorrect geological data—have legal and safety consequences that far exceed equivalent errors in financial services.

---

## 4. Top strategic priorities (2026–2027 budget cycle)

- **Enterprise AI platform consolidation and OT data fabric investment.** Following the fragmented pilot era of 2023–2025, most supermajors and large utilities are prioritising platform rationalisation—selecting 1–2 cloud-AI hyperscaler relationships and investing in unified data layers (industrial data fabrics, cloud historian migration) that can feed both ML models and agentic systems. BP's multi-year Palantir AIP partnership and Shell's Azure-anchored data platform are reference architectures for this pattern.[^15]

- **Agentic deployment in trading and commercial optimisation.** Trading desks represent the highest near-term ROI for agentic AI because decision cycles are fast, data is structured, and outcomes are financially measurable. Budget allocation is concentrating on RAG-based market intelligence agents, risk parameter monitoring agents, and—where regulation permits—auto-execution within pre-approved limits.

- **Predictive and prescriptive maintenance at enterprise scale.** Moving from site-level ML pilots to enterprise-wide predictive maintenance platforms covering thousands of rotating assets is the single most commonly cited 2026 capex priority among asset-heavy energy operators. The business case is straightforward: unplanned downtime in refining, LNG, or offshore production is extremely costly, and the data-infrastructure investments of 2023–2025 now make enterprise-scale deployment tractable.

- **Grid modernisation and AI-native energy management systems.** Regulated utilities are embedding AI budget within their CAPEX rate cases—a structural shift that embeds AI investment into the regulated asset base. Priority use cases include AI-driven demand forecasting, distribution fault detection, and autonomous Volt/VAR optimisation. Accenture's *Technology Vision 2025* identified AI-native grid management as the defining utility technology investment of 2025–2027.[^16]

- **AI for decarbonisation programme management.** Scope 1 and 2 emissions monitoring, carbon credit verification, and net-zero portfolio optimisation are attracting AI investment driven by CSRD (EU Corporate Sustainability Reporting Directive) compliance requirements and voluntary carbon market integrity demands. The mechanism is that manual data aggregation across disparate operational systems is untenable at the asset counts typical of majors.

- **Sovereign and private AI model deployment for sensitive operational data.** State-owned enterprises (Saudi Aramco AI Center, ADNOC's AI71 initiative) and European utilities are investing in on-premises or sovereign-cloud AI deployments to avoid transmitting subsurface, grid topology, or pricing data to US hyperscaler infrastructure. This is a significant procurement and architectural priority for 2026–2027 budgets.

---

## 5. Best-practice patterns for AI/agentic adoption

1. **"Brownfield-first" OT data liberation before model deployment.** Energy operators that achieved production ML systems fastest in 2024–2025 consistently invested in OT-to-cloud data pipelines (OSIsoft PI → Azure Data Lake or AWS IoT SiteWise) before attempting model training. The pattern: establish a unified process historian in the cloud, contextualise with asset hierarchy metadata, then train predictive models on clean, labelled time-series. Attempting to shortcut this step is the primary cause of pilot failure in asset-heavy energy operations.[^17]

2. **Physics-informed model validation as a governance gate.** For subsurface and grid applications, best-practice operators require that any AI model output be benchmarkable against a physics-based reference simulation before deployment. This addresses model risk (§3) by ensuring ML predictions do not violate conservation laws or engineering constraints, providing a defensible audit trail for regulatory scrutiny under the EU AI Act high-risk classification.

3. **Graduated agent autonomy with SCADA-integrated kill switches.** Leading utilities and O&G operators deploying agentic systems in operational contexts use a three-tier autonomy model: recommend-only → supervised auto-execute within narrow parameter bounds → full autonomy within pre-certified operational envelopes. Human override is wired directly into SCADA/DCS at each tier, and agents automatically revert to lower autonomy levels if anomaly detectors trigger. This directly addresses the agent-to-agent trust and OT cybersecurity challenges identified in §3.

4. **Commodity-specific RAG architectures with structured data prioritisation.** Unlike general-purpose enterprise RAG, commodity trading RAG systems achieve higher precision by prioritising structured data sources (price curves, inventory reports, AIS vessel positions) over unstructured text, using LLMs primarily for synthesis and explanation rather than primary data retrieval. This reduces hallucination risk in high-stakes trading contexts and aligns with model risk management frameworks adapted from financial services.

5. **Co-located AI and energy infrastructure for datacentre load monetisation.** Forward-leaning utilities and IPPs are developing AI-load-flexible PPA structures that allow datacentre customers to modulate consumption in response to real-time grid signals, earning demand-response revenues while improving grid stability. This converts the AI datacentre demand challenge (§2, §3) into a grid-services revenue stream, and represents a new commercial pattern that did not exist before 2025.

6. **Domain-expert-in-the-loop MLOps for safety-critical model refresh.** In upstream operations and transmission, models trained on historical operational data decay as reservoir conditions change or grid topology evolves. Best-practice operators have established domain-expert review gates in their MLOps pipelines—reservoir engineers or protection engineers sign off on retrained model behaviour before promotion to production—preventing silent model degradation in safety-critical contexts.

7. **Sovereign AI procurement with federated fine-tuning.** For NOCs and European regulated utilities, best practice is emerging around procuring open-weight foundation models (e.g., Mistral, LLaMA lineage) that can be fine-tuned on proprietary operational data within sovereign or private cloud infrastructure, with federated learning architectures that avoid centralising raw subsurface or grid data. ADNOC's AI71 initiative represents the most publicly visible execution of this pattern.[^18]

---

## 6. Public case studies

### BP × Palantir — Global upstream and trading AI platform
**Geography:** Global (HQ: London). **Programme:** AIP (Palantir Artificial Intelligence Platform) enterprise deployment, announced and expanded 2023–2025. **What they built:** BP integrated Palantir AIP across upstream well planning, production optimisation, and trading risk management. The architecture connects real-time production historian data with Palantir's ontology layer, enabling LLM-assisted anomaly detection agents to surface production deferral risks and recommend intervention workflows to engineers. On the trading side, AIP ingests commodity price, logistics, and counterparty data to support position risk monitoring. _Architecture details for trading module unverified._ **Reported outcome:** BP cited reduced unplanned downtime and improved capital allocation efficiency in investor communications 2024–2025; specific percentage figures _outcome figure unverified_. **Source:** BP investor presentations 2024; Palantir press releases 2024.[^19]

### Rio Tinto — Autonomous Mine of the Future (AHS + OC&A)
**Geography:** Pilbara, Australia. **Programme:** Autonomous Haulage System (AHS) and Operations Centre & Analytics (OC&A). **What they built:** Rio Tinto operates the world's largest autonomous mining fleet—over 130 autonomous Komatsu 930E trucks in the Pilbara as of 2025—coordinated by a mine operations centre in Perth. The system uses Komatsu FrontRunner with onboard LiDAR and radar for vehicle autonomy, integrated with a mine-wide fleet management ML layer that optimises truck dispatch, crusher throughput, and ore-blending in near real time. In 2024–2025 Rio Tinto extended AI to drill pattern optimisation using hyperspectral ore-grade prediction, feeding autonomous drill rigs. **Reported outcome:** Rio Tinto's 2024 Annual Report cited autonomous trucks running approximately 15% more productively than manned equivalents on a tonne-kilometres-per-hour basis. _Outcome figure unverified — cross-check against 2024 Annual Report._ **Source:** Rio Tinto Annual Report 2024; Wood Mackenzie mining autonomy analysis 2025.[^20]

### Saudi Aramco — AI Center & Metabrain platform
**Geography:** Dhahran, Saudi Arabia. **Programme:** Aramco AI Center (est. 2021, scaled 2023–2025); Metabrain industrial AI platform. **What they built:** Aramco's Metabrain platform is described as an industrial AI operating system that federates ML models across upstream, downstream, and corporate functions. Specific documented applications include AI-driven seismic interpretation (reducing cycle time from weeks to hours using convolutional neural networks on 3D seismic volumes), predictive maintenance for rotating equipment across refineries, and an LLM-based engineering document Q&A system for technical standards retrieval. The AI Center also runs a GPU compute cluster for internal model training, reducing dependence on external hyperscalers for sensitive subsurface data. _Architecture details for Metabrain orchestration layer unverified._ **Reported outcome:** Aramco cited internal productivity improvements in seismic interpretation and maintenance cost reduction in 2024 Sustainability Report. _Outcome figures unverified._ **Source:** Saudi Aramco Sustainability Report 2024; public statements by Aramco CTO 2024–2025.[^21]

### ADNOC — Panorama Digital Command Centre & AI71
**Geography:** Abu Dhabi, UAE. **Programme:** Panorama Digital Command Centre (operational since 2019, AI-enhanced 2023–2025); AI71 sovereign AI subsidiary (est. 2023). **What they built:** ADNOC's Panorama centre aggregates 2+ million data points daily from upstream, midstream, and downstream assets into a unified operations dashboard. By 2024–2025, AI agents embedded in Panorama were performing automated production optimisation recommendations and anomaly triage across the integrated value chain. AI71 was established as a separate entity to develop and deploy open-weight Arabic-language and industrial AI models (based on the Falcon model family from TII) on sovereign UAE cloud infrastructure, directly addressing data sovereignty concerns. **Reported outcome:** ADNOC cited >$4 billion in value creation attributed to digital and AI programmes cumulatively through 2024. _Outcome figure unverified — cross-check ADNOC investor communications._ **Source:** ADNOC annual review 2024; AI71 launch communications 2023–2024; Technology Innovation Institute (TII) Falcon model documentation.[^22]

### Enel — Gridspert AI grid management platform
**Geography:** Italy/Spain/Latin America (global utility operations). **Programme:** Gridspert (internal AI-native grid management platform, scaled 2024–2025). **What they built:** Enel developed Gridspert as an AI layer over its distribution grid management systems, deploying ML models for fault prediction, automated switching recommendations, and renewable generation forecasting. By 2025, Gridspert was processing real-time telemetry from millions of smart meters and grid sensors to optimise Volt/VAR control and reduce technical losses. The platform uses a microservices architecture on Azure, with domain-specific time-series models trained on Enel's proprietary grid data rather than generic foundation models. _Architecture details for agent orchestration layer unverified._ **Reported outcome:** Enel reported reduction in average interruption duration (SAIDI) in pilot distribution zones. _Outcome figures unverified._ **Source:** Enel Capital Markets Day presentations 2024–2025; Accenture Technology Vision 2025 (Enel referenced as grid AI case).[^23]

---

## 7. Key metrics & benchmarks

| Metric | Value | Unit | Date | Source | Notes |
|---|---|---|---|---|---|
| Global AI investment in energy sector | ~$12 billion | USD, annual | 2024 | IEA World Energy Investment 2025 [^24] | Covers software, hardware, and services; direction of travel sharply upward into 2026 |
| Share of tier-1 O&G operators with production ML deployments | ~70% | % of operators surveyed | 2025 | McKinsey State of AI 2025 [^1] | _Outcome figure unverified — verify survey methodology_ |
| Autonomous truck fleet hours operated, Rio Tinto Pilbara | >100 million | cumulative hours | end-2024 | Rio Tinto Annual Report 2024 [^20] | _Verify against published figure_ |
| New US datacentre electricity load contracted (pipeline) | >40 GW | GW, forward capacity | end-2025 | Wood Mackenzie datacentre energy report 2025 [^6] | _Unsourced — verify or replace_ |
| Hyperscaler nuclear/clean-firm PPA signings | >10 GW | GW signed globally | 2025 | BNEF Power Purchase Agreement tracker 2025 [^25] | _Unsourced — verify or replace_; direction of travel: accelerating |
| Reduction in seismic interpretation cycle time (AI vs. traditional) | 60–80% | % time reduction | 2024–2025 | S&P Global / Wood Mackenzie subsurface AI benchmarks [^9] | _Unsourced — verify or replace_ |
| EU AI Act high-risk classification effective date | August 2, 2024 | date | 2024 | Official Journal of the EU, Regulation 2024/1689 [^11] | Full obligations phased to 2026–2027 |
| Share of commodity trading firms with production RAG deployments | >60% | % of tier-1 firms | 2025 | S&P Global Commodity Insights survey 2025 [^8] | _Outcome figure unverified_ |
| Global renewable energy capacity added (AI-optimised dispatch contribution) | 585 GW | GW added in year | 2024 | IEA Electricity 2025 report [^2] | AI dispatch cited as enabling factor for integration; not sole cause |

---

## 8. Implications for Cognirise's positioning

- **Cognirise should develop an OT data liberation and AI readiness assessment service anchored to the "brownfield-first" pattern (§5, Pattern 1) and the OT/IT integration challenge (§3).** The structural bottleneck most energy operators face is not model sophistication but data infrastructure maturity. Cognirise's ability to diagnose and roadmap the OSIsoft/historian-to-cloud migration problem—and to sequence AI investment against data readiness—addresses the single most cited reason pilots fail to scale. This directly positions Cognirise upstream of hyperscaler and SI competition, which typically engages after data infrastructure is assumed to exist.

- **The AI datacentre/grid electricity demand trend (§2, Trend 2; §4, Priority 5) creates a new advisory opportunity at the intersection of energy market strategy and AI infrastructure planning.** Energy companies and hyperscalers are negotiating increasingly complex PPA and grid-services structures that neither energy lawyers nor AI architects can navigate alone. Cognirise can position at this intersection—helping utilities design AI-load-flexible commercial structures and helping technology companies evaluate generation asset portfolios—a mandate that did not exist in 2024 and for which no established advisory category yet dominates.

- **Sovereign AI procurement and the federated fine-tuning pattern (§5, Pattern 7; §3, vendor concentration) represent a differentiated advisory niche for NOC and European regulated utility clients.** The tension between AI capability ambition and data sovereignty is acute for ADNOC, Saudi Aramco, Equinor, and major European TSOs. Cognirise's ability to architect sovereign AI deployment models—open-weight model selection, private cloud fine-tuning pipelines, federated learning governance—addresses a strategic priority that hyperscaler-aligned SIs have a structural conflict of interest in solving objectively.

- **Agent governance and graduated autonomy frameworks (§5, Pattern 3; §3, agent-to-agent trust; §3, regulatory fragmentation) will become a compliance-driven procurement requirement by 2027.** As the EU AI Act's high-risk obligations mature and FERC/NERC begin incorporating AI agent standards into reliability rules, energy operators will need documented agent governance frameworks—autonomy tiers, kill-switch architectures, audit trail requirements—that are operationally credible rather than paper policies. Cognirise can develop and certify these frameworks ahead of regulatory crystallisation, establishing a first-mover position before the major consulting firms industrialise the offering.

- **The talent scarcity at the domain-AI intersection (§3) means Cognirise's research and training assets are a strategic differentiator, not a commodity.** Domain-credible AI guidance—i.e., guidance that a reservoir engineer or grid protection engineer will accept as technically literate—is scarce. Cognirise's investment in energy-sector-specific AI knowledge products, benchmarking, and practitioner training directly monetises this scarcity via retainer, licensing, and capability-building mandates.

---

## Sources

[^1]: McKinsey & Company, "The State of AI 2025," McKinsey Global Institute, 2025, https://www.mckinsey.com

[^2]: IEA, "World Energy Outlook 2025," International Energy Agency, 2025, https://www.iea.org

[^3]: IEA, "Electricity 2025: Analysis and Forecast to 2027," International Energy Agency, 2025, https://www.iea.org

[^4]: National Grid ESO, "Digital Spine Programme documentation," National Grid ESO, 2024–2025, https://www.nationalgrideso.com — _specific programme details: verify or replace_

[^5]: BNEF, "Corporate Energy Market Outlook 2026," BloombergNEF, 2025–2026, https://www.bnef.com — _nuclear/geothermal PPA aggregation figure: verify against BNEF PPA tracker_

[^6]: Wood Mackenzie, "AI and Datacentre Energy Demand Outlook," Wood Mackenzie, 2025, https://www.woodmac.com — _40 GW figure: unsourced — verify or replace_

[^7]: Rio Tinto, "Annual Report 2024," Rio Tinto plc, 2024, https://www.riotinto.com

[^8]: S&P Global Commodity Insights, "Commodity Trading Technology Survey 2025," S&P Global, 2025, https://www.spglobal.com/commodityinsights — _60% figure: outcome figure unverified_

[^9]: Wood Mackenzie / S&P Global Commodity Insights, subsurface AI benchmarking research, 2024–2025 — _specific publication: unsourced — verify or replace_

[^10]: Commonwealth Fusion Systems, public programme documentation and press releases, 2024–2025, https://www.cfs.energy; see also DeepMind, "Accelerating fusion science through learned plasma control," *Nature*, 2022.

[^11]: European Parliament and Council, "Regulation (EU) 2024/1689 on Artificial Intelligence (AI Act)," *Official Journal of the European Union*, August 2, 2024, https://eur-lex.europa.eu

[^12]: Financial Stability Board, "AI in Financial Markets: Stability Implications," FSB, 2025, https://www.fsb.org — _energy commodity derivatives section: unsourced — verify or replace_

[^13]: CISA, "ICS/SCADA Cybersecurity Advisories 2024," Cybersecurity and Infrastructure Security Agency, 2024, https://www.cisa.gov — _specific AI/agent advisory: unsourced — verify or replace_

[^14]: IEA, "Energy Technology Perspectives 2024," International Energy Agency, 2024, https://www.iea.org

[^15]: Palantir Technologies, "BP Partnership Expansion Announcement," Palantir press release, 2024, https://www.palantir.com — _verify specific AIP scope against published press release_

[^16]: Accenture, "Technology Vision 2025," Accenture, 2025, https://www.accenture.com

[^17]: McKinsey & Company, "Accelerating analytics in oil and gas," McKinsey Energy Insights, 2024, https://www.mckinsey.com — _brownfield data pattern: verify specific publication_

[^18]: AI71 / Technology Innovation Institute, "Falcon Model and Sovereign AI Programme," TII, 2023–2024, https://www.tii.ae; ADNOC, "AI71 launch communications," 2023, https://www.adnoc.ae

[^19]: BP plc, "Annual Report and Form 20-F 2024," BP plc, 2024, https://www.bp.com; Palantir Technologies, partnership press releases 2024, https://www.palantir.com

[^20]: Rio Tinto plc, "Annual Report 2024," Rio Tinto, 2024, https://www.riotinto.com

[^21]: Saudi Aramco, "Sustainability Report 2024," Saudi Aramco, 2024, https://www.saudiaramco.com

[^22]: ADNOC, "2024 Annual Review," Abu Dhabi National Oil Company, 2024, https://www.adnoc.ae; AI71, programme documentation, https://www.ai71.ai

[^23]: Enel Group, "Capital Markets Day 2024 and 2025 presentations," Enel SpA, 2024–2025, https://www.enel.com

[^24]: IEA, "World Energy Investment 2025," International Energy Agency, 2025, https://www.iea.org — _$12 billion AI-in-energy figure: unsourced — verify or replace_

[^25]: BloombergNEF, "PPA Market Outlook and Clean Firm Power Tracker 2025," BNEF, 2025, https://www.bnef.com — _GW figure: unsourced — verify or replace_