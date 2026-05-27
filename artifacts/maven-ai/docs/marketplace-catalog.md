# Cognirise Marketplace — Demo Catalog

_Internal research brief that defines the demo taxonomy and the set of tools the public Marketplace exposes._

## Why a marketplace

The Marketplace is the part of the Cognirise website that lets buyers _click into a working agent_, not just read a deck. It exists because:

- **MIT NANDA finds 95% of enterprise GenAI pilots deliver no measurable P&L impact.** The buyer's question is no longer "can this work?" but "show me what _good_ looks like." The Marketplace is our answer.
- Each tool is positioned around a **named buyer** (CFO, CIO, COO, CDO, Head of Programmes, Head of Supply Chain) and a **realised value claim** they can verify in the demo itself.
- The flagship — the **Value Realization Tool** — is fully interactive. It is the demo a CFO can take home, edit, and print without leaving the browser.

## Class taxonomy (8 classes)

| # | Class | Buyer | What it owns | Reusable IP |
|---|---|---|---|---|
| 1 | **Value Realization** | CFO, COO | Tracking realised vs expected $ impact across an AI portfolio | UVR scoring engine, leakage detection rules |
| 2 | **PMO / Delivery Copilot** | Head of EPMO / Programme | Programme health, RAID surfacing, status drafting | Programme ontology, RAID classifier, ETC re-baseline |
| 3 | **Supply Chain Agent** | CSCO, Head of Procurement | Demand sensing, supplier risk, expediting | Multi-tier supplier graph, FX-adjusted landed cost |
| 4 | **FP&A Forecaster** | CFO, Head of FP&A | Rolling forecast, variance commentary, scenario flexing | Driver-tree library, MD&A draft generator |
| 5 | **Customer Ops Agent** | CXO, Head of Care | Multi-channel care with cost-to-serve telemetry | Bilingual EN/AR intent router, deflection scoring |
| 6 | **Knowledge & Decision Copilot** | CIO, CDO | Grounded internal Q&A with citation trails | Document semantic graph, citation enforcer |
| 7 | **Risk & Compliance Agent** | CRO, CCO | SAMA / PDPL / AI Charter monitoring with audit packs | Regulator rule library, evidence-pack generator |
| 8 | **Sovereign Data Workbench** | CDO, National CTO | Air-gapped data engineering, lineage, mastering | On-prem agent runtime, Arabic NER, lineage compiler |

## The 14 specific demos

For each demo: `slug` · class · industries · horizontals · buyer · status · the value claim it proves.

### 1. Value Realization Tool — `value-realization` ⭐ FLAGSHIP
- **Class:** Value Realization · **Buyer:** CFO, COO · **Status:** `live`
- **Industries:** all · **Horizontals:** PMO, FP&A
- Portfolio dashboard for an AI initiative book of work. Shows realised vs expected value, value-at-risk, ROI gauge, time-to-value, and a leakage callout that explains _which_ initiatives are bleeding value and why.
- Editable in the browser — every initiative card opens a drawer with sliders for expected $, realised $, confidence, status, and risk drivers. Charts re-render live.
- "Reset to sample" restores the canonical Cognirise demo book of work. "Print summary" opens a print-styled CFO-ready one-pager.

### 2. Programme Health Copilot — `programme-health-copilot`
- **Class:** PMO / Delivery Copilot · **Buyer:** Head of EPMO · **Status:** `coming-soon`
- **Horizontals:** PMO
- Auto-RAG over Jira, MS Project, Confluence, e-mail. Drafts the weekly steering pack: status, RAID delta, forecast cone, ask. The buyer keeps the pen — the agent loads the gun.

### 3. Sovereign Citizen Services Agent — `citizen-services-agent`
- **Class:** Customer Ops Agent · **Buyer:** Director General · **Status:** `coming-soon`
- **Industries:** Public Sector
- Bilingual EN/AR multi-turn agent for ministry call centres and chat. Routed inside an air-gapped enclave. Hands off to humans with full context and provenance.

### 4. Procurement Intelligence Agent — `procurement-intelligence`
- **Class:** Supply Chain Agent · **Buyer:** Chief Procurement Officer · **Status:** `coming-soon`
- **Industries:** Public Sector, Energy & Commodities · **Horizontals:** Supply Chain
- Spend taxonomy, supplier-risk scoring, contract-cycle compression. Maps Etimad / SAP Ariba data, surfaces savings, drafts negotiation talking points.

### 5. Telecom Network Ops Agent — `network-ops-agent`
- **Class:** Knowledge & Decision Copilot · **Buyer:** CTO Networks · **Status:** `coming-soon`
- **Industries:** Telecom
- Reads OSS/BSS alarms, customer-care escalations, change-management tickets. Recommends triage actions with confidence + evidence. NOC dashboards at the speed of conversation.

### 6. SAMA Compliance Agent — `sama-compliance-agent`
- **Class:** Risk & Compliance Agent · **Buyer:** Chief Risk Officer · **Status:** `coming-soon`
- **Industries:** Financial Services
- Continuous-monitoring agent over policy, change, and operational telemetry. Generates SAMA inspection-ready evidence packs. Bilingual narrative in Arabic + English.

