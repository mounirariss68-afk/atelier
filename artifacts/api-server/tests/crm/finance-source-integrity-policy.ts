import assert from "node:assert/strict";
import {
  currentTaxCertificateId,
  duplicateTaxCertificateKind,
  isCurrentTaxCertificate,
} from "../../src/lib/finance-tax-certificate-policy.js";

const original = [
  { type: "tax_registration_ct", certificateDocumentId: "doc_ct_old" },
  { type: "tax_registration_vat", certificateDocumentId: "doc_vat" },
];
const replaced = [
  { type: "tax_registration_ct", certificateDocumentId: "doc_ct_new" },
  { type: "tax_registration_vat", certificateDocumentId: "doc_vat" },
];

assert.equal(currentTaxCertificateId(original, "tax_registration_ct"), "doc_ct_old");
assert.equal(currentTaxCertificateId(replaced, "tax_registration_ct"), "doc_ct_new");
assert.equal(isCurrentTaxCertificate(replaced, "tax_registration_ct", "doc_ct_new"), true);
assert.equal(isCurrentTaxCertificate(replaced, "tax_registration_ct", "doc_ct_old"), false);
assert.equal(isCurrentTaxCertificate(replaced, "tax_registration_vat", "doc_ct_new"), false);
assert.equal(currentTaxCertificateId(
  [{ type: "tax_registration_ct", certificateDocumentId: null }],
  "tax_registration_ct",
), null);
assert.equal(duplicateTaxCertificateKind(original), null);
assert.equal(duplicateTaxCertificateKind([
  ...original,
  { type: "tax_registration_ct", certificateDocumentId: "doc_ct_other" },
]), "tax_registration_ct");

console.log("finance source integrity policy: ALL PASS");