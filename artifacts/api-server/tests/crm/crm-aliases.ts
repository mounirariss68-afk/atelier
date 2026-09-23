import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pg from "pg";
import { mergeAccounts } from "../../src/lib/atelier-merge.js";
import {
  retireCrmAlias,
  targetExists,
} from "../../src/routes/atelier/crmAliasRoutes.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const pool = new pg.Pool({ connectionString: url });
const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const org = `org_crm_alias_${suffix}`;
const account = `acct_crm_alias_${suffix}`;
const person = `person_crm_alias_${suffix}`;
const survivor = `acct_crm_alias_survivor_${suffix}`;
const duplicate = `acct_crm_alias_duplicate_${suffix}`;
const retireRaceAlias = `alias_retire_race_${suffix}`;
const retireFailureAlias = `alias_retire_failure_${suffix}`;
try {
  const migration = await readFile(resolve(process.cwd(), "../../lib/db/drizzle/0097_crm_aliases.sql"), "utf8");
  await pool.query(migration);
  await pool.query(migration);
  await pool.query(
    `INSERT INTO atelier_accounts (id, org_id, name, country, sector)
     VALUES ($1, $2, 'Alias Account', 'AE', 'technology')`,
    [account, org],
  );
  await pool.query(
    `INSERT INTO atelier_persons (id, org_id, first_name, last_name, display_name)
     VALUES ($1, $2, 'Alias', 'Person', 'Alias Person')`,
    [person, org],
  );
  await pool.query(
    `INSERT INTO atelier_crm_aliases
       (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, 'account', $3, 'Acme', 'acme', 'probe')`,
    [`alias_account_${suffix}`, org, account],
  );
  await pool.query(
    `INSERT INTO atelier_crm_aliases
       (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, 'person', $3, 'Acme', 'acme', 'probe')`,
    [`alias_person_${suffix}`, org, person],
  );
  const ambiguous = await pool.query(
    `SELECT target_kind, target_id FROM atelier_crm_aliases
      WHERE org_id=$1 AND normalized_alias='acme' AND status='active'
      ORDER BY target_kind`,
    [org],
  );
  assert.equal(ambiguous.rowCount, 2);
  await assert.rejects(
    pool.query(
      `INSERT INTO atelier_crm_aliases
         (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
       VALUES ($1, $2, 'account', $3, 'ACME', 'acme', 'probe')`,
      [`alias_duplicate_${suffix}`, org, account],
    ),
    (error: unknown) => (error as { code?: string }).code === "23505",
  );
  await pool.query(
    `UPDATE atelier_crm_aliases SET status='retired', retired_at=now(), retired_by='probe'
      WHERE org_id=$1 AND target_kind='account' AND target_id=$2`,
    [org, account],
  );
  await pool.query(
    `INSERT INTO atelier_crm_aliases
       (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, 'account', $3, 'ACME', 'acme', 'probe')`,
    [`alias_reused_${suffix}`, org, account],
  );
  for (const [id, name] of [[survivor, "Survivor Account"], [duplicate, "Duplicate Account"]]) {
    await pool.query(
      `INSERT INTO atelier_accounts (id, org_id, name, country, sector)
       VALUES ($1, $2, $3, 'AE', 'technology')`,
      [id, org, name],
    );
  }
  await pool.query(
    `INSERT INTO atelier_crm_aliases
       (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, 'account', $3, 'Shared Name', 'shared name', 'probe'),
            ($4, $2, 'account', $5, 'Shared Name', 'shared name', 'probe'),
            ($6, $2, 'account', $5, 'Move Me', 'move me', 'probe')`,
    [`alias_survivor_shared_${suffix}`, org, survivor,
      `alias_duplicate_shared_${suffix}`, duplicate,
      `alias_duplicate_move_${suffix}`,],
  );
  const merged = await mergeAccounts(
    { id: "probe", name: "Probe", orgId: org },
    survivor,
    duplicate,
  );
  assert.equal(merged.status, "merged");
  assert.equal(merged.status === "merged" ? merged.counts.aliasesRetired : 0, 1);
  assert.equal(merged.status === "merged" ? merged.counts.aliasesMoved : 0, 1);
  const afterMerge = await pool.query(
    `SELECT target_id, normalized_alias, status FROM atelier_crm_aliases
      WHERE org_id=$1 AND target_kind='account' AND target_id IN ($2, $3)
      ORDER BY normalized_alias, target_id`,
    [org, survivor, duplicate],
  );
  assert.ok(afterMerge.rows.some((r) => r.target_id === survivor && r.normalized_alias === "move me" && r.status === "active"));
  assert.ok(afterMerge.rows.some((r) => r.target_id === duplicate && r.normalized_alias === "shared name" && r.status === "retired"));
  await pool.query("UPDATE atelier_accounts SET status='archived' WHERE id=$1", [survivor]);
  assert.equal(await targetExists(org, "account", survivor), false);

  // Retirement and its governance evidence are one atomic transition. Two
  // callers racing to retire the same alias both receive the final row, while
  // exactly one audit event is committed.
  await pool.query(
    `INSERT INTO atelier_crm_aliases
       (id, org_id, target_kind, target_id, alias, normalized_alias, created_by)
     VALUES ($1, $2, 'account', $3, 'Retire Race', 'retire race', 'probe'),
            ($4, $2, 'account', $3, 'Retire Failure', 'retire failure', 'probe')`,
    [retireRaceAlias, org, account, retireFailureAlias],
  );
  const retirementActor = { id: "probe", name: "Probe", orgId: org };
  const raced = await Promise.all([
    retireCrmAlias(retirementActor, retireRaceAlias),
    retireCrmAlias(retirementActor, retireRaceAlias),
  ]);
  assert.ok(raced.every((row) => row?.status === "retired"));
  const raceAudits = await pool.query(
    `SELECT count(*)::int AS count FROM atelier_audit_events
      WHERE org_id=$1 AND action='crm.alias.retire'
        AND payload->>'aliasId'=$2`,
    [org, retireRaceAlias],
  );
  assert.equal(raceAudits.rows[0]?.count, 1);

  // If governance evidence cannot be written, the alias transition rolls back.
  await assert.rejects(retireCrmAlias(
    retirementActor,
    retireFailureAlias,
    { beforeAudit: () => { throw new Error("injected-audit-failure"); } },
  ), /injected-audit-failure/);
  const failedRetirement = await pool.query(
    `SELECT status FROM atelier_crm_aliases WHERE id=$1`,
    [retireFailureAlias],
  );
  assert.equal(failedRetirement.rows[0]?.status, "active");
  const failureAudits = await pool.query(
    `SELECT count(*)::int AS count FROM atelier_audit_events
      WHERE org_id=$1 AND action='crm.alias.retire'
        AND payload->>'aliasId'=$2`,
    [org, retireFailureAlias],
  );
  assert.equal(failureAudits.rows[0]?.count, 0);
  console.log("CRM alias foundation contract passed");
} finally {
  await pool.query("DELETE FROM atelier_audit_events WHERE org_id=$1", [org]).catch(() => {});
  await pool.query("DELETE FROM atelier_crm_aliases WHERE org_id=$1", [org]).catch(() => {});
  await pool.query("DELETE FROM atelier_persons WHERE org_id=$1", [org]).catch(() => {});
  await pool.query("DELETE FROM atelier_accounts WHERE org_id=$1", [org]).catch(() => {});
  await pool.end();
}