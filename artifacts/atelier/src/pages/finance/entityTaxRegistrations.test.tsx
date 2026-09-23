import * as React from "react";
import assert from "node:assert/strict";
import { renderToString } from "react-dom/server";
import {
  allowsUnchangedLegacyTaxRegistration,
  draftFromEntity,
  emptyDraft,
  validateDraft,
  draftToBody,
} from "./entityForm";
import type { LegalEntityRow } from "@/lib/v5-hooks";
import { DocCard } from "./FinanceEntityDetail";

const complete = emptyDraft();
complete.legalNameEn = "Tax Test LLC";
complete.country = "AE";
complete.registrations.push({
  type: "tax_registration_ct",
  label: "Corporate Tax registration",
  number: "CT-1001",
  issuer: "Federal Tax Authority",
  issuedOn: "",
  expiresOn: "",
  certificateDocumentId: "doc_ct",
});
assert.deepEqual(validateDraft(complete), {});
assert.equal(
  ((draftToBody(complete).registrations as Array<{ certificateDocumentId?: string }>)[0]).certificateDocumentId,
  "doc_ct",
);

const missingCt = emptyDraft();
missingCt.legalNameEn = "Missing Tax LLC";
missingCt.country = "AE";
assert.match(validateDraft(missingCt)["registrations.ct.number"], /required/);
assert.match(validateDraft(missingCt)["registrations.ct.certificate"], /required/);

const vatNumberOnly = structuredClone(complete);
vatNumberOnly.registrations.push({
  type: "tax_registration_vat",
  label: "VAT registration",
  number: "VAT-2002",
  issuer: "Federal Tax Authority",
  issuedOn: "",
  expiresOn: "",
  certificateDocumentId: "",
});
assert.match(validateDraft(vatNumberOnly)["registrations.vat.certificate"], /required/);

const legacyEntity = {
  ...draftToBody(complete),
  id: "lent_legacy",
  status: "active",
  registrations: [],
  activities: [],
  owners: [],
  premises: null,
  lease: null,
  fiscal: null,
  cashPolicy: null,
  statutory: null,
  isHeadEntity: false,
  formation: null,
  recommendedTreatment: null,
  notes: null,
  archivedAt: null,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
} as unknown as LegalEntityRow;
const legacyEdit = draftFromEntity(legacyEntity);
legacyEdit.notes = "Unrelated note change";
assert.equal(allowsUnchangedLegacyTaxRegistration(legacyEdit, legacyEntity), true);
assert.deepEqual(validateDraft(legacyEdit, { allowUnchangedLegacyTax: true }), {});
legacyEdit.registrations.push({
  type: "tax_registration_vat",
  label: "VAT registration",
  number: "VAT-INCOMPLETE",
  issuer: "",
  issuedOn: "",
  expiresOn: "",
  certificateDocumentId: "",
});
assert.equal(allowsUnchangedLegacyTaxRegistration(legacyEdit, legacyEntity), false);
assert.match(validateDraft(legacyEdit)["registrations.ct.number"], /required/);
assert.match(validateDraft(legacyEdit)["registrations.vat.certificate"], /required/);

const legacyIncompleteVat = {
  ...legacyEntity,
  id: "lent_legacy_vat",
  registrations: [
    complete.registrations[0],
    {
      type: "tax_registration_vat",
      label: "VAT registration",
      number: "VAT-LEGACY",
      issuer: null,
      issuedOn: null,
      expiresOn: null,
      certificateDocumentId: null,
    },
  ],
} as unknown as LegalEntityRow;
const legacyVatEdit = draftFromEntity(legacyIncompleteVat);
legacyVatEdit.notes = "Unrelated note on historical incomplete VAT";
assert.equal(allowsUnchangedLegacyTaxRegistration(legacyVatEdit, legacyIncompleteVat), true);
assert.deepEqual(validateDraft(legacyVatEdit, { allowUnchangedLegacyTax: true }), {});

const html = renderToString(
  <DocCard
    doc={{
      id: "doc_ct",
      title: "Corporate Tax certificate",
      category: "corporate_legal",
      docKind: "tax_registration_ct",
      aiRetrieval: false,
      fileName: "corporate-tax.pdf",
      mime: "application/pdf",
      createdAt: "2026-09-22",
    }}
    regNumber="CT-1001"
    canWrite={false}
    onKindChange={() => {}}
  />,
);
assert.match(html, /Corporate Tax certificate/);
assert.match(html, /CT-1001/);
assert.match(html, /corporate-tax\.pdf/);

console.log("entity tax registration form and detail render checks passed");