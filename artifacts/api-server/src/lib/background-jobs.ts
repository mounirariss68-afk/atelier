/**
 * Task #1020 — durable background-job registry.
 *
 * Replaces the per-feature in-memory "launch maps" (POV drafts, receipt
 * parsing, pricing research, alliance evaluation, merchant enrichment)
 * with rows in `atelier_background_jobs` so that:
 *
 *   1. Job status survives server restarts (a boot sweep marks orphaned
 *      "running" rows failed — the UI never spins forever),
 *   2. The starter can see all their jobs from any page via
 *      GET /me/background-jobs (global indicator in the web shell),
 *   3. Completion/failure drops a self-notification card on the starter's
 *      Me home (which also rides the existing Expo push pipeline), with a
 *      deep link to the result.
 *
 * Semantics:
 *   - "Latest row per (kind,targetId)" is the authoritative status for a
 *     feature's poll endpoint. A relaunch inserts a NEW row; a zombie
 *     promise finishing later updates only its own (superseded) row.
 *   - complete/fail only transition rows still in "running" state, so a
 *     boot-swept (failed) job can't be flipped back by a zombie promise.
 *   - Notification cards use the deterministic id `selfnotif_bgjob_<jobId>`
 *     + onConflictDoNothing, so a job notifies AT MOST once, and pushes
 *     ride the insert's returning() on the same dedupe key.
 */
import {
  db,
  atelierBackgroundJobs,
  atelierSelfNotifications,
  atelierPushTokens,
} from "@workspace/db";
import { and, desc, eq, gt, inArray, lt, or } from "drizzle-orm";
import { sendExpoPushMessages } from "./expoPush.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export type BackgroundJobRow = typeof atelierBackgroundJobs.$inferSelect;

export interface StartBackgroundJobArgs {
  orgId: string | null;
  userId: string;
  kind: string;
  targetType: string;
  targetId: string;
  /** Human label shown in the global indicator, e.g. `POV draft — "Acme"`. */
  label: string;
  /** Deep link to where the result will appear (set now or at complete). */
  resultHref?: string | null;
  /** Use a caller-chosen id (e.g. when the id doubles as a public runId). */
  id?: string;
  /**
   * Concurrency key for the running-unique index. Kinds that must be
   * mutually exclusive on the same target share one (e.g. pov_draft and
   * pov_revise both pass "pov"). Defaults to `kind`.
   */
  lockKey?: string;
}

/**
 * Insert a running job. Returns null when another running job already
 * exists for the same (org, kind, target) — the partial unique index
 * `uq_atelier_bgjobs_running` makes this atomic, so concurrent launches
 * can't both start work even if their pre-checks raced.
 */
export async function startBackgroundJob(args: StartBackgroundJobArgs): Promise<string | null> {
  const id = args.id ?? rid("bgjob");
  const inserted = await db
    .insert(atelierBackgroundJobs)
    .values({
      id,
      ...(args.orgId ? { orgId: args.orgId } : {}),
      startedByUserId: args.userId,
      kind: args.kind,
      lockKey: args.lockKey ?? args.kind,
      targetType: args.targetType,
      targetId: args.targetId,
      label: args.label,
      status: "running",
      resultHref: args.resultHref ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: atelierBackgroundJobs.id });
  return inserted.length ? id : null;
}

/** Latest job row for a feature's (kinds, targetId) — poll-endpoint SoT. */
export async function getLatestJob(
  kinds: string[],
  targetId: string,
  orgId?: string,
): Promise<BackgroundJobRow | null> {
  if (kinds.length === 0) return null;
  const [row] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(
      and(
        inArray(atelierBackgroundJobs.kind, kinds),
        eq(atelierBackgroundJobs.targetId, targetId),
        ...(orgId ? [eq(atelierBackgroundJobs.orgId, orgId)] : []),
      ),
    )
    .orderBy(desc(atelierBackgroundJobs.createdAt))
    .limit(1);
  return row ?? null;
}

/** Org scoping is part of the WHERE — a foreign id reads as not-found. */
export async function getJobById(id: string, orgId?: string): Promise<BackgroundJobRow | null> {
  const [row] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(
      and(
        eq(atelierBackgroundJobs.id, id),
        ...(orgId ? [eq(atelierBackgroundJobs.orgId, orgId)] : []),
      ),
    );
  return row ?? null;
}

/**
 * Watchdog helper: mark a still-"running" job failed when it has been
 * running longer than `staleMs`. Needed before relaunch attempts, because
 * the running-unique index would otherwise block the new insert forever.
 */
export async function reapStaleRunningJob(
  kinds: string[],
  targetId: string,
  orgId: string | null | undefined,
  staleMs: number,
): Promise<void> {
  if (kinds.length === 0) return;
  const cutoff = new Date(Date.now() - staleMs);
  const now = new Date();
  await db
    .update(atelierBackgroundJobs)
    .set({
      status: "failed",
      error: "The run timed out — please retry.",
      updatedAt: now,
      finishedAt: now,
    })
    .where(
      and(
        inArray(atelierBackgroundJobs.kind, kinds),
        eq(atelierBackgroundJobs.targetId, targetId),
        eq(atelierBackgroundJobs.status, "running"),
        lt(atelierBackgroundJobs.createdAt, cutoff),
        ...(orgId ? [eq(atelierBackgroundJobs.orgId, orgId)] : []),
      ),
    );
}

