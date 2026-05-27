# Catalogue Recommendation — From 14 Tools to 10

## Recommendation summary

Drop 5 tools whose stories collapse into "dashboard with sliders",
keep & redesign 9 tools whose orchestrator-and-specialist stories are
naturally strong, and add 1 net-new tool that is one of the most
agentic enterprise use-cases in the GCC market today (autonomous
tender response). Final catalogue: **10 tools**.

## Per-tool verdicts (current 14)

| # | Current tool | Verdict | Rationale |
|---|---|---|---|
| 1 | Value Realization Tracker | **KEEP / REDESIGN** | Flagship. Already strongest narrative; needs orchestrator framing + autonomous "value-at-risk" workflows + CFO checkpoint that actually fires. |
| 2 | Programme Health Copilot | **KEEP / REDESIGN** | Orchestrator pulling workstream reports & drafting steering packs is intrinsically agentic. Recast as "Programme War Room". |
| 3 | Citizen Services Agent | **KEEP / REDESIGN (rename → Citizen Services Concierge)** | Strong autonomous case-handling story for GCC government CX. Confidence-thresholded HITL is exactly right. |
| 4 | Procurement Intelligence | **KEEP / REDESIGN (rename → Procurement Negotiation Agent)** | Recast around autonomous savings opportunity discovery + negotiation prep + supplier outreach drafting + CPO sign-off. |
| 5 | Network Ops Agent | **KEEP / REDESIGN (rename → Network Ops War Room)** | Multi-agent triage of major incidents with regulator-notification clock is one of the most visually agentic stories possible. |
| 6 | SAMA Compliance Agent | **KEEP / REDESIGN (rename → SAMA Compliance Sentinel)** | Autonomous evidence-monitoring + control-degradation detection + inspection-pack assembly is a clean orchestrator story. |
| 7 | Energy Trading Copilot | **DROP** | Narrow buyer (single regional desk). Demo always collapses to "trader edits conviction → memo recomputes". Hard to make convincingly agentic without trading-desk-level depth. |
| 8 | Retail Demand Forecaster | **DROP** | Mature ISV territory (Blue Yonder, RELEX, o9). Demo collapses to seasonality multipliers. We cannot credibly out-agentic these vendors in a marketing demo. |
| 9 | Hospitality Revenue Optimizer | **DROP** | Same as #8 — RMS commodity (IDeaS, Duetto, Atomize). Demo is "comp-rate slider × event multiplier". |
| 10 | EV Battery Health Agent | **DROP** | Narrow buyer (EV OEM aftermarket head). Crowded ISV market (Twaice, Voltaiq, ACCURE). Demo is per-vehicle SoH editing. Better as a future bespoke build. |
| 11 | FP&A Rolling Forecast | **DROP** | Overlaps with the VRT narrative. Buyers who want this want Anaplan / Pigment. Removing tightens the catalogue. |
| 12 | Customer Care Multi-Agent | **KEEP / REDESIGN (rename → Customer Care Hive)** | Multi-agent contact resolution with QA-critic agent is naturally agentic. Recast around live channel-mix + autonomous escalations. |
| 13 | Sovereign Data Workbench | **KEEP / REDESIGN (rename → Sovereign Data Steward)** | Autonomous data-product creation with lineage validation + obligation-blocked sinks is a strong orchestrator story. |
| 14 | Knowledge Memory Agent | **KEEP / REDESIGN (rename → Enterprise Knowledge Concierge)** | Persona-aware autonomous retrieval with permission filtering and refusal reasoning is an excellent agentic narrative. |

## New tool (replacement)

| # | New tool | Rationale |
|---|---|---|
| 15 | **Tender Response Studio** (`tender-response-studio`) | One of the most genuinely agentic, GCC-relevant enterprise use-cases today. RFPs from ADNOC, Aramco, ministries, mega-projects routinely run 200+ pages and require six functions to respond in 14 days. The orchestrator runs intake → qualification → technical-section drafting (with subject-matter specialists) → pricing modelling → compliance checks → partner outreach → submission packet. Multiple HITL checkpoints (Bid/no-bid, Pricing sign-off, Legal release). Visually demonstrates the full agentic value chain in a single workflow. |

## Final catalogue (10 tools)

In the order they should appear on the marketplace listing:

1. **Value Realization Tracker** — `value-realization` (flagship)
2. **Programme War Room** — `programme-war-room` (renamed from Programme Health Copilot)
3. **Tender Response Studio** — `tender-response-studio` (NEW)
4. **Procurement Negotiation Agent** — `procurement-negotiation-agent` (renamed)
5. **Network Ops War Room** — `network-ops-war-room` (renamed)
6. **SAMA Compliance Sentinel** — `sama-compliance-sentinel` (renamed)
7. **Citizen Services Concierge** — `citizen-services-concierge` (renamed)
8. **Customer Care Hive** — `customer-care-hive` (renamed)
9. **Sovereign Data Steward** — `sovereign-data-steward` (renamed)
10. **Enterprise Knowledge Concierge** — `enterprise-knowledge-concierge` (renamed)

## Slug migration plan (for the build task)

Old slug → new slug or DROP:

| Old slug | New slug |
|---|---|
| `value-realization` | `value-realization` (unchanged) |
| `programme-health-copilot` | `programme-war-room` |
| `citizen-services-agent` | `citizen-services-concierge` |
| `procurement-intelligence` | `procurement-negotiation-agent` |
| `network-ops-agent` | `network-ops-war-room` |
| `sama-compliance-agent` | `sama-compliance-sentinel` |
| `energy-trading-copilot` | DROP |
| `retail-demand-forecaster` | DROP |
| `hospitality-revenue-optimizer` | DROP |
| `ev-battery-health-agent` | DROP |
| `fpa-rolling-forecast` | DROP |
| `customer-care-multi-agent` | `customer-care-hive` |
| `sovereign-data-workbench` | `sovereign-data-steward` |
| `knowledge-memory-agent` | `enterprise-knowledge-concierge` |
| (new) | `tender-response-studio` |

The build task should:

1. Add 301-style fallbacks from old slugs to new slugs in the
   `/marketplace/:slug` route so external links don't 404.
2. Remove the 5 dropped demo components and their cast entries.
3. Update `registeredDemoSlugs.ts`, `agentCasts.ts`, the chat
   assistant prompt, and any cross-links from services / industries
   pages in lockstep.

## Why 10, not 14

- Every kept tool earns its slot with a distinct orchestrator and
  specialist set. No two demos look the same.
- Five forecasting / RMS / battery / FP&A tools that always reduce to
  "drag a slider → numbers change" leave the catalogue. They are
  better positioned as bespoke advisory engagements than as
  off-the-shelf agentic products.
- The new Tender Response Studio carries the most ambitious agentic
  narrative end-to-end and is highly differentiated for the GCC
  market.

The visitor leaves with a tighter, more credible catalogue and a
clearer message: Cognirise builds orchestrator-led agent systems for
specific, named GCC enterprise problems.
