/**
 * Task #160 — contract expiry sweep probe.
 *
 * Pins the lazy expiry sweep on contract read surfaces:
 *   1. signed contract with a past expiryDate → GET /contracts flips it
 *      to "expired" and writes a system audit event.
 *   2. draft contract with a past expiryDate → also flips.
 *   3. declined / voided contracts with past expiryDate are NEVER
 *      touched (they ended for another reason).
 *   4. expired is terminal: a second sweep is a no-op (no duplicate
 *      audit rows), and PATCH cannot move it back.
 *   5. signed contract expiring in the future stays signed.
 *   6. GET /me/contracts also sweeps (employee sees expired).
 *
 * Run: pnpm --filter @workspace/api-server exec tsx tests/crm/contract-expiry-probe.ts
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
  const { db, pool, atelierUsers, atelierEmployees, atelierContractRecords, atelierAuditEvents } =
    D as any;
  const { eq, and, like } = await import("drizzle-orm");
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const runTag = `probe160_${Date.now()}`;
  const fpId = `u_${runTag}_fp`;
  const empUserId = `u_${runTag}_emp`;
  const empId = `emp_${runTag}`;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const BASE = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;

  const api = async (method: string, path: string, body?: unknown, who: string = fpId) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        cookie: `atelier_persona=${who}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
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

  const past = new Date(Date.now() - 10 * 86_400_000);
  const future = new Date(Date.now() + 20 * 86_400_000);
  const ids = {
    signedPast: `ctr_${runTag}_a`,
    draftPast: `ctr_${runTag}_b`,
    declinedPast: `ctr_${runTag}_c`,
    voidedPast: `ctr_${runTag}_d`,
    signedFuture: `ctr_${runTag}_e`,
  };

  try {
    await db.insert(atelierUsers).values({
      id: fpId,
      orgId: "aico",
      name: "Probe160 Partner",
      initials: "PP",
      email: `${runTag}_fp@example.test`,
      role: "founding_partner",
      roleLabel: "Founding Partner",
      title: "Founding Partner",
    } as any);
    await db.insert(atelierUsers).values({
      id: empUserId,
      orgId: "aico",
      name: "Probe160 Employee",
      initials: "PE",
      email: `${runTag}_emp@example.test`,
      role: "employee",
      roleLabel: "Employee",
      title: "Consultant",
    } as any);
    await db.insert(atelierEmployees).values({
      id: empId,
      orgId: "aico",
      userId: empUserId,
      fullName: "Probe160 Emp",
      email: `${runTag}_e@example.test`,
      role: "consultant",
      roleTitle: "Consultant",
    } as any);

    const mk = (id: string, status: string, expiryDate: Date, personId?: string) =>
      db.insert(atelierContractRecords).values({
        id,
        orgId: "aico",
        title: `Probe160 ${id.slice(-1)}`,
        contractType: "individual_nda",
        counterpartyKind: "person",
        personId: personId ?? null,
        counterpartyLabel: "Probe160 CP",
        status,
        ownerUserId: fpId,
        ownerLabel: "Probe160 Partner",
        expiryDate,
      } as any);

    await mk(ids.signedPast, "signed", past, empId);
    await mk(ids.draftPast, "draft", past);
    await mk(ids.declinedPast, "declined", past);
    await mk(ids.voidedPast, "voided", past);
    await mk(ids.signedFuture, "signed", future);

    // ---- 1+2+3+5: list sweeps ----
    const list = await api("GET", "/contracts");
    check("GET /contracts -> 200", list.status === 200, list.status);
    const byId = new Map<string, any>(
      (list.body?.contracts ?? []).map((c: any) => [c.id, c]),
    );
    check("signed+past -> expired", byId.get(ids.signedPast)?.status === "expired", byId.get(ids.signedPast)?.status);
    check("draft+past -> expired", byId.get(ids.draftPast)?.status === "expired", byId.get(ids.draftPast)?.status);
    check("declined+past untouched", byId.get(ids.declinedPast)?.status === "declined", byId.get(ids.declinedPast)?.status);
    check("voided+past untouched", byId.get(ids.voidedPast)?.status === "voided", byId.get(ids.voidedPast)?.status);
    check("signed+future stays signed", byId.get(ids.signedFuture)?.status === "signed", byId.get(ids.signedFuture)?.status);

    // audit event written by the sweep
    const audits = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, ids.signedPast),
          eq(atelierAuditEvents.action, "contract.expired"),
        ),
      );
    check("sweep wrote contract.expired audit", audits.length === 1, audits.length);
    check("audit actor is system", audits[0]?.actorType === "system", audits[0]?.actorType);

    // ---- 4: idempotent + terminal ----
    await api("GET", "/contracts");
    const audits2 = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityId, ids.signedPast),
          eq(atelierAuditEvents.action, "contract.expired"),
        ),
      );
    check("second sweep is a no-op (no duplicate audit)", audits2.length === 1, audits2.length);

    const patch = await api("PATCH", `/contracts/${ids.signedPast}`, { status: "signed" });
    check("expired never regresses via PATCH", patch.status !== 200 || patch.body?.contract?.status === "expired", patch);

    // detail view shows expired too
    const detail = await api("GET", `/contracts/${ids.draftPast}`);
    check("detail shows expired", detail.body?.contract?.status === "expired", detail.body?.contract?.status);

    // ---- 6: /me/contracts sweeps + employee sees expired ----
    const mine = await api("GET", "/me/contracts", undefined, empUserId);
    const mineRow = (mine.body?.contracts ?? []).find((c: any) => c.id === ids.signedPast);
    check("employee /me/contracts shows expired", mineRow?.status === "expired", mineRow?.status);
  } finally {
    // cleanup — tag sweep
    await db.delete(atelierAuditEvents).where(like(atelierAuditEvents.entityId, `ctr_${runTag}%`));
    await db.delete(atelierContractRecords).where(like(atelierContractRecords.id, `ctr_${runTag}%`));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, empId));
    await db.delete(atelierUsers).where(like(atelierUsers.id, `u_${runTag}%`));
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
