/**
 * MeExpenses — Task #53: self-service expense claims on the Me lens.
 *
 * Draft → submitted → approved/rejected → reimbursed lifecycle against the
 * self-scoped /me/expenses API. Claims carry a context tag (BD / account /
 * engagement / internal project) and an optional receipt captured via the
 * device camera (input capture="environment") uploaded straight to private
 * object storage.
 */
import * as React from "react";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";

const API = "/api/atelier/me";

interface Claim {
  id: string;
  expenseDate: string;
  merchant: string | null;
  description: string | null;
  category: string;
  amount: number;
  currency: string;
  status: string;
  policyStatus: string;
  policyFindings: unknown;
  contextType: string;
  accountId: string | null;
  engagementId: string | null;
  internalProjectLabel: string | null;
  hasReceipt: boolean;
  rejectedReason: string | null;
  reimbursedAt: string | null;
  createdAt: string;
}

interface ContextOption {
  id: string;
  name: string;
}

const CATEGORIES = ["travel", "meals", "accommodation", "software", "equipment", "other"];
const CONTEXTS = [
  { value: "bd", label: "Business development" },
  { value: "account", label: "Client account" },
  { value: "engagement", label: "Engagement" },
  { value: "internal", label: "Internal project" },
];

function statusTone(s: string): "default" | "amber" | "green" | "gold" | "red" {
  if (s === "submitted") return "amber";
  if (s === "approved") return "gold";
  if (s === "reimbursed") return "green";
  if (s === "rejected") return "red";
  return "default";
}

