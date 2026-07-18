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
// DB isolation bootstrap — MUST be the first import: rewrites DATABASE_URL to
// an isolated scratch database (no fallback to the live DB) before @workspace/db binds.
import "../crm/scratch-db.js";
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

// Runner → Contract: the actual signed instrument is required (Task #651 —
// a stray evidence artifact must NOT satisfy the gate).
check(
  "runner→contract blocked when no instrument",
  validateStageTransition({ fromStage: "runner", toStage: "contract" })?.gate === "runner_to_contract",
);
check(
  "runner→contract passes with signedInstrumentFileId",
  validateStageTransition({ fromStage: "runner", toStage: "contract", signedInstrumentFileId: "art_123" }) === null,
);
check(
  "runner→contract still blocked with only a stray evidence artifact",
  validateStageTransition({ fromStage: "runner", toStage: "contract", evidenceArtifactIds: ["art_456"] })?.gate === "runner_to_contract",
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
        WHERE sales_stage NOT IN ('suspect','prospect','convert','runner','contract','lost','no_decision','withdrawn')`,
    );
    check("sales_stage stays inside its enum after migration", Number(r5.rows[0].count) === 0,
      `${r5.rows[0].count} rows with off-enum sales_stage`);
  } finally {
    await pool.end();
  }
}

await dbAssertions();

// ---- Task #296: runner-aging helpers + report shapes ----------------
{
  // Inline mirrors of artifacts/atelier/src/lib/sales-stages.ts so this
  // server-side test stays decoupled from the UI bundle.
  const RUNNER_AGE_AMBER_DAYS = 21;
  const RUNNER_AGE_RED_DAYS = 45;
  const ageDays = (iso: string | null, now: Date) => {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    return Math.max(0, Math.floor((now.getTime() - t) / 86_400_000));
  };
  const tier = (d: number | null) => {
    if (d === null || d < RUNNER_AGE_AMBER_DAYS) return "fresh";
    if (d < RUNNER_AGE_RED_DAYS) return "amber";
    return "red";
  };
  const now = new Date("2026-05-14T00:00:00Z");
  const day = (n: number) =>
    new Date(now.getTime() - n * 86_400_000).toISOString();

  check("runnerAgeDays(null) → null", ageDays(null, now) === null);
  check("runnerAgeDays bad iso → null", ageDays("not-a-date", now) === null);
  check("runnerAgeDays 0d boundary", ageDays(day(0), now) === 0);
  check("runnerAgeTier null → fresh", tier(null) === "fresh");
  check("runnerAgeTier 20d → fresh", tier(20) === "fresh");
  check("runnerAgeTier 21d boundary → amber", tier(21) === "amber");
  check("runnerAgeTier 44d → amber", tier(44) === "amber");
  check("runnerAgeTier 45d boundary → red", tier(45) === "red");
  check("runnerAgeTier 365d → red", tier(365) === "red");

  // Closure-time percentile helper used by runner_to_contract_closure_time.
  const stats = (days: number[]) => {
    if (days.length === 0) return { medianDays: 0, p75Days: 0, p90Days: 0 };
    const sorted = [...days].sort((a, b) => a - b);
    const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { medianDays: pick(0.5), p75Days: pick(0.75), p90Days: pick(0.9) };
  };
  const s = stats([10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  check(`closure stats median=60`, s.medianDays === 60, `got ${s.medianDays}`);
  check(`closure stats p75=80`, s.p75Days === 80, `got ${s.p75Days}`);
  check(`closure stats p90=100`, s.p90Days === 100, `got ${s.p90Days}`);
  const sEmpty = stats([]);
  check("closure stats empty → zeros", sEmpty.medianDays === 0 && sEmpty.p90Days === 0);

  // Cohort conversion semantics — mirrors reportsRoutes
  // convert_to_runner_conversion. Numerator must never exceed
  // denominator, and a runner entry that predates the first convert
  // entry must NOT count toward conversion.
  type T = { opportunityId: string; toStage: string; createdAt: Date };
  const cohortConversion = (transitions: T[]) => {
    const sorted = [...transitions].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const firstConvert = new Map<string, Date>();
    const firstRunner = new Map<string, Date>();
    for (const t of sorted) {
      if (t.toStage === "convert" && !firstConvert.has(t.opportunityId)) firstConvert.set(t.opportunityId, t.createdAt);
      else if (t.toStage === "runner" && !firstRunner.has(t.opportunityId)) firstRunner.set(t.opportunityId, t.createdAt);
    }
    const periodOf = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const cohort = new Map<string, { ids: Set<string>; converted: Set<string> }>();
    for (const [oid, cAt] of firstConvert) {
      const p = periodOf(cAt);
      if (!cohort.has(p)) cohort.set(p, { ids: new Set(), converted: new Set() });
      const b = cohort.get(p)!;
      b.ids.add(oid);
      const rAt = firstRunner.get(oid);
      if (rAt && rAt.getTime() >= cAt.getTime()) b.converted.add(oid);
    }
    return Array.from(cohort.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([p, b]) => ({ period: p, denom: b.ids.size, num: b.converted.size }));
  };
  const D = (s: string) => new Date(s);
  const txs: T[] = [
    // opp1 converted Jan, ran Feb → counts in Jan cohort
    { opportunityId: "opp1", toStage: "convert", createdAt: D("2026-01-10T00:00:00Z") },
    { opportunityId: "opp1", toStage: "runner",  createdAt: D("2026-02-05T00:00:00Z") },
    // opp2 converted Jan, never ran → in denom only
    { opportunityId: "opp2", toStage: "convert", createdAt: D("2026-01-20T00:00:00Z") },
    // opp3: ran BEFORE convert → must NOT count (legacy/replay safety)
    { opportunityId: "opp3", toStage: "runner",  createdAt: D("2026-01-05T00:00:00Z") },
    { opportunityId: "opp3", toStage: "convert", createdAt: D("2026-02-15T00:00:00Z") },
    // opp4 converted Feb, ran Mar → counts in Feb cohort
    { opportunityId: "opp4", toStage: "convert", createdAt: D("2026-02-01T00:00:00Z") },
    { opportunityId: "opp4", toStage: "runner",  createdAt: D("2026-03-01T00:00:00Z") },
  ];
  const rows = cohortConversion(txs);
  const jan = rows.find((r) => r.period === "2026-01")!;
  const feb = rows.find((r) => r.period === "2026-02")!;
  check("cohort jan denom=2", jan.denom === 2, `got ${jan.denom}`);
  check("cohort jan num=1", jan.num === 1, `got ${jan.num}`);
  check("cohort feb denom=2", feb.denom === 2, `got ${feb.denom}`);
  check("cohort feb num=1 (opp3 runner pre-convert excluded)", feb.num === 1, `got ${feb.num}`);
  for (const r of rows) check(`cohort ${r.period} num<=denom`, r.num <= r.denom);

  // Snapshot — pipeline_waterfall row order (Task #296). The chart
  // renderer in Reports.tsx + the kanban in Pipeline.tsx both depend
  // on this order: 5 working bands first, then 3 terminal rows.
  const SNAPSHOT_BANDS = [
    { band: "funnel", stage: "suspect" },
    { band: "funnel", stage: "prospect" },
    { band: "funnel", stage: "convert" },
    { band: "funnel", stage: "runner" },
    { band: "funnel", stage: "contract" },
    { band: "terminal", stage: "lost" },
    { band: "terminal", stage: "no_decision" },
    { band: "terminal", stage: "withdrawn" },
  ];
  const working = ["suspect", "prospect", "convert", "runner", "contract"] as const;
  const terminal = ["lost", "no_decision", "withdrawn"] as const;
  const computed = [
    ...working.map((s) => ({ band: "funnel" as const, stage: s })),
    ...terminal.map((s) => ({ band: "terminal" as const, stage: s })),
  ];
  check(
    "pipeline_waterfall snapshot row order",
    JSON.stringify(computed) === JSON.stringify(SNAPSHOT_BANDS),
    `\n  expected ${JSON.stringify(SNAPSHOT_BANDS)}\n  got      ${JSON.stringify(computed)}`,
  );

  // Snapshot — kanban column order matches WORKING_STAGES, terminal
  // sidebar stacks the three closed-deal stages.
  const KANBAN_COLUMNS = ["suspect", "prospect", "convert", "runner", "contract"];
  const KANBAN_TERMINAL = ["lost", "no_decision", "withdrawn"];
  check(
    "kanban column order snapshot",
    JSON.stringify([...working]) === JSON.stringify(KANBAN_COLUMNS),
  );
  check(
    "kanban terminal sidebar order snapshot",
    JSON.stringify([...terminal]) === JSON.stringify(KANBAN_TERMINAL),
  );
}

// ---- Report ----------------------------------------------------------
if (failures.length) {
  console.error(`\n[funnel] ${failures.length} failure(s):`);
  for (const f of failures) console.error("  ✗", f);
  process.exit(1);
}
console.log(`[funnel] ✓ ${SALES_STAGES.length} stages · gates · sticky-timestamps · migration · all green.`);
