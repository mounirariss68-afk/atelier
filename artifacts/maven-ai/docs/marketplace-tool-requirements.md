# Marketplace Tool Requirements (Task #24)

This document is the per-tool research spec for every Cognirise marketplace
tool. Each section names market analogs the buyer is likely to know,
states the gap in the previous Cognirise implementation, gives a feasibility
verdict for the agentic rebuild, and lists the acceptance criteria the
demo must satisfy. The flagship Value Realization Tracker (VRT) sets
the bar; every other tool meets the same shape.

## Global contract (all tools)

Every demo must:

1. Render a hands-on interactive surface (sliders, toggles, dropdowns,
   click targets) that drives derived metrics, charts, callouts and
   draft artefacts (memos, work orders, packs) in real time.
2. Carry a named cast of 3–6 agents and at least one human checkpoint
   in `lib/maven-content/src/agentCasts.ts`. Edges and `flowOrder`
   reference real agent / checkpoint ids.
3. Expose a "How does this work?" button that opens `AgentExplainer`,
   which renders an inline SVG topology diagram (RTL-aware), a
   step-by-step handoff list with labels, the human checkpoints and a
   short rationale.
4. Render `AgentTrace` below the interactive surface. The trace shows
   numbered reasoning steps, each labelled with the specific agent
   doing the work, regenerated against the current state.
5. Bilingual EN/AR with full RTL, browser-local state, a Reset
   control. No new dependencies, inline SVG only, illustrative sample
   data only.
6. The chat assistant's system prompt references the agents and human
   checkpoints for every tool.

Validation in `artifacts/maven-ai/src/data/content.ts` enforces:
forward parity (every tool slug has a cast), reverse parity (every
cast slug resolves to a tool), live-tool parity (every live slug is
mounted in `MarketplaceDetail.tsx`), and edge / flow-order id integrity.

---

## 1. Value Realization Tracker — `value-realization` (flagship)

- **Buyer:** CFO / Transformation lead.
- **Market analogs:** Workday Adaptive Planning, Anaplan value tracking,
  Apptio TBM value-realisation modules, BCG Klaviyo's UVR boards,
  bespoke McKinsey value-tracking spreadsheets.
- **Previous gap:** UI was static — no editable initiatives, no "value
  at risk" callout, no agentic explanation of who is generating each
  number.
- **Feasibility:** High. Already shipped end-to-end as the flagship.
- **Cast:** portfolio-watcher → uvr-scorer → leakage-detective →
  cfo-narrator. **Human checkpoint:** CFO sign-off.
- **Acceptance criteria:**
  1. Add / edit / remove initiatives updates totals, gauge, ROI, leakage.
  2. Time-series re-renders on every edit.
  3. Status pill cycles idea → pilot → scaling → in-production.
  4. Value-at-risk excludes in-production initiatives.
  5. Print view hides controls and renders a clean CFO one-pager.
  6. AgentTrace names all four agents and reflects current totals.
  7. AgentExplainer modal opens, renders SVG diagram and handoffs.
  8. Bilingual EN/AR, RTL clean.

## 2. Programme Health Copilot — `programme-health-copilot`

- **Buyer:** PMO lead / CIO running a multi-workstream programme.
- **Market analogs:** Clarity PPM, Planview, Smartsheet programme
  reporting, ServiceNow SPM, BCG steering-pack templates.
- **Previous gap:** Text-only summary — no per-workstream RAG toggling,
  no recompiled steering pack, no "top three asks".
- **Feasibility:** High. State machine fits cleanly in browser memory.
- **Cast:** programme-watcher → raid-classifier → etc-recompiler →
  steering-drafter → ask-extractor. **Human:** PMO lead signs the pack.
- **Acceptance criteria:**
  1. Cycling a workstream RAG re-renders programme overall RAG.
  2. RAID delta totals re-aggregate.
  3. ETC drift sums and re-displays in weeks.
  4. Top three asks re-rank by severity / drift.
  5. Reset reloads the canonical Monday draft.
  6. AgentTrace names all five agents and reflects state.
  7. Bilingual EN/AR, RTL clean.

## 3. Citizen Services Agent — `citizen-services-agent`

- **Buyer:** Government CX / digital-services head.
- **Market analogs:** ServiceNow Now Assist, Salesforce Einstein
  Government Cloud, Microsoft Copilot for Service, Cognigy.
- **Previous gap:** No bilingual / dialect handling visible, no
  confidence threshold escalation, no audit packet.
- **Feasibility:** High. Confidence-thresholded routing and audit
  bundling are well-trodden in CX.
- **Cast:** dialect-tagger → policy-retriever → response-drafter →
  confidence-scorer → audit-packetizer. **Human:** Supervisor takes
  over when confidence < 75%.
- **Acceptance criteria:**
  1. Editing dialect or confidence updates per-scenario routing.
  2. Escalate toggle reflects in summary counts.
  3. Audit packet card re-renders with scenario count.
  4. AgentTrace cites the average confidence and escalation count.
  5. Bilingual EN/AR, RTL clean.

## 4. Procurement Intelligence — `procurement-intelligence`

