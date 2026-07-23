---
name: App Store demo account & public pages
description: Invariants for the read-only demo login and the public /privacypolicy + /support pages.
---

**Rule:** `demo@cognirise.ai` (employee persona) is the App Store review login. It is strictly read-only: a demo-read-only guard sits immediately after the global auth gate and 403s every non-GET/HEAD/OPTIONS request for this user; `/auth/change-password` also rejects it. The boot seed FORCE-repairs its credential every boot (mustChangePassword=false, disabled=false) — unlike founder rows, `userManaged` is ignored on purpose so a partner reset can never brick Apple's review. Credentials live only in `docs/app-store-submission-answers.md`, never in memory.

**Why:** Apple re-reviews every release with these published credentials; drift or a forced-change interstitial would block review, and any write path would let a reviewer touch production data.

**How to apply:** Any new pre-gate (public) router mounted before `requireAuthSession` must consider whether it gives the demo user a write path. Never remove the boot force-repair or add the demo credential to the user-managed skip logic. `/privacypolicy` and `/support` are public client-side pages special-cased in the atelier `AuthGate` (like `/activate`) — static content only, no data fetches.
