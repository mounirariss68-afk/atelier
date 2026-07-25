---
name: Atelier pricing structures module
description: Invariants of the 7-structure engagement pricing engine, gating, and probe.
---

- Risk-adjusted margin blend weights are **0.2 best / 0.6 expected / 0.2 worst** (BAND_WEIGHTS in `atelier-pricing-structures.ts`) — not 0.2/0.5/0.3; tests must mirror the constant, or better, compare against the engine output.
- Margin lock and billing handoff both gate on `classifyMarginGate(riskAdjustedMarginPct ?? computedMarginPct)`; legacy model names (e.g. `time_and_materials`) normalize to `tnm`.
- PUT pricing invalidates prior partner override/countersign whenever structureParams change.
- Rate-card new-version: partner-only, 409 `effective-from-not-after-current`, uplift applies to `dayRateClientPrice` only, prior version closed at the new effectiveFrom.
- Agent run rows persist status `"complete"` (not "succeeded"/"completed").
- Cost lines (Task #663): absorbed lines fold into every band's cost (no over/underrun scaling); pass-through lines are cash-only (`passThrough:true` receipts) and never touch margin. `costLines` change alone invalidates a prior override. Handoff installments use `amount`, not `amountUsd`.
- Outcome variants gain_share/volume_unit/sla_based/success_fee live in `simulateOutcomeVariant`; the "generic" path is preserved verbatim so legacy sims stay bit-identical — never merge the two branches. Band weights are editable via `structureParams.bandWeights` (normalized by sum).
- Pricing Researcher is async 202+poll (in-memory launch map, raw fetch on the client) and review-only — output snapshots to `pricingResearcherOutput`, never touches economic terms. Its stub must serve SSE (it uses the streaming web-search helper).
- Probe: `pnpm test:pricing-structures` in api-server (CRM scratch harness + stub Anthropic). Seeding `atelier_opportunities` directly requires slug, engagementLeadId, dealSizeHypothesis, probabilityPct, nextMilestone, sourceLead — copy the seed block from margin-reports-probe.
**Why:** first probe run failed on all three assumptions (blend weights, run status, opp NOT NULLs).
**How to apply:** when extending pricing routes/engine or writing new opp-seeding probes.
