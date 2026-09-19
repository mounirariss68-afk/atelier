/**
 * Task #757 — expense create/edit reconciliation probe.
 *
 * Pins the rules reconciled across the expense write surfaces:
 *   - create: blank description stores NULL (so a later parse may prefill);
 *     summary falls back to merchant.
 *   - PATCH: empty description clears to NULL; empty category falls back to
 *     "other"; a date-only change recomputes FX; invalid amount → 400; and
 *     a manual merchant/description edit keeps summary in sync when no
 *     auditor summary exists.
 *   - wallet create: invalid amount → 400 (parity with /me/expenses).
 *
 * Runs standalone: tsx ./tests/expense-edit/run.ts (isolated scratch DB).
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { eq, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_ID = `p_test_xedit_${STAMP}`;
const FIN_ID = `p_test_xeditfin_${STAMP}`;
const EMP_PERSON = `emp_test_xedit_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const { db, pool, atelierUsers, atelierEmployees, atelierExpenses } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;

  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  const API = `http://127.0.0.1:${port}/api/atelier`;

  async function call(
    method: string,
    path: string,
    personaId: string,
    body?: Record<string, unknown>,
  ): Promise<{ status: number; body: any }> {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        cookie: `atelier_persona=${personaId}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  try {
    for (const p of [
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "XEdit Employee" },
      { id: FIN_ID, role: "finance", roleLabel: "Finance", name: "XEdit Finance" },
    ]) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "XE",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    await db.insert(atelierEmployees).values({
      id: EMP_PERSON,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "XEdit Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });

    // ── create: blank description → NULL, summary falls back to merchant ──
    const created = await call("POST", "/me/expenses", EMP_ID, {
      merchant: `Probe Deli ${STAMP}`,
      amount: 42.5,
      currency: "USD",
      expenseDate: "2026-07-10",
      description: "   ",
      businessPurpose: "Team meal",
      receiptFixtureKey: "receipt_basic",
      contextType: "bd",
    });
    check("create → 201", created.status === 201, `status=${created.status} ${JSON.stringify(created.body)}`);
    const expId = created.body?.expense?.id;
    let [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check("blank create description stored as NULL", row?.description === null, `desc=${JSON.stringify(row?.description)}`);
    check("create summary falls back to merchant", row?.summary === `Probe Deli ${STAMP}`, `summary=${row?.summary}`);

    // ── PATCH: set then clear description; summary follows manual edits ──
    const setDesc = await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { description: "Team lunch" });
    check("patch set description → 200", setDesc.status === 200, `status=${setDesc.status}`);
    [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check("description set", row?.description === "Team lunch", `desc=${row?.description}`);
    check("summary follows description (no auditor)", row?.summary === "Team lunch", `summary=${row?.summary}`);

    const clearDesc = await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { description: "" });
    check("patch clear description → 200", clearDesc.status === 200, `status=${clearDesc.status}`);
    [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check("cleared description stored as NULL", row?.description === null, `desc=${JSON.stringify(row?.description)}`);
    check("summary falls back to merchant after clear", row?.summary === `Probe Deli ${STAMP}`, `summary=${row?.summary}`);

    // ── PATCH: empty category falls back to "other" ──
    await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { category: "meal" });
    const clearCat = await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { category: "" });
    check("patch empty category → 200", clearCat.status === 200, `status=${clearCat.status}`);
    [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check('empty category falls back to "other"', row?.category === "other", `category=${row?.category}`);

    // ── PATCH: date-only change recomputes FX ──
    const beforeFxDate = row?.fxRateDate;
    const dateOnly = await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { expenseDate: "2026-06-01" });
    check("date-only patch → 200", dateOnly.status === 200, `status=${dateOnly.status}`);
    [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check(
      "date-only patch recomputes FX (fxRateDate moves with the date)",
      row?.fxRateDate !== beforeFxDate && !!row?.fxRateDate && Number.isFinite(Number(row?.usdAmount)),
      `fxRateDate ${beforeFxDate} → ${row?.fxRateDate} usd=${row?.usdAmount}`,
    );

    // ── PATCH: invalid amount → 400, row untouched ──
    const badAmt = await call("PATCH", `/me/expenses/${expId}`, EMP_ID, { amount: 0 });
    check("patch amount=0 → 400 invalid-amount", badAmt.status === 400 && badAmt.body?.error === "invalid-amount", `status=${badAmt.status} ${JSON.stringify(badAmt.body)}`);
    [row] = await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, expId));
    check("amount unchanged after rejected patch", Number(row?.amount) === 42.5, `amount=${row?.amount}`);

    // ── wallet create parity: invalid amount → 400 ──
    // Wallet routes sit behind the org lens (employee self-scope gate 403s
    // them) — exercise parity with a finance persona.
    const walletBad = await call("POST", "/wallet/expenses", FIN_ID, {
      merchant: "Wallet Probe",
      amount: 0,
      currency: "USD",
      businessPurpose: "Test invalid amount",
    });
    check("wallet create amount=0 → 400 invalid-amount", walletBad.status === 400 && walletBad.body?.error === "invalid-amount", `status=${walletBad.status} ${JSON.stringify(walletBad.body)}`);

    const walletOk = await call("POST", "/wallet/expenses", FIN_ID, {
      merchant: `Wallet Probe ${STAMP}`,
      amount: 10,
      currency: "USD",
      description: "  ",
      businessPurpose: "Office supplies",
    });
    check("wallet create blank description stored as NULL", walletOk.status === 201 && walletOk.body?.expense?.description == null, `status=${walletOk.status} desc=${JSON.stringify(walletOk.body?.expense?.description)}`);
  } finally {
    try {
      await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, EMP_ID));
      await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, FIN_ID));
      await db.delete(atelierEmployees).where(eq(atelierEmployees.id, EMP_PERSON));
      await db.delete(atelierUsers).where(like(atelierUsers.id, `p_test_xedit_%`));
    } catch (e) {
      console.error("cleanup failed:", e);
    }
    server.close();
    await pool.end().catch(() => {});
  }

  if (failures.length > 0) {
    console.error(`\n\u2717 expense-edit probe FAILED: ${failures.length} check(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log("\n\u2713 expense-edit probe passed");
  process.exit(0);
}

main().catch((err) => {
  console.error("probe crashed:", err);
  process.exit(1);
});
