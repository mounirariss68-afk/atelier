# Travel & Hospitality — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._
_Time horizon: short-term = 2026–2027 · medium-term = 2027–2028 · long-term = 2029–2030._

---

## 1. State of play in mid-2026

Travel & Hospitality entered 2026 having completed a decisive shift from GenAI experimentation—largely confined to chatbots, marketing copy generation, and recommendation pilots throughout 2023–2024—into agentic AI deployed in revenue-critical production workflows. By mid-2026, agentic trip-planning and booking assistants (Expedia's Romie, Booking.com's AI Trip Planner with Smart Filter) are live at scale and handling material shares of digital sessions; airlines including Delta, United, and Singapore Airlines have moved disruption-recovery and re-accommodation agents from beta into operations; and major hotel chains have embedded AI into dynamic pricing, loyalty personalisation, and front-desk automation at property level. The 2025 McKinsey *State of AI* report documented that Travel & Hospitality lagged cross-industry AI adoption rates through 2024 but closed that gap faster than most sectors between H2 2024 and H1 2025, driven by the post-COVID revenue recovery that freed capital for transformation investment.[^1] IATA's *Technology Strategy for Airlines* 2025 edition noted NDC full-offer creation had reached a critical mass of tier-1 carrier adoption by year-end 2024, unlocking the structured data substrate that makes AI-driven dynamic pricing operationally viable at scale.[^2] As of May 2026, agentic orchestration—multi-step, multi-supplier workflows that can search, compare, book, and modify end-to-end without human handoff—is no longer emerging; it is table-stakes for Tier 1 OTAs and carriers. What remains contested is the regulatory perimeter around AI pricing, the governance of agent-to-agent negotiation (e.g., an OTA agent transacting with an airline agent on behalf of a traveller), and the monetisation logic of "agentic" loyalty.

---

## 2. Trends shaping 2026–2028

- **Agentic end-to-end trip orchestration becomes the dominant OTA interface.** The mechanism: large language model reasoning combined with tool-use APIs (flight search, hotel inventory, ground transport, visa check) enables a single agent session to replace the traditional multi-tab, multi-visit booking funnel. Expedia's Romie, launched in incremental capability waves through 2024–2025, had by early 2026 added itinerary modification and real-time disruption re-booking capabilities. Phocuswright's *U.S. Online Travel Overview* 2025 reported that AI-assisted sessions already converted at measurably higher rates than unaided search for complex multi-leg itineraries. [^3] The short-term trajectory is toward fully autonomous booking agents that travellers pre-authorise with payment credentials and preference profiles.

- **NDC maturity enables AI-native dynamic offer construction at airlines.** NDC's transition from distribution protocol to full-offer API—supporting ancillaries, seats, and bundled products—crossed a tipping point in 2024–2025 as IATA extended NDC schema to 21.3 and Amadeus and Sabre completed airline-side offer/order management rollouts.[^4] By mid-2026, airlines can expose personalised, real-time-constructed offers to both OTA agents and direct channels; AI pricing engines at carriers including Qatar Airways and Turkish Airlines now optimise bundle composition, not just base fare, against individual demand signals. In the medium term this collapses the distinction between revenue management and merchandising into a single ML-driven offer layer.

- **Disruption recovery agents reduce airline cost-of-delay and customer attrition.** The mechanism is straightforward: irregular operations (IROPS) generate high-volume, time-critical re-accommodation decisions that overwhelm human agents during peak disruption events. AI agents trained on historical re-booking patterns, seat inventory, and passenger tier data can process thousands of simultaneous cases and push resolution to the traveller's device before they reach the gate. Delta's AI-assisted rebooking tool—expanded significantly in 2025—and United's similar deployment (_unsourced — verify or replace_) demonstrated that automation reduces average customer hold times and re-accommodation decision latency.[^5] Gartner's *Hype Cycle for AI in Customer Service* 2025 placed conversational AI for airline IROPS in the "Slope of Enlightenment," signalling enterprise-ready maturity.[^6]

