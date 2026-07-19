---
name: Founder titles are data-only
description: Where the founders' official titles live and what must never overwrite them
---
Mounir Ariss's official title is "CEO and Co-founder"; Gökhan Güney's is "Co-founder". These live ONLY as data in the `title` columns of `atelier_users` and `atelier_employees` (both rows per person, kept in sync).

**Why:** Corrected 2026-07-19 from "Founding Partner". `role`/`role_label` deliberately stay `founding_partner` / "Founding Partner" — that is the RBAC role name, not the job title.

**How to apply:**
- Title writes exist now: roster PATCH /roster/people/:id/title (HR/founding-partner only) and the chat contact_update employee routing — both must update BOTH tables (employees + users) and audit.
- Boot includes a title repair step; any boot/seed logic touching titles must preserve these official values.
- Business cards, /auth/me, roster, pay hub all read the title columns; nothing is hardcoded for these two people (test fixtures excepted).