// Task #76 — inline receipt thumbnail in claim history. Receipts may be
// images or PDFs; try an <img> first and fall back to a text link when the
// bytes are not renderable as an image.
function ReceiptThumb({ src, id }: { src: string; id: string }) {
  const [imgFailed, setImgFailed] = React.useState(false);
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer"
      className="inline-block"
      data-testid={`exp-receipt-link-${id}`}
    >
      {imgFailed ? (
        <span className="text-xs text-gold hover:underline">open receipt</span>
      ) : (
        <img
          src={src}
          alt="Receipt"
          className="max-h-24 rounded border border-border-soft object-contain"
          onError={() => setImgFailed(true)}
          data-testid={`exp-receipt-thumb-${id}`}
        />
      )}
    </a>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text min-h-[44px] focus:outline-none focus:ring-1 focus:ring-gold/50";

const emptyForm = {
  merchant: "",
  description: "",
  category: "other",
  amount: "",
  currency: "USD",
  expenseDate: new Date().toISOString().slice(0, 10),
  contextType: "bd",
  accountId: "",
  engagementId: "",
  internalProjectLabel: "",
};

export default function MeExpenses() {
  const [claims, setClaims] = React.useState<Claim[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [showForm, setShowForm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({ ...emptyForm });
  const [accounts, setAccounts] = React.useState<ContextOption[]>([]);
  const [engagements, setEngagements] = React.useState<ContextOption[]>([]);
  const [receiptFile, setReceiptFile] = React.useState<File | null>(null);
  const [amberFor, setAmberFor] = React.useState<{ id: string; findings: string[] } | null>(null);
  const [rationale, setRationale] = React.useState("");

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`${API}/expenses`, { credentials: "include" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      const j = await r.json();
      setClaims(j.expenses ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
    void fetch(`${API}/expense-contexts`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { accounts: [], engagements: [] }))
      .then((j) => {
        setAccounts(j.accounts ?? []);
        setEngagements(j.engagements ?? []);
      })
      .catch(() => undefined);
  }, [load]);

  const uploadReceipt = async (): Promise<string | null> => {
    if (!receiptFile) return null;
    const r = await fetch(`${API}/expenses/receipt-upload`, {
      method: "POST",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.uploadURL) throw new Error(j.error || "Receipt upload unavailable.");
    const put = await fetch(j.uploadURL, {
      method: "PUT",
      body: receiptFile,
      headers: { "Content-Type": receiptFile.type || "application/octet-stream" },
    });
    if (!put.ok) throw new Error("Receipt upload failed.");
    return j.uploadURL.split("?")[0];
  };

  const create = async () => {
    if (!form.merchant.trim() || !form.amount) {
      setError("Merchant and amount are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const receiptPath = await uploadReceipt();
      const r = await fetch(`${API}/expenses`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: form.merchant,
          description: form.description || undefined,
          category: form.category,
          amount: Number(form.amount),
          currency: form.currency,
          expenseDate: form.expenseDate,
          contextType: form.contextType,
          accountId: form.contextType === "account" ? form.accountId : undefined,
          engagementId: form.contextType === "engagement" ? form.engagementId : undefined,
          internalProjectLabel:
            form.contextType === "internal" ? form.internalProjectLabel : undefined,
          receiptPath: receiptPath ?? undefined,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      setForm({ ...emptyForm });
      setReceiptFile(null);
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (id: string, overrideRationale?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API}/expenses/${id}/submit`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrideRationale ? { overrideRationale } : {}),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.error === "amber-requires-rationale") {
        setAmberFor({
          id,
          findings: (j.findings ?? []).map((f: { message?: string }) => f.message ?? String(f)),
        });
        return;
      }
      if (!r.ok) {
        if (j.error === "policy-red-block") {
          const msgs = (j.findings ?? [])
            .map((f: { message?: string }) => f.message ?? "")
            .filter(Boolean)
            .join(" · ");
          throw new Error(`Blocked by policy: ${msgs || "red finding"}`);
        }
        throw new Error(j.reason || j.error || `HTTP ${r.status}`);
      }
      setAmberFor(null);
      setRationale("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await fetch(`${API}/expenses/${id}`, { method: "DELETE", credentials: "include" });
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="me-expenses">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Expense claims</h3>
        <PillButton onClick={() => setShowForm((v) => !v)} className="min-h-[44px]">
          {showForm ? "Close" : "New claim"}
        </PillButton>
      </div>

      {error && (
        <Card className="border-red-500/40 bg-red-500/5 p-3 text-sm text-red-300">{error}</Card>
      )}

      {amberFor && (
        <Card className="border-amber-500/50 bg-amber-500/5 p-4 space-y-2" data-testid="amber-dialog">
          <div className="text-sm font-semibold text-amber-300">Policy warning</div>
          <ul className="list-disc pl-5 text-sm text-text-mute">
            {amberFor.findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
          <input
            type="text"
            className={inputCls}
            placeholder="Why should this still be submitted?"
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            data-testid="amber-rationale"
          />
          <div className="flex gap-2">
            <PillButton
              onClick={() => submit(amberFor.id, rationale)}
              disabled={busy || !rationale.trim()}
              className="min-h-[44px]"
            >
              Submit anyway
            </PillButton>
            <PillButton variant="ghost" onClick={() => setAmberFor(null)} className="min-h-[44px]">
              Cancel
            </PillButton>
          </div>
        </Card>
      )}

      {showForm && (
        <Card className="p-4 space-y-3" data-testid="me-expense-form">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Merchant *</span>
              <input
                type="text"
                className={inputCls}
                value={form.merchant}
                onChange={(e) => setForm((f) => ({ ...f, merchant: e.target.value }))}
                data-testid="exp-merchant"
              />
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Date</span>
              <input
                type="date"
                className={inputCls}
                value={form.expenseDate}
                onChange={(e) => setForm((f) => ({ ...f, expenseDate: e.target.value }))}
                data-testid="exp-date"
              />
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Amount *</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className={inputCls}
                value={form.amount}
                onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                data-testid="exp-amount"
              />
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Currency</span>
              <select
                className={inputCls}
                value={form.currency}
                onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              >
                {["USD", "AED", "SAR", "GBP", "EUR"].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Category</span>
              <select
                className={inputCls}
                value={form.category}
                onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              >
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Context</span>
              <select
                className={inputCls}
                value={form.contextType}
                onChange={(e) => setForm((f) => ({ ...f, contextType: e.target.value }))}
                data-testid="exp-context"
              >
                {CONTEXTS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            {form.contextType === "account" && (
              <label className="text-xs text-text-mute space-y-1 sm:col-span-2">
                <span className="font-mono uppercase tracking-wider text-[10px]">Account</span>
                <select
                  className={inputCls}
                  value={form.accountId}
                  onChange={(e) => setForm((f) => ({ ...f, accountId: e.target.value }))}
                  data-testid="exp-account"
                >
                  <option value="">Choose an account…</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form.contextType === "engagement" && (
              <label className="text-xs text-text-mute space-y-1 sm:col-span-2">
                <span className="font-mono uppercase tracking-wider text-[10px]">Engagement</span>
                <select
                  className={inputCls}
                  value={form.engagementId}
                  onChange={(e) => setForm((f) => ({ ...f, engagementId: e.target.value }))}
                  data-testid="exp-engagement"
                >
                  <option value="">Choose an engagement…</option>
                  {engagements.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {form.contextType === "internal" && (
              <label className="text-xs text-text-mute space-y-1 sm:col-span-2">
                <span className="font-mono uppercase tracking-wider text-[10px]">
                  Internal project
                </span>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. Offsite 2026"
                  value={form.internalProjectLabel}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, internalProjectLabel: e.target.value }))
                  }
                  data-testid="exp-internal-label"
                />
              </label>
            )}
          </div>
          <label className="block text-xs text-text-mute space-y-1">
            <span className="font-mono uppercase tracking-wider text-[10px]">Description</span>
            <input
              type="text"
              className={inputCls}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </label>
          <label className="block text-xs text-text-mute space-y-1">
            <span className="font-mono uppercase tracking-wider text-[10px]">
              Receipt (photo or file)
            </span>
            <input
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="block w-full text-sm text-text-mute file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-2 file:text-sm file:text-text min-h-[44px]"
              onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
              data-testid="exp-receipt"
            />
            {receiptFile && <span className="text-xs text-text-faint">{receiptFile.name}</span>}
          </label>
          <PillButton onClick={create} disabled={busy} className="min-h-[44px]" data-testid="exp-save">
            {busy ? "Saving…" : "Save draft"}
          </PillButton>
        </Card>
      )}

      <Card className="p-0 overflow-hidden">
        {loading ? (
          <p className="p-4 text-sm text-text-faint">Loading claims…</p>
        ) : claims.length === 0 ? (
          <p className="p-4 text-sm text-text-mute" data-testid="me-expenses-empty">
            No expense claims yet.
          </p>
        ) : (
          <ul className="divide-y divide-border-soft" data-testid="me-expenses-list">
            {claims.map((c) => (
              <li key={c.id} className="p-3 text-sm space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <MonoChip tone={statusTone(c.status)}>{c.status}</MonoChip>
                  <span className="font-medium text-text">{c.merchant}</span>
                  <span className="text-text-mute">
                    {c.currency} {c.amount.toFixed(2)}
                  </span>
                  <MonoChip>{c.contextType}</MonoChip>
                  <span className="text-xs text-text-faint">{c.expenseDate}</span>
                </div>
                {c.hasReceipt && <ReceiptThumb src={`${API}/expenses/${c.id}/receipt`} id={c.id} />}
                {c.rejectedReason && (
                  <p className="text-xs text-red-300">Rejected: {c.rejectedReason}</p>
                )}
                {(c.status === "draft" || c.status === "rejected") && (
                  <div className="flex gap-3 pt-1">
                    <button
                      className="font-mono text-[10px] uppercase tracking-wider text-gold hover:underline min-h-[44px]"
                      onClick={() => submit(c.id)}
                      disabled={busy}
                      data-testid={`exp-submit-${c.id}`}
                    >
                      Submit
                    </button>
                    <button
                      className="font-mono text-[10px] uppercase tracking-wider text-text-faint hover:text-red-300 min-h-[44px]"
                      onClick={() => remove(c.id)}
                      disabled={busy}
                      data-testid={`exp-delete-${c.id}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