### 7. Energy Trading Copilot — `energy-trading-copilot`
- **Class:** Knowledge & Decision Copilot · **Buyer:** Head of Trading · **Status:** `coming-soon`
- **Industries:** Energy & Commodities
- Reads price feeds, weather, vessel positions, and OPEC commentary. Surfaces trade ideas with risk-band rationale. Human-in-the-loop only — the agent never executes.

### 8. Retail Demand Forecaster — `retail-demand-forecaster`
- **Class:** Supply Chain Agent · **Buyer:** Head of Merchandising · **Status:** `coming-soon`
- **Industries:** Retail & Consumer · **Horizontals:** Supply Chain
- SKU-store-week forecast tuned for GCC seasonality (Ramadan, school-return, summer-exodus). Drives allocation, replenishment, and promo planning.

### 9. Hospitality Revenue Optimizer — `hospitality-revenue-optimizer`
- **Class:** FP&A Forecaster · **Buyer:** Chief Commercial Officer · **Status:** `coming-soon`
- **Industries:** Travel & Hospitality · **Horizontals:** FP&A
- Property-level rate, length-of-stay, and channel-mix optimisation. Includes event-overlay (Riyadh Season, F1, Hajj cohorts) for demand shaping.

### 10. EV Battery Health Agent — `ev-battery-health-agent`
- **Class:** Knowledge & Decision Copilot · **Buyer:** Head of Aftermarket · **Status:** `coming-soon`
- **Industries:** Automotive
- Connected-vehicle telemetry → battery state-of-health prediction → proactive service outreach. Designed for the multi-brand dealer network reality of GCC automotive groups.

### 11. FP&A Rolling Forecast Agent — `fpa-rolling-forecast`
- **Class:** FP&A Forecaster · **Buyer:** CFO · **Status:** `coming-soon`
- **Horizontals:** FP&A
- Driver-based rolling forecast. Ingests actuals, regenerates the forecast cone, drafts the variance commentary, flags the three things the CFO needs to take to the board.

### 12. Customer Care Multi-Agent — `customer-care-multi-agent`
- **Class:** Customer Ops Agent · **Buyer:** Head of Customer Care · **Status:** `coming-soon`
- **Industries:** Telecom, Retail & Consumer
- Bilingual EN/AR intent classifier → resolution agent → quality-assurance agent. Cost-per-contact and CSAT telemetry per channel.

### 13. Sovereign Data Workbench — `sovereign-data-workbench`
- **Class:** Sovereign Data Workbench · **Buyer:** Chief Data Officer · **Status:** `coming-soon`
- **Industries:** Public Sector
- Air-gapped agentic data engineering. Drafts pipelines, runs lineage, and scaffolds quality contracts inside the customer's perimeter. Built for sovereign-cloud and on-prem.

### 14. Knowledge Memory Agent — `knowledge-memory-agent`
- **Class:** Knowledge & Decision Copilot · **Buyer:** CIO · **Status:** `coming-soon`
- Cross-industry: ingests SharePoint, Confluence, Notion, e-mail. Returns answers with citation trails the audit team can defend. The "memory of the firm".

## Tool detail-page anatomy

Every Marketplace tool has the same detail-page shape so the buyer can compare apples to apples:

1. **Header** — title, class chip, industry chips, horizontal chips, status badge, primary CTA (open the live demo or "Talk to a partner about this tool").
2. **The pitch** — one paragraph, named buyer, the realised value claim.
3. **Long description** — three paragraphs: what it owns, how it works, what makes it credible.
4. **Demo screens** — 3–5 captioned screen descriptions. For `coming-soon` tools the captions describe the screen narratively (no fabricated screenshots).
5. **Data model** — bullet list of the inputs, internal stores, and outputs. Buyers ask this question first; we answer it on the page.
6. **Cross-links** — back to Marketplace, to the related Service, to the diagnostic that scores readiness.

## Filter axes on the index

- **Class** — the eight classes above.
- **Industry** — the seven Cognirise industries (Public Sector, Telecom, Financial Services, Energy & Commodities, Retail & Consumer, Travel & Hospitality, Automotive).
- **Horizontal** — PMO, Supply Chain, FP&A.

The index supports query-string deep-linking so the Industry pages can link in: e.g. `/marketplace?industry=telecom`.

## Bilingual and RTL

- Tool titles and pitches are bilingual EN/AR via `useLang` + `tStr`.
- Filter chip labels and section headers are translated.
- The Value Realization tool's chart axes flip to RTL when `dir === "rtl"`. Chart number formatting uses `Intl.NumberFormat` with locale `en` / `ar-AE`.
- Long-form catalog narrative (this document) and the longer demo descriptions stay English-only by design — the rest of the marketing site follows the same convention.

## Out of scope (intentionally)

- AI-illustrated cover art for every tool (Task #3 territory).
- Backend persistence for Value Realization Tool edits — state is local to the browser session, with "Reset to sample" as the recovery path.
- AR translation of the long-form research catalog.
