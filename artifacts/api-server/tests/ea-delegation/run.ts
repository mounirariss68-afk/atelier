/**
 * Task #386 — Executive Assistant delegation regression probe.
 *
 * Runs standalone (tsx ./tests/ea-delegation/run.ts) booting the app
 * in-process via app.listen(0) against an isolated scratch database;
 * NODE_ENV=test enables the persona-cookie bypass so requests act as
 * ephemeral p_test_* personas. All rows created here are removed in
 * `finally` — NO seeding.
 *
 * Coverage:
 *   1. grant lifecycle: partner-only gate, EA-designation gate, no
 *      self-delegation, duplicate-active 409, scope patch, revoke idempotent
 *   2. EA acting-for: scope enforcement per kind, payload whitelist,
 *      pending item creation with dual-attribution audit + notification
 *   3. partner review: list w/ overlap hints, approve applies the real
 *      artifact (timesheet entry attributed to the EA) and is idempotent,
 *      reject requires a reason, EA edit + resubmit loop
 *   4. isolation: another partner cannot see/decide the item; revoked
 *      grant cuts off new items, edits and resubmits
 *   5. receipt route ACL: EA/partner/HR pass the gate, others 403
 *   6. auto-revoke on deactivation (both sides) with notifications
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import type { AddressInfo } from "node:net";
import { and, eq, like, inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const PTR_ID = `p_test_ptr_${STAMP}`;
const PTR2_ID = `p_test_ptr2_${STAMP}`;
const EA_ID = `p_test_ea_${STAMP}`;
const EMP_ID = `p_test_emp_${STAMP}`; // plain employee, NOT an EA
const HR_ID = `p_test_hr_${STAMP}`;

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
    pool,
    atelierUsers,
    atelierEmployees,
    atelierSelfNotifications,
    atelierAuditEvents,
    atelierTimesheetWeeks,
    atelierTimesheetEntries,
    atelierExpenses,
    atelierEaDelegations,
    atelierEaPendingItems,
  } = D as any;
  const appMod = await import("../../src/app.js");
  const app = appMod.default;
  const { autoRevokeDelegationsForUser } = await import(
    "../../src/routes/atelier/delegationRoutes.js"
  );

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

  const itemIds: string[] = [];
  const delegationIds: string[] = [];

  try {
    // --- ephemeral personas (no seeding) ---
    const personas = [
      { id: PTR_ID, role: "partner", roleLabel: "Partner", name: "Test Partner" },
      { id: PTR2_ID, role: "partner", roleLabel: "Partner", name: "Other Partner" },
      { id: EA_ID, role: "employee", roleLabel: "Employee", name: "Test EA" },
      { id: EMP_ID, role: "employee", roleLabel: "Employee", name: "Plain Employee" },
      { id: HR_ID, role: "hr", roleLabel: "HR", name: "Test HR" },
    ];
    for (const p of personas) {
      await db
        .insert(atelierUsers)
        .values({
          id: p.id,
          orgId: ORG,
          email: `${p.id}@cognirise.ai`,
          name: p.name,
          initials: "TT",
          role: p.role,
          roleLabel: p.roleLabel,
          title: p.name,
          permissions: [],
          bdActive: false,
        })
        .onConflictDoNothing();
    }
    // Roster: partner needs a roster record so timesheet approve can apply;
    // EA is roster-designated via is_executive_assistant.
    await db.insert(atelierEmployees).values({
      id: `emp_ptr_${STAMP}`,
      orgId: ORG,
      userId: PTR_ID,
      fullName: "Test Partner",
      email: `${PTR_ID}@cognirise.ai`,
      role: "partner",
      title: "Partner",
    });
    await db.insert(atelierEmployees).values({
      id: `emp_ea_${STAMP}`,
      orgId: ORG,
      userId: EA_ID,
      fullName: "Test EA",
      email: `${EA_ID}@cognirise.ai`,
      role: "employee",
      title: "Executive Assistant",
      isExecutiveAssistant: true,
    });
    await db.insert(atelierEmployees).values({
      id: `emp_emp_${STAMP}`,
      orgId: ORG,
      userId: EMP_ID,
      fullName: "Plain Employee",
      email: `${EMP_ID}@cognirise.ai`,
      role: "employee",
      title: "Analyst",
    });

    // =====================================================================
    group("grants \u00b7 create / gate / duplicate / patch");
    // =====================================================================
    const empGate = await call("GET", "/me/delegates", EMP_ID);
    check("non-partner GET /me/delegates \u2192 403", empGate.status === 403, `status=${empGate.status}`);

    const notEa = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EMP_ID,
      scopes: ["timesheets"],
    });
    check(
      "delegating to a non-EA \u2192 400 not-an-ea",
      notEa.status === 400 && notEa.body?.error === "not-an-ea",
      `status=${notEa.status} error=${notEa.body?.error}`,
    );

    const selfDel = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: PTR_ID,
      scopes: ["timesheets"],
    });
    check("self-delegation \u2192 400", selfDel.status === 400, `status=${selfDel.status}`);

    const badScope = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EA_ID,
      scopes: ["payroll"],
    });
    check("unknown scope \u2192 400 invalid-scopes", badScope.status === 400, `status=${badScope.status}`);

    const created = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EA_ID,
      scopes: ["timesheets", "expenses"],
    });
    check(
      "grant to roster EA \u2192 201 active",
      created.status === 201 && created.body?.delegation?.status === "active",
      `status=${created.status} body=${JSON.stringify(created.body)?.slice(0, 200)}`,
    );
    const delId = created.body?.delegation?.id as string;
    if (delId) delegationIds.push(delId);

    const dup = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EA_ID,
      scopes: ["timesheets"],
    });
    check("duplicate active grant \u2192 409", dup.status === 409, `status=${dup.status}`);

    const list = await call("GET", "/me/delegates", PTR_ID);
    check(
      "GET /me/delegates lists candidate + grant",
      list.status === 200 &&
        list.body?.candidates?.some((c: any) => c.userId === EA_ID) &&
        !list.body?.candidates?.some((c: any) => c.userId === EMP_ID) &&
        list.body?.delegations?.some((d: any) => d.id === delId),
      JSON.stringify(list.body)?.slice(0, 300),
    );

    const grantNotif = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.userId, EA_ID),
          eq(atelierSelfNotifications.kind, "ea_delegation_granted"),
        ),
      );
    check("EA notified of the new grant", grantNotif.length === 1, `n=${grantNotif.length}`);

    // =====================================================================
    group("EA acting-for \u00b7 scope + payload enforcement");
    // =====================================================================
    const assist = await call("GET", "/me/assist", EA_ID);
    check(
      "EA GET /me/assist shows the delegation + EA flag",
      assist.status === 200 &&
        assist.body?.isExecutiveAssistant === true &&
        assist.body?.delegations?.some((d: any) => d.id === delId),
      JSON.stringify(assist.body)?.slice(0, 200),
    );
    const empAssist = await call("GET", "/me/assist", EMP_ID);
    check(
      "non-EA GET /me/assist \u2192 empty, flag false",
      empAssist.status === 200 &&
        empAssist.body?.isExecutiveAssistant === false &&
        empAssist.body?.delegations?.length === 0,
      JSON.stringify(empAssist.body)?.slice(0, 200),
    );

    const outOfScope = await call("POST", `/me/assist/${delId}/items`, EA_ID, {
      kind: "meeting_task",
      payload: { title: "Board prep" },
    });
    check(
      "kind outside granted scopes \u2192 403 scope-not-delegated",
      outOfScope.status === 403 && outOfScope.body?.error === "scope-not-delegated",
      `status=${outOfScope.status} error=${outOfScope.body?.error}`,
    );

    const strangerPost = await call("POST", `/me/assist/${delId}/items`, EMP_ID, {
      kind: "timesheet_entry",
      payload: { workDate: "2026-07-13", hours: 2 },
    });
    check(
      "someone else's delegation id \u2192 404",
      strangerPost.status === 404,
      `status=${strangerPost.status}`,
    );

    const badHours = await call("POST", `/me/assist/${delId}/items`, EA_ID, {
      kind: "timesheet_entry",
      payload: { workDate: "2026-07-13", hours: 55 },
    });
    check("invalid hours \u2192 400", badHours.status === 400, `status=${badHours.status}`);

    const tsItem = await call("POST", `/me/assist/${delId}/items`, EA_ID, {
      kind: "timesheet_entry",
      payload: { workDate: "2026-07-13", hours: 3.5, narrative: "Client prep", hourlyRate: 999 },
    });
    check(
      "timesheet entry proposal \u2192 201 pending; whitelist strips unknown fields",
      tsItem.status === 201 &&
        tsItem.body?.item?.status === "pending" &&
        tsItem.body?.item?.payload?.hourlyRate === undefined &&
        tsItem.body?.item?.payload?.hours === 3.5,
      JSON.stringify(tsItem.body)?.slice(0, 250),
    );
    const tsItemId = tsItem.body?.item?.id as string;
    if (tsItemId) itemIds.push(tsItemId);

    const expItem = await call("POST", `/me/assist/${delId}/items`, EA_ID, {
      kind: "expense",
      payload: { merchant: "Test Cab Co", amount: 42.5, currency: "usd", expenseDate: "2026-07-14" },
    });
    check(
      "expense proposal \u2192 201 pending",
      expItem.status === 201 && expItem.body?.item?.status === "pending",
      `status=${expItem.status}`,
    );
    const expItemId = expItem.body?.item?.id as string;
    if (expItemId) itemIds.push(expItemId);

    const submitAudit = await db
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, "ea_pending_item"),
          eq(atelierAuditEvents.entityId, tsItemId),
          eq(atelierAuditEvents.action, "ea.item.submitted"),
        ),
      );
    check(
      "submit audited with dual attribution (EA on behalf of partner)",
      submitAudit.length === 1 &&
        String(submitAudit[0].actorLabel).includes("(EA) on behalf of Test Partner") &&
        (submitAudit[0].payload as any)?.onBehalfOf?.userId === PTR_ID &&
        (submitAudit[0].payload as any)?.actedByEa?.userId === EA_ID,
      JSON.stringify(submitAudit[0] ?? null)?.slice(0, 300),
    );

    const pendNotif = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.userId, PTR_ID),
          eq(atelierSelfNotifications.kind, "ea_item_pending"),
        ),
      );
    check("partner notified of pending items", pendNotif.length >= 2, `n=${pendNotif.length}`);

    // =====================================================================
    group("partner review \u00b7 approve / reject / resubmit / isolation");
    // =====================================================================
    const review = await call("GET", "/me/delegates/review", PTR_ID);
    check(
      "review list shows both pending items",
      review.status === 200 &&
        review.body?.items?.filter((i: any) => i.status === "pending").length === 2,
      JSON.stringify(review.body)?.slice(0, 200),
    );
    const review2 = await call("GET", "/me/delegates/review", PTR2_ID);
    check(
      "other partner's review list is empty",
      review2.status === 200 && review2.body?.items?.length === 0,
      `n=${review2.body?.items?.length}`,
    );
    const foreignApprove = await call("POST", `/me/delegates/review/${tsItemId}/approve`, PTR2_ID);
    check("other partner cannot approve \u2192 404", foreignApprove.status === 404, `status=${foreignApprove.status}`);
    const eaApprove = await call("POST", `/me/delegates/review/${tsItemId}/approve`, EA_ID);
    check("EA cannot approve their own item \u2192 403", eaApprove.status === 403, `status=${eaApprove.status}`);

    const approve = await call("POST", `/me/delegates/review/${tsItemId}/approve`, PTR_ID);
    check(
      "approve timesheet item \u2192 applied",
      approve.status === 200 && approve.body?.ok === true && !!approve.body?.appliedRef,
      JSON.stringify(approve.body)?.slice(0, 200),
    );
    const appliedRef = approve.body?.appliedRef as string;
    const [entry] = appliedRef
      ? await db.select().from(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.id, appliedRef))
      : [];
    check(
      "applied entry lands on the partner's week, authored by the EA",
      !!entry &&
        entry.personId === `emp_ptr_${STAMP}` &&
        entry.createdByUserId === EA_ID &&
        Number(entry.hours) === 3.5,
      JSON.stringify(entry ?? null)?.slice(0, 250),
    );
    const approveAgain = await call("POST", `/me/delegates/review/${tsItemId}/approve`, PTR_ID);
    check(
      "second approve is idempotent (no double apply)",
      approveAgain.status === 200 &&
        approveAgain.body?.alreadyApplied === true &&
        approveAgain.body?.appliedRef === appliedRef,
      JSON.stringify(approveAgain.body)?.slice(0, 200),
    );

    const rejectNoReason = await call("POST", `/me/delegates/review/${expItemId}/reject`, PTR_ID, {});
    check("reject without reason \u2192 400", rejectNoReason.status === 400, `status=${rejectNoReason.status}`);
    const reject = await call("POST", `/me/delegates/review/${expItemId}/reject`, PTR_ID, {
      reason: "Wrong amount \u2014 receipt says 24.50",
    });
    check("reject with reason \u2192 200", reject.status === 200 && reject.body?.ok === true, `status=${reject.status}`);

    const rejNotif = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.userId, EA_ID),
          eq(atelierSelfNotifications.kind, "ea_item_rejected"),
        ),
      );
    check("EA notified of the rejection with the reason", rejNotif.length === 1 && String(rejNotif[0].body).includes("24.50"), `n=${rejNotif.length}`);

    const edit = await call("PATCH", `/me/assist/items/${expItemId}`, EA_ID, {
      payload: { merchant: "Test Cab Co", amount: 24.5, currency: "USD", expenseDate: "2026-07-14" },
    });
    check(
      "EA edits the rejected item",
      edit.status === 200 && edit.body?.item?.payload?.amount === 24.5,
      `status=${edit.status}`,
    );
    const resubmit = await call("POST", `/me/assist/items/${expItemId}/resubmit`, EA_ID);
    check("resubmit \u2192 pending again", resubmit.status === 200 && resubmit.body?.ok === true, `status=${resubmit.status}`);
    const afterResubmit = await call("GET", "/me/assist", EA_ID);
    const resubRow = afterResubmit.body?.items?.find((i: any) => i.id === expItemId);
    check(
      "resubmitted item is pending with the reason cleared",
      resubRow?.status === "pending" && resubRow?.rejectionReason === null && !!resubRow?.resubmittedAt,
      JSON.stringify(resubRow ?? null)?.slice(0, 200),
    );
    const approveExp = await call("POST", `/me/delegates/review/${expItemId}/approve`, PTR_ID);
    check(
      "approve resubmitted expense \u2192 applied",
      approveExp.status === 200 && !!approveExp.body?.appliedRef,
      JSON.stringify(approveExp.body)?.slice(0, 200),
    );
    const [expRow] = approveExp.body?.appliedRef
      ? await db.select().from(atelierExpenses).where(eq(atelierExpenses.id, approveExp.body.appliedRef))
      : [];
    check(
      "applied expense belongs to the partner, authored by the EA",
      !!expRow && expRow.personId === PTR_ID && expRow.createdByUserId === EA_ID && Number(expRow.amount) === 24.5,
      JSON.stringify(expRow ?? null)?.slice(0, 250),
    );

    // =====================================================================
    group("receipt route \u00b7 visibility gate");
    // =====================================================================
    // No receipt was uploaded (object storage untouched in this probe), so
    // allowed callers reach the 404 no-receipt branch PAST the ACL gate;
    // disallowed callers stop at 403.
    for (const [who, id, expect] of [
      ["EA", EA_ID, 404],
      ["partner", PTR_ID, 404],
      ["HR", HR_ID, 404],
      ["unrelated employee", EMP_ID, 403],
      ["other partner", PTR2_ID, 403],
    ] as const) {
      const r = await call("GET", `/me/ea-items/${expItemId}/receipt`, id);
      check(`receipt gate: ${who} \u2192 ${expect}`, r.status === expect, `status=${r.status}`);
    }

    // =====================================================================
    group("revoke \u00b7 cuts off the EA immediately");
    // =====================================================================
    const revoke = await call("POST", `/me/delegates/${delId}/revoke`, PTR_ID);
    check("revoke \u2192 200 revoked", revoke.status === 200 && revoke.body?.delegation?.status === "revoked", `status=${revoke.status}`);
    const revokeAgain = await call("POST", `/me/delegates/${delId}/revoke`, PTR_ID);
    check("revoke is idempotent", revokeAgain.status === 200 && revokeAgain.body?.alreadyRevoked === true, `status=${revokeAgain.status}`);
    const postAfterRevoke = await call("POST", `/me/assist/${delId}/items`, EA_ID, {
      kind: "timesheet_entry",
      payload: { workDate: "2026-07-15", hours: 1 },
    });
    check("new item after revoke \u2192 404", postAfterRevoke.status === 404, `status=${postAfterRevoke.status}`);

    // A leftover rejected item cannot be edited/resubmitted once revoked:
    // create a fresh grant + item, reject it, then revoke and try.
    const grant2 = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EA_ID,
      scopes: ["expenses"],
    });
    const del2 = grant2.body?.delegation?.id as string;
    if (del2) delegationIds.push(del2);
    const item2 = await call("POST", `/me/assist/${del2}/items`, EA_ID, {
      kind: "expense",
      payload: { merchant: "Test Diner", amount: 10, expenseDate: "2026-07-15" },
    });
    const item2Id = item2.body?.item?.id as string;
    if (item2Id) itemIds.push(item2Id);
    await call("POST", `/me/delegates/review/${item2Id}/reject`, PTR_ID, { reason: "hold" });
    await call("POST", `/me/delegates/${del2}/revoke`, PTR_ID);
    const editAfterRevoke = await call("PATCH", `/me/assist/items/${item2Id}`, EA_ID, {
      payload: { merchant: "Test Diner", amount: 11, expenseDate: "2026-07-15" },
    });
    const resubAfterRevoke = await call("POST", `/me/assist/items/${item2Id}/resubmit`, EA_ID);
    check(
      "edit + resubmit blocked after revoke \u2192 403",
      editAfterRevoke.status === 403 && resubAfterRevoke.status === 403,
      `edit=${editAfterRevoke.status} resubmit=${resubAfterRevoke.status}`,
    );

    // =====================================================================
    group("auto-revoke on deactivation");
    // =====================================================================
    const grant3 = await call("POST", "/me/delegates", PTR_ID, {
      eaUserId: EA_ID,
      scopes: ["timesheets"],
    });
    const del3 = grant3.body?.delegation?.id as string;
    if (del3) delegationIds.push(del3);
    const [hrUser] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, HR_ID));
    const revoked = await autoRevokeDelegationsForUser({
      orgId: ORG,
      userId: EA_ID,
      actor: hrUser,
      targetName: "Test EA",
    });
    check("auto-revoke revokes the active grant", revoked === 1, `revoked=${revoked}`);
    const [del3Row] = await db
      .select()
      .from(atelierEaDelegations)
      .where(eq(atelierEaDelegations.id, del3));
    check(
      "auto-revoked grant carries reason ea_deactivated",
      del3Row?.status === "revoked" && del3Row?.revokedReason === "ea_deactivated",
      JSON.stringify(del3Row)?.slice(0, 200),
    );
    const survivorNotif = await db
      .select()
      .from(atelierSelfNotifications)
      .where(
        and(
          eq(atelierSelfNotifications.userId, PTR_ID),
          eq(atelierSelfNotifications.kind, "ea_delegation_revoked"),
        ),
      );
    check("partner notified of the auto-revoke", survivorNotif.length >= 1, `n=${survivorNotif.length}`);
  } finally {
    // --- cleanup: every row this suite created ---
    try {
      const personaIds = [PTR_ID, PTR2_ID, EA_ID, EMP_ID, HR_ID];
      if (itemIds.length) {
        await db
          .delete(atelierAuditEvents)
          .where(
            and(
              eq(atelierAuditEvents.entityType, "ea_pending_item"),
              inArray(atelierAuditEvents.entityId, itemIds),
            ),
          );
        await db.delete(atelierEaPendingItems).where(inArray(atelierEaPendingItems.id, itemIds));
      }
      if (delegationIds.length) {
        await db
          .delete(atelierAuditEvents)
          .where(
            and(
              eq(atelierAuditEvents.entityType, "ea_delegation"),
              inArray(atelierAuditEvents.entityId, delegationIds),
            ),
          );
        await db.delete(atelierEaDelegations).where(inArray(atelierEaDelegations.id, delegationIds));
      }
      await db.delete(atelierTimesheetEntries).where(eq(atelierTimesheetEntries.personId, `emp_ptr_${STAMP}`));
      await db.delete(atelierTimesheetWeeks).where(eq(atelierTimesheetWeeks.personId, `emp_ptr_${STAMP}`));
      await db.delete(atelierExpenses).where(eq(atelierExpenses.personId, PTR_ID));
      for (const uid of personaIds) {
        await db.delete(atelierSelfNotifications).where(eq(atelierSelfNotifications.userId, uid));
      }
      await db
        .delete(atelierEmployees)
        .where(inArray(atelierEmployees.id, [`emp_ptr_${STAMP}`, `emp_ea_${STAMP}`, `emp_emp_${STAMP}`]));
      // Safety sweep: any leftover rows tagged with this stamp's personas.
      await db.delete(atelierEaDelegations).where(like(atelierEaDelegations.partnerUserId, `p_test_%_${STAMP}`));
      await db.delete(atelierEaPendingItems).where(like(atelierEaPendingItems.eaUserId, `p_test_%_${STAMP}`));
      for (const uid of personaIds) {
        await db.delete(atelierUsers).where(eq(atelierUsers.id, uid));
      }
    } catch (err) {
      console.error("cleanup failed:", err);
    }
    server.close();
    await pool.end();
  }

  console.log(
    failures.length === 0
      ? "\n\u2713 ea-delegation probe: all checks passed"
      : `\n\u2717 ea-delegation probe: ${failures.length} failed:\n  - ${failures.join("\n  - ")}`,
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
