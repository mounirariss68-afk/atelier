/**
 * Task #1296 — GET /roster/legal-entities read gate + shape probe.
 *
 * The quick-add "Employing entity" dropdown now reads this endpoint, and
 * quick-add is open to the partner-or-ops tier — so partners must be able
 * to read it (previously 403), and the response must carry name/country/
 * officeAddress for the dialog's autofill.
 *
 * Run: npx tsx ./tests/roster-quick-add/legal-entities-gate.ts
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const PARTNER_ID = `p_test_legp_${STAMP}`;
const HR_ID = `p_test_leghr_${STAMP}`;
const EMP_ID = `p_test_legemp_${STAMP}`;
const ENTITY_ID = `le_test_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierLegalEntities } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function get(personaId: string): Promise<{ status: number; json: any }> {
    const res = await fetch(`${API}/roster/legal-entities`, {
      headers: { cookie: `atelier_persona=${personaId}` },
    });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  }

  try {
    for (const p of [
      { id: PARTNER_ID, role: "partner", roleLabel: "Partner", name: "QA Partner" },
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "QA HR" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "QA Employee" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "QA",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierLegalEntities).values({
      id: ENTITY_ID,
      orgId: ORG,
      legalNameEn: `QA Entity ${STAMP} LLC`,
      shortName: `QA Entity ${STAMP}`,
      country: "AE",
      status: "active",
      officeAddress: "Office 1, Test Tower, Dubai",
    });

    const partner = await get(PARTNER_ID);
    check("partner gets 200", partner.status === 200, `status=${partner.status}`);
    const ent = (partner.json?.entities ?? []).find((e: any) => e.id === ENTITY_ID);
    check("entity listed with name", ent?.name === `QA Entity ${STAMP}`);
    check("entity carries country", ent?.country === "AE");
    check("entity carries officeAddress", ent?.officeAddress === "Office 1, Test Tower, Dubai", JSON.stringify(ent));

    const hr = await get(HR_ID);
    check("hr gets 200", hr.status === 200, `status=${hr.status}`);

    const emp = await get(EMP_ID);
    check("employee gets 403", emp.status === 403, `status=${emp.status}`);
  } finally {
    try {
      await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.id, `le_test_${STAMP}%`));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_leg%_${STAMP}`));
    } catch {}
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll legal-entities gate checks passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
