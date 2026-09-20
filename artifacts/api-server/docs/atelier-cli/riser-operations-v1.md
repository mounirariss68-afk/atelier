# Riser operations and compatibility reference v1

Status: implementation reference; production completion remains gated by the
machine-readable owner and approval record in
[riser-ownership-signoff-v1.json](./riser-ownership-signoff-v1.json).

## Versioned contracts and generated references

- Protocol, event, action, workflow, evaluation, privacy, and operator-control
  schemas are exported by
  [`@workspace/assistant-protocol`](../../../../lib/assistant-protocol/src/index.ts).
- The reviewed 326-entry catalog is
  [`capability-manifest.v1.json`](../../src/lib/atelier-cli/generated/capability-manifest.v1.json).
- The route/capability report is
  [`route-conformance.v1.json`](../../src/lib/atelier-cli/generated/route-conformance.v1.json).
- Evaluation fixtures, thresholds, and the latest report live in
  [`tests/riser-eval`](../../tests/riser-eval).
- The compatibility adapter remains documented by
  [`compatibility.ts`](../../src/lib/assistant/compatibility.ts) and tested by
  [`tests/riser-compat`](../../tests/riser-compat).

Documentation versions move with the contract versions they describe. Previous
versions remain available while any supported client or persisted record still
depends on them.

## Authority and security boundary

The model proposes typed intent and tool input. It never authorizes access,
confirms an action, grants workflow authority, or proves execution. Server-owned
authentication, tenant/role policy, target revision checks, action state,
confirmation evidence, idempotency, fencing, budgets, provider controls, and
audit events are authoritative. A card, narration, `navigateTo`, model claim, or
tool-returned success is not execution evidence.

Restricted values are admitted to providers only through the provider
allowlist in
[`privacy.ts`](../../../../lib/assistant-protocol/src/privacy.ts). Durable
events, logs, telemetry, public responses, and encrypted persistence each have a
separate maximum data class. Secret canaries must never appear in public,
durable-event, log, or telemetry sinks.

### Threat model

| Boundary | Threat | Required control and proof |
|---|---|---|
| client → ingress | forged org, role, version, confirmation | authenticated server context, strict schemas, negative auth fixtures |
| model → capability | hallucinated tool or authority | reviewed manifest, deterministic policy, unsupported outcome |
| preview → execute | stale/forged/replayed approval | owner/org/digest/version/expiry checks and exactly-once action claim |
| worker → commit | stale lease or split brain | monotonically increasing fencing token and CAS commit |
| provider → reconciliation | lost/duplicate/ambiguous result | unique provider result, durable action state, operator reconciliation |
| event → client | replay gap, out-of-order terminal state | durable conversation sequence and cursor replay |
| legacy adapter → canonical runtime | weakened auth or semantic drift | compatibility matrix and parity fixtures |
| operator → control plane | over-broad rollback or silent partial control | org-scoped audited controls and append-only rollout events |

Security incidents halt the affected cohort immediately. New writes stay denied
until provider results, event sequences, controls, and audits reconcile.

## Provider data-classification matrix

| Provider | Maximum class | Allowed purpose | Prohibited |
|---|---|---|---|
| Anthropic | restricted | typed interpretation and authorized tool orchestration | credentials, secrets, unrelated tenant data |
| CogniDocs | secret | authorized document parsing | reuse outside the submitted document job |
| Perplexity | restricted | approved external research | private internal records not needed for the query |
| Ignav | confidential | flight search | payroll, identity documents, financial credentials |
| StayingAPI | confidential | hotel search | payroll, identity documents, financial credentials |
| Microsoft Graph | restricted | authorized mail/calendar operations | cross-user access without delegated authority |

Every provider call is fail-closed through provider policy/control checks. A
provider outage yields a typed degraded/unsupported result, not another tool or
an unapproved side effect.

## Capability authoring rules

