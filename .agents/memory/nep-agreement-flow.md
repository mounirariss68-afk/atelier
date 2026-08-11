---
name: NEP agreement flow
description: Non-Equity Partner Agreement template — chat flow quirks and how the v3 template goes live per environment
---
- Roster auto-add only for NEP type, commit-time create; ASCII-only multipart filenames for idempotency checks.
- The v3 NEP template goes live via an idempotent BOOT seed (`ensureAtelierNepTemplateSeed` in api-server boot chores), not a credentialed script: agent has no founding-partner login and prod DB is app-write-only. It stores docx bytes to object storage, verifies placeholders before activating, advisory-locked for autoscale. Prod picks it up on next publish.
- **Why boot seed:** user declined to share founding-partner credentials; boot chores run in every environment automatically.
- **How to apply:** any future "put template/config data live on main+prod" work should prefer an idempotent boot chore over live-API scripts needing user credentials. Not demo seeding (that stays banned).
