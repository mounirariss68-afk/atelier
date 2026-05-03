# Customer Care Hive — `customer-care-hive`

## Buyer & pain
- **Buyer**: Head of Customer Care / Contact-Centre Director at a
  GCC telco, bank, retailer, or airline.
- **Named pain**: Voice + chat + WhatsApp + email all hit the same
  agents with no triage. AHT, FCR and CSAT all suffer because the
  routing is rule-based and the QA is sample-based.

## Problem statement
- Forrester's TEI of Salesforce Einstein for Service finds **30–
  45%** contact deflection and **15–25% AHT reduction** when an
  agentic resolution layer is in place [S5, V2].
- Cost per contact drops from **AED 18–24** to **AED 7–11** in the
  same engagements [S5, V2].
- Buyer quote (representative, GCC telco care director):
  *"I QA 2% of my contacts. I am flying half-blind."*

## Solution
A `hive-conductor` orchestrator routes every inbound contact to the
right resolver agent, runs a `qa-critic` against every reply (not
2%), measures cost per contact in real time, and escalates to a
human Care Agent the moment a resolver agent stalls or QA fails.

## Agent architecture

```
              ┌────────────────────────────┐
              │ ORCHESTRATOR                │
              │ hive-conductor              │
              └────────────────────────────┘
                │     │      │      │
     ┌──────────┘     │      │      └──────────┐
     ▼                ▼      ▼                 ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐
 │ intent-     │ │ resolution-│ │ qa-      │ │ cost-       │
 │ router      │ │ agent (×N) │ │ critic   │ │ telemetry   │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘
     │              │              │              │
     ▼              ▼              ▼              ▼
   nlp.intent,   policy.search,  draft.review,  pricing.contact
   crm.context   action.execute
                                       │
                                       ▼
                          HUMAN CHECKPOINTS: Care Agent takeover · Coach review
```

- **Orchestrator**: `hive-conductor`.
- **Specialists**: `intent-router`, `resolution-agent` (multiple
  parallel instances, one per active case), `qa-critic`,
  `cost-telemetry`.
- **Tools**: `nlp.intent`, `crm.context`, `policy.search`,
  `action.execute`, `draft.review`, `pricing.contact`.
- **Memory**: contact file per case (intent, resolution, QA score,
  cost, channel, customer profile).
- **Human checkpoints**: **Care Agent** takeover on stall or
  customer-asks-for-human; **Coach** review on every QA-failed
  resolution.

## Autonomous workflows
1. **Intake & route** — Every inbound contact is intent-tagged and
   routed to the right resolver.
2. **Auto-resolve** — `resolution-agent` answers, executes the
   action (refund, plan-change), and closes.
3. **QA on every reply** — `qa-critic` scores tone, accuracy,
   policy compliance; failures route to coach.
4. **Cost telemetry** — `cost-telemetry` aggregates per channel and
   per contact in real time, updates the KPI panel.
5. **Stall escalation** — If a resolver does not finish within
   policy, `hive-conductor` opens the Care Agent checkpoint.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Contact deflection | 10–15% | 30–45% | [S5, V2] |
| Average handle time | unchanged | −15% to −25% | [S5, V2] |
| Cost per contact | AED 18–24 | AED 7–11 | [S5, V2] |
| QA coverage | 2–5% sampled | 100% (every reply) | [V2] |

## Demo scenario script
- Seed: 24 inbound contacts across voice / chat / WhatsApp /
  email. Two stall (resolver lacks the policy), two QA-fail (tone
  issue), three are out-of-policy (auto-refuse).

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/customer-care-hive`.
3. Cockpit shows multiple parallel `resolution-agent` lanes.
4. `qa-critic` scores every closed case.
5. Care Agent and Coach checkpoints both fire in the demo.
6. Bilingual EN/AR, RTL clean.
