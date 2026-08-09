---
name: Security audit console tenancy
description: Org scoping rules for the founding-partner security log over atelier_audit_events
---

# Security log tenancy & contract

- The security console (`/api/auth/security-log` + `.../export.csv`) is founding-partner-only and scopes BOTH tabs by the caller's orgId. It queries the global `db` (no RLS), so the explicit `orgId` predicate is the only isolation — never drop it.
- **Why:** auth audit rows historically defaulted `org_id` to "aico"; a review round found cross-tenant IP/email disclosure before scoping was added.
- Auth `audit()` now resolves orgId from targetUserId/actorId/targetEmail — every `login_failed` call must pass `targetEmail` (or an id) or the row lands in the default org and leaks into the wrong tenant's view. Unknown-account failures intentionally fall back to the default org.
- Console access is itself audited (`security_log_viewed`), debounced 10 min per actor so pagination doesn't flood the trail; CSV export always audits.
- Wire mapper exposes an allowlist (ip/targetEmail from payload), never raw payload jsonb.
- Business audit writers need no explicit orgId: the `atelier_audit_events.org_id` column default reads the RLS GUC (`current_setting('app.org_id')`, falling back to "aico"). Don't "fix" writers by hardcoding an org, and don't revert the column default to a static value.
