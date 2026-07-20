/**
 * Task #410 — clarification error-resume probe.
 *
 * Pins the fix for the mobile "re-ask loop": a turn that EMITTED a
 * needs_clarification frame but then errored later in the same turn
 * (classifier abort, bookkeeping failure, …) must remain answerable.
 *
 *   1. isClarificationResumable() accepts error/partial turns whose
 *      frames contain needs_clarification (and rejects those without).
 *   2. runTurn(continuesTurnId=<errored ask turn>) rehydrates and runs
 *      the deterministic continuation (prefill_from_specialist with a
 *      cached __researchedDraft — no Cartographer/LLM call), producing
 *      an account_proposal instead of re-asking.
 *   3. The errored source turn is retired (cancelled) once answered.
 *   4. needs_clarification frames now carry the turn id so clients can
 *      set continuesTurnId even when the final frame is degraded.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/clarification-error-resume-probe.ts
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
  const { db, pool, atelierUsers, atelierCliSessions, atelierCliTurns } =
    D as any;
  const { like, eq } = await import("drizzle-orm");
  const {
    runTurn,
    isClarificationResumable,
    framesContainClarification,
  } = await import("../../src/lib/atelier-cli/index.js");

  const runTag = `probeer_${Date.now()}`;
  const userId = `u_${runTag}`;
  const sessId = `clis_${runTag}`;

  const askFrames = [
    { type: "narration", data: { text: "researching" } },
    {
      type: "needs_clarification",
      data: {
        step: 0,
        tool: "prefill_from_specialist",
        field: "entityRole",
        question: "Is Mashreq the global headquarters or a branch?",
        partial: {
          kind: "account",
          input: {
            kind: "account",
            name: "Mashreq",
            __researchedDraft: {
              name: "Mashreq Bank",
              brandName: "Mashreq",
              country: "United Arab Emirates",
              sector: "Banking",
              hqCity: "Dubai",
              strategicPriorities: [],
              sourceSignals: [],
              decisionMakers: [],
              countryPresence: [
                { country: "United Arab Emirates", role: "hq" },
                { country: "Egypt", role: "branch" },
              ],
            },
          },
        },
        suggestions: [
          { id: "hq", label: "Global headquarters" },
          { id: "branch", label: "A branch / local office" },
        ],
      },
    },
    { type: "error", data: { code: "internal", message: "classifier abort" } },
  ];

  try {
    // ------------------------------------------------------------------
    // 1. Pure helper semantics.
    // ------------------------------------------------------------------
    check(
      "helper: awaiting_clarification always resumable",
      isClarificationResumable("awaiting_clarification", []),
    );
    check(
      "helper: error + ask frame resumable",
      isClarificationResumable("error", askFrames),
    );
    check(
      "helper: partial + ask frame resumable",
      isClarificationResumable("partial", askFrames),
    );
    check(
      "helper: error WITHOUT ask frame NOT resumable",
      !isClarificationResumable("error", [
        { type: "narration", data: { text: "x" } },
      ]),
    );
    check(
      "helper: success not resumable",
      !isClarificationResumable("success", askFrames),
    );
    check(
      "helper: frames detector handles junk",
      !framesContainClarification(null) && !framesContainClarification("x"),
    );

    // ------------------------------------------------------------------
    // 2. End-to-end: answer an ERRORED ask turn via continuesTurnId.
    // ------------------------------------------------------------------
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
      status: "error", // the bug: asked, then errored later in the turn
      prompt: "create new account mashreq (probe)",
      frames: askFrames,
    });

    const persona = {
      id: userId,
      name: `Probe ${runTag}`,
      role: "founding_partner",
      orgId: "aico",
    };
    const emitted: Array<{ type: string; data: any }> = [];
    await runTurn(
      {
        prompt: "hq",
        continuesTurnId: srcId,
        sessionId: sessId,
        clarificationValues: { entityRole: "hq" },
      },
      { persona: persona as any, emit: (f: any) => emitted.push(f) },
    );

    const reAsk = emitted.filter((f) => f.type === "needs_clarification");
    check("continuation does NOT re-ask the question", reAsk.length === 0, reAsk);
    const toolResults = emitted.filter((f) => f.type === "tool_result");
    const prefill = toolResults.find(
      (f) => f.data?.tool === "prefill_from_specialist",
    );
    check(
      "continuation ran prefill_from_specialist deterministically",
      !!prefill && prefill.data?.ok !== false,
      toolResults.map((f) => f.data?.tool),
    );
    const proposal = prefill?.data?.data;
    check(
      "cached draft reused → account_proposal with entityRole=hq (no Cartographer)",
      proposal?.shape === "account_proposal" &&
        proposal?.draft?.entityRole === "hq" &&
        proposal?.draft?.name === "Mashreq Bank" &&
        proposal?.specialist?.costUsd === 0,
      proposal,
    );
    const finalFrame = emitted.find((f) => f.type === "final");
    check(
      "continuation final is not another clarification",
      !!finalFrame && finalFrame.data?.status !== "awaiting_clarification",
      finalFrame?.data,
    );

    const [srcAfter] = await db
      .select({ status: atelierCliTurns.status })
      .from(atelierCliTurns)
      .where(eq(atelierCliTurns.id, srcId));
    check(
      "errored source turn retired (cancelled) after answer",
      srcAfter?.status === "cancelled",
      srcAfter,
    );

    // ------------------------------------------------------------------
    // 3. needs_clarification frames carry the turn id (client capture).
    // ------------------------------------------------------------------
    const askEmitted: Array<{ type: string; data: any }> = [];
    const src2 = `clit_${runTag}_src2`;
    await db.insert(atelierCliTurns).values({
      id: src2,
      orgId: "aico",
      sessionId: sessId,
      userId,
      status: "error",
      prompt: "create new account mashreq again (probe)",
      frames: askFrames,
      createdAt: new Date(Date.now() + 1000),
    });
    // Answer ambiguously so the tool re-pauses → emits a fresh
    // needs_clarification continuation frame we can inspect.
    await runTurn(
      {
        prompt: "not sure yet",
        continuesTurnId: src2,
        sessionId: sessId,
        clarificationValues: { entityRole: "not sure yet" },
      },
      { persona: persona as any, emit: (f: any) => askEmitted.push(f) },
    );
    const reAsk2 = askEmitted.find((f) => f.type === "needs_clarification");
    check(
      "ambiguous answer re-pauses with turnId stamped on the ask frame",
      !!reAsk2 &&
        typeof reAsk2.data?.turnId === "string" &&
        reAsk2.data.turnId.length > 0,
      reAsk2?.data,
    );
  } finally {
    await db
      .delete(atelierCliTurns)
      .where(like(atelierCliTurns.sessionId, `clis_${runTag}%`));
    await db
      .delete(atelierCliSessions)
      .where(like(atelierCliSessions.id, `clis_${runTag}%`));
    await db.delete(atelierUsers).where(like(atelierUsers.id, userId));
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
