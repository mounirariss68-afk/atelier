/**
 * pnpm test:funnel — Task #295 funnel taxonomy + migration unit tests.
 *
 * Pure-function tests for the new 5-stage canonical funnel + 3 terminals.
 * No DB, no HTTP. Asserts:
 *   - migrateLegacyStage covers every legacy 10-stage label.
 *   - SALES_TO_PLM / SALES_STAGE_DEFAULT_PROB cover every new stage.
 *   - SUB_STATUS_BY_STAGE / TERMINAL_REASON_CODES are consistent.
 *   - isValidSubStatus enforces the per-stage taxonomy.
 *   - Defaults match the PRD: 5 / 20 / 50 / 80 / 100.
 */
import {
  SALES_STAGES,
  SALES_TO_PLM,
  SALES_STAGE_DEFAULT_PROB,
  SUB_STATUS_BY_STAGE,
  TERMINAL_REASON_CODES,
  TERMINAL_STAGES,
  isTerminalStage,
  isValidSubStatus,
  migrateLegacyStage,
  type SalesStage,
} from "../../src/lib/atelier-agents/pipeline.js";

const failures: string[] = [];
function check(name: string, cond: unknown, detail?: string) {
  if (!cond) failures.push(`${name}${detail ? " — " + detail : ""}`);
}

// ---- 1. Stage enum + PRD defaults ------------------------------------
check(
  "SALES_STAGES has 5 working + 3 terminal stages",
  SALES_STAGES.length === 8,
  `got ${SALES_STAGES.length}`,
);
const expectedDefaults: Record<SalesStage, number> = {
  suspect: 5,
  prospect: 20,
  convert: 50,
  runner: 80,
  contract: 100,
  lost: 0,
  no_decision: 0,
  withdrawn: 0,
};
for (const s of SALES_STAGES) {
  check(
    `default prob for ${s}`,
    SALES_STAGE_DEFAULT_PROB[s] === expectedDefaults[s],
    `expected ${expectedDefaults[s]}, got ${SALES_STAGE_DEFAULT_PROB[s]}`,
  );
  check(`SALES_TO_PLM defined for ${s}`, typeof SALES_TO_PLM[s] === "string");
  check(
    `SUB_STATUS_BY_STAGE defined for ${s}`,
    Array.isArray(SUB_STATUS_BY_STAGE[s]),
  );
}

// ---- 2. Terminal coverage --------------------------------------------
for (const t of ["lost", "no_decision", "withdrawn"] as const) {
  check(`${t} marked terminal`, isTerminalStage(t));
  check(`${t} listed in TERMINAL_STAGES`, (TERMINAL_STAGES as readonly string[]).includes(t));
  check(
    `TERMINAL_REASON_CODES.${t} non-empty`,
    Array.isArray(TERMINAL_REASON_CODES[t]) && TERMINAL_REASON_CODES[t].length > 0,
  );
}
for (const s of ["suspect", "prospect", "convert", "runner", "contract"] as const) {
  check(`${s} not terminal`, !isTerminalStage(s));
}

// ---- 3. migrateLegacyStage -------------------------------------------
const legacyMap: Record<string, SalesStage> = {
  lead: "suspect",
  qualified: "prospect",
  discovery_scheduled: "prospect",
  pov_in_flight: "convert",
  proposal_in_flight: "convert",
  submitted: "convert",
  verbal_commit: "runner",
  signed: "contract",
  lost_no_decision: "no_decision",
};
for (const [legacy, expected] of Object.entries(legacyMap)) {
  const got = migrateLegacyStage(legacy);
  check(
    `migrateLegacyStage(${legacy}) → ${expected}`,
    got?.stage === expected,
    `got ${got?.stage}`,
  );
}
// Already-canonical labels must be a no-op (return null).
for (const s of SALES_STAGES) {
  check(
    `migrateLegacyStage(${s}) is no-op`,
    migrateLegacyStage(s) === null,
  );
}

// ---- 4. isValidSubStatus ---------------------------------------------
check(
  "isValidSubStatus accepts known sub-status",
  SUB_STATUS_BY_STAGE.convert.length === 0 ||
    isValidSubStatus("convert", SUB_STATUS_BY_STAGE.convert[0]),
);
check(
  "isValidSubStatus rejects bogus sub-status",
  !isValidSubStatus("convert", "totally-made-up"),
);
check(
  "isValidSubStatus accepts null/empty",
  isValidSubStatus("convert", null) && isValidSubStatus("convert", ""),
);

// ---- Report ----------------------------------------------------------
if (failures.length) {
  console.error(`\n[funnel] ${failures.length} failure(s):`);
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
console.log(`[funnel] ✓ ${SALES_STAGES.length} stages · ${Object.keys(legacyMap).length} legacy-mappings · taxonomy + defaults pass.`);
