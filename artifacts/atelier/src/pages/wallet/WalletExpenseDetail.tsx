import * as React from "react";
import { useRoute, useLocation } from "wouter";
import { PageHero, SectionHead, Card, MonoChip } from "@/components/ui/primitives";

interface Finding {
  ruleId: string;
  severity: "amber" | "red";
  category: string;
  message: string;
}

interface AuditorProposal {
  category: string;
  vatTreatment: string;
  vatAmount: number;
  clientBillable: boolean;
  markupPct: number;
  summary: string;
  ocrConfidence: "green" | "amber" | "red";
  refused?: boolean;
  reason?: string;
}

interface Expense {
  id: string;
  personId: string;
  engagementId: string | null;
  expenseDate: string;
  captureSource: string;
  merchant: string | null;
  merchantNormalized?: string | null;
  merchantResolution?: string | null;
  description: string | null;
  category: string;
  amount: number;
  currency: string;
  fxRate: number;
  usdAmount: number;
  vatAmount: number;
  vatTreatment: string;
  vatCountry: string | null;
  clientBillable: boolean;
  markupPct: number;
  status: string;
  policyStatus: string;
  receiptFileRef: string | null;
  policyFindings: Finding[];
  overrideRationale: string | null;
  auditorRunId: string | null;
  auditorProposal: AuditorProposal | null;
  summary: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  approvalRoute: string | null;
}

interface Me {
  id: string;
  role: string;
}

// Task #76 — inline receipt preview. Receipts may be images or PDFs; try an
// <img> thumbnail first and fall back to a plain "open receipt" link when the
// bytes are not renderable as an image (e.g. PDF).
function ReceiptPreview({ src }: { src: string }) {
  const [imgFailed, setImgFailed] = React.useState(false);
  return (
    <div>
      <a href={src} target="_blank" rel="noreferrer" data-testid="receipt-open-full">
        {imgFailed ? (
          <span className="text-sm text-stone-700 underline">Open receipt (not an image preview)</span>
        ) : (
          <img
            src={src}
            alt="Attached receipt"
            className="max-h-64 rounded border border-stone-200 object-contain"
            onError={() => setImgFailed(true)}
            data-testid="receipt-thumbnail"
          />
        )}
      </a>
      {!imgFailed ? (
        <p className="mt-1 text-xs text-stone-500">Click to open the full-size receipt in a new tab.</p>
      ) : null}
    </div>
  );
}