1. Add the capability to the source catalog with a strict input schema, result
   schema hash, risk class, confirmation mode, outbound channel, representative
   prompts, and supported personas.
2. Implement server-side ACL and target scoping before candidate capping.
3. Generated manifest and route conformance files must be regenerated and
   reviewed; hand edits are prohibited.
4. Add direct ranking, auth, privacy, presentation, parity, and provider-fault
   observations. Severity-one security failures cannot be averaged away.
5. Writes use the durable action executor; only genuinely multi-step work uses
   the workflow runtime.
6. Every commit-success write emits a durable terminal event and audit lineage.
7. Run `check:riser-manifest`, `check:route-conformance`, `test:riser-eval`, and
   the relevant runtime/client suites before release.

## Migration guide

All stages follow: expand → shadow/dual → backfill/verify → cohort canary →
cutover → compatibility retention → cleanup. Each transition pins schema,
protocol, catalog, policy, model/router, client cohort, measured exit criteria,
and immutable evidence in the staged rollout runtime.

Database migrations are forward-compatible during canary. Readers/upcasters
expand before writers change. Pending confirmations preserve owner, policy,
target revisions, expiry, schema/catalog versions, and typed evidence. Historical
atomic work is not rewritten as fake workflows. Destructive cleanup is forbidden
before compatibility retention and an approved client sunset threshold.

Migration `0089_riser_staged_rollouts.sql` is forward-only while rollout/audit
evidence is in retention. Rollback freezes admission and reconciles state; it
does not drop rollout, action, workflow, event, or audit records.

## Canary and rollback runbook

### Canary entry

1. Confirm evaluation, privacy, runtime, compatibility, observability, control,
   rollout, web, and mobile gates are green.
2. Pin all versions and an explicit organization/client cohort.
3. Record exit criteria and zero-tolerance alarms for security, duplicate
   commits, replay gaps, and false dispatch.
4. Start only at `expand`; stage skipping and cleanup during canary are rejected.

### Automatic halt and state-aware rollback

1. Deny new affected actions and plans.
2. Preserve read and status paths.
3. Freeze workers, revoke running leases, and increment fencing tokens.
4. Classify pending actions, executing provider writes, work, and attempts.
5. Finish, fail, or compensate according to persisted policy; committing
   external effects are never guessed or blindly retried.
6. Reconcile every executing action to one unique provider result.
7. Disable linked rollout controls and restore the compatible route.
8. Compute audit continuity from contiguous rollout events, control audits, and
   zero unresolved executing actions before writes may resume.

The rehearsal must include a pending confirmation, SSE cursor reconnect,
executing external write, running workflow, schema skew, and active migration,
and prove one provider result, one terminal state, and no audit loss.

## Client compatibility and deprecation policy

Supported old web/mobile clients may use `/cli/*` only through the measured
compatibility adapter. New clients use canonical Assistant/Workflow APIs and
semantic events. Old-client/new-server and new-client/adapter matrices must pass
auth, replay, confirmation, idempotency, and presentation parity.

`/cli/*` writes are not retired by date. Retirement requires an approved sunset
threshold, measured supported-client adoption above that threshold, zero
supported legacy writers, successful legacy replay, and recorded mobile/web,
security, workflow, data-migration, and SRE approval. Legacy readers and
upcasters remain for the retention period.

## Incident response and observability

Dashboards, SLOs, alerts, dead-letter handling, and incident procedure are
defined in
[`riser-observability-v1.md`](./riser-observability-v1.md). Alarm response uses
the staged rollback runbook above. Operators must not repair state by deleting
events, actions, attempts, rollout evidence, or audit rows.

## Ownership and release approvals

The required owner domains and independent stage approvals are machine-readable
in [riser-ownership-signoff-v1.json](./riser-ownership-signoff-v1.json).
`check:riser-docs --structure` validates documentation structure without
claiming approval. Full `check:riser-docs` is the production gate and fails
while any owner or approval remains pending.