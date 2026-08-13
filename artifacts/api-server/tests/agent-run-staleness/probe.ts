/**
 * Task #1046 — checks for the dead-agent-run staleness rules.
 * Run: npx tsx tests/agent-run-staleness/probe.ts
 * Pure helper checks plus a DB round-trip: a synthetic stale "running" row
 * must be excluded by agentRunIsFresh() and repaired by the boot sweep.
 */
/* eslint-disable no-console */
import { db, atelierAgentRuns } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  AGENT_RUN_STALE_MS,
  agentRunIsFresh,
  agentRunRowIsStale,
  effectiveAgentRunStatus,
  launchEntryIsStale,
  sweepInterruptedAgentRuns,
  INTERRUPTED_RUN_MESSAGE,
} from "../../src/lib/atelier-agents/run-staleness.js";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`);
  }
}

const now = new Date("2026-08-13T12:00:00Z");
const fresh = new Date(now.getTime() - AGENT_RUN_STALE_MS + 60_000);
const stale = new Date(now.getTime() - AGENT_RUN_STALE_MS - 60_000);

check(
  "fresh running row is not stale",
  !agentRunRowIsStale({ status: "running", updatedAt: fresh, createdAt: stale }, now),
);
check(
  "heartbeat-dead running row is stale",
  agentRunRowIsStale({ status: "running", updatedAt: stale, createdAt: stale }, now),
);
check(
  "null updatedAt falls back to createdAt (fresh)",
  !agentRunRowIsStale({ status: "running", updatedAt: null, createdAt: fresh }, now),
);
check(
  "null updatedAt falls back to createdAt (stale)",
  agentRunRowIsStale({ status: "running", updatedAt: null, createdAt: stale }, now),
);
check(
  "no timestamps at all → treated as stale",
  agentRunRowIsStale({ status: "running", updatedAt: null, createdAt: null }, now),
);
check(
  "terminal statuses are never stale",
  !agentRunRowIsStale({ status: "complete", updatedAt: stale, createdAt: stale }, now) &&
    !agentRunRowIsStale({ status: "error", updatedAt: stale, createdAt: stale }, now) &&
    !agentRunRowIsStale({ status: "blocked", updatedAt: stale, createdAt: stale }, now),
);
check(
  "effective status maps stale running → error, keeps others",
  effectiveAgentRunStatus({ status: "running", updatedAt: stale, createdAt: stale }) === "error" &&
    effectiveAgentRunStatus({ status: "running", updatedAt: new Date(), createdAt: new Date() }) === "running" &&
    effectiveAgentRunStatus({ status: "complete", updatedAt: stale, createdAt: stale }) === "complete",
);
check("interrupted message is user-friendly", INTERRUPTED_RUN_MESSAGE.includes("restart"));
check(
  "launch entries go stale on the same cutoff",
  launchEntryIsStale(now.getTime() - AGENT_RUN_STALE_MS - 1, now.getTime()) &&
    !launchEntryIsStale(now.getTime() - AGENT_RUN_STALE_MS + 60_000, now.getTime()),
);

// --- DB round-trip: freshness predicate + boot sweep ----------------------
async function dbChecks() {
  const id = `run_probe_stale_${Date.now().toString(36)}`;
  const old = new Date(Date.now() - AGENT_RUN_STALE_MS - 60 * 60 * 1000);
  await db.insert(atelierAgentRuns).values({
    id,
    agentId: "probe_agent",
    status: "running",
    statusMessage: "probe",
    createdAt: old,
    updatedAt: old,
  });
  try {
    const liveReads = await db
      .select({ id: atelierAgentRuns.id })
      .from(atelierAgentRuns)
      .where(
        and(eq(atelierAgentRuns.id, id), eq(atelierAgentRuns.status, "running"), agentRunIsFresh()),
      );
    check("stale running row excluded by agentRunIsFresh()", liveReads.length === 0);

    const swept = await sweepInterruptedAgentRuns(new Date());
    check("boot sweep repairs at least the probe row", swept >= 1);
    const [after] = await db
      .select({ status: atelierAgentRuns.status, statusMessage: atelierAgentRuns.statusMessage })
      .from(atelierAgentRuns)
      .where(eq(atelierAgentRuns.id, id));
    check(
      "swept row is error + friendly message",
      after?.status === "error" && after.statusMessage === INTERRUPTED_RUN_MESSAGE,
    );
  } finally {
    await db.delete(atelierAgentRuns).where(eq(atelierAgentRuns.id, id));
  }
}

await dbChecks();

if (failures) {
  console.error(`\n${failures} staleness check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll agent-run staleness checks passed");
