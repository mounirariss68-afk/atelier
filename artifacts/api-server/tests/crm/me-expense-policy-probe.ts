/**
 * Task #1107 — Me-lens read-only expense policy summary probe.
 *
 * Covers GET /me/expense-policy:
 *   - unauthenticated → 401
 *   - employee → 200, principles string + caps; flight cap is the DEFAULT
 *     ($1,200 / economy), never the partner variant ($2,800 / business)
 *   - partner → 200, flight cap collapses to the partner variant
 *   - exactly one flight row per caller (role variant shadows global)
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/me-expense-policy-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

async function main() {
  const D = await import("@workspace/db");
  const { db, pool, atelierUsers } = D;
  const { inArray } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe1107_${Date.now()}`;
  const empId = `u_${runTag}_emp`;
  const fpId = `u_${runTag}_fp`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;

  const api = async (who: string | null, path: string) => {
    const res = await fetch(`${BASE}${path}`, {
      headers: who ? { cookie: `atelier_persona=${who}` } : {},
    });
    const txt = await res.text();
    let parsed: any = null;
    try {
      parsed = txt ? JSON.parse(txt) : null;
    } catch {
      parsed = txt;
    }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values([
      {
        id: empId,
        orgId: "aico",
        name: "Probe1107 Employee",
        initials: "PE",
        email: `${runTag}_emp@example.test`,
        role: "employee",
        roleLabel: "Consultant",
        title: "Consultant",
      },
      {
        id: fpId,
        orgId: "aico",
        name: "Probe1107 Partner",
        initials: "PP",
        email: `${runTag}_fp@example.test`,
        role: "partner",
        roleLabel: "Partner",
        title: "Partner",
      },
    ]);

    const anon = await api(null, "/me/expense-policy");
    check("unauthenticated 401", anon.status === 401, anon);

    const emp = await api(empId, "/me/expense-policy");
    check("employee 200", emp.status === 200, emp);
    check(
      "employee principles present",
      typeof emp.body?.principles === "string" && emp.body.principles.length > 20,
      emp.body?.principles,
    );
    const empFlights = (emp.body?.caps ?? []).filter((c: any) => c.category === "flight");
    check("employee one flight row", empFlights.length === 1, empFlights);
    check(
      "employee flight = default cap (not partner)",
      empFlights[0]?.capAmountUsd === 1200 && empFlights[0]?.flightClassMax === "economy",
      empFlights[0],
    );
    check(
      "employee sees no partner numbers anywhere",
      !(emp.body?.caps ?? []).some((c: any) => c.capAmountUsd === 2800),
      emp.body?.caps,
    );
    const empHotel = (emp.body?.caps ?? []).find((c: any) => c.category === "hotel");
    check("employee hotel cap present", empHotel?.capAmountUsd === 220, empHotel);

    const fp = await api(fpId, "/me/expense-policy");
    check("partner 200", fp.status === 200, fp);
    const fpFlights = (fp.body?.caps ?? []).filter((c: any) => c.category === "flight");
    check("partner one flight row", fpFlights.length === 1, fpFlights);
    check(
      "partner flight = partner variant",
      fpFlights[0]?.capAmountUsd === 2800 && fpFlights[0]?.flightClassMax === "business",
      fpFlights[0],
    );
  } finally {
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [empId, fpId]));
    server.close();
    await pool.end();
  }

  if (failures > 0) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("me-expense-policy-probe: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
