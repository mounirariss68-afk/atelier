/**
 * Shared Executive Mapper pipeline (extracted from accountRoutes so the
 * chat orchestrator can chain it too): sweep the public leadership
 * roster, build governed contact proposals, and append them to the
 * account's pendingProfileUpdates queue (audited). Used by:
 *   - the manual "Map executives" route,
 *   - the auto-run chained after account creation,
 *   - the auto-run chained after a Cartographer refresh (manual route
 *     and chat-orchestrator dispatch).
 * The account row is re-loaded just before the queue write so a
 * Cartographer run that finished moments earlier is never clobbered.
 *
 * Runs on the global `db` on purpose — long LLM runs must not pin an
 * RLS connection (see atelier agent-run conventions).
 */

import { db, atelierAccounts, atelierAgentRuns, atelierAuditEvents, atelierContacts } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import {
  runExecutiveMapper,
  buildExecutiveMapperProposals,
  type PendingProfileUpdate,
} from "./runner.js";
import type { CriticalRoleCoverageEntry } from "./critical-roles.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

async function loadAccount(id: string) {
  const [row] = await db
    .select()
    .from(atelierAccounts)
    .where(and(eq(atelierAccounts.id, id), isNull(atelierAccounts.deletedAt)));
  return row ?? null;
}

// In-process claim set: makes the check-then-start window race-safe within
// this server process (the API runs as a single process; auto-run + manual
// double-click both land here). The DB status check below still covers runs
// visible across restarts / other entry points.
const executiveMapperInFlight = new Set<string>();

// Task #868 — in-process launch registry owned by the CHAIN, not the route,
// so EVERY entry point (manual route, auto-run after account creation,
// post-Cartographer chain, chat dispatch) registers the same state. It
// bridges the pre-run-row window (the durable atelier_agent_runs row is only
// inserted once the pipeline gets going) and captures errors thrown before a
// run row exists. The workspace/status readers merge this with the run row.
export type ExecutiveMapperLaunch = {
  status: "running" | "succeeded" | "failed";
  error: string | null;
  runId: string | null;
  proposedCount: number | null;
  openQuestions: string[];
  startedAt: number;
};
const executiveMapperLaunches = new Map<string, ExecutiveMapperLaunch>();

export function getExecutiveMapperLaunch(
  accountId: string,
): ExecutiveMapperLaunch | null {
  return executiveMapperLaunches.get(accountId) ?? null;
}

export async function runExecutiveMapperAndQueue(
  accountId: string,
  triggeredByUserId: string | null,
  // Test seam only — lets lifecycle tests replace the multi-minute LLM
  // pipeline. Production callers never pass this.
  deps?: { runImpl?: typeof runExecutiveMapper },
): Promise<{
  runId: string;
  proposedCount: number;
  openQuestions: string[];
  criticalRoleCoverage: CriticalRoleCoverageEntry[] | null;
}> {
  // Concurrency guard: never stack a second sweep on an account that already
  // has one running (double-click, auto-run + manual overlap). Claim the
  // in-process slot atomically FIRST, then double-check the DB. The claim and
  // the "running" launch entry are registered SYNCHRONOUSLY (before the first
  // await) so a caller that fires-and-forgets and immediately serves a status
  // read never observes a stale "idle".
  if (executiveMapperInFlight.has(accountId)) {
    throw new Error("executive-mapper-already-running");
  }
  executiveMapperInFlight.add(accountId);
  executiveMapperLaunches.set(accountId, {
    status: "running",
    error: null,
    runId: null,
    proposedCount: null,
    openQuestions: [],
    startedAt: Date.now(),
  });
  try {
    const a = await loadAccount(accountId);
    if (!a) throw new Error("account-not-found");
    const [inFlight] = await db
      .select({ id: atelierAgentRuns.id })
      .from(atelierAgentRuns)
      .where(
        and(
          eq(atelierAgentRuns.agentId, "executive_mapper"),
          eq(atelierAgentRuns.targetId, a.id),
          eq(atelierAgentRuns.status, "running"),
          isNull(atelierAgentRuns.deletedAt),
        ),
      )
      .limit(1);
    if (inFlight) throw new Error("executive-mapper-already-running");
    const result = await runExecutiveMapperAndQueueInner(
      a,
      triggeredByUserId,
      deps,
    );
    executiveMapperLaunches.set(accountId, {
      status: "succeeded",
      error: null,
      runId: result.runId,
      proposedCount: result.proposedCount,
      openQuestions: result.openQuestions,
      startedAt: Date.now(),
    });
    return result;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    if (raw === "executive-mapper-already-running") {
      // A run visible in the DB (other process / pre-restart) is in flight —
      // drop OUR provisional entry rather than recording a bogus failure over
      // the real run's state.
      executiveMapperLaunches.delete(accountId);
    } else {
      executiveMapperLaunches.set(accountId, {
        status: "failed",
        error:
          raw === "account-not-found"
            ? "The account no longer exists."
            : raw,
        runId: null,
        proposedCount: null,
        openQuestions: [],
        startedAt: Date.now(),
      });
    }
    throw err;
  } finally {
    executiveMapperInFlight.delete(accountId);
  }
}

