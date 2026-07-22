/**
 * Task #583 — Me-lens self-service WRITE capabilities probe.
 *
 * Runs standalone (tsx ./tests/cli-selfservice/run.ts) against an
 * isolated scratch database. Deterministic — no LLM calls; tools are
 * invoked directly through the capability registry.
 *
 *   1. Catalog surface: the write tools are registered, marked
 *      isWrite, two-phase confirm (except notification dismiss), and
 *      their input schemas carry NO person/user selector fields.
 *   2. Persona clamp: employee + contractor personas now see the me.*
 *      writes; board_observer sees none.
 *   3. Confirm gating: first call returns a confirmation frame and
 *      writes NOTHING; confirm:true performs the write keyed on the
 *      CALLER (hostile extra ids in input are ignored by the runner).
 *   4. Guards mirrored from REST: leave balance/overlap, week
 *      draft/rejected lock + suspicious-flag acknowledgement, profile
 *      whitelist (contractor preferredName skipped), national-ID side
 *      rules, foreign-attachment refusal, notification ownership.
 *   5. Refusal scrubbing: scrubToolIdentifiers strips tool names.
 *   6. Intent routing: identity_doc candidates from images + content.
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { and, eq, inArray, like } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const EMP_UID = `p_test_ssemp_${STAMP}`;
const CON_UID = `p_test_sscon_${STAMP}`;
const OTHER_UID = `p_test_ssother_${STAMP}`;
const BOARD_UID = `p_test_ssboard_${STAMP}`;
const EMP_PERSON = `emp_test_ss_${STAMP}`;
const OTHER_PERSON = `emp_test_ssother_${STAMP}`;
const CON_PERSON = `ctr_test_ss_${STAMP}`;
const TAG = `__t583_${STAMP}`;

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

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("\u2717 DATABASE_URL is not set.");
    process.exit(1);
  }

  const D = await import("@workspace/db");
  const {
    db,
    atelierUsers,
    atelierEmployees,
    atelierContractors,
    atelierLeaveRequests,
    atelierExpenses,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierPersonDocuments,
    atelierSelfNotifications,
    atelierCliAttachments,
    atelierAuditEvents,
  } = D as any;

  const catalog = await import("../../src/lib/atelier-cli/capability-catalog.js");
  await import("../../src/lib/atelier-cli/bootstrap-capabilities.js");
  const { capabilitiesForPersona, findByToolName, scrubToolIdentifiers } = catalog as any;
  const { storeAttachmentBytes } = await import(
    "../../src/lib/atelier-cli/attachments/storage.js"
  );
  const { detectIntent } = await import(
    "../../src/lib/atelier-cli/attachments/intent-detect.js"
  );
  const { isoWeekOf } = await import("../../src/routes/atelier/ledgerRoutes.js");

  const WRITE_TOOLS = [
    "request_leave",
    "create_my_expense",
    "log_my_time",
    "submit_my_timesheet",
    "update_my_profile",
    "save_my_document",
    "delete_my_document",
    "dismiss_my_notification",
  ];
  const SELECTOR_FIELDS = ["userId", "personId", "email", "forUser", "subject", "user"];

  const empPersona = { id: EMP_UID, name: "SS Emp", role: "employee", orgId: ORG };
  const conPersona = { id: CON_UID, name: "SS Con", role: "contractor", orgId: ORG };
  const boardPersona = { id: BOARD_UID, name: "SS Board", role: "board_observer", orgId: ORG };

  const runTool = async (
    toolName: string,
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown> = {},
  ) => {
    const entry = findByToolName(toolName);
    if (!entry) throw new Error(`tool ${toolName} not registered`);
    return entry.run(input, { persona } as any);
  };

  /** Run once to get the confirmation, then re-run its pending input. */
  const runConfirmed = async (
    toolName: string,
    persona: { id: string; name: string; role: string; orgId: string },
    input: Record<string, unknown>,
  ) => {
    const first = await runTool(toolName, persona, input);
    if (!first.ok || !first.confirmation) return { first, second: null as any };
    const second = await runTool(toolName, persona, first.confirmation.pending.input);
    return { first, second };
  };

  const attIds: string[] = [];
  const seedAttachment = async (args: {
    userId: string;
    fileName: string;
    mime: string;
    bytes: Buffer;
  }): Promise<string> => {
    const stored = await storeAttachmentBytes(args.bytes);
    const id = `att_${TAG}_${attIds.length}`;
    attIds.push(id);
    await db.insert(atelierCliAttachments).values({
      id,
      orgId: ORG,
      userId: args.userId,
      fileName: args.fileName,
      mime: args.mime,
      sizeBytes: stored.sizeBytes,
      sha256: stored.sha256,
      encryptedRef: stored.encryptedRef,
      status: "extracted",
    });
    return id;
  };

  try {
    // ---------------- seed -------------------------------------------
    const users = [
      { id: EMP_UID, role: "employee", roleLabel: "Employee", name: `SS Emp ${TAG}`, email: `ssemp${STAMP}@test.local` },
      { id: CON_UID, role: "contractor", roleLabel: "Contractor", name: `SS Con ${TAG}`, email: `sscon${STAMP}@test.local` },
      { id: OTHER_UID, role: "employee", roleLabel: "Employee", name: `SS Other ${TAG}`, email: `ssother${STAMP}@test.local` },
      { id: BOARD_UID, role: "board_observer", roleLabel: "Board Observer", name: `SS Board ${TAG}`, email: `ssboard${STAMP}@test.local` },
    ];
    for (const u of users) {
      await db.insert(atelierUsers).values({
        id: u.id,
        orgId: ORG,
        email: u.email,
        name: u.name,
        initials: "ST",
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
        fullName: `SS Emp ${TAG}`,
        email: `ssemp${STAMP}@test.local`,
        role: "employee",
        title: "Consultant",
        startDate: "2024-01-15",
      },
      {
        id: OTHER_PERSON,
        orgId: ORG,
        userId: OTHER_UID,
        fullName: `SS Other ${TAG}`,
        email: `ssother${STAMP}@test.local`,
        role: "employee",
      },
    ]);
    await db.insert(atelierContractors).values({
      id: CON_PERSON,
      orgId: ORG,
      fullName: `SS Con ${TAG}`,
      email: `sscon${STAMP}@test.local`,
    });
    await db.insert(atelierSelfNotifications).values([
      { id: `sn_${TAG}_mine`, orgId: ORG, userId: EMP_UID, title: `Mine ${TAG}`, kind: "generic" },
      { id: `sn_${TAG}_other`, orgId: ORG, userId: OTHER_UID, title: `Other ${TAG}`, kind: "generic" },
    ]);

    // ---------------- 1. catalog surface ------------------------------
    group("Catalog surface");
    for (const t of WRITE_TOOLS) {
      const entry = findByToolName(t);
      check(`${t} registered`, Boolean(entry));
      if (!entry) continue;
      check(`${t} isWrite`, entry.isWrite === true);
      const expectConfirm = t !== "dismiss_my_notification";
      check(
        `${t} twoPhaseConfirm=${expectConfirm}`,
        entry.twoPhaseConfirm === expectConfirm,
      );
      const schema = entry.inputSchema as Record<string, unknown>;
      const props = Object.keys((schema.properties ?? {}) as Record<string, unknown>);
      check(
        `${t} schema locked (additionalProperties:false, no subject selector)`,
        schema.additionalProperties === false &&
          props.every((p) => !SELECTOR_FIELDS.includes(p)),
        JSON.stringify(props),
      );
    }
    const myDocs = findByToolName("my_documents");
    check("my_documents registered read-only", Boolean(myDocs) && myDocs.isWrite === false);

    // ---------------- 2. persona clamp --------------------------------
    group("Persona clamp");
    const empTools = new Set(capabilitiesForPersona(empPersona).map((e: any) => e.toolName));
    const conTools = new Set(capabilitiesForPersona(conPersona).map((e: any) => e.toolName));
    const boardTools = new Set(capabilitiesForPersona(boardPersona).map((e: any) => e.toolName));
    check("employee sees all self-service writes", WRITE_TOOLS.every((t) => empTools.has(t)));
    check("contractor sees all self-service writes", WRITE_TOOLS.every((t) => conTools.has(t)));
    check("board_observer sees none", WRITE_TOOLS.every((t) => !boardTools.has(t)));

    // ---------------- 3. leave request --------------------------------
    group("Leave request");
    const year = new Date().getUTCFullYear() + 1;
    // Find an actual Saturday in June of `year` so the weekend-only
    // check never goes stale as the calendar shifts.
    const satProbe = new Date(Date.UTC(year, 5, 1));
    while (satProbe.getUTCDay() !== 6) satProbe.setUTCDate(satProbe.getUTCDate() + 1);
    const weekendSat = satProbe.toISOString().slice(0, 10);
    satProbe.setUTCDate(satProbe.getUTCDate() + 1);
    const weekendSun = satProbe.toISOString().slice(0, 10);
    const lv = await runConfirmed("request_leave", empPersona, {
      leaveType: "annual",
      startDate: `${year}-03-02`,
      endDate: `${year}-03-04`,
      // Hostile extras are not in the schema and must be ignored.
      userId: OTHER_UID,
      personId: OTHER_PERSON,
    });
    check("first call returns confirmation, no write yet", Boolean(lv.first.confirmation));
    const preRows = await db
      .select()
      .from(atelierLeaveRequests)
      .where(eq(atelierLeaveRequests.personId, EMP_PERSON));
    check(
      "confirm:true creates the request keyed on the CALLER's roster id",
      lv.second?.ok === true && preRows.length === 0
        ? false
        : preRows.length === 1 && preRows[0].userId === EMP_UID && preRows[0].workingDays === 3,
      JSON.stringify(preRows.map((r: any) => ({ id: r.id, userId: r.userId }))),
    );
    const lvOverlap = await runTool("request_leave", empPersona, {
      leaveType: "annual",
      startDate: `${year}-03-03`,
      endDate: `${year}-03-05`,
    });
    check("overlap guard refuses", lvOverlap.ok === false && lvOverlap.errorCode === "overlapping_request");
    const lvWeekend = await runTool("request_leave", empPersona, {
      leaveType: "annual",
      startDate: weekendSat,
      endDate: weekendSun,
    });
    check("weekend-only range refused", lvWeekend.ok === false && lvWeekend.errorCode === "no_working_days");
    const lvBalance = await runTool("request_leave", empPersona, {
      leaveType: "annual",
      startDate: `${year}-05-01`,
      endDate: `${year}-07-31`,
    });
    check("balance guard refuses oversize annual request", lvBalance.ok === false && lvBalance.errorCode === "insufficient_balance");

    // ---------------- 4. expense create (+ receipt ownership) ---------
    group("Expense create");
    const myReceipt = await seedAttachment({
      userId: EMP_UID,
      fileName: "taxi-receipt.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from(`fake-jpeg-mine-${TAG}`),
    });
    const foreignReceipt = await seedAttachment({
      userId: OTHER_UID,
      fileName: "foreign-receipt.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from(`fake-jpeg-foreign-${TAG}`),
    });
    const exp = await runConfirmed("create_my_expense", empPersona, {
      amount: 45.5,
      currency: "usd",
      merchant: `Taxi ${TAG}`,
      receiptAttachmentId: myReceipt,
    });
    check("expense confirm frame first", Boolean(exp.first.confirmation));
    const expRows = await db
      .select()
      .from(atelierExpenses)
      .where(eq(atelierExpenses.merchant, `Taxi ${TAG}`));
    check(
      "expense draft keyed on the caller's USER id with receipt ref",
      exp.second?.ok === true &&
        expRows.length === 1 &&
        expRows[0].personId === EMP_UID &&
        expRows[0].status === "draft" &&
        typeof expRows[0].receiptFileRef === "string" &&
        expRows[0].receiptEncryptedAtRest === true,
      JSON.stringify(expRows.map((r: any) => ({ personId: r.personId, status: r.status }))),
    );
    const expForeign = await runTool("create_my_expense", empPersona, {
      amount: 10,
      merchant: `Sneaky ${TAG}`,
      receiptAttachmentId: foreignReceipt,
    });
    check(
      "another user's receipt attachment is refused",
      expForeign.ok === false && expForeign.errorCode === "receipt_not_found",
    );
    const expBad = await runTool("create_my_expense", empPersona, { amount: -5, merchant: "x" });
    check("invalid amount refused", expBad.ok === false && expBad.errorCode === "invalid_amount");

    // ---------------- 5. timesheet log + submit -----------------------
    group("Timesheet log + submit");
    const { weekIso: CUR_ISO, weekStart } = isoWeekOf(new Date());
    const monday = weekStart.toISOString().slice(0, 10);
    const ts = await runConfirmed("log_my_time", empPersona, {
      workDate: monday,
      hours: 6,
      narrative: `probe ${TAG}`,
    });
    check("log_my_time confirm frame first", Boolean(ts.first.confirmation));
    const weeks = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(
        and(
          eq(atelierTimesheetWeeks.personId, EMP_PERSON),
          eq(atelierTimesheetWeeks.weekIso, CUR_ISO),
        ),
      );
    check(
      "entry lands in the CALLER's roster-keyed week with recomputed totals",
      ts.second?.ok === true && weeks.length === 1 && Number(weeks[0].totalHours) === 6,
      JSON.stringify(weeks.map((w: any) => ({ id: w.id, totalHours: w.totalHours }))),
    );
    const sub = await runConfirmed("submit_my_timesheet", empPersona, {});
    check(
      "submit flows: confirm then submitted",
      Boolean(sub.first.confirmation) && sub.second?.ok === true,
      JSON.stringify(sub.second),
    );
    const [wk] = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(eq(atelierTimesheetWeeks.id, weeks[0].id));
    check("week status submitted + stamped by caller", wk.status === "submitted" && wk.submittedByUserId === EMP_UID);
    const tsLocked = await runTool("log_my_time", empPersona, {
      workDate: monday,
      hours: 2,
      confirm: true,
    });
    check("locked week refuses further logging", tsLocked.ok === false && tsLocked.errorCode === "week_locked");
    const subAgain = await runTool("submit_my_timesheet", empPersona, { confirm: true });
    check("re-submit refused (week_locked)", subAgain.ok === false && subAgain.errorCode === "week_locked");

    // ---------------- 5b. notification parity with REST (Task #589) ---
    // Chat writes must produce the SAME notification rows as their REST
    // equivalents: timesheet submit drops a timesheet_submitted card on
    // the submitter's home (mirrors POST /me/timesheets/:weekId/submit);
    // leave create and expense DRAFT create send nothing (neither do the
    // REST paths — founders are notified only at expense SUBMIT, which
    // stays on the Me page).
    group("Notification parity with REST");
    const tsNotifs = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.userId, EMP_UID),
          eq(atelierSelfNotifications.kind, "timesheet_submitted"),
        ),
      );
    check(
      "chat timesheet submit emitted ONE timesheet_submitted self-notification",
      tsNotifs.length === 1 &&
        tsNotifs[0].title === `Timesheet ${CUR_ISO} submitted` &&
        tsNotifs[0].href === "/me",
      JSON.stringify(tsNotifs.map((n: any) => ({ kind: n.kind, title: n.title }))),
    );
    const otherKinds = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        inArray(atelierSelfNotifications.kind, [
          "leave_requested",
          "expense_submitted",
          "expense_drafted",
        ]),
      );
    check(
      "leave create + expense draft emit no notification rows (REST parity)",
      otherKinds.length === 0,
      JSON.stringify(otherKinds.map((n: any) => ({ kind: n.kind, userId: n.userId }))),
    );

    // ---------------- 6. profile update -------------------------------
    group("Profile self-edit");
    const prof = await runConfirmed("update_my_profile", empPersona, {
      personalEmail: `personal${STAMP}@example.com`,
      preferredName: "Essie",
    });
    const [empRow] = await db
      .select()
      .from(atelierEmployees)
      .where(eq(atelierEmployees.id, EMP_PERSON));
    check(
      "employee profile fields updated (incl. preferredName)",
      prof.second?.ok === true &&
        empRow.personalEmail === `personal${STAMP}@example.com` &&
        empRow.preferredName === "Essie",
      JSON.stringify({ pe: empRow.personalEmail, pn: empRow.preferredName }),
    );
    const profBad = await runTool("update_my_profile", empPersona, {
      title: "Founding Partner",
    } as any);
    check(
      "non-whitelisted field (title) rejected by the strict schema",
      profBad.ok === false && profBad.errorCode === "invalid_body",
    );
    const conProf = await runConfirmed("update_my_profile", conPersona, {
      preferredName: "Connie",
      homeAddress: `1 Test Way ${TAG}`,
    });
    const [conRow] = await db
      .select()
      .from(atelierContractors)
      .where(eq(atelierContractors.id, CON_PERSON));
    check(
      "contractor: preferredName skipped, homeAddress applied",
      conProf.second?.ok === true &&
        conRow.homeAddress === `1 Test Way ${TAG}` &&
        (conRow.preferredName ?? null) === null,
      JSON.stringify({ ha: conRow.homeAddress, pn: conRow.preferredName }),
    );

    // ---------------- 7. personal documents ---------------------------
    group("Personal documents");
    const passportPdf = await seedAttachment({
      userId: EMP_UID,
      fileName: "passport.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`%PDF-1.4 fake ${TAG}`),
    });
    const idFront = await seedAttachment({
      userId: EMP_UID,
      fileName: "id-front.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from(`front-${TAG}`),
    });
    const idBack = await seedAttachment({
      userId: EMP_UID,
      fileName: "id-back.jpg",
      mime: "image/jpeg",
      bytes: Buffer.from(`back-${TAG}`),
    });
    const foreignDoc = await seedAttachment({
      userId: OTHER_UID,
      fileName: "foreign-passport.pdf",
      mime: "application/pdf",
      bytes: Buffer.from(`foreign-${TAG}`),
    });

    const savePass = await runConfirmed("save_my_document", empPersona, {
      attachmentId: passportPdf,
      kind: "passport",
      title: `Passport ${TAG}`,
      expiresAt: "2031-01-01",
    });
    check(
      "passport saved from own attachment",
      Boolean(savePass.first.confirmation) && savePass.second?.ok === true,
      JSON.stringify(savePass.second),
    );
    const idNoBack = await runTool("save_my_document", empPersona, {
      attachmentId: idFront,
      kind: "national_id",
      title: `EID ${TAG}`,
    });
    check(
      "national_id image without back refused (back_side_required)",
      idNoBack.ok === false && idNoBack.errorCode === "back_side_required",
    );
    const backOnPassport = await runTool("save_my_document", empPersona, {
      attachmentId: passportPdf,
      backAttachmentId: idBack,
      kind: "passport",
      title: `Bad ${TAG}`,
    });
    check(
      "back side on a passport refused",
      backOnPassport.ok === false && backOnPassport.errorCode === "back_side_not_allowed",
    );
    const saveId = await runConfirmed("save_my_document", empPersona, {
      attachmentId: idFront,
      backAttachmentId: idBack,
      kind: "national_id",
      title: `EID ${TAG}`,
    });
    check(
      "national_id front+back saved with sides=front_back",
      saveId.second?.ok === true && saveId.second?.data?.sides === "front_back",
      JSON.stringify(saveId.second),
    );
    const saveForeign = await runTool("save_my_document", empPersona, {
      attachmentId: foreignDoc,
      kind: "passport",
      title: `Stolen ${TAG}`,
      confirm: true,
    });
    check(
      "another user's attachment refused for documents",
      saveForeign.ok === false && saveForeign.errorCode === "attachment_not_found",
    );

    const docList = await runTool("my_documents", empPersona);
    const docItems = (docList as any).data?.items ?? [];
    check(
      "my_documents lists both saved docs",
      docList.ok === true &&
        docItems.some((d: any) => d.title === `Passport ${TAG}`) &&
        docItems.some((d: any) => d.title === `EID ${TAG}` && d.sides === "front_back"),
      JSON.stringify(docItems),
    );
    // Contractor sees an empty list, never the employee's docs.
    const conDocs = await runTool("my_documents", conPersona);
    check(
      "my_documents (contractor): own empty list",
      conDocs.ok === true && ((conDocs as any).data?.items ?? []).length === 0,
    );

    const passDocId = docItems.find((d: any) => d.title === `Passport ${TAG}`)?.id;
    const del = await runConfirmed("delete_my_document", empPersona, {
      documentId: passDocId,
    });
    check("own document deletes (soft)", del.second?.ok === true);
    const [deadDoc] = await db
      .select()
      .from(atelierPersonDocuments)
      .where(eq(atelierPersonDocuments.id, passDocId));
    check("delete is soft (deletedAt stamped)", Boolean(deadDoc?.deletedAt));
    // Seed a doc on ANOTHER person and try to delete it.
    await db.insert(atelierPersonDocuments).values({
      id: `pdoc_${TAG}_other`,
      orgId: ORG,
      personType: "employee",
      personId: OTHER_PERSON,
      kind: "passport",
      title: `Other's Passport ${TAG}`,
      uploadedByUserId: OTHER_UID,
    });
    const delForeign = await runTool("delete_my_document", empPersona, {
      documentId: `pdoc_${TAG}_other`,
      confirm: true,
    });
    check(
      "another person's document cannot be deleted",
      delForeign.ok === false && delForeign.errorCode === "doc_not_found",
    );

    // ---------------- 8. notification dismiss -------------------------
    group("Notification dismiss");
    const dis = await runTool("dismiss_my_notification", empPersona, {
      notificationId: `sn_${TAG}_mine`,
    });
    const [snMine] = await db
      .select()
      .from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.id, `sn_${TAG}_mine`));
    check("own notification dismissed (single phase)", dis.ok === true && snMine.status === "dismissed");
    const disForeign = await runTool("dismiss_my_notification", empPersona, {
      notificationId: `sn_${TAG}_other`,
    });
    const [snOther] = await db
      .select()
      .from(atelierSelfNotifications)
      .where(eq(atelierSelfNotifications.id, `sn_${TAG}_other`));
    check(
      "another user's notification: not_found, row untouched",
      disForeign.ok === false && disForeign.errorCode === "not_found" && snOther.status !== "dismissed",
    );

    // ---------------- 9. refusal scrubbing ----------------------------
    group("Refusal scrubbing");
    const scrubbed1 = scrubToolIdentifiers(
      "I can't do that — try `create_my_expense` or my_documents instead.",
    );
    check(
      "registered tool names scrubbed",
      !scrubbed1.includes("create_my_expense") && !scrubbed1.includes("my_documents"),
      scrubbed1,
    );
    const scrubbed2 = scrubToolIdentifiers(
      "The hallucinated_tool_name capability is unavailable.",
    );
    check("unregistered snake_case tokens scrubbed", !scrubbed2.includes("hallucinated_tool_name"), scrubbed2);
    check("plain prose untouched", scrubToolIdentifiers("I cannot delete accounts.") === "I cannot delete accounts.");

    // ---------------- 10. identity_doc intent -------------------------
    group("Attachment intent — identity_doc");
    const imgCands = detectIntent({ kind: "image", normalizedText: "" } as any);
    const imgTop2 = imgCands.slice(0, 2).map((c: any) => c.intent);
    check(
      "bare image ties receipt_batch and identity_doc (forces ONE clarifying question)",
      imgTop2.includes("receipt_batch") &&
        imgTop2.includes("identity_doc") &&
        imgCands[0].weight === imgCands[1].weight,
      JSON.stringify(imgCands),
    );
    const passCands = detectIntent({
      kind: "image",
      normalizedText:
        "REPUBLIC OF TESTLAND Passport No X123 Nationality TESTISH Date of Birth 01 JAN 1990 P<TST",
    } as any);
    check(
      "passport markers break the tie toward identity_doc",
      passCands[0].intent === "identity_doc",
      JSON.stringify(passCands),
    );
    const receiptCands = detectIntent({
      kind: "pdf",
      normalizedText: "TAXI RECEIPT Total AED 45.00 VAT 5% Thank you",
    } as any);
    check(
      "receipt text does NOT trigger identity_doc",
      receiptCands.every((c: any) => c.intent !== "identity_doc"),
      JSON.stringify(receiptCands),
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
      atelierExpenses: EX,
      atelierTimesheetWeeks: TW,
      atelierTimesheetEntries: TE,
      atelierPersonDocuments: PDoc,
      atelierSelfNotifications: SN,
      atelierCliAttachments: ATT,
      atelierAuditEvents: AE,
    } = D2 as any;
    try {
      await dbx.delete(AE).where(inArray(AE.actorId, [EMP_UID, CON_UID]));
      await dbx.delete(TE).where(eq(TE.personId, EMP_PERSON));
      await dbx.delete(TW).where(eq(TW.personId, EMP_PERSON));
      await dbx.delete(EX).where(like(EX.merchant, `%${TAG}`));
      await dbx.delete(LR).where(eq(LR.personId, EMP_PERSON));
      await dbx
        .delete(PDoc)
        .where(inArray(PDoc.personId, [EMP_PERSON, OTHER_PERSON, CON_PERSON]));
      await dbx.delete(SN).where(like(SN.id, `sn_${TAG}%`));
      await dbx.delete(ATT).where(like(ATT.id, `att_${TAG}%`));
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
