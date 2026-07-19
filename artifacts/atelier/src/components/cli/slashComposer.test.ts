/**
 * Task #315 — regression tests for the slash-command composer keyboard model.
 *
 * Task #297 found two composer bugs in a real browser run:
 *   1. Picking a slash candidate produced "//contract-prepare" — catalog
 *      slashAliases already carry a leading slash.
 *   2. While the suggestion menu was open, Enter re-picked the candidate and
 *      silently reset the input, so a slash command with arguments could
 *      never be submitted. The menu must close once args are typed.
 *
 * CommandBar.tsx delegates these decisions to the pure helpers in
 * slashComposer.ts; these tests fail if either behavior regresses.
 *
 * Vitest is not installed in the atelier artifact (matching useCli.test.ts).
 * Run with:
 *
 *   pnpm --filter @workspace/atelier test:slash-composer
 *
 * Exits non-zero if any assertion fails.
 */
import {
  slashInsertionText,
  slashInputHasArgs,
  shouldSlashMenuOpen,
  enterAction,
} from "./slashComposer";
import type { CliCapability } from "./types";

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  \u2713 ${name}`);
  } catch (err) {
    fail++;
    console.error(`  \u2717 ${name}\n      ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}
function assertEqual<T>(actual: T, expected: T, msg: string): void {
  if (actual !== expected) {
    throw new Error(`${msg}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

function cap(overrides: Partial<CliCapability> = {}): CliCapability {
  return {
    id: "contracts.prepare",
    module: "contracts",
    toolName: "contract_prepare",
    description: "Prepare a contract",
    // As stored in the real catalog: aliases carry a leading slash.
    slashAliases: { en: ["/contract-prepare"], fr: ["/contrat-preparer"] },
    isWrite: true,
    irreversible: false,
    surfaceOn: [],
    twoPhaseConfirm: true,
    outboundChannel: null,
    resultCard: "generic",
    ...overrides,
  } as CliCapability;
}

console.log("slashInsertionText \u2014 picking a candidate inserts a single slash");

test("alias with a leading slash is not doubled", () => {
  assertEqual(slashInsertionText(cap(), "en"), "/contract-prepare ", "picked text");
});

test("alias without a leading slash still gets exactly one", () => {
  assertEqual(
    slashInsertionText(cap({ slashAliases: { en: ["contract-prepare"] } }), "en"),
    "/contract-prepare ",
    "picked text",
  );
});

test("locale alias is preferred, en fallback otherwise, then toolName", () => {
  assertEqual(slashInsertionText(cap(), "fr"), "/contrat-preparer ", "fr alias");
  assertEqual(slashInsertionText(cap(), "ar"), "/contract-prepare ", "en fallback");
  assertEqual(
    slashInsertionText(cap({ slashAliases: {} }), "en"),
    "/contract_prepare ",
    "toolName fallback",
  );
});

console.log("shouldSlashMenuOpen \u2014 menu closes once arguments are typed");

test("menu opens for a bare or partial command token", () => {
  assert(shouldSlashMenuOpen("/", 3), "menu should open on bare slash");
  assert(shouldSlashMenuOpen("/contr", 1), "menu should open on partial token");
  assert(shouldSlashMenuOpen("/contract-prepare", 1), "menu open on full token, no args");
  assert(shouldSlashMenuOpen("/contract-prepare ", 1), "trailing space alone is not args yet");
});

test("menu closes as soon as the first argument character is typed", () => {
  assert(slashInputHasArgs("/contract-prepare u"), "one arg char counts as args");
  assert(!shouldSlashMenuOpen("/contract-prepare u", 1), "menu must close with args");
  assert(
    !shouldSlashMenuOpen("/contract-prepare using the NDA template", 1),
    "menu must stay closed with full args",
  );
});

test("menu never opens for non-slash input or an empty candidate list", () => {
  assert(!shouldSlashMenuOpen("hello", 5), "non-slash input");
  assert(!shouldSlashMenuOpen("/zzz-no-match", 0), "no candidates");
});

console.log("enterAction \u2014 Enter picks only while the menu is open");

test("Enter picks the highlighted candidate while the menu is open", () => {
  assertEqual(
    enterAction({ slashOpen: true, hasHighlightedCandidate: true }),
    "pick",
    "menu open + candidate",
  );
});

test("Enter submits when the menu is closed or nothing is highlighted", () => {
  assertEqual(
    enterAction({ slashOpen: false, hasHighlightedCandidate: true }),
    "submit",
    "menu closed",
  );
  assertEqual(
    enterAction({ slashOpen: true, hasHighlightedCandidate: false }),
    "submit",
    "no highlighted candidate",
  );
});

console.log("full keyboard sequence \u2014 pick, type args, Enter submits unchanged");

test("pick \u2192 type args \u2192 Enter submits the prompt unchanged", () => {
  // 1. User types "/contr", menu is open, presses Enter → picks.
  let input = "/contr";
  let menuOpen = shouldSlashMenuOpen(input, 1);
  assert(menuOpen, "menu open while filtering");
  assertEqual(
    enterAction({ slashOpen: menuOpen, hasHighlightedCandidate: true }),
    "pick",
    "Enter picks while filtering",
  );

  // 2. Pick inserts the alias with a single slash + trailing space.
  input = slashInsertionText(cap(), "en");
  assertEqual(input, "/contract-prepare ", "single slash after pick");
  // The open-state effect re-runs on the new input: token complete, no args
  // yet — menu may reopen, but…
  menuOpen = shouldSlashMenuOpen(input, 1);

  // 3. …typing the first argument character closes it.
  input += "using the NDA template for Falcon";
  menuOpen = shouldSlashMenuOpen(input, 1);
  assert(!menuOpen, "menu closed once args typed");

  // 4. Enter now submits — the prompt reaches handleSubmit unchanged.
  assertEqual(
    enterAction({ slashOpen: menuOpen, hasHighlightedCandidate: true }),
    "submit",
    "Enter submits with args",
  );
  assertEqual(
    input,
    "/contract-prepare using the NDA template for Falcon",
    "prompt submitted unchanged",
  );
});

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
