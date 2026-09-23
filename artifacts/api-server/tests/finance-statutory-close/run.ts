/**
 * Task #1412 — focused DB-backed statutory/close capability probe.
 * Run with the CRM scratch-db harness; deliberately does not register through
 * bootstrap so this test remains focused on the new capability.
 */
import "../crm/scratch-db.js";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db, pool, atelierLegalEntities, atelierLegalEntityAliases, atelierDocuments,
  atelierDocumentVersions, atelierGlAccount, atelierGlJournalEntry,
  atelierGlJournalLine, atelierCloseCycle, atelierCloseItem,
  atelierPeriodCloseLock, atelierCloseAccrual,
} from "@workspace/db";
import { findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";
import type { ToolContext } from "../../src/lib/atelier-cli/index.js";
import { taxCertificateEvidenceStatus } from "../../src/lib/atelier-cli/finance-statutory-capabilities.js";

const org = `stat_${Date.now().toString(36)}`;
const entity = `ent_${org}`;
const archived = `arch_${org}`;
const docCt = `doc_ct_${org}`;
const docVat = `doc_vat_${org}`;
const verCt = `ver_ct_${org}`;
const verVat = `ver_vat_${org}`;
const acct2300 = `acct2300_${org}`;
const acct1400 = `acct1400_${org}`;
const journalUsd = `j_usd_${org}`;
const journalEur = `j_eur_${org}`;
const journalFile = `j_file_${org}`;
const cycleId = `cyc_${org}`;
const lockId = `lock_${org}`;
const accrualId = `accr_${org}`;
const period = "2026-Q1";
const ctx = (role: string): ToolContext => ({
  persona: { id: `u_${role}`, name: role, role, orgId: org } as ToolContext["persona"],
} as ToolContext);
const cap = findByToolName("finance_statutory_close_status")!;
assert(cap, "capability is registered");

await db.insert(atelierLegalEntities).values([
  { id: entity, orgId: org, legalNameEn: "Statutory Holdings LLC", legalNameAr: null, shortName: "StatHold", legalForm: "LLC", country: "AE", jurisdiction: "Dubai", status: "active", registeredAddress: "", officeAddress: "", governingLaw: "", courts: "", baseCurrency: "AED", registrations: [], fiscal: { vatPeriod: "quarterly", nextVatFilingDate: "2026-05-28", vatExpectedAmount: 100, nextCtFilingDate: "2027-01-01", ctExpectedAmount: 200, ctRatePct: 9 } },
  { id: archived, orgId: org, legalNameEn: "Old Archived LLC", legalNameAr: null, shortName: "Old", legalForm: "LLC", country: "AE", jurisdiction: "Dubai", status: "archived", registeredAddress: "", officeAddress: "", governingLaw: "", courts: "", baseCurrency: "AED", registrations: [] },
]);
await db.insert(atelierLegalEntityAliases).values({ id: `alias_${org}`, orgId: org, entityId: entity, alias: "Stat Hold", normalizedAlias: "stat hold", status: "active", createdBy: "test" });
await db.insert(atelierDocuments).values([
  { id: docCt, orgId: org, entityId: entity, title: "CT certificate", category: "other", docKind: "tax_registration_ct", uploaderUserId: "test" },
  { id: docVat, orgId: org, entityId: entity, title: "VAT certificate", category: "other", docKind: "tax_registration_vat", uploaderUserId: "test" },
]);
await db.insert(atelierDocumentVersions).values([
  { id: verCt, orgId: org, documentId: docCt, versionNumber: 1, fileName: "ct.pdf", mime: "application/pdf", sizeBytes: 1, sha256: `ctsha-${org}`, blobRef: "enc:doc:ct", uploaderUserId: "test" },
  { id: verVat, orgId: org, documentId: docVat, versionNumber: 1, fileName: "vat.pdf", mime: "application/pdf", sizeBytes: 1, sha256: `vatsha-${org}`, blobRef: "enc:doc:vat", uploaderUserId: "test" },
]);
await db.update(atelierDocuments).set({ currentVersionId: verCt }).where(eq(atelierDocuments.id, docCt));
await db.update(atelierDocuments).set({ currentVersionId: verVat }).where(eq(atelierDocuments.id, docVat));
await db.update(atelierLegalEntities).set({ registrations: [
  { id: "ct1", type: "tax_registration_ct", label: "CT", number: "CT-123", issuer: "FTA", issuedOn: "2025-01-02", expiresOn: "2026-12-31", notes: "CT note", certificateDocumentId: docCt },
  { id: "vat1", type: "tax_registration_vat", label: "VAT", number: "VAT-456", issuer: "FTA", issuedOn: "2025-02-03", expiresOn: "2027-01-31", notes: null, certificateDocumentId: docVat },
] }).where(eq(atelierLegalEntities.id, entity));
await db.insert(atelierGlAccount).values([
  { id: acct2300, orgId: org, legalEntityId: entity, code: "2300", name: "Output VAT", type: "liability", normalSide: "credit" },
  { id: acct1400, orgId: org, legalEntityId: entity, code: "1400", name: "Input VAT", type: "asset", normalSide: "debit" },
]);
await db.insert(atelierGlJournalEntry).values([
  { id: journalUsd, orgId: org, legalEntityId: entity, periodLabel: "2026-01", entryDate: "2026-01-10", sourceKind: "invoice", sourceRef: "i1", currency: "USD", totalCredit: 10 },
  { id: journalEur, orgId: org, legalEntityId: entity, periodLabel: "2026-02", entryDate: "2026-02-10", sourceKind: "expense", sourceRef: "x1", currency: "EUR", totalDebit: 20 },
  { id: journalFile, orgId: org, legalEntityId: entity, periodLabel: period, entryDate: "2026-03-31", sourceKind: "vat_return", sourceRef: `${entity}:${period}`, currency: "AED" },
]);
await db.insert(atelierGlJournalLine).values([
  { id: `l_usd_${org}`, orgId: org, journalEntryId: journalUsd, accountId: acct2300, accountCode: "2300", accountName: "Output VAT", credit: 10 },
  { id: `l_eur_${org}`, orgId: org, journalEntryId: journalEur, accountId: acct1400, accountCode: "1400", accountName: "Input VAT", debit: 20 },
]);
await db.insert(atelierCloseCycle).values({ id: cycleId, orgId: org, entityId: entity, periodType: "quarter", periodLabel: period, status: "ready" });
await db.insert(atelierCloseItem).values({ id: `item_${org}`, orgId: org, cycleId, phase: "execution", itemKey: "vat", title: "VAT return", status: "done" });
await db.insert(atelierPeriodCloseLock).values({ id: lockId, orgId: org, periodLabel: period, lockedModules: ["ledger"], lockedByUserId: "test" });
await db.insert(atelierCloseAccrual).values({ id: accrualId, orgId: org, cycleId, entityId: entity, periodLabel: period, memo: "CT provision", sourceKey: "ct_provision", amount: 200, currency: "AED", status: "proposed" });

const result = await cap.run({ entity: "Stat Hold", period }, ctx("finance"));
assert.equal(result.ok, true);
const data = result.data as any;
assert.equal(data.identity.kind, "legal_entity");
assert.equal(data.registrations.length, 2);
assert.equal(data.registrations[0].issuedOn, "2025-01-02");
assert.equal(data.registrations[0].certificate.status, "current");
assert.equal(data.registrations[1].certificate.status, "current");
assert.equal(data.period.vat.filed, true);
assert.deepEqual(Object.keys(data.period.vat.byCurrency).sort(), ["EUR", "USD"]);
assert.equal(data.period.vat.lines.length, 2);
assert.equal(data.period.close.lock.id, lockId);
assert.equal(data.period.close.ctProvision.status, "proposed");
assert.equal(taxCertificateEvidenceStatus({
  registrationType: "tax_registration_vat",
  document: { id: docVat, status: "active", docKind: "tax_registration_ct", currentVersionId: verVat },
  liveVersionPointers: new Set([`${docVat}:${verVat}`]),
}), "stale");
assert.equal(taxCertificateEvidenceStatus({
  registrationType: "tax_registration_vat",
  document: { id: docVat, status: "active", docKind: "tax_registration_vat", currentVersionId: verCt },
  liveVersionPointers: new Set([`${docCt}:${verCt}`]),
}), "stale");
assert.equal((await cap.run({ entity: archived, period }, ctx("finance"))).ok, false);
assert.equal((await cap.run({ entity: entity, period }, ctx("employee"))).errorCode, "forbidden");
console.log("PASS finance statutory close focused DB probe");
await pool.end();