import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { ASSISTANT_PRIVACY_POLICY_VERSION } from "@workspace/assistant-protocol";
import { dropAttachmentBytes } from "./attachments/storage.js";
import { withAssistantLifecycleRlsTransaction } from "../assistant/action-runtime.js";

const DAY_MS = 86_400_000;
export const ASSISTANT_OCR_RETENTION_DAYS = 90;
export const ASSISTANT_PAYLOAD_RETENTION_DAYS = 395;
export const ASSISTANT_AUDIT_SHELL_RETENTION = "indefinite" as const;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function lifecycleTransaction<T>(
  orgId: string | undefined,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return orgId
    ? withAssistantLifecycleRlsTransaction({ orgId }, fn)
    : db.transaction(fn);
}

async function changed(tx: Tx, query: ReturnType<typeof sql>): Promise<number> {
  const result = await tx.execute(query);
  return result.rows.length;
}

const activeHold = (
  resourceType: string,
  orgSql: ReturnType<typeof sql>,
  idSql: ReturnType<typeof sql>,
  now: Date,
) => sql`
  SELECT 1
  FROM atelier_assistant_retention_holds h
  WHERE h.org_id = ${orgSql}
    AND h.resource_type = ${resourceType}
    AND h.resource_id = ${idSql}
    AND h.released_at IS NULL
    AND (h.expires_at IS NULL OR h.expires_at > ${now})
`;

export async function quarantineLegacyAssistantTelemetry(
  nowMs = Date.now(),
  orgId?: string,
): Promise<{ rowsQuarantined: number; orgsRecorded: number }> {
  const now = new Date(nowMs);
  return lifecycleTransaction(orgId, async (tx) => {
    const result = await tx.execute(sql`
      SELECT t.id, t.org_id, t.recording_trace, t.original_payload
      FROM atelier_cli_turns t
      WHERE (t.recording_trace IS NOT NULL OR t.original_payload IS NOT NULL)
        AND (t.legacy_read_until IS NULL OR t.legacy_read_until <= ${now})
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      FOR UPDATE
    `);
    const rows = result.rows as Array<{
      id: string;
      org_id: string;
      recording_trace: unknown;
      original_payload: unknown;
    }>;
    const byOrg = new Map<string, typeof rows>();
    for (const row of rows) {
      const orgRows = byOrg.get(row.org_id) ?? [];
      orgRows.push(row);
      byOrg.set(row.org_id, orgRows);
    }
    for (const [orgId, orgRows] of byOrg) {
      const runId = `apr_${randomUUID()}`;
      await tx.execute(sql`
        INSERT INTO atelier_assistant_privacy_runs
          (id, org_id, kind, policy_version, rows_affected, created_by, occurred_at)
        VALUES (
          ${runId},
          ${orgId},
          'legacy_telemetry_quarantine',
          ${ASSISTANT_PRIVACY_POLICY_VERSION},
          ${orgRows.length},
          'system:retention',
          ${now}
        )
      `);
      for (const row of orgRows) {
        const digest = createHash("sha256")
          .update(JSON.stringify([row.recording_trace, row.original_payload]))
          .digest("hex");
        await tx.execute(sql`
          INSERT INTO atelier_assistant_privacy_run_items
            (id, run_id, org_id, source_type, source_id, policy_version,
             disposition, source_digest, occurred_at)
          VALUES (
            ${`apri_${randomUUID()}`}, ${runId}, ${orgId}, 'cli_turn',
            ${row.id}, ${ASSISTANT_PRIVACY_POLICY_VERSION},
            'payload_quarantined', ${digest}, ${now}
          )
        `);
        await tx.execute(sql`
          UPDATE atelier_cli_turns
          SET recording_trace = NULL,
              original_payload = NULL,
              quarantine_reasons = (
                SELECT jsonb_agg(DISTINCT reason)
                FROM jsonb_array_elements_text(
                  COALESCE(quarantine_reasons, '[]'::jsonb)
                  || '["privacy_legacy_telemetry"]'::jsonb
                ) AS reason
              ),
              redaction_version = ${ASSISTANT_PRIVACY_POLICY_VERSION},
              updated_at = ${now}
          WHERE id = ${row.id}
        `);
      }
    }
    return { rowsQuarantined: rows.length, orgsRecorded: byOrg.size };
  });
}

