# Riser observability v1

Status: C23 complete — independently reviewed PASS  
Contract: `riser-observability/v1`

## Authority boundary

Observations are derived from authoritative turn, action, and workflow state.
They never authorize work, satisfy confirmation, advance a workflow, prove a
side effect, or replace the durable action/audit streams. Observation writes
inside authoritative transactions use database savepoints: schema, permission,
or table failures return no observation and do not abort authoritative state.

The observation contract accepts identifiers, versions, bounded reason codes,
booleans, and numeric counters only. It rejects prompts, labels, free-form
errors, provider payloads, tool input/output, secrets, and PII.

## Correlation and stages

Every event has an organization and at least one conversation, turn, action,
work item, or attempt correlation. Optional correlations cover intent, step,
capability, catalog, schema, policy, model, and deployment versions.

The versioned stage taxonomy covers:

- interpretation, candidate selection, and abstention;
- resolution and policy;
- preview, confirmation, execution, and replay;
- workflow plans, attempts, leases, retries, and compensation;
- presentation proposed, emitted, or suppressed; and
- terminal and security outcomes.

## Retention and sampling

- Security observations are unsampled and must declare
  `samplingMode=always` and `sampleRate=1`.
- State-transition and terminal observations are retained at rate 1.
- High-volume informational observations may use deterministic sampling keyed
  by stable correlation IDs. Sampling decisions are reproducible.
- Default online retention is 90 days. Security and terminal observations are
  retained for 365 days. Exact observation holds and parent action, work, turn,
  or conversation holds override deletion.
- Observation dimensions must remain content-free even when data is retained
  under hold.

## Dashboards

Founder-only, organization-scoped endpoints:

- `GET /api/atelier/cli/admin/riser-observability?days=7` returns bounded
  no-tool turn counts, presentation decision coverage, replay-gap rate,
  completeness defects, and active alerts.
- `GET /api/atelier/cli/admin/riser-observability/traces/:id` reconstructs a
  bounded content-free trace by conversation, turn, action, work, step, or
  attempt ID.

No endpoint returns observation-adjacent prompts or arbitrary payloads.
If a requested window exceeds the 20,000-row online bound, the endpoint
returns no dashboard metrics and raises a critical bounded-window alert rather
than calculating biased SLOs.

## SLOs and alerts

Release and canary gates use these initial SLOs:

| Signal | SLO | Alert |
| --- | ---: | --- |
| trace completeness | 100% | any defect is critical |
| presentation decision coverage | >=99.5% | below target is critical |
| replay gap rate | 0% | any gap is critical |
| security events bypass sampling | 100% | any violation is critical |

Every generated alert includes an incident link and the versioned runbook link.
Alert evaluation never suppresses a security failure because aggregate metrics
look healthy.

## Incident procedure

1. Open the linked incident and freeze affected rollout cohorts.
2. Query the bounded content-free trace and authoritative action/workflow
   records separately.
3. Treat missing telemetry as an observability incident, not proof that work
   did or did not execute.
4. Preserve durable audit/action/workflow records.
5. Repair dual emission or dashboard logic without replaying a write.
6. Run the C23 rehearsal and the foundation/replay gates.
7. Resume only after completeness, presentation coverage, and replay-gap SLOs
   are green.

Completeness combines content-free trace checks with reconciliation against
authoritative terminal turns, actions, work items, and attempts by transition
timestamp. A wholly missing observation trace is therefore a defect.

## Migration and rollback

Migration is dual emission: legacy CLI telemetry and v1 observations remain
active while counts are compared. Dashboards read v1 only after the C23
rehearsal and canary count checks pass. Legacy telemetry is not removed during
canary.

Rollback disables v1 projection/dashboard reads while preserving authoritative
events and audit. It must not revert or replay an action. Schema removal is
deferred until all supported releases no longer read v1.

## Verification

`pnpm --filter @workspace/api-server run test:riser-observability` verifies:

- durable writes and organization correlation;
- deterministic sampling and unsampled security events;
- turn, action, and workflow reconstruction;
- completeness and no-tool/card/replay dashboard queries;
- rejection of a redaction canary;
- transaction savepoint isolation under a real observation-table failure;
- lifecycle-role RLS isolation and 90/365-day hold-aware retention;
- authoritative-record reconciliation for a wholly missing trace;
- explicit presentation counts and per-trace replay interruption gaps;
- alert firing with incident and runbook links; and
- zero observation authority over execution state.