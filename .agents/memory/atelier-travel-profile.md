---
name: Employee travel profile
description: Where travel loyalty/preferences live, how membership numbers are scoped, and the DB-free preference feed into chat travel tools.
---

- Storage is a single `travelProfile` jsonb on `atelierEmployees` only — contractors/PFR reject writes automatically via the strict per-worker-type edit zod schemas. Never add parallel columns to other roster tables.
- Membership numbers are personal data: full for self (`/me/travel`) and sensitive-people roles (fp/hr); masked (`••••`+last 3) via `sanitizeForViewer` for other full-roster viewers; omitted on business-only wires.
- **Why:** loyalty numbers map to Amadeus traveler profiles later — codes (2-letter IATA / 2-3 char chain) are always stored beside names so a future mapper needs no migration.
- Chat travel tools stay DB-free: they read prefs via the `travel-preferences.ts` resolver registry (DB-backed resolver registered in bootstrap-capabilities). Prefs only default a missing cabin + add a `travelerPreferences` note — never silently filter results, never expose membership numbers.
- **How to apply:** any new surface exposing travelProfile must reuse `redactTravelProfile`/`travelProfileToWire` from `atelier-travel-profile.ts`; self-edit audits as `person.travel.self_updated` with counts only, never raw numbers.
