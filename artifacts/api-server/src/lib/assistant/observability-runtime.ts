import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, atelierAssistantObservations } from "@workspace/db";
import {
  RISER_OBSERVABILITY_VERSION,
  RiserObservationV1Schema,
  type RiserObservationStageV1,
  type RiserObservationV1,
} from "@workspace/assistant-protocol";

type ObservationTransaction =
  Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface RecordRiserObservationArgs {
  orgId: string;
  stage: RiserObservationStageV1;
  outcome: string;
  securityEvent?: boolean;
  sampleRate?: number;
  sampleKey?: string;
  occurredAt?: Date;
  conversationId?: string | null;
  turnId?: string | null;
  intentId?: string | null;
  actionId?: string | null;
  workItemId?: string | null;
  stepId?: string | null;
  attemptId?: string | null;
  capabilityId?: string | null;
  catalogVersion?: string | null;
  schemaVersion?: string | null;
  policyVersion?: string | null;
  modelVersion?: string | null;
  deploymentVersion?: string | null;
  reasonCode?: string | null;
  dimensions?: Record<string, string | number | boolean>;
}

function deterministicSample(key: string, rate: number): boolean {
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  const digest = createHash("sha256").update(key).digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000 < rate;
}

function buildObservation(
  args: RecordRiserObservationArgs,
): RiserObservationV1 | null {
  const securityEvent = args.securityEvent ?? false;
  const sampleRate = securityEvent ? 1 : Math.min(1, Math.max(0, args.sampleRate ?? 1));
  const samplingMode = securityEvent || sampleRate === 1 ? "always" : "deterministic";
  const sampleKey =
    args.sampleKey ??
    [
      args.orgId,
      args.conversationId,
      args.turnId,
      args.actionId,
      args.workItemId,
      args.attemptId,
      args.stage,
      args.outcome,
    ]
      .filter(Boolean)
      .join(":");
  if (samplingMode === "deterministic" && !deterministicSample(sampleKey, sampleRate)) {
    return null;
  }
  const parsed = RiserObservationV1Schema.safeParse({
    version: RISER_OBSERVABILITY_VERSION,
    eventId: `aobs_${randomUUID()}`,
    orgId: args.orgId,
    stage: args.stage,
    outcome: args.outcome,
    securityEvent,
    samplingMode,
    sampleRate,
    occurredAt: (args.occurredAt ?? new Date()).toISOString(),
    conversationId: args.conversationId,
    turnId: args.turnId,
    intentId: args.intentId,
    actionId: args.actionId,
    workItemId: args.workItemId,
    stepId: args.stepId,
    attemptId: args.attemptId,
    capabilityId: args.capabilityId,
    catalogVersion: args.catalogVersion,
    schemaVersion: args.schemaVersion,
    policyVersion: args.policyVersion,
    modelVersion: args.modelVersion,
    deploymentVersion: args.deploymentVersion,
    reasonCode: args.reasonCode,
    dimensions: args.dimensions ?? {},
  });
  return parsed.success ? parsed.data : null;
}

export async function recordRiserObservationTx(
  tx: ObservationTransaction,
  args: RecordRiserObservationArgs,
): Promise<RiserObservationV1 | null> {
  const observation = buildObservation(args);
  if (!observation) return null;
  await tx.execute(sql.raw("SAVEPOINT riser_observation_emit"));
  try {
    await tx.insert(atelierAssistantObservations).values({
      id: observation.eventId,
      version: observation.version,
      orgId: observation.orgId,
      stage: observation.stage,
      outcome: observation.outcome,
      securityEvent: observation.securityEvent,
      samplingMode: observation.samplingMode,
      sampleRate: Math.round(observation.sampleRate * 10_000),
      conversationId: observation.conversationId,
      turnId: observation.turnId,
      intentId: observation.intentId,
      actionId: observation.actionId,
      workItemId: observation.workItemId,
      stepId: observation.stepId,
      attemptId: observation.attemptId,
      capabilityId: observation.capabilityId,
      catalogVersion: observation.catalogVersion,
      schemaVersion: observation.schemaVersion,
      policyVersion: observation.policyVersion,
      modelVersion: observation.modelVersion,
      deploymentVersion: observation.deploymentVersion,
      reasonCode: observation.reasonCode,
      dimensions: observation.dimensions,
      occurredAt: new Date(observation.occurredAt),
    });
    await tx.execute(sql.raw("RELEASE SAVEPOINT riser_observation_emit"));
    return observation;
  } catch {
    await tx.execute(sql.raw("ROLLBACK TO SAVEPOINT riser_observation_emit"));
    await tx.execute(sql.raw("RELEASE SAVEPOINT riser_observation_emit"));
    return null;
  }
}