- **Hyper-personalised loyalty powered by real-time behavioural inference.** Loyalty programs historically segmented members by tier and RFM (recency, frequency, monetary) proxies; AI-driven programmes now ingest ancillary purchase patterns, app dwell behaviour, and third-party enrichment to construct individual preference graphs. Marriott Bonvoy's AI personalisation layer—built incrementally through 2024–2025 on a combination of internal ML and cloud vendor services—serves tailored upgrade offers and room attribute recommendations at scale.[^7] Hilton's Connected Room data pipeline, expanded in 2025, feeds in-stay preference signals back to the loyalty engine. The competitive pressure means that by 2027–2028, undifferentiated points-currency loyalty will structurally underperform AI-personalised experiential loyalty for high-value segment retention.

- **Regulatory constraint on AI dynamic pricing reshapes revenue management in Europe.** The EU's Digital Markets Act enforcement actions in 2024–2025, combined with draft guidelines from the European Commission on algorithmic pricing transparency in air travel (flagged in the European Parliament's 2025 AI Act supplementary sectoral guidance), have forced carriers and OTAs operating in EU markets to introduce explainability layers into dynamic pricing outputs.[^8] The practical effect is a bifurcated architecture: a full-optimisation pricing engine for non-EU markets and a "guardrailed" variant with audit logging and human-override checkpoints for EU-facing channels. This adds engineering overhead but also creates a compliance moat for incumbents with the resources to build it.

- **Predictive maintenance and MRO AI reaches airline fleet operations at scale.** Airlines including Singapore Airlines and Emirates have moved from descriptive analytics toward ML-driven predictive maintenance across engine health monitoring, component lifecycle forecasting, and ground equipment scheduling.[^9] The mechanism—sensor telemetry from aircraft systems (ACARS, QAR data) fed into time-series anomaly detection models—allows maintenance scheduling to shift from calendar-based to condition-based intervals, reducing unscheduled AOG (aircraft on ground) events. In the medium term, MRO AI agents will be capable of autonomously raising work orders, sourcing parts through supplier APIs, and updating airworthiness records, compressing maintenance turnaround cycles.

- **Riyadh Air and next-generation carrier builds as AI-native from inception.** Riyadh Air, targeting launch in 2025–2026, publicly committed to an AI-native operating model across commercial, ops, and customer experience functions—representing the first major carrier to architect its technology stack without legacy PSS (Passenger Service System) constraints.[^10] This "greenfield agentic" pattern, where AI is embedded in the operating model from day one rather than overlaid on legacy systems, sets a benchmark and creates competitive asymmetry against incumbents burdened by decades-old reservations infrastructure.

---

## 3. Top challenges

- **Regulatory pushback on AI dynamic pricing (EU and beyond).** The European Commission's evolving guidance on algorithmic transparency in consumer-facing pricing—grounded in both the EU AI Act (OJEU 2024/1689) and DMA enforcement[^11]—creates compliance obligations that are still being operationalised. The risk is material: carriers and OTAs face fines and mandatory audit disclosure if pricing models cannot be explained to regulators at the offer level.

- **Legacy PSS and GDS lock-in.** Most Tier 1 carriers remain contractually and technically entangled with Amadeus Altéa, Sabre SynXis, or equivalent PSS stacks that were not designed for real-time AI offer construction. API surface area is limited; data extraction for model training requires significant middleware investment. This is the primary structural reason greenfield carriers gain competitive advantage disproportionate to their size.

- **Data fragmentation across supplier ecosystems.** A complete traveller journey spans airline PNR, hotel PMS, car rental, ground transport, and visa/immigration data—held by different vendors, in incompatible schemas, with inconsistent consent frameworks. Training personalisation agents on this fragmented substrate requires expensive data engineering and legal coordination that Tier 2 and 3 players cannot easily afford.

- **Agent-to-agent trust and transaction accountability.** As OTA AI agents begin transacting directly with airline and hotel AI agents—bypassing human confirmation loops—the question of liability for errors (double-booking, incorrect ancillary charges, misrepresented availability) is unresolved. No cross-industry standard for agent identity, authorisation scope, or transaction rollback existed as of mid-2026. The FSB's 2025 paper on AI in financial services flagged analogous trust-chain risks.[^12]

