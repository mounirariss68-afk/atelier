---
name: Atelier chat travel tools
description: Ignav (flights) + StayingAPI (hotels) search capabilities — key constraints and design decisions
---

# Chat travel tools (Ignav flights + StayingAPI hotels)

- The travel capabilities (`travel_search_flights`, `travel_search_stays`, `travel_airbnb_link`) are deliberately **DB-free** (no `@workspace/db` import) so the offline probe (`tests/travel/travel-probe.ts`, run via tsx) can exercise them through the capability registry without booting the app or a database. Keep them that way.
- **Why:** `capability-catalog.ts` only imports `index.js` *type-only*, so a DB-free capability file can be loaded standalone — the cheapest test harness in the repo.
- Provider history: Duffel (no Middle East coverage) → Amadeus Self-Service (portal **decommissioned 2026-07-17**, Enterprise-only now — do NOT propose Amadeus/Duffel again). Current: **Ignav** for flights (X-Api-Key, `IGNAV_API_KEY`), **StayingAPI** for hotels (Bearer, `STAYINGAPI_API_KEY`), both self-serve free keys.
- Stub hooks: `ATELIER_IGNAV_BASE_URL` / `ATELIER_STAYING_BASE_URL` (mirror stub-Anthropic/Perplexity pattern); without them the keys are required and absence fails loudly (`travel_unavailable`) — never stub data outside tests.
- Ignav endpoint mapping: 1 leg → one-way; 2 mirrored legs → round-trip; 2 open-jaw legs → `/api/fares/search` (Ignav caps flexible search at TWO legs); **3+ legs = per-leg one-way searches combined** (same-carrier combos + cheapest mixed), honestly flagged `selfTransfer` (separate tickets).
- StayingAPI takes **free-text location** (no coordinate/place resolution step) and may return **202 + pollUrl** (async job; client polls `/jobs/:id`, strips the `/v1` prefix when a custom base URL already includes it). Hotel results carry real platform booking URLs (`bookingUrl`) — cards deep-link to Booking.com etc., Google Hotels search only as fallback. Guest review scores come from `guestRating`.
- Booking remains **deep-link handoff only** (flight cards use Google Flights prefilled queries; Ignav also has a booking-links endpoint — unused, would cost one extra call per itinerary).
- Clarification `fields[]` entries may carry `inputType`/`options`/`defaultValue` — first-class in the api-server `ToolResult` clarification type (mirroring chat-core's ClarificationField).
- Ranked-list cards: external `http(s)` hrefs open new-tab on web and via `Linking.openURL` on mobile; internal hrefs keep SPA/tab behaviour.
