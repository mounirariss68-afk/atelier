---
name: Partner registration flow
description: Durable invariants for signed-firm partner onboarding and firm bank maker-checker.
---

- Partner onboarding reuses the shared activation-token scheme with a distinct purpose value; never introduce a parallel token table. Migration history is hand-authored SQL files in lib/db/drizzle (0057+ have no _journal entries — don't add them); every schema change needs one even though dev uses drizzle push.
- **Gotcha:** the shared portal-login provisioning helper stamps the placeholder credential `userManaged: true`, so that flag can NEVER mean "user finished registration". Use a dedicated completion timestamp (here: the firm's registrationCompletedAt, set inside the registration transaction).
- Firm payable bank details follow the maker-checker discipline: partner submissions land pending, and the approve route is the sole writer of the payable columns. Decisions must atomically claim the pending row (conditional `status = pending` update inside the transaction) — a pre-read + unconditional update lets two reviewers both "win".
- IBANs are masked on every read and audit surface; raw values live only in the request row and the approved firm columns.
- Public `/api/auth` routes share ONE per-IP rate limit bucket (10/15min) — probes hitting several auth endpoints must budget total calls.
