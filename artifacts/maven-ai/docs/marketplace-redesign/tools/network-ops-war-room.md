# Network Ops War Room — `network-ops-war-room`

## Buyer & pain
- **Buyer**: NOC Director / Head of Service Operations at a GCC
  telco; Regulator-Liaison Officer.
- **Named pain**: When a major incident hits, the NOC has under 30
  minutes to file a regulator notification (TDRA / CST), draft
  customer communications in EN and AR, mobilise field engineers,
  and brief executives — all while the incident is still evolving.

## Problem statement
- TDRA and CST require operators to notify the regulator within
  **30 minutes** for outages affecting > 50,000 subscribers [R3, R4].
- Gartner's AIOps research finds median MTTR for major incidents
  is **3–6 hours** without AIOps and **45–90 minutes** with mature
  AIOps [S3, V1].
- Buyer quote (representative, GCC telco NOC director):
  *"By the time my regulator officer has the right line, the clock
  has 4 minutes left."*

## Solution
A `war-room-conductor` orchestrator runs the entire incident
lifecycle: ingest alarms, score customer impact, correlate with
recent changes, recommend triage, draft the regulator notification
*and* the EN/AR customer SMS, mobilise the field crew, and brief
the exec. NOC engineer and Regulator officer are the human
checkpoints.

## Agent architecture

```
                ┌────────────────────────────┐
                │ ORCHESTRATOR                │
                │ war-room-conductor          │
                └────────────────────────────┘
                  │     │      │      │      │
        ┌─────────┘     │      │      │      └─────────┐
        ▼               ▼      ▼      ▼                ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
 │ alarm-      │ │ customer-  │ │ change-  │ │ triage-     │ │ regulator- │
 │ collector   │ │ impact-    │ │ correlator│ │ recommender │ │ flagger    │
 │             │ │ scorer     │ │          │ │             │ │            │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘ └────────────┘
        │             │             │             │              │
        ▼             ▼             ▼             ▼              ▼
   nms.alarms,   crm.affected,   itsm.changes, runbook.match, regulator.template
                                                                       │
                                                                       ▼
                                              HUMAN CHECKPOINTS: NOC engineer · Regulator filer
```

- **Orchestrator**: `war-room-conductor`.
- **Specialists**: `alarm-collector`, `customer-impact-scorer`,
  `change-correlator`, `triage-recommender`, `regulator-flagger`,
  `customer-comms-drafter`.
- **Tools**: `nms.alarms.poll`, `crm.affected_msisdns`,
  `itsm.changes.recent`, `runbook.match`, `regulator.template`,
  `sms.draft`, `email.draft`.
- **Memory**: incident file (alarms, impact, changes, root cause
  hypothesis, regulator clock, comms drafts, field crew).
- **Human checkpoints**: **NOC Engineer** approves the triage call;
  **Regulator officer** approves and files the notification.

## Autonomous workflows
1. **Alarm sweep** — Every sim minute, `alarm-collector` polls the
   NMS for new alarms.
2. **Major-incident detection** — On `customers > 50k OR
   data-domain`, the orchestrator opens an incident and routes.
3. **Auto-triage** — `triage-recommender` matches against the
   runbook library and proposes the action; opens NOC engineer
   checkpoint.
4. **Regulator clock** — `regulator-flagger` starts the 30-minute
   clock the moment a major incident is opened, drafts the
   notification, and opens the Regulator officer checkpoint with
   time remaining.
5. **Customer comms** — `customer-comms-drafter` produces EN/AR SMS
   and email drafts ready for the visitor to review.
6. **Field mobilisation** — When the runbook match is "send field
   crew", the orchestrator drafts the work order and routes to the
   field-ops team.
7. **Post-incident** — On close, the orchestrator drafts the post-
   incident review and updates the runbook.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| MTTR (major incident) | 3–6 hours | 45–90 minutes | [S3, V1] |
| Time-to-regulator-notification | 25–45 min | < 10 min | [R3, R4] |
| Customer comms turnaround (EN+AR) | 60–120 min | 5–10 min | [V1] |
| Alarms per analyst per shift | 600–900 | 150–250 (clustered) | [S3] |

## Demo scenario script
- Seed: 200 baseline alarms, then a fibre cut at t=3 affecting
  84,310 subscribers in Sharjah and a related transport-layer
  alarm at t=4. The agents discover both, classify the major
  incident, start the regulator clock, draft EN/AR SMS, and open
  both checkpoints.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/network-ops-war-room`.
3. Cockpit shows the regulator clock counting down on the
   `regulator-flagger` lane.
4. Two checkpoints fire (NOC engineer, Regulator officer).
5. EN/AR SMS drafts are visible on the Workspace tab.
6. Bilingual EN/AR, RTL clean.
