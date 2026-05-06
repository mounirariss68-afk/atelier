# Financial Services — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._

---

## 1. Global AI & Agentic Transformation Trends (2024–2026)

- **Generative AI moves from pilot to production at scale.** McKinsey's *State of AI 2024* report found that 65% of organisations globally are now using generative AI in at least one business function, with financial services among the top three adopting industries; average number of GenAI use cases per firm roughly doubled year-on-year.[^1]

- **Agentic AI is the defining architectural shift of 2025–2026.** Gartner's *Hype Cycle for Artificial Intelligence 2024* identifies autonomous AI agents as moving rapidly toward the Peak of Inflated Expectations, with multi-agent orchestration frameworks emerging as a board-level priority in banking and insurance.[^2]

- **AI investment in financial services reached an estimated $35 billion globally in 2024** across first-party build, vendor licensing, and cloud AI services, with IDC forecasting a compound annual growth rate above 20% through 2028 as agentic workflow automation adds a new spending category.[^3]

- **Workforce augmentation, not replacement, dominates stated strategy.** Accenture's *Technology Vision 2025* frames the dominant pattern as "human-agent teaming," noting that leading financial institutions are redesigning job architectures around AI co-pilots rather than headcount reduction, though back-office attrition pressure remains real.[^4]

- **Model risk and explainability obligations are reshaping procurement.** The EU AI Act (in force August 2024, obligations phasing through 2027) classifies credit-scoring, insurance-underwriting, and AML systems as high-risk, requiring conformity assessments and ongoing human oversight — directly constraining which GenAI architectures banks can deploy in customer-facing credit decisions.[^5]

- **Real-time payments and embedded finance create new agentic demand.** As ISO 20022 migration accelerates and open-banking APIs proliferate, payment orchestration agents that autonomously route, reconcile, and flag exceptions are moving from proof-of-concept to core infrastructure at tier-1 banks. _unsourced — verify or replace_

- **Sovereign and regional AI strategies are fragmenting the global stack.** The UAE's National AI Strategy 2031, Saudi Vision 2030's digital pillars, and the ECB's internal AI governance guidance are each creating differentiated compliance environments that require banks operating across jurisdictions to maintain parallel model registries.[^6]

---

## 2. Top Challenges

- **Regulatory uncertainty and high-risk classification under EU AI Act.** Article 6 and Annex III of the EU AI Act list creditworthiness assessment and life/health insurance risk evaluation as high-risk AI applications, triggering mandatory transparency, bias testing, and human-override requirements that add 6–18 months to deployment timelines.[^5]

- **Model risk management (MRM) frameworks lagging GenAI complexity.** The US OCC's *Model Risk Management Guidance* (SR 11-7 / OCC 2011-12) was written for statistical models; it was not designed for LLMs exhibiting non-deterministic outputs, prompt injection vulnerabilities, and hallucination risk. US agencies have issued clarifying guidance but comprehensive updates remain in progress, leaving banks operating in interpretive grey zones.[^7]

- **Data fragmentation across legacy core-banking platforms.** Most tier-1 banks globally still run core deposits or lending on platforms that are 20–40 years old (IBM mainframe, FIS Profile, Temenos T24). Feeding these siloed, batch-oriented data stores into real-time AI inference pipelines requires expensive integration layers that routinely account for 40–60% of total AI programme budgets. _unsourced — verify or replace_

- **Talent scarcity in AI engineering and financial-domain ML.** Deloitte's *State of Generative AI in the Enterprise 2024* survey found that talent availability is the single most-cited barrier to scaling GenAI, with financial services firms competing against technology companies for ML engineers who also understand regulatory capital, actuarial science, or derivatives pricing.[^8]

- **Agent governance: accountability gaps in multi-agent workflows.** When an agentic pipeline autonomously executes a trade amendment, denies a mortgage application, or flags a suspicious transaction, existing accountability frameworks do not clearly assign liability when multiple LLM agents interact. The FSB's *Artificial Intelligence and Machine Learning in Financial Services* report flags systemic risk from correlated automated decisions across institutions.[^9]

- **Third-party and vendor concentration risk.** Heavy reliance on a small number of foundation-model providers (OpenAI, Anthropic, Google DeepMind, Mistral) and hyperscaler AI platforms (Azure OpenAI, AWS Bedrock, Google Vertex) is raising supervisory concern. The FCA's *AI Discussion Paper DP5/22* specifically flags that concentration in AI supply chains could create new forms of operational systemic risk.[^10]

