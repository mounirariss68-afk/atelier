/**
 * Task #1073 — automatic Bookkeeper runs.
 *
 * The GL Bookkeeper used to post only when finance clicked "Run" on the
 * Ledger page. This ticker sweeps every AUTO_TICK_MS and re-runs the
 * (idempotent) Bookkeeper for the current and previous period of every
 * org with active legal entities, so newly finalized source documents
 * (invoices, expenses, payments, bank transactions, revrec postings)
 * flow into the journal without a manual run.
 *
 * Concurrency: each run is claimed through the durable background-job
 * registry (kind "gl_bookkeeper_auto"/"gl_bookkeeper_manual", shared
 * lockKey "gl_bookkeeper" per (org, period) target), so an auto tick and
 * a manual "Run" click can never post the same period simultaneously —
 * the partial unique index on running jobs is the atomic guard. The
 * journal's own (org, sourceKind, sourceRef) unique index remains the
 * last line of defense against duplicates.
 *
 * Locked periods are skipped before any claim (runBookkeeper re-checks
 * and throws `period-locked` as a backstop).
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, atelierLegalEntities, atelierBackgroundJobs } from "@workspace/db";
import {
  startBackgroundJob,
  completeBackgroundJob,
  failBackgroundJob,
  reapStaleRunningJob,
} from "../background-jobs.js";
import { isGlPeriodLocked, runBookkeeper } from "./bookkeeper.js";

export const BOOKKEEPER_JOB_KINDS = ["gl_bookkeeper_auto", "gl_bookkeeper_manual"] as const;
export const BOOKKEEPER_LOCK_KEY = "gl_bookkeeper";
/** A Bookkeeper run that has been "running" longer than this is dead. */
export const BOOKKEEPER_STALE_MS = 15 * 60 * 1000;
/** System actor recorded as the starter of automatic runs. */
export const BOOKKEEPER_SYSTEM_ACTOR = "ag_bookkeeper";

const AUTO_TICK_MS = 15 * 60 * 1000; // sweep cadence
/** Don't re-run a period automatically more often than this. */
const AUTO_MIN_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 45 * 1000; // let boot chores settle first

export function bookkeeperJobTargetId(orgId: string, periodLabel: string): string {
  return `${orgId}:${periodLabel}`;
}

function periodLabelOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function previousPeriodLabel(current: string): string {
  const y = Number(current.slice(0, 4));
  const m = Number(current.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Latest Bookkeeper job row (auto or manual) for an org+period. */
export async function getLatestBookkeeperJob(orgId: string, periodLabel: string) {
  const [row] = await db
    .select()
    .from(atelierBackgroundJobs)
    .where(and(
      eq(atelierBackgroundJobs.orgId, orgId),
      inArray(atelierBackgroundJobs.kind, [...BOOKKEEPER_JOB_KINDS]),
      eq(atelierBackgroundJobs.targetId, bookkeeperJobTargetId(orgId, periodLabel)),
    ))
    .orderBy(desc(atelierBackgroundJobs.createdAt))
    .limit(1);
  return row ?? null;
}

async function autoRunPeriod(orgId: string, periodLabel: string): Promise<"posted" | "skipped"> {
  // Never touch closed/locked periods.
  if (await isGlPeriodLocked(orgId, periodLabel)) return "skipped";

  const targetId = bookkeeperJobTargetId(orgId, periodLabel);

  // Rate-limit: skip if the latest run finished recently or is still live.
  const latest = await getLatestBookkeeperJob(orgId, periodLabel);
  if (latest) {
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    if (latest.status === "running" && ageMs < BOOKKEEPER_STALE_MS) return "skipped";
    if (latest.status !== "running" && ageMs < AUTO_MIN_INTERVAL_MS) return "skipped";
  }

  // Free a dead claim before attempting a new one, or the running-unique
  // index blocks all future runs of this period forever.
  await reapStaleRunningJob([...BOOKKEEPER_JOB_KINDS], targetId, orgId, BOOKKEEPER_STALE_MS);

  const jobId = await startBackgroundJob({
    orgId,
    userId: BOOKKEEPER_SYSTEM_ACTOR,
    kind: "gl_bookkeeper_auto",
    lockKey: BOOKKEEPER_LOCK_KEY,
    targetType: "gl_period",
    targetId,
    label: `Bookkeeper auto-post ${periodLabel}`,
    resultHref: "/finance/ledger",
  });
  if (!jobId) return "skipped"; // lost the atomic-start race

  try {
    const { output } = await runBookkeeper({
      orgId,
      input: { periodLabel },
      triggeredByUserId: null,
      actorLabel: "Bookkeeper (auto)",
    });
    await completeBackgroundJob(jobId, {
      result: {
        entriesCreated: output.entriesCreated,
        entriesSkippedExisting: output.entriesSkippedExisting,
        exceptionsOpen: output.exceptionsOpen,
        sourcesScanned: output.sourcesScanned,
        rationaleSummary: output.rationaleSummary,
      },
    });
    return "posted";
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await failBackgroundJob(jobId, msg);
    // period-locked between check and run is expected, not an error.
    if (!msg.startsWith("period-locked")) {
      console.warn(`[gl.bookkeeper] auto run failed for ${orgId} ${periodLabel}:`, msg);
    }
    return "skipped";
  }
}

/** One sweep: every org with active entities × (current, previous) period. */
export async function runBookkeeperAutoTick(): Promise<{ runs: number }> {
  const orgRows = await db
    .selectDistinct({ orgId: atelierLegalEntities.orgId })
    .from(atelierLegalEntities)
    .where(eq(atelierLegalEntities.status, "active"));
  const current = periodLabelOf(new Date());
  const periods = [current, previousPeriodLabel(current)];
  let runs = 0;
  for (const { orgId } of orgRows) {
    for (const periodLabel of periods) {
      try {
        if ((await autoRunPeriod(orgId, periodLabel)) === "posted") runs++;
      } catch (err) {
        console.warn(`[gl.bookkeeper] auto tick error for ${orgId} ${periodLabel}:`, err);
      }
    }
  }
  return { runs };
}

let timer: NodeJS.Timeout | null = null;
let kickoff: NodeJS.Timeout | null = null;

export function startBookkeeperAutoJob(): void {
  if (timer) return;
  if (process.env.NODE_ENV === "test") return; // no background DB chatter in tests
  kickoff = setTimeout(() => {
    void runBookkeeperAutoTick().catch((err) => {
      console.warn("[gl.bookkeeper] initial auto sweep failed:", err);
    });
  }, INITIAL_DELAY_MS);
  if (typeof kickoff.unref === "function") kickoff.unref();
  timer = setInterval(() => {
    void runBookkeeperAutoTick().catch((err) => {
      console.warn("[gl.bookkeeper] auto sweep failed:", err);
    });
  }, AUTO_TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
}

export function stopBookkeeperAutoJob(): void {
  if (timer) { clearInterval(timer); timer = null; }
  if (kickoff) { clearTimeout(kickoff); kickoff = null; }
}
