/**
 * Clarification continuation-gate probe.
 *
 * Pins the gate that prevents unrelated fresh prompts from being consumed
 * as clarification answers when a question is pending:
 *   - answer-shaped prompts (short, single-line, non-command) pass the gate
 *   - fresh commands / long / multi-line prompts fail the gate and would
 *     supersede the pending question instead of being hijacked
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/clarification-gate-probe.ts
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
  const { looksLikeClarificationAnswer } = await import(
    "../../src/lib/atelier-cli/index.js"
  );

  // Answer-shaped prompts — should be consumed as answers.
  check("plain enum answer", looksLikeClarificationAnswer("headquarters") === true);
  check("short free-text answer", looksLikeClarificationAnswer("it's the Dubai branch") === true);
  check("numeric answer", looksLikeClarificationAnswer("250") === true);
  check("yes answer", looksLikeClarificationAnswer("yes, the HQ one") === true);

  // Unrelated fresh prompts — must NOT be hijacked.
  check(
    "fresh add-command rejected",
    looksLikeClarificationAnswer("add mobile +971506504416 for Mounir Ariss") === false,
  );
  check(
    "fresh show-command rejected",
    looksLikeClarificationAnswer("show my open RAID items") === false,
  );
  check(
    "fresh question rejected",
    looksLikeClarificationAnswer("what accounts do we have in KSA?") === false,
  );
  check(
    "long prompt rejected",
    looksLikeClarificationAnswer(
      "the client mentioned during the last steering committee that they want us to also cover the data migration workstream in the proposal",
    ) === false,
  );
  check("multi-line prompt rejected", looksLikeClarificationAnswer("hq\nalso add a task") === false);
  check("empty prompt rejected", looksLikeClarificationAnswer("   ") === false);

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASH", err);
  process.exit(1);
});
