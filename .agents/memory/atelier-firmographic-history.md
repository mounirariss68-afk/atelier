---
name: Atelier firmographic change history & revert
description: How the Company Details "Recent changes" feed + one-click revert is derived and gated.
---

Firmographic change history (Company Details card) is reconstructed at read time
from `atelier_audit_events` rows where `action='account.update'`, reading the
`payload.changes` array (`{field, before, after}` per changed firmographic field).

**Why:** No separate history table — the PATCH handler already audits edits, so the
history is just a projection of the audit trail.

**How to apply:**
- Only NEW edits carry `payload.changes`; pre-existing/old audit rows have no
  `changes` array and are silently skipped (no history for them). The PATCH handler
  must populate `changes` (deep-equal guard) for history to appear.
- Revert reuses the SAME account PATCH endpoint: it re-sends the recorded
  `fromValue` for one field. The revert itself is therefore audited as another
  change row (so you'll see "A → B" then "B → A").
- annualRevenue is redacted (values + displays nulled, `canRevert=false`) when the
  viewer lacks financial authority — mirrors the existing `canSeeFinancials` gate.
- The revert button only renders when `canEdit` (partner-tier) AND `change.canRevert`.
- CompanyDetailsCard has an early-return empty-state branch (`!hasAnything`). Any
  always-relevant section like the history feed MUST render in BOTH the empty-state
  return and the main return, or reverting a field to empty makes the history vanish.
