/**
 * ONE-OFF RESTORE UTILITY — Task: restore agent registry from the
 * 2026-07-17 prod backup after the 2026-07-16 data wipe.
 *
 * NOT a seeder. Never wire this into boot, tests, or workflows
 * (see memory: no-demo-seeding policy). Safe to re-run: idempotent
 * on agent id (skips rows that already exist).
 *
 * Restores ONLY the implemented agents named in the task spec:
 * 8 MVP + 5 registered. Other backup rows (stubs, and extra rows the
 * backup tagged "mvp" that are not in the implemented set) are skipped.
 *
 * Run: pnpm --filter @workspace/scripts exec tsx src/restore-agents-from-2026-07-17-backup.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inArray } from "drizzle-orm";
import { db, atelierAgents } from "@workspace/db";

const RESTORE_IDS = [
  // 8 MVP agents
  "ag_pursuit_scout",
  "ag_pov_author",
  "ag_proposal_composer",
  "ag_meeting_scribe",
  "ag_charter_architect",
  "ag_agent_architect",
  "ag_prototype_forge",
  "ag_synthesis_critic",
  // 5 registered agents
  "ag_triage",
  "ag_raid_watchdog",
  "ag_knowledge_concierge",
  "ag_atelier_curator",
  "ag_prompt_librarian",
];

type BackupRow = {
  id: string;
  org_id: string;
  name: string;
  group_name: string;
  stage: string;
  purpose: string;
  model: string;
  starred: boolean;
  status: string;
  tools: string[];
  guardrails: string[];
  human_checkpoints: string[];
  inputs: unknown[];
  outputs: unknown[];
  runs_last_30d: number;
  created_at: string;
  updated_at: string;
  created_by_user_id: string | null;
  deleted_at: string | null;
};

async function main() {
  const backupPath = fileURLToPath(
    new URL(
      "../../backups/prod-backup-2026-07-17/atelier_agents.json",
      import.meta.url,
    ),
  );
  const rows: BackupRow[] = JSON.parse(readFileSync(backupPath, "utf8"));

  const wanted = rows.filter((r) => RESTORE_IDS.includes(r.id));
  const missing = RESTORE_IDS.filter((id) => !wanted.some((r) => r.id === id));
  if (missing.length) {
    throw new Error(`Backup is missing expected agents: ${missing.join(", ")}`);
  }
  const badStatus = wanted.filter(
    (r) => r.status !== "mvp" && r.status !== "registered",
  );
  if (badStatus.length) {
    throw new Error(
      `Refusing to restore non-implemented statuses: ${badStatus.map((r) => `${r.id}=${r.status}`).join(", ")}`,
    );
  }

  const existing = await db
    .select({ id: atelierAgents.id })
    .from(atelierAgents)
    .where(inArray(atelierAgents.id, RESTORE_IDS));
  const existingIds = new Set(existing.map((r) => r.id));

  const toInsert = wanted.filter((r) => !existingIds.has(r.id));
  for (const r of toInsert) {
    await db.insert(atelierAgents).values({
      id: r.id,
      orgId: r.org_id,
      name: r.name,
      group: r.group_name,
      stage: r.stage,
      purpose: r.purpose,
      model: r.model,
      starred: r.starred,
      status: r.status,
      tools: r.tools,
      guardrails: r.guardrails,
      humanCheckpoints: r.human_checkpoints,
      inputs: r.inputs as never,
      outputs: r.outputs as never,
      runsLast30d: r.runs_last_30d,
      createdAt: new Date(r.created_at),
      updatedAt: new Date(r.updated_at),
      createdByUserId: r.created_by_user_id,
      deletedAt: r.deleted_at ? new Date(r.deleted_at) : null,
    });
  }

  console.log(
    `Restored ${toInsert.length} agent(s); skipped ${existingIds.size} already present.`,
  );
  for (const r of toInsert) console.log(`  + ${r.id} (${r.status})`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
