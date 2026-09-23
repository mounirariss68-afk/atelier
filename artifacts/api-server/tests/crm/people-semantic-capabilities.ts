/**
 * Focused DB-backed probe for Task #1413.
 * Run: pnpm exec tsx tests/crm/people-semantic-capabilities.ts
 */
import "./scratch-db.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierPersons,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirmResources,
  atelierContacts,
  atelierRosterReportsTo,
} from "@workspace/db";
import { findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/people-semantic-capabilities.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
};

const suffix = Date.now().toString(36);
const org = `people-sem-${suffix}`;
const otherOrg = `people-other-${suffix}`;
const fullUser = `user-founder-${suffix}`;
const managerUser = `user-manager-${suffix}`;
const managerId = `emp-manager-${suffix}`;
const employeeId = `emp-alex-${suffix}`;
const employee2Id = `emp-alex2-${suffix}`;
const contractorId = `con-alex-${suffix}`;
const terminalId = `emp-terminal-${suffix}`;
const outsideId = `emp-outside-${suffix}`;
const poisonedId = `emp-poisoned-${suffix}`;
const employeePersonId = `person-employee-${suffix}`;
const employee2PersonId = `person-employee2-${suffix}`;
const contractorPersonId = `person-contractor-${suffix}`;
const terminalPersonId = `person-terminal-${suffix}`;
const managerPersonId = `person-manager-${suffix}`;
const foreignPersonId = `person-foreign-${suffix}`;
const partnerResourceId = `resource-alex-${suffix}`;
const contactId = `contact-alex-${suffix}`;
const edgeIds = [`edge-1-${suffix}`, `edge-2-${suffix}`, `edge-3-${suffix}`];

const cap = findByToolName("people_relationships")!;
const context = (role: string, id = managerUser, orgId = org) => ({
  persona: { id, name: role, role, orgId },
}) as any;
const run = (input: Record<string, unknown>, role = "founding_partner", id = fullUser, orgId = org) =>
  cap.run(input, context(role, id, orgId));

