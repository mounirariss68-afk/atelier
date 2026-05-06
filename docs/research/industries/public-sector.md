# Public Sector — AI & Agentic Transformation Dossier
_Last updated: 2026-05. Owner: Maven Research. Status: draft for Parts 2–4._

---

## 1. Global AI & Agentic Transformation Trends (2024–2026)

- **Agentic AI is entering government service delivery.** The shift from assistive copilots to autonomous agents capable of end-to-end task completion — permit processing, benefits determination, fraud detection — is the defining 2025–2026 architectural shift. Gartner positions agentic AI as the top strategic technology trend for 2025, projecting that by 2028 at least 15% of day-to-day government decisions will be made autonomously by AI agents with minimal human review.[^1]

- **Sovereign AI infrastructure is a geopolitical priority.** Governments across the GCC, EU, and Southeast Asia are investing directly in national AI compute, foundation-model capacity, and data-center sovereignty rather than relying solely on hyperscaler clouds. The ITU's *Measuring the Information Society Report* and OECD *AI Policy Observatory* track over 60 national AI strategies now operational or in advanced development.[^2]

- **Generative AI adoption in government is accelerating but uneven.** Deloitte's *State of Generative AI in the Enterprise* (2024) found that public-sector organizations trail financial services and technology by 12–18 months in GenAI production deployment, primarily due to procurement cycles and risk aversion, yet planned budget increases are proportionally higher for 2025–2026.[^3]

- **US Executive Orders are reshaping federal AI governance.** EO 14110 (2023) mandated agency-level AI risk assessments, and subsequent OMB Memoranda (M-24-10, M-24-18) required civilian agencies to appoint Chief AI Officers and publish annual AI use-case inventories, creating a compliance-driven acceleration of structured AI adoption.[^4]

- **The EU AI Act (fully applicable August 2026) classifies most citizen-facing government AI as high-risk.** Biometric identification, benefits-eligibility systems, and law-enforcement tools fall under Title III mandatory conformity assessments, human oversight, and transparency obligations — setting a global regulatory benchmark that GCC states are monitoring for alignment.[^5]

- **UK Civil Service AI Playbook (2024) operationalizes responsible adoption.** The Cabinet Office's *AI Playbook for the Civil Service* provides tiered guidance on acceptable use, procurement, and red-teaming of LLMs in government, serving as a practitioner reference model increasingly cited by Commonwealth and MENA peers.[^6]

- **GCC Vision programs are coupling AI with national transformation mandates.** Saudi Arabia's Vision 2030 embeds AI across NEOM, the National Data Management Office (NDMO) framework, and the Saudi Data and AI Authority (SDAIA) strategy. The UAE National AI Strategy 2031 targets first-mover advantage in 13 priority sectors, with government services explicitly listed.[^7]

---

## 2. Top Challenges

- **EU AI Act & high-risk classification compliance burden.** Government agencies operating in or supplying to the EU must build conformity-assessment documentation, maintain technical logs, and implement human-oversight mechanisms for all Annex III use cases. Legal experts estimate compliance costs for a mid-size public-sector deployer at €500K–€2M per high-risk system (_unsourced — verify or replace_), with SME GovTech vendors disproportionately affected.[^5]

- **Data sovereignty and cross-border data flows.** GDPR Article 46 and national data-localisation mandates (Saudi PDPL, UAE PDPL) fragment the training and inference infrastructure for government AI. Public agencies cannot simply leverage global SaaS AI platforms without data-processing agreements, residency guarantees, and audit rights — creating vendor selection complexity.[^8]

- **Legacy technology debt.** McKinsey's *The State of AI* (2024) identifies legacy IT as the single largest barrier to scaling AI in large organizations; in government, core systems (tax ledgers, social-benefit registries, land records) are frequently 20–40 years old and lack APIs necessary for agent orchestration.[^9]

- **AI talent scarcity in the public sector.** OECD's *Government at a Glance* (2023) notes that public-sector wage structures and career pathways struggle to attract ML engineers and data scientists in competition with technology firms, creating persistent skills gaps. The WEF *Future of Jobs Report* (2025) projects a net shortfall of over 1 million AI-specialist roles in government and regulated industries globally by 2030.[^10]

- **Agent governance and accountability gaps.** Multi-agent systems that traverse departmental boundaries raise unresolved questions about decision ownership, audit trails, and redress. The OECD *AI Principles* (updated 2024) require accountability to remain with identifiable human actors, yet current agentic architectures often distribute decisions across orchestration layers in ways that obscure responsibility.[^11]

- **Model risk and hallucination in high-stakes contexts.** Citizen-facing chatbots and automated adjudication systems that surface incorrect legal entitlements or tax calculations carry reputational and legal liability. The FSB's *AI in Financial Stability* work and NIST AI RMF (1.0) both highlight the need for output validation pipelines — discipline largely absent from early government deployments.[^12]