/** True when the latest job for (kinds, targetId) is still running. */
export async function hasRunningJob(kinds: string[], targetId: string, orgId?: string): Promise<boolean> {
  const row = await getLatestJob(kinds, targetId, orgId);
  return row?.status === "running";
}

interface NotifyArgs {
  title: string;
  body?: string;
  href?: string | null;
}

/**
 * Drop a completion card on the starter's Me home + mirror to their
 * registered devices. Deterministic id per job ⇒ at most one card and one
 * push per job, ever. Never throws — a notification hiccup must not break
 * the job transition.
 */
async function notifyJobTerminal(job: BackgroundJobRow, n: NotifyArgs): Promise<void> {
  try {
    const cardId = `selfnotif_bgjob_${job.id}`;
    const inserted = await db
      .insert(atelierSelfNotifications)
      .values({
        id: cardId,
        orgId: job.orgId,
        userId: job.startedByUserId,
        kind: "background_job",
        title: n.title,
        body: n.body ?? "",
        href: n.href ?? null,
      })
      .onConflictDoNothing({ target: atelierSelfNotifications.id })
      .returning({ id: atelierSelfNotifications.id });
    if (!inserted.length) return;
    const tokens = await db
      .select()
      .from(atelierPushTokens)
      .where(eq(atelierPushTokens.userId, job.startedByUserId));
    if (!tokens.length) return;
    await sendExpoPushMessages(
      tokens.map((t) => ({
        to: t.token,
        title: n.title,
        body: n.body ?? "",
        data: { href: n.href ?? null, kind: "background_job", notificationId: cardId },
      })),
    );
  } catch (err) {
    console.warn("[background-jobs] notify failed for", job.id, err);
  }
}

export interface CompleteJobArgs {
  result?: Record<string, unknown>;
  resultHref?: string | null;
  /** Notification card title; omit to skip notifying. */
  notifyTitle?: string;
  notifyBody?: string;
}

export async function completeBackgroundJob(id: string, args: CompleteJobArgs = {}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(atelierBackgroundJobs)
    .set({
      status: "done",
      result: args.result ?? null,
      ...(args.resultHref !== undefined ? { resultHref: args.resultHref } : {}),
      updatedAt: now,
      finishedAt: now,
    })
    // Only transition rows still running — a boot-swept/failed job stays
    // failed even if a zombie promise settles later.
    .where(and(eq(atelierBackgroundJobs.id, id), eq(atelierBackgroundJobs.status, "running")))
    .returning();
  if (row && args.notifyTitle) {
    await notifyJobTerminal(row, {
      title: args.notifyTitle,
      body: args.notifyBody,
      href: args.resultHref !== undefined ? args.resultHref : row.resultHref,
    });
  }
}

export interface FailJobArgs {
  notifyTitle?: string;
  notifyBody?: string;
  /** Extra structured error context for the feature's poll endpoint. */
  result?: Record<string, unknown>;
}

export async function failBackgroundJob(id: string, error: string, args: FailJobArgs = {}): Promise<void> {
  const now = new Date();
  const [row] = await db
    .update(atelierBackgroundJobs)
    .set({
      status: "failed",
      error: error.slice(0, 2000),
      ...(args.result !== undefined ? { result: args.result } : {}),
      updatedAt: now,
      finishedAt: now,
    })
    .where(and(eq(atelierBackgroundJobs.id, id), eq(atelierBackgroundJobs.status, "running")))
    .returning();
  if (row && args.notifyTitle) {
    await notifyJobTerminal(row, {
      title: args.notifyTitle,
      body: args.notifyBody ?? error.slice(0, 500),
      href: row.resultHref,
    });
  }
}

/**
 * Boot sweep — a row still "running" that predates this process's start
 * was orphaned by the previous process. Mark it failed (and tell the
 * starter) so pollers and the global indicator resolve instead of
 * spinning forever. `bootTime` must be captured by the entrypoint BEFORE
 * the server starts accepting traffic (this module is dynamically
 * imported later, so a module-level timestamp here would race requests
 * accepted between listen and import). Jobs created at/after `bootTime`
 * belong to this instance and are left alone.
 */
export async function sweepInterruptedBackgroundJobs(bootTime: Date): Promise<number> {
  const now = new Date();
  const rows = await db
    .update(atelierBackgroundJobs)
    .set({
      status: "failed",
      error: "Interrupted by a server restart — please try again.",
      updatedAt: now,
      finishedAt: now,
    })
    .where(
      and(
        eq(atelierBackgroundJobs.status, "running"),
        lt(atelierBackgroundJobs.createdAt, bootTime),
      ),
    )
    .returning();
  for (const row of rows) {
    await notifyJobTerminal(row, {
      title: `${row.label} was interrupted`,
      body: "The server restarted while this was running. Please start it again.",
      href: row.resultHref,
    });
  }
  return rows.length;
}

/** Jobs a user sees in the global indicator: running + recently finished. */
export async function listJobsForUser(
  userId: string,
  opts: { recentMs?: number; limit?: number } = {},
): Promise<BackgroundJobRow[]> {
  const recentSince = new Date(Date.now() - (opts.recentMs ?? 6 * 60 * 60 * 1000));
  return db
    .select()
    .from(atelierBackgroundJobs)
    .where(
      and(
        eq(atelierBackgroundJobs.startedByUserId, userId),
        or(
          eq(atelierBackgroundJobs.status, "running"),
          gt(atelierBackgroundJobs.finishedAt, recentSince),
        ),
      ),
    )
    .orderBy(desc(atelierBackgroundJobs.createdAt))
    .limit(opts.limit ?? 20);
}
