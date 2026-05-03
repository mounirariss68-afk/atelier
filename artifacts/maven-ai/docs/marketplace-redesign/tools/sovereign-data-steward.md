# Sovereign Data Steward — `sovereign-data-steward`

## Buyer & pain
- **Buyer**: Chief Data Officer at a sovereign / regulated GCC org
  (ministry, central bank, sovereign-owned operator).
- **Named pain**: Every new data product is a multi-week back-and-
  forth between data engineering, the data owner, legal, and the
  sovereign cloud team — and sinks still get misclassified.

## Problem statement
- UAE PDPL and the SDAIA / NDMO data classification regime require
  data residency, processing-purpose, and retention controls per
  classification tier [R2, R5].
- Maven advisory engagements show new data products take
  **6–10 weeks** from request to approved-and-running today [M2].
- Buyer quote (representative, GCC ministry CDO):
  *"I cannot ship a product that even *might* breach residency. So
  I ship slowly, and I ship less."*

## Solution
A `steward-conductor` orchestrator owns data-product creation end-
to-end: an `arabic-ner` specialist parses Arabic-language sources,
the `pipeline-drafter` proposes the transform DAG, the `lineage-
compiler` validates every sink against the obligation register, and
sinks that violate residency / classification are blocked with a
named obligation. Data engineer merges, Data owner signs the
contract.

## Agent architecture

```
              ┌────────────────────────────┐
              │ ORCHESTRATOR                │
              │ steward-conductor           │
              └────────────────────────────┘
                │     │      │      │      │
     ┌──────────┘     │      │      │      └──────────┐
     ▼                ▼      ▼      ▼                 ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
 │ schema-     │ │ arabic-    │ │ pipeline-│ │ lineage-    │ │ quality-   │
 │ explorer    │ │ ner        │ │ drafter  │ │ compiler    │ │ contract   │
 │             │ │            │ │          │ │             │ │ drafter    │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘ └────────────┘
     │              │              │              │              │
     ▼              ▼              ▼              ▼              ▼
   catalog.list,  ner.tag,      dag.compose,  obligation.match, contract.draft
   schema.fetch
                                                                       │
                                                                       ▼
                                              HUMAN CHECKPOINTS: Data engineer merge · Data owner sign
```

- **Orchestrator**: `steward-conductor`.
- **Specialists**: `schema-explorer`, `arabic-ner`,
  `pipeline-drafter`, `lineage-compiler`, `quality-contract-drafter`.
- **Tools**: `catalog.list`, `schema.fetch`, `ner.tag`, `dag.compose`,
  `obligation.match`, `contract.draft`, `memory.read/write`.
- **Memory**: data-product file (sources, transforms, sinks,
  classification, lineage, obligations, contract).
- **Human checkpoints**: **Data engineer** merges the pipeline;
  **Data owner** signs the quality contract.

## Autonomous workflows
1. **New product request** — Visitor adds a request; the orchestrator
   routes to `schema-explorer` and `arabic-ner`.
2. **Pipeline draft** — `pipeline-drafter` composes a transform DAG;
   the orchestrator routes to `lineage-compiler`.
3. **Obligation check** — `lineage-compiler` matches every sink
   against the obligation register; blocked sinks show the named
   obligation that blocks them.
4. **Contract draft** — `quality-contract-drafter` produces the
   data-product contract; opens both checkpoints.
5. **Drift detection** — Once running, the orchestrator monitors
   schema and classification drift and re-validates the lineage.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Time to first approved product | 6–10 weeks | 1–2 weeks | [M2] |
| Sink misclassification rate | 5–10% | < 1% | [R2, R5] |
| Lineage coverage | 40–60% | 95–100% | [R2, R5] |
| Data-owner sign-off cycle | 2–3 weeks | < 2 days | [M2] |

## Demo scenario script
- Seed: a new "Citizen-Sentiment Dashboard" data-product request
  pulling from 4 sources. The agents discover one Arabic free-text
  field, a sink that violates residency (blocked), and a stale
  classification on one source.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/sovereign-data-steward`.
3. Workspace tab shows the live lineage graph.
4. Blocked sinks show the named obligation that blocks them.
5. Both checkpoints fire (Data engineer, Data owner).
6. Bilingual EN/AR, RTL clean.
