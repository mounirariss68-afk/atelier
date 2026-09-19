import "../crm/scratch-db.js";

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import {
  db,
  pool,
  atelierAssistantObservations,
  atelierAssistantRetentionHolds,
  atelierCliTurns,
} from "@workspace/db";
import {
  RISER_OBSERVABILITY_VERSION,
  RiserObservationV1Schema,
  type RiserObservationV1,
} from "@workspace/assistant-protocol";
import {
  checkRiserObservationCompleteness,
  evaluateRiserObservabilityAlerts,
  recordRiserObservation,
  recordRiserObservationTx,
  reconcileRiserObservationWindow,
  reconstructRiserTraces,
  riserDashboardRollup,
} from "../../src/lib/assistant/observability-runtime.js";
import { runRetention } from "../../src/lib/atelier-cli/retention.js";

for (const migration of [
  "0085_riser_privacy_reconciliation.sql",
  "0086_riser_observability.sql",
]) {
  await pool.query(
    readFileSync(
      new URL(`../../../../lib/db/drizzle/${migration}`, import.meta.url),
      "utf8",
    ),
  );
}

const suffix = randomUUID();
const orgId = `org_obs_${suffix}`;
const turnId = `turn_obs_${suffix}`;
const actionId = `action_obs_${suffix}`;
const workItemId = `work_obs_${suffix}`;
const observations: RiserObservationV1[] = [];

const add = async (
  args: Parameters<typeof recordRiserObservation>[0],
): Promise<void> => {
  const row = await recordRiserObservation(args);
  assert.ok(row);
  observations.push(row);
};