- **Procurement and change management inertia.** Public procurement frameworks designed for traditional software contracts are poorly matched to AI-as-a-service or outcome-based AI models. Accenture's *Technology Vision* (2024) flags that 62% of public-sector executives cite internal process resistance as a bigger barrier to AI adoption than technology limitations.[^13]

- **Algorithmic bias and equitable service delivery.** Automated social-benefit scoring, predictive policing, and job-matching tools have drawn legal challenges across the EU, US, and Australia for proxy discrimination. The EU AI Act's non-discrimination requirements and GDPR Article 22 restrictions on solely automated decisions make bias auditing a legal, not merely ethical, obligation.[^5]

---

## 3. Top Strategic Priorities (2025–2026)

- **Citizen-service transformation via conversational and agentic AI.** Budget allocations for intelligent virtual agents handling front-office enquiries (tax filing, permit renewal, social-benefit status) are the highest-ranked AI investment category in IDC's *FutureScape: Worldwide Government 2025 Predictions*, with governments targeting measurable reduction in call-centre volumes and case-processing times.[^14]

- **National AI compute and sovereign cloud.** Saudi Arabia's Public Investment Fund, the UAE's G42, and the European Commission's *EuroHPC Joint Undertaking* are each funding sovereign supercomputing capacity. SDAIA's *National Strategy for Data and AI* targets deployment of dedicated government AI infrastructure as a cornerstone of digital sovereignty.[^7]

- **Fraud detection, tax-gap reduction, and audit automation.** Revenue authorities globally are prioritizing AI-powered risk-scoring to close tax gaps. The OECD *Tax Administration* series (2024) documents pilots across 40 tax administrations, with AI-assisted audit selection cited as the fastest-scaling use case.[^15]

- **Defence and national security AI.** NATO's AI strategy and the US DoD's *Responsible AI Strategy* (2022, updated 2024) commit to accelerating AI adoption in ISR (intelligence, surveillance, reconnaissance), logistics, and cyber-defence, with partner nations in the GCC aligning bilateral frameworks.[^16]

- **Workforce reskilling and AI literacy programmes.** The UK's Government Digital Service and Singapore's IMDA–Smart Nation initiative both run structured AI-upskilling programmes for civil servants. WEF and OECD recommend that 30–40% of AI transformation budgets be dedicated to capability building.[^10]

- **Interoperability and data-sharing platforms.** Cross-agency data ecosystems (e.g., the EU's *Data Governance Act* data spaces, Saudi Arabia's NDMO unified data exchange) are prerequisite infrastructure for multi-agent government workflows, and are receiving dedicated capital allocations in 2025–2026 national budgets (_unsourced — verify or replace_).

---

## 4. Best-Practice Patterns for AI/Agentic Adoption

**1. Tiered Risk-Based AI Governance Frameworks**
Align internal AI use-case classification to external regulatory tiers (EU AI Act Annex III, NIST AI RMF impact levels). Singapore's government mandates a Model AI Governance Framework review for each deployment before production release. This prevents reactive remediation and creates an auditable paper trail that satisfies both parliamentary oversight and international standards.[^17]

**2. Human-in-the-Loop Adjudication Gates**
For high-stakes decisions (benefit denial, tax penalty, asylum determination), best-practice architectures retain a mandatory human review step before the agent's recommendation is actioned. The OECD AI Principles and EU AI Act Article 14 both require "meaningful human oversight" for Annex III systems, and several Nordic governments have institutionalised this as a default architectural constraint.[^5][^11]

**3. Federated Data Enclaves for Cross-Agency AI**
Rather than centralising sensitive citizen data into a single AI lake, leading GovTech implementations use privacy-enhancing technologies (PETs) — federated learning, secure multi-party computation — to allow model training across ministry silos without raw data movement. The UK's Office for National Statistics has published research on PET applications for government data.[^6]

**4. Digital-Twin Government Simulation for Policy Testing**
Advanced public-sector AI programs use simulation environments to model the downstream impact of policy changes (tax-rate adjustments, benefit eligibility rule changes) before live deployment. The UAE's Office of AI and several EU member states are investing in policy simulation platforms as a form of pre-deployment impact testing (_unsourced — verify or replace_).

**5. GovTech Sandboxes and Regulatory Experimentation Frameworks**
Singapore's GovTech agency and the UK's CDDO have established controlled sandbox environments where AI vendors and civil servants co-develop and test solutions against live (anonymised) data before full procurement. This compresses the traditional 18–36 month procurement-to-production cycle.[^6][^17]

**6. Agentic Process Automation for Back-Office Operations**
Tax authorities and social-services agencies are deploying orchestrated agent pipelines — combining document ingestion, entity extraction, rule-application, and case-management update — to automate end-to-end processing of routine cases. The pattern reduces per-case handling cost and liberates case-worker capacity for complex adjudication.[^14]

