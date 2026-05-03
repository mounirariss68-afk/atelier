# Procurement Negotiation Agent — `procurement-negotiation-agent`

## Buyer & pain
- **Buyer**: CPO / Head of Procurement Transformation at a GCC
  conglomerate, operator, or sovereign-owned entity.
- **Named pain**: Category leads spend two weeks preparing every
  significant negotiation, miss savings the data already supports,
  and renegotiate the same supplier three times a year because no
  one watches the spend continuously.

## Problem statement
- Across regional procurement engagements, **3–7%** of indirect spend
  leaks through maverick buying, invoice-pricing drift, and missed
  rebates [V5, S4].
- Bain's *Procurement Excellence* benchmarks negotiation prep at
  **5–10 person-days** per significant contract [S7].
- Buyer quote (representative, GCC operator CPO):
  *"My team is great at the negotiation. They are bad at noticing
  it's time to negotiate."*

## Solution
A `category-conductor` orchestrator continuously watches spend
events, autonomously detects savings opportunities, runs a supplier-
risk scan, drafts a negotiation pre-read with the data and the
opening offer, drafts the supplier outreach email, and routes the
pack to the CPO for sign-off and to Legal for clearance.

## Agent architecture

```
              ┌────────────────────────────┐
              │ ORCHESTRATOR                │
              │ category-conductor          │
              └────────────────────────────┘
                │      │      │      │
     ┌──────────┘      │      │      └──────────┐
     ▼                 ▼      ▼                 ▼
 ┌────────────┐ ┌──────────┐ ┌──────────────┐ ┌────────────┐
 │ spend-      │ │ savings- │ │ supplier-    │ │ negotiation-│
 │ normaliser  │ │ modeller │ │ risk-analyst │ │ drafter     │
 └────────────┘ └──────────┘ └──────────────┘ └────────────┘
     │             │              │                 │
     ▼             ▼              ▼                 ▼
 invoice.search, bench.lookup, supplier.risk, playbook.compose
                                                    │
                                                    ▼
                                  HUMAN CHECKPOINTS: CPO sign-off · Legal release
```

- **Orchestrator**: `category-conductor`.
- **Specialists**: `spend-normaliser`, `savings-modeller`,
  `supplier-risk-analyst`, `negotiation-drafter`.
- **Tools**: `erp.invoices.search`, `bench.lookup`, `supplier.risk`,
  `playbook.compose`, `email.draft`, `memory.read/write`.
- **Memory**: category state (spend rolling 12 months, supplier
  scorecards, savings hypotheses, negotiation pack draft).
- **Human checkpoints**: **CPO sign-off** on savings target;
  **Legal release** on the outreach email.

## Autonomous workflows
1. **Spend monitor** — Every sim day, `spend-normaliser` ingests
   new invoices, detects price drift > policy, and flags categories.
2. **Auto-detect opportunity** — `savings-modeller` proposes a
   savings hypothesis (volume rebate / price re-baseline / spec
   tightening) and a confidence band.
3. **Supplier risk scan** — `supplier-risk-analyst` runs the
   shortlisted suppliers against sanctions, financial, ESG and
   delivery risk; flags any below threshold.
4. **Negotiation pre-read** — `negotiation-drafter` composes the
   playbook (BATNA, opening offer, target, walk-away) and the
   supplier outreach email.
5. **CPO sign-off** — Orchestrator opens the CPO checkpoint with the
   pack; on approval, opens Legal release; on Legal release, sends.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Negotiation prep cycle | 5–10 person-days | < 1 day | [S7] |
| Indirect-spend leakage detected | 1–2% / year | 3–5% / year | [V5, S4] |
| Time from price-drift to flag | 30–60 days | < 1 day | [V5] |
| Supplier-risk surprises in QBR | 3–5 / quarter | 0–1 / quarter | [V5] |

## Demo scenario script
- Seed: 6 categories, 80 suppliers, 24 months of invoices. Three
  hidden price-drifts and one supplier with degrading delivery.
- Visitor presses Play. Inside a few sim days the agents detect a
  drift, propose a 6.4% re-baseline opportunity, flag the at-risk
  supplier, draft the playbook, and open the CPO checkpoint.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/procurement-negotiation-agent`.
3. Two checkpoints fire in sequence (CPO then Legal).
4. Workspace tab shows the live category file with savings
   hypotheses and supplier scorecards.
5. Bilingual EN/AR, RTL clean.
