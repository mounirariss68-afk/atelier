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

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
