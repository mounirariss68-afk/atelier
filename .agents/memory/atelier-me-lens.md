---
name: Atelier Me lens self-scope
description: Self-service Me lens boundaries, joiner lifecycle, and orval quirk
---
- Employee AND contractor personas are boundary-restricted server-side to /me, /me/*, /personas (contractor legacy engagements/timesheets/expenses allowlist retired) — new self-service routes must go under /me/* or update the boundary middleware allowlists.
- Self resolution: employee roster rows link by user_id, contractors by lower-cased email; no roster match is 200 person=null, not an error.
- Joiner lifecycle: deactivate flips credential `disabled` + deletes sessions (revokeAllSessions DELETEs rows, no revoked_at on atelier_auth_sessions); login rejects disabled creds with generic invalid-credentials.
- **Why:** boundary is deny-by-default per role; disabled must be indistinguishable from wrong password to outsiders.
- Orval quirk: for some response shapes it emits only the TS interface, not a zod const — don't assume a `<Name>Response` zod export exists for 201 bodies.
