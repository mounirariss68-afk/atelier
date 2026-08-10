/**
 * Task #24 — duplicate/concurrent confirm is idempotent.
 *
 * Seeds a CLI session + turn in `awaiting_confirmation` with a
 * pendingWrite for `opportunity_create` (runScout:false so no LLM),
 * then fires TWO confirms concurrently via runTurn (the same path the
 * /cli/turn/:id/confirm route uses, including the per-user FIFO queue
 * + idempotent job claim). Asserts:
 *   1. exactly ONE opportunity row is inserted;
 *   2. both confirms end in a terminal success (one may be a replay /
 *      replayedIdempotent) — neither reports cancelled/error;
 *   3. a third, sequential confirm replays final with replay:true.
 *
 * Standalone probe — talks to the DB directly, no HTTP server needed:
 *   cd artifacts/api-server && npx tsx tests/cli-turn/double-confirm.ts
 */
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAccounts,
  atelierOpportunities,
  atelierCliSessions,
  atelierCliTurns,
  atelierCliJobs,
  atelierAuditEvents,
} from "@workspace/db";
import { runTurn, type CliFrame } from "../../src/lib/atelier-cli/index.ts";
import { hardDeleteOpportunities } from "../../src/lib/atelier-opportunity-delete.ts";

const PERSONA_ID = "p_mounir_ariss";
const tag = Date.now().toString(36);
const ACCT_ID = `acct_dblconf_${tag}`;
const SESSION_ID = `clis_dblconf_${tag}`;
const TURN_ID = `clit_dblconf_${tag}`;
const OPP_NAME = `Double Confirm Probe ${tag}`;

async function cleanup(orgId: string): Promise<void> {
  const opps = await db
    .select({ id: atelierOpportunities.id })
    .from(atelierOpportunities)
    .where(eq(atelierOpportunities.accountId, ACCT_ID));
  for (const o of opps) {
    await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, o.id));
  }
  if (opps.length) await hardDeleteOpportunities(opps.map((o) => o.id));
  await db.delete(atelierCliJobs).where(eq(atelierCliJobs.turnId, TURN_ID));
  await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, TURN_ID));
  await db.delete(atelierCliTurns).where(eq(atelierCliTurns.id, TURN_ID));
  await db.delete(atelierCliSessions).where(eq(atelierCliSessions.id, SESSION_ID));
  await db
    .delete(atelierAccounts)
    .where(and(eq(atelierAccounts.id, ACCT_ID), eq(atelierAccounts.orgId, orgId)));
}

async function main(): Promise<void> {
  const [p] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, PERSONA_ID))
    .limit(1);
  if (!p) throw new Error("persona not seeded");
  const persona = {
    id: p.id,
    orgId: p.orgId,
    name: p.name,
    role: p.role,
    email: p.email ?? null,
  };

  try {
    // Seed account + session + awaiting_confirmation turn.
    await db.insert(atelierAccounts).values({
      id: ACCT_ID,
      orgId: p.orgId,
      slug: `dblconf-${tag}`,
      name: `Double Confirm Probe Co ${tag}`,
      status: "active",
      country: "UAE",
      sector: "Technology",
    } as typeof atelierAccounts.$inferInsert);
    await db.insert(atelierCliSessions).values({
      id: SESSION_ID,
      orgId: p.orgId,
      userId: p.id,
    } as typeof atelierCliSessions.$inferInsert);
    const pendingInput = {
      name: OPP_NAME,
      accountId: ACCT_ID,
      description: "Double-confirm race probe opportunity",
      runScout: false,
      confirm: true,
    };
    await db.insert(atelierCliTurns).values({
      id: TURN_ID,
      orgId: p.orgId,
      sessionId: SESSION_ID,
      userId: p.id,
      prompt: `create opportunity ${OPP_NAME}`,
      status: "awaiting_confirmation",
      frames: [],
      pendingWrite: { tool: "opportunity_create", input: pendingInput },
      lastStepIdx: 0,
    } as typeof atelierCliTurns.$inferInsert);

    const runConfirm = async (): Promise<{
      status: string;
      frames: CliFrame[];
    }> => {
      const frames: CliFrame[] = [];
      const r = await runTurn(
        { sessionId: null, prompt: "(confirm)", confirmTurnId: TURN_ID },
        { persona, emit: (f) => frames.push(f) },
      );
      return { status: String(r.status), frames };
    };

    // Two concurrent confirms — the double-click race.
    const [a, b] = await Promise.all([runConfirm(), runConfirm()]);

    for (const [label, r] of [
      ["first", a],
      ["second", b],
    ] as const) {
      assert.ok(
        r.status === "success" || r.status === "partial",
        `${label} confirm terminal status is ${r.status}, expected success`,
      );
      assert.ok(
        !r.frames.some((f) => f.type === "error"),
        `${label} confirm emitted an error frame`,
      );
      const final = r.frames.find((f) => f.type === "final");
      assert.ok(final, `${label} confirm emitted a final frame`);
    }

    // Exactly one opportunity row.
    const rows = await db
      .select()
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.accountId, ACCT_ID),
          eq(atelierOpportunities.name, OPP_NAME),
        ),
      );
    assert.equal(rows.length, 1, `expected 1 opportunity row, got ${rows.length}`);
    console.log("✓ concurrent double-confirm commits exactly one opportunity");

    // Third, sequential confirm — replay of the finished turn.
    const c = await runConfirm();
    const finalC = c.frames.find((f) => f.type === "final");
    assert.ok(finalC, "third confirm emitted final");
    assert.equal(
      (finalC!.data as { replay?: boolean }).replay,
      true,
      "third confirm is a replay",
    );
    const rows2 = await db
      .select()
      .from(atelierOpportunities)
      .where(
        and(
          eq(atelierOpportunities.accountId, ACCT_ID),
          eq(atelierOpportunities.name, OPP_NAME),
        ),
      );
    assert.equal(rows2.length, 1, "still exactly one opportunity after replay");
    console.log("✓ re-confirm on a finished turn replays final (no second insert)");

    console.log("ALL DOUBLE-CONFIRM TESTS PASSED");
  } finally {
    await cleanup(p.orgId);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
