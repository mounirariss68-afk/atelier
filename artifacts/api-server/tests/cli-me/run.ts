/**
 * Task #405 — Identity-locked Me-lens CLI capabilities probe.
 *
 * Runs standalone (tsx ./tests/cli-me/run.ts) against an isolated
 * scratch database (no fallback to the live DB). Exercises the ten
 * self-service read tools registered in
 * src/lib/atelier-cli/me-capabilities.ts (Task #421 added expenses +
 * timesheet history and fixed timesheet.current's keying):
 *
 *   1. Catalog surface: all 10 tools registered, read-only, with EMPTY
 *      locked input schemas (additionalProperties:false) — the model
 *      has no argument through which to name another subject.
 *   2. Persona gating: employee + contractor personas see all 10;
 *      board_observer sees none (roster module is outside its
 *      meta/raid perimeter).
 *   3. Identity lock / prompt-injection: calling every tool with
 *      hostile inputs ({ userId, personId, email } of ANOTHER user)
 *      still returns only the caller's own rows.
 *   4. Employee data paths: leave balance + requests, published-only
 *      payslips (unpublished + other-person docs excluded, download
 *      href only — no bytes), own contract via employee userId link,
 *      released-only reviews with hrNotes NEVER serialized, goals,
 *      audience-filtered learning, own unread notifications only.
 *   5. Contractor variants: reviews/goals answer applicable:false with
 *      a friendly note (ok:true, not an error), learning shows
 *      all+contractors audience, pay shows remittances.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_UID = `p_test_meemp_${STAMP}`;
const CON_UID = `p_test_mecon_${STAMP}`;
const OTHER_UID = `p_test_meother_${STAMP}`;
const BOARD_UID = `p_test_meboard_${STAMP}`;
const EMP_PERSON = `emp_test_me_${STAMP}`;
const OTHER_PERSON = `emp_test_meother_${STAMP}`;
const CON_PERSON = `ctr_test_me_${STAMP}`;
const TAG = `__t405_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}
function group(title: string): void {
  console.log(`\n\u2500\u2500 ${title}`);
}

/** Hostile model-side arguments a prompt-injected turn might pass. */
function hostileInput(targetUserId: string, targetPersonId: string) {
  return {
    userId: targetUserId,
    personId: targetPersonId,
    email: "other@example.com",
    forUser: targetUserId,
    subject: targetUserId,
  } as Record<string, unknown>;
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    pool,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierLeaveRequests,
    atelierPayDocuments,
    atelierContractRecords,
    atelierSelfNotifications,
    atelierPerformanceReviews,
    atelierPerformanceGoals,
    atelierTrainingMaterials,
    atelierTrainingCompletions,
    atelierExpenses,
    atelierTimesheetWeeks,
  } = D as any;

  const catalog = await import(
    "../../src/lib/atelier-cli/capability-catalog.js"
  );
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { capabilitiesForPersona, findByToolName, listCapabilities } = catalog;

  const TOOLS = [
    "my_profile",
    "my_leave",
    "my_pay_documents",
    "my_contracts",
    "my_reviews",
    "my_goals",
    "my_learning",
    "my_notifications",
    "my_expenses",
    "my_timesheets",
  ];

  const empPersona = { id: EMP_UID, name: "Me Emp", role: "employee", orgId: ORG };
  const conPersona = { id: CON_UID, name: "Me Con", role: "contractor", orgId: ORG };
  const boardPersona = { id: BOARD_UID, name: "Me Board", role: "board_observer", orgId: ORG };

  const runTool = async (
    toolName: string,
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown> = {},
  ) => {
    const entry = findByToolName(toolName);
    if (!entry) throw new Error(`tool ${toolName} not registered`);
    return entry.run(input, { persona } as any);
  };

  try {
    // ---------------- seed -------------------------------------------
    const users = [
      { id: EMP_UID, role: "employee", roleLabel: "Employee", name: `Me Emp ${TAG}`, email: `meemp${STAMP}@test.local` },
      { id: CON_UID, role: "contractor", roleLabel: "Contractor", name: `Me Con ${TAG}`, email: `mecon${STAMP}@test.local` },
      { id: OTHER_UID, role: "employee", roleLabel: "Employee", name: `Me Other ${TAG}`, email: `meother${STAMP}@test.local` },
      { id: BOARD_UID, role: "board_observer", roleLabel: "Board Observer", name: `Me Board ${TAG}`, email: `meboard${STAMP}@test.local` },
    ];
    for (const u of users) {
      await db.insert(atelierUsers).values({
        id: u.id,
        orgId: ORG,
        email: u.email,
        name: u.name,
        initials: "MT",
        role: u.role,
        roleLabel: u.roleLabel,
        title: "Test Persona",
      });
    }
    await db.insert(atelierEmployees).values([
      {
        id: EMP_PERSON,
        orgId: ORG,
        userId: EMP_UID,
        fullName: `Me Emp ${TAG}`,
        email: `meemp${STAMP}@test.local`,
        role: "employee",
        title: "Consultant",
        startDate: "2024-01-15",
      },
      {
        id: OTHER_PERSON,
        orgId: ORG,
        userId: OTHER_UID,
        fullName: `Me Other ${TAG}`,
        email: `meother${STAMP}@test.local`,
        role: "employee",
      },
    ]);
    await db.insert(atelierContractors).values({
      id: CON_PERSON,
      orgId: ORG,
      fullName: `Me Con ${TAG}`,
      email: `mecon${STAMP}@test.local`,
    });

    await db.insert(atelierLeaveRequests).values({
      id: `lr_${TAG}_a`,
      orgId: ORG,
      userId: EMP_UID,
      personId: EMP_PERSON,
      personType: "employee",
      leaveType: "annual",
      startDate: `${new Date().getUTCFullYear()}-02-02`,
      endDate: `${new Date().getUTCFullYear()}-02-06`,
      workingDays: 5,
      status: "approved",
      createdByUserId: EMP_UID,
    });

    await db.insert(atelierPayDocuments).values([
      {
        id: `pd_${TAG}_pub`,
        orgId: ORG,
        personType: "employee",
        personId: EMP_PERSON,
        category: "payslip",
        title: `Payslip Jan ${TAG}`,
        periodDate: "2026-01",
        published: true,
        publishedAt: new Date(),
        fileName: "payslip-jan.pdf",
        fileData: "JVBERi0xLjQ=",
      },
      {
        id: `pd_${TAG}_draft`,
        orgId: ORG,
        personType: "employee",
        personId: EMP_PERSON,
        category: "payslip",
        title: `Payslip Feb UNPUBLISHED ${TAG}`,
        periodDate: "2026-02",
        published: false,
        fileName: "payslip-feb.pdf",
        fileData: "JVBERi0xLjQ=",
      },
      {
        id: `pd_${TAG}_other`,
        orgId: ORG,
        personType: "employee",
        personId: OTHER_PERSON,
        category: "payslip",
        title: `Payslip OTHER ${TAG}`,
        periodDate: "2026-01",
        published: true,
        publishedAt: new Date(),
        fileName: "payslip-other.pdf",
        fileData: "JVBERi0xLjQ=",
      },
      {
        id: `pd_${TAG}_con`,
        orgId: ORG,
        personType: "contractor",
        personId: CON_PERSON,
        category: "remittance",
        title: `Remittance Jan ${TAG}`,
        periodDate: "2026-01",
        published: true,
        publishedAt: new Date(),
        fileName: "remit-jan.pdf",
        fileData: "JVBERi0xLjQ=",
      },
    ]);

    await db.insert(atelierContractRecords).values([
      {
        id: `ctr_${TAG}_mine`,
        orgId: ORG,
        title: `Employment Contract ${TAG}`,
        counterpartyKind: "person",
        personId: EMP_PERSON,
        counterpartyLabel: `Me Emp ${TAG}`,
        status: "signed",
        ownerUserId: OTHER_UID,
      },
      {
        id: `ctr_${TAG}_other`,
        orgId: ORG,
        title: `Employment Contract OTHER ${TAG}`,
        counterpartyKind: "person",
        personId: OTHER_PERSON,
        counterpartyLabel: `Me Other ${TAG}`,
        status: "signed",
        ownerUserId: OTHER_UID,
      },
    ]);

    await db.insert(atelierPerformanceReviews).values([
      {
        id: `rev_${TAG}_rel`,
        orgId: ORG,
        employeeId: EMP_PERSON,
        cycle: "FY26 H1",
        managerRating: "meets",
        strengths: "Great client presence",
        hrNotes: `SECRET-HR-NOTE-${TAG}`,
        status: "released",
        releasedAt: new Date(),
      },
      {
        id: `rev_${TAG}_draft`,
        orgId: ORG,
        employeeId: EMP_PERSON,
        cycle: "FY26 H2 DRAFT",
        hrNotes: `SECRET-HR-NOTE-DRAFT-${TAG}`,
        status: "draft",
      },
    ]);
    await db.insert(atelierPerformanceGoals).values({
      id: `goal_${TAG}_a`,
      orgId: ORG,
      employeeId: EMP_PERSON,
      cycle: "FY26 H1",
      title: `Grow KSA pipeline ${TAG}`,
      weightPct: 40,
    });

    await db.insert(atelierTrainingMaterials).values([
      { id: `tm_${TAG}_all`, orgId: ORG, title: `Security 101 ${TAG}`, kind: "link", url: "https://example.com", audience: "all" },
      { id: `tm_${TAG}_emp`, orgId: ORG, title: `Employee Onboarding ${TAG}`, kind: "link", url: "https://example.com", audience: "employees" },
      { id: `tm_${TAG}_con`, orgId: ORG, title: `Contractor Compliance ${TAG}`, kind: "link", url: "https://example.com", audience: "contractors" },
    ]);
    await db.insert(atelierTrainingCompletions).values({
      id: `tc_${TAG}_a`,
      orgId: ORG,
      materialId: `tm_${TAG}_all`,
      userId: EMP_UID,
    });

    // Task #421 — expenses key on the USER id; timesheets key on the
    // ROSTER person id. Seed decoys with the WRONG key on each table to
    // prove the tools respect the keying quirk.
    await db.insert(atelierExpenses).values([
      {
        id: `exp_${TAG}_mine`,
        orgId: ORG,
        personId: EMP_UID, // user id — correct key
        personType: "employee",
        expenseDate: "2026-07-01",
        captureSource: "manual",
        merchant: `Cafe Mine ${TAG}`,
        category: "meals",
        amount: 42,
        currency: "USD",
        usdAmount: 42,
        status: "reimbursed",
        policyStatus: "green",
        reimbursedAt: new Date(),
      },
      {
        id: `exp_${TAG}_wrongkey`,
        orgId: ORG,
        personId: EMP_PERSON, // roster id — must NOT match the user-id keying
        personType: "employee",
        expenseDate: "2026-07-02",
        captureSource: "manual",
        merchant: `Decoy RosterKeyed ${TAG}`,
        category: "meals",
        amount: 10,
        currency: "USD",
        usdAmount: 10,
        status: "draft",
      },
      {
        id: `exp_${TAG}_other`,
        orgId: ORG,
        personId: OTHER_UID,
        personType: "employee",
        expenseDate: "2026-07-03",
        captureSource: "manual",
        merchant: `OTHER user's expense ${TAG}`,
        category: "meals",
        amount: 99,
        currency: "USD",
        usdAmount: 99,
        status: "submitted",
      },
    ]);

    // Task #415: timesheet_current now targets the ACTUAL current ISO
    // week, so the "cur" fixture must be seeded dynamically instead of
    // hardcoding a week label that goes stale.
    const { isoWeekOf, parseWeekIso } = await import(
      "../../src/routes/atelier/ledgerRoutes.js"
    );
    const { weekIso: CUR_ISO, weekStart } = isoWeekOf(new Date());
    const CUR_START = weekStart.toISOString().slice(0, 10);
    const prevMonday = new Date(parseWeekIso(CUR_ISO));
    prevMonday.setUTCDate(prevMonday.getUTCDate() - 7);
    const { weekIso: PREV_ISO } = isoWeekOf(prevMonday);
    const PREV_START = prevMonday.toISOString().slice(0, 10);
    await db.insert(atelierTimesheetWeeks).values([
      {
        id: `tsw_${TAG}_cur`,
        orgId: ORG,
        personId: EMP_PERSON, // roster id — correct key
        personType: "employee",
        weekIso: CUR_ISO,
        weekStartDate: CUR_START,
        status: "draft",
        totalHours: 32,
        billableHours: 24,
      },
      {
        id: `tsw_${TAG}_prev`,
        orgId: ORG,
        personId: EMP_PERSON,
        personType: "employee",
        weekIso: PREV_ISO,
        weekStartDate: PREV_START,
        status: "partner_approved",
        totalHours: 40,
        billableHours: 36,
      },
      {
        id: `tsw_${TAG}_wrongkey`,
        orgId: ORG,
        personId: EMP_UID, // user id — the legacy timesheet.current bug key
        personType: "employee",
        weekIso: CUR_ISO,
        weekStartDate: CUR_START,
        status: "draft",
        totalHours: 1,
        billableHours: 1,
      },
      {
        id: `tsw_${TAG}_other`,
        orgId: ORG,
        personId: OTHER_PERSON,
        personType: "employee",
        weekIso: CUR_ISO,
        weekStartDate: CUR_START,
        status: "submitted",
        totalHours: 40,
        billableHours: 40,
      },
    ]);

    await db.insert(atelierSelfNotifications).values([
      { id: `sn_${TAG}_mine`, orgId: ORG, userId: EMP_UID, title: `Leave approved ${TAG}`, kind: "generic" },
      { id: `sn_${TAG}_read`, orgId: ORG, userId: EMP_UID, title: `Old dismissed ${TAG}`, kind: "generic", status: "dismissed" },
      { id: `sn_${TAG}_other`, orgId: ORG, userId: OTHER_UID, title: `OTHER user's ${TAG}`, kind: "generic" },
    ]);

    // ---------------- 1. catalog surface ------------------------------
    group("Catalog surface");
    for (const t of TOOLS) {
      const entry = findByToolName(t);
      check(`${t} registered`, Boolean(entry));
      if (!entry) continue;
      check(`${t} is read-only`, entry.isWrite === false && entry.twoPhaseConfirm === false);
      const schema = entry.inputSchema as Record<string, unknown>;
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      check(
        `${t} input schema locked (no properties, additionalProperties:false)`,
        Object.keys(props).length === 0 && schema.additionalProperties === false,
        JSON.stringify(schema),
      );
    }

    // ---------------- 2. persona gating -------------------------------
    group("Persona gating");
    const empTools = new Set(capabilitiesForPersona(empPersona).map((e: any) => e.toolName));
    const conTools = new Set(capabilitiesForPersona(conPersona).map((e: any) => e.toolName));
    const boardTools = new Set(capabilitiesForPersona(boardPersona).map((e: any) => e.toolName));
    check("employee sees all 10 me-tools", TOOLS.every((t) => empTools.has(t)));
    check("contractor sees all 10 me-tools", TOOLS.every((t) => conTools.has(t)));
    check("board_observer sees none of the me-tools", TOOLS.every((t) => !boardTools.has(t)));

    // ---------------- 3. identity lock (prompt injection) -------------
    group("Identity lock — hostile inputs are ignored");
    const hostile = hostileInput(OTHER_UID, OTHER_PERSON);

    const profile = await runTool("my_profile", empPersona, hostile);
    check("my_profile: ok", profile.ok === true);
    check("my_profile: returns the CALLER, not the injected user", (profile as any).data?.id === EMP_UID);

    const payInj = await runTool("my_pay_documents", empPersona, hostile);
    const payItems = (payInj as any).data?.items ?? [];
    check(
      "my_pay_documents: injected personId ignored — no other-person docs",
      payItems.every((i: any) => i.id !== `pd_${TAG}_other`),
      JSON.stringify(payItems.map((i: any) => i.id)),
    );

    const notifInj = await runTool("my_notifications", empPersona, hostile);
    const notifItems = (notifInj as any).data?.items ?? [];
    check(
      "my_notifications: injected userId ignored — only caller's rows",
      notifItems.some((i: any) => i.id === `sn_${TAG}_mine`) &&
        notifItems.every((i: any) => i.id !== `sn_${TAG}_other`),
    );

    const ctrInj = await runTool("my_contracts", empPersona, hostile);
    const ctrItems = (ctrInj as any).data?.items ?? [];
    check(
      "my_contracts: only the caller's own contract",
      ctrItems.some((i: any) => i.id === `ctr_${TAG}_mine`) &&
        ctrItems.every((i: any) => i.id !== `ctr_${TAG}_other`),
    );

    // ---------------- 4. employee data paths --------------------------
    group("Employee data paths");
    const leave = await runTool("my_leave", empPersona);
    check("my_leave: ok with balance", leave.ok === true && Boolean((leave as any).data?.balance));
    const leaveReqs = (leave as any).data?.requests ?? [];
    check("my_leave: lists own approved request", leaveReqs.some((r: any) => r.id === `lr_${TAG}_a`));
    check("my_leave: links to /me/time", (leave as any).data?.href === "/me/time");

    const pay = await runTool("my_pay_documents", empPersona);
    const payIds = ((pay as any).data?.items ?? []).map((i: any) => i.id);
    check("my_pay_documents: published payslip present", payIds.includes(`pd_${TAG}_pub`));
    check("my_pay_documents: UNPUBLISHED payslip excluded", !payIds.includes(`pd_${TAG}_draft`));
    check(
      "my_pay_documents: href is the ACL'd download route, no bytes in payload",
      ((pay as any).data?.items ?? []).every(
        (i: any) =>
          String(i.href).startsWith("/api/atelier/me/pay/documents/") &&
          !("fileData" in i),
      ) && !JSON.stringify(pay).includes("JVBERi0xLjQ="),
    );

    const reviews = await runTool("my_reviews", empPersona);
    const revItems = (reviews as any).data?.items ?? [];
    check("my_reviews: released review present", revItems.some((r: any) => r.id === `rev_${TAG}_rel`));
    check("my_reviews: draft review excluded", revItems.every((r: any) => r.id !== `rev_${TAG}_draft`));
    check(
      "my_reviews: hrNotes NEVER serialized",
      !JSON.stringify(reviews).includes("SECRET-HR-NOTE"),
    );

    const goals = await runTool("my_goals", empPersona);
    check(
      "my_goals: own goal listed",
      ((goals as any).data?.items ?? []).some((g: any) => g.id === `goal_${TAG}_a`),
    );

    const learn = await runTool("my_learning", empPersona);
    const learnIds = ((learn as any).data?.items ?? []).map((i: any) => i.id);
    check("my_learning: employee sees all+employees", learnIds.includes(`tm_${TAG}_all`) && learnIds.includes(`tm_${TAG}_emp`));
    check("my_learning: employee does NOT see contractor material", !learnIds.includes(`tm_${TAG}_con`));
    const completedFlag = ((learn as any).data?.items ?? []).find((i: any) => i.id === `tm_${TAG}_all`)?.completed;
    check("my_learning: completion flag keyed on caller's user id", completedFlag === true);

    const notif = await runTool("my_notifications", empPersona);
    const nIds = ((notif as any).data?.items ?? []).map((i: any) => i.id);
    check("my_notifications: unread only (dismissed excluded)", nIds.includes(`sn_${TAG}_mine`) && !nIds.includes(`sn_${TAG}_read`));

    // ---------------- 4b. expenses & timesheets (Task #421) -----------
    group("Expenses & timesheets — keying quirks");
    const exp = await runTool("my_expenses", empPersona, hostile);
    const expItems = (exp as any).data?.items ?? [];
    const expIds = expItems.map((i: any) => i.id);
    check("my_expenses: ok", exp.ok === true);
    check("my_expenses: own claim (user-id keyed) present", expIds.includes(`exp_${TAG}_mine`));
    check(
      "my_expenses: roster-id-keyed decoy NOT returned (personId IS the user id)",
      !expIds.includes(`exp_${TAG}_wrongkey`),
    );
    check(
      "my_expenses: injected userId ignored — no other user's claim",
      !expIds.includes(`exp_${TAG}_other`),
    );
    const mineExp = expItems.find((i: any) => i.id === `exp_${TAG}_mine`);
    check(
      "my_expenses: status + policy + reimbursement surfaced",
      mineExp?.status === "reimbursed" &&
        mineExp?.policyStatus === "green" &&
        typeof mineExp?.reimbursedAt === "string",
      JSON.stringify(mineExp),
    );

    const tsw = await runTool("my_timesheets", empPersona, hostile);
    const tswItems = (tsw as any).data?.items ?? [];
    const tswIds = tswItems.map((i: any) => i.id);
    check("my_timesheets: ok", tsw.ok === true);
    check(
      "my_timesheets: recent weeks (roster-person keyed), newest first",
      tswIds[0] === `tsw_${TAG}_cur` && tswIds.includes(`tsw_${TAG}_prev`),
      JSON.stringify(tswIds),
    );
    check(
      "my_timesheets: user-id-keyed decoy NOT returned (weeks key on roster id)",
      !tswIds.includes(`tsw_${TAG}_wrongkey`),
    );
    check(
      "my_timesheets: injected personId ignored — no other person's week",
      !tswIds.includes(`tsw_${TAG}_other`),
    );
    const prevWeek = tswItems.find((i: any) => i.id === `tsw_${TAG}_prev`);
    check(
      "my_timesheets: hours + status surfaced",
      prevWeek?.totalHours === 40 && prevWeek?.billableHours === 36 && prevWeek?.status === "partner_approved",
    );

    // Legacy timesheet.current fix — must resolve the roster person, so
    // it finds the seeded EMP_PERSON week, not the user-id decoy.
    const tsCur = await runTool("timesheet_current", empPersona, hostile);
    check(
      "timesheet_current: fixed keying — resolves the caller's roster week",
      tsCur.ok === true && (tsCur as any).data?.id === `tsw_${TAG}_cur`,
      JSON.stringify((tsCur as any).data),
    );

    // Contractor with no timesheet/expense rows: friendly empties.
    const conExp = await runTool("my_expenses", conPersona);
    check(
      "my_expenses (contractor, none): ok with empty list",
      conExp.ok === true && ((conExp as any).data?.items ?? []).length === 0,
    );
    const conTsw = await runTool("my_timesheets", conPersona);
    check(
      "my_timesheets (contractor, none): ok with empty list",
      conTsw.ok === true && ((conTsw as any).data?.items ?? []).length === 0,
    );

    // ---------------- 5. contractor variants --------------------------
    group("Contractor variants");
    const conProfile = await runTool("my_profile", conPersona);
    check(
      "my_profile (contractor): resolves contractor roster row by email",
      conProfile.ok === true && (conProfile as any).data?.workerType === "contractor",
      JSON.stringify((conProfile as any).data),
    );

    const conReviews = await runTool("my_reviews", conPersona, hostile);
    check(
      "my_reviews (contractor): ok:true + applicable:false (friendly, not an error)",
      conReviews.ok === true &&
        (conReviews as any).data?.applicable === false &&
        typeof (conReviews as any).data?.note === "string" &&
        (conReviews as any).data.note.length > 0,
      JSON.stringify(conReviews),
    );
    const conGoals = await runTool("my_goals", conPersona);
    check(
      "my_goals (contractor): ok:true + applicable:false",
      conGoals.ok === true && (conGoals as any).data?.applicable === false,
    );

    const conLearn = await runTool("my_learning", conPersona);
    const conLearnIds = ((conLearn as any).data?.items ?? []).map((i: any) => i.id);
    check(
      "my_learning (contractor): all+contractors audience",
      conLearnIds.includes(`tm_${TAG}_all`) &&
        conLearnIds.includes(`tm_${TAG}_con`) &&
        !conLearnIds.includes(`tm_${TAG}_emp`),
    );

    const conPay = await runTool("my_pay_documents", conPersona);
    const conPayIds = ((conPay as any).data?.items ?? []).map((i: any) => i.id);
    check(
      "my_pay_documents (contractor): own remittance only",
      conPayIds.includes(`pd_${TAG}_con`) && !conPayIds.includes(`pd_${TAG}_pub`),
    );

    const conCtr = await runTool("my_contracts", conPersona);
    check(
      "my_contracts (contractor): empty (mirrors /me/contracts employee-link rule)",
      conCtr.ok === true && ((conCtr as any).data?.items ?? []).length === 0,
    );
  } finally {
    // ---------------- cleanup (tag sweep) -----------------------------
    const D2 = await import("@workspace/db");
    const {
      db: dbx,
      pool: poolx,
      atelierUsers: U,
      atelierEmployees: E,
      atelierContractors: C,
      atelierLeaveRequests: LR,
      atelierPayDocuments: PD,
      atelierContractRecords: CR,
      atelierSelfNotifications: SN,
      atelierPerformanceReviews: PR,
      atelierPerformanceGoals: PG,
      atelierTrainingMaterials: TM,
      atelierTrainingCompletions: TC,
      atelierExpenses: EX,
      atelierTimesheetWeeks: TW,
    } = D2 as any;
    try {
      await dbx.delete(TW).where(like(TW.id, `tsw_${TAG}%`));
      await dbx.delete(EX).where(like(EX.id, `exp_${TAG}%`));
      await dbx.delete(TC).where(like(TC.id, `tc_${TAG}%`));
      await dbx.delete(TM).where(like(TM.id, `tm_${TAG}%`));
      await dbx.delete(PG).where(like(PG.id, `goal_${TAG}%`));
      await dbx.delete(PR).where(like(PR.id, `rev_${TAG}%`));
      await dbx.delete(SN).where(like(SN.id, `sn_${TAG}%`));
      await dbx.delete(CR).where(like(CR.id, `ctr_${TAG}%`));
      await dbx.delete(PD).where(like(PD.id, `pd_${TAG}%`));
      await dbx.delete(LR).where(like(LR.id, `lr_${TAG}%`));
      await dbx.delete(C).where(eq(C.id, CON_PERSON));
      await dbx.delete(E).where(inArray(E.id, [EMP_PERSON, OTHER_PERSON]));
      await dbx.delete(U).where(inArray(U.id, [EMP_UID, CON_UID, OTHER_UID, BOARD_UID]));
    } catch (err) {
      console.error("cleanup error", err);
    }
    await poolx.end().catch(() => {});
  }

  console.log(`\n${failures.length === 0 ? "ALL PASS" : `${failures.length} FAILURE(S)`}`);
  if (failures.length > 0) process.exit(1);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