- **Explainability and consumer protection in automated decisions.** The EU's General Data Protection Regulation Article 22 and the FCA's Consumer Duty (effective July 2023) both impose obligations to explain automated decisions to retail customers. Current frontier LLMs have limited native explainability, requiring additional interpretability tooling that adds cost and latency.[^10]

- **Change management and organisational culture.** BCG's *Winning with AI* research consistently highlights that the primary failure mode in enterprise AI programmes is not technical but organisational — resistance from middle management, unclear ownership, and absence of AI-fluency training for business-line leaders. _unsourced — verify or replace_

---

## 3. Top Strategic Priorities (2025–2026)

- **Agentic process automation in operations and compliance.** Banks and insurers are prioritising autonomous agents for KYC refresh, AML alert adjudication, claims straight-through processing, and regulatory reporting generation — workflows where the combination of document understanding, reasoning, and API execution creates measurable unit-cost reductions.[^1]

- **AI-augmented relationship management and wealth advisory.** BCG's *Global Wealth Report 2024* highlights that personalised investment guidance at scale is the primary AI investment theme for private banks and wealth managers, with hyper-personalised portfolio commentary, tax-loss harvesting suggestions, and client-event triggers being top use cases.[^11]

- **Enterprise-wide data and AI platform consolidation.** CIOs across financial services are consolidating previously fragmented ML infrastructure into unified AI platforms (Databricks, Snowflake + cloud-native vector stores), enabling shared model registries, feature stores, and governance controls — a prerequisite for safe multi-agent deployment.[^3]

- **Responsible AI and model governance programmes.** Driven by EU AI Act compliance deadlines and OCC supervisory expectations, chief risk officers are standing up dedicated AI governance functions, including model inventory management, bias and fairness testing pipelines, and red-team exercises specifically designed for LLM-based systems.[^7]

- **Customer-facing conversational and agentic channels.** Following Klarna's widely-cited deployment, financial institutions across segments are investing in AI-native customer service agents capable of handling account servicing, payment disputes, and first-notice-of-loss claims end-to-end without human escalation, targeting deflection rates above 70%. _unsourced — verify or replace_

- **Cybersecurity and fraud-detection uplift via GenAI.** Synthetic identity fraud, AI-generated phishing, and adversarial model attacks are prompting major investment in GenAI-augmented fraud analytics, real-time behavioural biometrics, and LLM-assisted threat intelligence summarisation — increasingly treated as a board-level, non-negotiable spend.[^9]

- **MENA digital-banking AI expansion.** Saudi National Bank, Al Rajhi Bank, and Emirates NBD have each publicly committed to AI-first digital transformation programmes aligned with Saudi Vision 2030 and UAE AI Strategy 2031, prioritising Arabic-language LLM fine-tuning, conversational banking, and AI-driven credit underwriting for underbanked segments. _outcome figures unverified_

---

## 4. Best-Practice Patterns for AI/Agentic Adoption

**1. Federated AI Governance with Centralised Standards**
Leading institutions (JPMorgan, BBVA) establish a central AI Centre of Excellence that sets model risk standards, approved model registries, and ethical guidelines, while empowering business-line AI teams to build and deploy autonomously within those guardrails. This "hub and spoke" model reduces duplicated governance overhead without creating bottlenecks.[^1]

**2. RAG-First Architecture for Regulated Knowledge Work**
Rather than fine-tuning foundation models on proprietary data — which creates model-update complexity and potential data leakage risk — best-practice firms use Retrieval-Augmented Generation (RAG) pipelines grounded in curated internal knowledge bases (policies, product terms, regulatory texts). This approach preserves explainability, eases audit trails, and reduces hallucination rates in compliance-sensitive outputs.[^2]

**3. Human-in-the-Loop Escalation Design for High-Risk Decisions**
Institutions compliant with EU AI Act Article 14 requirements design agentic systems with mandatory human-review checkpoints for credit decisions, claims denials, and AML case escalations. Best-practice firms instrument these review points with AI-generated decision summaries, so human reviewers are augmented rather than simply rubber-stamping outputs, maintaining genuine oversight.[^5]

**4. Phased Agentic Rollout: Observe → Recommend → Act**
DBS Bank and ING have publicly described staged deployment models in which AI agents first operate in shadow mode (observe only), then move to recommendation mode (human approves every action), and finally to autonomous-act mode for low-risk, high-volume transactions after a defined confidence threshold is validated. This builds organisational trust and regulatory evidence simultaneously.[^12] _outcome figures unverified_

**5. Domain-Specific Fine-Tuning on Curated Proprietary Data**
Institutions with large proprietary datasets — transaction histories, underwriting records, client interaction logs — are creating competitive advantage by fine-tuning open-weight models (Llama 3, Mistral) on curated, de-identified corpora. Goldman Sachs and Morgan Stanley have each referenced internal LLM customisation as a source of edge in research and advisory quality. _outcome figures unverified_

