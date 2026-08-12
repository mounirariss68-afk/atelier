/**
 * Task #843 — planner answer vs clientTurnKey dedupe probe.
 *
 * Pins the fix for the mobile flight planner's dead Search button: the
 * mobile client streamed the clarification ANSWER into the same UI turn
 * and (pre-fix) reused the asked turn's clientTurnKey. The server's
 * idempotency dedupe treated the awaiting_clarification turn as terminal
 * and REPLAYED its frames — silently swallowing the answer.
 *
 *   1. An answer-shaped request (continuesTurnId + clarificationValues)
 *      that reuses the paused turn's clientTurnKey must RUN the
 *      continuation (travel_plan_trip confirms the plan), not replay.
 *   2. A non-answer-shaped duplicate with the same key still dedupes
 *      (idempotent replay preserved for genuine retries).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/planner-answer-dedupe-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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
  const { like, eq } = await import("drizzle-orm");
  const { runTurn } = await import("../../src/lib/atelier-cli/index.js");

  const runTag = `probepd_${Date.now()}`;
  const userId = `u_${runTag}`;
  const sessId = `clis_${runTag}`;
  const clientKey = `t_${runTag}_key`;

  const planner = {
    tripType: "one_way",
    segments: [
      {
        origin: { text: "Dubai", iata: "DXB", label: "Dubai Intl" },
        destination: { text: "Istanbul", iata: "IST", label: "Istanbul" },
        date: "",
      },
    ],
    adults: 1,
    cabinClass: "economy",
  };
  const askFrames = [
    {
      type: "needs_clarification",
      data: {
        step: 0,
        tool: "travel_plan_trip",
        field: "plan",
        question:
          "Here's your trip so far — adjust anything and confirm to start searching.",
        partial: {},
        suggestions: [],
        fields: [
          { field: "plan", label: "Trip plan", inputType: "flight_planner", planner },
        ],
      },
    },
  ];

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
    const srcId = `clit_${runTag}_src`;
    await db.insert(atelierCliTurns).values({
      id: srcId,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "awaiting_clarification",
      prompt: "fly me to istanbul (probe)",
      clientTurnKey: clientKey,
      frames: askFrames,
    });

    const persona = {
      id: userId,
      name: `Probe ${runTag}`,
      role: "founding_partner",
      orgId: "aico",
    };

    // ------------------------------------------------------------------
    // 1. Answer with the SAME clientTurnKey — must run, not replay.
    // ------------------------------------------------------------------
    const confirmedPlan = {
      ...planner,
      segments: [{ ...planner.segments[0], date: "2027-03-10" }],
    };
    const emitted: Array<{ type: string; data: any }> = [];
    await runTurn(
      {
        prompt: "One-way DXB → IST · 2027-03-10 · 1 passenger · Economy",
        sessionId: sessId,
        continuesTurnId: srcId,
        clarificationValues: { plan: JSON.stringify(confirmedPlan) },
        clientTurnKey: clientKey,
      },
      { persona: persona as any, emit: (f: any) => emitted.push(f) },
    );

    const finalFrame = emitted.find((f) => f.type === "final");
    check(
      "answer with reused key is NOT dedupe-replayed",
      !!finalFrame && finalFrame.data?.replay !== true,
      finalFrame?.data,
    );
    const planResult = emitted.find(
      (f) => f.type === "tool_result" && f.data?.tool === "travel_plan_trip",
    );
    check(
      "continuation ran travel_plan_trip with the confirmed plan",
      !!planResult && planResult.data?.ok === true,
      emitted.map((f) => f.type),
    );
    check(
      "confirmed plan echoed back (search script starts)",
      planResult?.data?.data?.plan?.tripType === "one_way",
      planResult?.data?.data,
    );
    check(
      "answer turn did not re-ask the planner question",
      !emitted.some((f) => f.type === "needs_clarification"),
    );
    // Chain handoff regression pin: a confirmed plan must NOT strand the
    // user on the plan card — the turn must continue into the model loop
    // and actually run the flight search for leg 1.
    check(
      "confirmed plan chains into travel_search_flights (no stranded card)",
      emitted.some(
        (f) => f.type === "tool_call" && f.data?.tool === "travel_search_flights",
      ),
      emitted.map((f) => `${f.type}:${f.data?.tool ?? ""}`),
    );
    const [srcAfter] = await db
      .select({ status: atelierCliTurns.status })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, srcId));
    check(
      "paused source turn retired after answer",
      srcAfter?.status === "cancelled",
      srcAfter,
    );

    // ------------------------------------------------------------------
    // 2. Non-answer duplicate with a reused key still replays (retry
    //    idempotency preserved).
    // ------------------------------------------------------------------
    const dupKey = `t_${runTag}_dup`;
    await db.insert(atelierCliTurns).values({
      id: `clit_${runTag}_done`,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "success",
      prompt: "done turn (probe)",
      clientTurnKey: dupKey,
      frames: [{ type: "narration", data: { text: "done" } }],
    });
    const emitted2: Array<{ type: string; data: any }> = [];
    await runTurn(
      { prompt: "done turn (probe)", sessionId: sessId, clientTurnKey: dupKey },
      { persona: persona as any, emit: (f: any) => emitted2.push(f) },
    );
    const final2 = emitted2.find((f) => f.type === "final");
    check(
      "plain duplicate still dedupe-replays",
      !!final2 && final2.data?.replay === true,
      final2?.data,
    );
  } finally {
    await db
      .delete(atelierCliTurns)
      .where(like(atelierCliTurns.sessionId, `clis_${runTag}%`));
    await db
      .delete(atelierCliSessions)
      .where(like(atelierCliSessions.id, `clis_${runTag}%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
