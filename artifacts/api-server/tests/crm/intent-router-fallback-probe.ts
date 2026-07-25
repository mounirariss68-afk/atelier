/**
 * Task #681 — intent-router resilience probe (offline, deterministic).
 *
 * Pins:
 *  1. `deterministicOnly` skips the live model entirely (clarification
 *     continuations must never wait on / fail with the classifier).
 *  2. A dead live endpoint degrades to the deterministic keyword
 *     classifier after 2 attempts instead of throwing (turns must not
 *     die with "live classifier call failed — Request was aborted").
 */
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "http://127.0.0.1:59999/nope";
process.env.ATELIER_CLI_CLASSIFIER_TIMEOUT_MS = "300";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${ok ? "" : ` — ${detail}`}`);
  if (!ok) failures++;
}

async function main() {
  const { classifyIntentTyped } = await import(
    "../../src/lib/atelier-cli/intent-router.js"
  );

  const t0 = Date.now();
  const a = await classifyIntentTyped("Global headquarters", "global", {
    deterministicOnly: true,
  });
  const aMs = Date.now() - t0;
  check(
    "deterministicOnly skips live model (fast, tagged)",
    a.model.includes("deterministic-only") && aMs < 500,
    JSON.stringify({ model: a.model, aMs }),
  );

  const b = await classifyIntentTyped("create account Turksat in Turkey", "global");
  check(
    "dead endpoint degrades to deterministic fallback (no throw)",
    b.model.includes("deterministic-fallback"),
    JSON.stringify(b),
  );
  check(
    "fallback classification still routes create/account",
    b.verb === "create" && b.kind === "account" && b.confidence === 0.4,
    JSON.stringify({ verb: b.verb, kind: b.kind, confidence: b.confidence }),
  );

  if (failures > 0) {
    console.error(`${failures} CHECK(S) FAILED`);
    process.exit(1);
  }
  console.log("ALL CHECKS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
