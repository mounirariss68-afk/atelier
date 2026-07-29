---
name: Guided flight planner flow
description: Invariants of the chat trip-planner card, legContext sequencing, and traveller picker
---

- Planner card = clarification field `inputType:"flight_planner"` + `planner` prefill (chat-core `ChatFlightPlanner`); client confirms with `clarificationValues.plan` as a JSON **string** — the server sanitizer (`sanitizePlannerMeta` in atelier-cli index.ts) drops malformed planner metadata wholesale, so any shape change must update it or restored cards lose their prefill.
- `legContext {legIndex,legCount}` is stateless and passed by the model through search→select; when present on `travel_select_flight` the ad-hoc "add return?" clarification is **skipped** (planner already decided trip shape). Malformed legContext is ignored, never fatal.
- Traveller lookup lives in `travel-companion-capabilities.ts` — deliberately a separate DB-backed module so `travel-capabilities.ts` stays DB-free for the offline probe. Colleagues must pass `resolveRosterScope` filtering (listPersons is unscoped); dependents only via the caller's own employee/contractor row.
- Flight card tap now fires a selection prompt via an `onPrompt` callback threaded through both clients' renderers; `href` stays as a secondary "Open booking link" affordance. Web followUp/suggestion callbacks only PREFILL the composer — a dedicated submit callback was needed.
