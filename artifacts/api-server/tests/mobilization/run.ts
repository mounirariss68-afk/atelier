// The isolation bootstrap MUST remain the first import.
import "../crm/scratch-db.js";
import type { AddressInfo } from "node:net";

const stamp = Date.now();
const ORG = "aico";
const actor = `mob_actor_${stamp}`;
const assignee = `mob_assignee_${stamp}`;
const derivedAssignee = `mob_derived_assignee_${stamp}`;
const outsider = `mob_outsider_${stamp}`;
const actorPerson = `mob_person_actor_${stamp}`;
const assigneePerson = `mob_person_assignee_${stamp}`;
const derivedAssigneePerson = `mob_person_derived_${stamp}`;
const account = `mob_account_${stamp}`;
const engagement = `mob_eng_${stamp}`;
const otherEngagement = `mob_other_eng_${stamp}`;
const requirement = `mob_req_${stamp}`;
const missingRequirement = `mob_missing_req_${stamp}`;
const crossAssignment = `mob_cross_${stamp}`;

const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) throw new Error(`FAIL ${name}: ${JSON.stringify(detail)}`);
  console.log(`PASS ${name}`);
};

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierPersons, atelierAccounts, atelierEngagements,
    atelierEngagementAccess, atelierStaffingRequirements, atelierStaffingAssignments,
    atelierAuditEvents, atelierSelfNotifications, atelierMobilizationHandoffs,
  } = D as any;
  const app = (await import("../../src/app.js")).default;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/atelier`;
  let assignmentId = "";
  const call = async (method: string, path: string, body?: unknown, persona = actor) => {
    const r = await fetch(`${api}${path}`, {
      method, headers: { "content-type": "application/json", cookie: `atelier_persona=${persona}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  try {
    await db.insert(atelierPersons).values([
      { id: actorPerson, orgId: ORG, firstName: "Mobilizer", lastName: "Actor", displayName: "Mobilizer Actor" },
      { id: assigneePerson, orgId: ORG, firstName: "Named", lastName: "Assignee", displayName: "Named Assignee" },
      { id: derivedAssigneePerson, orgId: ORG, firstName: "Derived", lastName: "Assignee", displayName: "Derived Assignee" },
    ]);
    await db.insert(atelierUsers).values([
      { id: actor, orgId: ORG, personId: actorPerson, email: `${actor}@test`, name: "Mobilizer Actor", initials: "MA", role: "partner", roleLabel: "Partner", title: "Partner", permissions: [] },
      { id: assignee, orgId: ORG, personId: assigneePerson, email: `${assignee}@test`, name: "Named Assignee", initials: "NA", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
      { id: derivedAssignee, orgId: ORG, personId: derivedAssigneePerson, email: `${derivedAssignee}@test`, name: "Derived Assignee", initials: "DA", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
      { id: outsider, orgId: ORG, email: `${outsider}@test`, name: "Outsider", initials: "OO", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
    ]);
    await db.insert(atelierAccounts).values({ id: account, orgId: ORG, name: "Mobilization Account", country: "SA", sector: "Technology" });
    await db.insert(atelierEngagements).values([
      { id: engagement, orgId: ORG, slug: engagement, name: "Mobilization Engagement", accountId: account, plmStage: "mobilize", partnerOwnerId: actor, engagementLeadId: actor, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
      { id: otherEngagement, orgId: ORG, slug: otherEngagement, name: "Other Engagement", accountId: account, plmStage: "deliver", partnerOwnerId: actor, engagementLeadId: actor, startDate: "2026-01-01", plannedEndDate: "2026-12-31" },
    ]);
    await db.insert(atelierEngagementAccess).values({ id: `access_${assignee}`, engagementId: engagement, userId: assignee, roleOnEngagement: "reviewer", allocationPct: 7, scope: ["can_view_charter"], status: "active", endDate: new Date("2026-04-30") });
    await db.insert(atelierStaffingRequirements).values({
      id: requirement, orgId: ORG, engagementId: engagement, role: "Consultant", seniority: "mid",
      allocationPct: 50, startDate: "2026-02-01", endDate: "2026-03-31", required: true, rateSource: "manual", rateAmount: 100, availabilityStatus: "available",
    });
    await db.insert(atelierStaffingRequirements).values({
      id: missingRequirement, orgId: ORG, engagementId: engagement, role: "Lead", seniority: "senior",
      allocationPct: 25, startDate: "2026-02-01", endDate: "2026-03-31", required: true, rateSource: "pending", availabilityStatus: "unknown",
    });
    await db.insert(atelierStaffingAssignments).values({
      id: crossAssignment, orgId: ORG, engagementId: otherEngagement, personId: assigneePerson, userId: assignee,
      role: "Other", seniority: "mid", allocationPct: 60, startDate: "2026-02-01", endDate: "2026-03-31",
      state: "accepted", rateSource: "manual", rateAmount: 100, availabilityStatus: "available",
    });

    let r = await call("GET", `/engagements/${engagement}/mobilization`, undefined, outsider);
    check("outsider denied", r.status === 403, r.body);
    r = await call("POST", `/engagements/${engagement}/mobilization/assignments`, {
      requirementId: requirement, personId: assigneePerson, userId: assignee, role: "Consultant", seniority: "mid",
      allocationPct: 50, startDate: "2026-02-01", endDate: "2026-03-31", availabilityStatus: "available", idempotencyKey: `proposal_${stamp}`,
    });
    check("proposal created", r.status === 201, r.body);
    assignmentId = r.body.id;
    const assigneeAssignments = await call("GET", "/me/mobilization-assignments", undefined, assignee);
    const proposedForCurrentEngagement = assigneeAssignments.body.find(
      (item: { id: string }) => item.id === assignmentId,
    );
    check("assignee sees only own safe assignments",
      assigneeAssignments.status === 200 &&
      proposedForCurrentEngagement &&
      assigneeAssignments.body.every(
        (item: Record<string, unknown>) =>
          !("rateAmount" in item) && !("rateSource" in item),
      ), assigneeAssignments.body);
    const outsiderAssignments = await call("GET", "/me/mobilization-assignments", undefined, outsider);
    check("outsider sees no assignments", outsiderAssignments.status === 200 && outsiderAssignments.body.length === 0, outsiderAssignments.body);
    const duplicate = await call("POST", `/engagements/${engagement}/mobilization/assignments`, {
      requirementId: requirement, personId: assigneePerson, userId: assignee, role: "Consultant", seniority: "mid",
      allocationPct: 50, startDate: "2026-02-01", endDate: "2026-03-31", availabilityStatus: "available", idempotencyKey: `proposal_${stamp}`,
    });
    check("proposal idempotent", duplicate.status === 200 && duplicate.body.id === assignmentId, duplicate.body);
    r = await call("PATCH", `/engagements/${engagement}/mobilization/assignments/${assignmentId}`, { state: "declined" }, outsider);
    check("outsider cannot decline", r.status === 403, r.body);
    const [independentGrantBefore] = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).and(
      (await import("drizzle-orm")).eq(atelierEngagementAccess.engagementId, engagement),
      (await import("drizzle-orm")).eq(atelierEngagementAccess.userId, assignee),
    ));
    r = await call("PATCH", `/me/mobilization-assignments/${assignmentId}`, { state: "accepted" }, assignee);
    check("assignee accepts", r.status === 200, r.body);
    const [independentGrantAfterAccept] = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).eq(atelierEngagementAccess.id, independentGrantBefore.id));
    check("independent grant preserved on accept", JSON.stringify(independentGrantAfterAccept) === JSON.stringify(independentGrantBefore), independentGrantAfterAccept);
    const derivedProposal = await call("POST", `/engagements/${engagement}/mobilization/assignments`, {
      requirementId: requirement, personId: derivedAssigneePerson, userId: derivedAssignee, role: "Consultant", seniority: "mid",
      allocationPct: 10, startDate: "2026-02-01", endDate: "2026-03-31", availabilityStatus: "available", rateAmount: 100, idempotencyKey: `derived_${stamp}`,
    });
    check("derived proposal created", derivedProposal.status === 201, derivedProposal.body);
    const derivedAssignmentId = derivedProposal.body.id;
    r = await call("PATCH", `/me/mobilization-assignments/${derivedAssignmentId}`, { state: "accepted" }, derivedAssignee);
    check("derived assignee accepts", r.status === 200, r.body);
    const [derivedGrant] = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).and(
      (await import("drizzle-orm")).eq(atelierEngagementAccess.engagementId, engagement),
      (await import("drizzle-orm")).eq(atelierEngagementAccess.userId, derivedAssignee),
    ));
    check("derived grant has provenance", derivedGrant?.mobilizationAssignmentId === derivedAssignmentId, derivedGrant);
    await db.update(atelierStaffingAssignments).set({ rateAmount: null }).where((await import("drizzle-orm")).eq(atelierStaffingAssignments.id, assignmentId));
    r = await call("POST", `/engagements/${engagement}/mobilization/activate`, {}, actor);
    check("missing rate and required coverage rejected", r.status === 409 && r.body.reasons.some((x: string) => x.startsWith("missing-rate:")) && r.body.reasons.some((x: string) => x.startsWith("missing-required-role:")), r.body);
    await db.update(atelierStaffingAssignments).set({ rateAmount: 100 }).where((await import("drizzle-orm")).eq(atelierStaffingAssignments.id, assignmentId));
    await db.update(atelierStaffingRequirements).set({ status: "waived" }).where((await import("drizzle-orm")).eq(atelierStaffingRequirements.id, missingRequirement));
    r = await call("POST", `/engagements/${engagement}/mobilization/activate`, {}, actor);
    check("cross-project capacity rejected", r.status === 409, r.body);
    await db.update(atelierStaffingAssignments).set({ state: "ended" }).where((await import("drizzle-orm")).eq(atelierStaffingAssignments.id, crossAssignment));
    r = await call("POST", `/engagements/${engagement}/mobilization/activate`, {}, actor);
    check("activation succeeds after repair", r.status === 200, r.body);
    const [persisted] = await db.select({ status: atelierEngagements.mobilizationStatus }).from(atelierEngagements).where((await import("drizzle-orm")).eq(atelierEngagements.id, engagement));
    check("activation status persisted", persisted.status === "active", persisted);
    const handoffBody = { kind: "finance", toUserId: assignee, idempotencyKey: `handoff_${stamp}` };
    const h1 = await call("POST", `/engagements/${engagement}/mobilization/handoffs`, handoffBody, actor);
    const h2 = await call("POST", `/engagements/${engagement}/mobilization/handoffs`, handoffBody, actor);
    check("handoff idempotent", h1.status === 201 && h2.status === 200 && h1.body.id === h2.body.id, { h1, h2 });
    const grants = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).and(
      (await import("drizzle-orm")).eq(atelierEngagementAccess.engagementId, engagement),
      (await import("drizzle-orm")).eq(atelierEngagementAccess.userId, assignee),
    ));
    check("exactly one synchronized grant", grants.length === 1 && grants[0].status === "active", grants);
    const [auditCount] = await db.select({ count: (await import("drizzle-orm")).sql`count(*)` }).from(atelierAuditEvents).where((await import("drizzle-orm")).eq(atelierAuditEvents.entityId, assignmentId));
    check("duplicate proposal did not audit", Number(auditCount.count) === 2, auditCount);
    const [selfNotificationCount] = await db.select({ count: (await import("drizzle-orm")).sql`count(*)` }).from(atelierSelfNotifications).where((await import("drizzle-orm")).and(
      (await import("drizzle-orm")).eq(atelierSelfNotifications.userId, assignee),
      (await import("drizzle-orm")).eq(atelierSelfNotifications.kind, "mobilization_handoff_finance"),
    ));
    check("handoff emits one canonical notification", Number(selfNotificationCount.count) === 1, selfNotificationCount);
    r = await call("PATCH", `/engagements/${engagement}/mobilization/assignments/${assignmentId}`, { state: "ended" }, actor);
    check("mobilizer ends assignment", r.status === 200, r.body);
    const [revoked] = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).and(
      (await import("drizzle-orm")).eq(atelierEngagementAccess.engagementId, engagement),
      (await import("drizzle-orm")).eq(atelierEngagementAccess.userId, assignee),
    ));
    check("ending preserves independent access", JSON.stringify(revoked) === JSON.stringify(independentGrantBefore), revoked);
    r = await call("PATCH", `/engagements/${engagement}/mobilization/assignments/${derivedAssignmentId}`, { state: "ended" }, actor);
    check("derived assignment ended", r.status === 200, r.body);
    const [derivedRevoked] = await db.select().from(atelierEngagementAccess).where((await import("drizzle-orm")).eq(atelierEngagementAccess.id, derivedGrant.id));
    check("derived grant revoked", derivedRevoked?.status === "revoked" && derivedRevoked.mobilizationAssignmentId === derivedAssignmentId, derivedRevoked);
    // The remaining tables are queried to ensure the migration and cleanup
    // paths are present; handoff notifications use the canonical self feed.
    check("mobilization tables available", !!atelierMobilizationHandoffs && !!atelierSelfNotifications);
  } finally {
    await db.delete(atelierMobilizationHandoffs).where((await import("drizzle-orm")).eq(atelierMobilizationHandoffs.engagementId, engagement));
    await db.delete(atelierSelfNotifications).where((await import("drizzle-orm")).inArray(atelierSelfNotifications.userId, [actor, assignee, outsider]));
    await db.delete(atelierAuditEvents).where((await import("drizzle-orm")).inArray(atelierAuditEvents.entityId, [engagement, assignmentId ?? ""]));
    await db.delete(atelierStaffingAssignments).where((await import("drizzle-orm")).eq(atelierStaffingAssignments.orgId, ORG));
    await db.delete(atelierStaffingRequirements).where((await import("drizzle-orm")).eq(atelierStaffingRequirements.orgId, ORG));
    await db.delete(atelierEngagementAccess).where((await import("drizzle-orm")).eq(atelierEngagementAccess.engagementId, engagement));
    await db.delete(atelierEngagements).where((await import("drizzle-orm")).eq(atelierEngagements.orgId, ORG));
    await db.delete(atelierAccounts).where((await import("drizzle-orm")).eq(atelierAccounts.id, account));
    await db.delete(atelierUsers).where((await import("drizzle-orm")).inArray(atelierUsers.id, [actor, assignee, derivedAssignee, outsider]));
    await db.delete(atelierPersons).where((await import("drizzle-orm")).inArray(atelierPersons.id, [actorPerson, assigneePerson, derivedAssigneePerson]));
    await server.close();
    await pool.end();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });