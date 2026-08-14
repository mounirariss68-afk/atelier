/** Task #428 probe — Finance GL backbone: chart seed, Bookkeeper posting,
 * idempotency, entity tagging + exceptions, manual journal, trial balance,
 * period close-lock enforcement. Self-cleaning (uses period 2020-01). */
process.env.NODE_ENV = "test";
const PERSONA = "p_mounir_ariss";
const PERIOD = "2020-01";
const T = "__T428";

async function main() {
  const { default: app } = await import("../src/app.js").then(m => ({ default: (m as any).default ?? (m as any).app }));
  const {
    db, atelierLegalEntities, atelierInvoice, atelierExpenses,
    atelierGlAccount, atelierGlJournalEntry, atelierGlJournalLine,
    atelierGlPostingException, atelierPeriodCloseLock, atelierAuditEvents,
  } = await import("@workspace/db");
  const { and, eq, like, inArray } = await import("drizzle-orm");
  const server = (app as any).listen(0);
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api/atelier`;
  const hdrs = { cookie: `atelier_persona=${PERSONA}`, "content-type": "application/json" };
  let fails = 0;
  const check = (name: string, ok: boolean, extra?: unknown) => {
    if (!ok) fails++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`, ok ? "" : JSON.stringify(extra)?.slice(0, 400));
  };
  const entIds: string[] = [];
  const rid = (p: string) => `${p}_t428_${Math.random().toString(36).slice(2, 8)}`;
  try {
    // 0) create TWO test entities so no sole-entity default applies
    for (const nm of ["A", "B"]) {
      const r = await fetch(`${base}/finance/entities`, {
        method: "POST", headers: hdrs,
        body: JSON.stringify({ legalNameEn: `${T} Entity ${nm}`, shortName: `T428${nm}`, country: "AE", baseCurrency: "USD" }),
      });
      const j = await r.json();
      check(`create entity ${nm}`, r.status === 201 && !!j.entity?.id, j);
      entIds.push(j.entity.id);
    }
    const [entA] = entIds;

    // 1) chart auto-seeds on GL reads (Task #1081) — first read seeds, second is a no-op
    const s = await fetch(`${base}/gl/accounts?entityId=${entA}`, { headers: hdrs });
    const sj = await s.json();
    check("auto-seed on read creates accounts", s.status === 200 && sj.data.rows.length >= 20, sj.data?.rows?.length);
    const s2 = await fetch(`${base}/gl/accounts?entityId=${entA}`, { headers: hdrs }).then(r => r.json());
    check("auto-seed idempotent", s2.data.rows.length === sj.data.rows.length, s2.data?.rows?.length);
    const accts = await fetch(`${base}/gl/accounts?entityId=${entA}`, { headers: hdrs }).then(r => r.json());
    check("accounts listed", accts.data.rows.some((a: any) => a.code === "1100" && a.isSystem), accts.data?.rows?.length);

    // 2) insert source rows in the probe period: one tagged invoice, one untagged invoice, one tagged expense
    const invTagged = rid("inv");
    const invUntagged = rid("inv");
    const expId = rid("exp");
    await db.insert(atelierInvoice).values([
      { id: invTagged, jurisdiction: "UAE", legalEntityId: entA, status: "issued", invoiceNumber: `${T}-001`, currency: "USD", subtotal: 1000, vatAmount: 50, total: 1050, issuedAt: new Date("2020-01-10T00:00:00Z") },
      { id: invUntagged, jurisdiction: "UAE", status: "issued", invoiceNumber: `${T}-002`, currency: "USD", subtotal: 500, vatAmount: 0, total: 500, issuedAt: new Date("2020-01-15T00:00:00Z") },
    ] as any);
    await db.insert(atelierExpenses).values({
      id: expId, personId: PERSONA, expenseDate: "2020-01-12", captureSource: "manual",
      merchant: `${T} Hotel`, category: "hotel", amount: 200, usdAmount: 200, vatTreatment: "none",
      status: "approved", approvedAt: new Date("2020-01-13T00:00:00Z"), entityId: entA,
    } as any);

    // 3) run the Bookkeeper for the period
    const r1 = await fetch(`${base}/gl/bookkeeper/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ periodLabel: PERIOD }) });
    const j1 = await r1.json();
    check("bookkeeper run 200", r1.status === 200, j1);
    check("run posts tagged invoice + expense", j1.data.entriesCreated >= 2, j1.data);
    check("untagged invoice becomes exception", j1.data.exceptions.some((e: any) => e.sourceRef === invUntagged && e.code === "untagged_entity"), j1.data.exceptions);

    // 4) idempotent re-run: nothing new
    const j2 = await fetch(`${base}/gl/bookkeeper/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ periodLabel: PERIOD }) }).then(r => r.json());
    const rerunNew = (await db.select().from(atelierGlJournalEntry).where(and(eq(atelierGlJournalEntry.periodLabel, PERIOD), inArray(atelierGlJournalEntry.sourceRef, [invTagged, expId])))).length;
    check("re-run skips existing", j2.data.entriesCreated === 0 && j2.data.entriesSkippedExisting >= 2 && rerunNew === 2, j2.data);

    // 5) journal + trial balance balanced
    const jr = await fetch(`${base}/gl/journal?entityId=${entA}&period=${PERIOD}`, { headers: hdrs }).then(r => r.json());
    check("journal rows carry lines", jr.data.rows.length >= 2 && jr.data.rows.every((e: any) => e.lines.length >= 2), jr.data.rows?.length);
    const tb = await fetch(`${base}/gl/trial-balance?entityId=${entA}&period=${PERIOD}`, { headers: hdrs }).then(r => r.json());
    check("trial balance balanced", tb.data.balanced === true && tb.data.totals.debit > 0, tb.data);

    // 6) fix untagged invoice via /gl/tag, re-run posts it and auto-resolves the exception
    const tg = await fetch(`${base}/gl/tag`, { method: "POST", headers: hdrs, body: JSON.stringify({ kind: "invoice", id: invUntagged, legalEntityId: entA }) });
    check("tag endpoint 200", tg.status === 200);
    const j3 = await fetch(`${base}/gl/bookkeeper/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ periodLabel: PERIOD }) }).then(r => r.json());
    check("tagged invoice now posts", j3.data.entriesCreated === 1, j3.data);
    const [exRow] = await db.select().from(atelierGlPostingException).where(and(eq(atelierGlPostingException.sourceRef, invUntagged), eq(atelierGlPostingException.code, "untagged_entity")));
    check("exception auto-resolved", exRow?.status === "resolved", exRow);

    // 7) manual journal: unbalanced rejected, balanced accepted
    const bad = await fetch(`${base}/gl/journal/manual`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ entityId: entA, periodLabel: PERIOD, entryDate: "2020-01-20", memo: `${T} unbalanced`, currency: "USD", lines: [{ accountCode: "1000", debit: 100 }, { accountCode: "3000", credit: 90 }] }),
    });
    check("unbalanced manual rejected 400", bad.status === 400, await bad.json());
    const good = await fetch(`${base}/gl/journal/manual`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ entityId: entA, periodLabel: PERIOD, entryDate: "2020-01-20", memo: `${T} capital injection`, currency: "USD", lines: [{ accountCode: "1000", debit: 100 }, { accountCode: "3000", credit: 100 }] }),
    });
    check("balanced manual accepted 201", good.status === 201, await good.clone().json().catch(() => null));

    // 8) period close lock blocks bookkeeper run + manual journal
    await db.insert(atelierPeriodCloseLock).values({ id: rid("lock"), periodLabel: PERIOD, lockedModules: ["gl"], lockedByUserId: PERSONA } as any)
      .onConflictDoUpdate({ target: [atelierPeriodCloseLock.orgId, atelierPeriodCloseLock.periodLabel], set: { lockedModules: ["gl"], deletedAt: null } });
    const lockedRun = await fetch(`${base}/gl/bookkeeper/run`, { method: "POST", headers: hdrs, body: JSON.stringify({ periodLabel: PERIOD }) });
    check("locked period blocks bookkeeper 409", lockedRun.status === 409, await lockedRun.json());
    const lockedManual = await fetch(`${base}/gl/journal/manual`, {
      method: "POST", headers: hdrs,
      body: JSON.stringify({ entityId: entA, periodLabel: PERIOD, entryDate: "2020-01-21", memo: `${T} should fail`, currency: "USD", lines: [{ accountCode: "1000", debit: 10 }, { accountCode: "3000", credit: 10 }] }),
    });
    check("locked period blocks manual journal 409", lockedManual.status === 409, await lockedManual.json());

    // 9) role gate: restricted persona gets 403
    const forb = await fetch(`${base}/gl/journal`, { headers: { cookie: "atelier_persona=__nonexistent", "content-type": "application/json" } });
    check("no persona rejected", forb.status === 401 || forb.status === 403, forb.status);
  } finally {
    // cleanup — tracked ids then tag-pattern sweep
    const entries = await db.select({ id: atelierGlJournalEntry.id }).from(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.periodLabel, PERIOD));
    const eIds = entries.map(e => e.id);
    if (eIds.length) await db.delete(atelierGlJournalLine).where(inArray(atelierGlJournalLine.journalEntryId, eIds));
    await db.delete(atelierGlJournalEntry).where(eq(atelierGlJournalEntry.periodLabel, PERIOD));
    await db.delete(atelierGlPostingException).where(eq(atelierGlPostingException.periodLabel, PERIOD));
    await db.delete(atelierPeriodCloseLock).where(eq(atelierPeriodCloseLock.periodLabel, PERIOD));
    if (entIds.length) await db.delete(atelierGlAccount).where(inArray(atelierGlAccount.legalEntityId, entIds));
    await db.delete(atelierInvoice).where(like(atelierInvoice.invoiceNumber, `${T}%`));
    await db.delete(atelierExpenses).where(like(atelierExpenses.merchant, `${T}%`));
    for (const id of entIds) {
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.entityId, id));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, id));
    }
    await db.delete(atelierLegalEntities).where(like(atelierLegalEntities.legalNameEn, `${T}%`));
    server.close();
  }
  console.log(fails === 0 ? "ALL PASS" : `${fails} FAILURES`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error("PROBE_ERR", e); process.exit(1); });
