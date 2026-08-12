---
name: Atelier reminder push notifications
description: Device push (Expo) for due-reminder self-notifications — token ownership, dedupe, RLS, stub pattern.
---

- Push tokens are one row per Expo token (token = PK), self-scope register/remove only. Re-registering RE-OWNS the token to the caller, and mobile logout best-effort unregisters — a device switching accounts must never keep receiving the old owner's reminders.
- Pushes ride the reminder tick's `onConflictDoNothing().returning()` — only NEWLY inserted self-notification cards push, so push idempotency is exactly the in-app card's dedupe key.
- **Why:** separate "pushed?" bookkeeping would drift from the card registry; piggybacking on returning() makes stale/duplicate pushes structurally impossible.
- **How to apply:** any new commit path that creates due-reminder cards must send its own push; probe delivery offline with a local HTTP stub via `EXPO_PUSH_BASE_URL` (sender skips network under NODE_ENV=test unless that stub var is set; DeviceNotRegistered tokens get pruned).
- The token table is org-RLS'd like every other atelier table — new tables must be added to the org_tables list in the RLS bootstrap AND ship an idempotent migration that guards its policy on `to_regproc('atelier_current_org')` (bare DBs lack the function until the bootstrap runs).