export interface RetentionSummary {
  ocrPurged: number;
  promptPlanPurged: number;
  actionPayloadsPurged: number;
  eventPayloadsPurged: number;
  workflowPayloadsPurged: number;
  legacyPayloadsPurged: number;
  attachmentBlobsPurged: number;
  scannedRows: number;
}

async function queueExpiredAttachmentBlobs(args: {
  cutoff: Date;
  now: Date;
  userId?: string;
  orgId?: string;
}): Promise<void> {
  await lifecycleTransaction(args.orgId, async (tx) => {
    await tx.execute(sql`
    INSERT INTO atelier_assistant_blob_purge_queue
      (id, org_id, attachment_id, encrypted_ref, state, queued_at, updated_at)
    SELECT
      'abpq_' || gen_random_uuid()::text,
      a.org_id,
      a.id,
      a.encrypted_ref,
      'pending',
      ${args.now},
      ${args.now}
    FROM atelier_cli_attachments a
    WHERE a.encrypted_ref <> ''
      AND ${args.userId ? sql`a.user_id = ${args.userId}` : sql`a.created_at < ${args.cutoff}`}
      AND NOT EXISTS (${activeHold("cli_attachment", sql`a.org_id`, sql`a.id`, args.now)})
      AND (
        a.turn_id IS NULL OR NOT EXISTS (
          ${activeHold("cli_turn", sql`a.org_id`, sql`a.turn_id`, args.now)}
        )
      )
      AND (
        a.session_id IS NULL OR NOT EXISTS (
          ${activeHold("cli_session", sql`a.org_id`, sql`a.session_id`, args.now)}
        )
      )
    ON CONFLICT (attachment_id) DO NOTHING
  `);
  });
}

async function drainAttachmentBlobQueue(
  now: Date,
  orgId?: string,
): Promise<number> {
  const pending = await lifecycleTransaction(orgId, (tx) => tx.execute(sql`
    SELECT id, state, encrypted_ref
    FROM atelier_assistant_blob_purge_queue
    WHERE state IN ('pending', 'retry', 'deleting')
    ORDER BY queued_at
    LIMIT 100
  `));
  let completed = 0;
  for (const pendingRow of pending.rows as Array<{
    id: string;
    state: string;
    encrypted_ref: string;
  }>) {
    const claimed = await lifecycleTransaction(orgId, async (tx) => {
      const result = await tx.execute(sql`
        SELECT q.id, q.state, q.encrypted_ref, a.id AS attachment_id
        FROM atelier_assistant_blob_purge_queue q
        JOIN atelier_cli_attachments a ON a.id = q.attachment_id
        WHERE q.id = ${pendingRow.id}
          AND q.state IN ('pending', 'retry', 'deleting')
          AND (q.state = 'deleting' OR a.encrypted_ref = q.encrypted_ref)
          AND NOT EXISTS (${activeHold("cli_attachment", sql`a.org_id`, sql`a.id`, now)})
          AND (
            a.turn_id IS NULL OR NOT EXISTS (
              ${activeHold("cli_turn", sql`a.org_id`, sql`a.turn_id`, now)}
            )
          )
          AND (
            a.session_id IS NULL OR NOT EXISTS (
              ${activeHold("cli_session", sql`a.org_id`, sql`a.session_id`, now)}
            )
          )
        FOR UPDATE OF q, a
      `);
      const [row] = result.rows as Array<{
        id: string;
        state: string;
        encrypted_ref: string;
        attachment_id: string;
      }>;
      if (!row) return null;
      if (row.state !== "deleting") {
        await tx.execute(sql`
          UPDATE atelier_cli_attachments
          SET encrypted_ref = '', status = 'deleted',
              deleted_at = COALESCE(deleted_at, ${now})
          WHERE id = ${row.attachment_id}
        `);
        await tx.execute(sql`
          UPDATE atelier_assistant_blob_purge_queue
          SET state = 'deleting', attempts = attempts + 1, updated_at = ${now}
          WHERE id = ${row.id}
        `);
      }
      return row;
    });
    if (!claimed) continue;
    try {
      await dropAttachmentBytes(claimed.encrypted_ref);
      await lifecycleTransaction(orgId, (tx) => tx.execute(sql`
        UPDATE atelier_assistant_blob_purge_queue
        SET state = 'completed', completed_at = ${now},
            last_error_code = NULL, updated_at = ${now}
        WHERE id = ${claimed.id}
      `));
      completed += 1;
    } catch {
      await lifecycleTransaction(orgId, (tx) => tx.execute(sql`
        UPDATE atelier_assistant_blob_purge_queue
        SET state = 'deleting', last_error_code = 'object_delete_failed',
            updated_at = ${now}
        WHERE id = ${claimed.id}
      `));
    }
  }
  return completed;
}

