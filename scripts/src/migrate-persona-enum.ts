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
 *   engagement_lead       → senior_manager   (bd_active=true)
 *   sme                   → consultant       (bd_active=false)
 *   ai_engineer           → consultant       (bd_active=false)
 *   business_developer    → consultant       (bd_active=true)
 *   operations            → finance | hr     (per-row decision; see below)
 *   contractor            → contractor
 *   partner_firm_resource → partner_firm_resource
 *
 * Operations rows are a per-row split (finance vs hr). The script supports
 * three resolution modes:
 *
 *   1. Per-row map via env var ATELIER_OPS_RESOLUTION
 *      e.g. ATELIER_OPS_RESOLUTION="u_omar=hr,u_layla=finance"
 *      Any user listed gets that role; any not listed falls back to mode 2/3.
 *
 *   2. Manual-resolution gate (DEFAULT). If any 'operations' rows remain
 *      unresolved after mode 1, the script prints them and exits non-zero
 *      WITHOUT touching them. Re-run after setting ATELIER_OPS_RESOLUTION.
 *
 *   3. Default-allow override. Pass --default-finance (or set
 *      ATELIER_OPS_DEFAULT_FINANCE=1) to bypass the gate and default any
 *      remaining operations rows to 'finance'. Used by the seed/dev path
 *      where there are no real operations users to triage.
 *
 * Re-running this script is safe: it only touches rows whose role is still
 * in the legacy set OR whose legacy_role column is null.
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx ./src/migrate-persona-enum.ts
 *   ATELIER_OPS_RESOLUTION="u_alice=hr" pnpm ... migrate-persona-enum.ts
 *   pnpm ... migrate-persona-enum.ts --default-finance
 */

import { db, pool, atelierUsers } from "@workspace/db";
import { sql, eq, isNull, inArray } from "drizzle-orm";

// Per the task contract: ALL partner-tier and BD-active personas should land
// with bd_active=true; pure delivery personas land with bd_active=false.
const LEGACY_TO_NEW: Record<string, { role: string; bdActive: boolean }> = {
  engagement_lead: { role: "senior_manager", bdActive: true },
  sme: { role: "consultant", bdActive: false },
  ai_engineer: { role: "consultant", bdActive: false },
  business_developer: { role: "consultant", bdActive: true },
  // 'operations' is intentionally absent — handled separately so callers
  // are forced through the resolution gate.
  // No-op identity mappings (kept here so the script self-documents the
  // full matrix and so the bd_active backfill below can normalize them).
  partner: { role: "partner", bdActive: true },
  contractor: { role: "contractor", bdActive: false },
  partner_firm_resource: { role: "partner_firm_resource", bdActive: false },
};

const LEGACY_ROLES = [...Object.keys(LEGACY_TO_NEW), "operations"];

// Roles whose bd_active should be normalized to TRUE post-migration even if
// they're identity-mapped (so a pre-existing partner doesn't end up with
// bd_active=false from the schema default). founding_partner is included
// because the seed creates it directly.
const BD_ACTIVE_ROLES = new Set([
  "founding_partner",
  "partner",
  "senior_manager",
]);

function parseOpsResolution(): Map<string, "finance" | "hr"> {
  const out = new Map<string, "finance" | "hr">();
  const raw = process.env.ATELIER_OPS_RESOLUTION;
  if (!raw) return out;
  for (const pair of raw.split(",")) {
    const [id, role] = pair.split("=").map((s) => s.trim());
    if (!id || (role !== "finance" && role !== "hr")) {
      console.error(
        `[persona-migration] invalid ATELIER_OPS_RESOLUTION entry: "${pair}" (expected id=finance|hr)`,
      );
      process.exit(2);
    }
    out.set(id, role);
  }
  return out;
}

async function migrate(): Promise<void> {
  const allowDefault =
    process.argv.includes("--default-finance") ||
    process.env.ATELIER_OPS_DEFAULT_FINANCE === "1";
  const opsMap = parseOpsResolution();

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

  // ---- Operations resolution gate -------------------------------------
  const opsRows = rows.filter((r) => r.role === "operations");
  const unresolvedOps = opsRows.filter((r) => !opsMap.has(r.id));
  if (unresolvedOps.length > 0 && !allowDefault) {
    console.error(
      `[persona-migration] BLOCKED: ${unresolvedOps.length} 'operations' row(s) need an explicit finance|hr decision.`,
    );
    console.error(
      "  Resolve via ATELIER_OPS_RESOLUTION=\"id1=hr,id2=finance,...\" and re-run,",
    );
    console.error(
      "  or pass --default-finance / ATELIER_OPS_DEFAULT_FINANCE=1 to default the remainder to finance.",
    );
    for (const r of unresolvedOps) console.error(`    - ${r.id}: ${r.name}`);
    await pool.end();
    process.exit(3);
  }

  // ---- Apply the migration --------------------------------------------
  let migrated = 0;
  for (const r of rows) {
    let nextRole: string;
    let nextBdActive: boolean;
    if (r.role === "operations") {
      const resolved = opsMap.get(r.id) ?? "finance";
      nextRole = resolved;
      nextBdActive = false;
    } else {
      const target = LEGACY_TO_NEW[r.role];
      if (!target) continue;
      nextRole = target.role;
      nextBdActive = target.bdActive;
    }
    // Always write — even on identity maps — so we can normalize bd_active
    // (e.g. an existing partner that defaulted to false will be flipped).
    await db
      .update(atelierUsers)
      .set({ role: nextRole, bdActive: nextBdActive, updatedAt: new Date() })
      .where(eq(atelierUsers.id, r.id));
    migrated++;
    const bdNote = nextBdActive ? " (bd_active=true)" : "";
    const opsNote = r.role === "operations" && !opsMap.has(r.id) ? " [defaulted]" : "";
    console.log(
      `[persona-migration] ${r.id} (${r.name}): ${r.role} → ${nextRole}${bdNote}${opsNote}`,
    );
  }

  // ---- bd_active invariant backfill -----------------------------------
  // Founding partners and partners must always have bd_active=true regardless
  // of how they got into the table (script bypass, hand-promotion, etc.).
  const invariantRes = await db.execute(sql`
    UPDATE atelier_users
       SET bd_active = TRUE,
           updated_at = NOW()
     WHERE role = ANY(${sql.raw(`ARRAY[${[...BD_ACTIVE_ROLES].map((r) => `'${r}'`).join(",")}]`)})
       AND bd_active IS DISTINCT FROM TRUE
  `);
  console.log(
    `[persona-migration] bd_active invariant: enforced on ${invariantRes.rowCount ?? 0} partner-tier row(s).`,
  );

  console.log(`[persona-migration] migrated ${migrated} legacy rows.`);
  if (opsRows.length > 0) {
    const defaulted = opsRows.filter((r) => !opsMap.has(r.id));
    if (defaulted.length > 0) {
      console.warn(
        `[persona-migration] ${defaulted.length} 'operations' row(s) defaulted to 'finance' (--default-finance). ` +
          `Reclassify any HR personas via Admin → Persona Migration. Affected:`,
      );
      for (const r of defaulted) console.warn(`  - ${r.id}: ${r.name}`);
    }
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
