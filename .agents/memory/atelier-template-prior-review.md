---
name: Contract-template prior-field reconciliation
description: How a new template version preserves the previous reviewed field schema for reviewers
---
When a new contract-template version is uploaded, the previous CURRENT version's schema — only if it was reviewed — is reconciled against the NEW document and stored as `priorFieldReview` on the new version row (fields tagged carried_over|missing).

**Why:** the reviewed schema used to be silently discarded on re-upload. Matching uses the same placeholder matcher as generation time, so carried_over ⇒ guaranteed fillable.

**How to apply:**
- Compute reconciliation at version-UPLOAD time only; the stored field is a snapshot, never recompute later.
- The Review Fields dialog shows the banner only while the version is still unreviewed; the restore-previous-settings merge must never re-add missing fields — server placeholder validation on field save is the final safety net.
- New DB columns here need BOTH the drizzle schema edit and an idempotent ADD COLUMN IF NOT EXISTS migration under lib/db/drizzle/.
- A deterministic stub-Anthropic probe covering this flow lives with the CRM test probes (builds minimal .docx via JSZip; slow — run backgrounded and tail the log).
