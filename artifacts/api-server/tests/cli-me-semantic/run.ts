/**
 * Focused probe for Task #1413's selector-free Me semantic composition.
 *
 * Run: pnpm exec tsx tests/cli-me-semantic/run.ts
 */
import "../crm/scratch-db.js";
import assert from "node:assert/strict";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  atelierContractors,
  atelierEmployees,
  atelierPersonDocuments,
  atelierUsers,
} from "@workspace/db";
import { findByToolName, capabilitiesForPersona } from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/me-capabilities.js";
import "../../src/lib/atelier-cli/me-task-capabilities.js";
import "../../src/lib/atelier-cli/me-write-capabilities.js";
import "../../src/lib/atelier-cli/me-semantic-capabilities.js";

const suffix = Date.now().toString(36);
const orgId = `me-semantic-${suffix}`;
const emp = { id: `me-semantic-employee-${suffix}`, name: "Employee", role: "employee", orgId };
const contractor = { id: `me-semantic-contractor-${suffix}`, name: "Contractor", role: "contractor", orgId };
const employeeRowId = `emp-${suffix}`;
const contractorRowId = `con-${suffix}`;
const localDocId = `doc-local-${suffix}`;
const foreignDocId = `doc-foreign-${suffix}`;
const cap = findByToolName("my_semantic_summary");
assert(cap, "semantic summary is registered");
assert.equal(cap.isWrite, false);
assert.equal(cap.twoPhaseConfirm, false);
assert.equal((cap.inputSchema as any).additionalProperties, false);
assert.deepEqual(Object.keys((cap.inputSchema as any).properties), ["sections"]);

const employeeTools = new Set(capabilitiesForPersona(emp as any).map((entry) => entry.toolName));
const contractorTools = new Set(capabilitiesForPersona(contractor as any).map((entry) => entry.toolName));
assert(employeeTools.has("my_semantic_summary"));
assert(contractorTools.has("my_semantic_summary"));

try {
  await db.insert(atelierUsers).values([
    {
      id: emp.id, orgId, email: `employee-${suffix}@example.test`, name: emp.name,
      initials: "E", role: emp.role, roleLabel: "Employee", title: "Employee",
    },
    {
      id: contractor.id, orgId, email: `contractor-${suffix}@example.test`,
      name: contractor.name, initials: "C", role: contractor.role,
      roleLabel: "Contractor", title: "Contractor",
    },
  ]);
  await db.insert(atelierEmployees).values({
    id: employeeRowId, orgId, userId: emp.id, fullName: "Employee Self",
    email: `employee-${suffix}@example.test`, role: "employee", title: "Consultant",
    notes: "private HR note", baseCompensation: 999999,
  });
  await db.insert(atelierContractors).values({
    id: contractorRowId, orgId, fullName: "Contractor Self",
    email: `contractor-${suffix}@example.test`, status: "active", notes: "private note",
    dayRateAmount: 5000,
  });
  await db.insert(atelierPersonDocuments).values([
    {
      id: localDocId, orgId, personType: "employee", personId: employeeRowId,
      kind: "passport", title: "Own passport", docNumber: "OWN-1",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    },
    {
      id: foreignDocId, orgId: `foreign-${orgId}`, personType: "employee",
      personId: employeeRowId, kind: "passport", title: "Foreign secret passport",
      docNumber: "FOREIGN-SECRET", expiresAt: new Date("2030-01-01T00:00:00Z"),
    },
  ]);

  const employeeDirect = findByToolName("my_profile")!;
  const employeeSummary = await cap.run({}, { persona: emp } as any);
  const directProfile = await employeeDirect.run({}, { persona: emp } as any);
  assert.equal(directProfile.ok, true);
  assert.equal(employeeSummary.ok, true);
  assert.equal((employeeSummary.data as any).selfScoped, true);
  assert.deepEqual(
    (employeeSummary.data as any).sections.profile.data,
    directProfile.data,
    "summary delegates profile without reshaping it",
  );
  const serialized = JSON.stringify(employeeSummary);
  assert.equal(serialized.includes("private HR note"), false);
  assert.equal(serialized.includes("999999"), false);
  assert.equal(serialized.includes("baseCompensation"), false);
  assert.equal(serialized.includes("Foreign secret passport"), false);
  assert.equal(serialized.includes("FOREIGN-SECRET"), false);
  assert.equal((employeeSummary.data as any).sections.documents.data.items.length, 1);
  assert.equal(
    (employeeSummary.data as any).sections.documents.data.items[0].expiresAt,
    "2027-01-01",
  );
  await db.update(atelierPersonDocuments)
    .set({ expiresAt: new Date("2028-02-02T00:00:00Z") })
    .where(eq(atelierPersonDocuments.id, localDocId));
  const refreshedDocuments = await cap.run(
    { sections: ["documents"] },
    { persona: emp } as any,
  );
  assert.equal(
    (refreshedDocuments.data as any).sections.documents.data.items[0].expiresAt,
    "2028-02-02",
    "document expiry is read from the current source row",
  );

  const selected = await cap.run({ sections: ["profile", "reviews"] }, { persona: contractor } as any);
  assert.equal(selected.ok, true);
  assert.equal((selected.data as any).sections.profile.available, true);
  assert.equal((selected.data as any).sections.profile.data.workerType, "contractor");
  assert.deepEqual(Object.keys((selected.data as any).sections).sort(), ["profile", "reviews"]);
  const contractorReviews = (selected.data as any).sections.reviews;
  assert(
    contractorReviews.available === false || contractorReviews.data?.applicable === false,
    "contractor performance stays unavailable or not-applicable through the underlying capability",
  );

  const hostile = await cap.run({
    sections: ["profile"],
    personId: "another-person",
    userId: "another-user",
    email: "another@example.com",
  } as any, { persona: emp } as any);
  assert.equal(hostile.ok, false);
  assert.equal(hostile.errorCode, "invalid_input");

  const unknownSection = await cap.run({ sections: ["people"] } as any, { persona: emp } as any);
  assert.equal(unknownSection.ok, false);
  assert.equal(unknownSection.errorCode, "invalid_input");
} finally {
  await db.delete(atelierPersonDocuments).where(inArray(
    atelierPersonDocuments.id,
    [localDocId, foreignDocId],
  ));
  await db.delete(atelierEmployees).where(eq(atelierEmployees.id, employeeRowId));
  await db.delete(atelierContractors).where(eq(atelierContractors.id, contractorRowId));
  await db.delete(atelierUsers).where(inArray(atelierUsers.id, [emp.id, contractor.id]));
}

console.log("me semantic capability probe passed");