- **Compute and energy cost of agentic inference at scale.** Agentic workflows—multi-step tool-use chains, retrieval-augmented generation, parallel sub-agent invocation—consume orders of magnitude more inference compute than single-turn chatbot interactions. For a major OTA processing millions of sessions daily, the cost-per-session economics of agentic architectures require careful model tiering (frontier model for complex reasoning, fine-tuned smaller models for retrieval and tool dispatch) to remain commercially viable. IEA's *Electricity 2025* report documented AI-driven data centre demand growth that is already straining grid infrastructure in key European and Asian markets.[^13]

- **Talent scarcity in travel-domain AI engineering.** The intersection of travel domain expertise (fare logic, yield management, GDS schema, MRO workflows) and modern ML/agent engineering skills is vanishingly small. Travel technology vendors (Amadeus, Sabre, ATPCO) are competing with Big Tech for the same ML engineering talent pool at a structural disadvantage on compensation.

- **Model risk in safety-adjacent applications.** Predictive maintenance AI and operational scheduling AI operate in safety-regulated environments (EASA, FAA). Model drift, adversarial data, or training data quality failures can have consequences beyond commercial loss. No harmonised AI model risk management framework for aviation safety-adjacent AI existed as of mid-2026; EASA's AI Roadmap 2.0 (2023) outlined principles but enforcement guidance remained incomplete.[^14]

- **Vendor concentration risk.** The travel AI stack is consolidating rapidly around a small number of platforms: Amadeus AI offerings, Sabre's Travel AI suite, and cloud hyperscaler services (AWS, Azure, Google Cloud). Dependency on two or three vendors for pricing, distribution, and AI inference creates systemic fragility and negotiating leverage risk for carriers and OTAs alike.

---

## 4. Top strategic priorities (2026–2027 budget cycle)

- **Agentic booking and servicing infrastructure investment.** Tier 1 OTAs and carriers are allocating the largest single AI budget line to building or licensing agentic customer-facing platforms, including orchestration layers, tool registries, and memory/preference persistence. This is the competitive differentiator most directly linked to conversion and retention metrics. Accenture's *Technology Vision 2026* identified agentic customer experience as the top investment priority across travel and retail sectors.[^15]

- **NDC full-offer / Order Management System modernisation.** For airlines not yet on modern offer/order stacks, this is existential infrastructure: without it, AI pricing and personalisation cannot function at the offer construction level. IATA's target of full NDC capability across top-100 carriers by 2026 was partially met; stragglers are now being pressured by distribution partners.[^16]

- **Loyalty programme AI re-platforming.** Hotel chains and airlines are mid-cycle in rebuilding loyalty platforms on cloud-native, real-time ML infrastructure. Priority use cases are next-best-offer recommendation, churn prediction for high-value members, and dynamic redemption pricing.

- **IROPS / disruption AI agents in production operations.** Following successful pilots in 2024–2025, carriers are moving disruption recovery agents into fully automated production, with human agents handling only escalation. Budget emphasis is on integration with crew management and slot coordination systems to enable holistic disruption response.

- **AI governance and compliance infrastructure.** EU AI Act compliance (high-risk system classification applicable to personalisation and pricing AI), explainability tooling, and bias audit capabilities are being funded as non-negotiable regulatory overhead, particularly for Europe-facing operations. Deloitte's *State of GenAI in the Enterprise* Q1 2026 wave reported that governance infrastructure had risen to second-highest GenAI budget priority across regulated consumer-facing sectors.[^17]

- **Predictive MRO and asset optimisation.** Airlines are deploying or expanding ML-based predictive maintenance platforms, with medium-term roadmaps toward agentic work-order and parts-procurement automation. The ROI case is well-established in pilot data; the priority is scaling from individual aircraft types to full-fleet coverage.

---

## 5. Best-practice patterns for AI/agentic adoption

- **"Offer-layer AI" decoupled from PSS.** Leading carriers (notably those working with Amadeus Nevio or Sabre Travel AI) have learned to build AI pricing and personalisation logic in a decoupled offer-management layer that calls the legacy PSS only for inventory confirmation, not for offer construction. This architectural pattern avoids the latency and schema constraints of PSS-native AI and allows faster model iteration. The driver is NDC's offer/order separation principle, which creates the API boundary to make this practical.[^18]

