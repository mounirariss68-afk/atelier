---
name: Cartographer entity-scope (parent vs subsidiary apex)
description: How the Account Cartographer avoids attributing a subsidiary exec to the parent group, and why the deterministic guard is the source of truth.
---

The Account Cartographer must not flatten a subsidiary/brand executive into the
parent group's leadership. Each decision-maker carries `entityName` +
`entityScope` (`parent_group | subsidiary | division | standalone`).

**Domain rule:** many MENA family/chair/owner-led conglomerates (anchor case:
Al Tayer Group) have **NO group CEO** — the apex is the Executive Chairman /
owner. Do not invent a group CEO and do not promote a subsidiary CEO (e.g. CEO
of Al Tayer Insignia) to group CEO.

**Three enforcement layers (defence in depth):**
- Prompt (`prompts/account_cartographer/v1.md` + `v2_partner_mode.md`, kept in
  lockstep) teaches the parent/subsidiary distinction + abstention path.
- Data model represents scope so the correct answer is storable.
- `guardCartographerEntityScope()` in `runner.ts` is the **deterministic safety
  net** run after normalisation — independent of model variance. It downgrades
  an apex-titled (CEO persona or CEO/`chief executive officer` title) exec to
  `confidence:"inferred"`, de-apes `buyerPersona` CEO→`business_head`, tags
  `entityScope:"subsidiary"` when unset, and appends one openQuestions note.

**Why the guard is authoritative:** live `web_search` output is
non-deterministic, so the prompt alone can't be trusted; the guard + its unit
test (`tests/cartographer-guard/run.ts`) are the regression-proof part.

**Edge to watch:** the guard's `normName()` strips legal tokens
(group/holding/llc/ltd/etc) before comparing entityName to the canonical name.
If a genuine parent CEO's entityName mismatches the canonical name after
stripping, the guard would over-downgrade it. Add a guard test before extending
the stripped-token set.
