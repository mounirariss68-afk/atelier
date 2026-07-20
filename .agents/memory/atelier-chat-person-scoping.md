---
name: Chat person-name lookups must be roster-scoped
description: listPersons is not viewer-scoped; disambiguation options can leak names
---

**Rule:** `listPersons` (rosterRoutes) is NOT viewer-scoped or even org-filtered. Any chat capability that resolves a person by free-text name must filter matches through the caller's roster scope (`resolveRosterScope` full/personIds/self) BEFORE returning disambiguation options — checking `canViewPersonViaRosterScope` only after picking a single match still leaks names/titles of out-of-scope people in the options list.

**Why:** Code review rejected Task-#443-era work for exactly this: a scoped caller could enumerate out-of-perimeter people via the "Which person did you mean?" prompt. `person.workload` now uses a `scopedPersonMatches` helper; older tools (person_detail, person_reports) still use the unscoped pattern.

**How to apply:** When adding/reviewing any person-by-name chat tool, reuse `scopedPersonMatches` in people-read-capabilities.ts (or the same predicate). A regression test lives in tests/cli-catalog/run.ts section [9].

Also: contractor/employee are SELF_ONLY_CHAT_ROLES (Task #422) — their chat catalog is me.* only (`my_expenses`, not `expense_list`); don't write catalog tests assuming restricted personas see org-wide tools.
