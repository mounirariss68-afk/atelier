/**
 * Task #1316 — CogniDocs API wire types.
 *
 * CogniDocs is the company's own document-parsing service
 * (https://cognidocs.cognirise.ai/api). It replaces the in-house
 * vision/OCR parsing for receipts, supplier invoices and bank/credit-card
 * statements.
 *
 * Amount convention: every monetary field is an INTEGER scaled by 10,000
 * (`…10k`) — divide by 10,000 for the major-unit value. The 4-decimal
 * scale preserves 3-decimal Gulf currencies (KWD/BHD/OMR) exactly.
 */

export type CognidocsDeclaredType =
  | "invoice"
  | "receipt"
  | "bank_statement"
  | "credit_card_statement"
  | "auto";

export type CognidocsJobStatus = "queued" | "processing" | "completed" | "failed";

export interface CognidocsStatementTransaction {
  /** Posting date YYYY-MM-DD. */
  date: string;
  description: string | null;
  rawDescription: string | null;
  /** Integer ×10,000. Sign conventions vary by statement type — the
   * `direction` field is the ONLY authoritative direction signal. */
  amount10k: number;
  currency: string | null;
  /** Authoritative: debit = money out, credit = money in. null = the
   * statement did not mark the row — NEVER guess, flag instead. */
  direction: "debit" | "credit" | null;
  balance10k: number | null;
  normalizedMerchant: string | null;
  parsedMerchant: string | null;
  category: string | null;
  categoryKey?: string | null;
  notes?: string[] | null;
}

export interface CognidocsStatementResult {
  bankId: string | null;
  bankName: string | null;
  statementType: string | null;
  currency: string | null;
  accountRef: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** e.g. csv rows the parser had to skip — surface, never hide. */
  partialImportWarning: string | null;
  transactions: CognidocsStatementTransaction[];
}

export interface CognidocsInvoiceLineItem {
  description: string | null;
  quantity10k: number | null;
  unitPriceAmount10k: number | null;
  amount10k: number | null;
  taxAmount10k: number | null;
}

export interface CognidocsReconciliation {
  lineItemSum10k: number | null;
  matchesTotal: boolean | null;
  delta10k: number | null;
}

/** Receipts also come back as InvoiceResult. */
export interface CognidocsInvoiceResult {
  /** Stable dedupe signal for the same underlying invoice. */
  id: string | null;
  vendorKey: string | null;
  vendorName: string | null;
  invoiceRef: string | null;
  issueDate: string | null;
  dueDate: string | null;
  currency: string | null;
  subtotalAmount10k: number | null;
  taxAmount10k: number | null;
  totalAmount10k: number | null;
  categoryKey: string | null;
  categoryFacts?: unknown[] | null;
  detailTier?: string | null;
  fieldConfidence?: Record<string, number> | null;
  fieldsMissing?: string[] | null;
  reconciliation?: CognidocsReconciliation | null;
  paymentMethod?: string | null;
  paymentReference?: string | null;
  associatedInvoiceRefs?: string[] | null;
  merchantId?: string | null;
  lineItems?: CognidocsInvoiceLineItem[] | null;
}

export interface CognidocsParseResultEnvelope {
  documentType: string | null;
  parserPath: string | null;
  confidence: number | null;
  statement: CognidocsStatementResult | null;
  invoice: CognidocsInvoiceResult | null;
}

export interface CognidocsParseJob {
  id: string;
  status: CognidocsJobStatus;
  declaredType: CognidocsDeclaredType | null;
  detectedType: string | null;
  /** Integer 0–100 overall parse confidence; null while pending. */
  confidence: number | null;
  error: string | null;
  result: CognidocsParseResultEnvelope | null;
  sandbox?: boolean;
}
