---
name: Atelier account-create prefill clamping
description: Why the chat "Review & Create" account dialog must clamp AI prefill to server zod caps, and where the limits live.
---

# Atelier account-create: clamp AI prefill to server caps

The chat agent's Cartographer produces a `draft` (account_proposal card) that hydrates
`CreateAccountDialog` via `makeInitial`. That draft is AI-generated and routinely
**overflows the server zod caps**, while the dialog historically only validated
requiredness + currency pattern (never length). Result: "Create account" POSTs an
over-length body and `POST /api/atelier/accounts` returns **400 invalid-body** with no
useful client surface.

**Rule:** every prefilled string field must be clamped to its server cap at the single
hydration point (`makeInitial`), and manual inputs must carry matching `maxLength`.

Server caps (source of truth: `atelierCreateAccountBody*` in
`lib/api-zod/src/generated/api.ts`):
- name 200, brandName 200
- sector 120, country 120, hqCity 120
- strategicPriorities: max 5 items, each ≤ 200
- cogniriseHypothesis ≤ 600
- primaryCurrency `^[A-Z]{3}$`

**Why:** the agent reliably writes 250-320 char priorities and 700+ char hypotheses for
large conglomerates; without clamping, real accounts (e.g. diversified groups) fail to
create even though the chat flow completes successfully.

**How to apply:** clamp with a word-boundary-truncate-+-ellipsis helper that guarantees
`length ≤ max`. The dialog's `PRIORITY_MAX/HYPOTHESIS_MAX/NAME_MAX/LOCATION_MAX` are
**local mirrors** of the generated zod limits (the `*Max` consts are NOT cleanly
re-exported through `@workspace/api-client-react` — only `api.schemas` is). If you change
the OpenAPI/zod caps, update these mirrors in lockstep or prefill will silently
over- or under-truncate.