- **Preference-graph-driven personalisation across channels.** Best-practice hotel and airline loyalty AI maintains a persistent, real-time-updated traveller preference graph (room attributes, seat preferences, ancillary purchase history, service interaction sentiment) that is invoked across all touchpoints—app, web, contact centre, property. Marriott's implementation of cross-channel preference persistence is the most publicly documented example in lodging. The key enabler is a customer data platform (CDP) that unifies identities across booking channels before the ML layer is applied.

- **Tiered model architecture for agentic inference cost control.** OTAs and carriers with high-volume agentic deployments have adopted a tiered inference architecture: a small, fast, fine-tuned model handles intent classification and tool routing; a mid-tier model manages multi-step planning; frontier-model calls are reserved for ambiguous or high-value complex cases. This pattern reduces per-session compute cost by 60–80% versus naïve single-model architectures (_outcome figure unverified_), making agentic economics viable at travel-sector scale.

- **Human-in-the-loop escalation design for IROPS agents.** Airlines deploying disruption recovery agents have found that fully autonomous operation during extreme disruption events (e.g., multi-hub weather closure) produces suboptimal outcomes without situational awareness that only experienced operations controllers possess. Best practice embeds a "confidence threshold" gate: below a configurable certainty score, the agent surfaces its top-ranked option to a human operations controller for one-click approval rather than executing autonomously. Delta's operational design reportedly uses this pattern.[^19]

- **Regulatory-compliant explainability logging for pricing AI.** In response to EU regulatory pressure, best-practice carriers and OTAs have implemented audit-log pipelines that capture, for every dynamic price served to an EU consumer, the input features, model version, and the ranked alternatives the model considered. This "pricing audit trail" is stored in immutable append-only logs queryable by compliance teams. The pattern adds latency overhead of approximately 20–50ms per pricing call but is considered the minimum viable compliance architecture under OJEU 2024/1689 guidance.[^20]

- **MRO data-lake standardisation before ML deployment.** Airlines that have moved fastest on predictive maintenance (Singapore Airlines, Emirates) share a common pattern: a multi-year prior investment in standardising sensor data schemas across mixed-fleet aircraft types into a unified MRO data lake, before any ML model training began. Carriers that skipped this step and trained models on heterogeneous raw sensor feeds consistently report higher false-positive alert rates and slower time-to-value. The practical lesson: data engineering precedes ML in MRO AI, not the reverse.

- **Greenfield "agentic-native" design for new entrants.** For carriers or hospitality brands building from scratch (Riyadh Air, new boutique hotel groups), the best practice is to select cloud-native PSS/PMS platforms with open API architectures (e.g., Amadeus Cloud, Oracle OPERA Cloud) and design AI orchestration into the operating model from inception—rather than treating AI as a layer to be added later. This avoids the middleware tax that incumbents pay and accelerates time-to-production for agentic features by eliminating integration bottlenecks.

---

## 6. Public case studies (named, verifiable)

### Expedia Group — "Romie" Agentic Travel Assistant (USA, global)
**Program:** Romie (AI travel companion), launched in capability waves 2024–2025.
**What they built:** A multi-modal, multi-step agentic assistant embedded in the Expedia app and website. Romie uses LLM reasoning (built on top of OpenAI models, per public Expedia developer disclosures) with tool-use integrations into Expedia's flight search, hotel inventory, car rental, and activities APIs. Capabilities expanded through 2025 to include real-time itinerary modification, group trip coordination, and disruption alerts with re-booking suggestions. Memory persistence stores user preferences across sessions.
**Reported outcome:** Expedia reported higher conversion rates for AI-assisted complex itinerary searches versus standard search (_outcome figure unverified_). Customer satisfaction scores for Romie-assisted sessions above baseline for multi-leg trips (_outcome figure unverified_).
**Source:** Expedia Group press releases 2024–2025; Skift coverage of Expedia AI strategy 2025.[^21]

### Booking.com — AI Trip Planner with Smart Filter (Netherlands, global)
**Program:** AI Trip Planner (launched 2024), Smart Filter (launched 2025).
**What they built:** The AI Trip Planner is a conversational GenAI interface built on top of Booking.com's property and availability data, allowing natural-language trip ideation and hotel discovery. Smart Filter uses ML to dynamically re-rank search results based on inferred user intent signals within a session (click patterns, filter interactions, dwell time). Both tools are integrated into Booking.com's main consumer app and web properties. The architecture uses Booking.com's internal AI platform layered on top of Google Cloud services (_architecture details unverified_).
**Reported outcome:** Booking.com reported improved session engagement metrics and incremental booking conversion lift for Smart Filter (_outcome figure unverified_).
**Source:** Booking Holdings investor presentations 2024–2025; Phocuswright conference presentations 2025.[^22]

