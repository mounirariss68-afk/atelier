# Atelier Travel Search Kit

A portable extract of The Atelier's chat travel capabilities — flight
search (Ignav), hotel search (StayingAPI), Airbnb deep links, the guided
trip planner, and the traveller-companion picker — packaged so the code
can be dropped into another Node/TypeScript backend.

The provider clients, travel tools, preference registry, capability
catalog and role list are copied **verbatim** from the live Atelier
codebase (2026-08-06). Files marked STUB (`atelier-cli/index.ts`,
`rosterRoutes.ts`, `stubs/db/index.ts`) are hand-written replacements
for Atelier-only infrastructure, with documented integration points.

## Layout

```
server/
  src/lib/atelier-agents/travel-providers.ts   ← provider clients (fully portable, zero deps)
  src/lib/atelier-cli/travel-capabilities.ts   ← the chat tools: plan_trip, search_flights,
                                                 search_stays, airbnb_link (+ fare options,
                                                 itinerary summary, guided leg flow)
  src/lib/atelier-cli/travel-preferences.ts    ← DB-free traveller-preference resolver registry
  src/lib/atelier-cli/travel-companion-capabilities.ts
                                               ← DB-backed companion/traveller picker (needs wiring)
  src/lib/atelier-cli/capability-catalog.ts    ← real capability registry (verbatim; portable)
  src/lib/atelier-cli/index.ts                 ← STUB: tool types + verbatim sanitizer helpers
  src/routes/atelier/personaRoles.ts           ← real role list (verbatim)
  src/routes/atelier/rosterRoutes.ts           ← STUB: people-directory integration point
  stubs/db/index.ts                            ← STUB: @workspace/db replacement (drizzle tables)
  tests/travel/travel-probe.ts                 ← offline test suite (26 groups, no network/DB)
ui-reference/
  FlightPlannerCard.tsx                        ← React planner card (prefill/confirm protocol)
  ResultCardRenderers.tsx                      ← typed result-card renderers (ranked_list etc.)
integration-reference/
  travel-preferences-db.ts                     ← illustrative reference (NOT compilable here):
                                                 how Atelier wires the DB-backed prefs resolver;
                                                 it reads a jsonb travel-profile column and a
                                                 helper outside this kit
```

## Quick start

```bash
cd server
npm install
npm run typecheck   # tsc --noEmit — passes clean
npm test            # offline probe: boots local Ignav/StayingAPI stub servers
```

The probe runs with **no network, no database, no API keys** — it stands
up local HTTP stubs and points the clients at them via
`ATELIER_IGNAV_BASE_URL` / `ATELIER_STAYING_BASE_URL`.

## Secrets / environment

| Variable | Purpose |
| --- | --- |
| `IGNAV_API_KEY` | Ignav flight search (flights, airport suggestions) |
| `STAYINGAPI_API_KEY` | StayingAPI hotel search (sandbox keys are auto-detected and results get a test-data label) |
| `ATELIER_IGNAV_BASE_URL` | Optional base-URL override (tests) |
| `ATELIER_STAYING_BASE_URL` | Optional base-URL override (tests) |

Missing keys fail **loudly** with a `travel_unavailable` error — there is
deliberately no silent fallback to fake data.

## Provider behaviour worth knowing

- **Ignav flights**: endpoint choice depends on leg count — dedicated
  one-way / round-trip endpoints for 1–2 symmetric legs, a flexible
  multi-leg search for open-jaw and 3+ legs. Airport free text resolves
  via `/api/airports` suggestions.
- **StayingAPI hotels**: search is asynchronous — a `202` kicks off the
  job, the client then **polls** until results are ready. Budget for
  multi-second latency in your UX.
- **Booking is deep-link only.** No booking writes exist anywhere in
  these modules; cards link out to Google Flights / provider / Airbnb.
- **AED display conversion** uses a static approximate table
  (`AED_PER_UNIT` in travel-capabilities.ts). Original currency/amount
  is always preserved alongside the AED figure. Swap in a live FX
  source if you need precision.

## Portable vs. glue

Portable as-is:
- `travel-providers.ts` (no imports outside node built-ins),
- `travel-capabilities.ts` + `travel-preferences.ts` + the capability
  catalog (need only the type stubs included here),
- the probe suite.

Needs your infrastructure (documented in the STUB files):
1. **Chat orchestrator** — these tools return a `ToolResult` contract
   (`clarification` → ask the user and re-invoke with merged args;
   `disambiguation` → present options; planner cards ride on
   `clarification.fields[].planner`). Your agent loop must implement
   that protocol; `ui-reference/` shows how Atelier's web client renders
   the cards.
2. **People directory** — `rosterRoutes.ts` stub (companion picker
   scoping) and `stubs/db/index.ts` (drizzle tables). Only the
   companion/traveller picker needs these; core search does not.
3. **Traveller preferences** — register a resolver via
   `setTravelPreferencesResolver(...)`; see
   `integration-reference/travel-preferences-db.ts` for Atelier's
   DB-backed version. Without a resolver, tools run fine with no
   preference notes.
4. **Persona gating** — `capabilitiesForPersona` filters by role
   (`TRAVEL_ROLES`); adapt `personaRoles.ts` to your role model.

## License / provenance

Extracted from the Cognirise Atelier codebase for internal reuse.
