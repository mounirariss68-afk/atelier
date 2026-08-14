/**
 * Task #1091 — Auto-post policy engine (finance-autonomy blueprint §4).
 *
 * ONE shared decision function applied uniformly wherever an intake path
 * decides "auto-post" vs "queue for founder review". The thresholds come
 * from the founder-editable autopilot settings (decision D1), NEVER from
 * hardcoded constants at the call sites.
 *
 * "Auto" always means: posted/advanced with a full audit trail and a
 * one-click reverse. Every auto decision records WHY (the returned
 * `reasons`) in the record/audit payload so the review-&-revise contract
 * (blueprint §5) holds — attribution + rule/confidence that triggered it.
 *
 * The blueprint approval matrix, encoded here:
 *   supplier_invoice → auto into "ready to pay" ONLY when
 *       amountAedEquivalent ≤ supplierInvoiceAutoMaxAed
 *       AND every key-field confidence ≥ journalAutoConfidence
 *       AND the vendor is a known counterparty.
 *   ai_journal → auto ONLY when every confidence ≥ journalAutoConfidence
 *       AND amountAedEquivalent ≤ journalAutoMaxAed; else review queue.
 *   cash_application → auto ONLY on an exact single-candidate match.
 *   Everything in the "never auto" rows of the matrix (payment runs,
 *   vendor bank-detail changes, client invoice issue, dunning send,
 *   period close, statutory mark-filed, payroll runs, journal reversal,
 *   recon finalise) can NEVER be auto — this function returns auto:false
 *   with the "matrix: <kind> is always founder-approved" reason.
 *
 * The function is pure and deterministic (no IO): callers load the
 * settings + convert amounts to AED-equivalent first, then pass them in.
 */

/** Blueprint §9 D1 defaults — used by the settings READ path when no row
 * exists (production no-seed policy) and as the fallback here. */
export const FINANCE_AUTOPILOT_DEFAULTS = {
  journalAutoConfidence: 0.9,
  supplierInvoiceAutoMaxAed: 1000,
  journalAutoMaxAed: 5000,
} as const;

export interface FinanceAutopilotThresholds {
  journalAutoConfidence: number;
  supplierInvoiceAutoMaxAed: number;
  journalAutoMaxAed: number;
}

/** The auto-eligible intake kinds this engine reasons about. */
export type AutoPostKind =
  | "supplier_invoice"
  | "ai_journal"
  | "cash_application"
  // Deterministic Bookkeeper journals: ALWAYS-auto by matrix (no model
  // coding, exact rule-derived entries), but routed through the engine so
  // the "auto" authorization has a single home and records its reason.
  | "bookkeeper_journal"
  // "never auto" matrix rows — passing any of these always returns auto:false.
  | "payment_run"
  | "vendor_bank_change"
  | "client_invoice_issue"
  | "dunning_send"
  | "period_close"
  | "statutory_filed"
  | "payroll_run"
  | "journal_reversal"
  | "recon_finalise";

/** Matrix rows that are ALWAYS founder-approved (§4). */
const NEVER_AUTO: ReadonlySet<AutoPostKind> = new Set<AutoPostKind>([
  "payment_run",
  "vendor_bank_change",
  "client_invoice_issue",
  "dunning_send",
  "period_close",
  "statutory_filed",
  "payroll_run",
  "journal_reversal",
  "recon_finalise",
]);

export interface EvaluateAutoPostArgs {
  kind: AutoPostKind;
  thresholds: FinanceAutopilotThresholds;
  /** AED-equivalent amount (D5: AED-equivalent via display-currency FX).
   * Undefined when the caller can't quantify — treated as "cannot clear the
   * ceiling", so the item stays in review. */
  amountAedEquivalent?: number | null;
  /** Every key-field confidence the posting depends on (0..1). ALL must
   * clear the bar; one weak field queues the whole document (§4). Empty =
   * no confidence signal ⇒ not auto. */
  confidences?: number[];
  /** supplier_invoice only: is the vendor a known counterparty? */
  knownVendor?: boolean;
  /** cash_application only: exactly one candidate matched the receipt? */
  exactSingleCandidate?: boolean;
}

export interface EvaluateAutoPostResult {
  auto: boolean;
  reasons: string[];
}

function allClear(confidences: number[] | undefined, bar: number): { ok: boolean; min: number | null } {
  if (!confidences || confidences.length === 0) return { ok: false, min: null };
  let min = Infinity;
  for (const c of confidences) {
    if (!Number.isFinite(c)) return { ok: false, min: 0 };
    if (c < min) min = c;
  }
  return { ok: min >= bar, min };
}