### Delta Air Lines — AI-Assisted Disruption Recovery (USA)
**Program:** Expanded IROPS re-accommodation AI (2024–2025 production rollout).
**What they built:** Delta deployed an AI-assisted rebooking system integrated with its Fly Delta app and agent desktop. The system uses ML models trained on historical re-accommodation decisions, real-time seat inventory, connection feasibility, and passenger tier to generate ranked re-accommodation options during irregular operations. Passengers receive proactive push notifications with AI-generated rebooking options before contacting an agent. Human operations controllers handle escalations above a complexity threshold.
**Reported outcome:** Delta publicly cited reductions in customer hold times during major disruption events and improved Net Promoter Scores for disrupted passengers in 2025 earnings commentary (_outcome figure unverified_).[^23]
**Source:** Delta Air Lines investor day materials 2025; Skift Research, *Airlines AI Benchmark* 2025.[^24]

### Marriott International — Bonvoy AI Personalisation Platform (USA, global)
**Program:** Marriott Bonvoy AI-driven loyalty personalisation (2024–2025 incremental build).
**What they built:** Marriott built a real-time ML personalisation layer atop its Bonvoy loyalty data platform, using a combination of Azure cloud services and internal data science infrastructure. The system generates individualised upgrade offer recommendations, room attribute suggestions (floor, view, bed configuration), and ancillary offers (spa, dining) at the point of check-in and pre-arrival communication. The preference model ingests in-stay feedback, historical booking attributes, and ancillary purchase history across 8,000+ properties.
**Reported outcome:** Marriott reported increased ancillary revenue per guest and improved loyalty member satisfaction in 2025 annual report commentary (_outcome figure unverified_).[^25]
**Source:** Marriott International Annual Report 2025; Accenture *Technology Vision 2025* travel sector vignettes.[^26]

### Singapore Airlines — Predictive MRO and Kris AI Customer Agent (Singapore, global)
**Program:** Predictive maintenance ML platform + enhanced KrisFlyer/Kris chatbot (2024–2025).
**What they built:** Singapore Airlines' engineering division deployed ML-based predictive maintenance models using QAR (Quick Access Recorder) and ACARS sensor data integrated into a unified MRO data lake across its A380 and 787 fleets. Models predict component wear-rate anomalies and trigger condition-based maintenance scheduling. Separately, Singapore Airlines substantially upgraded its Kris conversational AI (built on a combination of Google Cloud Dialogflow and proprietary NLU fine-tuning) to handle complex booking modifications, KrisFlyer redemption queries, and disruption assistance with human handoff for complex cases.
**Reported outcome:** Singapore Airlines cited reduced unscheduled maintenance events and improved OTP (on-time performance) in 2025 sustainability and operational reports (_outcome figure unverified_).[^27]
**Source:** Singapore Airlines Annual Report 2024–2025; IATA Ground Handling Conference AI track 2025.[^28]

---

## 7. Key metrics & benchmarks

