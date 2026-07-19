/**
 * Standalone probe — person resolution across three rosters + routed
 * phone write. Run: pnpm --filter @workspace/api-server exec tsx tests/crm/person-resolution-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import { hybridResolveEntity } from "../../src/lib/atelier-cli/entity-resolver.js";
import "../../src/lib/atelier-cli/coverage-capabilities.js";
import { findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";
import { db, atelierEmployees } from "@workspace/db";
import { eq } from "drizzle-orm";

const ORG = "aico";
let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} — ${name}${ok ? "" : " :: " + JSON.stringify(extra)}`);
  if (!ok) failures++;
}

async function main() {
  // 1. Fuzzy resolve finds an internal employee under kind "contact".
  const c1 = await hybridResolveEntity("contact", "Mounir Ariss", ORG);
  const empHit = c1.find((c) => c.id.startsWith("emp_"));
  check("employee found via person search", !!empHit, c1);
  check("employee candidate labelled as Employee", !!empHit?.secondary?.startsWith("Employee"), empHit);

  // 2. Exact-id lookup for an employee id resolves too.
  if (empHit) {
    const byId = await hybridResolveEntity("contact", empHit.id, ORG);
    check("employee exact-id resolves", byId.length === 1 && byId[0].via === "id", byId);
  }

  // 3. Partner-firm person resolves (pick any).
  const [pr] = await db.execute<{ full_name: string }>(
    // eslint-disable-next-line
    (await import("drizzle-orm")).sql`SELECT full_name FROM atelier_partner_firm_resources WHERE org_id = ${ORG} AND deleted_at IS NULL LIMIT 1`
  ).then((r: any) => r.rows as Array<{ full_name: string }>);
  if (pr) {
    const c2 = await hybridResolveEntity("contact", pr.full_name, ORG);
    check("partner-firm person found via person search", c2.some((c) => c.secondary?.startsWith("Partner resource")), c2);
  } else {
    console.log("SKIP — no partner-firm resources in DB");
  }

  // 4. Routed phone write: contact_update with an employee id appends to cellPhones.
  if (empHit) {
    const cap = findByToolName("contact_update")!;
    const persona = { id: "p_zeina_haddad", orgId: ORG, role: "founding_partner", name: "Zeina Haddad" };
    const before = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, empHit.id));
    const res = await cap.run(
      { confirm: true, id: empHit.id, phone: "+971506504416" },
      { persona } as any,
    );
    check("contact_update routes to employee record", (res as any).ok === true && (res as any).data?.kind === "employee", res);
    const after = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, empHit.id));
    const cells = (after[0]?.cellPhones ?? []) as Array<{ country: string; number: string }>;
    check("mobile saved to employee cellPhones with UAE label", cells.some((c) => c.number === "+971506504416" && c.country === "UAE"), cells);

    // idempotent second write reports already-on-file
    const res2 = await cap.run({ confirm: true, id: empHit.id, phone: "+971 50 650 4416" }, { persona } as any);
    check("duplicate phone write is a no-op", (res2 as any).ok === true && JSON.stringify((res2 as any).data?.skipped ?? []).includes("already on file"), res2);

    // restore original state
    await db.update(atelierEmployees).set({ cellPhones: (before[0]?.cellPhones ?? []) as any }).where(eq(atelierEmployees.id, empHit.id));

    // 5. Unprivileged non-self persona is forbidden.
    const res3 = await cap.run(
      { confirm: true, id: empHit.id, phone: "+971501111111" },
      { persona: { id: "p_random_consultant", orgId: ORG, role: "consultant", name: "X" } } as any,
    );
    check("non-self consultant forbidden", (res3 as any).ok === false && (res3 as any).errorCode === "forbidden", res3);

    // 6. Self-edit allowed for phone (Mounir edits his own record).
    const selfUserId = before[0]?.userId;
    if (selfUserId) {
      const res4 = await cap.run(
        { confirm: true, id: empHit.id, phone: "+971502222222" },
        { persona: { id: selfUserId, orgId: ORG, role: "consultant", name: "Self" } } as any,
      );
      check("self-edit phone allowed", (res4 as any).ok === true, res4);
      await db.update(atelierEmployees).set({ cellPhones: (before[0]?.cellPhones ?? []) as any }).where(eq(atelierEmployees.id, empHit.id));

      // 7. Field-level ACL: self may NOT edit title/fullName/email.
      const res5 = await cap.run(
        { confirm: true, id: empHit.id, title: "Chief Hacker" },
        { persona: { id: selfUserId, orgId: ORG, role: "consultant", name: "Self" } } as any,
      );
      check("self title edit forbidden", (res5 as any).ok === false && (res5 as any).errorCode === "forbidden", res5);
      const res6 = await cap.run(
        { confirm: true, id: empHit.id, fullName: "Impostor", email: "x@y.z" },
        { persona: { id: selfUserId, orgId: ORG, role: "consultant", name: "Self" } } as any,
      );
      check("self fullName/email edit forbidden", (res6 as any).ok === false && (res6 as any).errorCode === "forbidden", res6);

      // 8. Partner may edit phone but NOT title (titles are HR/founding only).
      const res7 = await cap.run(
        { confirm: true, id: empHit.id, title: "Chief Hacker" },
        { persona: { id: "p_partner_probe", orgId: ORG, role: "partner", name: "Partner" } } as any,
      );
      check("partner title edit forbidden", (res7 as any).ok === false && (res7 as any).errorCode === "forbidden", res7);
      const res8 = await cap.run(
        { confirm: true, id: empHit.id, phone: "+971503333333" },
        { persona: { id: "p_partner_probe", orgId: ORG, role: "partner", name: "Partner" } } as any,
      );
      check("partner phone edit allowed", (res8 as any).ok === true, res8);
      await db.update(atelierEmployees).set({ cellPhones: (before[0]?.cellPhones ?? []) as any }).where(eq(atelierEmployees.id, empHit.id));

      // 9. Mixed request (allowed phone + denied title) applies phone, reports denied.
      const res9 = await cap.run(
        { confirm: true, id: empHit.id, phone: "+971504444444", title: "Chief Hacker" },
        { persona: { id: selfUserId, orgId: ORG, role: "consultant", name: "Self" } } as any,
      );
      const d9 = (res9 as any).data ?? {};
      check(
        "mixed request applies phone and denies title",
        (res9 as any).ok === true && (d9.applied ?? []).includes("phone") && JSON.stringify(d9.denied ?? []).includes("title"),
        res9,
      );
      const afterMixed = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, empHit.id));
      check("title unchanged after mixed request", afterMixed[0]?.title === before[0]?.title, afterMixed[0]?.title);
      await db.update(atelierEmployees).set({ cellPhones: (before[0]?.cellPhones ?? []) as any }).where(eq(atelierEmployees.id, empHit.id));
    }
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
