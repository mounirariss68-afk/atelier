/**
 * Task #346 — "Contracts awaiting your signature" probe.
 *
 * Pins GET /contracts/awaiting-my-signature (home-page card feed) and the
 * canSeeContract signatory carve-out that keeps the card's / notification's
 * /contracts/:id link working:
 *
 *   1. Signatory sees entity-matched requested contracts; legacy contracts
 *      (no signing entity / no configured signatories) fall back to any
 *      partner-tier manager.
 *   2. Terminal-status and non-requested contracts are excluded.
 *   3. A NON-partner user configured as an authorised signatory sees the
 *      request in the list AND can open GET /contracts/:id (200) — the
 *      "working link" guarantee.
 *   4. Employees stay behind the global /me self-scope gate (403);
 *      unauthenticated requests get 401.
 *
 * Run: pnpm --filter @workspace/api-server test:awaiting-signature
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import type { AddressInfo } from "node:net";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
}

async function main() {
  const D: any = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierContractRecords, atelierSigningEntitySignatories } = D;
  const { inArray } = await import("drizzle-orm");
  const app = (await import("../../src/app.js")).default;

  const tag = `probe346_${Date.now()}`;
  const sigId = `u_${tag}_sig`;      // founding_partner, authorised signatory
  const smSigId = `u_${tag}_smsig`;  // senior_manager (NOT partner-tier), authorised signatory
  const p2Id = `u_${tag}_p2`;        // partner, NOT an authorised signatory
  const empId = `u_${tag}_emp`;      // employee (self-scope gated)
  const entityId = `lent_${tag}`;
  const ctrA = `ctr_${tag}_a`; // requested, entity with signatories
  const ctrB = `ctr_${tag}_b`; // requested but voided (terminal)
  const ctrC = `ctr_${tag}_c`; // requested, no signing entity (legacy)
  const ctrD = `ctr_${tag}_d`; // NOT requested

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  const get = async (path: string, who: string) => {
    const res = await fetch(`${BASE}${path}`, { headers: { cookie: `atelier_persona=${who}` } });
    return { status: res.status, body: await res.json().catch(() => null) as any };
  };
  const list = async (who: string) => {
    const r = await get("/contracts/awaiting-my-signature", who);
    return {
      status: r.status,
      ids: ((r.body?.contracts ?? []) as any[]).map((c) => c.id).filter((id) => id.includes(tag)),
      body: r.body,
    };
  };

  try {
    await db.insert(atelierUsers).values([
      { id: sigId, orgId: "aico", name: "P346 Signatory", initials: "PS", email: `${tag}_s@example.test`, role: "founding_partner", roleLabel: "Founding Partner", title: "FP" },
      { id: smSigId, orgId: "aico", name: "P346 SM Signatory", initials: "SM", email: `${tag}_sm@example.test`, role: "senior_manager", roleLabel: "Senior Manager", title: "Senior Manager" },
      { id: p2Id, orgId: "aico", name: "P346 Partner2", initials: "P2", email: `${tag}_p2@example.test`, role: "partner", roleLabel: "Partner", title: "Partner" },
      { id: empId, orgId: "aico", name: "P346 Employee", initials: "PE", email: `${tag}_e@example.test`, role: "employee", roleLabel: "Employee", title: "Consultant" },
    ] as any);
    await db.insert(atelierSigningEntitySignatories).values({
      id: `sesig_${tag}`, orgId: "aico", entityId, userIds: [sigId, smSigId], updatedBy: sigId, updatedByLabel: "P346",
    } as any);
    const base = {
      orgId: "aico", contractType: "other", counterpartyKind: "contact",
      counterpartyLabel: "Acme Ltd", ownerUserId: p2Id, ownerLabel: "P346 Partner2",
      firmSignatureRequestedAt: new Date(), firmSignatureRequestedBy: p2Id,
      firmSignatureRequestedByLabel: "P346 Partner2",
    };
    await db.insert(atelierContractRecords).values([
      { ...base, id: ctrA, title: `${tag} A`, status: "final_uploaded", signingEntityId: entityId, signingEntityLabel: "Cognirise FZ-LLC" },
      { ...base, id: ctrB, title: `${tag} B`, status: "voided", signingEntityId: entityId },
      { ...base, id: ctrC, title: `${tag} C`, status: "draft", signingEntityId: null },
      { ...base, id: ctrD, title: `${tag} D`, status: "draft", signingEntityId: entityId, firmSignatureRequestedAt: null, firmSignatureRequestedBy: null, firmSignatureRequestedByLabel: null },
    ] as any);

    // ---- 1/2. list filtering ----
    const asSig = await list(sigId);
    check("signatory: 200", asSig.status === 200, asSig);
    check("signatory sees A (entity match)", asSig.ids.includes(ctrA), asSig.ids);
    check("signatory sees C (legacy, partner-tier)", asSig.ids.includes(ctrC), asSig.ids);
    check("terminal B excluded", !asSig.ids.includes(ctrB), asSig.ids);
    check("non-requested D excluded", !asSig.ids.includes(ctrD), asSig.ids);
    const a = (asSig.body.contracts as any[]).find((c) => c.id === ctrA);
    check("shape has requestedByLabel + title", a?.requestedByLabel === "P346 Partner2" && a?.title === `${tag} A`, a);

    const asP2 = await list(p2Id);
    check("non-signatory partner: A hidden (restricted entity)", !asP2.ids.includes(ctrA), asP2.ids);
    check("non-signatory partner: C visible (legacy any-partner)", asP2.ids.includes(ctrC), asP2.ids);

    // ---- 3. non-partner signatory: list entry + working detail link ----
    const asSm = await list(smSigId);
    check("non-partner signatory sees A in list", asSm.ids.includes(ctrA), asSm);
    check("non-partner signatory does NOT get legacy C", !asSm.ids.includes(ctrC), asSm.ids);
    const smDetail = await get(`/contracts/${ctrA}`, smSigId);
    check("non-partner signatory can open /contracts/:id (working link)", smDetail.status === 200 && smDetail.body?.contract?.id === ctrA, smDetail.status);
    const smDetailD = await get(`/contracts/${ctrD}`, smSigId);
    check("non-partner signatory still 403 on non-requested contract", smDetailD.status === 403, smDetailD.status);

    // ---- 4. gates ----
    const asEmp = await list(empId);
    check("employee self-scope 403", asEmp.status === 403, asEmp);
    const anon = await fetch(`${BASE}/contracts/awaiting-my-signature`);
    check("unauthenticated 401", anon.status === 401, anon.status);
  } finally {
    await db.delete(atelierContractRecords).where(inArray(atelierContractRecords.id, [ctrA, ctrB, ctrC, ctrD]));
    await db.delete(atelierSigningEntitySignatories).where(inArray(atelierSigningEntitySignatories.id, [`sesig_${tag}`]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [sigId, smSigId, p2Id, empId]));
    server.close();
    await pool.end().catch(() => {});
  }
  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
