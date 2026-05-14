/**
 * pnpm --filter @workspace/api-server run test:funnel
 *
 * Task #295 unit + integration tests for the canonical 5-stage funnel.
 *
 * Sections:
 *   1. Stage enum + PRD defaults (5/20/50/80/100/0/0/0)
 *   2. Terminal coverage + reason-code taxonomy
 *   3. migrateLegacyStage — full legacy table + canonical no-op
 *   4. isValidSubStatus
 *   5. validateStageTransition — every gate, happy + sad path
 *   6. computeStickyStageTimestamps — Charter auto-fire idempotency
 *   7. Live-DB migration assertions — runs only when DATABASE_URL is set
 */
import {
  SALES_STAGES,
  SALES_TO_PLM,
  SALES_STAGE_DEFAULT_PROB,
  SUB_STATUS_BY_STAGE,
  TERMINAL_REASON_CODES,
  TERMINAL_STAGES,
  computeStickyStageTimestamps,
  isTerminalStage,
  isValidSubStatus,
  migrateLegacyStage,
  validateStageTransition,
  type SalesStage,
} from "../../src/lib/atelier-agents/pipeline.js";

const failures: string[] = [];
function check(name: string, cond: unknown, detail?: string) {
  if (!cond) failures.push(`${name}${detail ? " — " + detail : ""}`);
}

// ---- 1. Stage enum + PRD defaults ------------------------------------
check("SALES_STAGES has 5 working + 3 terminal", SALES_STAGES.length === 8);
const expectedDefaults: Record<SalesStage, number> = {
  suspect: 5, prospect: 20, convert: 50, runner: 80, contract: 100,
  lost: 0, no_decision: 0, withdrawn: 0,
};
for (const s of SALES_STAGES) {
  check(`default prob for ${s}`, SALES_STAGE_DEFAULT_PROB[s] === expectedDefaults[s]);
  check(`SALES_TO_PLM defined for ${s}`, typeof SALES_TO_PLM[s] === "string");
  check(`SUB_STATUS_BY_STAGE defined for ${s}`, Array.isArray(SUB_STATUS_BY_STAGE[s]));
}

// ---- 2. Terminal coverage --------------------------------------------
for (const t of ["lost", "no_decision", "withdrawn"] as const) {
  check(`${t} marked terminal`, isTerminalStage(t));
  check(`${t} listed in TERMINAL_STAGES`, (TERMINAL_STAGES as readonly string[]).includes(t));
  check(`TERMINAL_REASON_CODES.${t} non-empty`, TERMINAL_REASON_CODES[t].length > 0);
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
  check(`migrateLegacyStage(${legacy}) → ${expected}`, got?.stage === expected, `got ${got?.stage}`);
}
for (const s of SALES_STAGES) {
  check(`migrateLegacyStage(${s}) is no-op`, migrateLegacyStage(s) === null);
}

// ---- 4. isValidSubStatus ---------------------------------------------
check("accepts known sub-status", isValidSubStatus("convert", "pov_in_flight"));
check("rejects bogus sub-status", !isValidSubStatus("convert", "totally-made-up"));
check("accepts null/empty", isValidSubStatus("convert", null) && isValidSubStatus("convert", ""));

// ---- 5. validateStageTransition --------------------------------------
// Suspect → Prospect: 5C + Go decision required.
check(
  "suspect→prospect blocked when 5C empty",
  validateStageTransition({ fromStage: "suspect", toStage: "prospect" })?.gate === "suspect_to_prospect_5c",
);
check(
  "suspect→prospect passes with 5C + Go",
  validateStageTransition({
    fromStage: "suspect", toStage: "prospect",
    qualify5c: { client: "a", competition: "b", capability: "c", capacity: "d", contract: "e" },
    goNoGoDecision: { decision: "go" },
  }) === null,
);
check(
  "suspect→prospect blocked when no_go decision",
  validateStageTransition({
    fromStage: "suspect", toStage: "prospect",
    qualify5c: { client: "a", competition: "b", capability: "c", capacity: "d", contract: "e" },
    goNoGoDecision: { decision: "no_go" },
  })?.gate === "suspect_to_prospect_5c",
);

// Convert → Runner: decider + VCD + sigPath required.
const convertToRunner = (extra: Partial<Parameters<typeof validateStageTransition>[0]>) =>
  validateStageTransition({ fromStage: "convert", toStage: "runner", ...extra });
check("convert→runner blocked when missing all", convertToRunner({})?.missing?.length === 3);
check(
  "convert→runner blocked when missing sigPath only",
  JSON.stringify(convertToRunner({ decider: "CFO", verbalCommitDate: "2026-05-01" })?.missing) ===
    JSON.stringify(["signaturePath"]),
);
check(
  "convert→runner passes with all three",
  convertToRunner({ decider: "CFO", verbalCommitDate: "2026-05-01", signaturePath: "Procurement → CFO" }) === null,
);

// Runner → Contract: signed instrument or evidence required.
check(
  "runner→contract blocked when no instrument",
  validateStageTransition({ fromStage: "runner", toStage: "contract" })?.gate === "runner_to_contract",
);
check(
  "runner→contract passes with signedInstrumentFileId",
  validateStageTransition({ fromStage: "runner", toStage: "contract", signedInstrumentFileId: "art_123" }) === null,
);
check(
  "runner→contract passes with evidenceArtifactIds",
  validateStageTransition({ fromStage: "runner", toStage: "contract", evidenceArtifactIds: ["art_456"] }) === null,
);

