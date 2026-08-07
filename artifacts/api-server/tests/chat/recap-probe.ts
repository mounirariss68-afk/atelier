/**
 * Task #781 — offline probe for proactive-recap relevance.
 * Pure — no DB, no LLM.
 *
 * Run: tsx ./tests/chat/recap-probe.ts (part of test:chat-suite)
 */
import {
  shouldEmitProactiveRecap,
  composeRecapSummary,
  isTrivialRecapLine,
  PROACTIVE_RECAP_DORMANT_MS,
} from "../../src/lib/atelier-cli/recap-relevance.js";

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail?: unknown) => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.error(`  ✗ ${name}`, detail ?? "");
  }
};

const NOW = Date.parse("2026-08-07T12:00:00Z");
const meaningfulSummary =
  "[09:00:01] draft the renewal email for Acme → success (2 tools)\n" +
  "[09:05:12] show my open expense drafts → success (1 tool)";
const trivialSummary = "[17:57:13] who are you? → success";

console.log("[1] trigger — no recap at ~0h dormancy (the reported bug)");
{
  check(
    "0h dormancy suppressed even with cold draft + meaningful summary",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - 30_000,
      nowMs: NOW,
      rollingSummary: meaningfulSummary,
    }),
  );
  check(
    "just-under-threshold dormancy suppressed",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - (PROACTIVE_RECAP_DORMANT_MS - 60_000),
      nowMs: NOW,
      rollingSummary: meaningfulSummary,
    }),
  );
  check(
    "unknown lastTurnAt (0) never claims dormancy",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: 0,
      nowMs: NOW,
      rollingSummary: meaningfulSummary,
    }),
  );
}

console.log("[2] trigger — recap still fires after genuine dormancy");
{
  check(
    ">6h dormancy with meaningful summary fires",
    shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - (PROACTIVE_RECAP_DORMANT_MS + 60_000),
      nowMs: NOW,
      rollingSummary: meaningfulSummary,
    }),
  );
  check(
    ">6h dormancy but empty summary stays quiet",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - (PROACTIVE_RECAP_DORMANT_MS + 60_000),
      nowMs: NOW,
      rollingSummary: "",
    }),
  );
  check(
    ">6h dormancy but only trivial turns stays quiet",
    !shouldEmitProactiveRecap({
      lastTurnAtMs: NOW - (PROACTIVE_RECAP_DORMANT_MS + 60_000),
      nowMs: NOW,
      rollingSummary: trivialSummary,
    }),
  );
}

console.log("[3] content — trivial lines never headline a recap");
{
  check("'who are you?' is trivial", isTrivialRecapLine("[17:57:13] who are you? → success"));
  check("'hi' is trivial", isTrivialRecapLine("[10:00:00] hi → success"));
  check("'thanks!' is trivial", isTrivialRecapLine("[10:00:00] thanks! → success"));
  check(
    "'what can you do?' is trivial",
    isTrivialRecapLine("[10:00:00] what can you do? → success"),
  );
  check(
    "real work line is not trivial",
    !isTrivialRecapLine("[09:00:01] draft the renewal email for Acme → success (2 tools)"),
  );
  check(
    "prompt containing a trivial word mid-sentence is not trivial",
    !isTrivialRecapLine("[09:00:01] help me reconcile the Acme invoices → success (3 tools)"),
  );
  check(
    "line without timestamp/arrow still classified by prompt",
    isTrivialRecapLine("hello"),
  );
}

console.log("[4] content — composeRecapSummary filters and caps");
{
  const mixed =
    trivialSummary + "\n" + meaningfulSummary + "\n[11:00:00] hello → success";
  const out = composeRecapSummary(mixed);
  check("trivial lines dropped from summary", out !== null && !out.includes("who are you"));
  check("meaningful lines kept", out !== null && out.includes("renewal email for Acme"));
  check("all-trivial summary composes to null", composeRecapSummary(trivialSummary) === null);
  check("empty/null summary composes to null", composeRecapSummary("") === null && composeRecapSummary(null) === null);
  const many = Array.from({ length: 9 }, (_, i) => `[0${i}:00:00] task number ${i} → success (1 tool)`).join("\n");
  const capped = composeRecapSummary(many);
  check(
    "caps at last 5 meaningful lines",
    capped !== null && capped.split("\n").length === 5 && capped.includes("task number 8") && !capped.includes("task number 3"),
  );
}

console.log(`\nrecap-probe: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
