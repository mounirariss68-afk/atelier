/**
 * Clarification durability probe.
 *
 * Pins the rehydration surfaces added after clarification questions were
 * observed to vanish on page reload / server restart:
 *   1. GET /cli/turns/pending-clarification returns the question when the
 *      persona's most recent turn is awaiting_clarification.
 *   2. It returns null when a newer turn supersedes the question.
 *   3. It returns null for a persona with no turns.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/pending-clarification-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns } = D as any;
  const { like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probepc_${Date.now()}`;
  const userId = `u_${runTag}`;
  const sessId = `clis_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const get = async (path: string, who: string = userId) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: { cookie: `atelier_persona=${who}` },
    });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId,
      orgId: "aico",
      email: `${runTag}@test.local`,
      name: `Probe ${runTag}`,
      initials: "PB",
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Probe",
    });
    await db.insert(atelierCliSessions).values({
      id: sessId,
      orgId: "aico",
      userId,
      title: runTag,
    });
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_1`,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "awaiting_clarification",
      prompt: "create new account masdar (probe)",
      frames: [
        { type: "narration", data: { text: "researching" } },
        {
          type: "needs_clarification",
          data: {
            step: 0,
            tool: "prefill_from_specialist",
            field: "entityRole",
            question: "HQ or branch?",
            partial: { kind: "account" },
            suggestions: [{ id: "hq", label: "Global headquarters" }],
          },
        },
      ],
    });

    const r1 = await get("/cli/turns/pending-clarification");
    check("returns pending question", r1.status === 200 && r1.json?.pending?.turnId === `clit_${runTag}_1`, r1);
    check(
      "clarification payload intact",
      r1.json?.pending?.clarification?.field === "entityRole" &&
        r1.json?.pending?.clarification?.question === "HQ or branch?" &&
        r1.json?.pending?.clarification?.suggestions?.[0]?.label === "Global headquarters" &&
        r1.json?.pending?.sessionId === sessId,
      r1.json,
    );

    // Newer completed turn supersedes the question.
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_2`,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "success",
      prompt: "something else",
      frames: [],
      createdAt: new Date(Date.now() + 1000),
    });
    const r2 = await get("/cli/turns/pending-clarification");
    check("superseded → null", r2.status === 200 && r2.json?.pending === null, r2.json);

    const r3 = await get("/cli/turns/pending-clarification", "u_no_such_user");
    check("unknown persona rejected", r3.status === 401 || r3.json?.pending === null, r3);

    // ------------------------------------------------------------------
    // Task #184 — clarification survives session rollover.
    // ------------------------------------------------------------------
    const { runTurn: _rt, getOrCreateSession } = await import(
      "../../src/lib/atelier-cli/index.js"
    );
    const persona = {
      id: userId,
      name: `Probe ${runTag}`,
      role: "founding_partner",
      orgId: "aico",
    };

    // (a) Idle session whose latest turn awaits clarification is NOT
    // rolled over — the inactivity clock pauses on an open question.
    const sessPaused = `clis_${runTag}_paused`;
    const staleAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await db.insert(atelierCliSessions).values({
      id: sessPaused,
      orgId: "aico",
      userId,
      title: `${runTag} paused`,
      lastTurnAt: staleAt,
      updatedAt: staleAt,
      createdAt: staleAt,
    });
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_paused`,
      orgId: "aico",
      sessionId: sessPaused,
      userId,
      status: "awaiting_clarification",
      prompt: "paused question",
      frames: [
        {
          type: "needs_clarification",
          data: { step: 0, tool: "prefill_from_specialist", field: "entityRole", question: "HQ?", partial: {} },
        },
      ],
      createdAt: staleAt,
    });
    const kept = await getOrCreateSession(persona as any, sessPaused);
    check("idle session with open question is kept live", kept.id === sessPaused, kept.id);

    // (b) Idle session with a terminal latest turn DOES roll over.
    const sessRoll = `clis_${runTag}_roll`;
    await db.insert(atelierCliSessions).values({
      id: sessRoll,
      orgId: "aico",
      userId,
      title: `${runTag} roll`,
      lastTurnAt: staleAt,
      updatedAt: staleAt,
      createdAt: staleAt,
    });
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_roll`,
      orgId: "aico",
      sessionId: sessRoll,
      userId,
      status: "success",
      prompt: "done thing",
      frames: [],
      createdAt: staleAt,
    });
    const rolled = await getOrCreateSession(persona as any, sessRoll);
    check("idle session without open question rolls over", rolled.id !== sessRoll, rolled.id);
    // Clean the rolled-over replacement session immediately.
    await db.delete(atelierCliSessions).where(like(atelierCliSessions.id, rolled.id));

    // (c) Task #196 — cross-session supersession. Retire the earlier
    // awaiting turn _1 so the stale paused turn is the persona's newest
    // OPEN question, while the newer terminal turn _2 still exists in a
    // DIFFERENT session. Any newer turn by the same user, in any
    // session, supersedes an abandoned question — this is what stops
    // old questions resurrecting after the user has moved on.
    await db
      .update(atelierCliTurns)
      .set({ status: "cancelled" })
      .where(like(atelierCliTurns.id, `clit_${runTag}_1`));
    const r4a = await get("/cli/turns/pending-clarification");
    check(
      "newer turn in a DIFFERENT session supersedes → null",
      r4a.status === 200 && r4a.json?.pending === null,
      r4a.json,
    );

    // (c2) A pending question stranded in a soft-deleted session
    // (old-build rollover) is still restorable when it IS the user's
    // latest turn — genuine pause + reload must still rehydrate. Remove
    // all newer turns first.
    await db
      .delete(atelierCliTurns)
      .where(like(atelierCliTurns.id, `clit_${runTag}_1`));
    await db
      .delete(atelierCliTurns)
      .where(like(atelierCliTurns.id, `clit_${runTag}_2`));
    await db
      .delete(atelierCliTurns)
      .where(like(atelierCliTurns.id, `clit_${runTag}_roll`));
    await db
      .update(atelierCliSessions)
      .set({ deletedAt: new Date() })
      .where(like(atelierCliSessions.id, sessPaused));
    const r4 = await get("/cli/turns/pending-clarification");
    check(
      "genuinely-paused latest question (soft-deleted session) still restorable",
      r4.status === 200 && r4.json?.pending?.turnId === `clit_${runTag}_paused`,
      r4.json,
    );
    check(
      "restored clarification payload intact",
      r4.json?.pending?.clarification?.field === "entityRole",
      r4.json,
    );

    // (d) Questions older than 7 days expire.
    const ancient = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db
      .update(atelierCliTurns)
      .set({ createdAt: ancient })
      .where(like(atelierCliTurns.id, `clit_${runTag}_paused`));
    const r5 = await get("/cli/turns/pending-clarification");
    check("stale question (>7d) expires", r5.status === 200 && r5.json?.pending === null, r5.json);

    // (e) Task #196 — continuation resolution still cancels its source
    // turn. Answer a restored card via runTurn(continuesTurnId=...) with
    // a deterministic tool (resolve_account_by_name) — no LLM call is
    // made because the deterministic continuation path short-circuits
    // the model loop. Whatever the tool outcome (here: no match), the
    // paused source turn must flip out of awaiting_clarification.
    const { eq } = await import("drizzle-orm");
    const { runTurn } = await import("../../src/lib/atelier-cli/index.js");
    const sessCont = `clis_${runTag}_cont`;
    await db.insert(atelierCliSessions).values({
      id: sessCont,
      orgId: "aico",
      userId,
      title: `${runTag} cont`,
    });
    const contSrcId = `clit_${runTag}_contsrc`;
    await db.insert(atelierCliTurns).values({
      id: contSrcId,
      orgId: "aico",
      sessionId: sessCont,
      userId,
      status: "awaiting_clarification",
      prompt: "find that account (probe)",
      frames: [
        {
          type: "needs_clarification",
          data: {
            step: 0,
            tool: "resolve_account_by_name",
            field: "query",
            question: "Which account?",
            partial: {},
          },
        },
      ],
    });
    try {
      await runTurn(
        {
          prompt: `no_such_account_${runTag}`,
          continuesTurnId: contSrcId,
          sessionId: sessCont,
        },
        { persona: persona as any, emit: () => {} },
      );
    } catch (e) {
      check("continuation runTurn does not throw", false, e);
    }
    const [srcAfter] = await db
      .select({ status: atelierCliTurns.status })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, contSrcId));
    check(
      "continuation resolution cancels its source turn",
      srcAfter?.status === "cancelled",
      srcAfter,
    );
    // The answered question must not resurrect even though the
    // continuation turn is newer activity.
    const r6 = await get("/cli/turns/pending-clarification");
    check("answered question does not resurrect", r6.status === 200 && r6.json?.pending === null, r6.json);
    await db.delete(atelierCliTurns).where(eq(atelierCliTurns.sessionId, sessCont));

    // (f) Task #196 — pressing Cancel on a clarification card must kill
    // the paused question (DB + in-memory), so the next prompt is NOT
    // hijacked as the answer and the question never re-asks.
    const { cancelPendingWrite } = await import(
      "../../src/lib/atelier-cli/index.js"
    );
    const cancelId = `clit_${runTag}_cancel`;
    await db.insert(atelierCliTurns).values({
      id: cancelId,
      orgId: "aico",
      sessionId: sessCont,
      userId,
      status: "awaiting_clarification",
      prompt: "add new client masdar (probe cancel)",
      frames: [
        {
          type: "needs_clarification",
          data: {
            step: 0,
            tool: "prefill_from_specialist",
            field: "entityRole",
            question: "HQ or branch?",
            partial: {},
          },
        },
      ],
    });
    const cx = await cancelPendingWrite(cancelId, persona as any);
    check("cancel resolves an awaiting_clarification turn", cx.status === "cancelled", cx);
    const [cRow] = await db
      .select({ status: atelierCliTurns.status })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, cancelId));
    check("cancelled clarification persisted", cRow?.status === "cancelled", cRow);
    const r7 = await get("/cli/turns/pending-clarification");
    check("cancelled question does not rehydrate", r7.status === 200 && r7.json?.pending === null, r7.json);
    await db.delete(atelierCliTurns).where(eq(atelierCliTurns.sessionId, sessCont));
  } finally {
    await db.delete(atelierCliTurns).where(like(atelierCliTurns.id, `clit_${runTag}%`));
    await db.delete(atelierCliSessions).where(like(atelierCliSessions.id, `clis_${runTag}%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, userId));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
