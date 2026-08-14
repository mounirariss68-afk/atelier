/**
 * Task #1102 probe — VAT 201 dataset ties to the existing GL VAT return.
 * Fixture-scoped (probe_vat201_* ids); cleans up in finally. Run:
 *   pnpm --filter @workspace/api-server exec tsx scripts/vat201-probe.ts
 */
import { and, eq, inArray, like } from "drizzle-orm";
import {
  db, atelierLegalEntities, atelierGlAccount, atelierGlJournalEntry,
  atelierGlJournalLine, atelierInvoice, atelierVatRegister, atelierExpenses,
} from "@workspace/db";
import { computeVat201, collectGlVat, monthsOfVatPeriod, resolveEmirateBox } from "../src/lib/atelier-vat201.js";

const ORG = "aico";
const P = "probe_vat201";
const ENT = `${P}_ent`;
const PERIOD = "2026-07";

function fail(msg: string): never { throw new Error(`FAIL: ${msg}`); }

async function cleanup() {
  await db.delete(atelierGlJournalLine).where(like(atelierGlJournalLine.id, `${P}%`));
  await db.delete(atelierGlJournalEntry).where(like(atelierGlJournalEntry.id, `${P}%`));
  await db.delete(atelierGlAccount).where(like(atelierGlAccount.id, `${P}%`));
  await db.delete(atelierInvoice).where(like(atelierInvoice.id, `${P}%`));
  await db.delete(atelierVatRegister).where(like(atelierVatRegister.id, `${P}%`));
  await db.delete(atelierExpenses).where(like(atelierExpenses.id, `${P}%`));
  await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.id, ENT));
}

