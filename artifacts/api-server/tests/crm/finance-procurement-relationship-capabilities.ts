/**
 * Focused DB-backed probe for Task #1412.
 * Run: pnpm exec tsx tests/crm/finance-procurement-relationship-capabilities.ts
 */
import "./scratch-db.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierBankAccount,
  atelierLegalEntities,
  atelierPartnerFirmBankChangeRequests,
  atelierPartnerFirmInvoices,
  atelierPartnerFirms,
} from "@workspace/db";
import { findByToolName } from "../../src/lib/atelier-cli/capability-catalog.js";
import "../../src/lib/atelier-cli/finance-procurement-relationship-capabilities.js";

let failures = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail ?? ""); }
};

async function main() {
  const suffix = Date.now().toString(36);
  const orgId = `probe-${suffix}`;
  const accountId = `acct-${suffix}`;
  const archivedAccountId = `acct-arch-${suffix}`;
  const firmId = `firm-${suffix}`;
  const offboardedFirmId = `firm-offboarded-${suffix}`;
  const terminatedFirmId = `firm-terminated-${suffix}`;
  const invoiceId = `inv-${suffix}`;
  const oneOffId = `inv-oneoff-${suffix}`;
  const entityId = `entity-${suffix}`;
  const archivedEntityId = `entity-arch-${suffix}`;
  const bankId = `bank-${suffix}`;
  const archivedBankId = `bank-arch-${suffix}`;
  const unlinkedBankId = `bank-unlinked-${suffix}`;
  const unlinkedBankDecoys = Array.from(
    { length: 33 },
    (_, index) => `aaa-bank-unlinked-${String(index).padStart(2, "0")}-${suffix}`,
  );
  const requestId = `bankreq-${suffix}`;
  const cap = findByToolName("finance_procurement_relationships")!;
  const ctx = { persona: { id: `user-${suffix}`, name: "Probe", role: "founding_partner", orgId } } as any;
  const run = (input: Record<string, unknown>, role = "founding_partner") =>
    cap.run(input, { persona: { ...ctx.persona, role } } as any);
  try {
    await db.insert(atelierAccounts).values([
      { id: accountId, orgId, name: "Visible buyer", country: "AE", sector: "technology", procurement: { status: "in_progress" } },
      { id: archivedAccountId, orgId, name: "Archived buyer", country: "AE", sector: "technology", status: "archived", procurement: { status: "registered" } },
    ]);
    await db.insert(atelierPartnerFirms).values([
      { id: firmId, orgId, name: "Approved Supplier", status: "active", bankIban: "AE210330000010154321000", bankCurrency: "AED" },
      { id: offboardedFirmId, orgId, name: "Offboarded Supplier", status: "offboarded", bankIban: "AE210330000010154321111", bankCurrency: "AED" },
      { id: terminatedFirmId, orgId, name: "Terminated Supplier", status: "terminated", bankIban: "AE210330000010154321222", bankCurrency: "AED" },
    ]);
    await db.insert(atelierPartnerFirmBankChangeRequests).values({
      id: requestId, orgId, partnerFirmId: firmId, requestedByUserId: ctx.persona.id,
      newIban: "AE440330000010154321999", status: "pending",
    });
    await db.insert(atelierPartnerFirmInvoices).values([
      { id: invoiceId, orgId, partnerFirmId: firmId, partnerFirmName: "Approved Supplier", weekIso: "2026-W01", costAmount: 1250, costCurrency: "AED", source: "proposal", legalEntityId: entityId, engagementId: "eng-explicit", supplierBankIban: "AE210330000010154321999" },
      { id: oneOffId, orgId, partnerFirmId: "", partnerFirmName: "One Off Vendor", weekIso: "2026-W01", costAmount: 9, costCurrency: "USD", source: "partner_submitted", supplierBankIban: "AE210330000010154321333" },
    ]);
    await db.insert(atelierLegalEntities).values([
      { id: entityId, orgId, legalNameEn: "Live Entity", shortName: "Live", country: "AE", jurisdiction: "UAE", status: "active" },
      { id: archivedEntityId, orgId, legalNameEn: "Archived Entity", shortName: "Old", country: "AE", jurisdiction: "UAE", status: "archived" },
    ]);
    await db.insert(atelierBankAccount).values([
      { id: bankId, orgId, legalEntityId: entityId, bankName: "Bank", accountLabel: "Operating", accountNumberLast4: "4321", iban: "AE210330000010154321000" },
      { id: archivedBankId, orgId, legalEntityId: archivedEntityId, bankName: "Old Bank", accountLabel: "Archived", accountNumberLast4: "0000" },
      { id: unlinkedBankId, orgId, legalEntityId: null, bankName: "Unlinked Bank", accountLabel: "Unlinked", accountNumberLast4: "9999" },
      ...unlinkedBankDecoys.map((id) => ({
        id, orgId, legalEntityId: null, bankName: "Unlinked Bank",
        accountLabel: "Unlinked decoy", accountNumberLast4: "9999",
      })),
    ]);
    await db.update(atelierBankAccount).set({ isActive: false }).where(eq(atelierBankAccount.id, archivedBankId));

    const firm = await run({ kind: "partner_firm", id: firmId });
    const fr = (firm as any).data.relationships[0];
    check("pending request does not replace approved bank", fr.approvedBank.ibanMasked === "····1000" && fr.bankChangeHistory[0].status === "pending");
    const currentFirms = await run({ kind: "partner_firm" });
    const currentFirmIds = (currentFirms as any).data.relationships.map((row: any) => row.id);
    check("terminal suppliers cannot present retained bank details", !currentFirmIds.includes(offboardedFirmId) && !currentFirmIds.includes(terminatedFirmId));
    const inv = await run({ kind: "supplier_invoice", id: invoiceId });
    const ir = (inv as any).data.relationships[0];
    check("linked invoice uses firm bank authority", ir.partnerFirmId === firmId && ir.legalEntityId === entityId && ir.engagementId === "eng-explicit" && ir.amount === 1250 && ir.currency === "AED" && ir.supplierBankIbanMasked === null && ir.bankAuthority === "partner_firm_registry");
    const one = await run({ kind: "supplier_invoice", id: oneOffId });
    const oneRow = (one as any).data.relationships[0];
    check("one-off remains unlinked with invoice-local bank", oneRow.partnerFirmId === null && oneRow.legalEntityId === null && oneRow.engagementId === null && oneRow.supplierBankIbanMasked === "····1333" && oneRow.bankAuthority === "invoice_local_one_off");
    const account = await run({ kind: "account_procurement", id: accountId });
    check("account has no supplier inference", !(account as any).data.relationships[0].supplier && !(account as any).data.relationships[0].partnerFirmId);
    const accountSearch = await run({ kind: "account_procurement", query: "Visible" });
    check("account search cannot cap before ACL", (accountSearch as any).errorCode === "invalid_input");
    const archived = await run({ kind: "account_procurement", id: archivedAccountId });
    check("archived account excluded", (archived as any).data.relationships.length === 0);
    const bank = await run({ kind: "entity_bank_account" });
    const banks = (bank as any).data.relationships;
    check("active linked bank only; archived and unlinked excluded", banks.length === 1 && banks[0].id === bankId && banks[0].legalEntityStatus === "active");
    const restricted = await run({ kind: "supplier_invoice", id: invoiceId }, "consultant");
    check("restricted persona denied", (restricted as any).errorCode === "forbidden");
    const repeat = await run({ kind: "entity_bank_account" });
    check("bounded deterministic output", JSON.stringify((bank as any).data.relationships) === JSON.stringify((repeat as any).data.relationships));
  } finally {
    await db.delete(atelierBankAccount).where(inArray(
      atelierBankAccount.id,
      [bankId, archivedBankId, unlinkedBankId, ...unlinkedBankDecoys],
    ));
    await db.delete(atelierLegalEntities).where(inArray(atelierLegalEntities.id, [entityId, archivedEntityId]));
    await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, [invoiceId, oneOffId]));
    await db.delete(atelierPartnerFirmBankChangeRequests).where(eq(atelierPartnerFirmBankChangeRequests.id, requestId));
    await db.delete(atelierPartnerFirms).where(inArray(
      atelierPartnerFirms.id,
      [firmId, offboardedFirmId, terminatedFirmId],
    ));
    await db.delete(atelierAccounts).where(inArray(atelierAccounts.id, [accountId, archivedAccountId]));
  }
  process.exit(failures ? 1 : 0);
}
void main().catch((e) => { console.error(e); process.exit(1); });