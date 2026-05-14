/**
 * Task #297 — Idempotent 8→15 spine backfill test.
 *
 * Seeds an isolated proposal id with the legacy 8 sections only,
 * runs `backfillProposalSpine` twice, and asserts:
 *   1. First run inserts exactly 7 rows (the spine-added sections).
 *   2. Second run is a no-op (idempotent).
 *   3. The post-backfill state contains all 15 spine sections.
 *
 * Cleans up after itself so it can be run repeatedly against any DB.
 */
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { db, atelierProposalSections } from "@workspace/db";
import { backfillProposalSpine } from "../../src/scripts/atelier-spine-backfill.js";
import { PROPOSAL_SPINE, SPINE_ADDED_SECTIONS } from "../../src/lib/atelier-proposal-html.js";

const PROPOSAL_ID = `prp_backfill_test_${Date.now().toString(36)}`;
const LEGACY_8 = ["context", "approach", "workplan", "team", "pricing", "case_studies", "terms", "compliance"];

async function cleanup() {
  await db.delete(atelierProposalSections).where(eq(atelierProposalSections.proposalId, PROPOSAL_ID));
}

let exitCode = 0;
try {
  await cleanup();
  // Seed the 8 legacy sections.
  for (const sectionId of LEGACY_8) {
    await db.insert(atelierProposalSections).values({
      id: `psec_seed_${sectionId}_${Date.now().toString(36)}`,
      proposalId: PROPOSAL_ID,
      sectionId,
      name: sectionId,
      ownerAgent: "test",
      status: "draft",
      content: "",
    });
  }

  const first = await backfillProposalSpine({ proposalId: PROPOSAL_ID });
  assert.equal(first.proposalsScanned, 1, "exactly 1 proposal in scope");
  assert.equal(first.proposalsTouched, 1, "first run touches the proposal");
  assert.equal(first.rowsInserted, SPINE_ADDED_SECTIONS.length,
    `first run inserts the 7 spine-added sections (got ${first.rowsInserted})`);

  const after1 = await db
    .select({ sectionId: atelierProposalSections.sectionId })
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.proposalId, PROPOSAL_ID));
  const ids1 = new Set(after1.map((r) => r.sectionId));
  for (const spec of PROPOSAL_SPINE) {
    assert.ok(ids1.has(spec.id), `spine section ${spec.id} present after first backfill`);
  }
  assert.equal(after1.length, 15, "exactly 15 sections after backfill");

  // Second run is a no-op.
  const second = await backfillProposalSpine({ proposalId: PROPOSAL_ID });
  assert.equal(second.proposalsTouched, 0, "second run touches nothing (idempotent)");
  assert.equal(second.rowsInserted, 0, "second run inserts nothing");
  assert.equal(second.alreadyMigrated, 1, "second run reports the proposal as already migrated");

  const after2 = await db
    .select({ id: atelierProposalSections.id })
    .from(atelierProposalSections)
    .where(eq(atelierProposalSections.proposalId, PROPOSAL_ID));
  assert.equal(after2.length, 15, "row count unchanged after second backfill");

  console.log("ok — spine backfill is correct and idempotent");
} catch (err) {
  exitCode = 1;
  console.error("spine-backfill test FAILED:", err);
} finally {
  await cleanup();
  process.exit(exitCode);
}