async function runExecutiveMapperAndQueueInner(
  a: NonNullable<Awaited<ReturnType<typeof loadAccount>>>,
  triggeredByUserId: string | null,
  deps?: { runImpl?: typeof runExecutiveMapper },
): Promise<{
  runId: string;
  proposedCount: number;
  openQuestions: string[];
  criticalRoleCoverage: CriticalRoleCoverageEntry[] | null;
}> {
  const existingContacts = await db
    .select({
      fullName: atelierContacts.fullName,
      title: atelierContacts.title,
      linkedinUrl: atelierContacts.linkedinUrl,
    })
    .from(atelierContacts)
    .where(and(eq(atelierContacts.accountId, a.id), isNull(atelierContacts.deletedAt)));

  const { runId, output } = await (deps?.runImpl ?? runExecutiveMapper)({
    accountId: a.id,
    accountName: a.brandName ?? a.name,
    accountBrandName: a.brandName ?? null,
    accountSector: a.sector,
    accountCountry: a.country,
    accountHqCity: a.hqCity ?? null,
    knownContacts: existingContacts,
    triggeredByUserId,
    actorLabel: "Executive Mapper",
  });

  // Re-load for the freshest queue — the LLM run takes minutes and other
  // writers (Cartographer persist, partner edits) may have touched the row.
  const fresh = (await loadAccount(a.id)) ?? a;
  const proposals = buildExecutiveMapperProposals({
    output,
    account: fresh,
    existingContacts,
  });

  const queue = (
    (fresh.pendingProfileUpdates as PendingProfileUpdate[] | null) ?? []
  ).concat(proposals);

  await db.transaction(async (tx) => {
    await tx
      .update(atelierAccounts)
      .set({ pendingProfileUpdates: queue, updatedAt: new Date() })
      .where(eq(atelierAccounts.id, a.id));
    await tx.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: "account",
      entityId: a.id,
      actorType: "agent",
      actorId: "ag_executive_mapper",
      actorLabel: "Executive Mapper",
      action: "account.profile.proposeUpdate",
      payload: {
        count: proposals.length,
        fields: proposals.map((p) => p.field),
        openQuestions: output.openQuestions,
        // Task #206 — code-computed critical-role coverage + guard drops,
        // recorded for auditability of the anti-junior/anti-hallucination net.
        criticalRoleCoverage: output.criticalRoleCoverage ?? null,
        droppedBySeniorityGuard: output.droppedBySeniorityGuard ?? [],
      },
      payloadSummary:
        proposals.length > 0
          ? `Executive Mapper proposed ${proposals.length} contact update(s) for ${fresh.brandName ?? fresh.name} (awaiting partner review).`
          : `Executive Mapper sweep found no new executives to propose for ${fresh.brandName ?? fresh.name}.`,
    });
  });

  return {
    runId,
    proposedCount: proposals.length,
    openQuestions: output.openQuestions,
    criticalRoleCoverage: output.criticalRoleCoverage ?? null,
  };
}

/**
 * Fire-and-forget chain used after every successful Cartographer run
 * against a persisted account (create, manual refresh, chat dispatch).
 * A failed / empty / already-running Mapper never breaks the
 * Cartographer result — it degrades to a console warning.
 */
export function chainExecutiveMapperAfterCartographer(
  accountId: string,
  triggeredByUserId: string | null,
  accountLabel: string,
): void {
  void runExecutiveMapperAndQueue(accountId, triggeredByUserId).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg === "executive-mapper-already-running") {
      // Benign overlap (e.g. auto-chain + manual click) — nothing lost,
      // the in-flight sweep will land its proposals.
      return;
    }
    console.warn(
      `[atelier] post-cartographer executive mapper failed for ${accountLabel}`,
      msg,
    );
  });
}
