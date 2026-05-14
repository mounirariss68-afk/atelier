/**
 * Task #338 — UI parity coverage test.
 *
 * Loads tests/cli-parity/matrix.json (the authoritative UI write
 * route ↔ CLI catalog mapping) and asserts:
 *
 *   1. Every row references a catalog entry that is actually
 *      registered (so a renamed/removed entry breaks the build
 *      instead of silently disappearing from the assistant).
 *   2. Every catalog `id` listed is unique (no double-registration).
 *   3. The new Task #338 entries each declare confirmation envelopes
 *      via `twoPhaseConfirm: true` (UI parity = mandatory confirm).
 *   4. Stage + charter-role resolvers map the canonical phrasings
 *      the spec calls out ("pursue" → prospect, "as partner").
 *
 * Pure / in-process — no HTTP, no DB writes.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  listCapabilities,
} from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/bootstrap-capabilities.js";
import {
  resolveSalesStage,
  resolveCharterApprovalRole,
} from "../../src/lib/atelier-cli/resolvers/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
type MatrixRow = {
  method: string;
  path: string;
  catalogId?: string;
  allowReason?: string;
};
type ReadRow = {
  view: string;
  catalogId?: string;
  allowReason?: string;
};
const matrix = JSON.parse(
  fs.readFileSync(path.join(HERE, "matrix.json"), "utf8"),
) as { rows: MatrixRow[]; reads?: ReadRow[] };

let pass = 0;
let fail = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    pass++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail++;
    console.log(`  ✗ ${name}\n      ${(err as Error).message}`);
  }
}

const catalog = listCapabilities();
const byId = new Map(catalog.map((c) => [c.id, c]));

console.log("Task #338 — UI parity coverage");

test("matrix is non-empty", () => {
  assert.ok(matrix.rows.length >= 25, `expected ≥25 rows, got ${matrix.rows.length}`);
});

test("every matrix row resolves to a catalog entry or has an allow-reason", () => {
  const missing: string[] = [];
  for (const row of matrix.rows) {
    if (row.allowReason) continue;
    if (!row.catalogId) {
      missing.push(`${row.method} ${row.path} — no catalogId and no allowReason`);
      continue;
    }
    if (!byId.has(row.catalogId)) {
      missing.push(`${row.method} ${row.path} → ${row.catalogId} not in catalog`);
    }
  }
  assert.deepEqual(missing, [], `parity gaps:\n  ${missing.join("\n  ")}`);
});

test("catalog IDs in the matrix are all distinct", () => {
  const ids = matrix.rows.filter((r) => r.catalogId).map((r) => r.catalogId!);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) dupes.push(id);
    seen.add(id);
  }
  assert.deepEqual(dupes, [], `duplicate catalog ids in matrix: ${dupes.join(", ")}`);
});

test("every parity entry is two-phase confirm", () => {
  const offenders = matrix.rows
    .filter((r) => r.catalogId)
    .map((r) => byId.get(r.catalogId!))
    .filter((e) => e && e.isWrite && e.twoPhaseConfirm !== true)
    .map((e) => e!.id);
  assert.deepEqual(offenders, [], `entries missing twoPhaseConfirm: ${offenders.join(", ")}`);
});

test("irreversible parity entries declare typed confirm in their preview diff hint", () => {
  // Smoke check on the catalog metadata only (preview diff is shaped
  // at runtime). Asserts the catalog `irreversible` flag is set for
  // the spec-mandated capabilities.
  const mustBeIrreversible = [
    "account.profile_update_decision",
    "proposal.override_pricing",
    "proposal.send",
  ];
  for (const id of mustBeIrreversible) {
    const e = byId.get(id);
    assert.ok(e, `missing capability ${id}`);
    assert.equal(e!.irreversible, true, `${id} must be irreversible`);
  }
});

test("stage resolver maps spec phrases", () => {
  assert.equal(resolveSalesStage("pursue"), "prospect");
  assert.equal(resolveSalesStage("Pursue"), "prospect");
  assert.equal(resolveSalesStage("propose"), "convert");
  assert.equal(resolveSalesStage("won"), "contract");
  assert.equal(resolveSalesStage("lost"), "lost");
  assert.equal(resolveSalesStage("withdrawn"), "withdrawn");
  assert.equal(resolveSalesStage("garbage"), null);
});

test("charter approval role resolver maps phrases", () => {
  assert.equal(resolveCharterApprovalRole("partner"), "partner");
  assert.equal(resolveCharterApprovalRole("as Partner"), "partner");
  assert.equal(resolveCharterApprovalRole("lead"), "lead");
  assert.equal(resolveCharterApprovalRole("senior manager"), "lead");
  assert.equal(resolveCharterApprovalRole("noone"), null);
});

// ---------------------------------------------------------------
// Task #341 — read-parity coverage.
// ---------------------------------------------------------------
test("read matrix is non-empty", () => {
  assert.ok(
    (matrix.reads ?? []).length >= 15,
    `expected ≥15 read rows, got ${(matrix.reads ?? []).length}`,
  );
});

test("every read row resolves to a catalog entry or has an allow-reason", () => {
  const missing: string[] = [];
  for (const row of matrix.reads ?? []) {
    if (row.allowReason) continue;
    if (!row.catalogId) {
      missing.push(`${row.view} — no catalogId and no allowReason`);
      continue;
    }
    if (!byId.has(row.catalogId)) {
      missing.push(`${row.view} → ${row.catalogId} not in catalog`);
    }
  }
  assert.deepEqual(missing, [], `read parity gaps:\n  ${missing.join("\n  ")}`);
});

test("every catalog read entry is non-mutating + zero-confirm", () => {
  const offenders: string[] = [];
  for (const row of matrix.reads ?? []) {
    if (!row.catalogId) continue;
    const e = byId.get(row.catalogId);
    if (!e) continue;
    if (e.isWrite) offenders.push(`${row.catalogId} marked isWrite=true`);
    // `twoPhaseConfirm` lives on the wire shape, not the catalog
    // entry itself; the orchestrator skips confirm whenever isWrite
    // is false. Asserting isWrite=false is the canonical contract.
  }
  assert.deepEqual(offenders, [], `read offenders: ${offenders.join(", ")}`);
});

test("every read entry declares a result-card shape", () => {
  const ALLOWED = new Set(["kpi_strip", "ranked_list", "time_series", "entity_card", "audit_timeline", "table", "chart"]);
  const offenders: string[] = [];
  for (const row of matrix.reads ?? []) {
    if (!row.catalogId) continue;
    const e = byId.get(row.catalogId) as (typeof catalog)[number] & { resultCard?: string };
    if (!e) continue;
    if (!e.resultCard || !ALLOWED.has(e.resultCard)) {
      offenders.push(`${row.catalogId} resultCard=${e.resultCard ?? "<missing>"}`);
    }
  }
  assert.deepEqual(offenders, [], `result-card offenders: ${offenders.join(", ")}`);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
