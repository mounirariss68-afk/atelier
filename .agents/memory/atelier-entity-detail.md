---
name: Universal entity.detail lookup registry
description: Invariants of the generic chat entity-detail provider registry + AR rollup capabilities
---

- Providers self-register in the entity-detail capabilities module; the generic `entity_detail` tool probes them (id path, typed query, untyped multi-kind probe). ACL filtering happens BEFORE capping/disambiguation; disambiguation option ids are the raw record ids (resume via `id` input).
- **Untyped id probes must not short-circuit on a provider's `forbidden`**: providers run visibility before existence, so a provider can say "forbidden" for an id it doesn't even own. The run loop defers refusals until every provider has had a chance to claim the id; hinted asks refuse immediately.
- **Why:** an untyped POV-id lookup was refused with "no access to this opportunity's account" because the opportunity provider probed first.
- Self-only (employee/contractor) widening is exactly: catalog returns me.* + `entity.detail`; inside run(), only account/engagement/deliverable providers with `selfOnlyAllowed` and staffed visibility (engagement grant or account-team row). AR rollups (`statement_of_account`, `pending_invoices`) deny self-only + restricted + board_observer, mirroring wallet AR routes.
- `capabilitiesForPersona` takes a full persona object, not a role string — passing a string silently falls through to the default (unclamped) branch.
- Deterministic suite: `pnpm --filter @workspace/api-server run test:entity-detail` (in-process, seeds org_t853 rows, cleans up).