async function main() {
  await cleanup();
  await db.insert(atelierLegalEntities).values({
    id: ENT, orgId: ORG, legalNameEn: "Probe Dubai FZ-LLC", shortName: "Probe Dubai",
    country: "AE", jurisdiction: "Dubai", baseCurrency: "AED",
    registrations: [{ id: "r1", type: "tax", label: "VAT TRN", number: "100123456700003", issuer: "FTA", issuedOn: null, expiresOn: null, notes: null }],
    fiscal: { vatPeriod: "monthly", nextVatFilingDate: "2026-08-28", vatExpectedAmount: null, nextCtFilingDate: null, ctExpectedAmount: null },
  });
  const accOut = `${P}_acc2300`, accIn = `${P}_acc1400`;
  await db.insert(atelierGlAccount).values([
    { id: accOut, orgId: ORG, legalEntityId: ENT, code: "2300", name: "VAT payable (output)", type: "liability", normalSide: "credit" },
    { id: accIn, orgId: ORG, legalEntityId: ENT, code: "1400", name: "VAT receivable (input)", type: "asset", normalSide: "debit" },
  ] as (typeof atelierGlAccount.$inferInsert)[]);

  // Invoice: AED 10,000 net + 500 VAT (5%), issued in July.
  const invId = `${P}_inv1`;
  await db.insert(atelierInvoice).values({
    id: invId, orgId: ORG, legalEntityId: ENT, jurisdiction: "AE", invoiceNumber: "INV-P-001",
    currency: "AED", status: "issued", billTo: { name: "Client LLC" },
    subtotal: 10000, vatAmount: 500, vatRatePct: 5, total: 10500,
    issuedAt: new Date("2026-07-10T00:00:00Z"),
  });
  // Zero-rated export invoice: USD 2,000, 0%.
  await db.insert(atelierInvoice).values({
    id: `${P}_inv0`, orgId: ORG, legalEntityId: ENT, jurisdiction: "GLOBAL", invoiceNumber: "INV-P-002",
    currency: "USD", status: "issued", billTo: { name: "Overseas Co" },
    subtotal: 2000, vatAmount: 0, vatRatePct: 0, total: 2000,
    issuedAt: new Date("2026-07-15T00:00:00Z"),
  });
  // GL: output VAT 500 AED from the invoice; input VAT 25 AED from an expense.
  const e1 = `${P}_j1`, e2 = `${P}_j2`;
  await db.insert(atelierGlJournalEntry).values([
    { id: e1, orgId: ORG, legalEntityId: ENT, periodLabel: "2026-07", entryDate: "2026-07-10", kind: "posting", sourceKind: "invoice", sourceRef: invId, memo: "Invoice INV-P-001", currency: "AED", totalDebit: 10500, totalCredit: 10500 },
    { id: e2, orgId: ORG, legalEntityId: ENT, periodLabel: "2026-07", entryDate: "2026-07-20", kind: "posting", sourceKind: "expense", sourceRef: `${P}_exp1`, memo: "Taxi Dubai", currency: "USD", totalDebit: 143, totalCredit: 143 },
  ] as (typeof atelierGlJournalEntry.$inferInsert)[]);
  await db.insert(atelierGlJournalLine).values([
    { id: `${P}_l1`, orgId: ORG, journalEntryId: e1, accountId: accOut, accountCode: "2300", accountName: "VAT payable (output)", debit: 0, credit: 500 },
    { id: `${P}_l2`, orgId: ORG, journalEntryId: e2, accountId: accIn, accountCode: "1400", accountName: "VAT receivable (input)", debit: 6.81, credit: 0 },
  ] as (typeof atelierGlJournalLine.$inferInsert)[]);
  await db.insert(atelierVatRegister).values({
    id: `${P}_reg1`, orgId: ORG, expenseId: `${P}_exp1`, expenseDate: "2026-07-20",
    country: "UAE", countryCode: "AE", treatment: "uae_5", rate: 5,
    netAmount: 136.19, vatAmount: 6.81, grossAmount: 143, currency: "USD",
    usdNet: 136.19, usdVat: 6.81, usdGross: 143, merchant: "Careem", summary: "Taxi Dubai",
  });

  // Non-USD expense: register net in EUR, GL VAT posted in USD.
  const e3 = `${P}_j3`;
  await db.insert(atelierGlJournalEntry).values({
    id: e3, orgId: ORG, legalEntityId: ENT, periodLabel: "2026-07", entryDate: "2026-07-22", kind: "posting",
    sourceKind: "expense", sourceRef: `${P}_exp2`, memo: "Software Berlin", currency: "USD", totalDebit: 108.7, totalCredit: 108.7,
  } as typeof atelierGlJournalEntry.$inferInsert);
  await db.insert(atelierGlJournalLine).values({
    id: `${P}_l3`, orgId: ORG, journalEntryId: e3, accountId: accIn, accountCode: "1400", accountName: "VAT receivable (input)", debit: 5.18, credit: 0,
  } as typeof atelierGlJournalLine.$inferInsert);
  await db.insert(atelierVatRegister).values({
    id: `${P}_reg2`, orgId: ORG, expenseId: `${P}_exp2`, expenseDate: "2026-07-22",
    country: "UAE", countryCode: "AE", treatment: "uae_5", rate: 5,
    netAmount: 95.24, vatAmount: 4.76, grossAmount: 100, currency: "EUR",
    usdNet: 103.52, usdVat: 5.18, usdGross: 108.7, merchant: "SAP", summary: "Software Berlin",
  });

  // Ambiguous cases that must be EXCLUDED from the boxes and block export:
  // a domestic 0% invoice and a manual output-VAT journal with no source doc.
  await db.insert(atelierInvoice).values({
    id: `${P}_invamb`, orgId: ORG, legalEntityId: ENT, jurisdiction: "AE", invoiceNumber: "INV-P-003",
    currency: "AED", status: "issued", billTo: { name: "Domestic 0% Co" },
    subtotal: 3000, vatAmount: 0, vatRatePct: 0, total: 3000,
    issuedAt: new Date("2026-07-18T00:00:00Z"),
  });
  await db.insert(atelierGlJournalEntry).values({
    id: `${P}_jman`, orgId: ORG, legalEntityId: ENT, periodLabel: "2026-07", entryDate: "2026-07-25", kind: "posting",
    sourceKind: "manual", sourceRef: `${P}_man1`, memo: "Manual VAT adjustment", currency: "AED", totalDebit: 40, totalCredit: 40,
  } as typeof atelierGlJournalEntry.$inferInsert);
  await db.insert(atelierGlJournalLine).values({
    id: `${P}_lman`, orgId: ORG, journalEntryId: `${P}_jman`, accountId: accOut, accountCode: "2300", accountName: "VAT payable (output)", debit: 0, credit: 40,
  } as typeof atelierGlJournalLine.$inferInsert);

  // ── Task #1114 — classified reverse-charge / import / exempt fixtures ──
  // Exempt supply: domestic 0% invoice explicitly classified → box 5 (not unclassified).
  await db.insert(atelierInvoice).values({
    id: `${P}_invex`, orgId: ORG, legalEntityId: ENT, jurisdiction: "AE", invoiceNumber: "INV-P-004",
    currency: "AED", status: "issued", billTo: { name: "Exempt Co" },
    subtotal: 1200, vatAmount: 0, vatRatePct: 0, total: 1200,
    issuedAt: new Date("2026-07-19T00:00:00Z"),
    vatClassification: "exempt_supply",
  });
  // Classified expenses (register rows tagged) allocated to this entity.
  const clsFixtures: Array<[string, string, number]> = [
    [`${P}_exprc`, "reverse_charge_import", 1000], // box 3
    [`${P}_expgi`, "goods_import", 400],           // box 6
    [`${P}_expadj`, "import_adjustment", -100],    // box 7 (correction-style)
  ];
  for (const [expId, cls, net] of clsFixtures) {
    await db.insert(atelierExpenses).values({
      id: expId, orgId: ORG, personId: "u_amina", expenseDate: "2026-07-21",
      captureSource: "manual", merchant: `Foreign ${cls}`, category: "other",
      amount: net, currency: "AED", usdAmount: net / 3.6725, status: "approved",
      contextType: "internal", entityId: ENT,
    } as typeof atelierExpenses.$inferInsert);
    await db.insert(atelierVatRegister).values({
      id: `${P}_reg_${cls}`, orgId: ORG, expenseId: expId, expenseDate: "2026-07-21",
      country: "UAE", countryCode: "AE", treatment: "none", rate: 0,
      netAmount: net, vatAmount: 0, grossAmount: net, currency: "AED",
      usdNet: net / 3.6725, usdVat: 0, usdGross: net / 3.6725,
      merchant: `Foreign ${cls}`, summary: cls, vatClassification: cls,
    });
  }
  // Classified register row for an expense allocated to ANOTHER entity — must be excluded.
  await db.insert(atelierExpenses).values({
    id: `${P}_expother`, orgId: ORG, personId: "u_amina", expenseDate: "2026-07-21",
    captureSource: "manual", merchant: "Other-entity import", category: "other",
    amount: 999, currency: "AED", usdAmount: 999 / 3.6725, status: "approved",
    contextType: "internal", entityId: "some_other_entity",
  } as typeof atelierExpenses.$inferInsert);
  await db.insert(atelierVatRegister).values({
    id: `${P}_reg_other`, orgId: ORG, expenseId: `${P}_expother`, expenseDate: "2026-07-21",
    country: "UAE", countryCode: "AE", treatment: "none", rate: 0,
    netAmount: 999, vatAmount: 0, grossAmount: 999, currency: "AED",
    usdNet: 999 / 3.6725, usdVat: 0, usdGross: 999 / 3.6725,
    merchant: "Other-entity import", summary: "other entity", vatClassification: "goods_import",
  });

  const months = monthsOfVatPeriod(PERIOD)!;
  const [ent] = await db.select().from(atelierLegalEntities).where(eq(atelierLegalEntities.id, ENT));
  const emirate = resolveEmirateBox(ent);
  if (!emirate || emirate.box !== "1b") fail(`emirate resolution wrong: ${JSON.stringify(emirate)}`);
  const gl = await collectGlVat(ORG, ENT, months);
  const rep = await computeVat201(ORG, ent, PERIOD, months, emirate);

  console.log("GL:", gl.outputVat, gl.inputVat, gl.netVat);
  console.log("Totals:", JSON.stringify(rep.totals));
  console.log("TieBack:", JSON.stringify(rep.glTieBack));
  const bx = (b: string) => rep.boxes.find((x) => x.box === b)!;

  if (gl.outputVat !== 540 || Math.abs(gl.inputVat - (6.81 + 5.18)) > 0.01) fail("GL collector figures wrong");
  // Ambiguous transactions are excluded from the boxes and reported as blocking.
  if (rep.unclassified.length !== 2) fail(`expected 2 unclassified lines, got ${JSON.stringify(rep.unclassified)}`);
  if (!rep.unclassified.some((l) => l.ref === "INV-P-003" && /ambiguous/.test(l.note ?? ""))) fail("domestic 0% invoice not flagged ambiguous");
  if (!rep.unclassified.some((l) => l.vatAed === 40 && /no source invoice/.test(l.note ?? ""))) fail("manual VAT journal not flagged unclassified");
  if (rep.glTieBack.unclassifiedOutputVatAed !== 40) fail("unclassified output VAT not surfaced in tie-back");
  if (bx("1b").lines.length !== 1 || bx("1b").vatAed !== 500 || bx("1b").netAed !== 10000) fail(`box 1b wrong: ${JSON.stringify(bx("1b"))}`);
  if (bx("1a").vatAed !== 0 || bx("1c").vatAed !== 0) fail("emirate attribution leaked outside Dubai");
  // Zero-rated: USD 2000 → AED ≈ 7345 (fallback 3.6725).
  if (bx("4").lines.length !== 1 || Math.abs(bx("4").netAed - 2000 * 3.6725) > 40) fail(`box 4 wrong: ${JSON.stringify(bx("4"))}`);
  // Input: USD 6.81 + USD 5.18 VAT → AED, enriched from the register.
  const b9 = bx("9");
  if (b9.lines.length !== 2 || Math.abs(b9.vatAed - (6.81 + 5.18) * 3.6725) > 1.2) fail(`box 9 wrong: ${JSON.stringify(b9)}`);
  const careem = b9.lines.find((l) => l.description.includes("Careem"));
  if (!careem) fail("box 9 line not enriched from VAT register");
  // EUR-net expense: net labeled EUR with EUR→AED chain, VAT labeled USD with USD→AED chain.
  const sap = b9.lines.find((l) => l.description.includes("SAP"));
  if (!sap) fail("EUR expense line missing");
  if (sap.netCurrency !== "EUR" || !sap.netFxChain.includes("EUR → AED")) fail(`EUR net mislabeled: ${JSON.stringify(sap)}`);
  if (sap.vatCurrency !== "USD" || !sap.vatFxChain.includes("USD → AED")) fail(`USD VAT mislabeled: ${JSON.stringify(sap)}`);
  // EUR 95.24 → USD ≈ 103.52 → AED ≈ 380.2 (fallbacks 0.92, 3.6725)
  if (Math.abs(sap.netAed - (95.24 / 0.92) * 3.6725) > 8) fail(`EUR net AED conversion off: ${sap.netAed}`);
  // ── Task #1114 — classified reverse-charge / import / exempt boxes ──
  const b3 = bx("3"), b5 = bx("5"), b6 = bx("6"), b7 = bx("7"), b10 = bx("10");
  if (b3.lines.length !== 1 || b3.netAed !== 1000 || b3.vatAed !== 50) fail(`box 3 wrong: ${JSON.stringify(b3)}`);
  if (b5.lines.length !== 1 || b5.netAed !== 1200 || b5.vatAed !== 0) fail(`box 5 wrong: ${JSON.stringify(b5)}`);
  if (b6.lines.length !== 1 || b6.netAed !== 400 || b6.vatAed !== 20) fail(`box 6 wrong: ${JSON.stringify(b6)}`);
  if (b7.lines.length !== 1 || b7.netAed !== -100 || b7.vatAed !== -5) fail(`box 7 wrong: ${JSON.stringify(b7)}`);
  if (b10.lines.length !== 3 || Math.abs(b10.vatAed - 65) > 0.01) fail(`box 10 wrong: ${JSON.stringify(b10)}`);
  if (b10.lines.some((l) => l.description.includes("Other-entity"))) fail("other-entity classified expense leaked in");
  if (b3.note || b5.note || b6.note || b7.note || b10.note) fail("data-gap note still shown on populated classified boxes");
  if (!bx("2").note) fail("box 2 lost its data-gap note");
  if (rep.unclassified.some((l) => l.ref === "INV-P-004")) fail("classified exempt invoice still listed unclassified");
  if (Math.abs(bx("11").vatAed - (rep.glTieBack.inputVatAed + 65)) > 0.01) fail("box 11 != box 9 + box 10");
  if (rep.totals.box12VatAed !== bx("8").vatAed) fail("box 12 != box 8 VAT");
  if (Math.abs(rep.totals.box14NetAed - (rep.totals.box12VatAed - rep.totals.box13VatAed)) > 0.01) fail("box 14 arithmetic");
  // Self-assessed RC VAT (65) sits in boxes 12 AND 13 but not on the GL VAT accounts.
  if (Math.abs(rep.glTieBack.outputVatAed + 65 - rep.totals.box12VatAed) > 0.01) fail("tie-back output + RC != box 12");
  if (Math.abs(rep.glTieBack.outputVatAed + rep.glTieBack.unclassifiedOutputVatAed - 540) > 0.01) fail("classified + unclassified != GL output VAT");
  if (Math.abs(rep.glTieBack.inputVatAed + 65 - rep.totals.box13VatAed) > 0.01) fail("tie-back input + RC != box 13");
  if (!rep.notes.some((n) => /self-assessed/.test(n))) fail("reverse-charge note missing");
  if (rep.trn !== "100123456700003") fail("TRN not picked up");

  // Quarterly period also works.
  const qMonths = monthsOfVatPeriod("2026-Q3")!;
  const qRep = await computeVat201(ORG, ent, "2026-Q3", qMonths, emirate);
  if (qRep.totals.box12VatAed !== rep.totals.box12VatAed) fail("quarterly period lost July data");

  // Abu Dhabi entity attributes to box 1a, not 1b.
  const adEnt = { ...ent, jurisdiction: "Abu Dhabi", registeredAddress: "", officeAddress: "", premises: null };
  const adEm = resolveEmirateBox(adEnt);
  if (!adEm || adEm.box !== "1a") fail(`Abu Dhabi resolution wrong: ${JSON.stringify(adEm)}`);
  const adRep = await computeVat201(ORG, adEnt, PERIOD, months, adEm);
  const adBx = (b: string) => adRep.boxes.find((x) => x.box === b)!;
  if (adBx("1a").vatAed !== 500 || adBx("1b").vatAed !== 0) fail("Abu Dhabi supplies not attributed to 1a");
  // Unresolvable emirate refuses.
  if (resolveEmirateBox({ ...adEnt, jurisdiction: "Freezone" }) !== null) fail("unresolvable emirate should return null");

  console.log("PASS: VAT 201 computation ties to GL and enriches from source documents.");
}

main().then(() => cleanup()).then(() => process.exit(0)).catch(async (e) => {
  console.error(e);
  try { await cleanup(); } catch {}
  process.exit(1);
});
