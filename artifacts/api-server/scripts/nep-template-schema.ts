/**
 * Task #967 — reviewed field schema for the Non-Equity Partner Agreement
 * v3 template (the templatized copy produced by nep-templatize-v3.ts).
 *
 * Shared by the ingestion script (scripts/ingest-nep-template.ts) and the
 * offline probe (tests/crm/nep-template-probe.ts) so the schema that is
 * activated on dev/prod is exactly the schema the tests verify against
 * the generated .docx.
 *
 * Design decisions:
 *  - Conversion thresholds (USD 2,000,000 / 40% / USD 300,000) and the
 *    margin-share percentages (20% / 10%) stay STATIC: v3 explicitly says
 *    the document "is intended to serve as the Firm's template for future
 *    non-equity partners", and the values appear in both Clause 7 and
 *    Schedule C — parameterizing only one spot would let them diverge.
 *  - No partner-side signature-DATE field: the e-sign anchor extractor
 *    requires the "Date" label to match /^date:?$/ verbatim, so no literal
 *    placeholder can live there. DocuSeal date boxes are still placed for
 *    every signer because the signature block's Date anchors are detected
 *    at send time (wantDates in sendContract).
 *  - "Name & Title" labels CAN carry appended placeholders — the anchor
 *    regex is prefix-matching for name labels.
 */

export interface NepField {
  key: string;
  label: string;
  placeholder: string;
  dataType: "text" | "date" | "money" | "number";
  autoFill: string;
  required: boolean;
  note?: string;
  role?: "standard" | "second_party" | "reference";
  defaultHint?: "today";
}

/** Literal placeholders written into the templatized v3 docx. */
export const NEP_PLACEHOLDERS = {
  partnerName: "[PARTNER NAME]",
  passportId: "[Passport / Emirates ID no.]",
  address: "[Address]",
  effectiveDate: "[EFFECTIVE DATE]",
  sectorFocus: "[SECTOR / MARKET FOCUS]",
  chargeOutRate: "[CHARGE-OUT RATE]",
  reference: "[CGNR-NEP-[YEAR]-[###]]",
  firmSignatory: "[FIRM SIGNATORY NAME & TITLE]",
  partnerSignatory: "[PARTNER NAME & TITLE]",
} as const;

export const NEP_FIELD_SCHEMA: NepField[] = [
  {
    key: "reference_number",
    label: "Reference Number",
    placeholder: NEP_PLACEHOLDERS.reference,
    dataType: "text",
    autoFill: "none",
    required: false,
    note: "Auto-assigned CGNR-NEP series (per year).",
    role: "reference",
  },
  {
    key: "partner_name",
    label: "Partner Name",
    placeholder: NEP_PLACEHOLDERS.partnerName,
    dataType: "text",
    autoFill: "counterparty_name",
    required: true,
    note: "Appears in the parties block and the signature-block heading.",
    role: "standard",
  },
  {
    key: "partner_passport_id",
    label: "Partner Passport / Emirates ID Number",
    placeholder: NEP_PLACEHOLDERS.passportId,
    dataType: "text",
    autoFill: "none",
    required: true,
    note: "Partner identification number (passport or Emirates ID).",
    role: "standard",
  },
  {
    key: "partner_address",
    label: "Partner Address",
    placeholder: NEP_PLACEHOLDERS.address,
    dataType: "text",
    autoFill: "counterparty_address",
    required: true,
    note: "Partner's full address.",
    role: "standard",
  },
  {
    key: "effective_date",
    label: "Effective Date",
    placeholder: NEP_PLACEHOLDERS.effectiveDate,
    dataType: "date",
    autoFill: "effective_date",
    required: true,
    note: "Cover page 'Effective Date:' line.",
    role: "standard",
  },
  {
    key: "sector_focus",
    label: "Sector / Market Focus",
    placeholder: NEP_PLACEHOLDERS.sectorFocus,
    dataType: "text",
    autoFill: "none",
    required: true,
    note: "e.g. 'the Education sector across the MENA region' — appears in Background A and Schedule A.",
    role: "standard",
  },
  {
    key: "charge_out_rate",
    label: "Charge-Out Rate (per day)",
    placeholder: NEP_PLACEHOLDERS.chargeOutRate,
    dataType: "money",
    autoFill: "none",
    required: true,
    note: "Schedule B daily Time-Charges rate; firm standard is USD 2,500.",
    role: "standard",
  },
  {
    key: "firm_signatory_name_title",
    label: "Firm Authorised Signatory Name & Title",
    placeholder: NEP_PLACEHOLDERS.firmSignatory,
    dataType: "text",
    autoFill: "none",
    required: true,
    note: "Cognirise signature block — printed name & title of the authorised signatory.",
    role: "standard",
  },
  {
    key: "partner_signatory_name_title",
    label: "Partner Name & Title (signature block)",
    placeholder: NEP_PLACEHOLDERS.partnerSignatory,
    dataType: "text",
    autoFill: "none",
    required: false,
    note: "Completed by the Partner at signing (DocuSeal text box).",
    role: "second_party",
  },
];
