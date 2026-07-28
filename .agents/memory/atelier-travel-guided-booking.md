---
name: Atelier guided flight booking
description: Contracts for travel_select_flight / travel_itinerary_summary and travel card paging/logos
---
- travel_select_flight & travel_itinerary_summary are STATELESS (model passes offer fields back); they must stay DB-free like the other travel tools (offline probe boots them without a DB).
- One-way selection asks "add return?" via the clarification envelope (`addReturn` options yes/no + `returnDate` date field); continuation merges answers at top level. Ignav has NO fare families — fare options are cabin-class re-search only, never invented fares.
- Airline filtering must happen server-side via the `airline` param on travel_search_flights (name substring or 2-letter IATA); prose-only filtering caused card/prose mismatch. Filter miss returns ok:true, empty items + availableAirlines.
- Cards: airline logos come from images.kiwi.com/airlines/64/{IATA}.png with client onError fallback (hide img); flight numbers ride each leg summary as flightNumbers/flightNumbersLabel. Paging is client-side Prev/Next over fetched results, `pageSize` from tool data (clamp ≥1); mobile paging useState must sit ABOVE the empty-list early return.
- Itinerary summary reuses ranked_list with a `data.itinerary` header block (legCount/totalDisplay); AED totals only when every currency is convertible, else original-currency sums per currency (never cross-currency sums).
- sanitizeClarificationFields (atelier-cli/index.ts) must preserve inputType/options/defaultValue — stripping them breaks restored date-picker/dropdown clarification cards.
