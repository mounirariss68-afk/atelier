/**
 * Task #332 — CLI data-retention + GDPR erasure jobs.
 *
 * Two policies enforced here:
 *   1. Rolling purge of ephemeral CLI scratch data:
 *        - OCR-derived attachment text         : 90 days
 *        - prompt + plan + tool-calls          : 13 months
 *        - audit summary rows                  : kept indefinitely
 *      The first two are columns on `atelier_cli_turns`; the audit
 *      summary lives on `atelier_audit_events` (entityType=cli_turn).
 *   2. GDPR-style erasure-by-user: blank prompts/frames/tool-calls
 *      for every CLI turn owned by the given user, but keep the
 *      audit shells (terminal status + counts) so the integrity log
 *      stays uninterrupted.
 *
 * Both jobs are idempotent and bounded — they take an explicit
 * `nowMs` so callers can golden-test against fixed clocks.
 */

import { and, eq, lt, isNotNull } from "drizzle-orm";
import { db, atelierCliTurns } from "@workspace/db";

const DAY_MS = 86400000;

export interface RetentionSummary {
  ocrPurged: number;
  promptPlanPurged: number;
  scannedRows: number;
}

export async function runRetention(nowMs = Date.now()): Promise<RetentionSummary> {
  const ocrCutoff = new Date(nowMs - 90 * DAY_MS);
  const promptCutoff = new Date(nowMs - 395 * DAY_MS);

  // OCR scrub: any attachmentRefs older than 90 days get cleared.
  const ocrRows = await db
    .update(atelierCliTurns)
    .set({ attachmentRefs: [], updatedAt: new Date(nowMs) })
    .where(
      and(
        lt(atelierCliTurns.createdAt, ocrCutoff),
        isNotNull(atelierCliTurns.attachmentRefs),
      ),
    )
    .returning({ id: atelierCliTurns.id });

  // Prompt+plan+tool-calls scrub: 13 months.
  const promptRows = await db
    .update(atelierCliTurns)
    .set({
      prompt: "",
      frames: [],
      toolCalls: [],
      pageContext: null,
      updatedAt: new Date(nowMs),
    })
    .where(lt(atelierCliTurns.createdAt, promptCutoff))
    .returning({ id: atelierCliTurns.id });

  return {
    ocrPurged: ocrRows.length,
    promptPlanPurged: promptRows.length,
    scannedRows: ocrRows.length + promptRows.length,
  };
}

export interface ErasureSummary {
  rowsErased: number;
}

/**
 * GDPR right-to-erasure for a single user. Audit row shells are
 * retained (legal hold) but every payload column gets cleared.
 */
export async function eraseUserCliData(userId: string): Promise<ErasureSummary> {
  const rows = await db
    .update(atelierCliTurns)
    .set({
      prompt: "<erased>",
      frames: [],
      toolCalls: [],
      pageContext: null,
      attachmentRefs: [],
      pendingWrite: null,
      updatedAt: new Date(),
    })
    .where(eq(atelierCliTurns.userId, userId))
    .returning({ id: atelierCliTurns.id });
  return { rowsErased: rows.length };
}
