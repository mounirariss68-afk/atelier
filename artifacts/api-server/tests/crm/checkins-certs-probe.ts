/**
 * Task #115 — check-ins & certifications probe.
 * Deterministic, no LLM calls. Run: pnpm exec tsx tests/crm/checkins-certs-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

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
  const { db, pool, atelierUsers, atelierEmployees, atelierCheckIns, atelierCertifications } = D;
  const { eq, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe115_${Date.now()}`;
  const userId = `u_${runTag}`;
  const empId = `emp_${runTag}`;
  const restrictedId = `u_r_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const BASE = `http://127.0.0.1:${port}/api/atelier`;
  const api = async (method: string, path: string, body?: unknown, asUser = userId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: `atelier_persona=${asUser}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const txt = await res.text();
    let parsed: any = null;
    try { parsed = txt ? JSON.parse(txt) : null; } catch { parsed = txt; }
    return { status: res.status, body: parsed };
  };

  try {
    await db.insert(atelierUsers).values({
      id: userId, orgId: "aico", name: "Probe OneFifteen", initials: "PF",
      email: `${runTag}@example.test`, role: "founding_partner",
      roleLabel: "Founding Partner", title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: restrictedId, orgId: "aico", name: "Probe Restricted", initials: "PR",
      email: `r_${runTag}@example.test`, role: "employee",
      roleLabel: "Employee", title: "Analyst",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId, orgId: "aico", fullName: "Cert Probe Employee",
      email: `emp_${runTag}@example.test`, role: "consultant", roleTitle: "Consultant",
    } as any);

    // ---- check-ins ----
    const ciCreate = await api("POST", "/people/check-ins", {
      employeeId: empId, scheduledFor: "2026-07-20", managerName: "Probe Mgr", notes: "Q3 goals",
    });
    check("check-in create 201", ciCreate.status === 201, ciCreate);
    check("check-in wire has employeeName", ciCreate.body?.employeeName === "Cert Probe Employee", ciCreate.body);
    const ciId = ciCreate.body?.id;

    const ciList = await api("GET", `/people/check-ins?employeeId=${empId}`);
    check("check-in list contains row", ciList.status === 200 && ciList.body?.some((r: any) => r.id === ciId), ciList);

    const ciPatch = await api("PATCH", `/people/check-ins/${ciId}`, { status: "completed" });
    check("check-in patch -> completed", ciPatch.status === 200 && ciPatch.body?.status === "completed", ciPatch);

    const ciBad = await api("POST", "/people/check-ins", { employeeId: "nope", scheduledFor: "2026-07-20" });
    check("check-in unknown employee 404", ciBad.status === 404, ciBad);

    const ci403 = await api("GET", "/people/check-ins", undefined, restrictedId);
    check("check-in list restricted persona 403", ci403.status === 403, ci403);

    // ---- certifications ----
    const active = await api("POST", "/people/certifications", {
      employeeId: empId, certName: "PMP", issuer: "PMI", issuedOn: "2025-01-01", expiresOn: "2028-01-01",
    });
    check("cert create 201 active", active.status === 201 && active.body?.status === "active", active);
    const expiring = await api("POST", "/people/certifications", {
      employeeId: empId, certName: "AWS SA", issuer: "AWS", issuedOn: "2024-08-01", expiresOn: "2026-08-01",
    });
    check("cert expiring status derived", expiring.status === 201 && expiring.body?.status === "expiring", expiring.body);
    const expired = await api("POST", "/people/certifications", {
      employeeId: empId, certName: "Old Cert", issuedOn: "2020-01-01", expiresOn: "2023-01-01",
    });
    check("cert expired status derived", expired.status === 201 && expired.body?.status === "expired", expired.body);
    const noExpiry = await api("POST", "/people/certifications", {
      employeeId: empId, certName: "Lifetime", issuedOn: "2022-01-01",
    });
    check("cert no expiry -> active", noExpiry.status === 201 && noExpiry.body?.status === "active", noExpiry.body);

    const certList = await api("GET", `/people/certifications?employeeId=${empId}`);
    check("cert list has 4 rows", certList.status === 200 && certList.body?.length === 4, certList.body?.length);

    const arch = await api("DELETE", `/people/certifications/${expired.body.id}`);
    check("cert archive 200", arch.status === 200, arch);
    const afterArch = await api("GET", `/people/certifications?employeeId=${empId}`);
    check("archived cert excluded", afterArch.body?.length === 3, afterArch.body?.length);
    const archAgain = await api("DELETE", `/people/certifications/${expired.body.id}`);
    check("re-archive 404", archAgain.status === 404, archAgain);

    const cert403 = await api("POST", "/people/certifications", {
      employeeId: empId, certName: "X", issuedOn: "2025-01-01",
    }, restrictedId);
    check("cert create restricted persona 403", cert403.status === 403, cert403);

    const certBad = await api("POST", "/people/certifications", { employeeId: empId });
    check("cert invalid body 400", certBad.status === 400, certBad);
  } finally {
    await db.delete(atelierCheckIns).where(eq(atelierCheckIns.employeeId, empId));
    await db.delete(atelierCertifications).where(eq(atelierCertifications.employeeId, empId));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_%${runTag}`));
    await db.delete(atelierUsers).where(eq(atelierUsers.id, restrictedId));
    server.close();
    await pool.end();
  }

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("PROBE CRASH", err);
  process.exit(1);
});