// Terminal entry: reasonCode required.
check(
  "lost requires reasonCode",
  validateStageTransition({ fromStage: "convert", toStage: "lost" })?.gate === "terminal_lost",
);
check(
  "lost rejects invalid reasonCode",
  validateStageTransition({ fromStage: "convert", toStage: "lost", reasonCode: "bogus" })?.gate === "terminal_lost",
);
check(
  "lost passes with valid reasonCode",
  validateStageTransition({ fromStage: "convert", toStage: "lost", reasonCode: "competitor" }) === null,
);
check(
  "no_decision passes with valid reasonCode",
  validateStageTransition({ fromStage: "convert", toStage: "no_decision", reasonCode: "stalled" }) === null,
);
check(
  "withdrawn passes with valid reasonCode",
  validateStageTransition({ fromStage: "runner", toStage: "withdrawn", reasonCode: "client_request" }) === null,
);

// Partner override skips gates.
check(
  "partner override bypasses missing 5C",
  validateStageTransition({ fromStage: "suspect", toStage: "prospect", partnerOverride: true }) === null,
);
check(
  "partner override bypasses missing terminal reason",
  validateStageTransition({ fromStage: "convert", toStage: "lost", partnerOverride: true }) === null,
);
// …but never the sub-status taxonomy.
check(
  "partner override does NOT bypass invalid sub-status",
  validateStageTransition({
    fromStage: "convert", toStage: "runner", partnerOverride: true,
    decider: "CFO", verbalCommitDate: "2026-05-01", signaturePath: "x",
    subStatus: "garbage",
  })?.gate === "invalid_sub_status",
);

// ---- 6. Sticky timestamps + Charter auto-fire idempotency ------------
const t0 = new Date("2026-05-01T10:00:00Z");
const t1 = new Date("2026-05-02T10:00:00Z");

const enterRunner = computeStickyStageTimestamps({
  toStage: "runner", now: t0, prior: { runnerEnteredAt: null, contractSignedAt: null },
});
check("first runner entry sets runnerEnteredAt", enterRunner.runnerEnteredAt === t0);
check("first runner entry leaves contract null", enterRunner.contractSignedAt === null);
check("first runner entry does not fire charter", enterRunner.charterShouldFire === false);

const enterContract = computeStickyStageTimestamps({
  toStage: "contract", now: t1, prior: { runnerEnteredAt: t0, contractSignedAt: null },
});
check("first contract entry sets contractSignedAt", enterContract.contractSignedAt === t1);
check("first contract entry preserves runnerEnteredAt", enterContract.runnerEnteredAt === t0);
check("first contract entry FIRES charter", enterContract.charterShouldFire === true);

const bounceContract = computeStickyStageTimestamps({
  toStage: "contract", now: new Date("2026-06-01T10:00:00Z"),
  prior: { runnerEnteredAt: t0, contractSignedAt: t1 },
});
check("contract→…→contract preserves original contractSignedAt", bounceContract.contractSignedAt === t1);
check("contract→…→contract does NOT re-fire charter", bounceContract.charterShouldFire === false);

const bounceRunner = computeStickyStageTimestamps({
  toStage: "runner", now: new Date("2026-06-02T10:00:00Z"),
  prior: { runnerEnteredAt: t0, contractSignedAt: null },
});
check("runner→…→runner preserves original runnerEnteredAt", bounceRunner.runnerEnteredAt === t0);

// ---- 7. Live-DB migration assertions (optional) ----------------------
async function dbAssertions() {
  if (!process.env.DATABASE_URL) {
    console.log("[funnel] skipping DB migration assertions (no DATABASE_URL)");
    return;
  }
  const { pool } = await import("@workspace/db");
  const client = pool;
  try {
    const r1 = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_opportunities
        WHERE sales_stage NOT IN ('suspect','prospect','convert','runner','contract','lost','no_decision','withdrawn')`,
    );
    check("no opps with legacy sales_stage post-migration", Number(r1.rows[0].count) === 0,
      `${r1.rows[0].count} legacy rows found`);

    const r2 = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_opportunity_stage_transitions
        WHERE to_stage NOT IN ('suspect','prospect','convert','runner','contract','lost','no_decision','withdrawn')`,
    );
    check("no transitions with legacy to_stage post-migration", Number(r2.rows[0].count) === 0,
      `${r2.rows[0].count} legacy transition rows found`);

    const r3 = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_audit_events
        WHERE action = 'opportunity.funnel_migrated_5stage'`,
    );
    check("per-opp funnel-migration audit row emitted", Number(r3.rows[0].count) > 0,
      "no audit rows emitted by 0027 migration");

    const r4 = await client.query<{ data_type: string; column_name: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_name='atelier_opportunities'
          AND column_name IN ('runner_entered_at','contract_signed_at')`,
    );
    for (const row of r4.rows) {
      check(`${row.column_name} is timestamptz`, row.data_type === "timestamp with time zone",
        `got ${row.data_type}`);
    }

    const r5 = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM atelier_opportunities
        WHERE plm_stage NOT IN ('identify','shape','pursue','mobilize','deliver','compound','won','lost','no_go','closed')`,
    );
    check("plm_stage stays inside its enum after migration", Number(r5.rows[0].count) === 0,
      `${r5.rows[0].count} rows with off-enum plm_stage`);
  } finally {
    await pool.end();
  }
}

await dbAssertions();

// ---- Report ----------------------------------------------------------
if (failures.length) {
  console.error(`\n[funnel] ${failures.length} failure(s):`);
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
console.log(`[funnel] ✓ ${SALES_STAGES.length} stages · gates · sticky-timestamps · migration · all green.`);