// Task #408 — correct a wrong/unrecognized parsed merchant, optionally
// remembering the correction as an org-wide alias for future parses.
function MerchantEditor({
  expense,
  busy,
  onSaved,
  onError,
}: {
  expense: Expense;
  busy: boolean;
  onSaved: (e: Expense, remembered: boolean) => void;
  onError: (msg: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(expense.merchant ?? "");
  const [remember, setRemember] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  if (expense.status !== "draft" && expense.status !== "submitted") return null;

  if (!editing) {
    return (
      <button
        className="mt-2 text-xs text-stone-500 underline hover:text-stone-700"
        disabled={busy}
        onClick={() => {
          setValue(expense.merchant ?? "");
          setRemember(true);
          setEditing(true);
        }}
        data-testid="btn-edit-merchant"
      >
        Wrong merchant? Correct it
      </button>
    );
  }

  const changed = value.trim().length > 0 && value.trim() !== (expense.merchant ?? "").trim();

  const save = async () => {
    setSaving(true);
    try {
      const r = await fetch(`/api/atelier/wallet/expenses/${expense.id}/merchant`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merchant: value.trim(), remember: remember && changed }),
      });
      const d = await r.json();
      if (!r.ok) {
        onError(d.message ?? d.error ?? `error-${r.status}`);
      } else {
        onSaved(d.expense, d.remembered === true);
        setEditing(false);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded border border-stone-200 bg-stone-50 p-3" data-testid="merchant-editor">
      <label className="block text-xs text-stone-500">Correct merchant name</label>
      <input
        className="w-full rounded border border-stone-300 px-2 py-1.5 text-sm"
        value={value}
        maxLength={200}
        onChange={(e) => setValue(e.target.value)}
        data-testid="input-merchant-correction"
      />
      {changed && expense.merchant ? (
        <label className="flex items-center gap-2 text-xs text-stone-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            data-testid="checkbox-remember-correction"
          />
          Remember this correction — recognize “{expense.merchant}” as “{value.trim()}” from now on
        </label>
      ) : null}
      <div className="flex gap-2">
        <button
          className="rounded bg-stone-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
          disabled={saving || !value.trim()}
          onClick={() => void save()}
          data-testid="btn-save-merchant"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          className="rounded border px-3 py-1.5 text-xs"
          disabled={saving}
          onClick={() => setEditing(false)}
          data-testid="btn-cancel-merchant"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function WalletExpenseDetail() {
  const [, params] = useRoute("/wallet/expenses/:id");
  const [, setLocation] = useLocation();
  const [expense, setExpense] = React.useState<Expense | null>(null);
  const [me, setMe] = React.useState<Me | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const id = params?.id;

  const load = React.useCallback(async () => {
    if (!id) return;
    setError(null);
    try {
      const r = await fetch(`/api/atelier/wallet/expenses/${id}`, { credentials: "include" });
      if (!r.ok) throw new Error(`load-${r.status}`);
      const d = await r.json();
      setExpense(d.expense);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [id]);

  React.useEffect(() => {
    void load();
  }, [load]);

  // Task #501 — needed to decide whether the viewer may act on their own
  // claim (founding partners self-approve; everyone else may not).
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/atelier/me", { credentials: "include" });
        if (!r.ok) return;
        const d = await r.json();
        if (!cancelled) setMe({ id: d.id, role: d.role });
      } catch {
        // non-fatal; buttons fall back to server-side enforcement
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwnClaim = !!(me && expense && expense.personId === me.id);
  const canActOnClaim = !isOwnClaim || me?.role === "founding_partner";

  async function action(path: string, body: Record<string, unknown> = {}) {
    if (!id) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/atelier/wallet/expenses/${id}/${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.message ?? d.error ?? `error-${r.status}`);
      } else {
        setExpense(d.expense);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!id) return <div className="p-8 text-stone-600">Missing expense id.</div>;
  if (!expense && !error) return <div className="p-8 text-stone-600">Loading…</div>;

  return (
    <div className="space-y-6 p-6">
      <PageHero>
        <SectionHead
          eyebrow={expense?.merchant ?? "Expense"}
          headline={expense?.merchant ?? "Expense"}
          lede={
            <span>
              {expense?.expenseDate} · {expense?.captureSource} · {expense?.category}{" "}
              <MonoChip>{expense?.id}</MonoChip>
            </span>
          }
        />
      </PageHero>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">{error}</div>
      ) : null}
      {notice ? (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-800" data-testid="merchant-notice">
          {notice}
        </div>
      ) : null}

      {expense ? (
        <>
          <Card>
            <h2 className="font-serif text-lg">Amounts</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <div><dt className="text-stone-500">Original</dt><dd>{expense.currency} {expense.amount.toFixed(2)}</dd></div>
              <div><dt className="text-stone-500">USD</dt><dd>${expense.usdAmount.toFixed(2)} @ {expense.fxRate}</dd></div>
              <div><dt className="text-stone-500">VAT</dt><dd>{expense.vatTreatment} · {expense.vatAmount.toFixed(2)} {expense.currency}</dd></div>
              <div><dt className="text-stone-500">Country</dt><dd>{expense.vatCountry ?? "—"}</dd></div>
              <div><dt className="text-stone-500">Client billable</dt><dd>{expense.clientBillable ? `yes · markup ${expense.markupPct}%` : "no"}</dd></div>
              <div>
                <dt className="text-stone-500">Status</dt>
                <dd>
                  <MonoChip>{expense.status}</MonoChip> · policy <MonoChip>{expense.policyStatus}</MonoChip>
                  {expense.approvalRoute === "founder_self" ? (
                    <span
                      className="ml-2 inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800"
                      data-testid="chip-founder-self"
                    >
                      Self-approved (founder)
                    </span>
                  ) : null}
                </dd>
              </div>
            </dl>
            {expense.merchantNormalized && expense.merchantNormalized !== expense.merchant ? (
              <p className="mt-3 text-xs text-stone-500" data-testid="merchant-normalized">
                Recognized as <span className="text-stone-700">{expense.merchantNormalized}</span>
                {expense.merchantResolution ? ` · via ${expense.merchantResolution.replace(/_/g, " ")}` : ""}
              </p>
            ) : null}
            {expense.description ? <p className="mt-3 text-sm text-stone-700">{expense.description}</p> : null}
            <MerchantEditor
              expense={expense}
              busy={busy}
              onSaved={(e, remembered) => {
                setExpense(e);
                setError(null);
                setNotice(
                  remembered
                    ? "Merchant corrected — this correction will be recognized automatically next time."
                    : "Merchant corrected.",
                );
              }}
              onError={(msg) => setError(msg)}
            />
          </Card>

          {expense.receiptFileRef?.startsWith("/objects/") ? (
            <Card>
              <h2 className="font-serif text-lg">Receipt</h2>
              <div className="mt-3">
                <ReceiptPreview src={`/api/atelier/wallet/expenses/${expense.id}/receipt`} />
              </div>
            </Card>
          ) : null}

          {expense.policyFindings.length > 0 ? (
            <Card>
              <h2 className="font-serif text-lg">Policy findings</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {expense.policyFindings.map((f, i) => (
                  <li key={i} className={f.severity === "red" ? "text-red-700" : "text-amber-700"}>
                    <MonoChip>{f.severity.toUpperCase()}</MonoChip> {f.message}
                  </li>
                ))}
              </ul>
              {expense.overrideRationale ? (
                <p className="mt-3 text-xs italic text-stone-600">Override rationale: {expense.overrideRationale}</p>
              ) : null}
            </Card>
          ) : null}

          {expense.auditorProposal ? (
            <Card>
              <h2 className="font-serif text-lg">Auditor proposal</h2>
              <pre className="mt-2 overflow-auto rounded bg-stone-50 p-3 text-xs">{JSON.stringify(expense.auditorProposal, null, 2)}</pre>
              {expense.auditorRunId ? <p className="mt-2 text-xs text-stone-500">Run {expense.auditorRunId}</p> : null}
            </Card>
          ) : null}

          {expense.rejectedReason ? (
            <Card>
              <h2 className="font-serif text-lg text-red-700">Rejected</h2>
              <p className="mt-2 text-sm">{expense.rejectedReason}</p>
            </Card>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {(expense.status === "draft" || expense.status === "submitted") &&
            expense.receiptFileRef ? (
              <button
                className="rounded bg-stone-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => action("parse-receipt")}
                data-testid="btn-parse-receipt"
              >
                Parse receipt
              </button>
            ) : null}
            {expense.status === "draft" ? (
              <>
                <button
                  className="rounded bg-stone-900 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => action("audit")}
                >
                  Run Auditor
                </button>
                <button
                  className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    const rationale = expense.policyStatus === "amber"
                      ? prompt("AMBER override rationale:") ?? undefined
                      : undefined;
                    void action("submit", rationale ? { overrideRationale: rationale } : {});
                  }}
                >
                  Submit for approval
                </button>
              </>
            ) : null}
            {expense.status === "approved" ? (
              <button
                className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                disabled={busy}
                onClick={() => action("reimburse")}
                data-testid="btn-reimburse"
              >
                Mark reimbursed
              </button>
            ) : null}
            {expense.status === "submitted" && canActOnClaim ? (
              <>
                <button
                  className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => action("approve")}
                  data-testid="btn-approve-expense"
                >
                  {isOwnClaim ? "Approve (own claim)" : "Approve"}
                </button>
                <button
                  className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    const reason = prompt("Reject reason:") ?? "rejected";
                    void action("reject", { reason });
                  }}
                  data-testid="btn-reject-expense"
                >
                  Reject
                </button>
              </>
            ) : null}
            {expense.status === "submitted" && !canActOnClaim ? (
              <span className="self-center text-xs text-stone-500" data-testid="text-no-self-approval">
                Awaiting approval — you can't approve your own claim.
              </span>
            ) : null}
            <button
              className="rounded border px-4 py-2 text-sm"
              onClick={() => setLocation("/wallet/expenses")}
            >
              Back to list
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
