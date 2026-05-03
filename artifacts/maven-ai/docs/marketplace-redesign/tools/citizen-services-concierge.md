# Citizen Services Concierge — `citizen-services-concierge`

## Buyer & pain
- **Buyer**: Government CX / Digital Services head at a GCC ministry
  (KSA Absher / Tawakkalna analogues, UAE TAMM / DubaiNow analogues).
- **Named pain**: Citizens write in Gulf, Egyptian, Levantine and
  English dialects across WhatsApp, web chat, and call. Today the
  contact centre escalates 60–70% of cases that a properly grounded
  AI could resolve, and audit packets are assembled by hand.

## Problem statement
- McKinsey's 2024 *State of AI* finds gov CX is one of the highest-
  ROI gen-AI use cases when grounded on policy and gated by
  confidence-thresholded HITL [S1].
- Maven advisory benchmarks: **35–45%** of GCC ministry contact
  volume is bilingual / dialect-mixed; current rule-based bots
  resolve **< 20%** unaided [M3].
- Buyer quote (representative, GCC ministry CX head):
  *"My agents are not slow because they cannot answer. They are slow
  because they cannot find the policy that authorises the answer."*

## Solution
A `concierge-conductor` orchestrator picks each case off the inbox,
tags the dialect, retrieves policy, drafts a grounded response in
the citizen's dialect, scores its own confidence, and either replies
or escalates to a named supervisor. Every case ends with an audit
packet ready for inspection.

## Agent architecture

```
                ┌────────────────────────────┐
                │ ORCHESTRATOR                │
                │ concierge-conductor         │
                └────────────────────────────┘
                  │     │      │      │      │
        ┌─────────┘     │      │      │      └─────────┐
        ▼               ▼      ▼      ▼                ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
 │ dialect-    │ │ policy-    │ │ response- │ │ confidence- │ │ audit-     │
 │ tagger      │ │ retriever  │ │ drafter   │ │ scorer      │ │ packetizer │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘ └────────────┘
        │             │             │             │              │
        ▼             ▼             ▼             ▼              ▼
   nlp.dialect,   policy.search, draft.compose, llm.confidence, packet.compile
                                                                       │
                                                                       ▼
                                              HUMAN CHECKPOINT: Supervising Officer takeover
```

- **Orchestrator**: `concierge-conductor`.
- **Specialists**: `dialect-tagger`, `policy-retriever`,
  `response-drafter`, `confidence-scorer`, `audit-packetizer`.
- **Tools**: `nlp.dialect`, `policy.search`, `draft.compose`,
  `llm.confidence`, `packet.compile`, `memory.read/write`.
- **Memory**: case file (raw inbound, dialect, policy refs, draft
  reply, confidence, audit packet).
- **Human checkpoint**: **Supervising Officer** takes over when
  confidence < 75%.

## Autonomous workflows
1. **Inbox sweep** — Every sim minute, the orchestrator pulls new
   cases.
2. **Tag & retrieve** — `dialect-tagger` and `policy-retriever`
   run; if retrieval is empty, the case auto-refuses with the right
   apology and escalates.
3. **Draft & score** — `response-drafter` + `confidence-scorer`.
4. **Auto-reply / escalate** — On confidence ≥ policy, the
   orchestrator sends; else it opens the supervisor checkpoint.
5. **Audit packetisation** — Every closed case is bundled with
   raw inbound, dialect tag, policy refs cited, draft, confidence,
   and the human action (if any).

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Auto-resolution rate | 15–25% | 50–65% | [S1, V2] |
| Average handle time | 6–10 min | 2–4 min | [V2] |
| Bilingual coverage | partial | full EN + 4 AR dialects | [M3] |
| Audit packet assembly | manual, hours | automatic, seconds | [V4] |

## Demo scenario script
- Seed: 16 inbound cases across 4 dialects. Three are out-of-scope
  (no policy match) and the agents auto-refuse politely. Two are
  low-confidence and the supervisor checkpoint fires for each.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/citizen-services-concierge`.
3. Cockpit shows confidence scoring per case.
4. Supervisor checkpoint fires on every < 75% case.
5. Audit Log includes the full case packet.
6. Bilingual EN/AR, RTL clean.
