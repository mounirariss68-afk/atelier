---
name: Atelier self-only shell gating
description: How the web shell avoids guaranteed-403 requests for employee/contractor personas
---
Self-only personas (isSelfOnlyRole in atelier lens lib) are server-allowlisted to /me*, /personas, /cli*, wallet taxonomy only. The shell must never fire org-wide queries for them:
- SelfOnlyRouteGuard (App.tsx) redirects non-me/cli routes to /me AND holds org routes unmounted until /me resolves (otherwise pages mount during load and fire-and-403 with react-query retries).
- Globally-mounted dialogs (CreateAccountProvider → CreateAccountDialog) must gate their queries on `open`; useReferenceBootstrap takes an `enabled` flag for this.
- RightRail activity poll + Activity/Reports tabs and the Firm avatar submenu are gated on me loaded && !self-only.

**Why:** employee login produced an endless stream of 403s (/activity every 5s, /accounts retries, /reference/bootstrap) from unconditional polls and always-mounted components.
**How to apply:** any new app-wide component, poll, or nav surface must be checked against the persona allowlist and gated on role before fetching.