**6. Arabic- and Multilingual-LLM Localisation for MENA Markets**
Emirates NBD and Al Rajhi Bank have partnered with regional AI providers and hyperscalers to develop or fine-tune Arabic-language models for conversational banking, recognising that off-the-shelf English-dominant LLMs have significantly degraded performance on Arabic financial terminology and Gulf Arabic dialects. _unsourced — verify or replace_

**7. AI-Native Compliance Monitoring (RegTech Agents)**
Tier-1 banks in the EU and UK are deploying autonomous compliance agents that continuously monitor transaction flows against regulatory rule engines, draft SAR narratives, and flag policy breaches in real time — collapsing cycles that previously took days to minutes while maintaining a complete audit log for supervisory review.[^10]

---

## 5. Public Case Studies

| # | Company | Geography | Programme | What They Built | Reported Outcome | Source |
|---|---|---|---|---|---|---|
| 1 | **JPMorgan Chase** | USA | **COiN / LLM Suite** | COiN (Contract Intelligence) uses machine learning to review commercial loan agreements; LLM Suite (launched 2024) is a ChatGPT-style internal platform deployed to ~50,000 employees for research, document drafting, and coding assistance. IndexGPT, a thematic index construction tool, received a trademark filing. | COiN reportedly reviewed 12,000 annual commercial credit agreements in seconds vs. 360,000 lawyer-hours previously (_outcome figure unverified_). LLM Suite user base figure publicly stated by JPMC executives. | JPMorgan annual reports; public executive statements 2023–2024 |
| 2 | **Morgan Stanley** | USA | **AI @ Morgan Stanley Assistant** | Deployed an OpenAI GPT-4-powered assistant to ~16,000 financial advisors, grounded via RAG on 100,000+ internal research and compliance documents, enabling advisors to surface insights and draft client communications instantly. | Morgan Stanley publicly stated 16,000 advisors onboarded; advisor time-saving metrics _outcome figure unverified_. | Morgan Stanley / OpenAI joint press release, 2023 |
| 3 | **Klarna** | Sweden/Global | **Klarna AI Customer Service Agent** | Deployed an Agentic AI assistant (powered by OpenAI) handling customer service conversations across 23 markets and 35 languages, performing refunds, dispute resolution, and account updates autonomously. | Klarna stated the agent handled the equivalent work of 700 full-time agents in its first month and was on track to improve profit by $40M in 2024. _outcome figure unverified — treat as company self-reported_. | Klarna press release, February 2024 |
| 4 | **DBS Bank** | Singapore | **AI-Augmented Banking (ALAN & others)** | DBS has deployed over 800 AI models in production across fraud detection, hyper-personalised nudges, treasury, and HR. ALAN (AI-powered treasury assistant) provides FX hedging recommendations. DBS publicly reports a formal "AI-to-value" measurement framework. | DBS reported S$370M in incremental income attributable to AI in 2023 (_outcome figure unverified — from DBS public investor communications_). | DBS Annual Report 2023; public management commentary |
| 5 | **Bradesco (Banco Bradesco)** | Brazil | **BIA (Bradesco Intelligent Assistant)** | BIA is a conversational AI assistant deployed across WhatsApp, app, and branch channels, handling account queries, card blocking, and product cross-sell in Brazilian Portuguese. Built in partnership with IBM Watson; now evolving toward LLM-based architecture. | BIA reportedly handles over 100 million interactions per year with customer satisfaction scores above traditional IVR (_outcome figure unverified_). | IBM / Bradesco public case study materials |

---

## 6. Key Metrics & Benchmarks

| Metric | Value | Notes | Source |
|---|---|---|---|
| % of financial services firms using GenAI in ≥1 function (2024) | **65%** | Global cross-industry; FS among top 3 sectors | McKinsey *State of AI 2024* [^1] |
| Global financial services AI spend (2024 est.) | **~$35B** | Includes first-party build, vendor licensing, cloud AI | IDC FutureScape 2025 [^3] |
| CAGR of AI spend in FS through 2028 | **>20%** | IDC forecast | IDC FutureScape 2025 [^3] |
| EU AI Act high-risk categories applicable to FS | **Credit scoring, insurance underwriting, AML** | Annex III classification | EU AI Act 2024 [^5] |
| Morgan Stanley advisor deployment size | **~16,000 advisors** | Publicly stated at launch | Morgan Stanley/OpenAI press release 2023 |
| Klarna AI agent equivalent headcount (self-reported) | **~700 FTE equivalent** | Company self-reported; _outcome figure unverified_ | Klarna press release Feb 2024 |
| DBS AI-attributable incremental income (2023) | **S$370M** | From investor communications; _outcome figure unverified_ | DBS Annual Report 2023 |
| Share of AI leaders citing talent as top barrier | **Majority** | Largest single barrier cited | Deloitte *State of GenAI in the Enterprise 2024* [^8] |
| Typical AI governance/integration share of total AI programme budget | **40–60%** | Integration of legacy data estates | _unsourced — verify or replace_ |
| Target AI customer-service deflection rate (industry aspiration) | **>70%** | Cited by multiple tier-1 bank transformation leads | _unsourced — verify or replace_ |

