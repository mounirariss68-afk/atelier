/**
 * Task #124 — scratch-database boot seed (child process of ./scratch-db.ts).
 *
 * The isolated scratch database starts with schema + RLS only. The live boot
 * (src/index.ts) additionally seeds the founder users, auth credentials and
 * reference data that most test scripts anchor on (e.g. persona
 * "p_mounir_ariss"). This child mirrors that minimal boot seed, idempotently,
 * so every script that goes through the scratch-db bootstrap sees the same
 * baseline as the live app.
 *
 * Invoked via `pnpm exec tsx scratch-db-boot-seed.ts` with CRM_SCRATCH_URL
 * set; it must NEVER be pointed at the live database by callers.
 */
const scratchUrl = process.env.CRM_SCRATCH_URL;
if (!scratchUrl) {
  console.error("scratch-db-boot-seed: CRM_SCRATCH_URL is not set");
  process.exit(1);
}
if (process.env.CRM_LIVE_URL && scratchUrl === process.env.CRM_LIVE_URL) {
  console.error("scratch-db-boot-seed: refusing to seed the live database");
  process.exit(1);
}
// Bind @workspace/db (imported below) to the scratch database.
process.env.DATABASE_URL = scratchUrl;

const { db, pool, atelierUsers } = await import("@workspace/db");
const { ensureAtelierAuthSeed } = await import("../../src/lib/atelier-seed-auth.js");
const { ensureAtelierReferenceSeed } = await import("../../src/lib/atelier-seed-reference.js");

const FOUNDERS = [
  {
    id: "p_mounir_ariss",
    email: "mounir@cognirise.ai",
    name: "Mounir Ariss",
    initials: "MA",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
  },
  {
    id: "p_gokhan_guney",
    email: "gokhan@cognirise.ai",
    name: "Gokhan Guney",
    initials: "GG",
    role: "founding_partner",
    roleLabel: "Founding Partner",
    title: "Founding Partner",
  },
];

try {
  for (const f of FOUNDERS) {
    await db
      .insert(atelierUsers)
      .values({ ...f, orgId: "aico", permissions: ["*"], bdActive: true })
      .onConflictDoNothing();
  }
  await ensureAtelierAuthSeed();
  await ensureAtelierReferenceSeed();
  console.log("[crm-harness] Boot seed applied to the scratch database.");
} finally {
  await pool.end().catch(() => {});
}