- **Buyer:** CPO / procurement transformation lead.
- **Market analogs:** Coupa Spend Guard, GEP SMART, SAP Ariba category
  intelligence, Bain procurement diagnostic.
- **Previous gap:** No editable category mix, no supplier-risk view,
  no negotiation pre-read.
- **Feasibility:** High. Spend / saving math is deterministic.
- **Cast:** spend-normaliser → savings-modeller → supplier-risk-analyst
  → negotiation-drafter. **Humans:** CPO approves savings; Legal
  clears pre-read.
- **Acceptance criteria:**
  1. Editing category spend updates total, saving %, and saving AED.
  2. Supplier picker switches the negotiation pre-read.
  3. Risk analyst flags suppliers below threshold.
  4. AgentTrace names AED spend, saving %, and supplier picked.
  5. Bilingual EN/AR, RTL clean.

## 5. Network Ops Agent — `network-ops-agent`

- **Buyer:** Telco NOC director / regulator-liaison head.
- **Market analogs:** ServiceNow ITOM AIOps, BMC Helix Operations,
  Moogsoft, Cisco Crosswork, Nokia AVA.
- **Previous gap:** No incident table, no regulator-notification
  threshold, no acknowledgement state.
- **Feasibility:** High. Severity / impact ranking is straightforward.
- **Cast:** alarm-collector → customer-impact-scorer → change-correlator
  → triage-recommender → regulator-flagger. **Humans:** NOC engineer
  actions; Regulator officer files.
- **Acceptance criteria:**
  1. Editing customers-impacted updates the rolling total.
  2. Crossing 50,000-customer line flips regulator flag.
  3. Acknowledged incidents drop from the queue.
  4. AgentTrace surfaces open count and regulator flag.
  5. Bilingual EN/AR, RTL clean.

## 6. SAMA Compliance Agent — `sama-compliance-agent`

- **Buyer:** CRO / compliance head at a SAMA-regulated FI.
- **Market analogs:** OneTrust GRC, MetricStream, Archer, IBM OpenPages,
  ServiceNow IRM.
- **Previous gap:** No editable obligation status, no evidence-age
  callout, no scoped inspection pack.
- **Feasibility:** High. Cycle controls + filter pack is browser-local.
- **Cast:** obligation-mapper → control-monitor → evidence-curator →
  degradation-detective → pack-compiler. **Humans:** CRO signs pack;
  Audit clears finding.
- **Acceptance criteria:**
  1. Cycling status (met → partial → gap) updates the heatmap.
  2. Stale evidence (>60 days) flags in the AgentTrace.
  3. Filter (all / SAMA / PDPL / UAE-AI) scopes the pack.
  4. AgentTrace counts met / partial / gap.
  5. Bilingual EN/AR, RTL clean.

## 7. Energy Trading Copilot — `energy-trading-copilot`

- **Buyer:** Head of trading desk at a regional energy major.
- **Market analogs:** Kpler, Vortexa, ICIS LOR, Refinitiv Eikon
  copilots, in-house BP / Shell trading copilots.
- **Previous gap:** No editable conviction, no sign-off toggle on
  ideas, no memo draft.
- **Feasibility:** High. Conviction / risk-band re-render is trivial.
- **Cast:** feed-aggregator → event-correlator → risk-bander →
  memo-drafter. **Humans:** Trader signs memo; Compliance clears floor.
- **Acceptance criteria:**
  1. Editing conviction updates the per-idea risk band.
  2. Sign-off toggle adds the idea to the memo set.
  3. Risk bands aggregate counts (low / med / high).
  4. AgentTrace names the signed count.
  5. Bilingual EN/AR, RTL clean.

## 8. Retail Demand Forecaster — `retail-demand-forecaster`

- **Buyer:** Head of merchandising / demand planning, GCC retail.
- **Market analogs:** Blue Yonder Luminate Demand, RELEX Solutions,
  o9 Solutions, SAP IBP.
- **Previous gap:** No seasonality overlay toggles (Ramadan, schools,
  summer), no GCC cluster view, no promo intensity slider.
- **Feasibility:** High. Multiplicative lift model is browser-local.
- **Cast:** season-tagger → base-forecaster → seasonality-overlay →
  allocator → promo-simulator. **Humans:** Merchandiser approves
  allocation; Revenue signs promo.
- **Acceptance criteria:**
  1. Toggling overlays updates 26-week forecast and total lift %.
  2. Promo slider re-renders forecast and lift.
  3. Cluster allocation table re-aggregates.
  4. AgentTrace names active overlays and lift %.
  5. Bilingual EN/AR, RTL clean.

## 9. Hospitality Revenue Optimizer — `hospitality-revenue-optimizer`

- **Buyer:** Revenue manager / CCO at a regional hotel group.
- **Market analogs:** IDeaS G3 RMS, Duetto, Atomize, Cendyn / Pegasus.
- **Previous gap:** No event toggle, no comp-rate anchor, no
  channel-mix sliders.
- **Feasibility:** High. Event multiplier × comp anchor → recommended
  rate is closed-form.
