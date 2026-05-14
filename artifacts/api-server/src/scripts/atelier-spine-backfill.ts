/**
 * Atelier — Task #297 step 3: idempotent 8→15 spine backfill.
 *
 * Maps the legacy 8-section proposal taxonomy onto the canonical
 * 15-section spine. For every proposal that already has any legacy
 * section row, we insert the *missing* spine sections (cover,
 * exec_summary, hypothesis, company_profile, value_case, annexes,
 * appendices) as empty drafts owned by the spine's default ownerAgent.
 *
 * Idempotent: re-runs are no-ops because the (proposal_id, section_id)
 * uniqueness is enforced via lookup before insert.
 *
 * Usage:
 *   pnpm --filter @workspace/api-server exec tsx \
 *     ./src/scripts/atelier-spine-backfill.ts
 *
 * Or programmatically: `import { backfillProposalSpine } from "..."` and
 * call it inside a test or a maintenance route.
 */
import { eq, and, isNull } from "drizzle-orm";
import { db, atelierProposalSections } from "@workspace/db";
import {
  PROPOSAL_SPINE,
  SPINE_ADDED_SECTIONS,
} from "../lib/atelier-proposal-html.js";

export interface BackfillReport {
  proposalsScanned: number;
  proposalsTouched: number;
  rowsInserted: number;
  alreadyMigrated: number;
}

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function backfillProposalSpine(opts: { proposalId?: string } = {}): Promise<BackfillReport> {
  const where = opts.proposalId
    ? and(eq(atelierProposalSections.proposalId, opts.proposalId), isNull(atelierProposalSections.deletedAt))
    : isNull(atelierProposalSections.deletedAt);

  const allSections = await db
    .select({
      id: atelierProposalSections.id,
      proposalId: atelierProposalSections.proposalId,
      sectionId: atelierProposalSections.sectionId,
    })
    .from(atelierProposalSections)
    .where(where);

  const byProposal = new Map<string, Set<string>>();
  for (const row of allSections) {
    let s = byProposal.get(row.proposalId);
    if (!s) { s = new Set(); byProposal.set(row.proposalId, s); }
    s.add(row.sectionId);
  }

  const spineByName = new Map(PROPOSAL_SPINE.map((s) => [s.id, s]));
  const report: BackfillReport = {
    proposalsScanned: byProposal.size,
    proposalsTouched: 0,
    rowsInserted: 0,
    alreadyMigrated: 0,
  };

  for (const [proposalId, present] of byProposal) {
    const missing = SPINE_ADDED_SECTIONS.filter((id) => !present.has(id));
    if (missing.length === 0) {
      report.alreadyMigrated += 1;
      continue;
    }
    report.proposalsTouched += 1;
    for (const sectionId of missing) {
      const spec = spineByName.get(sectionId);
      if (!spec) continue;
      await db.insert(atelierProposalSections).values({
        id: rid("psec"),
        proposalId,
        sectionId,
        name: spec.name,
        ownerAgent: spec.ownerAgent,
        status: "draft",
        content: "",
      });
      report.rowsInserted += 1;
    }
  }

  return report;
}

// Allow the script to run standalone via tsx.
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  backfillProposalSpine()
    .then((r) => {
      console.log(JSON.stringify({ ok: true, ...r }, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error("backfill failed:", err);
      process.exit(1);
    });
}
