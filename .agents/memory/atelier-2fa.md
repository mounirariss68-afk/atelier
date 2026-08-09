---
name: Atelier two-factor auth invariants
description: TOTP 2FA design decisions — single-use CAS semantics, step-up contract, policy storage, demo exemption
---

# Atelier 2FA (TOTP) invariants

- All code verification goes through `verifyCredentialCode` (step-up lib): TOTP consumption is a compare-and-swap on `totpLastStep` (`IS NULL OR < step` conditional update, returning); backup codes CAS on the whole jsonb array. Never add a read-then-write verification path — parallel replays were a review-flagged hole.
- **Why:** naive read/update lets two concurrent requests both pass with the same code.
- Login challenge = `atelierLoginActivationTokens` purpose `"2fa"` (5-min TTL); consumed conditionally on `usedAt IS NULL` only AFTER the code verifies (retries allowed until expiry). Wrong codes at `/login/2fa` share the persisted password lockout counter.
- Step-up contract: sensitive routes call `requireFreshTotp`/`requireFreshTotpForActor`; accepts inline `totpCode` in body OR session `totpVerifiedAt` within 10 min. 403 errors are `step-up-required` / `step-up-invalid-code` — web + mobile clients key on these strings to show a code field. New sensitive surfaces must reuse the helper.
- Org policy lives in `atelier_admin_settings.value.require2faRoles` (`["*"]` = everyone); login response sets `twoFactorEnrollRequired` (nudge only, never blocks). Web stores a `sessionStorage` flag ("atelier-2fa-nudge") that Shell consumes to open the setup dialog; mobile shows an Alert (enrolment is web-only by design).
- TOTP secret AES-256-GCM encrypted with key derived from SESSION_SECRET (`sha256("totp-enc:"+secret)`) — rotating SESSION_SECRET orphans all enrolments (users need partner 2FA reset).
- Demo account exempt everywhere (challenge skip at login, enroll 403).
- Codes valid only ±1 step: probe tests must reset `totpLastStep` or use current-step codes, not step+N offsets.