export async function recordRiserObservation(
  args: RecordRiserObservationArgs,
): Promise<RiserObservationV1 | null> {
  return db.transaction((tx) => recordRiserObservationTx(tx, args));
}

export async function recordRiserTurnProjection(args: {
  orgId: string;
  conversationId: string;
  turnId: string;
  intentKind: string;
  intentOperation: string;
  modelVersion: string;
  catalogVersion: string;
  candidateCount: number;
  toolCount: number;
  successfulToolCount: number;
  presentationProposedCount: number;
  presentationEmittedCount: number;
  presentationSuppressedCount: number;
  status: string;
}): Promise<void> {
  const safeCode = (value: string) =>
    value.replace(/[^A-Za-z0-9_.:/@+-]/g, "_").slice(0, 120) || "unknown";
  await db.transaction(async (tx) => {
    const base = {
      orgId: args.orgId,
      conversationId: args.conversationId,
      turnId: args.turnId,
      catalogVersion: args.catalogVersion,
      modelVersion: safeCode(args.modelVersion),
      deploymentVersion: safeCode(
        process.env.REPLIT_DEPLOYMENT_ID ?? "development",
      ),
    } as const;
    await recordRiserObservationTx(tx, {
      ...base,
      intentId: safeCode(args.intentKind),
      stage: "interpretation",
      outcome: safeCode(args.intentOperation) as
        | "read"
        | "create"
        | "update"
        | "link"
        | "transition"
        | "delete"
        | "navigate"
        | "workflow"
        | "reset"
        | "trivial"
        | "other",
    });
    if (args.candidateCount > 0) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "candidate_selection",
        outcome: "selected",
        dimensions: { candidate_count: args.candidateCount },
      });
    } else {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "abstention",
        outcome: "no_tool",
        reasonCode: "no_tool",
        dimensions: { candidate_count: 0 },
      });
    }
    if (args.toolCount > 0) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "execute",
        outcome:
          args.successfulToolCount === args.toolCount
            ? "succeeded"
            : args.successfulToolCount > 0
              ? "partial"
              : "failed",
        dimensions: {
          tool_count: args.toolCount,
          successful_tool_count: args.successfulToolCount,
        },
      });
    }
    if (args.presentationProposedCount > 0) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "presentation_proposed",
        outcome: "evaluated",
        dimensions: { proposed_count: args.presentationProposedCount },
      });
    }
    if (args.presentationEmittedCount > 0) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "presentation_emitted",
        outcome: "relevant",
        dimensions: { emitted_count: args.presentationEmittedCount },
      });
    }
    if (
      args.presentationSuppressedCount > 0 ||
      (args.presentationProposedCount === 0 &&
        args.presentationEmittedCount === 0)
    ) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "presentation_suppressed",
        outcome: "no_relevant_card",
        reasonCode: "no_relevant_card",
        dimensions: {
          suppressed_count: Math.max(1, args.presentationSuppressedCount),
        },
      });
    }
    const terminalStatuses = new Set([
      "success",
      "error",
      "partial",
      "read_only_no_op",
      "async_dispatched",
      "cancelled",
      "failed",
      "succeeded",
    ]);
    if (terminalStatuses.has(args.status)) {
      await recordRiserObservationTx(tx, {
        ...base,
        stage: "terminal_outcome",
        outcome: safeCode(args.status),
      });
    }
  });
}

export interface RiserTrace {
  key: string;
  observations: RiserObservationV1[];
}

function traceKey(observation: RiserObservationV1): string {
  if (observation.actionId) return `action:${observation.actionId}`;
  if (observation.workItemId) return `work:${observation.workItemId}`;
  if (observation.turnId) return `turn:${observation.turnId}`;
  if (observation.conversationId) return `conversation:${observation.conversationId}`;
  return `attempt:${observation.attemptId}`;
}

