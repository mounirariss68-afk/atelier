---
name: Atelier chat travel tools
description: Duffel-backed flight/hotel search capabilities — key constraints and design decisions
---

# Chat travel tools (Duffel)

- The travel capabilities (`travel_search_flights`, `travel_search_stays`, `travel_airbnb_link`) are deliberately **DB-free** (no `@workspace/db` import) so the offline probe (`tests/travel/travel-probe.ts`, run via tsx) can exercise them through the capability registry without booting the app or a database. Keep them that way.
- **Why:** `capability-catalog.ts` only imports `index.js` *type-only*, so a DB-free capability file can be loaded standalone — the cheapest test harness in the repo.
- Duffel client stub hook is `ATELIER_DUFFEL_BASE_URL` (mirrors the stub-Anthropic/Perplexity pattern); without it, `DUFFEL_API_KEY` secret is required and absence fails loudly (`travel_unavailable`) — never stub data outside tests. Key not yet set in dev/prod as of 2026-07-28.
- Booking is **deep-link handoff only** in v1 (Google Flights/Hotels prefilled queries, Airbnb pre-filled search — Airbnb has no public API). Duffel offers/stays carry no consumer booking URL; in-chat ticketing needs a verified live Duffel account (phase 2).
- Clarification `fields[]` entries may carry `inputType`/`options`/`defaultValue` — now first-class in the api-server `ToolResult` clarification type (mirroring chat-core's ClarificationField); contract_prepare relied on this informally long before.
- Ranked-list cards: external `http(s)` hrefs open new-tab on web and via `Linking.openURL` on mobile; internal hrefs keep SPA/tab behaviour.
