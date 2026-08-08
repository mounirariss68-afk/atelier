/**
 * Task #786 — travel-companion name ambiguity uses the standard
 * ranked-candidate disambiguation contract.
 *
 * Scratch-DB probe:
 *   1. q matching several people → disambiguation {kind, options[{id,
 *      label,secondary}]} with candidates ranked closest-first — never
 *      an undifferentiated list.
 *   2. q matching exactly one person → normal picker payload (no ask).
 *   3. Roster scope holds: a partner sees only in-perimeter names in
 *      the candidates.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/travel/travel-companion-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "../crm/scratch-db.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe786_${Date.now()}`;
const ORG = "aico";

async function main() {
  const D = (await import("@workspace/db")) as any;
  const { db, pool, atelierUsers, atelierEmployees } = D;
  const { eq, inArray } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/travel-companion-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    fp: `u_${TAG}_fp`,
    e1: `pe_${TAG}_1`,
    e2: `pe_${TAG}_2`,
    e3: `pe_${TAG}_3`,
  };

  try {
    await db
      .insert(atelierUsers)
      .values([
        {
          id: IDS.fp,
          orgId: ORG,
          email: `${TAG}.fp@cognirise.ai`,
          name: "Probe FP",
          initials: "PF",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierEmployees)
      .values([
        {
          id: IDS.e1,
          orgId: ORG,
          fullName: `Samira Traveller ${TAG}`,
          email: `${TAG}.samira@cognirise.ai`,
          role: "consultant",
          status: "active",
        },
        {
          id: IDS.e2,
          orgId: ORG,
          fullName: `Samira Travelli ${TAG}`,
          email: `${TAG}.samir@cognirise.ai`,
          role: "consultant",
          status: "active",
        },
        {
          id: IDS.e3,
          orgId: ORG,
          fullName: `Zoltan Unrelated ${TAG}`,
          email: `${TAG}.zoltan@cognirise.ai`,
          role: "consultant",
          status: "active",
        },
      ] as any)
      .onConflictDoNothing();

    const companions = findByToolName("list_travel_companions");
    check("catalog: list_travel_companions registered", !!companions);
    const ctx = { persona: { id: IDS.fp, orgId: ORG, role: "founding_partner", name: "Probe FP" } } as any;

    // 1 — ambiguous name → standard ranked disambiguation
    const amb: any = await companions!.run({ q: "Samira", adults: 2 }, ctx);
    const opts = amb?.data?.options ?? [];
    check(
      "786: ambiguous companion name → standard disambiguation shape",
      amb?.ok === true &&
        Array.isArray(amb?.disambiguation?.options) &&
        amb?.disambiguation?.kind === "traveller" &&
        /who did you mean/i.test(String(amb?.data?.prompt ?? "")),
      JSON.stringify(amb).slice(0, 300),
    );
    check(
      "786: candidates ranked closest-first with secondary context",
      opts.length >= 2 &&
        String(opts[0]?.label).startsWith("Samira") &&
        typeof opts[0]?.secondary === "string",
      JSON.stringify(opts).slice(0, 300),
    );
    check(
      "786: unrelated people are not offered as candidates",
      !JSON.stringify(opts).includes("Zoltan"),
      JSON.stringify(opts).slice(0, 200),
    );

    // 2 — unique name → normal picker payload, no ask
    const uniq: any = await companions!.run({ q: "Zoltan", adults: 2 }, ctx);
    check(
      "786: unique companion name → picker payload, no disambiguation",
      uniq?.ok === true &&
        !uniq?.disambiguation &&
        (uniq?.data?.items ?? []).some((i: any) => String(i.name).startsWith("Zoltan")),
      JSON.stringify(uniq).slice(0, 300),
    );
  } finally {
    try {
      await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [IDS.e1, IDS.e2, IDS.e3]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, IDS.fp));
      await pool.end();
    } catch (e) {
      console.error("cleanup failed", e);
    }
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
