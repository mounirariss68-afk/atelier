# Marketplace Tool Requirements (Task #24)

All 14 Marketplace tools ship as interactive, agentic demos. The flagship
Value Realization Tracker (VRT) sets the bar. Every other tool meets the
same contract.

## Per-tool contract

Each demo must:

1. Render a hands-on interactive surface — sliders, toggles, dropdowns,
   click targets — that drives derived metrics, charts, callouts and
   draft artefacts (memos, work orders, packs) in real time.
2. Carry a named agent cast (3–6 agents) and at least one human
   checkpoint. The cast lives in `lib/maven-content/src/agentCasts.ts`.
3. Expose a "How does this work?" button that opens
   `AgentExplainer`. The explainer lists the agents and their job
   descriptions, the vertical flow with human checkpoints inline, and
   the rationale for the design.
4. Render `AgentTrace` below the interactive surface. The trace shows
   numbered reasoning steps, each labelled with the specific agent
   doing the work, and re-renders against the current state.
5. Bilingual EN/AR with full RTL support, browser-local state, and a
   Reset control. No new dependencies, inline SVG only, illustrative
   sample data only.
6. The chat assistant's system prompt must reference the agents and
   human checkpoints for every tool so visitors get consistent answers
   across the page and the chat.

## The 14 tools and their casts

| Slug | Tool | Agents (in order) | Human checkpoints |
| --- | --- | --- | --- |
| `value-realization` | Value Realization Tracker | portfolio-watcher → uvr-scorer → leakage-detective → cfo-narrator | CFO sign-off |
| `programme-health-copilot` | Programme Health Copilot | programme-watcher → raid-classifier → etc-recompiler → steering-drafter → ask-extractor | PMO lead signs the steering pack |
| `citizen-services-agent` | Citizen Services Agent | dialect-tagger → policy-retriever → response-drafter → confidence-scorer → audit-packetizer | Supervisor takes over below confidence threshold |
| `procurement-intelligence` | Procurement Intelligence | spend-normaliser → savings-modeller → supplier-risk-analyst → negotiation-drafter | CPO approves savings; Legal clears pre-read |
| `network-ops-agent` | Network Ops Agent | alarm-collector → customer-impact-scorer → change-correlator → triage-recommender → regulator-flagger | NOC engineer actions; Regulator officer files |
| `sama-compliance-agent` | SAMA Compliance Agent | obligation-mapper → control-monitor → evidence-curator → degradation-detective → pack-compiler | CRO signs pack; Audit clears finding |
| `energy-trading-copilot` | Energy Trading Copilot | feed-aggregator → event-correlator → risk-bander → memo-drafter | Trader signs memo; Compliance clears floor |
| `retail-demand-forecaster` | Retail Demand Forecaster | season-tagger → base-forecaster → seasonality-overlay → allocator → promo-simulator | Merchandiser approves allocation; Revenue signs promo |
| `hospitality-revenue-optimizer` | Hospitality Revenue Optimizer | event-tagger → demand-modeller → competitor-rate-watcher → rate-recommender → channel-mix-tuner | CCO clears event overlay; Revenue manager signs rates |
| `ev-battery-health-agent` | EV Battery Health Agent | telemetry-ingestor → soh-predictor → intervention-window-planner → customer-graph-resolver → outreach-drafter | Service advisor sends; Aftermarket head approves template |
| `fpa-rolling-forecast` | FP&A Rolling Forecast | actuals-ingestor → driver-recompiler → variance-analyst → board-flagger | CFO signs commentary; FP&A lead clears flags |
| `customer-care-multi-agent` | Customer Care Multi-Agent | intent-router → resolution-agent → qa-critic → cost-telemetry | Care agent takes over; Coach reviews failures |
| `sovereign-data-workbench` | Sovereign Data Workbench | schema-explorer → arabic-ner → pipeline-drafter → lineage-compiler → quality-contract-drafter | Data engineer merges; Data owner signs contract |
| `knowledge-memory-agent` | Knowledge Memory Agent | ingestor → permission-filter → semantic-retriever → grounded-drafter → coverage-monitor | Knowledge steward curates; Compliance reviews withholds |

## Validation

The `content.ts` validator enforces:

- Each cast has at least three agents and one human checkpoint.
- Every edge and `flowOrder` id resolves to a real agent or checkpoint.
- The set of slugs in `agentCasts.ts` matches `REGISTERED_DEMO_SLUGS`
  (the live tools mounted in `MarketplaceDetail.tsx`).
- TypeScript passes clean for both `@workspace/maven-content` and
  `@workspace/maven-ai`.
