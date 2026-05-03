# Enterprise Knowledge Concierge — `enterprise-knowledge-concierge`

## Buyer & pain
- **Buyer**: Chief AI Officer / Head of Knowledge & IT Ops at a
  GCC enterprise.
- **Named pain**: Glean / Copilot / Notion AI all surface answers
  the asker is not allowed to see. Permission-blind retrieval is a
  governance non-starter for sovereign and regulated buyers.

## Problem statement
- Glean's published references show enterprise-search agents save
  **2–5 hours per knowledge worker per week** when properly
  governed [V3, S2].
- Maven advisory benchmarks: **15–25%** of internal questions touch
  permission-restricted material; an unpermissioned agent leaks on
  every one of them [M3].
- Buyer quote (representative, GCC bank Chief AI Officer):
  *"I will not deploy any agent that cannot prove what it didn't
  show me."*

## Solution
A `concierge-conductor` orchestrator runs every question through a
persona-aware permission filter *before* retrieval, drafts an answer
grounded only on visible sources, and refuses (with a named
rationale) when no visible source covers the question. The visitor
sees both what was found and what was hidden.

## Agent architecture

```
              ┌────────────────────────────┐
              │ ORCHESTRATOR                │
              │ concierge-conductor         │
              └────────────────────────────┘
                │     │      │      │
     ┌──────────┘     │      │      └──────────┐
     ▼                ▼      ▼                 ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐
 │ ingestor    │ │ permission-│ │ semantic-│ │ grounded-   │
 │             │ │ filter     │ │ retriever│ │ drafter     │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘
     │              │              │              │
     ▼              ▼              ▼              ▼
   sources.list,  acl.check,    vector.search, draft.cite
                                       │
                                       ▼
                            ┌────────────────┐
                            │ coverage-       │
                            │ monitor         │
                            └────────────────┘
                                       │
                                       ▼
                  HUMAN CHECKPOINTS: Knowledge steward curates · Compliance reviews withholds
```

- **Orchestrator**: `concierge-conductor`.
- **Specialists**: `ingestor`, `permission-filter`,
  `semantic-retriever`, `grounded-drafter`, `coverage-monitor`.
- **Tools**: `sources.list`, `acl.check`, `vector.search`,
  `draft.cite`, `coverage.scan`.
- **Memory**: source register (per source: classification, ACL,
  freshness, owner), question log, refusal log.
- **Human checkpoints**: **Knowledge steward** curates new sources;
  **Compliance** reviews recurring withholds (questions a persona
  cannot answer that they probably should).

## Autonomous workflows
1. **Persona-aware Q&A** — Visitor asks a question; the
   orchestrator runs `permission-filter → semantic-retriever →
   grounded-drafter`. Sources cited inline.
2. **Refusal pathway** — If the visible-source set does not cover
   the question, the drafter refuses with the rationale and the
   list of *hidden* sources that would have answered it.
3. **Coverage monitoring** — `coverage-monitor` aggregates refusals
   and flags questions multiple personas cannot answer; routes to
   the Knowledge steward.
4. **Source onboarding** — New source proposed → `ingestor` parses,
   classifies, opens steward checkpoint.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Hours saved / knowledge worker / week | 0 | 2–5 | [V3, S2] |
| Permission leaks | unknown | 0 (gated by design) | [M3] |
| Question coverage | partial | measured & monitored | [V3] |
| Refusals with named rationale | 0 | 100% | [M3] |

## Demo scenario script
- Seed: 6 personas (CFO, HR Lead, Field Engineer, External Auditor,
  Bid Manager, Junior Analyst), 24 sources with mixed ACLs, 12
  seeded questions including one that all personas should be able
  to answer (compliance baseline) and one that only the CFO should
  see.
- Visitor switches persona mid-demo and watches the visible source
  set change. Two refusal cases fire and are logged.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/enterprise-knowledge-concierge`.
3. Persona switcher in the Workspace tab changes the visible source
   list and re-routes the next question.
4. Refusal pathway fires with named rationale on no-coverage cases.
5. Both checkpoints fire (Knowledge steward, Compliance).
6. Bilingual EN/AR, RTL clean.