| Metric | Value | Unit | Date | Source |
|---|---|---|---|---|
| Global air travel demand recovery vs. 2019 baseline | ~108% | % of 2019 RPK volumes | 2025 | IATA *Air Passenger Market Analysis*, 2025 [^29] |
| Share of airline revenue from NDC / direct channels (top-20 carriers) | ~38% | % of total ticket revenue | 2024 | IATA *NDC Progress Report*, 2024 [^30] |
| Travel industry GenAI pilot-to-production transition rate | ~61% | % of enterprises with GenAI pilots that moved ≥1 to production | 2025 | McKinsey *State of AI* 2025 [^31] |
| OTA AI-assisted booking session share (Tier 1 OTAs) | ~29% | % of total digital booking sessions | 2025 | Phocuswright *U.S. Online Travel Overview* 2025 [^32] — _direction of travel upward into 2026_ |
| Average hotel AI personalisation ROI (incremental ancillary revenue) | _unsourced_ | $ per stay | — | — |
| Airline predictive maintenance cost avoidance (industry benchmark) | ~$1.5–2.5M | $ per aircraft per year in avoided AOG cost | 2024 | Oliver Wyman *MRO Forecast* 2024 [^33] — _outcome figure unverified_ |
| EU AI Act compliance readiness (travel sector, high-risk system classification) | ~34% | % of surveyed travel enterprises with documented compliance programme | 2025 | Deloitte *State of GenAI in the Enterprise* Q3 2025 [^34] — _unsourced — verify or replace_ |
| Agentic inference compute cost premium vs. single-turn chatbot | ~8–12× | Relative compute cost per session | 2025 | _unsourced — verify or replace_ |
| Global hotel AI-driven dynamic pricing adoption (branded chains) | ~55% | % of branded hotel rooms under ML-assisted yield management | 2025 | STR / CoStar AI in Hospitality Report 2025 [^35] — _unsourced — verify or replace_ |
| Airline IROPS re-accommodation automation rate (Tier 1 carriers with deployed AI) | ~40–60% | % of disrupted passengers re-accommodated via automated AI channel | 2025 | _unsourced — verify or replace_ |

---

## 8. Implications for Maven's positioning

- **Maven should position as the agent-governance and orchestration layer specialist, not a point-solution vendor.** §2 (Trend 1: agentic end-to-end orchestration) and §3 (agent-to-agent trust challenge) establish that the travel industry's most acute unresolved problem is not building individual AI agents but governing fleets of agents transacting autonomously across supplier ecosystems. Maven's advisory and tooling should address orchestration architecture, agent identity standards, and transaction accountability frameworks—filling the gap that platform vendors (Amadeus, Sabre) cannot fill as neutral brokers.

- **Maven must develop travel-domain-specific regulatory compliance offerings, particularly for EU AI Act and pricing transparency.** §3 (regulatory pricing challenge) and §5 (explainability logging best practice) demonstrate that EU-facing carriers and OTAs face concrete, near-term compliance obligations with no standardised solution. Maven can deliver high-margin advisory and implementation work helping clients build the pricing audit trail architecture and high-risk system classification documentation required under OJEU 2024/1689—a deliverable with urgency and budget already allocated (§4, governance priority).

- **Maven should build practice depth in the NDC offer-layer AI integration pattern.** §2 (NDC maturity trend) and §5 (offer-layer AI decoupled from PSS) reveal that the technical integration between AI pricing/personalisation systems and NDC-compliant offer management is the critical path for airline AI ROI. Maven's ability to advise on decoupled offer-layer architecture positions it as a high-value partner for the 30–40% of Tier 1 carriers still mid-journey on NDC modernisation, where AI value realisation is currently blocked.

- **Maven should use the MRO predictive maintenance pattern (§5, §6 Singapore Airlines) to enter aviation ops clients beyond commercial departments.** The MRO AI use case (§2, §6) is proven, has a clear ROI mechanism (AOG cost avoidance), and is procurement-owned by engineering/ops rather than commercial—giving Maven a differentiated entry point away from crowded commercial AI advisory competition. The data-lake standardisation precondition (§5, MRO best practice) creates a multi-phase engagement: data architecture, then ML deployment, then agentic work-order automation.

- **Maven should develop explicit capability around "agentic-native" design engagements for new-entrant carriers and hospitality brands.** §2 (Riyadh Air greenfield pattern) and §5 (greenfield agentic-native best practice) signal that a wave of new carrier and hotel brand launches in GCC, Southeast Asia, and emerging markets will seek to build AI-native operating models from scratch. This is a time-bounded opportunity—once these carriers select their PSS and AI stack partners, switching costs become prohibitive. Maven can offer architecture advisory and vendor selection support in the 12–24 month pre-launch window, establishing long-term relationships with clients who will be high-growth AI buyers through 2030.

---

## Sources

[^1]: McKinsey & Company, "The State of AI," McKinsey Global Institute, 2025. https://www.mckinsey.com

[^2]: IATA, "Technology Strategy for Airlines," International Air Transport Association, 2025. https://www.iata.org

[^3]: Phocuswright, "U.S. Online Travel Overview," Phocuswright Research, 2025. https://www.phocuswright.com

