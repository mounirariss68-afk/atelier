/**
 * Task #410 — mobile chat frame reducer probe (pure, no expo imports).
 *
 * Pins:
 *   1. needs_clarification single-field: fabricated field has an EMPTY
 *      label (question is the card headline — no duplicate text) and
 *      maps server suggestions ({id,label}) to tappable choices.
 *   2. serverTurnId is captured from ANY frame carrying turnId (e.g. a
 *      needs_clarification frame), not only the happy-path final frame,
 *      so the answer carries continuesTurnId even after an in-turn error.
 *   3. Explicit fields arrays pass through untouched.
 *
 * Run: pnpm --filter atelier-mobile exec tsx tests/chat-frames-probe.ts
 */
import { applyFrame, type ChatTurn } from "../lib/chatFrames";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

function freshTurn(): ChatTurn {
  return {
    key: "t1",
    prompt: "create new account mashreq",
    status: "streaming",
    text: "",
    trace: [],
    toolResults: [],
  };
}

// 1. Single-field clarification: no duplicate label, suggestion chips.
const asked = applyFrame(freshTurn(), "needs_clarification", {
  step: 0,
  tool: "prefill_from_specialist",
  field: "entityRole",
  question: "Is Mashreq the global headquarters or a branch?",
  suggestions: [
    { id: "hq", label: "Global headquarters" },
    { id: "branch", label: "A branch / local office" },
    { id: "", label: "junk dropped" },
  ],
  fields: [],
  turnId: "clit_server_1",
});
check("status flips to needs_clarification", asked.status === "needs_clarification");
check(
  "question rendered once — fabricated field label is EMPTY",
  asked.clarification?.fields.length === 1 &&
    asked.clarification.fields[0].field === "entityRole" &&
    asked.clarification.fields[0].label === "",
  asked.clarification,
);
check(
  "suggestions map to {id,label} choices (junk filtered)",
  asked.clarification?.fields[0].choices?.length === 2 &&
    asked.clarification.fields[0].choices?.[0].id === "hq" &&
    asked.clarification.fields[0].choices?.[1].label === "A branch / local office",
  asked.clarification?.fields[0].choices,
);

// 2. serverTurnId captured from the clarification frame itself…
check(
  "serverTurnId captured from needs_clarification frame",
  asked.serverTurnId === "clit_server_1",
  asked.serverTurnId,
);
// …and a later in-turn error does NOT erase it (re-ask loop root cause).
const errored = applyFrame(asked, "error", { code: "internal", message: "classifier abort" });
check(
  "in-turn error keeps serverTurnId for continuesTurnId",
  errored.status === "error" && errored.serverTurnId === "clit_server_1",
  errored,
);
// A degraded final without turnId also keeps it.
const finalDegraded = applyFrame(asked, "final", { status: "error" });
check(
  "degraded final without turnId keeps captured serverTurnId",
  finalDegraded.serverTurnId === "clit_server_1",
  finalDegraded.serverTurnId,
);

// 3. Explicit multi-field clarifications pass through untouched.
const multi = applyFrame(freshTurn(), "needs_clarification", {
  question: "Need two things",
  fields: [
    { field: "a", label: "Field A" },
    { field: "b", label: "Field B", options: ["x", "y"] },
  ],
});
check(
  "explicit fields array passes through",
  multi.clarification?.fields.length === 2 &&
    multi.clarification.fields[0].label === "Field A" &&
    multi.clarification.fields[1].options?.[1] === "y",
  multi.clarification,
);

// 4. No suggestions → free-text field (no choices), still no dup label.
const freeText = applyFrame(freshTurn(), "needs_clarification", {
  field: "query",
  question: "Which account?",
  suggestions: [],
});
check(
  "no suggestions → single empty-label free-text field",
  freeText.clarification?.fields.length === 1 &&
    freeText.clarification.fields[0].label === "" &&
    !freeText.clarification.fields[0].choices,
  freeText.clarification,
);

// 5. Task #597 — confirm flow duplicate-card pin. The confirm response
// streams into the SAME turn key; tool_result frames APPEND. Without
// the pre-stream reset in useChat.confirm the pre-confirm preview card
// stacks with the committed card (two write_success cards).
{
  // Pre-confirm: preview tool_result + awaiting_confirmation final.
  let t = freshTurn();
  t = applyFrame(t, "tool_result", {
    tool: "meeting_update",
    ok: true,
    data: { shape: "write_success", preview: true },
  });
  t = applyFrame(t, "final", { status: "awaiting_confirmation", turnId: "clit_c1" });
  check("pre-confirm turn holds one preview card", t.toolResults.length === 1);

  // The bug: streaming the confirm without reset appends a 2nd card.
  const noReset = applyFrame(t, "tool_result", {
    tool: "meeting_update",
    ok: true,
    data: { shape: "write_success" },
  });
  check(
    "without reset the committed card would stack (documents the bug)",
    noReset.toolResults.length === 2,
  );

  // The fix: useChat.confirm resets streamed output before re-streaming.
  const reset: ChatTurn = {
    ...t,
    status: "streaming",
    pending: undefined,
    text: "",
    trace: [],
    toolResults: [],
    result: undefined,
  };
  let done = applyFrame(reset, "tool_result", {
    tool: "meeting_update",
    ok: true,
    data: { shape: "write_success" },
  });
  done = applyFrame(done, "final", {
    status: "success",
    turnId: "clit_c1",
    result: { title: "Meeting rescheduled", summary: "Moved to 9am" },
  });
  check(
    "after reset exactly one committed card renders",
    done.toolResults.length === 1 && done.status === "complete",
    done.toolResults,
  );
  check(
    "post-confirm narration is fresh (no pre-confirm concat)",
    done.text === "Meeting rescheduled\n\nMoved to 9am",
    done.text,
  );
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
