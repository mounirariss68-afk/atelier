---
name: Founder titles are data-only
description: Where the founders' official titles live and what must never overwrite them
---
Mounir Ariss's official title is "CEO and Co-founder"; Gökhan Güney's is "Co-founder". These live ONLY as data in the `title` columns of `atelier_users` and `atelier_employees` (both rows per person, kept in sync).

**Why:** Corrected 2026-07-19 from "Founding Partner". `role`/`role_label` deliberately stay `founding_partner` / "Founding Partner" — that is the RBAC role name, not the job title.

**How to apply:**
- No route currently writes titles (self-PATCH whitelist excludes `title`; roster has no title PATCH). If one is added, it must update BOTH tables and audit.
- The boot auth seed only touches credentials — never make any boot/repair loop write titles, or these corrections revert on restart.
- Business cards, /auth/me, roster, pay hub all read the title columns; nothing is hardcoded for these two people (test fixtures excepted).
