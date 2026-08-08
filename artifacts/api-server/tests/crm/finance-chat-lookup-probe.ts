/**
 * Task #789 — chat finds invoices and deals by name, not raw IDs.
 *
 * Pins, at capability level on a scratch DB:
 *   1. wallet_dunning_send_next q="<account>" resolves the account's
 *      overdue issued invoice → two-phase confirm preview (no raw id).
 *   2. q matching several overdue invoices → ranked disambiguation on
 *      invoiceId with navigateTo:null; q matching nothing → friendly
 *      copy with a next step (never a raw not_found string alone).
 *   3. Missing both invoiceId and q → friendly ask, not a schema error.
 *   4. wallet_dunning_next_action q narrows the list; unknown name →
 *      ok:true with a friendly note and no actions.
 *   5. winloss_debrief_by_opportunity: ambiguous name → standard ranked
 *      disambiguation (no comma-joined "ambiguous" code); near-miss →
 *      did-you-mean candidates; total miss → friendly copy.
 *   6. renewal_create / invoice_create accept account (name); ambiguous →
 *      disambiguation on accountId; unique name → row created with the
 *      resolved accountId.
 *   7. ACL parity: restricted persona still refused on dunning verbs.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/finance-chat-lookup-probe.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";

import "./scratch-db.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
}

const TAG = `probe789_${Date.now()}`;
const ORG = "aico";

async function main() {
  const D = (await import("@workspace/db")) as any;
  const {
    db, pool, atelierUsers, atelierAccounts, atelierInvoice,
    atelierDunningLadder, atelierOpportunities, atelierWinLossDebriefs,
    atelierRenewal, atelierDunningEvent,
  } = D;
  const { eq, inArray } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/l2c-wave3-capabilities.js");
  await import("../../src/lib/atelier-cli/finance-ops-capabilities.js");
  await import("../../src/lib/atelier-cli/coverage-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    me: `u_${TAG}_me`,
    acct1: `acc_${TAG}_tasama`,
    acct2: `acc_${TAG}_tadawulmain`,
    acct3: `acc_${TAG}_tadawulgroup`,
    acct4: `acc_${TAG}_quantum`,
    inv1: `inv_${TAG}_tasama`,
    inv2: `inv_${TAG}_tadmain`,
    inv3: `inv_${TAG}_tadgrp`,
    inv4: `inv_${TAG}_billto`,
    ladder: `lad_${TAG}`,
    opp1: `opp_${TAG}_falcon`,
    opp2: `opp_${TAG}_falconx`,
    opp3: `opp_${TAG}_orion`,
    deb: `deb_${TAG}`,
  };
  const ctx = { persona: { id: IDS.me, orgId: ORG, role: "founding_partner", name: "Probe FP" } } as any;
  const restricted = { persona: { id: IDS.me, orgId: ORG, role: "contractor", name: "Probe R" } } as any;
  const created: { renewals: string[]; invoices: string[] } = { renewals: [], invoices: [] };

  const pastDue = new Date(Date.now() - 40 * 86400_000).toISOString().slice(0, 10);

  try {
    await db.insert(atelierUsers).values([
      { id: IDS.me, orgId: ORG, email: `${TAG}.me@cognirise.ai`, name: "Probe FP", initials: "PF", role: "founding_partner", roleLabel: "Founding Partner", title: "Founding Partner" },
    ]);
    await db.insert(atelierAccounts).values([
      { id: IDS.acct1, orgId: ORG, name: `Tasama Holdings ${TAG}`, country: "AE", sector: "financial_services", tier: "A", status: "active" },
      { id: IDS.acct2, orgId: ORG, name: `Tadawul Mainline ${TAG}`, country: "SA", sector: "financial_services", tier: "A", status: "active" },
      { id: IDS.acct3, orgId: ORG, name: `Tadawul Group ${TAG}`, country: "SA", sector: "financial_services", tier: "B", status: "active" },
      { id: IDS.acct4, orgId: ORG, name: `Quantum Ventures ${TAG}`, country: "AE", sector: "technology", tier: "B", status: "active" },
    ]);
    await db.insert(atelierDunningLadder).values([
      { id: IDS.ladder, orgId: ORG, name: `Default ${TAG}`, jurisdiction: "AE", isDefault: true, steps: [{ offsetDays: 7, channel: "email", template: "gentle-reminder", requireApproval: false }] },
    ]);
    await db.insert(atelierInvoice).values([
      { id: IDS.inv1, orgId: ORG, accountId: IDS.acct1, jurisdiction: "AE", invoiceNumber: `INV-${TAG}-001`, currency: "AED", status: "issued", billTo: { name: `Tasama Holdings ${TAG}` }, subtotal: 100, total: 105, amountPaid: 0, dueDate: pastDue },
      { id: IDS.inv2, orgId: ORG, accountId: IDS.acct2, jurisdiction: "AE", invoiceNumber: `INV-${TAG}-002`, currency: "AED", status: "issued", billTo: { name: `Tadawul Mainline ${TAG}` }, subtotal: 200, total: 210, amountPaid: 0, dueDate: pastDue },
      { id: IDS.inv3, orgId: ORG, accountId: IDS.acct3, jurisdiction: "AE", invoiceNumber: `INV-${TAG}-003`, currency: "AED", status: "issued", billTo: { name: `Tadawul Group ${TAG}` }, subtotal: 300, total: 315, amountPaid: 0, dueDate: pastDue },
      // Bill-to differs from the live account name — must be findable by BOTH.
      { id: IDS.inv4, orgId: ORG, accountId: IDS.acct4, jurisdiction: "AE", invoiceNumber: `INV-${TAG}-004`, currency: "AED", status: "issued", billTo: { name: `Meridian Billing FZ ${TAG}` }, subtotal: 50, total: 52, amountPaid: 0, dueDate: pastDue },
    ]);
    await db.insert(atelierOpportunities).values([
      { id: IDS.opp1, orgId: ORG, slug: `falcon-${TAG}`, name: `Falcon Transformation ${TAG}`, accountId: IDS.acct1, salesStage: "lost", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, dealSizeHypothesis: 100000, probabilityPct: 10, nextMilestone: "debrief", sourceLead: "probe" },
      { id: IDS.opp2, orgId: ORG, slug: `falconx-${TAG}`, name: `Falcon Expansion ${TAG}`, accountId: IDS.acct2, salesStage: "prospect", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, dealSizeHypothesis: 100000, probabilityPct: 30, nextMilestone: "meet", sourceLead: "probe" },
      { id: IDS.opp3, orgId: ORG, slug: `orion-${TAG}`, name: `Orion Modernisation ${TAG}`, accountId: IDS.acct3, salesStage: "prospect", partnerOwnerId: IDS.me, engagementLeadId: IDS.me, dealSizeHypothesis: 100000, probabilityPct: 30, nextMilestone: "meet", sourceLead: "probe" },
    ]);
    await db.insert(atelierWinLossDebriefs).values([
      { id: IDS.deb, orgId: ORG, opportunityId: IDS.opp1, outcome: "lost_to_competitor", status: "final", sellerPerceivedReasons: ["price"] },
    ]);

    const dunSend = findByToolName("wallet_dunning_send_next")!;
    const dunNext = findByToolName("wallet_dunning_next_action")!;
    const debrief = findByToolName("winloss_debrief_by_opportunity")!;
    const renewalCreate = findByToolName("renewal_create")!;
    const invoiceCreate = findByToolName("invoice_create")!;

    // 1 — unique account name → two-phase preview
    const uniq: any = await dunSend.run({ q: "Tasama" }, ctx);
    check(
      "789: dunning by unique client name → confirm preview on the right invoice",
      uniq?.ok === true && !!uniq?.confirmation && JSON.stringify(uniq).includes(`INV-${TAG}-001`),
      JSON.stringify(uniq).slice(0, 300),
    );

    // 2a — ambiguous client name → ranked disambiguation
    const amb: any = await dunSend.run({ q: "Tadawul" }, ctx);
    const ambOpts = amb?.disambiguation?.options ?? [];
    check(
      "789: ambiguous client → ranked disambiguation on invoiceId, navigateTo:null",
      amb?.ok === true &&
        amb?.disambiguation?.field === "invoiceId" &&
        ambOpts.length === 2 &&
        ambOpts.every((o: any) => [IDS.inv2, IDS.inv3].includes(o.id)) &&
        amb?.data?.navigateTo === null,
      JSON.stringify(amb).slice(0, 300),
    );

    // 2b — total miss → friendly copy with next step, no raw code text
    const miss: any = await dunSend.run({ q: "Zzquine Industries" }, ctx);
    check(
      "789: unknown client → friendly miss with a next step",
      miss?.ok === false && /collections action|invoice/i.test(String(miss?.errorMessage ?? "")) && !/not_found|not-found/.test(String(miss?.errorMessage ?? "")),
      JSON.stringify(miss).slice(0, 300),
    );

    // 2c — bill-to name differs from account name: findable by BOTH
    const byBillTo: any = await dunSend.run({ q: "Meridian Billing" }, ctx);
    check(
      "789: bill-to name (differs from account) resolves the invoice",
      byBillTo?.ok === true && !!byBillTo?.confirmation && JSON.stringify(byBillTo).includes(`INV-${TAG}-004`),
      JSON.stringify(byBillTo).slice(0, 300),
    );
    const byAcctName: any = await dunSend.run({ q: "Quantum Ventures" }, ctx);
    check(
      "789: same invoice also findable by its live account name",
      byAcctName?.ok === true && !!byAcctName?.confirmation && JSON.stringify(byAcctName).includes(`INV-${TAG}-004`),
      JSON.stringify(byAcctName).slice(0, 300),
    );

    // 3 — neither id nor q → friendly ask
    const askWhich: any = await dunSend.run({}, ctx);
    check(
      "789: no id and no name → friendly ask for the client or invoice number",
      askWhich?.ok === false && /which invoice|client/i.test(String(askWhich?.errorMessage ?? "")),
      JSON.stringify(askWhich).slice(0, 200),
    );

    // 4 — next_action q narrows; unknown → honest empty with note
    const nextNarrow: any = await dunNext.run({ q: "Tasama" }, ctx);
    const acts = nextNarrow?.data?.nextActions ?? [];
    check(
      "789: next_action narrows to the named client's invoices",
      nextNarrow?.ok === true && acts.length === 1 && acts[0].invoiceId === IDS.inv1,
      JSON.stringify(nextNarrow).slice(0, 300),
    );
    const nextAmb: any = await dunNext.run({ q: "Tadawul" }, ctx);
    check(
      "789: next_action ambiguous name → asks, returns no actions",
      nextAmb?.ok === true &&
        nextAmb?.disambiguation?.field === "invoiceId" &&
        (nextAmb?.disambiguation?.options ?? []).length === 2 &&
        (nextAmb?.data?.nextActions ?? []).length === 0,
      JSON.stringify(nextAmb).slice(0, 300),
    );
    const nextTypo: any = await dunNext.run({ q: "Tasma" }, ctx);
    check(
      "789: next_action typo/near-miss → asks with did-you-mean, no actions",
      nextTypo?.ok === true &&
        (nextTypo?.disambiguation?.options ?? []).some((o: any) => o.id === IDS.inv1) &&
        (nextTypo?.data?.nextActions ?? []).length === 0,
      JSON.stringify(nextTypo).slice(0, 300),
    );
    const nextMiss: any = await dunNext.run({ q: "Zzquine Industries" }, ctx);
    check(
      "789: next_action unknown name → ok with friendly note, no actions",
      nextMiss?.ok === true && (nextMiss?.data?.nextActions ?? []).length === 0 && typeof nextMiss?.data?.note === "string",
      JSON.stringify(nextMiss).slice(0, 300),
    );

    // 5a — ambiguous opportunity → standard disambiguation
    const dAmb: any = await debrief.run({ opportunity: "Falcon" }, ctx);
    const dOpts = dAmb?.disambiguation?.options ?? [];
    check(
      "789: ambiguous deal name → ranked disambiguation (no comma-joined ambiguous code)",
      dAmb?.ok === true && dAmb?.disambiguation?.field === "opportunity" && dOpts.length === 2 && dAmb?.errorCode === undefined,
      JSON.stringify(dAmb).slice(0, 300),
    );
    // 5b — option id round-trips as the tool-input value
    const dPick: any = await debrief.run({ opportunity: IDS.opp1 }, ctx);
    check(
      "789: picked option id resolves straight to the debrief",
      dPick?.ok === true && JSON.stringify(dPick).includes("lost_to_competitor"),
      JSON.stringify(dPick).slice(0, 300),
    );
    // 5c — near-miss name → did-you-mean candidates
    const dNear: any = await debrief.run({ opportunity: "Orin Modernisation" }, ctx);
    check(
      "789: near-miss deal name → did-you-mean candidates",
      dNear?.ok === true && (dNear?.disambiguation?.options ?? []).some((o: any) => o.id === IDS.opp3),
      JSON.stringify(dNear).slice(0, 300),
    );
    // 5d — total miss → friendly copy
    const dMiss: any = await debrief.run({ opportunity: "zz-no-such-opp-789-zz" }, ctx);
    check(
      "789: unknown deal → friendly miss naming a next step",
      dMiss?.ok === false && /list opportunities|pipeline/i.test(String(dMiss?.errorMessage ?? "")),
      JSON.stringify(dMiss).slice(0, 300),
    );

    // 6a — renewal by ambiguous account name → disambiguation on accountId
    const rAmb: any = await renewalCreate.run({ account: "Tadawul", confirm: true }, ctx);
    check(
      "789: renewal by ambiguous client name → disambiguation on accountId",
      rAmb?.ok === true && rAmb?.disambiguation?.field === "accountId" && (rAmb?.disambiguation?.options ?? []).length === 2 && rAmb?.data?.navigateTo === null,
      JSON.stringify(rAmb).slice(0, 300),
    );
    // 6b — unique name → created with resolved accountId
    const rOk: any = await renewalCreate.run({ account: "Tasama", confirm: true }, ctx);
    if (rOk?.data?.id) created.renewals.push(rOk.data.id);
    let renewalRow: any = null;
    if (rOk?.data?.id) {
      [renewalRow] = await db.select().from(atelierRenewal).where(eq(atelierRenewal.id, rOk.data.id));
    }
    check(
      "789: renewal by unique client name → row created with resolved accountId",
      rOk?.ok === true && renewalRow?.accountId === IDS.acct1,
      JSON.stringify({ rOk, renewalRow }).slice(0, 300),
    );
    // 6c — no account at all → friendly ask
    const rNone: any = await renewalCreate.run({ confirm: true }, ctx);
    check(
      "789: renewal without client → friendly ask, not a schema error",
      rNone?.ok === false && /which client/i.test(String(rNone?.errorMessage ?? "")),
      JSON.stringify(rNone).slice(0, 200),
    );
    // 6d — invoice_create by unique account name
    const iOk: any = await invoiceCreate.run({ jurisdiction: "AE", currency: "AED", account: "Tasama", confirm: true }, ctx);
    if (iOk?.data?.id) created.invoices.push(iOk.data.id);
    let invRow: any = null;
    if (iOk?.data?.id) {
      [invRow] = await db.select().from(atelierInvoice).where(eq(atelierInvoice.id, iOk.data.id));
    }
    check(
      "789: invoice_create by client name → draft carries resolved accountId",
      iOk?.ok === true && invRow?.accountId === IDS.acct1,
      JSON.stringify({ iOk, invRow }).slice(0, 300),
    );

    // 7 — ACL parity: restricted persona refused before any resolution
    const denied: any = await dunSend.run({ q: "Tasama" }, restricted);
    check(
      "789: restricted persona still refused on dunning",
      denied?.ok === false && !JSON.stringify(denied).includes(IDS.inv1),
      JSON.stringify(denied).slice(0, 200),
    );
  } finally {
    try {
      await db.delete(atelierDunningEvent).where(inArray(atelierDunningEvent.invoiceId, [IDS.inv1, IDS.inv2, IDS.inv3, IDS.inv4]));
      if (created.renewals.length) await db.delete(atelierRenewal).where(inArray(atelierRenewal.id, created.renewals));
      await db.delete(atelierInvoice).where(inArray(atelierInvoice.id, [IDS.inv1, IDS.inv2, IDS.inv3, IDS.inv4, ...created.invoices]));
      await db.delete(atelierDunningLadder).where(eq(atelierDunningLadder.id, IDS.ladder));
      await db.delete(atelierWinLossDebriefs).where(eq(atelierWinLossDebriefs.id, IDS.deb));
      await db.delete(atelierOpportunities).where(inArray(atelierOpportunities.id, [IDS.opp1, IDS.opp2, IDS.opp3]));
      await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [IDS.acct1, IDS.acct2, IDS.acct3, IDS.acct4]));
      await db.delete(atelierUsers).where(eq(atelierUsers.id, IDS.me));
    } finally {
      await pool.end();
    }
  }

  if (failures > 0) {
    console.error(`\nFAILURES: ${failures}`);
    process.exit(1);
  }
  console.log("\nALL PASS");
}

main().catch((e) => {
  console.error("Probe crashed:", e);
  process.exit(1);
});
