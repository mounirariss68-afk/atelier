/**
 * Task #741 — offline probe for typed session facts, control-intent
 * normalization, timezone precedence, and the adaptive tool-budget
 * policy (run at 1x and 2x catalog size). Pure — no DB, no LLM.
 *
 * Run: pnpm --filter @workspace/api-server run test:chat-facts
 */
import {
  extractFactsFromToolEvent,
  normalizeControlIntent,
  renderFactsBlock,
  resolveFactsTimezone,
  factsMode,
} from "../../src/lib/atelier-cli/session-facts.js";
import { selectRankedAdaptive } from "../../src/lib/atelier-cli/capability-retriever.js";

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

// ---------------------------------------------------------------
console.log("[1] fact extraction from tool inputs (travel-shaped)");
{
  const facts = extractFactsFromToolEvent({
    tool: "travel_search_flights",
    input: {
      origin: "DXB",
      destination: "IST",
      departure_date: "2026-08-03",
      return_date: "2026-08-08",
      adults: 2,
      cursor: "abc123",
      account_id: "acc_x",
    },
  });
  const byKey = new Map(facts.map((f) => [f.key, f]));
  check("departure date captured as date fact",
    byKey.get("travel_search_flights.departure_date")?.kind === "date");
  check("return date captured", byKey.has("travel_search_flights.return_date"));
  check("origin/destination captured as place facts",
    byKey.get("travel_search_flights.origin")?.kind === "place" &&
    byKey.get("travel_search_flights.destination")?.kind === "place");
  check("adults captured as quantity",
    byKey.get("travel_search_flights.adults")?.kind === "quantity");
  check("cursor/id keys ignored",
    !facts.some((f) => f.key.endsWith(".cursor") || f.key.endsWith(".account_id")));
}

console.log("[2] selection + entity extraction from result data");
{
  const facts = extractFactsFromToolEvent({
    tool: "travel_select_flight",
    input: { offer_index: 2 },
    data: { selected: { id: "off_9", label: "EK 121 · DXB→IST · 03 Aug 09:40" } },
  });
  check("selection captured", facts.some((f) => f.kind === "selection"));
  const ent = extractFactsFromToolEvent({
    tool: "resolve_entity",
    input: { name: "Acme" },
    data: { entity: { kind: "account", id: "acc_1", label: "Acme Holdings" } },
  });
  check("resolved entity captured",
    ent.some((f) => f.kind === "entity" && f.display.includes("Acme Holdings")));
}

console.log("[3] render block caps + wording");
{
  const many = Array.from({ length: 60 }, (_, i) => ({
    kind: "date",
    display: `field_${i} = 2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
  }));
  const block = renderFactsBlock(many);
  check("block non-empty and capped ≤2000 chars", block.length > 0 && block.length <= 2000);
  check("block instructs reuse, not re-ask", /do not re-ask/i.test(block));
  check("empty facts → empty block", renderFactsBlock([]) === "");
}

console.log("[4] control-intent normalization (EN/TR/AR)");
{
  check("yes → affirm", normalizeControlIntent("Yes") === "affirm");
  check("go ahead → affirm", normalizeControlIntent("go ahead!") === "affirm");
  check("evet → affirm", normalizeControlIntent("evet") === "affirm");
  check("نعم → affirm", normalizeControlIntent("نعم") === "affirm");
  check("no thanks → decline", normalizeControlIntent("no thanks") === "decline");
  check("hayır → decline", normalizeControlIntent("hayır") === "decline");
  check("never mind → cancel", normalizeControlIntent("never mind") === "cancel");
  check("iptal → cancel", normalizeControlIntent("iptal") === "cancel");
  check("sentence is NOT swallowed",
    normalizeControlIntent("yes, but change the date to Friday") === null);
  check("ordinary answer is null", normalizeControlIntent("5 nights") === null);
  check("long text is null",
    normalizeControlIntent("okay so what I actually want is different") === null);
}

console.log("[5] timezone precedence: turn > session snapshot > org default");
{
  check("turn tz wins", resolveFactsTimezone("Europe/Istanbul", "Asia/Riyadh") === "Europe/Istanbul");
  check("snapshot when no turn tz", resolveFactsTimezone(null, "Asia/Riyadh") === "Asia/Riyadh");
  check("org default fallback", resolveFactsTimezone(null, null) === "Asia/Dubai");
  check("invalid tz skipped", resolveFactsTimezone("Not/AZone", "Asia/Riyadh") === "Asia/Riyadh");
}

console.log("[6] adaptive tool budget at 1x and 2x catalog size");
{
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ tool: `t${i}`, score: 0.9 - i * 0.05 }));
  // 1x: distinct scores → exactly base budget.
  const oneX = selectRankedAdaptive(mk(360), { baseBudget: 8, maxBudget: 16 });
  check("distinct scores stop at base budget", oneX.length === 8, oneX.length);
  // Near-tied cluster at the cutoff → extends past base, bounded by max.
  const tied = [
    ...Array.from({ length: 8 }, (_, i) => ({ tool: `a${i}`, score: 0.9 - i * 0.001 })),
    ...Array.from({ length: 12 }, (_, i) => ({ tool: `b${i}`, score: 0.892 - i * 0.001 })),
    ...Array.from({ length: 700 }, (_, i) => ({ tool: `c${i}`, score: 0.4 - i * 0.0001 })),
  ];
  const ext = selectRankedAdaptive(tied, { baseBudget: 8, maxBudget: 16 });
  check("near-tied cluster extends past base", ext.length > 8, ext.length);
  check("extension bounded by max budget", ext.length <= 16, ext.length);
  // 2x catalog: ordering stable, still bounded.
  const twoX = selectRankedAdaptive(mk(720), { baseBudget: 8, maxBudget: 16 });
  check("2x catalog: same deterministic head", twoX.join(",") === oneX.join(","));
  check("empty list → empty", selectRankedAdaptive([], { baseBudget: 8, maxBudget: 16 }).length === 0);
}

console.log("[7] rollout mode flag");
{
  const prev = process.env.ATELIER_CLI_FACTS_MODE;
  process.env.ATELIER_CLI_FACTS_MODE = "shadow";
  check("shadow honored", factsMode() === "shadow");
  process.env.ATELIER_CLI_FACTS_MODE = "off";
  check("off honored (kill switch)", factsMode() === "off");
  delete process.env.ATELIER_CLI_FACTS_MODE;
  check("default is on", factsMode() === "on");
  if (prev !== undefined) process.env.ATELIER_CLI_FACTS_MODE = prev;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
