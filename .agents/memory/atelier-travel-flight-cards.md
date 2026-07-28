---
name: Travel flight cards & AED display
description: How chat travel results render rich flight cards and convert prices to AED without a DB.
---

- Travel capabilities are deliberately DB-free (offline probe), so AED display conversion uses a static approx rate table (`AED_PER_UNIT` in travel-capabilities), NOT the finance FX table (`atelier-fx.ts` imports @workspace/db). Unknown currencies show the original amount — never fake a rate. Original amount+currency always stay in the payload.
- **Why:** importing @workspace/db would break the fully-offline travel probe; approximate display FX is honest-labeled ("≈").
- Rich Google-Flights-style cards ride the existing `ranked_list` shape: each flight item carries a structured `flight` object (legs, outbound, next-day flag, stops/duration, marketing·operating carriers, price w/ aedAmount). Both web (`ResultCardRenderers.tsx` RankedList) and mobile (`ResultCards.tsx` RankedList) branch on `item.flight` presence; lists without it keep generic rows. No new resultCard shape was added.
- Duffel test-mode keys are detected by the `duffel_test` prefix (`duffelIsTestMode()`); `data.testMode` drives a sandbox-data banner in both clients and a note sentence.
- Slice durations come from Duffel's ISO-8601 `duration` (never computed from local times — they lack offsets across timezones).
- **How to apply:** any new travel result surface (e.g. an Amadeus swap, task-planned) must preserve the `flight` item contract, testMode flag, and AED conversion labeling, or the clients silently degrade to plain rows.
