# Tender Response Studio — `tender-response-studio` (NEW)

## Buyer & pain
- **Buyer**: Head of Bid Management / Head of Strategic Sales at a
  GCC EPC, IT services, telco, or consulting firm responding to
  ministry / sovereign / mega-project RFPs.
- **Named pain**: Mega-project RFPs from Etimad, Tejari, ADNOC,
  Aramco and the ministries run 150–400 pages, demand responses in
  10–14 days, and require six functions to coordinate (sales,
  technical, pricing, legal, partner, compliance). Today the bid
  manager runs that orchestration manually in email + SharePoint and
  win rates suffer.

## Problem statement
- Typical GCC mega-tender response: **180-page RFP**, **12-day
  window**, **6 functions** must contribute, **35–45 pages** of
  technical answers, **4–6 partner letters of support** required
  [R6, M1].
- GCC bid teams report **15–25% win rates** on responded tenders
  and 30–40% no-bid decisions taken too late (after work begun) [M1].
- Buyer quote (representative, GCC EPC bid head):
  *"We are not losing on price. We are losing because Section 7.4 is
  copied from a 2021 bid and the reviewer caught it."*

## Solution
An orchestrator (`bid-conductor`) ingests the RFP the moment it
lands, runs a 5-minute qualification (bid / no-bid / qualified-with-
caveats), and if the bid is on, autonomously drafts every section
from the precedent library, models pricing scenarios, runs the legal
clause-by-clause check, drafts partner outreach, and assembles the
final submission packet. Three named human checkpoints: bid/no-bid,
pricing sign-off, legal release.

## Agent architecture

```
                  ┌────────────────────────────┐
                  │ ORCHESTRATOR                │
                  │ bid-conductor               │
                  └────────────────────────────┘
                    │     │      │      │      │
       ┌────────────┘     │      │      │      └─────────┐
       ▼                  ▼      ▼      ▼                ▼
 ┌────────────┐ ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌────────────┐
 │ rfp-        │ │ qualifier  │ │ section- │ │ pricing-    │ │ partner-   │
 │ ingestor    │ │            │ │ drafter  │ │ modeller    │ │ outreach   │
 └────────────┘ └────────────┘ └──────────┘ └────────────┘ └────────────┘
       │              │             │              │             │
       ▼              ▼             ▼              ▼             ▼
   parse.pdf,    score.fit,    rag.precedent,   pricing.scenarios, partner.letter
   extract.req                                                     │
                                                                   ▼
                                                        ┌────────────────┐
                                                        │ legal-reviewer  │
                                                        └────────────────┘
                                                                   │
                                                                   ▼
                                                         packet-compiler
                                                                   │
                                                                   ▼
                              HUMAN CHECKPOINTS: Bid/No-bid · Pricing sign-off · Legal release
```

- **Orchestrator**: `bid-conductor`.
- **Specialists**: `rfp-ingestor`, `qualifier`, `section-drafter`
  (one instance per section, parallel), `pricing-modeller`,
  `partner-outreach`, `legal-reviewer`, `packet-compiler`.
- **Tools**: `rfp.parse`, `requirements.extract`, `precedent.search`,
  `pricing.scenarios`, `partner.letter.draft`, `compliance.scan`,
  `packet.compile`.
- **Memory**: RFP file (parsed sections, requirements, deadlines),
  precedent library, pricing models, partner roster, draft answers,
  red-team flags.
- **Human checkpoints**: **Bid/No-Bid** (Bid Director, before
  drafting), **Pricing sign-off** (CFO, before submission),
  **Legal release** (General Counsel, before submission).

## Autonomous workflows
1. **RFP intake** — On RFP arrival, `rfp-ingestor` parses every
   section, extracts mandatory requirements, deadlines and
   evaluation criteria, and writes them to memory. No human
   required.
2. **Qualification** — `qualifier` scores fit (capability ✕ past
   performance ✕ pricing headroom ✕ partner availability) and opens
   the Bid/No-Bid checkpoint with a recommended call.
3. **Parallel drafting** — On Bid, the orchestrator forks one
   `section-drafter` per major section, each pulling from the
   precedent library and writing into memory. Conflicts (same
   answer in two sections) are surfaced for human review.
4. **Pricing modelling** — `pricing-modeller` runs three scenarios
   (aggressive / base / floor), compares to evaluation rubric, opens
   the CFO checkpoint with a recommended scenario.
5. **Partner outreach** — `partner-outreach` drafts and sends LoS
   requests to required partners, tracks responses, escalates if
   any partner does not respond within policy.
6. **Compliance & red-team** — `legal-reviewer` runs the response
   clause-by-clause against the RFP, against past wins, and against
   firm policy, flags issues, opens the legal release checkpoint.
7. **Packet assembly** — `packet-compiler` produces the final
   submission packet (cover letter, technical, financial, partners,
   compliance) ready for upload to the tender portal.

## KPI impact

| KPI | Before | After | Source |
|---|---|---|---|
| Cycle time to first complete draft | 6–8 days | 18–24 hours | [M1] |
| Bid/No-Bid decision time | 3–5 days | < 1 day | [M1] |
| Win rate on responded tenders | 15–25% | 25–35% | [M1] |
| No-bids called too late | 30–40% | < 10% | [M1] |
| Pages reviewed by legal manually | 100% | < 25% (exception only) | [M1] |
| Partner LoS turnaround | 5–7 days | 1–2 days | [M1] |

## Demo scenario script
- Seed: a fictitious 220-page Etimad-style RFP (parsed sections only,
  no real document). 18 mandatory requirements, 6 evaluation
  criteria, 3 partner LoS required, 14-day window.
- t=0 — RFP arrives. `rfp-ingestor` parses it, fills memory.
- t=2 — `qualifier` scores 76% fit, opens Bid/No-Bid checkpoint
  recommending Bid with 2 caveats. Visitor (as Bid Director)
  approves with one caveat.
- t=4 — Five `section-drafter` instances run in parallel. Cockpit
  shows five swimlanes filling in. One conflict detected ("section
  4.2 and 5.1 both reference vendor footprint") — surfaced.
- t=7 — `pricing-modeller` produces three scenarios; CFO checkpoint
  fires.
- t=9 — `partner-outreach` shows two partners responded, one
  silent — auto-escalates with a follow-up draft.
- t=11 — `legal-reviewer` flags two clauses; opens Legal Release
  checkpoint.
- t=12 — Packet compiled. KPI panel updates.

## Acceptance criteria
1. Detail page renders all sections per the approach doc.
2. Demo opens at `/demo/tender-response-studio`.
3. Cockpit shows multiple parallel `section-drafter` lanes.
4. All three human checkpoints fire and block the cockpit until
   the visitor acts in the named role.
5. Workspace tab shows the parsed RFP requirements in a live JSON
   tree.
6. Bilingual EN/AR, RTL clean.
