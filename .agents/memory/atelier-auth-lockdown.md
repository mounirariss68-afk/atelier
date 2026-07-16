---
name: Atelier auth lockdown
description: How real login/session gating works and its test/prod escape hatches
---

- Whole API sits behind one `requireAuthSession` gate mounted in the routes index; only `/api/healthz` and `/api/auth/*` are public. New routers must mount AFTER the gate or they ship public.
- CRM harness auth: `isTestAuthBypass()` (NODE_ENV=test) lets the harness use bare `atelier_persona` cookies; it is hard-disabled when `REPLIT_DEPLOYMENT` is set so a misconfigured prod deploy can never open it.
- **Why:** harness predates real auth and drives everything with persona cookies; real sessions would break ~all of its requests.
- Persona-cookie identity override is only honored non-prod or with `ATELIER_PERSONA_SWITCHER=true`; otherwise identity comes from the auth session. No default persona fallback anywhere.
- Credential seed (`atelier-seed-auth`) is boot-time and data-only — no runtime DDL; prod tables arrive via the Publish schema diff. If a password-change feature lands, the seed must stop overwriting user-set hashes.
- Passwords: node scrypt (no bcrypt dep), timing-safe compare, dummy verify on unknown email for anti-enumeration.
- Partner-initiated reset: `must_change_password` lives on BOTH credential and session rows — copied at login, enforced by the global gate (403 `password-change-required`), cleared by change-password. Reset sets `user_managed=true` so the boot seed never resurrects the old password; all target sessions are revoked.
