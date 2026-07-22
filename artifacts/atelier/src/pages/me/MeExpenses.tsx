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
  merchantNormalized?: string | null;
  merchantResolution?: string | null;
  rejectedReason: string | null;
  reimbursedAt: string | null;
  createdAt: string;
}

interface ContextOption {
  id: string;
  name: string;
}

// Task #383 — taxonomy-as-data: categories come from the server, not a
// hard-coded list. The legacy flat list stays only as an offline fallback.
interface TaxonomySub {
  code: string;
  label: string;
  policyKey: string;
}
interface TaxonomyCat {
  code: string;
  label: string;
  subCategories: TaxonomySub[];
}
interface Taxonomy {
  categories: TaxonomyCat[];
  costCenters: string[];
  fundingSources: string[];
  entities: ContextOption[];
  bankAccounts?: { id: string; label: string }[];
}
interface Suggestion {
  categoryCode: string;
  subCategoryCode: string;
  source: "merchant_memory" | "ai";
  confidence: "green" | "amber" | "red";
  rationale?: string;
}

const FUNDING_LABELS: Record<string, string> = {
  personal_claim: "Personal (reimburse me)",
  partner_paid: "Partner paid",
  company_account: "Company account (no reimbursement)",
};

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
  categoryCode: "",
  subCategoryCode: "",
  bdIndustry: "",
  entityId: "",
  costCenter: "",
  fundingSource: "personal_claim",
  fundingBankAccountId: "",
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
  const [taxonomy, setTaxonomy] = React.useState<Taxonomy | null>(null);
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null);
  const [suggestBusy, setSuggestBusy] = React.useState(false);
  const [suggestError, setSuggestError] = React.useState<string | null>(null);
  // Task #411 — automatic receipt pipeline: selecting a file uploads it,
  // creates (or reuses) a draft, parses, and prefills the form for review.
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [autoBusyText, setAutoBusyText] = React.useState<string | null>(null);
  const [autoNote, setAutoNote] = React.useState<{ text: string; ok: boolean } | null>(null);

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
    void fetch("/api/atelier/wallet/expense-taxonomy", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setTaxonomy(j))
      .catch(() => setTaxonomy(null));
  }, [load]);

  // Task #383 — merchant-memory → AI category suggestion. Fail-loud: an AI
  // error is shown, never silently guessed around.
  const suggest = async () => {
    if (!form.merchant.trim() && !form.description.trim()) return;
    setSuggestBusy(true);
    setSuggestError(null);
    try {
      const r = await fetch("/api/atelier/wallet/expense-categorize/suggest", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: form.merchant || undefined,
          description: form.description || undefined,
          amount: form.amount ? Number(form.amount) : undefined,
          currency: form.currency,
          contextType: form.contextType,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || j.error || `HTTP ${r.status}`);
      setSuggestion(j.suggestion ?? null);
      if (j.aiError) setSuggestError(j.aiError);
      else if (!j.suggestion) setSuggestError("No confident suggestion — pick a category manually.");
      if (j.suggestion) {
        setForm((f) => ({
          ...f,
          categoryCode: j.suggestion.categoryCode,
          subCategoryCode: j.suggestion.subCategoryCode,
        }));
      }
    } catch (e) {
      setSuggestError((e as Error).message);
    } finally {
      setSuggestBusy(false);
    }
  };

  const selectedCat = taxonomy?.categories.find((c) => c.code === form.categoryCode) ?? null;

  const uploadReceipt = async (fileOverride?: File): Promise<string | null> => {
    const file = fileOverride ?? receiptFile;
    if (!file) return null;
    const r = await fetch(`${API}/expenses/receipt-upload`, {
      method: "POST",
      credentials: "include",
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.uploadURL) throw new Error(j.error || "Receipt upload unavailable.");
    const put = await fetch(j.uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });
    if (!put.ok) throw new Error("Receipt upload failed.");
    return j.uploadURL.split("?")[0];
  };

  // Task #411 — launch the parse in the background and poll: the LLM-heavy
  // parse can outlive a held request (proxy 502s), so 202 + poll instead.
  const runAsyncParse = async (id: string): Promise<Record<string, unknown> | null> => {
    const launch = await fetch(`${API}/expenses/${id}/parse-receipt-async`, {
      method: "POST",
      credentials: "include",
    });
    if (!launch.ok) {
      const j = await launch.json().catch(() => ({}));
      throw new Error(j.message || j.error || `HTTP ${launch.status}`);
    }
    const started = Date.now();
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const elapsed = Date.now() - started;
      setAutoBusyText(
        elapsed > 24000
          ? "Categorizing…"
          : elapsed > 10000
            ? "Identifying merchant…"
            : "Reading receipt…",
      );
      const sr = await fetch(`${API}/expenses/${id}/parse-receipt-status`, {
        credentials: "include",
      });
      if (!sr.ok) {
        const j = await sr.json().catch(() => ({}));
        throw new Error(j.message || j.error || `HTTP ${sr.status}`);
      }
      const s = await sr.json().catch(() => ({}));
      if (s.status === "done") return (s.result?.expense as Record<string, unknown>) ?? null;
      if (s.status === "failed" || s.status === "none") {
        throw new Error(parseFailureText(s.error?.body));
      }
      if (elapsed > 180000) throw new Error("Parsing timed out — try again.");
    }
  };

  const parseFailureText = (body?: { error?: string; message?: string }): string => {
    if (body?.error === "receipt-too-large")
      return "The receipt file is too large (max 8MB photo / 15MB PDF).";
    if (body?.error === "receipt-unreadable")
      return "This receipt couldn't be read — try a clearer file or fill the form manually.";
    if (body?.error === "auditor-refused")
      return "The AI auditor declined this receipt — fill the details manually.";
    return body?.message || "Couldn't read the receipt — fill the details manually.";
  };

  // Task #411 — the automatic pipeline: file selected → upload → draft
  // create/reuse → parse → prefill the form for review. The form stays
  // usable for manual entry on any failure.
  const autoProcess = async (file: File) => {
    setReceiptFile(file);
    setAutoNote(null);
    setError(null);
    setAutoBusyText("Uploading receipt…");
    let id = editingId;
    try {
      const receiptPath = await uploadReceipt(file);
      if (id) {
        // Re-attach: swap the receipt on the existing draft — no duplicate.
        const r = await fetch(`${API}/expenses/${id}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiptPath }),
        });
        if (!r.ok) {
          const j = await r.json().catch(() => ({}));
          throw new Error(j.reason || j.error || `HTTP ${r.status}`);
        }
      } else {
        setAutoBusyText("Creating draft…");
        const amt = Number(form.amount);
        const r = await fetch(`${API}/expenses`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            merchant: form.merchant.trim() || "Receipt",
            amount: Number.isFinite(amt) && amt > 0 ? amt : 0.01,
            currency: form.currency || "USD",
            expenseDate: form.expenseDate,
            contextType: form.contextType,
            receiptPath: receiptPath ?? undefined,
          }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.reason || j.error || `HTTP ${r.status}`);
        id = j.expense.id as string;
        setEditingId(id);
      }
      setAutoBusyText("Reading receipt…");
      const parsed = await runAsyncParse(id);
      if (parsed) {
        setForm((f) => ({
          ...f,
          merchant: (parsed.merchant as string) ?? f.merchant,
          amount: parsed.amount != null ? String(parsed.amount) : f.amount,
          currency: (parsed.currency as string) ?? f.currency,
          expenseDate: (parsed.expenseDate as string) ?? f.expenseDate,
          category: (parsed.category as string) ?? f.category,
          categoryCode: (parsed.categoryCode as string) ?? f.categoryCode,
          subCategoryCode: (parsed.subCategoryCode as string) ?? f.subCategoryCode,
          description: (parsed.description as string) ?? f.description,
        }));
      }
      setAutoNote({
        ok: true,
        text: "Auto-filled from your receipt — review, correct, then save and submit.",
      });
      await load();
    } catch (e) {
      setAutoNote({ ok: false, text: (e as Error).message });
    } finally {
      setAutoBusyText(null);
    }
  };

  const create = async () => {
    if (!form.merchant.trim() || !form.amount) {
      setError("Merchant and amount are required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Task #411 — when the auto pipeline already created a draft, save the
      // corrections onto it instead of creating a duplicate record.
      const receiptPath = editingId ? null : await uploadReceipt();
      const r = await fetch(editingId ? `${API}/expenses/${editingId}` : `${API}/expenses`, {
        method: editingId ? "PATCH" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          merchant: form.merchant,
          description: form.description || undefined,
          category: form.category,
          categoryCode: form.categoryCode || undefined,
          subCategoryCode: form.subCategoryCode || undefined,
          fundingSource: form.fundingSource || undefined,
          fundingBankAccountId:
            form.fundingSource === "company_account" && form.fundingBankAccountId
              ? form.fundingBankAccountId
              : undefined,
          bdIndustry: form.contextType === "bd" && form.bdIndustry ? form.bdIndustry : undefined,
          entityId: form.contextType === "internal" && form.entityId ? form.entityId : undefined,
          costCenter:
            form.contextType === "internal" && form.costCenter ? form.costCenter : undefined,
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
      setEditingId(null);
      setAutoNote(null);
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
      if (r.status === 409 && j.error === "attribution-incomplete") {
        throw new Error(
          j.message || "Internal expenses need a legal entity and a cost center before submitting.",
        );
      }
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

  // Task #396 — parse the attached receipt (photo or PDF). Fail-loud: the
  // server 4xxs on unreadable/unsupported files and we show the message.
  const [parsingId, setParsingId] = React.useState<string | null>(null);
  const [parseNote, setParseNote] = React.useState<{ id: string; text: string; ok: boolean } | null>(
    null,
  );
  const parseReceipt = async (id: string) => {
    setParsingId(id);
    setParseNote(null);
    try {
      // Task #411 — retry fallback now uses the async launch + poll pattern
      // so a slow parse can't be 502'd by the proxy.
      const parsed = await runAsyncParse(id);
      setParseNote({
        id,
        ok: true,
        text: `Parsed — ${
          parsed?.category ? `category "${parsed.category as string}"` : "fields updated"
        }. Review and edit before submitting.`,
      });
      await load();
    } catch (e) {
      setParseNote({ id, ok: false, text: (e as Error).message });
    } finally {
      setParsingId(null);
      setAutoBusyText(null);
    }
  };

  return (
    <div className="space-y-4" data-testid="me-expenses">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-text">Expense claims</h3>
        <PillButton
          onClick={() => {
            setShowForm((v) => {
              if (v) {
                // Closing the form ends the current auto-pipeline session.
                setEditingId(null);
                setAutoNote(null);
                setReceiptFile(null);
                setForm({ ...emptyForm });
              }
              return !v;
            });
          }}
          className="min-h-[44px]"
        >
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
            {taxonomy ? (
              <>
                <label className="text-xs text-text-mute space-y-1">
                  <span className="font-mono uppercase tracking-wider text-[10px]">Category</span>
                  <select
                    className={inputCls}
                    value={form.categoryCode}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, categoryCode: e.target.value, subCategoryCode: "" }))
                    }
                    data-testid="exp-category-code"
                  >
                    <option value="">Choose a category…</option>
                    {taxonomy.categories.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-text-mute space-y-1">
                  <span className="font-mono uppercase tracking-wider text-[10px]">
                    Sub-category
                  </span>
                  <select
                    className={inputCls}
                    value={form.subCategoryCode}
                    onChange={(e) => setForm((f) => ({ ...f, subCategoryCode: e.target.value }))}
                    disabled={!selectedCat}
                    data-testid="exp-subcategory-code"
                  >
                    <option value="">
                      {selectedCat ? "Choose a sub-category…" : "Pick a category first"}
                    </option>
                    {(selectedCat?.subCategories ?? []).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="text-xs text-text-mute space-y-1 sm:col-span-2">
                  <div className="flex items-center gap-2">
                    <PillButton
                      variant="ghost"
                      onClick={suggest}
                      disabled={suggestBusy || (!form.merchant.trim() && !form.description.trim())}
                      className="min-h-[36px]"
                      data-testid="exp-suggest"
                    >
                      {suggestBusy ? "Suggesting…" : "Suggest category"}
                    </PillButton>
                    {suggestion && (
                      <span className="text-[10px] font-mono text-text-faint">
                        via {suggestion.source === "merchant_memory" ? "merchant memory" : "AI"} ·{" "}
                        {suggestion.confidence}
                      </span>
                    )}
                  </div>
                  {suggestError && <p className="text-xs text-amber-300">{suggestError}</p>}
                </div>
              </>
            ) : (
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
            )}
            <label className="text-xs text-text-mute space-y-1">
              <span className="font-mono uppercase tracking-wider text-[10px]">Funding source</span>
              <select
                className={inputCls}
                value={form.fundingSource}
                onChange={(e) => setForm((f) => ({ ...f, fundingSource: e.target.value }))}
                data-testid="exp-funding-source"
              >
                {(taxonomy?.fundingSources ?? Object.keys(FUNDING_LABELS)).map((fs) => (
                  <option key={fs} value={fs}>
                    {FUNDING_LABELS[fs] ?? fs}
                  </option>
                ))}
              </select>
              {form.fundingSource === "company_account" && (
                <span className="block text-[10px] text-text-faint">
                  Paid from a company account — no reimbursement will be created.
                </span>
              )}
            </label>
            {form.fundingSource === "company_account" && (
              <label className="text-xs text-text-mute space-y-1">
                <span className="font-mono uppercase tracking-wider text-[10px]">
                  Paying bank account
                </span>
                <select
                  className={inputCls}
                  value={form.fundingBankAccountId}
                  onChange={(e) => setForm((f) => ({ ...f, fundingBankAccountId: e.target.value }))}
                  data-testid="exp-funding-bank-account"
                >
                  <option value="">Select account…</option>
                  {(taxonomy?.bankAccounts ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
                {(taxonomy?.bankAccounts ?? []).length === 0 && (
                  <span className="block text-[10px] text-text-faint">
                    No active company bank accounts are registered yet.
                  </span>
                )}
              </label>
            )}
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
            {form.contextType === "bd" && (
              <label className="text-xs text-text-mute space-y-1 sm:col-span-2">
                <span className="font-mono uppercase tracking-wider text-[10px]">
                  Target industry (BD attribution)
                </span>
                <input
                  type="text"
                  className={inputCls}
                  placeholder="e.g. Banking, Energy, Public sector"
                  value={form.bdIndustry}
                  onChange={(e) => setForm((f) => ({ ...f, bdIndustry: e.target.value }))}
                  data-testid="exp-bd-industry"
                />
              </label>
            )}
            {form.contextType === "internal" && (
              <>
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
                <label className="text-xs text-text-mute space-y-1">
                  <span className="font-mono uppercase tracking-wider text-[10px]">
                    Legal entity *
                  </span>
                  <select
                    className={inputCls}
                    value={form.entityId}
                    onChange={(e) => setForm((f) => ({ ...f, entityId: e.target.value }))}
                    data-testid="exp-entity"
                  >
                    <option value="">Choose an entity…</option>
                    {(taxonomy?.entities ?? []).map((en) => (
                      <option key={en.id} value={en.id}>
                        {en.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-text-mute space-y-1">
                  <span className="font-mono uppercase tracking-wider text-[10px]">
                    Cost center *
                  </span>
                  <select
                    className={inputCls}
                    value={form.costCenter}
                    onChange={(e) => setForm((f) => ({ ...f, costCenter: e.target.value }))}
                    data-testid="exp-cost-center"
                  >
                    <option value="">Choose a cost center…</option>
                    {(taxonomy?.costCenters ?? []).map((cc) => (
                      <option key={cc} value={cc}>
                        {cc}
                      </option>
                    ))}
                  </select>
                </label>
              </>
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
              accept="image/*,.heic,.heif,application/pdf"
              capture="environment"
              className="block w-full text-sm text-text-mute file:mr-3 file:rounded-md file:border file:border-border file:bg-bg file:px-3 file:py-2 file:text-sm file:text-text min-h-[44px]"
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                if (f) void autoProcess(f);
                else setReceiptFile(null);
              }}
              disabled={autoBusyText !== null}
              data-testid="exp-receipt"
            />
            {receiptFile && <span className="text-xs text-text-faint">{receiptFile.name}</span>}
            {autoBusyText && (
              <span
                className="flex items-center gap-2 text-xs text-gold"
                data-testid="exp-auto-progress"
              >
                <span className="inline-block h-3 w-3 animate-spin rounded-full border border-gold border-t-transparent" />
                {autoBusyText}
              </span>
            )}
            {autoNote && (
              <span
                className={`block text-xs ${autoNote.ok ? "text-emerald-300" : "text-amber-300"}`}
                data-testid="exp-auto-note"
              >
                {autoNote.text}
              </span>
            )}
          </label>
          <PillButton
            onClick={create}
            disabled={busy || autoBusyText !== null}
            className="min-h-[44px]"
            data-testid="exp-save"
          >
            {busy ? "Saving…" : editingId ? "Save changes" : "Save draft"}
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
                {c.merchantNormalized && c.merchantNormalized !== c.merchant && (
                  <p className="text-xs text-text-faint" data-testid={`exp-merchant-normalized-${c.id}`}>
                    Recognized as <span className="text-text-mute">{c.merchantNormalized}</span>
                    {c.merchantResolution ? ` · via ${c.merchantResolution.replace(/_/g, " ")}` : ""}
                  </p>
                )}
                {c.hasReceipt && <ReceiptThumb src={`${API}/expenses/${c.id}/receipt`} id={c.id} />}
                {parseNote?.id === c.id && (
                  <p
                    className={`text-xs ${parseNote.ok ? "text-emerald-300" : "text-red-300"}`}
                    data-testid={`exp-parse-note-${c.id}`}
                  >
                    {parseNote.text}
                  </p>
                )}
                {c.rejectedReason && (
                  <p className="text-xs text-red-300">Rejected: {c.rejectedReason}</p>
                )}
                {(c.status === "draft" || c.status === "rejected") && (
                  <div className="flex gap-3 pt-1">
                    {c.hasReceipt && (
                      <button
                        className="font-mono text-[10px] uppercase tracking-wider text-gold hover:underline min-h-[44px]"
                        onClick={() => parseReceipt(c.id)}
                        disabled={busy || parsingId !== null}
                        data-testid={`exp-parse-${c.id}`}
                      >
                        {parsingId === c.id ? "Parsing…" : "Parse receipt"}
                      </button>
                    )}
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
