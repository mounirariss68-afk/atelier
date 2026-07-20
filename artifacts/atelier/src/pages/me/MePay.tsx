/**
 * MePay — Task #54: the self-scope "Pay & Benefits" section of the Me lens.
 *
 * Everything here renders from GET /me/pay, which only ever answers for the
 * signed-in person. Employees see payslips/letters/contract, a comp summary,
 * insurance details and masked bank details with an HR-approved change-request
 * flow. Contractors see the variant: remittances + day-rate summary, no
 * benefits or bank surface.
 */
import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAtelierGetMyPay,
  useAtelierCreateBankChangeRequest,
  getAtelierGetMyPayQueryKey,
  type AtelierMyPay,
  type AtelierPayDocument,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
import { Input } from "@/components/ui/input";

const CATEGORY_LABEL: Record<string, string> = {
  contract: "Contract",
  salary_letter: "Salary letter",
  bonus_letter: "Bonus letter",
  comp_letter: "Comp letter",
  payslip: "Payslip",
  remittance: "Remittance",
  insurance: "Insurance",
};

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="font-mono text-[10px] uppercase tracking-wider text-text-faint">{label}</span>
      <span className="text-text">{value ?? "—"}</span>
    </div>
  );
}

export default function MePay() {
  const { data, isLoading } = useAtelierGetMyPay();

  if (isLoading) {
    return (
      <Card className="p-6 text-sm text-text-faint" data-testid="me-pay-loading">
        Loading your pay &amp; benefits…
      </Card>
    );
  }
  if (!data?.person) {
    return (
      <Card className="p-6 text-sm text-text-mute" data-testid="me-pay-unlinked">
        No roster record is linked to your login yet, so there is nothing to
        show here. Ask HR to link your profile from the People lens.
      </Card>
    );
  }

  const isContractor = data.person.workerType === "contractor";

  return (
    <div className="space-y-6" data-testid="me-pay">
      <DocumentsCard data={data} isContractor={isContractor} />
      <div className="grid gap-4 md:grid-cols-2">
        <CompCard data={data} isContractor={isContractor} />
        {isContractor ? <ContractorNoteCard /> : <InsuranceCard data={data} />}
      </div>
      {!isContractor && <BankCard data={data} />}
      <SelfBilledInvoicesCard />
    </div>
  );
}

// ============================================================
// Self-billed (RCTI) invoices — Task #430. Bespoke /me/self-billing
// routes are not in the openapi spec, so this card uses raw fetch.
// ============================================================
interface MySelfBilledInvoice {
  id: string;
  invoiceNumber: string;
  supplierName: string;
  weekIso: string;
  currency: string;
  subtotalAmount: number;
  vatAmount: number;
  totalAmount: number;
  status: "draft" | "approved" | "disputed" | "scheduled" | "paid";
  disputeReason: string | null;
  disputeResolutionNote: string | null;
  paidAt: string | null;
  remittanceRef: string | null;
}

function sbiTone(s: MySelfBilledInvoice["status"]): "default" | "amber" | "green" | "red" {
  if (s === "paid") return "green";
  if (s === "disputed") return "red";
  return "amber";
}

