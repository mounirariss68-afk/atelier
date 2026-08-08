---
name: Atelier EA delegation invariants
description: Executive Assistant acting-for design — grant scoping, apply attribution, receipt gate, revoke semantics
---

- EA designation is a roster flag (`is_executive_assistant` on employees/contractors), not a role; personas stay employee/contractor and use only /me/* routes.
- Nothing writes directly on approve-side apply until the PARTNER approves: EA submissions live in `atelier_ea_pending_items`; approve applies the real artifact (timesheet entry / expense) with partner as owner and `createdByUserId` = EA (dual attribution), idempotent via appliedRef.
- Timesheet apply resolves the partner's roster person via resolvePerson(userId); expense apply uses partner userId directly (expense personId IS the user id — matches the Me-tab linkage split).
- `requireOwnEditableItem` re-checks the live grant + scope, so revoke cuts off edits/resubmits immediately, not just new items. Reject requires a reason; resubmit only from rejected.
- Receipt visibility widening (EA owner + partner + HR/founding) happens ONLY in the /me/ea-items/:id/receipt gate; object ACL owner stays the EA. Any new receipt surface must reuse that gate.
- `autoRevokeDelegationsForUser` is exported from delegationRoutes and called from the joiner deactivate flow — any new deactivation surface must call it too (dangling delegations are the audit finding it prevents).

**Why:** delegation without server-side attribution or with client-trusted scopes was the failure mode the task explicitly forbade.
**How to apply:** extend scopes via the EaScope/KIND_SCOPE maps + normalizePayload whitelist; test via tests/ea-delegation/run.ts (ephemeral p_test_* personas, no seeding).

**Chat surface (added 2026-08-08):** EA assist prepare/edit/resubmit have chat parity via `me.ea_item_*` capabilities that call the SAME exported route helpers (submit/update/resubmit + normalizeEaItemPayload + getEditableEaItem) — never duplicate the insert/audit path. Acting-for context resolves only from the caller's own active grants (partnerName filters grants, disambiguation keyed on delegationId — never a person lookup). Grant management and partner approve/reject stay web-only on purpose. With an explicit itemId, skip the global "any active grant" pre-check so a revoked grant yields the precise revoked-refusal, not a generic one.
