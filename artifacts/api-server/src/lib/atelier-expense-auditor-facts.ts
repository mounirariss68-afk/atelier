/**
 * Deterministic facts for the Expense Auditor.
 *
 * The Auditor (Haiku) is good at reading a receipt and classifying it. It is
 * not a source of truth for money: VAT treatment follows from the country,
 * the VAT amount from the receipt total (or the printed tax line), markup
 * from the engagement's contract cap, and billability from the contract
 * digest. Before this module those four fields were copied from the model's
 * JSON straight into `atelier_expenses`. Now the model's values are kept as
 * its proposal (`auditorProposal`) and the row carries the derived values.
 */

import type { ContractDigest } from "./atelier-contract-digest.js";

export type VatTreatment = "ksa_15" | "uae_5" | "zero_rated_export" | "none";

export interface AuditorMoneyProposal {
  category?: string;
  vatTreatment?: string;
  vatAmount?: number;
  clientBillable?: boolean;
  markupPct?: number;
}

export interface DeriveExpenseFactsInput {
  /** Gross amount as captured (VAT-inclusive). */
  amount: number;
  currency: string;
  /** Country as stored on the row or read from the receipt: ISO-2 or the legacy KSA/UAE labels. */
  country?: string | null;
  /** Tax line printed on the receipt, if the OCR found one. */
  ocrTax?: number | null;
  contractDigest: ContractDigest | null;
  engagementId?: string | null;
  proposal: AuditorMoneyProposal | null;
}

export interface DerivedExpenseFacts {
  vatTreatment: VatTreatment;
  vatAmount: number;
  clientBillable: boolean;
  markupPct: number;
  /** How each value was arrived at; stored next to the model proposal for review. */
  basis: {
    vat: "receipt_tax_line" | "country_rate" | "no_vat_jurisdiction" | "unknown_country";
    markup: "contract_cap" | "not_billable" | "contract_silent";
    billable: "contract_permits" | "contract_excludes_category" | "no_expenses_clause" | "no_engagement";
    overrides: string[];
  };
}

const RATES: Record<VatTreatment, number> = {
  ksa_15: 0.15,
  uae_5: 0.05,
  zero_rated_export: 0,
  none: 0,
};

export function vatTreatmentForCountry(country: string | null | undefined): VatTreatment | null {
  const c = (country ?? "").trim().toUpperCase();
  if (!c) return null;
  if (c === "SA" || c === "KSA" || c === "SAU" || c === "SAUDI ARABIA") return "ksa_15";
  if (c === "AE" || c === "UAE" || c === "ARE" || c === "UNITED ARAB EMIRATES") return "uae_5";
  return "none";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function deriveExpenseFacts(input: DeriveExpenseFactsInput): DerivedExpenseFacts {
  const overrides: string[] = [];
  const amount = Number.isFinite(input.amount) ? Math.max(0, input.amount) : 0;
  const proposal = input.proposal ?? {};

  // --- VAT -------------------------------------------------------------
  const byCountry = vatTreatmentForCountry(input.country);
  let vatTreatment: VatTreatment;
  let vatAmount = 0;
  let vatBasis: DerivedExpenseFacts["basis"]["vat"];
  if (byCountry === null) {
    vatTreatment = "none";
    vatBasis = "unknown_country";
  } else if (byCountry === "none") {
    vatTreatment = "none";
    vatBasis = "no_vat_jurisdiction";
  } else {
    vatTreatment = byCountry;
    const rate = RATES[byCountry];
    const implied = round2(amount - amount / (1 + rate));
    const tax = typeof input.ocrTax === "number" && Number.isFinite(input.ocrTax) ? input.ocrTax : null;
    // Trust the printed tax line when it is positive and within 10 % of what
    // the rate implies (receipts round; mixed-rate baskets drift a little).
    if (tax !== null && tax > 0 && Math.abs(tax - implied) <= Math.max(0.05, implied * 0.1)) {
      vatAmount = round2(tax);
      vatBasis = "receipt_tax_line";
    } else {
      vatAmount = implied;
      vatBasis = "country_rate";
    }
  }
  if (proposal.vatTreatment && proposal.vatTreatment !== vatTreatment) {
    overrides.push(`vatTreatment: model ${proposal.vatTreatment} → ${vatTreatment}`);
  }
  if (typeof proposal.vatAmount === "number" && Math.abs(proposal.vatAmount - vatAmount) > 0.01) {
    overrides.push(`vatAmount: model ${proposal.vatAmount} → ${vatAmount}`);
  }

  // --- Billability -------------------------------------------------------
  const digest = input.contractDigest;
  let clientBillable = false;
  let billableBasis: DerivedExpenseFacts["basis"]["billable"];
  if (!input.engagementId || !digest) {
    billableBasis = "no_engagement";
  } else if (!digest.expensesClause) {
    billableBasis = "no_expenses_clause";
  } else {
    const permitted = digest.permittedCategories ?? [];
    const blocked = digest.blockedCategories ?? [];
    const cat = (proposal.category ?? "").toLowerCase();
    const categoryOk =
      (permitted.length === 0 || permitted.map((p) => p.toLowerCase()).includes(cat)) &&
      !blocked.map((b) => b.toLowerCase()).includes(cat);
    if (categoryOk) {
      // The contract permits it; the model (or later the user) still decides
      // whether this particular receipt is passed through. Default to the
      // model's call, which the prompt constrains to the same clause test.
      clientBillable = proposal.clientBillable === true;
      billableBasis = "contract_permits";
    } else {
      billableBasis = "contract_excludes_category";
    }
  }
  if (proposal.clientBillable === true && !clientBillable) {
    overrides.push(`clientBillable: model true → false (${billableBasis})`);
  }

  // --- Markup ------------------------------------------------------------
  let markupPct = 0;
  let markupBasis: DerivedExpenseFacts["basis"]["markup"];
  if (!clientBillable) {
    markupBasis = "not_billable";
  } else if (digest && typeof digest.expenseMarkupCapPct === "number" && digest.expenseMarkupCapPct > 0) {
    markupPct = digest.expenseMarkupCapPct;
    markupBasis = "contract_cap";
  } else {
    markupBasis = "contract_silent";
  }
  if (typeof proposal.markupPct === "number" && Math.abs(proposal.markupPct - markupPct) > 0.01) {
    overrides.push(`markupPct: model ${proposal.markupPct} → ${markupPct}`);
  }

  return {
    vatTreatment,
    vatAmount,
    clientBillable,
    markupPct,
    basis: { vat: vatBasis, markup: markupBasis, billable: billableBasis, overrides },
  };
}