/**
 * Boundary guard for the "never auto" matrix rows. Call this at the actual
 * posting/decision boundary of any action that must ALWAYS be founder-
 * approved (payment run release, vendor bank-change apply, client invoice
 * issue, dunning send, period close, statutory mark-filed, payroll run,
 * journal reversal, recon finalise). It throws if a future refactor ever
 * routes one of those through an "auto" path — the engine result is the
 * ONLY thing allowed to authorise skipping human review, and for these
 * kinds that authorisation can never be granted.
 */
export function assertNeverAuto(kind: AutoPostKind): void {
  if (NEVER_AUTO.has(kind)) return; // correct: these can never auto — nothing to assert against
  throw new Error(`assertNeverAuto called with auto-eligible kind "${kind}" — use evaluateAutoPost to authorise instead`);
}

/** True when a kind is in the never-auto matrix (exported for call sites
 * that want to branch without catching a throw). */
export function isNeverAuto(kind: AutoPostKind): boolean {
  return NEVER_AUTO.has(kind);
}

/**
 * Apply the blueprint matrix. Pure + deterministic. Returns whether the
 * item may auto-proceed and the human-readable reasons (recorded in the
 * record/audit payload so every auto decision explains itself).
 *
 * This is the SOLE authorization for skipping human review. Never-auto
 * kinds hard-return auto:false regardless of any other signal.
 */
export function evaluateAutoPost(args: EvaluateAutoPostArgs): EvaluateAutoPostResult {
  const { kind, thresholds } = args;
  const reasons: string[] = [];

  if (NEVER_AUTO.has(kind)) {
    return { auto: false, reasons: [`matrix: ${kind} is always founder-approved (never auto)`] };
  }

  const amount = typeof args.amountAedEquivalent === "number" && Number.isFinite(args.amountAedEquivalent)
    ? args.amountAedEquivalent
    : null;

  if (kind === "bookkeeper_journal") {
    // Matrix: deterministic, rule-derived postings are always auto.
    return { auto: true, reasons: ["matrix: deterministic Bookkeeper journal — always auto"] };
  }

  if (kind === "cash_application") {
    // Auto ONLY on an exact single-candidate match; everything else → review.
    if (args.exactSingleCandidate === true) {
      return { auto: true, reasons: ["cash: exact single-candidate match"] };
    }
    return { auto: false, reasons: ["cash: not an exact single-candidate match — review queue"] };
  }

  if (kind === "supplier_invoice") {
    const ceiling = thresholds.supplierInvoiceAutoMaxAed;
    const conf = allClear(args.confidences, thresholds.journalAutoConfidence);
    const underCeiling = amount !== null && amount <= ceiling;
    const known = args.knownVendor === true;
    if (underCeiling) reasons.push(`amount AED ${amount} ≤ ceiling ${ceiling}`);
    else reasons.push(amount === null ? "amount not quantified in AED" : `amount AED ${amount} > ceiling ${ceiling}`);
    if (conf.ok) reasons.push(`all confidences ≥ ${thresholds.journalAutoConfidence}`);
    else reasons.push(conf.min === null ? "no field confidences supplied" : `lowest confidence ${conf.min} < ${thresholds.journalAutoConfidence}`);
    reasons.push(known ? "known vendor" : "vendor not a known counterparty");
    return { auto: underCeiling && conf.ok && known, reasons };
  }

  // ai_journal
  // NOTE (Task #1091, code-review finding): as of this task there is NO
  // distinct AI-coded-journal proposal→post boundary in production. The only
  // journal-posting agent is the deterministic Bookkeeper (kind
  // "bookkeeper_journal", always-auto); anything it can't post
  // deterministically becomes an OPEN GL posting exception that surfaces in
  // the approvals inbox as `journal_review` for a human. This `ai_journal`
  // branch is therefore reachable only from the pure-function probe today —
  // it encodes the intended policy (confidence floor + AED ceiling from the
  // founder-editable journalAutoConfidence / journalAutoMaxAed settings) so
  // that a future model-coded-journal posting path has a single, tested
  // authorization to call. Do NOT claim it drives a live transition until a
  // caller is wired.
  const ceiling = thresholds.journalAutoMaxAed;
  const conf = allClear(args.confidences, thresholds.journalAutoConfidence);
  const underCeiling = amount !== null && amount <= ceiling;
  if (conf.ok) reasons.push(`all confidences ≥ ${thresholds.journalAutoConfidence}`);
  else reasons.push(conf.min === null ? "no field confidences supplied" : `lowest confidence ${conf.min} < ${thresholds.journalAutoConfidence}`);
  if (underCeiling) reasons.push(`amount AED ${amount} ≤ ceiling ${ceiling}`);
  else reasons.push(amount === null ? "amount not quantified in AED" : `amount AED ${amount} > ceiling ${ceiling}`);
  return { auto: conf.ok && underCeiling, reasons };
}