try {
  await add({
    orgId,
    turnId,
    conversationId: `conversation_${suffix}`,
    intentId: `intent_${suffix}`,
    stage: "interpretation",
    outcome: "supported",
    modelVersion: "router-v1",
  });
  await add({
    orgId,
    turnId,
    stage: "candidate_selection",
    outcome: "no_tool",
    catalogVersion: "catalog-v1",
    dimensions: { candidate_count: 0 },
  });
  await add({
    orgId,
    turnId,
    stage: "presentation_suppressed",
    outcome: "no_relevant_card",
    reasonCode: "no_tool",
  });
  await add({
    orgId,
    turnId,
    stage: "terminal_outcome",
    outcome: "succeeded",
  });

  for (const [stage, outcome, securityEvent] of [
    ["policy", "allowed", true],
    ["preview", "awaiting_confirmation", false],
    ["confirm", "confirmed", true],
    ["execute", "succeeded", true],
    ["terminal_outcome", "succeeded", false],
  ] as const) {
    await add({ orgId, actionId, stage, outcome, securityEvent });
  }

  await add({
    orgId,
    workItemId,
    stage: "workflow_plan",
    outcome: "created",
  });
  await add({
    orgId,
    workItemId,
    stepId: `step_${suffix}`,
    attemptId: `attempt_${suffix}`,
    stage: "workflow_attempt",
    outcome: "succeeded",
  });
  await add({
    orgId,
    workItemId,
    stage: "terminal_outcome",
    outcome: "succeeded",
  });

  await add({
    orgId,
    turnId: `turn_replay_${suffix}`,
    stage: "replay",
    outcome: "requested",
  });
  await add({
    orgId,
    turnId: `turn_replay_${suffix}`,
    stage: "replay",
    outcome: "completed",
  });

  const security = await recordRiserObservation({
    orgId,
    actionId: `action_security_${suffix}`,
    stage: "security",
    outcome: "forged_confirm_rejected",
    securityEvent: true,
    sampleRate: 0,
  });
  assert.equal(security?.samplingMode, "always");
  assert.equal(security?.sampleRate, 1);
  observations.push(security!);

  const dropped = await recordRiserObservation({
    orgId,
    turnId: `turn_dropped_${suffix}`,
    stage: "interpretation",
    outcome: "supported",
    sampleRate: 0,
  });
  assert.equal(dropped, null);

  assert.throws(() =>
    RiserObservationV1Schema.parse({
      version: RISER_OBSERVABILITY_VERSION,
      eventId: "aobs_canary",
      orgId,
      stage: "security",
      outcome: "blocked",
      securityEvent: true,
      samplingMode: "always",
      sampleRate: 1,
      occurredAt: new Date().toISOString(),
      actionId,
      dimensions: { prompt: "RISER CANARY SECRET WITH SPACES" },
    }),
  );
  assert.throws(() =>
    RiserObservationV1Schema.parse({
      ...observations[0],
      eventId: "aobs_secret_token",
      modelVersion: "sk_live_ABC123",
    }),
  );

  await db.transaction(async (tx) => {
    await tx.execute(
      sql.raw(
        "ALTER TABLE atelier_assistant_observations RENAME TO atelier_assistant_observations_unavailable",
      ),
    );
    const isolatedFailure = await recordRiserObservationTx(tx, {
      orgId,
      turnId: `turn_isolated_${suffix}`,
      stage: "interpretation",
      outcome: "supported",
    });
    assert.equal(isolatedFailure, null);
    await tx.execute(
      sql.raw(
        "ALTER TABLE atelier_assistant_observations_unavailable RENAME TO atelier_assistant_observations",
      ),
    );
    const proof = await tx.execute(sql`SELECT 1 AS ok`);
    assert.equal(proof.rows[0]?.ok, 1);
  });

  assert.deepEqual(checkRiserObservationCompleteness(observations), []);
  const traces = reconstructRiserTraces(observations);
  assert.ok(traces.some((trace) => trace.key === `turn:${turnId}`));
  assert.ok(traces.some((trace) => trace.key === `action:${actionId}`));
  assert.ok(traces.some((trace) => trace.key === `work:${workItemId}`));

  const dashboard = riserDashboardRollup(observations);
  assert.equal(dashboard.noToolTurns >= 1, true);
  assert.equal(dashboard.presentation.relevanceDecisionCoverage, 1);
  assert.equal(dashboard.replay.gapRate, 0);
  assert.equal(dashboard.completenessDefects, 0);
  assert.deepEqual(evaluateRiserObservabilityAlerts(observations), []);

  const preAttemptTerminal = RiserObservationV1Schema.parse({
    ...observations[0],
    eventId: `aobs_pre_attempt_terminal_${suffix}`,
    turnId: null,
    conversationId: null,
    workItemId: `work_pre_attempt_${suffix}`,
    stage: "terminal_outcome",
    outcome: "failed",
    reasonCode: "catalog_mismatch",
  });
  assert.deepEqual(checkRiserObservationCompleteness([preAttemptTerminal]), []);

  const countedProposal = RiserObservationV1Schema.parse({
    ...observations[0],
    eventId: `aobs_counted_proposal_${suffix}`,
    stage: "presentation_proposed",
    outcome: "evaluated",
    dimensions: { proposed_count: 2 },
  });
  const countedEmission = RiserObservationV1Schema.parse({
    ...observations[0],
    eventId: `aobs_counted_emission_${suffix}`,
    stage: "presentation_emitted",
    outcome: "relevant",
    dimensions: { emitted_count: 1 },
  });
  const countedDashboard = riserDashboardRollup([
    countedProposal,
    countedEmission,
  ]);
  assert.equal(countedDashboard.presentation.relevanceDecisionCoverage, 0.5);

  const replayGapDashboard = riserDashboardRollup([
    RiserObservationV1Schema.parse({
      ...observations[0],
      eventId: `aobs_replay_gap_${suffix}`,
      stage: "replay",
      outcome: "requested",
    }),
  ]);
  assert.equal(replayGapDashboard.replay.gaps, 1);

  const missingTurnId = `clit_missing_trace_${suffix}`;
  await db.insert(atelierCliTurns).values({
    id: missingTurnId,
    orgId,
    sessionId: `session_missing_trace_${suffix}`,
    userId: `user_missing_trace_${suffix}`,
    status: "success",
    prompt: "<fixture>",
    createdAt: new Date(Date.now() - 2 * 86_400_000),
    finishedAt: new Date(),
  });
  const missingTrace = await reconcileRiserObservationWindow({
    orgId,
    since: new Date(Date.now() - 60_000),
  });
  assert.ok(
    missingTrace.some(
      (defect) =>
        defect.traceKey === `turn:${missingTurnId}` &&
        defect.code === "turn_missing_entire_trace",
    ),
  );
  await add({
    orgId,
    turnId: missingTurnId,
    stage: "terminal_outcome",
    outcome: "success",
  });
  const reconciledTrace = await reconcileRiserObservationWindow({
    orgId,
    since: new Date(Date.now() - 60_000),
  });
  assert.equal(
    reconciledTrace.some((defect) => defect.traceKey === `turn:${missingTurnId}`),
    false,
  );

  const incomplete = observations.filter(
    (row) => !(row.turnId === turnId && row.stage === "presentation_suppressed"),
  );
  const alerts = evaluateRiserObservabilityAlerts(incomplete);
  assert.ok(alerts.some((alert) => alert.code === "observation_completeness_gap"));
  assert.ok(alerts.every((alert) => alert.incidentLink && alert.runbookLink));

  const durable = await db
    .select()
    .from(atelierAssistantObservations)
    .where(eq(atelierAssistantObservations.orgId, orgId));
  assert.equal(durable.length, observations.length);
  assert.equal(
    durable.some(
      (row) =>
        row.securityEvent &&
        row.samplingMode === "always" &&
        row.sampleRate === 10_000,
    ),
    true,
  );

  const otherOrg = `org_obs_other_${suffix}`;
  await add({
    orgId: otherOrg,
    turnId: `turn_other_${suffix}`,
    stage: "interpretation",
    outcome: "supported",
  });
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('app.org_id', ${orgId}, true), set_config('app.user_id', 'system:retention', true)`,
    );
    await tx.execute(sql.raw("SET LOCAL ROLE atelier_retention_executor"));
    const scoped = await tx.execute(
      sql`SELECT DISTINCT org_id FROM atelier_assistant_observations`,
    );
    assert.deepEqual(scoped.rows.map((row) => row.org_id), [orgId]);
  });

  const nowMs = Date.now();
  const old100 = new Date(nowMs - 100 * 86_400_000);
  const old366 = new Date(nowMs - 366 * 86_400_000);
  const heldObservationId = `aobs_held_${suffix}`;
  await db.insert(atelierAssistantObservations).values([
    {
      id: `aobs_expired_info_${suffix}`,
      version: RISER_OBSERVABILITY_VERSION,
      orgId,
      stage: "interpretation",
      outcome: "supported",
      conversationId: null,
      turnId: `turn_expired_info_${suffix}`,
      dimensions: {},
      occurredAt: old100,
      createdAt: old100,
    },
    {
      id: `aobs_current_security_${suffix}`,
      version: RISER_OBSERVABILITY_VERSION,
      orgId,
      stage: "security",
      outcome: "rejected",
      securityEvent: true,
      conversationId: null,
      actionId: `action_current_security_${suffix}`,
      dimensions: {},
      occurredAt: old100,
      createdAt: old100,
    },
    {
      id: `aobs_expired_security_${suffix}`,
      version: RISER_OBSERVABILITY_VERSION,
      orgId,
      stage: "security",
      outcome: "rejected",
      securityEvent: true,
      conversationId: null,
      actionId: `action_expired_security_${suffix}`,
      dimensions: {},
      occurredAt: old366,
      createdAt: old366,
    },
    {
      id: heldObservationId,
      version: RISER_OBSERVABILITY_VERSION,
      orgId,
      stage: "interpretation",
      outcome: "supported",
      conversationId: null,
      turnId: `turn_held_${suffix}`,
      dimensions: {},
      occurredAt: old100,
      createdAt: old100,
    },
  ]);
  await db.insert(atelierAssistantRetentionHolds).values({
    id: `hold_observation_${suffix}`,
    orgId,
    resourceType: "assistant_observation",
    resourceId: heldObservationId,
    reason: "observability-retention-fixture",
    createdByUserId: "system:test",
  });
  const retention = await runRetention(nowMs, orgId);
  assert.equal(retention.observationsPurged, 2);
  const retained = await db
    .select({ id: atelierAssistantObservations.id })
    .from(atelierAssistantObservations)
    .where(eq(atelierAssistantObservations.orgId, orgId));
  const retainedIds = new Set(retained.map((row) => row.id));
  assert.equal(retainedIds.has(`aobs_current_security_${suffix}`), true);
  assert.equal(retainedIds.has(heldObservationId), true);
  console.log("riser observability completeness, dashboard, and alert probes passed");
} finally {
  await db
    .delete(atelierCliTurns)
    .where(eq(atelierCliTurns.id, `clit_missing_trace_${suffix}`));
  await db
    .delete(atelierAssistantRetentionHolds)
    .where(eq(atelierAssistantRetentionHolds.orgId, orgId));
  await db
    .delete(atelierAssistantObservations)
    .where(sql`${atelierAssistantObservations.orgId} in (${orgId}, ${`org_obs_other_${suffix}`})`);
  await pool.end();
}