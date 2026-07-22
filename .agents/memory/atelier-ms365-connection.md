---
name: Atelier Microsoft 365 connection
description: Design invariants for the per-user MS365 OAuth + calendar feature
---
- Redirect URI is `/api/atelier/me/msauth/callback` (under /me so every persona passes the self-scope allowlist); Entra registration + docs/microsoft365-admin-brief.md must use exactly this path.
- Microsoft is stubbable via `MS_LOGIN_BASE_URL` / `MS_GRAPH_BASE_URL` env overrides — the probe (`tests/crm/ms-calendar-probe.ts`) runs a local http stub; keep those hooks when refactoring msGraph.ts.
- Token refresh requests the full MS_SCOPES list (silent upgrade) but MUST fall back to a scope-less refresh on AADSTS65001 — connections consented before a scope was added otherwise break ALL Graph features, not just the new one. Never remove the fallback in refreshTokens.
- MailboxSettings.ReadWrite is not yet consented for the live founder connections (Entra reports admin consent required); auto-reply live verification is blocked until a user reconnects after consent. OOF calendar event create/remove verified live 2026-07-22 via scripts/t605-live-ooo-check.ts (self-cleaning).
- Refresh tokens: AES-256-GCM with HKDF key from `MS_TOKEN_ENC_SECRET||SESSION_SECRET`. Changing either secret orphans every stored token (users must reconnect) — never rotate casually.
- OAuth state is HMAC-signed and bound to the persona id AND mirrored in a path-scoped cookie; callback requires all three (HMAC valid, cookie==param constant-time, state.userId==me.id).
- Mobile flow (Task #360): bearer-authed `POST /me/msauth/mobile/start` mints a state with `flow:"mobile"` + allowlisted `returnTo`; a PUBLIC router mounted before the global auth gate handles the same callback path for mobile states only (state HMAC is the sole credential — no cookie) and falls through to the gated web handler otherwise. Both flows share `completeConnection()`; keep the returnTo scheme allowlist (open-redirect guard).
- `/me/calendar` contact→account matches are filtered through `canSeeAccount`; the `configured:false` shape is a deliberate graceful state, not a failure.
**Why:** delegated-only, opt-in per employee design promised in the admin brief; leaking an invisible account name via a meeting chip would break the account ACL model.
