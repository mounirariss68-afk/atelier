/**
 * Task #1341 — authenticated integration coverage for roster removal.
 * Run with: NODE_ENV=test pnpm exec tsx tests/crm/roster-removal-integration.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "./scratch-db.js";
import type { AddressInfo } from "node:net";
import { eq, inArray } from "drizzle-orm";

const stamp = Date.now();
const ORG = "aico";
const actorId = `p_rm_actor_${stamp}`;
const empId = `emp_rm_emp_${stamp}`;
const conId = `con_rm_con_${stamp}`;
const depId = `emp_rm_dep_${stamp}`;
const archiveId = `emp_rm_arc_${stamp}`;
const userId = `p_rm_user_${stamp}`;
const archiveUserId = `p_rm_arcuser_${stamp}`;
const foreignEmpId = `emp_rm_foreign_${stamp}`;
const foreignUserId = `p_rm_foreign_${stamp}`;
const resourceId = `res_rm_resource_${stamp}`;
const credential = (email: string, user: string) => ({
  email, userId: user, passwordHash: "test-hash", mustChangePassword: false,
});
let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
}

async function main() {
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierEmployees, atelierContractors,
    atelierPartnerFirmResources,
    atelierAuthCredentials, atelierAuthSessions, atelierLoginActivationTokens,
    atelierEngagementAccess, atelierPersonDocuments,
  } = D as any;
  const app = (await import("../../src/app.js")).default;
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const port = (server.address() as AddressInfo).port;
  const api = `http://127.0.0.1:${port}/api/atelier`;
  async function call(method: string, path: string, body?: unknown) {
    const response = await fetch(`${api}${path}`, {
      method, headers: { "content-type": "application/json", cookie: `atelier_persona=${actorId}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }
  try {
    await db.insert(atelierUsers).values([
      { id: actorId, orgId: ORG, email: `${actorId}@cognirise.ai`, name: "Removal Actor", initials: "RA", role: "partner", roleLabel: "Partner", title: "Partner", permissions: [] },
      { id: userId, orgId: ORG, email: `${userId}@cognirise.ai`, name: "Pristine Employee", initials: "PE", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
      { id: archiveUserId, orgId: ORG, email: `${archiveUserId}@cognirise.ai`, name: "Archive Employee", initials: "AE", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
      { id: foreignUserId, orgId: "foreign_org", email: `${foreignUserId}@other.example`, name: "Foreign Employee", initials: "FE", role: "employee", roleLabel: "Employee", title: "Employee", permissions: [] },
    ]);
    await db.insert(atelierEmployees).values([
      { id: empId, orgId: ORG, userId, fullName: "Pristine Employee", email: `${userId}@cognirise.ai`, role: "employee" },
      { id: depId, orgId: ORG, fullName: "History Employee", email: `hist_${stamp}@cognirise.ai`, role: "employee" },
      { id: archiveId, orgId: ORG, userId: archiveUserId, fullName: "Archive Employee", email: `${archiveUserId}@cognirise.ai`, role: "employee" },
      { id: foreignEmpId, orgId: "foreign_org", userId: foreignUserId, fullName: "Foreign Employee", email: `${foreignUserId}@other.example`, role: "employee" },
    ]);
    await db.insert(atelierContractors).values({
      id: conId, orgId: ORG, fullName: "Pristine Contractor", email: `contractor_${stamp}@cognirise.ai`,
    });
    await db.insert(atelierPartnerFirmResources).values({
      id: resourceId, orgId: ORG, partnerFirmId: `firm_${stamp}`, fullName: "Unsupported Resource",
      email: `resource_${stamp}@other.example`,
    });
    await db.insert(atelierAuthCredentials).values([
      credential(`${archiveUserId}@cognirise.ai`, archiveUserId),
      credential(`${userId}@cognirise.ai`, userId),
      credential(`${foreignUserId}@other.example`, foreignUserId),
    ]);
    await db.insert(atelierAuthSessions).values({
      tokenHash: `session_${stamp}`, userId: archiveUserId, email: `${archiveUserId}@cognirise.ai`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(atelierLoginActivationTokens).values({
      id: `activation_${stamp}`, userId: archiveUserId, email: `${archiveUserId}@cognirise.ai`,
      tokenHash: `activation_hash_${stamp}`, expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(atelierAuthSessions).values({
      tokenHash: `foreign_session_${stamp}`, userId: foreignUserId, email: `${foreignUserId}@other.example`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(atelierLoginActivationTokens).values({
      tokenHash: `foreign_activation_hash_${stamp}`, userId: foreignUserId, email: `${foreignUserId}@other.example`,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    await db.insert(atelierEngagementAccess).values({
      id: `access_${stamp}`, engagementId: `eng_${stamp}`, userId: archiveUserId, grantedByUserId: actorId,
    });
    await db.insert(atelierEngagementAccess).values({
      id: `foreign_access_${stamp}`, engagementId: `foreign_eng_${stamp}`, userId: foreignUserId, grantedByUserId: actorId,
    });
    await db.insert(atelierPersonDocuments).values({
      id: `doc_${stamp}`, orgId: ORG, personType: "employee", personId: depId,
      kind: "other", title: "History document", uploadedByUserId: actorId,
    });

    let r = await call("GET", `/roster/people/${empId}/removal-check`);
    check("pristine employee eligible", r.status === 200 && r.body?.eligible === true, r);
    r = await call("DELETE", `/roster/people/${empId}`, { confirmName: "Wrong Name" });
    check("wrong exact name rejected", r.status === 400, r);
    r = await call("DELETE", `/roster/people/${empId}`, { confirmName: "Pristine Employee" });
    check("pristine employee deleted", r.status === 200, r);
    r = await call("GET", `/roster/people/${conId}/removal-check`);
    check("pristine contractor eligible", r.status === 200 && r.body?.eligible === true, r);
    r = await call("DELETE", `/roster/people/${conId}`, { confirmName: "Pristine Contractor" });
    check("pristine contractor deleted", r.status === 200, r);
    r = await call("GET", `/roster/people/${depId}/removal-check`);
    check("operational dependency blocks eligibility", r.status === 200 && r.body?.eligible === false, r);
    r = await call("DELETE", `/roster/people/${depId}`, { confirmName: "History Employee" });
    check("dependency blocks DELETE with 409", r.status === 409, r);
    r = await call("POST", `/roster/people/${archiveId}/archive`, { confirmName: "Archive Employee" });
    check("archive succeeds", r.status === 200, r);
    const [archived] = await db.select().from(atelierEmployees).where(eq(atelierEmployees.id, archiveId));
    const [cred] = await db.select().from(atelierAuthCredentials).where(eq(atelierAuthCredentials.userId, archiveUserId));
    const sessions = await db.select().from(atelierAuthSessions).where(eq(atelierAuthSessions.userId, archiveUserId));
    const grants = await db.select().from(atelierEngagementAccess).where(eq(atelierEngagementAccess.userId, archiveUserId));
    const activations = await db.select().from(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.userId, archiveUserId));
    check("archive marks offboarded", archived?.status === "offboarded" && archived?.employmentStatus === "terminated");
    check("archive disables credential", cred?.disabled === true);
    check("archive revokes all access/session/token rows", sessions.length === 0 && activations.length === 0 && grants.every((g: any) => g.status === "revoked" && g.deletedAt));

    // Demo fixture is supplied by seed-auth in normal startup; if absent in a
    // stripped test database, the protected identity is still exercised by the
    // route's stable id/email guard through this minimal row.
    await db.insert(atelierEmployees).values({ id: "emp_demo_reviewer", orgId: ORG, userId: "p_demo_reviewer", fullName: "Max Headrom", email: "demo@cognirise.ai", role: "employee" }).onConflictDoNothing();
    r = await call("GET", "/roster/people/emp_demo_reviewer/removal-check");
    check("demo preflight protected and ineligible", r.status === 200 && r.body?.protected === true && r.body?.eligible === false, r);
    r = await call("POST", "/roster/people/emp_demo_reviewer/archive", { confirmName: "Max Headrom" });
    check("demo archive rejected", r.status === 403, r);
    r = await call("DELETE", "/roster/people/emp_demo_reviewer", { confirmName: "Max Headrom" });
    check("demo delete rejected", r.status === 403, r);
    r = await call("PATCH", "/roster/people/emp_demo_reviewer/demographics", { gender: "unspecified" });
    check("demo roster mutation rejected", r.status === 403, r);
    r = await call("GET", `/roster/people/${foreignEmpId}/removal-check`);
    check("foreign roster is non-oracular 404", r.status === 404, r);
    r = await call("POST", `/roster/people/${foreignEmpId}/archive`, { confirmName: "Foreign Employee" });
    check("foreign archive cannot mutate", r.status === 404, r);
    r = await call("DELETE", `/roster/people/${foreignEmpId}`, { confirmName: "Foreign Employee" });
    check("foreign delete cannot mutate", r.status === 404, r);
    const foreignCred = await db.select().from(atelierAuthCredentials).where(eq(atelierAuthCredentials.userId, foreignUserId));
    const foreignSessions = await db.select().from(atelierAuthSessions).where(eq(atelierAuthSessions.userId, foreignUserId));
    const foreignActivations = await db.select().from(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.userId, foreignUserId));
    const foreignGrants = await db.select().from(atelierEngagementAccess).where(eq(atelierEngagementAccess.userId, foreignUserId));
    check("foreign linked auth/access rows untouched", foreignCred.length === 1 && foreignSessions.length === 1 && foreignActivations.length === 1 && foreignGrants.length === 1);
    r = await call("GET", `/roster/people/${resourceId}/removal-check`);
    check("partner-firm resource rejected", r.status === 422, r);
    r = await call("POST", `/roster/people/${resourceId}/archive`, { confirmName: "Unsupported Resource" });
    check("partner-firm archive rejected", r.status === 422, r);
    r = await call("DELETE", `/roster/people/${resourceId}`, { confirmName: "Unsupported Resource" });
    check("partner-firm delete rejected", r.status === 422, r);
  } finally {
    await db.delete(atelierPersonDocuments).where(eq(atelierPersonDocuments.id, `doc_${stamp}`));
    await db.delete(atelierEngagementAccess).where(eq(atelierEngagementAccess.id, `access_${stamp}`));
    await db.delete(atelierEngagementAccess).where(eq(atelierEngagementAccess.id, `foreign_access_${stamp}`));
    await db.delete(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.tokenHash, `activation_hash_${stamp}`));
    await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.tokenHash, `session_${stamp}`));
    await db.delete(atelierAuthSessions).where(eq(atelierAuthSessions.tokenHash, `foreign_session_${stamp}`));
    await db.delete(atelierLoginActivationTokens).where(eq(atelierLoginActivationTokens.tokenHash, `foreign_activation_hash_${stamp}`));
    await db.delete(atelierAuthCredentials).where(inArray(atelierAuthCredentials.userId, [userId, archiveUserId]));
    await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [empId, depId, archiveId]));
    await db.delete(atelierContractors).where(eq(atelierContractors.id, conId));
    await db.delete(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.id, resourceId));
    await db.delete(atelierEmployees).where(eq(atelierEmployees.id, foreignEmpId));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [actorId, userId, archiveUserId, foreignUserId]));
    server.close();
    await pool.end();
  }
  if (failures) process.exitCode = 1;
}
main().catch((error) => { console.error(error); process.exitCode = 1; });