export async function runRetention(
  nowMs = Date.now(),
  orgId?: string,
): Promise<RetentionSummary> {
  const now = new Date(nowMs);
  const ocrCutoff = new Date(nowMs - ASSISTANT_OCR_RETENTION_DAYS * DAY_MS);
  const payloadCutoff = new Date(nowMs - ASSISTANT_PAYLOAD_RETENTION_DAYS * DAY_MS);
  await queueExpiredAttachmentBlobs({
    cutoff: payloadCutoff,
    now,
    orgId,
  });
  const attachmentBlobsPurged = await drainAttachmentBlobQueue(now, orgId);

  return lifecycleTransaction(orgId, async (tx) => {
    const ocrPurged = await changed(tx, sql`
      UPDATE atelier_cli_turns t
      SET attachment_refs = '[]'::jsonb, updated_at = ${now}
      WHERE t.created_at < ${ocrCutoff}
        AND t.attachment_refs IS NOT NULL
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      RETURNING t.id
    `);
    const promptPlanPurged = await changed(tx, sql`
      UPDATE atelier_cli_turns t
      SET prompt = '', frames = '[]'::jsonb, tool_calls = '[]'::jsonb,
          page_context = NULL, pending_write = NULL, updated_at = ${now}
      WHERE t.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      RETURNING t.id
    `);
    const actionPayloadsPurged = await changed(tx, sql`
      UPDATE atelier_assistant_actions a
      SET canonical_input_encrypted = '<retained-audit-shell>',
          target_refs_and_revisions = '[]'::jsonb,
          obligations = '[]'::jsonb,
          preview_snapshot = NULL,
          result = NULL,
          public_error = NULL,
          updated_at = ${now}
      WHERE a.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)})
      RETURNING a.id
    `);
    const eventPayloadsPurged = await changed(tx, sql`
      UPDATE atelier_assistant_events e
      SET data = NULL
      WHERE e.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("assistant_event", sql`e.org_id`, sql`e.id`, now)})
        AND NOT EXISTS (
          SELECT 1
          FROM atelier_assistant_actions a
          WHERE a.id = e.correlation_id
            AND EXISTS (
              ${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)}
            )
        )
      RETURNING e.id
    `);
    const workflowRows = await changed(tx, sql`
      UPDATE atelier_work_items w
      SET goal = '<retained-audit-shell>',
          goal_encrypted = NULL,
          conversation_links = '[]'::jsonb,
          policy_context = '{}'::jsonb,
          aggregate_result = NULL,
          aggregate_evidence = '[]'::jsonb,
          updated_at = ${now}
      WHERE w.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING w.id
    `);
    const planRows = await changed(tx, sql`
      UPDATE atelier_work_plans p
      SET rationale = '<retained-audit-shell>', rationale_encrypted = NULL
      FROM atelier_work_items w
      WHERE p.work_item_id = w.id
        AND w.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING p.id
    `);
    const stepRows = await changed(tx, sql`
      UPDATE atelier_work_steps s
      SET input_encrypted = '<retained-audit-shell>',
          authority_grant = '{}'::jsonb,
          policy_obligations = '[]'::jsonb,
          tools_data_perimeter = '{"toolIds":[],"dataClasses":[]}'::jsonb,
          retry_policy = '{}'::jsonb,
          compensation = NULL,
          checkpoint_spec = NULL,
          evidence_lineage = '[]'::jsonb,
          updated_at = ${now}
      FROM atelier_work_items w
      WHERE s.work_item_id = w.id
        AND w.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING s.id
    `);
    const attemptRows = await changed(tx, sql`
      UPDATE atelier_work_attempts a
      SET result = NULL, public_error = NULL, evidence = '[]'::jsonb, updated_at = ${now}
      FROM atelier_work_steps s, atelier_work_items w
      WHERE a.step_id = s.id AND s.work_item_id = w.id
        AND w.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING a.id
    `);
    const checkpointRows = await changed(tx, sql`
      UPDATE atelier_work_checkpoints c
      SET evidence = NULL, updated_at = ${now}
      FROM atelier_work_items w
      WHERE c.work_item_id = w.id
        AND w.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING c.id
    `);
    const sessionRows = await changed(tx, sql`
      UPDATE atelier_cli_sessions s
      SET title = NULL, rolling_summary = '', page_context_snapshot = NULL,
          updated_at = ${now}
      WHERE s.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_session", sql`s.org_id`, sql`s.id`, now)})
      RETURNING s.id
    `);
    const factRows = await changed(tx, sql`
      UPDATE atelier_cli_session_facts f
      SET value = '"<retained-audit-shell>"'::jsonb,
          display = '<retained-audit-shell>', updated_at = ${now}
      WHERE f.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_fact", sql`f.org_id`, sql`f.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`f.org_id`, sql`f.session_id`, now)})
      RETURNING f.id
    `);
    const turnExtraRows = await changed(tx, sql`
      UPDATE atelier_cli_turns t
      SET original_payload = NULL, plan_json = NULL, step_results = '[]'::jsonb,
          recording_trace = NULL, feedback = NULL, canonical_state = NULL,
          status_message = NULL, updated_at = ${now}
      WHERE t.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      RETURNING t.id
    `);
    const jobRows = await changed(tx, sql`
      UPDATE atelier_cli_jobs j
      SET input = NULL, result = NULL, error = NULL, progress = NULL,
          step_results = '[]'::jsonb, updated_at = ${now}
      WHERE j.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_job", sql`j.org_id`, sql`j.id`, now)})
        AND NOT EXISTS (${activeHold("cli_turn", sql`j.org_id`, sql`j.turn_id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`j.org_id`, sql`j.session_id`, now)})
      RETURNING j.id
    `);
    const extractedRows = await changed(tx, sql`
      UPDATE atelier_extracted_documents d
      SET normalized_text = '', table_summary = NULL, slide_texts = NULL,
          email_headers = NULL, chunks = '[]'::jsonb, digest = NULL,
          warnings = '[]'::jsonb
      FROM atelier_cli_attachments a
      WHERE d.attachment_id = a.id
        AND a.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("cli_attachment", sql`a.org_id`, sql`a.id`, now)})
        AND (
          a.turn_id IS NULL OR NOT EXISTS (
            ${activeHold("cli_turn", sql`a.org_id`, sql`a.turn_id`, now)}
          )
        )
        AND (
          a.session_id IS NULL OR NOT EXISTS (
            ${activeHold("cli_session", sql`a.org_id`, sql`a.session_id`, now)}
          )
        )
      RETURNING d.id
    `);
    const attachmentRows = attachmentBlobsPurged;
    const outboxRows = await changed(tx, sql`
      UPDATE atelier_assistant_outbox o
      SET request_encrypted = '<retained-audit-shell>', provider_result = NULL,
          last_error_code = NULL, updated_at = ${now}
      FROM atelier_assistant_actions a
      WHERE o.action_id = a.id AND o.created_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)})
      RETURNING o.id
    `);
    const budgetEventRows = await changed(tx, sql`
      UPDATE atelier_assistant_budget_events e
      SET data = NULL
      WHERE e.occurred_at < ${payloadCutoff}
        AND NOT EXISTS (${activeHold("budget_event", sql`e.org_id`, sql`e.id`, now)})
      RETURNING e.id
    `);
    const workflowPayloadsPurged =
      workflowRows + planRows + stepRows + attemptRows + checkpointRows;
    const legacyPayloadsPurged =
      sessionRows + factRows + turnExtraRows + jobRows + extractedRows +
      attachmentRows + outboxRows + budgetEventRows;
    return {
      ocrPurged,
      promptPlanPurged,
      actionPayloadsPurged,
      eventPayloadsPurged,
      workflowPayloadsPurged,
      legacyPayloadsPurged,
      attachmentBlobsPurged,
      scannedRows:
        ocrPurged +
        promptPlanPurged +
        actionPayloadsPurged +
        eventPayloadsPurged +
        workflowPayloadsPurged +
        legacyPayloadsPurged,
    };
  });
}

export interface ErasureSummary {
  cliRowsErased: number;
  actionRowsErased: number;
  eventRowsErased: number;
  workflowRowsErased: number;
  legacyRowsErased: number;
  attachmentBlobsPurged: number;
  rowsErased: number;
}

export async function eraseUserAssistantData(
  args: { orgId: string; userId: string },
  nowMs = Date.now(),
): Promise<ErasureSummary> {
  const now = new Date(nowMs);
  await queueExpiredAttachmentBlobs({
    cutoff: new Date(0),
    now,
    userId: args.userId,
    orgId: args.orgId,
  });
  const attachmentBlobsPurged = await drainAttachmentBlobQueue(now, args.orgId);
  return lifecycleTransaction(args.orgId, async (tx) => {
    const cliRowsErased = await changed(tx, sql`
      UPDATE atelier_cli_turns t
      SET prompt = '<erased>', frames = '[]'::jsonb, tool_calls = '[]'::jsonb,
          page_context = NULL, attachment_refs = '[]'::jsonb,
          pending_write = NULL, updated_at = ${now}
      WHERE t.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      RETURNING t.id
    `);
    const actionRowsErased = await changed(tx, sql`
      UPDATE atelier_assistant_actions a
      SET canonical_input_encrypted = '<erased>',
          target_refs_and_revisions = '[]'::jsonb, obligations = '[]'::jsonb,
          preview_snapshot = NULL, result = NULL, public_error = NULL, updated_at = ${now}
      WHERE a.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)})
      RETURNING a.id
    `);
    const eventRowsErased = await changed(tx, sql`
      UPDATE atelier_assistant_events e SET data = NULL
      WHERE e.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("assistant_event", sql`e.org_id`, sql`e.id`, now)})
        AND NOT EXISTS (
          SELECT 1
          FROM atelier_assistant_actions a
          WHERE a.id = e.correlation_id
            AND EXISTS (
              ${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)}
            )
        )
      RETURNING e.id
    `);
    const planRows = await changed(tx, sql`
      UPDATE atelier_work_plans p
      SET rationale = '<erased>', rationale_encrypted = NULL
      FROM atelier_work_items w
      WHERE p.work_item_id = w.id AND w.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING p.id
    `);
    const stepRows = await changed(tx, sql`
      UPDATE atelier_work_steps s
      SET input_encrypted = '<erased>', authority_grant = '{}'::jsonb,
          policy_obligations = '[]'::jsonb,
          tools_data_perimeter = '{"toolIds":[],"dataClasses":[]}'::jsonb,
          retry_policy = '{}'::jsonb, compensation = NULL,
          checkpoint_spec = NULL, evidence_lineage = '[]'::jsonb, updated_at = ${now}
      FROM atelier_work_items w
      WHERE s.work_item_id = w.id AND w.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING s.id
    `);
    const attemptRows = await changed(tx, sql`
      UPDATE atelier_work_attempts a
      SET result = NULL, public_error = NULL, evidence = '[]'::jsonb, updated_at = ${now}
      FROM atelier_work_steps s, atelier_work_items w
      WHERE a.step_id = s.id AND s.work_item_id = w.id AND w.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING a.id
    `);
    const checkpointRows = await changed(tx, sql`
      UPDATE atelier_work_checkpoints c
      SET evidence = NULL, updated_at = ${now}
      FROM atelier_work_items w
      WHERE c.work_item_id = w.id AND w.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING c.id
    `);
    const workRows = await changed(tx, sql`
      UPDATE atelier_work_items w
      SET goal = '<erased>', goal_encrypted = NULL,
          conversation_links = '[]'::jsonb,
          policy_context = '{}'::jsonb, aggregate_result = NULL,
          aggregate_evidence = '[]'::jsonb, updated_at = ${now}
      WHERE w.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("work_item", sql`w.org_id`, sql`w.id`, now)})
      RETURNING w.id
    `);
    const sessionRows = await changed(tx, sql`
      UPDATE atelier_cli_sessions s
      SET title = NULL, rolling_summary = '', page_context_snapshot = NULL,
          updated_at = ${now}
      WHERE s.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_session", sql`s.org_id`, sql`s.id`, now)})
      RETURNING s.id
    `);
    const factRows = await changed(tx, sql`
      UPDATE atelier_cli_session_facts f
      SET value = '"<erased>"'::jsonb, display = '<erased>', updated_at = ${now}
      WHERE f.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_fact", sql`f.org_id`, sql`f.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`f.org_id`, sql`f.session_id`, now)})
      RETURNING f.id
    `);
    const turnExtraRows = await changed(tx, sql`
      UPDATE atelier_cli_turns t
      SET original_payload = NULL, plan_json = NULL, step_results = '[]'::jsonb,
          recording_trace = NULL, feedback = NULL, canonical_state = NULL,
          status_message = NULL, updated_at = ${now}
      WHERE t.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_turn", sql`t.org_id`, sql`t.id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`t.org_id`, sql`t.session_id`, now)})
      RETURNING t.id
    `);
    const jobRows = await changed(tx, sql`
      UPDATE atelier_cli_jobs j
      SET input = NULL, result = NULL, error = NULL, progress = NULL,
          step_results = '[]'::jsonb, updated_at = ${now}
      WHERE j.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_job", sql`j.org_id`, sql`j.id`, now)})
        AND NOT EXISTS (${activeHold("cli_turn", sql`j.org_id`, sql`j.turn_id`, now)})
        AND NOT EXISTS (${activeHold("cli_session", sql`j.org_id`, sql`j.session_id`, now)})
      RETURNING j.id
    `);
    const extractedRows = await changed(tx, sql`
      UPDATE atelier_extracted_documents d
      SET normalized_text = '', table_summary = NULL, slide_texts = NULL,
          email_headers = NULL, chunks = '[]'::jsonb, digest = NULL,
          warnings = '[]'::jsonb
      FROM atelier_cli_attachments a
      WHERE d.attachment_id = a.id AND a.user_id = ${args.userId}
        AND NOT EXISTS (${activeHold("cli_attachment", sql`a.org_id`, sql`a.id`, now)})
        AND (
          a.turn_id IS NULL OR NOT EXISTS (
            ${activeHold("cli_turn", sql`a.org_id`, sql`a.turn_id`, now)}
          )
        )
        AND (
          a.session_id IS NULL OR NOT EXISTS (
            ${activeHold("cli_session", sql`a.org_id`, sql`a.session_id`, now)}
          )
        )
      RETURNING d.id
    `);
    const attachmentRows = attachmentBlobsPurged;
    const outboxRows = await changed(tx, sql`
      UPDATE atelier_assistant_outbox o
      SET request_encrypted = '<erased>', provider_result = NULL,
          last_error_code = NULL, updated_at = ${now}
      FROM atelier_assistant_actions a
      WHERE o.action_id = a.id AND a.requester_id = ${args.userId}
        AND NOT EXISTS (${activeHold("assistant_action", sql`a.org_id`, sql`a.id`, now)})
      RETURNING o.id
    `);
    const budgetEventRows = await changed(tx, sql`
      UPDATE atelier_assistant_budget_events e
      SET data = NULL
      FROM atelier_assistant_budget_ledgers l
      WHERE e.ledger_id = l.id AND l.owner_id = ${args.userId}
        AND NOT EXISTS (${activeHold("budget_event", sql`e.org_id`, sql`e.id`, now)})
      RETURNING e.id
    `);
    const workflowRowsErased =
      workRows + planRows + stepRows + attemptRows + checkpointRows;
    const legacyRowsErased =
      sessionRows + factRows + turnExtraRows + jobRows + extractedRows +
      attachmentRows + outboxRows + budgetEventRows;
    return {
      cliRowsErased,
      actionRowsErased,
      eventRowsErased,
      workflowRowsErased,
      legacyRowsErased,
      attachmentBlobsPurged,
      rowsErased:
        cliRowsErased + actionRowsErased + eventRowsErased +
        workflowRowsErased + legacyRowsErased,
    };
  });
}

/** Backward-compatible entry point used by existing erasure jobs. */
export async function eraseUserCliData(
  args: { orgId: string; userId: string },
): Promise<ErasureSummary> {
  return eraseUserAssistantData(args);
}