export function reconstructRiserTraces(
  observations: RiserObservationV1[],
): RiserTrace[] {
  const grouped = new Map<string, RiserObservationV1[]>();
  for (const raw of observations) {
    const observation = RiserObservationV1Schema.parse(raw);
    const key = traceKey(observation);
    const rows = grouped.get(key) ?? [];
    rows.push(observation);
    grouped.set(key, rows);
  }
  return [...grouped.entries()]
    .map(([key, rows]) => ({
      key,
      observations: rows.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export interface RiserCompletenessDefect {
  traceKey: string;
  code: string;
}

export function checkRiserObservationCompleteness(
  observations: RiserObservationV1[],
): RiserCompletenessDefect[] {
  const defects: RiserCompletenessDefect[] = [];
  for (const trace of reconstructRiserTraces(observations)) {
    const stages = new Set(trace.observations.map((row) => row.stage));
    const has = (...candidates: RiserObservationStageV1[]) =>
      candidates.some((candidate) => stages.has(candidate));
    if (stages.has("terminal_outcome") && trace.key.startsWith("turn:")) {
      if (!has("interpretation")) {
        defects.push({ traceKey: trace.key, code: "turn_missing_interpretation" });
      }
      if (!has("candidate_selection", "abstention")) {
        defects.push({ traceKey: trace.key, code: "turn_missing_selection_or_abstention" });
      }
      if (!has("presentation_emitted", "presentation_suppressed")) {
        defects.push({ traceKey: trace.key, code: "turn_missing_presentation_decision" });
      }
    }
    if (stages.has("execute") && trace.key.startsWith("action:")) {
      for (const required of ["policy", "preview", "confirm"] as const) {
        if (!stages.has(required)) {
          defects.push({
            traceKey: trace.key,
            code: `action_missing_${required}`,
          });
        }
      }
    }
  }
  return defects;
}

export function riserDashboardRollup(observations: RiserObservationV1[]) {
  const rows = observations.map((row) => RiserObservationV1Schema.parse(row));
  const turnKeys = new Set(
    rows.filter((row) => row.turnId).map((row) => `${row.orgId}:${row.turnId}`),
  );
  const executedTurnKeys = new Set(
    rows
      .filter((row) => row.turnId && row.stage === "execute")
      .map((row) => `${row.orgId}:${row.turnId}`),
  );
  const countDimension = (
    row: RiserObservationV1,
    key: string,
  ): number => {
    const value = row.dimensions[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 1;
  };
  const presentationProposed = rows
    .filter((row) => row.stage === "presentation_proposed")
    .reduce((sum, row) => sum + countDimension(row, "proposed_count"), 0);
  const presentationEmitted = rows
    .filter((row) => row.stage === "presentation_emitted")
    .reduce((sum, row) => sum + countDimension(row, "emitted_count"), 0);
  const presentationSuppressed = rows
    .filter((row) => row.stage === "presentation_suppressed")
    .reduce((sum, row) => sum + countDimension(row, "suppressed_count"), 0);
  const replayByTrace = new Map<
    string,
    { requested: number; completed: number; explicitGap: number }
  >();
  for (const row of rows.filter((item) => item.stage === "replay")) {
    const key = `${row.orgId}:${row.turnId ?? row.actionId ?? row.workItemId ?? row.attemptId}`;
    const counts = replayByTrace.get(key) ?? {
      requested: 0,
      completed: 0,
      explicitGap: 0,
    };
    if (row.outcome === "requested") counts.requested += 1;
    if (row.outcome === "completed") counts.completed += 1;
    if (row.outcome === "gap") counts.explicitGap += 1;
    replayByTrace.set(key, counts);
  }
  const replayRequested = [...replayByTrace.values()].reduce(
    (sum, value) => sum + value.requested,
    0,
  );
  const replayGap = [...replayByTrace.values()].reduce(
    (sum, value) =>
      sum +
      value.explicitGap +
      Math.max(0, value.requested - value.completed),
    0,
  );
  return {
    turns: turnKeys.size,
    noToolTurns: [...turnKeys].filter((key) => !executedTurnKeys.has(key)).length,
    presentation: {
      proposed: presentationProposed,
      emitted: presentationEmitted,
      suppressed: presentationSuppressed,
      relevanceDecisionCoverage:
        presentationProposed === 0
          ? 1
          : (presentationEmitted + presentationSuppressed) / presentationProposed,
    },
    replay: {
      requested: replayRequested,
      gaps: replayGap,
      gapRate: replayRequested === 0 ? 0 : replayGap / replayRequested,
    },
    completenessDefects: checkRiserObservationCompleteness(rows).length,
  };
}

export async function reconcileRiserObservationWindow(args: {
  orgId: string;
  since: Date;
}): Promise<RiserCompletenessDefect[]> {
  const result = await db.execute<{ trace_key: string; code: string }>(sql`
    SELECT 'turn:' || t.id AS trace_key, 'turn_missing_entire_trace' AS code
    FROM atelier_cli_turns t
    WHERE t.org_id = ${args.orgId}
      AND t.finished_at >= ${args.since}
      AND t.status NOT IN ('awaiting_confirmation','awaiting_clarification')
      AND NOT EXISTS (
        SELECT 1 FROM atelier_assistant_observations o
        WHERE o.org_id = t.org_id AND o.turn_id = t.id
          AND o.stage = 'terminal_outcome'
      )
    UNION ALL
    SELECT 'action:' || a.id, 'action_missing_entire_trace'
    FROM atelier_assistant_actions a
    WHERE a.org_id = ${args.orgId}
      AND a.completed_at >= ${args.since}
      AND a.state IN (
        'succeeded','failed','partially_succeeded','compensated',
        'cancelled','expired','invalidated'
      )
      AND NOT EXISTS (
        SELECT 1 FROM atelier_assistant_observations o
        WHERE o.org_id = a.org_id AND o.action_id = a.id
          AND o.stage = 'terminal_outcome'
      )
    UNION ALL
    SELECT 'work:' || w.id, 'work_missing_entire_trace'
    FROM atelier_work_items w
    WHERE w.org_id = ${args.orgId}
      AND w.completed_at >= ${args.since}
      AND w.status IN ('succeeded','failed','cancelled','compensated')
      AND NOT EXISTS (
        SELECT 1 FROM atelier_assistant_observations o
        WHERE o.org_id = w.org_id AND o.work_item_id = w.id
          AND o.stage = 'terminal_outcome'
      )
    UNION ALL
    SELECT 'attempt:' || a.id, 'attempt_missing_entire_trace'
    FROM atelier_work_attempts a
    JOIN atelier_work_steps s ON s.id = a.step_id
    JOIN atelier_work_items w ON w.id = s.work_item_id
    WHERE w.org_id = ${args.orgId}
      AND a.ended_at >= ${args.since}
      AND a.status IN (
        'succeeded','retryable','permanent','ambiguous','blocked',
        'cancelled','compensation_required','compensated'
      )
      AND NOT EXISTS (
        SELECT 1 FROM atelier_assistant_observations o
        WHERE o.org_id = w.org_id AND o.attempt_id = a.id
          AND o.stage = 'workflow_attempt'
      )
  `);
  return result.rows.map((row) => ({
    traceKey: row.trace_key,
    code: row.code,
  }));
}

export interface RiserAlert {
  code: string;
  severity: "warning" | "critical";
  incidentLink: string;
  runbookLink: string;
}

export function evaluateRiserObservabilityAlerts(
  observations: RiserObservationV1[],
): RiserAlert[] {
  const dashboard = riserDashboardRollup(observations);
  const alerts: RiserAlert[] = [];
  const add = (code: string, severity: "warning" | "critical") =>
    alerts.push({
      code,
      severity,
      incidentLink: `incident://riser/${code}`,
      runbookLink: "docs://riser/observability-runbook/v1",
    });
  if (dashboard.completenessDefects > 0) {
    add("observation_completeness_gap", "critical");
  }
  if (dashboard.presentation.relevanceDecisionCoverage < 0.995) {
    add("presentation_decision_gap", "critical");
  }
  if (dashboard.replay.gapRate > 0) add("replay_gap", "critical");
  if (
    observations.some(
      (row) =>
        row.stage === "security" &&
        (row.samplingMode !== "always" || row.sampleRate !== 1),
    )
  ) {
    add("security_event_sampling_violation", "critical");
  }
  return alerts;
}