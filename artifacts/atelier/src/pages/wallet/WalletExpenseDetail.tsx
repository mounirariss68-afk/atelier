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
  policyFindings: Finding[];
  overrideRationale: string | null;
  auditorRunId: string | null;
  auditorProposal: AuditorProposal | null;
  summary: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
}

export default function WalletExpenseDetail() {
  const [, params] = useRoute("/wallet/expenses/:id");
  const [, setLocation] = useLocation();
  const [expense, setExpense] = React.useState<Expense | null>(null);
  const [error, setError] = React.useState<string | null>(null);
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
              <div><dt className="text-stone-500">Status</dt><dd><MonoChip>{expense.status}</MonoChip> · policy <MonoChip>{expense.policyStatus}</MonoChip></dd></div>
            </dl>
            {expense.description ? <p className="mt-3 text-sm text-stone-700">{expense.description}</p> : null}
          </Card>

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
            {expense.status === "submitted" ? (
              <>
                <button
                  className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => action("approve")}
                >
                  Approve
                </button>
                <button
                  className="rounded bg-red-700 px-4 py-2 text-sm text-white disabled:opacity-50"
                  disabled={busy}
                  onClick={() => {
                    const reason = prompt("Reject reason:") ?? "rejected";
                    void action("reject", { reason });
                  }}
                >
                  Reject
                </button>
              </>
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
