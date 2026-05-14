/* eslint-disable no-console */
/**
 * Task #292 — Persona enum full replacement (idempotent migration).
 *
 * Maps any pre-existing rows in `atelier_users` from the legacy 8-persona
 * model onto the canonical 9-persona model and stamps the original value
 * into `legacy_role` (kept for one release as an audit shadow).
 *
 *   partner               → partner   (founding partners get hand-promoted
 *                                      via the seed; this script preserves
 *                                      them when already promoted)
 *   engagement_lead       → senior_manager
 *   sme                   → consultant
 *   ai_engineer           → consultant
 *   business_developer    → consultant   (bd_active=true)
 *   operations            → finance      (DEFAULT — see note below)
 *   contractor            → contractor
 *   partner_firm_resource → partner_firm_resource
 *
 * `operations` is a per-row decision (finance vs hr) that must be made by
 * a human operator. This script picks `finance` as the safer default
 * (broader downstream privileges than hr) and logs every operations row so
 * the firm can re-classify them through the Admin → Persona Migration
 * surface (see follow-up task). Re-running this script is safe: it only
 * touches rows whose role is still in the legacy set OR whose legacy_role
 * column is null.
 *
 * Run with:
 *   pnpm tsx scripts/src/migrate-persona-enum.ts
 */

import { db, pool, atelierUsers } from "@workspace/db";
import { sql, eq, isNull, inArray, or } from "drizzle-orm";

const LEGACY_TO_NEW: Record<string, { role: string; bdActive: boolean }> = {
  engagement_lead: { role: "senior_manager", bdActive: true },
  sme: { role: "consultant", bdActive: false },
  ai_engineer: { role: "consultant", bdActive: false },
  business_developer: { role: "consultant", bdActive: true },
  operations: { role: "finance", bdActive: false },
  // No-op mappings (kept here so the script self-documents the full matrix).
  partner: { role: "partner", bdActive: true },
  contractor: { role: "contractor", bdActive: false },
  partner_firm_resource: { role: "partner_firm_resource", bdActive: false },
};

const LEGACY_ROLES = Object.keys(LEGACY_TO_NEW);

async function migrate(): Promise<void> {
  console.log("[persona-migration] starting");

  // Stamp legacy_role on any row that doesn't have it yet (one-time).
  const stampedRes = await db.execute(sql`
    UPDATE atelier_users
       SET legacy_role = role
     WHERE legacy_role IS NULL
       AND role = ANY(${sql.raw(`ARRAY[${LEGACY_ROLES.map((r) => `'${r}'`).join(",")}]`)})
  `);
  console.log(`[persona-migration] stamped legacy_role on ${stampedRes.rowCount ?? 0} rows`);

  const rows = await db
    .select({ id: atelierUsers.id, role: atelierUsers.role, name: atelierUsers.name })
    .from(atelierUsers)
    .where(inArray(atelierUsers.role, LEGACY_ROLES));

  if (rows.length === 0) {
    console.log("[persona-migration] no legacy rows to migrate — done.");
    return;
  }

  let migrated = 0;
  const opsRows: Array<{ id: string; name: string }> = [];
  for (const r of rows) {
    const target = LEGACY_TO_NEW[r.role];
    if (!target) continue;
    if (r.role === "operations") opsRows.push({ id: r.id, name: r.name });
    if (target.role === r.role) continue; // identity map, skip update
    await db
      .update(atelierUsers)
      .set({ role: target.role, bdActive: target.bdActive, updatedAt: new Date() })
      .where(eq(atelierUsers.id, r.id));
    migrated++;
    console.log(
      `[persona-migration] ${r.id} (${r.name}): ${r.role} → ${target.role}` +
        (target.bdActive ? " (bd_active=true)" : ""),
    );
  }
  console.log(`[persona-migration] migrated ${migrated} rows.`);
  if (opsRows.length > 0) {
    console.warn(
      `[persona-migration] ${opsRows.length} 'operations' row(s) defaulted to 'finance'. ` +
        `Reclassify any HR personas via Admin → Persona Migration. Affected:`,
    );
    for (const r of opsRows) console.warn(`  - ${r.id}: ${r.name}`);
  }
}

migrate()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error("[persona-migration] FAILED", err);
    await pool.end();
    process.exit(1);
  });
