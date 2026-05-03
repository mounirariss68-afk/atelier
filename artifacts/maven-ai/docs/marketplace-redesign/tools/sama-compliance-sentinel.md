# SAMA Compliance Sentinel — `sama-compliance-sentinel`

## Buyer & pain
- **Buyer**: CRO / Head of Compliance at a SAMA-regulated bank,
  insurer, or fintech in Saudi Arabia.
- **Named pain**: SAMA inspections demand a packet that maps every
  obligation in the Cyber Security Framework and Counter-Fraud
  Framework to live evidence — assembled in 5–10 days by analysts
  copying screenshots from 12 systems.

## Problem statement
- The SAMA Cyber Security Framework defines **114 controls** across
  four domains; every control needs evidence dated within the
  inspection window [R1].
- ServiceNow's IRM / Now Assist case studies report compliance pack
  assembly time falling from **5–10 days to under 1 day** with
  agentic automation [V4].
- Buyer quote (representative, GCC bank CRO):
  *"I do not lose sleep over the controls. I lose sleep over whether
  the evidence is dated within the window."*

## Solution
A `sentinel-conductor` orchestrator continuously maps obligations to
controls, monitors evidence age, autonomously detects control
degradation (a control that was met last month but evidence has
gone stale or alerts have spiked), and assembles the inspection
packet on demand. CRO and Internal Audit are the human checkpoints.

## Agent architecture

```
              ┌────────────────────────────┐
              │ ORCHESTRATOR                │
              │ sentinel-conductor          │
              └────────────────────────────┘
                │     │      │      │      │
     ┌──────────┘     │      │      │      └──────────┐
     ▼                ▼      ▼      ▼                 ▼
 ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
 │ obligation- │ │ control-   │ │ evidence-  │ │ degradation-│ │ pack-       │
 │ mapper      │ │ monitor    │ │ curator    │ │ detective   │ │ compiler    │
 └────────────┘ └────────────┘ └────────────┘ └────────────┘ └────────────┘
     │              │              │              │              │
     ▼              ▼              ▼              ▼              ▼
   sama.frameworks, controls.test, evidence.fetch, anomalies.scan, packet.compile
                                                                       │
                                                                       ▼
                                          HUMAN CHECKPOINTS: CRO sign-off · Internal Audit clear
```

- **Orchestrator**: `sentinel-conductor`.
- **Specialists**: `obligation-mapper`, `control-monitor`,
  `evidence-curator`, `degradation-detective`, `pack-compiler`.
- **Tools**: `sama.frameworks.fetch`, `controls.test`,
  `evidence.fetch`, `anomalies.scan`, `packet.compile`,
  `memory.read/write`.
- **Memory**: control register (status, evidence pointer, evidence
  age, last test date), obligation map, anomaly log, pack draft.
- **Human checkpoints**: **CRO sign-off** on the inspection pack;
  **Internal Audit** clears any finding before submission.

## Autonomous workflows
1. **Daily evidence sweep** — Every sim day, `evidence-curator`
   pulls fresh evidence for every control and writes age.
2. **Stale-evidence flag** — When evidence age crosses policy
   (default 60 days), `degradation-detective` flags the control.
3. **Control degradation** — When `control-monitor` test fails or
   alerts spike on a previously-met control, the orchestrator opens
   a remediation case.
4. **Inspection pack on demand** — Visitor requests a pack; the
   orchestrator runs the chain end-to-end and opens CRO checkpoint.
5. **Filter & scope** — Pack can be scoped to SAMA Cyber, SAMA
   Counter-Fraud, PDPL, UAE-AI Charter or all-of-the-above.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Inspection-pack assembly time | 5–10 days | < 1 day | [V4] |
| Stale-evidence detection lag | 30–60 days | < 1 day | [V4] |
| Controls with current evidence | 75–85% | 95–98% | [V4] |
| Findings raised in inspection | 8–14 | 2–4 | [V4] |

## Demo scenario script
- Seed: 114 SAMA controls, 88 with current evidence, 18 with stale
  evidence, 8 with degraded telemetry. Visitor requests a pack;
  agents discover 3 newly-degraded controls during the run.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/sama-compliance-sentinel`.
3. Cockpit shows degradation detective firing on the seeded
   degradations.
4. Both checkpoints fire (CRO, Internal Audit).
5. Pack scope filter works on the Workspace tab.
6. Bilingual EN/AR, RTL clean.