try {
  await db.insert(atelierUsers).values([
    {
      id: fullUser, orgId: org, email: `${fullUser}@example.test`, name: "Founder",
      initials: "F", role: "founding_partner", roleLabel: "Founding Partner",
      title: "Founder", permissions: [], bdActive: false,
    },
    {
    id: managerUser, orgId: org, email: `${managerUser}@example.test`, name: "Manager",
    initials: "M", role: "senior_manager", roleLabel: "Senior Manager",
    title: "Senior Manager", permissions: [], bdActive: false,
    },
  ]);
  await db.insert(atelierPersons).values([
    { id: managerPersonId, orgId: org, firstName: "Morgan", middleName: null, lastName: "Manager", preferredName: "Mo", displayName: "Morgan Manager", sourceKind: "employee" },
    { id: employeePersonId, orgId: org, firstName: "Alex", middleName: "R.", lastName: "Stone", preferredName: "Lex", displayName: "Alex R. Stone", sourceKind: "employee" },
    { id: employee2PersonId, orgId: org, firstName: "Alex", middleName: null, lastName: "Stone", preferredName: null, displayName: "Alex Stone", sourceKind: "employee" },
    { id: contractorPersonId, orgId: org, firstName: "Alex", middleName: null, lastName: "Stone", preferredName: "A", displayName: "Alex Stone", sourceKind: "contractor" },
    { id: terminalPersonId, orgId: org, firstName: "Former", middleName: null, lastName: "Worker", preferredName: null, displayName: "Former Worker", sourceKind: "employee" },
    { id: foreignPersonId, orgId: otherOrg, firstName: "Foreign", middleName: null, lastName: "Identity", preferredName: "Leaked", displayName: "Foreign Identity", sourceKind: "employee" },
  ]);
  await db.insert(atelierEmployees).values([
    { id: managerId, orgId: org, userId: managerUser, personId: managerPersonId, fullName: "Morgan Manager", email: "manager@example.test", role: "senior_manager", title: "Senior Manager", notes: "private", gender: "female", nationality: "AE" },
    { id: employeeId, orgId: org, userId: null, personId: employeePersonId, fullName: "Alex R. Stone", preferredName: "Lex", email: "alex1@example.test", role: "employee", title: "Analyst", notes: "private", gender: "male", nationality: "AE" },
    { id: employee2Id, orgId: org, userId: null, personId: employee2PersonId, fullName: "Alex Stone", email: "alex2@example.test", role: "employee", title: "Consultant", notes: "private", gender: "male", nationality: "AE" },
    { id: terminalId, orgId: org, userId: null, personId: terminalPersonId, fullName: "Former Worker", email: "former@example.test", role: "employee", title: "Former", status: "offboarded" },
    { id: outsideId, orgId: otherOrg, userId: null, fullName: "Outside Org", email: "outside@example.test", role: "employee", title: "Outside" },
    { id: poisonedId, orgId: org, userId: null, personId: foreignPersonId, fullName: "Safe Local", email: "safe-local@example.test", role: "employee", title: "Analyst" },
  ]);
  await db.insert(atelierContractors).values({
    id: contractorId, orgId: org, personId: contractorPersonId, fullName: "Alex Stone",
    email: "contractor@example.test", status: "active", notes: "private",
  });
  await db.insert(atelierPartnerFirmResources).values({
    id: partnerResourceId, orgId: org, partnerFirmId: `firm-${suffix}`,
    personId: contractorPersonId, fullName: "Alex Stone", email: "partner@example.test",
    role: "Partner resource",
  });
  await db.insert(atelierContacts).values({
    id: contactId, orgId: org, accountId: `account-${suffix}`,
    fullName: "Alex Stone", email: "contact@example.test",
  });
  await db.insert(atelierRosterReportsTo).values([
    { id: edgeIds[0]!, orgId: org, personId: employeeId, managerPersonId: managerId },
    { id: edgeIds[1]!, orgId: org, personId: employee2Id, managerPersonId: managerId },
    // Multi-manager edge: the same employee has another current manager.
    { id: edgeIds[2]!, orgId: org, personId: employeeId, managerPersonId: employee2Id },
  ]);

  const ambiguous = await run({ kind: "worker", query: "Alex Stone" });
  check("duplicate structured names remain ambiguous", (ambiguous as any).disambiguation?.kind === "worker" &&
    (ambiguous as any).data.options.length === 3, JSON.stringify(ambiguous));
  const contractor = await run({ kind: "worker", id: contractorId });
  const contractorRow = (contractor as any).data?.relationships?.[0];
  check("employee and contractor remain distinct", contractorRow?.workerType === "contractor" &&
    contractorRow.id === contractorId && contractorRow.personId === contractorPersonId, JSON.stringify(contractor));
  check("strict business allowlist omits sensitive fields",
    !!contractorRow && !("notes" in contractorRow) && !("gender" in contractorRow) && !("nationality" in contractorRow) &&
    !("iban" in contractorRow) && !("documents" in contractorRow));

  const line = await run({ kind: "reporting_line", id: employeeId });
  const lineData = (line as any).data;
  check("multi-manager direct edges are preserved", lineData.managers.length === 2 &&
    lineData.managers.some((p: any) => p.id === managerId) &&
    lineData.managers.some((p: any) => p.id === employee2Id));
  await db.update(atelierRosterReportsTo)
    .set({ managerPersonId: contractorId })
    .where(eq(atelierRosterReportsTo.id, edgeIds[2]!));
  const changedLine = await run({ kind: "reporting_line", id: employeeId });
  check("manager changes are read from the current edge set",
    (changedLine as any).data.managers.some((p: any) => p.id === contractorId) &&
    !(changedLine as any).data.managers.some((p: any) => p.id === employee2Id));

  const managerLine = await run({ kind: "reporting_line", id: managerId }, "senior_manager", managerUser);
  const managerData = (managerLine as any).data;
  check("manager sees only current visible direct reports",
    managerData.directReports.length === 2 &&
    managerData.directReports.every((p: any) => [employeeId, employee2Id].includes(p.id)));
  const outside = await run({ kind: "worker", id: outsideId }, "senior_manager");
  check("cross-org worker is not disclosed", (outside as any).ok === false && (outside as any).errorCode === "not_found");
  const terminal = await run({ kind: "worker", id: terminalId });
  check("terminal worker is excluded", (terminal as any).ok === false && (terminal as any).errorCode === "not_found");
  const denied = await run({ kind: "worker", id: employeeId }, "employee");
  check("self-only roles are denied organization semantics", (denied as any).errorCode === "forbidden");
  const resource = await run({ kind: "worker", id: partnerResourceId });
  check("partner resource is excluded", (resource as any).ok === false && (resource as any).errorCode === "not_found");
  const contact = await run({ kind: "worker", id: contactId });
  check("CRM contact is excluded", (contact as any).ok === false && (contact as any).errorCode === "not_found");
  const poisoned = await run({ kind: "worker", id: poisonedId });
  check("cross-org structured identity link is ignored",
    (poisoned as any).ok === true &&
    (poisoned as any).data.relationships[0].fullName === "Safe Local" &&
    !JSON.stringify(poisoned).includes("Foreign Identity") &&
    !JSON.stringify(poisoned).includes("Leaked"));
} finally {
  await db.delete(atelierRosterReportsTo).where(inArray(atelierRosterReportsTo.id, edgeIds));
  await db.delete(atelierContacts).where(eq(atelierContacts.id, contactId));
  await db.delete(atelierPartnerFirmResources).where(eq(atelierPartnerFirmResources.id, partnerResourceId));
  await db.delete(atelierContractors).where(eq(atelierContractors.id, contractorId));
  await db.delete(atelierEmployees).where(inArray(atelierEmployees.id, [
    managerId, employeeId, employee2Id, terminalId, outsideId, poisonedId,
  ]));
  await db.delete(atelierPersons).where(inArray(atelierPersons.id, [
    managerPersonId, employeePersonId, employee2PersonId, contractorPersonId, terminalPersonId,
    foreignPersonId,
  ]));
  await db.delete(atelierUsers).where(eq(atelierUsers.id, managerUser));
  await db.delete(atelierUsers).where(eq(atelierUsers.id, fullUser));
}

if (failures > 0) process.exitCode = 1;
else console.log("people semantic capability probe passed");