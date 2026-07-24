---
name: Atelier Microsoft 365 auto-provisioning
description: Invariants of the joiner M365 provisioning engine, GoDaddy tenant limits, and how to test it.
---

- Live Cognirise tenant is GoDaddy-resold and admin consent is NOT granted: the app-only token has no `roles` claim, so all directory calls throw `MsAdminError("admin-consent-required")`. Provisioning must PARK the row as `blocked` with the error text — it must never block Atelier onboarding or throw into the create-login/joiner flows.
- **Why:** founders must complete a manual Entra step (grant Application perms User.ReadWrite.All + Directory.ReadWrite.All); until then everything is a first-class manual path (documented in replit.md External Dependencies).
- **How to apply:** any new provisioning surface calls `launchProvisioning` (async, launch-map guarded) and reads status from `atelier_ms_provisioning`; never await Graph inline in a request handler.
- Graph error mapping lives in `msGraphAdmin.ts`: 401/Authorization_RequestDenied → admin-consent-required; other 403 → tenant-blocked ("complete manually in GoDaddy portal"). Both are expected, structured outcomes — don't treat them as bugs.
- `MS_LOGIN_BASE_URL`/`MS_GRAPH_BASE_URL` env vars exist only for the offline stub (tests/crm/ms-provisioning-probe.ts spins a local HTTP tenant stub; token endpoint body is urlencoded — don't JSON.parse it).
- Scratch CRM test DB is REUSED across runs: probe fixtures need per-run unique ids AND emails (atelier_employees has a unique email constraint).
- Bespoke /roster/people/:id/m365* routes are NOT in openapi (raw fetch in UI); only the deactivate `msMailboxAction` field was added to the spec (AtelierDeactivateJoinerInput) + codegen.
- Deprovision semantics: retain = block sign-in + revoke sessions, keep license/status; remove = also free license, status `deprovisioned`. Reactivate after remove parks as `pending_license`.
- Guarded live probe: scripts/t628-m365-live-probe.ts — real directory WRITES only when the token has the roles AND MS_PROBE_ALLOW_WRITE=1.