**7. Multilingual and Low-Literacy-Adapted Citizen Interfaces**
In linguistically diverse contexts (GCC, MENA, South/Southeast Asia), citizen-facing AI must handle Arabic dialects, code-switching, and low digital-literacy interaction patterns. Best-practice deployments use fine-tuned Arabic LLMs or hybrid retrieval architectures and include voice-first interfaces for populations with limited text literacy (_unsourced — verify or replace_).

---

## 5. Public Case Studies

| # | Company / Agency | Geography | Programme | What Was Built | Reported Outcome | Source |
|---|---|---|---|---|---|---|
| 1 | **SDAIA / Absher Platform** | Saudi Arabia | Absher AI Enhancement | AI-powered citizen service layer on the Absher e-government portal integrating identity, permit, and government-service requests with NLP query handling in Arabic | Absher exceeded 30M registered users; AI-layer query deflection rates _outcome figure unverified_ | SDAIA annual reports; Saudi Vision 2030 progress reports [^7] |
| 2 | **UAE Federal Authority for Identity (ICA)** | UAE | Smart Gates & AI Border Management | Biometric AI (facial recognition + document verification) deployed at all major UAE ports of entry, integrated with national identity database | Processing time per traveller reduced significantly; _outcome figure unverified_ | UAE National AI Strategy 2031 publications; ICA press releases [^7] |
| 3 | **HM Revenue & Customs (HMRC)** | United Kingdom | Connect Analytics Platform | AI-driven data-matching system ingesting third-party financial data to identify tax-gap risks and select audit targets; operational since mid-2010s, continuously enhanced with ML | HMRC attributes billions in additional revenue yield to risk-analytics; _outcome figure unverified_ | HMRC Annual Report and Accounts; OECD Tax Administration 2024 [^15] |
| 4 | **Singapore Government Technology Agency (GovTech)** | Singapore | Pair (formerly Ask Jamie) / Launchpad LLM | Whole-of-government LLM platform ("Pair") providing civil servants with a secured, policy-compliant GenAI workspace; citizen chatbot (Ask Jamie) upgraded to LLM backend | Thousands of civil servants onboarded; _outcome figure unverified_ | Singapore Smart Nation & Digital Government Office reports; GovTech blog [^17] |
| 5 | **Turkish Revenue Administration (GİB)** | Turkey | e-Fatura AI Risk Scoring | ML-based invoice-anomaly and VAT-fraud detection system integrated into Turkey's mandatory e-invoicing infrastructure, processing hundreds of millions of invoices annually | Measurable improvement in VAT compliance gap; _outcome figure unverified_ | OECD Tax Administration 2024; GİB annual reports [^15] |

---

## 6. Key Metrics & Benchmarks

| Metric | Value | Note | Source |
|---|---|---|---|
| Share of governments with a formal national AI strategy | >60 countries | As of 2024 | OECD AI Policy Observatory [^2] |
| Projected government AI market size (global) by 2030 | >USD 50B | CAGR ~25% | _unsourced — verify or replace_ |
| % of public-sector executives citing internal resistance as top AI barrier | 62% | 2024 survey | Accenture Technology Vision 2024 [^13] |
| Gartner projection: % of government decisions made by AI agents by 2028 | 15% | High-autonomy decisions | Gartner Top Strategic Tech Trends 2025 [^1] |
| Average government AI project time-to-production vs. private sector | +12–18 months lag | Deployment cycle | Deloitte State of GenAI in the Enterprise 2024 [^3] |
| EU AI Act Annex III high-risk categories directly applicable to government | 8 of 8 | All Annex III categories touch public-sector use cases | EU AI Act, Official Journal of the EU [^5] |
| OECD tax administrations running AI-assisted audit selection | ~40 of 58 surveyed | 2024 data | OECD Tax Administration 2024 [^15] |
| UAE National AI Strategy 2031 target: AI contribution to GDP | AED 335B (~USD 96B) by 2031 | National target | UAE National AI Strategy 2031 [^7] |
| WEF projected AI-specialist shortfall in government & regulated sectors by 2030 | >1 million roles | Net gap | WEF Future of Jobs Report 2025 [^10] |

---

## 7. Implications for Maven's Positioning

- **The GCC sovereign-AI build-out is Maven's primary demand driver for 2025–2027.** Saudi Arabia's SDAIA, NEOM, and sectoral authorities (Zakat Tax Authority, Ministry of Health) are simultaneously investing in AI talent, platforms, and advisory — precisely the intersection of capability-building and agentic transformation where Maven can differentiate. Maven should formalise a Saudi public-sector practice with bilingual (Arabic/English) delivery capacity and NDMO-aligned data governance methodology.