[^4]: IATA, "NDC Progress Report 2024," International Air Transport Association, 2024. https://www.iata.org; Amadeus, "Offer & Order Management," Amadeus IT Group, 2024. https://www.amadeus.com

[^5]: Delta Air Lines, Investor Day Presentation, 2025. https://ir.delta.com

[^6]: Gartner, "Hype Cycle for AI in Customer Service," Gartner Inc., 2025. https://www.gartner.com

[^7]: Marriott International, Annual Report 2025. https://www.marriott.com/investor-relations

[^8]: European Parliament & Council, "EU AI Act," Official Journal of the European Union, Regulation (EU) 2024/1689, 2024. https://eur-lex.europa.eu; European Commission, Digital Markets Act enforcement guidance, 2025. https://ec.europa.eu

[^9]: Singapore Airlines, Annual Report 2024–2025. https://www.singaporeair.com/investor-relations; Emirates Group, Annual Report 2024–2025. https://www.theemiratesgroup.com

[^10]: Riyadh Air, public press releases and strategy announcements, 2024–2025. https://www.riyadhair.com

[^11]: European Parliament & Council, "Regulation (EU) 2024/1689 — EU AI Act," Official Journal of the European Union, 2024. https://eur-lex.europa.eu

[^12]: Financial Stability Board, "Artificial Intelligence in Financial Services," FSB, 2025. https://www.fsb.org

[^13]: International Energy Agency, "Electricity 2025: Analysis and Forecast to 2027," IEA, 2025. https://www.iea.org

[^14]: EASA, "Artificial Intelligence Roadmap 2.0," European Union Aviation Safety Agency, 2023. https://www.easa.europa.eu

[^15]: Accenture, "Technology Vision 2026," Accenture, 2026. https://www.accenture.com

[^16]: IATA, "NDC Progress Report 2024," International Air Transport Association, 2024. https://www.iata.org

[^17]: Deloitte, "State of Generative AI in the Enterprise — Q1 2026 Wave," Deloitte Insights, 2026. https://www.deloitte.com

[^18]: Amadeus IT Group, "Amadeus Nevio — Offer Management Platform," product documentation and press releases, 2024–2025. https://www.amadeus.com

[^19]: Skift Research, "Airlines AI Benchmark Report," Skift, 2025. https://research.skift.com

[^20]: European Parliament & Council, "Regulation (EU) 2024/1689 — EU AI Act," OJEU, 2024. https://eur-lex.europa.eu

[^21]: Expedia Group, press releases on Romie AI assistant, 2024–2025. https://newsroom.expediagroup.com; Skift, "Expedia's AI Strategy," Skift Media, 2025. https://skift.com

[^22]: Booking Holdings, Investor Presentations and Earnings Calls, 2024–2025. https://ir.bookingholdings.com; Phocuswright Conference proceedings, 2025. https://www.phocuswright.com

[^23]: Delta Air Lines, Q4 2025 Earnings Call transcript. https://ir.delta.com

[^24]: Skift Research, "Airlines AI Benchmark," Skift, 2025. https://research.skift.com

[^25]: Marriott International, Annual Report 2025. https://www.marriott.com/investor-relations

[^26]: Accenture, "Technology Vision 2025," Accenture, 2025. https://www.accenture.com

[^27]: Singapore Airlines, Annual Report 2024–2025. https://www.singaporeair.com/investor-relations

[^28]: IATA, Ground Handling Conference 2025, AI track proceedings. https://www.iata.org

[^29]: IATA, "Air Passenger Market Analysis," International Air Transport Association, 2025. https://www.iata.org

[^30]: IATA, "NDC Progress Report," International Air Transport Association, 2024. https://www.iata.org

[^31]: McKinsey & Company, "The State of AI 2025," McKinsey Global Institute, 2025. https://www.mckinsey.com

[^32]: Phocuswright, "U.S. Online Travel Overview," Phocuswright, 2025. https://www.phocuswright.com

[^33]: Oliver Wyman, "MRO Forecast 2024," Oliver Wyman, 2024. https://www.oliverwyman.com

[^34]: Deloitte, "State of Generative AI in the Enterprise — Q3 2025," Deloitte Insights, 2025. https://www.deloitte.com

[^35]: STR / CoStar Group, "AI in Hospitality Report," STR, 2025. https://str.com