- **Cast:** event-tagger → demand-modeller → competitor-rate-watcher
  → rate-recommender → channel-mix-tuner. **Humans:** CCO clears
  event overlay; Revenue manager signs rates.
- **Acceptance criteria:**
  1. Toggling events updates event multiplier and rate uplift.
  2. Comp-rate slider re-anchors the recommendation.
  3. Channel mix sliders sum to 100% (flagged otherwise).
  4. AgentTrace names uplift % and channel-mix balance.
  5. Bilingual EN/AR, RTL clean.

## 10. EV Battery Health Agent — `ev-battery-health-agent`

- **Buyer:** Aftermarket head at an EV OEM or fleet operator.
- **Market analogs:** Twaice, Voltaiq, ACCURE, Geotab Connect, Volvo
  Care by Volvo.
- **Previous gap:** No per-vehicle SoH editing, no work-order draft,
  no fleet-level summary.
- **Feasibility:** High. Threshold-based intervention plan is simple.
- **Cast:** telemetry-ingestor → soh-predictor → intervention-window-
  planner → customer-graph-resolver → outreach-drafter. **Humans:**
  Service advisor sends; Aftermarket head approves template.
- **Acceptance criteria:**
  1. Editing SoH updates fleet average and at-risk count.
  2. Work orders auto-populate for SoH < 85.
  3. Lowest-SoH vehicle highlighted.
  4. AgentTrace names average SoH and work-order count.
  5. Bilingual EN/AR, RTL clean.

## 11. FP&A Rolling Forecast — `fpa-rolling-forecast`

- **Buyer:** CFO / Head of FP&A.
- **Market analogs:** Anaplan, Workday Adaptive Planning, Pigment,
  Vena Solutions.
- **Previous gap:** No driver sliders, no forecast cone, no
  board-flag triggers.
- **Feasibility:** High. Driver-based recompile is closed-form.
- **Cast:** actuals-ingestor → driver-recompiler → variance-analyst
  → board-flagger. **Humans:** CFO signs commentary; FP&A lead clears
  flags.
- **Acceptance criteria:**
  1. Editing any driver re-renders forecast cone vs baseline.
  2. Variance vs AOP shows revenue Δ % and EBITDA Δ %.
  3. Board flags raise when thresholds are crossed.
  4. AgentTrace names variances and flag count.
  5. Bilingual EN/AR, RTL clean.

## 12. Customer Care Multi-Agent — `customer-care-multi-agent`

- **Buyer:** Head of customer care / contact-centre director.
- **Market analogs:** Salesforce Einstein Service, Zendesk AI,
  Intercom Fin, ServiceNow Now Assist for CSM, Cognigy.ai.
- **Previous gap:** No channel mix view, no QA-pass toggle, no
  cost-per-contact telemetry.
- **Feasibility:** High. Containment % × volume → spend is trivial.
- **Cast:** intent-router → resolution-agent → qa-critic → cost-
  telemetry. **Humans:** Care agent takes over; Coach reviews
  failures.
- **Acceptance criteria:**
  1. Editing channel volume updates total and spend.
  2. Editing containment % updates contained vs handed-off.
  3. QA-failed conversations highlighted.
  4. AgentTrace names total volume, contained, and spend.
  5. Bilingual EN/AR, RTL clean.

## 13. Sovereign Data Workbench — `sovereign-data-workbench`

- **Buyer:** Chief data officer at a sovereign / regulated org.
- **Market analogs:** Databricks Unity Catalog + Sovereign Cloud,
  Snowflake Government, G42 Sovereign Cloud, Collibra, Atlan.
- **Previous gap:** No source picker, no transform toggles, no
  block / allow lineage.
- **Feasibility:** High. Source × transform → sink permission matrix
  is closed-form.
- **Cast:** schema-explorer → arabic-ner → pipeline-drafter →
  lineage-compiler → quality-contract-drafter. **Humans:** Data
  engineer merges; Data owner signs contract.
- **Acceptance criteria:**
  1. Toggling source selection updates pipeline draft.
  2. Toggling transforms updates which sinks are allowed.
  3. Blocked sinks show the blocking obligation.
  4. AgentTrace names selected, allowed, and blocked counts.
  5. Bilingual EN/AR, RTL clean.

## 14. Knowledge Memory Agent — `knowledge-memory-agent`

- **Buyer:** Knowledge / IT Ops head; chief AI officer.
- **Market analogs:** Glean, Microsoft Copilot for M365, Notion AI Q&A,
  Guru, Mendable.
- **Previous gap:** No persona / permission lens, no question picker,
  no refusal pathway.
- **Feasibility:** High. Permission filter × source coverage is
  closed-form.
- **Cast:** ingestor → permission-filter → semantic-retriever →
  grounded-drafter → coverage-monitor. **Humans:** Knowledge steward
  curates; Compliance reviews withholds.
- **Acceptance criteria:**
  1. Switching persona changes visible sources.
  2. Switching question changes expected vs visible sources.
  3. When no visible source covers the question, the drafter refuses.
  4. AgentTrace names visible source count and hidden source count.
  5. Bilingual EN/AR, RTL clean.
