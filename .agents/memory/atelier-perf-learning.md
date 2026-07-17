---
name: Atelier performance & learning surfaces
description: Design rules for /me/reviews, /me/goals, /me/learning and the HR-side performance/training routes.
---

- Reviews/goals are employee-only: `resolvePerformanceSubject` 403s contractors and returns empty for personas without a roster record. Contractors DO get /me/learning (audience-filtered).
- `hrNotes` on reviews must never appear in the self-facing shape — only the HR list includes it. A release toggle (`{released: boolean}`) flips draft↔released; only released rows show on /me/reviews.
- Training materials audience is `all|employees|contractors`, filtered server-side by the caller's roster workerType; completion is idempotent via onConflictDoNothing; archive = soft (`archived` flag) and drops the row from /me/learning.
- **Why:** performance data is the most sensitive Me-lens surface; leaks of HR notes or drafts were the explicit task constraint.
- **How to apply:** any new self-facing performance field must be whitelisted in the self shape, not spread from the row.

OpenAPI gotcha: an inline request body on a release-style POST collided with zod const/type names in orval codegen — use a named schema (e.g. `AtelierReviewReleaseInput`) for small inline bodies.