export function SelfBilledInvoicesCard() {
  const [items, setItems] = React.useState<MySelfBilledInvoice[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const load = React.useCallback(async () => {
    try {
      const res = await fetch("/api/atelier/me/self-billing", { credentials: "include" });
      if (!res.ok) throw new Error(`${res.status}`);
      const j = (await res.json()) as { items: MySelfBilledInvoice[] };
      setItems(j.items);
    } catch {
      setItems([]);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  const act = async (key: string, path: string, body: unknown) => {
    setBusy(key); setError(null);
    try {
      const res = await fetch(`/api/atelier${path}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const j = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
      if (!res.ok) throw new Error(j?.message ?? j?.error ?? `${res.status}`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (items === null || items.length === 0) return null;

  return (
    <Card className="p-5" data-testid="me-selfbilling">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Self-billed invoices</h3>
        <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint">RCTI · raised on your behalf</span>
      </div>
      <p className="text-xs text-text-mute mt-1">
        Cognirise raises these invoices for your approved hours under a self-billing agreement. Download the PDF for your records, or dispute an invoice before it is paid.
      </p>
      {error && <div className="text-xs text-danger mt-2">⚠ {error}</div>}
      <div className="mt-3 space-y-2">
        {items.map((inv) => (
          <div key={inv.id} className="border border-border-soft rounded p-3 text-xs" data-testid={`me-sbi-${inv.id}`}>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono">{inv.invoiceNumber}</span>
                <span className="text-text-mute">{inv.weekIso}</span>
                <MonoChip tone={sbiTone(inv.status)} data-testid={`me-sbi-status-${inv.id}`}>{inv.status}</MonoChip>
              </div>
              <span className="font-mono">{inv.currency} {inv.totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
            </div>
            {inv.status === "paid" && (
              <div className="text-text-mute mt-1">
                Paid {inv.paidAt?.slice(0, 10)}{inv.remittanceRef ? ` · remittance ${inv.remittanceRef}` : ""}
              </div>
            )}
            {inv.status === "disputed" && (
              <div className="text-danger mt-1">Disputed: {inv.disputeReason}</div>
            )}
            {inv.disputeResolutionNote && inv.status !== "disputed" && (
              <div className="text-text-mute mt-1">Dispute resolved: {inv.disputeResolutionNote}</div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <a
                href={`/api/atelier/me/self-billing/${inv.id}/pdf`}
                className="text-gold hover:underline"
                data-testid={`me-sbi-pdf-${inv.id}`}
              >
                Download PDF
              </a>
              {(inv.status === "draft" || inv.status === "approved") && (
                <button
                  type="button"
                  className="text-danger hover:underline disabled:opacity-50"
                  disabled={!!busy}
                  data-testid={`me-sbi-dispute-${inv.id}`}
                  onClick={() => {
                    const reason = window.prompt(`Dispute ${inv.invoiceNumber}. What looks wrong?`);
                    if (!reason) return;
                    void act(`d:${inv.id}`, `/me/self-billing/${inv.id}/dispute`, { reason });
                  }}
                >
                  {busy === `d:${inv.id}` ? "…" : "Dispute"}
                </button>
              )}
              {inv.status === "disputed" && (
                <button
                  type="button"
                  className="text-text-mute hover:underline disabled:opacity-50"
                  disabled={!!busy}
                  data-testid={`me-sbi-withdraw-${inv.id}`}
                  onClick={() => void act(`w:${inv.id}`, `/me/self-billing/${inv.id}/withdraw-dispute`, {})}
                >
                  {busy === `w:${inv.id}` ? "…" : "Withdraw dispute"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function DocumentsCard({ data, isContractor }: { data: AtelierMyPay; isContractor: boolean }) {
  const docs = data.documents ?? [];
  const slipLabel = isContractor ? "remittances" : "payslips";
  return (
    <Card className="p-4" data-testid="me-pay-documents">
      <h3 className="text-sm font-semibold text-text mb-2">Your documents</h3>
      {docs.length === 0 ? (
        <p className="text-sm text-text-mute">
          No documents yet. Your {slipLabel}, contract and letters will appear
          here as soon as HR publishes them.
        </p>
      ) : (
        <ul className="divide-y divide-border-soft">
          {docs.map((d: AtelierPayDocument) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2" data-testid={`me-pay-doc-${d.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <MonoChip tone="gold">{CATEGORY_LABEL[d.category] ?? d.category}</MonoChip>
                  <span className="text-sm text-text truncate">{d.title}</span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-text-faint">
                  {d.periodDate ? `${d.periodDate} · ` : ""}{d.fileName} · {fmtBytes(d.sizeBytes)}
                </p>
              </div>
              <a
                href={d.downloadUrl}
                className="shrink-0 text-xs text-gold hover:underline"
                data-testid={`me-pay-download-${d.id}`}
              >
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CompCard({ data, isContractor }: { data: AtelierMyPay; isContractor: boolean }) {
  const c = data.compSummary;
  return (
    <Card className="p-4" data-testid="me-pay-comp">
      <h3 className="text-sm font-semibold text-text mb-2">Compensation summary</h3>
      {!c ? (
        <p className="text-sm text-text-mute">No compensation details on file.</p>
      ) : isContractor ? (
        <div className="divide-y divide-border-soft">
          <Field
            label="Day rate"
            value={
              c.dayRateAmount != null
                ? `${c.dayRateAmount.toLocaleString()} ${c.dayRateCurrency ?? ""}`.trim()
                : "—"
            }
          />
        </div>
      ) : (
        <div className="divide-y divide-border-soft">
          <Field
            label="Base compensation"
            value={
              c.baseCompensation != null
                ? `${c.baseCompensation.toLocaleString()} ${c.baseCurrency ?? ""}`.trim()
                : "—"
            }
          />
        </div>
      )}
      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-text-faint">
        Visible only to you{isContractor ? "" : " and authorised HR/finance"}.
      </p>
    </Card>
  );
}

function InsuranceCard({ data }: { data: AtelierMyPay }) {
  const ins = data.insurance;
  return (
    <Card className="p-4" data-testid="me-pay-insurance">
      <h3 className="text-sm font-semibold text-text mb-2">Insurance</h3>
      {!ins ? (
        <p className="text-sm text-text-mute">
          No insurance scheme is on file for you yet. HR will add your policy
          details once enrolment is confirmed.
        </p>
      ) : (
        <div className="divide-y divide-border-soft">
          <Field label="Provider" value={ins.provider} />
          <Field label="Policy no." value={ins.policyNumber || "—"} />
          <Field label="Member no." value={ins.memberNumber || "—"} />
          {ins.coverageSummary ? (
            <p className="pt-2 text-sm text-text-mute">{ins.coverageSummary}</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function ContractorNoteCard() {
  return (
    <Card className="p-4" data-testid="me-pay-contractor-note">
      <h3 className="text-sm font-semibold text-text mb-2">Contractor arrangement</h3>
      <p className="text-sm text-text-mute">
        As a contractor you are paid against invoices — remittance advices
        appear in your documents above. Firm benefits (insurance, payslips)
        do not apply to contractor arrangements.
      </p>
    </Card>
  );
}

function BankCard({ data }: { data: AtelierMyPay }) {
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [iban, setIban] = React.useState("");
  const [swift, setSwift] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const create = useAtelierCreateBankChangeRequest({
    mutation: {
      onSuccess: () => {
        setOpen(false);
        setIban("");
        setSwift("");
        setReason("");
        setError(null);
        void qc.invalidateQueries({ queryKey: getAtelierGetMyPayQueryKey() });
      },
      onError: (e: unknown) => {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          "Could not submit the request.";
        setError(
          msg === "request-already-pending"
            ? "You already have a pending request — HR needs to decide it first."
            : msg === "invalid-iban"
              ? "That IBAN doesn't look valid — letters and digits only, 8–34 characters."
              : "Could not submit the request. Check the details and try again.",
        );
      },
    },
  });

  const bank = data.bank;
  const requests = data.bankRequests ?? [];
  const hasPending = requests.some((r) => r.status === "pending");

  return (
    <Card className="p-4" data-testid="me-pay-bank">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Payment details</h3>
        {!open && (
          <button
            className="text-xs text-gold hover:underline disabled:opacity-50"
            onClick={() => setOpen(true)}
            disabled={hasPending}
            data-testid="me-pay-bank-request-btn"
          >
            {hasPending ? "Change pending HR review" : "Request a change"}
          </button>
        )}
      </div>
      <div className="mt-2 divide-y divide-border-soft">
        <Field label="IBAN" value={bank?.ibanMasked ?? "Not on file"} />
        <Field label="SWIFT / BIC" value={bank?.swift ?? "—"} />
      </div>
      <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-text-faint">
        Bank details can only be changed via an HR-approved request.
      </p>

      {open && (
        <form
          className="mt-4 space-y-3 border-t border-border-soft pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            create.mutate({
              data: {
                newIban: iban.trim(),
                ...(swift.trim() ? { newSwift: swift.trim() } : {}),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              },
            });
          }}
          data-testid="me-pay-bank-form"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <Input
              placeholder="New IBAN"
              value={iban}
              onChange={(e) => setIban(e.target.value)}
              required
              minLength={8}
              maxLength={34}
              data-testid="me-pay-bank-iban"
            />
            <Input
              placeholder="New SWIFT / BIC (optional)"
              value={swift}
              onChange={(e) => setSwift(e.target.value)}
              maxLength={11}
              data-testid="me-pay-bank-swift"
            />
          </div>
          <Input
            placeholder="Reason (optional — helps HR verify)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={1000}
            data-testid="me-pay-bank-reason"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded bg-gold px-3 py-1.5 text-xs font-semibold text-black disabled:opacity-50"
              disabled={create.isPending || iban.trim().length < 8}
              data-testid="me-pay-bank-submit"
            >
              {create.isPending ? "Submitting…" : "Submit for HR review"}
            </button>
            <button
              type="button"
              className="text-xs text-text-mute hover:text-text"
              onClick={() => {
                setOpen(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {requests.length > 0 && (
        <div className="mt-4 border-t border-border-soft pt-3" data-testid="me-pay-bank-requests">
          <h4 className="font-mono text-[10px] uppercase tracking-wider text-text-faint mb-1">
            Change requests
          </h4>
          <ul className="divide-y divide-border-soft">
            {requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-1.5 text-sm">
                <span className="text-text">{r.newIbanMasked}</span>
                <span className="flex items-center gap-2">
                  {r.decisionNote ? (
                    <span className="text-xs text-text-mute truncate max-w-[16rem]">{r.decisionNote}</span>
                  ) : null}
                  <MonoChip tone={r.status === "approved" ? "gold" : undefined}>{r.status}</MonoChip>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
