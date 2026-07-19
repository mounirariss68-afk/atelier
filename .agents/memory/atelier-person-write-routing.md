---
name: Chat person resolution and write routing
description: resolve_entity "contact" spans three rosters; contact_update routes writes with field-level ACL
---
The CLI "contact" kind is really a PERSON search: client contacts + HR employees (atelier_employees) + partner-firm resources. Exact-id and fuzzy passes all fall through the three rosters; candidates carry "Employee — <title>" / "Partner resource — <role>" secondary labels so writes can be routed.

**Why:** "add mobile for <internal employee>" used to fail with "No contact matched" because only client contacts were searched.

**How to apply:**
- contact_update routes non-contact ids via updateInternalPerson(); field-level ACL must mirror the REST roster routes, NOT a single record-level gate: title/fullName/email = HR/founding-partner only; phone = HR/partner/founding OR self; partner resources = privileged only, no phone column (explicit error).
- Employee phone writes merge into the cellPhones jsonb ({country,number}, dial-code→country label, dedupe, cap 3); title writes must sync atelier_users.title.
- Account-scoped person searches deliberately skip internal rosters (an account-scoped person means a client contact).
- Probe: tests/crm/person-resolution-probe.ts (standalone tsx, restores DB state).