---

## 7. Implications for Maven's Positioning

- **Lead with governance and risk as a differentiator, not a constraint.** The single largest friction point delaying agentic AI deployment in financial services is not technology readiness but the absence of credible model governance, audit trails, and regulatory compliance architecture. Maven's positioning should foreground its ability to design agentic systems that are inherently auditable and EU AI Act-ready, converting a compliance burden into a competitive proof point for clients.

- **The "observe → recommend → act" maturity arc is a repeatable engagement model.** The staged agentic deployment pattern adopted by DBS and ING maps naturally to a phased consulting and implementation engagement: assessment and shadow-mode deployment (Phase 1), recommendation-layer integration with MRM documentation (Phase 2), and autonomous operation with continuous monitoring (Phase 3). Maven should productise this arc as a named methodology with clear deliverables and risk gates at each stage.

- **MENA represents an underserved, high-urgency market segment.** Saudi Vision 2030 and UAE AI Strategy 2031 are creating significant budget availability for AI transformation in regional banks that lack the internal engineering capability of JPMorgan or DBS. Maven's ability to combine global best-practice pattern transfer with Arabic-language LLM localisation expertise would be a differentiated proposition in a market where most global consultancies are still building regional AI practices.

- **Multi-agent orchestration is the next frontier engagement — position now.** The majority of financial services AI engagements today remain single-model or single-agent. As clients mature, they will need architectural guidance on multi-agent orchestration (tool selection, inter-agent communication protocols, failure modes, and systemic risk controls). Maven should develop a point of view on financial-services-specific multi-agent architecture now, before demand peaks in 2026–2027.

- **Change management and AI fluency programmes are frequently the critical path.** Technical delivery rarely fails; adoption does. Maven should build a standardised AI fluency and change enablement offering for financial services middle management — particularly risk officers, compliance leads, and branch/relationship managers — to complement technical delivery and reduce the most common programme failure mode.

---

## Sources

[^1]: McKinsey & Company, *"The State of AI 2024"*, McKinsey Global Institute, May 2024. https://www.mckinsey.com

[^2]: Gartner, *"Hype Cycle for Artificial Intelligence, 2024"*, Gartner Research, July 2024. https://www.gartner.com

[^3]: IDC, *"IDC FutureScape: Worldwide Artificial Intelligence and Automation 2025 Predictions"*, IDC, October 2024. https://www.idc.com

[^4]: Accenture, *"Technology Vision 2025"*, Accenture, 2025. https://www.accenture.com

[^5]: European Parliament and Council of the EU, *"Regulation (EU) 2024/1689 — Artificial Intelligence Act"*, Official Journal of the European Union, August 2024. https://eur-lex.europa.eu

[^6]: UAE Government, *"UAE National AI Strategy 2031"*, UAE Office of AI, 2023. https://ai.gov.ae

[^7]: Office of the Comptroller of the Currency (OCC) / Federal Reserve, *"Supervisory Guidance on Model Risk Management (SR 11-7)"*, Board of Governors of the Federal Reserve System / OCC, April 2011 (referenced in subsequent AI-specific guidance). https://www.occ.gov

[^8]: Deloitte, *"State of Generative AI in the Enterprise — Now Decides Next"*, Deloitte Insights, 2024. https://www.deloitte.com

[^9]: Financial Stability Board (FSB), *"Artificial Intelligence and Machine Learning in Financial Services"*, FSB, November 2017; updated supervisory letters 2023–2024. https://www.fsb.org

[^10]: Financial Conduct Authority (FCA), *"Artificial Intelligence and Machine Learning — Discussion Paper DP5/22"*, FCA, October 2022. https://www.fca.org.uk

[^11]: BCG, *"Global Wealth Report 2024"*, Boston Consulting Group, 2024. https://www.bcg.com

[^12]: DBS Group Holdings, *"DBS Annual Report 2023"*, DBS, April 2024. https://www.dbs.com