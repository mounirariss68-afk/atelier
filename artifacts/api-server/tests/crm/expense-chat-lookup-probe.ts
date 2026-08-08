/**
 * Task #787 — chat finds expenses by merchant, not just IDs.
 *
 * Pins, at capability level on a scratch DB:
 *   1. submit_my_expense with several drafts and no id → ranked candidate
 *      disambiguation (merchant, amount, date), never raw multiple_drafts.
 *   2. q="uber" resolves the single matching draft (descriptive hit →
 *      two-phase preview) despite other drafts existing.
 *   3. q matching several drafts → ranked options; q matching none →
 *      nearest-merchant candidates from the caller's own drafts.
 *   4. Unknown expenseId → own-draft candidates (navigateTo:null) instead
 *      of a terse code; no drafts at all → friendly next-step copy.
 *   5. expense_list q hit filters by merchant/description; q miss returns
 *      nearest-merchant suggestions; unknown category names the caller's
 *      real categories.
 *   6. Self-scope: another user's drafts never show up as candidates.
 *
 * Run: NODE_ENV=test pnpm exec tsx tests/crm/expense-chat-lookup-probe.ts
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

const TAG = `probe787_${Date.now()}`;
const ORG = "aico";

async function main() {
  const D = (await import("@workspace/db")) as any;
  const { db, pool, atelierUsers, atelierExpenses } = D;
  const { eq, inArray } = await import("drizzle-orm");
  await import("../../src/lib/atelier-cli/people-read-capabilities.js");
  await import("../../src/lib/atelier-cli/me-write-capabilities.js");
  const { findByToolName } = await import("../../src/lib/atelier-cli/capability-catalog.js");

  const IDS = {
    me: `u_${TAG}_me`,
    other: `u_${TAG}_other`,
    e1: `exp_${TAG}_uber`,
    e2: `exp_${TAG}_marriott`,
    e3: `exp_${TAG}_marina`,
    eOther: `exp_${TAG}_other`,
  };
  const ctx = { persona: { id: IDS.me, orgId: ORG, role: "founding_partner", name: "Probe Me" } } as any;

  const exp = (id: string, personId: string, merchant: string, amount: number, date: string, status = "draft") => ({
    id,
    orgId: ORG,
    personId,
    personType: "employee",
    expenseDate: date,
    captureSource: "manual",
    merchant,
    description: null,
    category: "transport",
    amount,
    currency: "AED",
    usdAmount: amount / 3.67,
    status,
  });

  try {
    await db
      .insert(atelierUsers)
      .values([
        {
          id: IDS.me,
          orgId: ORG,
          email: `${TAG}.me@cognirise.ai`,
          name: "Probe Me",
          initials: "PM",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
        {
          id: IDS.other,
          orgId: ORG,
          email: `${TAG}.other@cognirise.ai`,
          name: "Probe Other",
          initials: "PO",
          role: "founding_partner",
          roleLabel: "Founding Partner",
          title: "Founding Partner",
          permissions: ["*"],
        },
      ] as any)
      .onConflictDoNothing();
    await db
      .insert(atelierExpenses)
      .values([
        exp(IDS.e1, IDS.me, "Uber", 45, "2026-08-01"),
        exp(IDS.e2, IDS.me, "Marriott Hotel", 900, "2026-08-03"),
        exp(IDS.e3, IDS.me, "Marina Restaurant", 220, "2026-08-05"),
        exp(IDS.eOther, IDS.other, "Uber Eats", 60, "2026-08-02"),
      ] as any)
      .onConflictDoNothing();

    const submit = findByToolName("submit_my_expense")!;
    const list = findByToolName("expense_list")!;

    // 1 — multiple drafts, no id → ranked disambiguation, not raw error
    const multi: any = await submit.run({}, ctx);
    check(
      "787: multiple drafts → ranked candidate options (no multiple_drafts error)",
      multi?.ok === true &&
        multi?.errorCode === undefined &&
        multi?.disambiguation?.field === "expenseId" &&
        Array.isArray(multi?.disambiguation?.options) &&
        multi.disambiguation.options.length === 3 &&
        multi?.data?.navigateTo === null,
      JSON.stringify(multi).slice(0, 400),
    );
    const optStr = JSON.stringify(multi?.disambiguation?.options ?? []);
    check(
      "787: options carry merchant, amount and date",
      optStr.includes("Uber") && optStr.includes("45.00") && optStr.includes("2026-08-01"),
      optStr.slice(0, 300),
    );
    check("787: no cross-user rows in candidates", !optStr.includes("Uber Eats"), optStr.slice(0, 300));

    // 2 — descriptive hit: q="uber" → straight to the two-phase preview
    const hit: any = await submit.run({ q: "uber" }, ctx);
    check(
      "787: q='uber' resolves the draft → two-phase preview",
      hit?.ok === true && hit?.confirmation?.pending?.input?.expenseId === IDS.e1,
      JSON.stringify(hit).slice(0, 400),
    );

    // 3a — q matching several drafts → ranked options
    const mar: any = await submit.run({ q: "mar" }, ctx);
    const marOpts = mar?.disambiguation?.options ?? [];
    check(
      "787: q matching several drafts → ranked disambiguation",
      mar?.ok === true && marOpts.length === 2 && !JSON.stringify(marOpts).includes("Uber"),
      JSON.stringify(mar).slice(0, 400),
    );

    // 3b — q matching none → nearest-merchant candidates from own drafts
    const near: any = await submit.run({ q: "Marriot" }, ctx); // near-typo still lands somewhere friendly
    const nofit: any = await submit.run({ q: "Ubr" }, ctx); // no substring hit → nearest candidates
    check(
      "787: q with no text match → nearest-merchant candidates, friendly prompt",
      nofit?.ok === true &&
        /did you mean/i.test(String(nofit?.data?.prompt ?? "")) &&
        Array.isArray(nofit?.disambiguation?.options) &&
        nofit.disambiguation.options.length > 0,
      JSON.stringify(nofit).slice(0, 400),
    );
    check("787: near variant also friendly", near?.ok === true, JSON.stringify(near).slice(0, 200));

    // 4a — unknown id → own-draft candidates
    const badId: any = await submit.run({ expenseId: "exp_nope" }, ctx);
    check(
      "787: unknown expenseId → own-draft candidates with navigateTo:null",
      badId?.ok === true &&
        badId?.data?.navigateTo === null &&
        (badId?.disambiguation?.options ?? []).length === 3,
      JSON.stringify(badId).slice(0, 400),
    );

    // 4b — no drafts at all → friendly next step
    const empty: any = await submit.run({}, {
      persona: { id: IDS.other, orgId: ORG, role: "founding_partner", name: "Probe Other" },
    } as any);
    // (other user has one draft "Uber Eats" → single-draft fast path; test
    // the true-empty case after submitting it away)
    await db
      .update(atelierExpenses)
      .set({ status: "submitted" })
      .where(eq(atelierExpenses.id, IDS.eOther));
    const empty2: any = await submit.run({}, {
      persona: { id: IDS.other, orgId: ORG, role: "founding_partner", name: "Probe Other" },
    } as any);
    check(
      "787: single draft still auto-resolves (fast path intact)",
      empty?.ok === true && empty?.confirmation?.pending?.input?.expenseId === IDS.eOther,
      JSON.stringify(empty).slice(0, 300),
    );
    check(
      "787: no drafts → friendly copy with a concrete next step",
      empty2?.ok === false &&
        empty2?.errorCode === "no_draft_expense" &&
        /tell me the amount and merchant/i.test(String(empty2?.errorMessage ?? "")),
      JSON.stringify(empty2).slice(0, 300),
    );

    // 5a — expense_list q hit
    const lh: any = await list.run({ q: "marriott" }, ctx);
    check(
      "787: expense_list q hit filters to the merchant",
      lh?.ok === true && lh?.data?.total === 1 && lh?.data?.items?.[0]?.id === IDS.e2,
      JSON.stringify(lh).slice(0, 300),
    );

    // 5b — expense_list q miss → nearest suggestions
    const lm: any = await list.run({ q: "Marriot Hotle" }, ctx);
    const lmAny: any = await list.run({ q: "zzzz-no-such" }, ctx);
    check(
      "787: expense_list q miss → nearest-merchant suggestions + honest note",
      lm?.ok === true &&
        (lm?.data?.items ?? []).length === 0 &&
        (lm?.data?.suggestions ?? []).some((s: any) => s.id === IDS.e2) &&
        /none of your expenses/i.test(String(lm?.data?.note ?? "")),
      JSON.stringify(lm).slice(0, 400),
    );
    check(
      "787: expense_list garbage q stays honest (no fabricated matches)",
      lmAny?.ok === true && (lmAny?.data?.items ?? []).length === 0,
      JSON.stringify(lmAny).slice(0, 300),
    );

    // 5c — unknown category → names the caller's real categories
    const lc: any = await list.run({ category: "taxi rides" }, ctx);
    check(
      "787: unknown category → lists the caller's actual categories",
      lc?.ok === true &&
        lc?.data?.total === 0 &&
        /transport/.test(String(lc?.data?.note ?? "")),
      JSON.stringify(lc).slice(0, 300),
    );
  } finally {
    try {
      await db
        .delete(atelierExpenses)
        .where(inArray(atelierExpenses.id, [IDS.e1, IDS.e2, IDS.e3, IDS.eOther]));
      await db.delete(atelierUsers).where(inArray(atelierUsers.id, [IDS.me, IDS.other]));
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