- **Turkey's GİB and public digital-transformation agenda represent an underserved mid-market.** Turkey's e-government infrastructure (e-Fatura, MERNİS, SGK) is technically sophisticated but analytically underdeveloped. Maven's positioning as a regionally grounded, non-hyperscaler partner with GCC references could be a credible wedge in Turkish public-sector AI advisory, particularly in tax analytics, fraud detection, and workforce AI literacy.

- **EU AI Act compliance will become a GCC export requirement.** As GCC sovereign funds and technology exports target European markets, the Act's conformity requirements will flow upstream into GCC government AI systems. Maven should develop an EU AI Act readiness framework adapted for MENA-context deployments — a defensible IP asset that neither local system integrators nor global consultancies have tailored to this geography.

- **Agentic AI governance is the white space.** Most GovTech vendors and consulting firms are still selling copilot and automation tooling. The design of multi-agent orchestration architectures with auditable decision trails, human-override gates, and Arabic-language reasoning layers is genuinely scarce capability. Maven should invest now in reusable agentic government blueprints before larger system integrators productise this layer.

- **Outcome-based contracting is the unlock for public-sector deal velocity.** Government procurement favors T&M or fixed-price contracts; AI transformation value is realized over 18–36 months. Maven can differentiate by structuring shared-value agreements tied to measurable KPIs (tax-gap yield, citizen-query deflection, processing-time reduction), de-risking AI investment for ministerial sponsors and accelerating procurement approval.

---

## Sources

[^1]: Gartner, "Top Strategic Technology Trends for 2025," Gartner Research, October 2024. https://www.gartner.com

[^2]: OECD, "OECD AI Policy Observatory — National AI Strategies Tracker," OECD, 2024. https://oecd.ai

[^3]: Deloitte, "State of Generative AI in the Enterprise," Deloitte Insights, 2024. https://www2.deloitte.com

[^4]: Office of Management and Budget, "Memoranda M-24-10 and M-24-18: Advancing Governance, Innovation, and Risk Management for Agency Use of Artificial Intelligence," OMB / Executive Office of the President, 2024. https://www.whitehouse.gov/omb

[^5]: European Parliament and Council of the EU, "Regulation (EU) 2024/1689 — Artificial Intelligence Act," Official Journal of the European Union, 12 July 2024. https://eur-lex.europa.eu

[^6]: Cabinet Office / Central Digital and Data Office, "AI Playbook for the Civil Service," UK Government, 2024. https://www.gov.uk/government/publications

[^7]: Saudi Data and AI Authority (SDAIA), "National Strategy for Data and AI"; UAE Office of AI, "UAE National AI Strategy 2031," 2024. https://sdaia.gov.sa ; https://ai.gov.ae

[^8]: Saudi Authority for Data and Artificial Intelligence (SDAIA), "Personal Data Protection Law (PDPL) Implementation Regulations," 2023; UAE Federal Decree-Law No. 45 of 2021 on Personal Data Protection. https://sdaia.gov.sa

[^9]: McKinsey & Company, "The State of AI in 2024," McKinsey Global Institute, May 2024. https://www.mckinsey.com

[^10]: World Economic Forum, "Future of Jobs Report 2025," WEF, January 2025. https://www.weforum.org ; OECD, "Government at a Glance 2023," OECD Publishing, 2023. https://www.oecd.org

[^11]: OECD, "Recommendation of the Council on Artificial Intelligence (OECD AI Principles), updated 2024," OECD Legal Instruments. https://legalinstruments.oecd.org

[^12]: Financial Stability Board, "Artificial Intelligence and Machine Learning in Financial Services," FSB, 2024. https://www.fsb.org ; NIST, "AI Risk Management Framework (AI RMF 1.0)," National Institute of Standards and Technology, January 2023. https://www.nist.gov/ai

[^13]: Accenture, "Technology Vision 2024," Accenture, 2024. https://www.accenture.com/technologyvision

[^14]: IDC, "FutureScape: Worldwide Government 2025 Predictions," IDC, October 2024. https://www.idc.com

[^15]: OECD, "Tax Administration 2024: Comparative Information on OECD and other Advanced and Emerging Economies," OECD Publishing, 2024. https://www.oecd.org/tax/forum-on-tax-administration

[^16]: US Department of Defense, "Responsible Artificial Intelligence Strategy and Implementation Pathway," DoD, updated 2024. https://www.ai.mil ; NATO, "NATO Principles of Responsible Use of AI in Defence," 2021 (reaffirmed 2024). https://www.nato.int

[^17]: Singapore Government Technology Agency (GovTech) / Smart Nation and Digital Government Office, "Singapore Government AI Strategy and Pair Platform," 2024. https://www.tech.gov.sg ; https://www.smartnation.gov.sg