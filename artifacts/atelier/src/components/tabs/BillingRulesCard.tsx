/**
 * BillingRulesCard — engagement billing-rule setup (Task #429).
 *
 * Lives in the engagement Financials tab. Finance / partners define how
 * this engagement bills (milestone completion, monthly T&M, fixed-fee
 * installments, retainer); the Billing Orchestrator turns active rules
 * into invoice drafts on the billing worklist.
 *
 * Raw fetch — bespoke /billing routes are not in the OpenAPI spec.
 */
import * as React from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, MonoChip, PillButton } from "@/components/ui/primitives";
import { fieldControlCls } from "@/components/ui/fieldControls";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Plus, Trash2 } from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

interface Installment {
  key: string;
  dueDate: string;
  amount: number;
  label: string;
  /** Re-invoiced to the client at cost (no margin). */
  passThrough?: boolean;
}
interface ContingentComponent {
  key: string;
  dueDate: string;
  expectedAmount: number;
  label: string;
}
interface BillingRule {
  id: string;
  ruleType: "milestone" | "periodic_tnm" | "fixed_fee" | "retainer";
  status: "active" | "paused";
  currency: string;
  paymentTermsDays: number;
  jurisdiction: string;
  billTo: { name?: string; vatId?: string; contactEmail?: string };
  config: {
    cadence?: "monthly";
    amount?: number;
    defaultRateUsd?: number;
    anchorDate?: string;
    endDate?: string;
    installments?: Installment[];
    contingentComponents?: ContingentComponent[];
  };
  notes: string;
  createdAt: string;
}

const RULE_LABEL: Record<BillingRule["ruleType"], string> = {
  milestone: "Milestone billing",
  periodic_tnm: "Monthly T&M",
  fixed_fee: "Fixed-fee installments",
  retainer: "Monthly retainer",
};
const RULE_BLURB: Record<BillingRule["ruleType"], string> = {
  milestone: "Drafts an invoice when a revenue milestone becomes invoiceable.",
  periodic_tnm: "Drafts a time-and-materials invoice from approved timesheets at each month end.",
  fixed_fee: "Drafts an invoice on each scheduled installment date.",
  retainer: "Drafts a fixed monthly invoice on the anchor day.",
};

async function jfetch(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "content-type": "application/json" },
    ...init,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const b = body as { message?: string; error?: string } | null;
    throw new Error(b?.message || b?.error || `HTTP ${res.status}`);
  }
  return body;
}

export function BillingRulesCard({ engId }: { engId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = ["billing-rules", engId];
  const rulesQ = useQuery<{ items: BillingRule[] }>({
    queryKey: key,
    queryFn: () => jfetch(`/billing/rules?engagementId=${encodeURIComponent(engId)}`) as Promise<{ items: BillingRule[] }>,
  });
  const [showForm, setShowForm] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // ---- new-rule form state
  const [ruleType, setRuleType] = React.useState<BillingRule["ruleType"]>("milestone");
  const [currency, setCurrency] = React.useState("USD");
  const [terms, setTerms] = React.useState(30);
  const [jurisdiction, setJurisdiction] = React.useState("GLOBAL");
  const [billToName, setBillToName] = React.useState("");
  const [billToEmail, setBillToEmail] = React.useState("");
  const [billToVat, setBillToVat] = React.useState("");
  const [amount, setAmount] = React.useState("");
  const [rate, setRate] = React.useState("");
  const [anchorDate, setAnchorDate] = React.useState("");
  const [endDate, setEndDate] = React.useState("");
  const [installments, setInstallments] = React.useState<Installment[]>([]);
  const [notes, setNotes] = React.useState("");

  const forbidden = rulesQ.isError && /403|forbidden/i.test(String((rulesQ.error as Error)?.message ?? ""));
  if (forbidden) return null;

  async function createRule() {
    const config: BillingRule["config"] = {};
    if (ruleType === "retainer") {
      const amt = Number(amount);
      if (!(amt > 0)) {
        toast({ title: "Retainer amount required", variant: "destructive" });
        return;
      }
      config.amount = amt;
      config.cadence = "monthly";
      if (anchorDate) config.anchorDate = anchorDate;
      if (endDate) config.endDate = endDate;
    }
    if (ruleType === "periodic_tnm") {
      if (rate) config.defaultRateUsd = Number(rate);
      if (anchorDate) config.anchorDate = anchorDate;
      if (endDate) config.endDate = endDate;
    }
    if (ruleType === "fixed_fee") {
      const clean = installments.filter((i) => i.dueDate && i.amount > 0);
      if (clean.length === 0) {
        toast({ title: "Add at least one installment", variant: "destructive" });
        return;
      }
      config.installments = clean.map((i, idx) => ({ ...i, key: i.key || `inst-${idx + 1}`, label: i.label || `Installment ${idx + 1}` }));
    }
    setBusy(true);
    try {
      await jfetch("/billing/rules", {
        method: "POST",
        body: JSON.stringify({
          engagementId: engId,
          ruleType,
          currency,
          paymentTermsDays: terms,
          jurisdiction,
          billTo: {
            ...(billToName ? { name: billToName } : {}),
            ...(billToEmail ? { contactEmail: billToEmail } : {}),
            ...(billToVat ? { vatId: billToVat } : {}),
          },
          config,
          notes,
        }),
      });
      toast({ title: "Billing rule created", description: `${RULE_LABEL[ruleType]} is now active.` });
      setShowForm(false);
      setAmount(""); setRate(""); setAnchorDate(""); setEndDate(""); setInstallments([]); setNotes("");
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Could not create rule", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function toggleRule(rule: BillingRule) {
    setBusy(true);
    try {
      await jfetch(`/billing/rules/${rule.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: rule.status === "active" ? "paused" : "active" }),
      });
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast({ title: "Update failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const rules = rulesQ.data?.items ?? [];

  return (
    <Card className="p-5" data-testid="billing-rules">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text-mute uppercase tracking-wider">
          Billing rules · automated invoicing
        </h3>
        <div className="flex items-center gap-3">
          <Link href="/finance/billing/worklist" className="text-xs text-gold underline">
            Open billing worklist →
          </Link>
          <PillButton onClick={() => setShowForm((v) => !v)} disabled={busy}>
            <Plus className="mr-1 inline h-3.5 w-3.5" /> {showForm ? "Cancel" : "Add rule"}
          </PillButton>
        </div>
      </div>

      {rulesQ.isLoading && <p className="text-xs text-text-mute">Loading…</p>}
      {rulesQ.isError && <p className="text-xs text-red-400">Could not load billing rules.</p>}
      {!rulesQ.isLoading && rules.length === 0 && !showForm && (
        <p className="text-xs text-text-mute">
          No billing rules yet. Add one so the Billing Orchestrator can draft invoices for this engagement automatically.
        </p>
      )}

      <div className="space-y-2">
        {rules.map((r) => {
          const passThroughInsts = (r.config.installments ?? []).filter((i) => i.passThrough);
          const contingent = r.config.contingentComponents ?? [];
          return (
          <div key={r.id} className="rounded border border-white/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <MonoChip tone={r.status === "active" ? "green" : "amber"}>{r.status}</MonoChip>
                  <span className="text-sm font-medium">{RULE_LABEL[r.ruleType]}</span>
                  <span className="text-xs text-text-mute font-mono">{r.currency} · net {r.paymentTermsDays}d · {r.jurisdiction}</span>
                </div>
                <p className="mt-1 text-xs text-text-mute">
                  {RULE_BLURB[r.ruleType]}
                  {r.ruleType === "retainer" && r.config.amount ? ` ${r.currency} ${r.config.amount.toLocaleString()}/month.` : ""}
                  {r.ruleType === "fixed_fee" && r.config.installments ? ` ${r.config.installments.length} installments.` : ""}
                  {r.ruleType === "periodic_tnm" && r.config.defaultRateUsd ? ` Fallback rate $${r.config.defaultRateUsd}/day.` : ""}
                  {r.billTo?.name ? ` Bill to ${r.billTo.name}.` : ""}
                </p>
              </div>
              <PillButton variant="ghost" disabled={busy} onClick={() => void toggleRule(r)}>
                {r.status === "active" ? "Pause" : "Resume"}
              </PillButton>
            </div>

            {passThroughInsts.length > 0 && (
              <div className="mt-2 rounded border border-sky-400/20 bg-sky-400/5 p-2" data-testid={`passthrough-${r.id}`}>
                <p className="text-xs font-medium text-sky-300">
                  Pass-through costs — re-invoiced at cost (no margin)
                </p>
                <ul className="mt-1 space-y-0.5">
                  {passThroughInsts.map((i) => (
                    <li key={i.key} className="flex flex-wrap items-baseline gap-2 text-xs text-text-mute">
                      <span>{i.label || i.key}</span>
                      <span className="font-mono">{i.dueDate}</span>
                      <span className="font-mono">{r.currency} {i.amount.toLocaleString()}</span>
                      <MonoChip>at cost</MonoChip>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {contingent.length > 0 && (
              <div className="mt-2 rounded border border-amber-400/30 bg-amber-400/5 p-2" data-testid={`contingent-${r.id}`}>
                <p className="flex items-center gap-1.5 text-xs font-medium text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Contingent components — verify before invoicing
                </p>
                <p className="mt-0.5 text-[11px] text-text-mute">
                  These outcome/SLA/volume tranches are never invoiced automatically. Finance must verify the
                  outcome and raise the invoice manually on verified actuals, not expected value.
                </p>
                <ul className="mt-1 space-y-0.5">
                  {contingent.map((c) => (
                    <li key={c.key} className="flex flex-wrap items-baseline gap-2 text-xs text-text-mute">
                      <span>{c.label || c.key}</span>
                      <span className="font-mono">due {c.dueDate}</span>
                      <span className="font-mono">expected {r.currency} {c.expectedAmount.toLocaleString()}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          );
        })}
      </div>

      {showForm && (
        <div className="mt-4 space-y-3 rounded border border-white/10 p-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <label className="text-xs">
              <span className="text-text-mute">Rule type</span>
              <select className={fieldControlCls} value={ruleType} onChange={(e) => setRuleType(e.target.value as BillingRule["ruleType"])}>
                <option value="milestone">Milestone</option>
                <option value="periodic_tnm">Monthly T&M</option>
                <option value="fixed_fee">Fixed-fee installments</option>
                <option value="retainer">Retainer</option>
              </select>
            </label>
            <label className="text-xs">
              <span className="text-text-mute">Currency</span>
              <select className={fieldControlCls} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {["USD", "AED", "SAR", "EUR", "GBP"].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="text-xs">
              <span className="text-text-mute">Payment terms (days)</span>
              <input className={fieldControlCls} type="number" min={0} max={180} value={terms} onChange={(e) => setTerms(Number(e.target.value))} />
            </label>
            <label className="text-xs">
              <span className="text-text-mute">Tax jurisdiction</span>
              <select className={fieldControlCls} value={jurisdiction} onChange={(e) => setJurisdiction(e.target.value)}>
                <option value="GLOBAL">Global (0%)</option>
                <option value="AE">UAE (5% VAT)</option>
                <option value="SA">KSA (15% VAT)</option>
                <option value="EU">EU (20% VAT)</option>
              </select>
            </label>
          </div>
          <p className="text-xs text-text-mute">{RULE_BLURB[ruleType]}</p>

          {ruleType === "retainer" && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-xs">
                <span className="text-text-mute">Monthly amount *</span>
                <input className={fieldControlCls} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="text-xs">
                <span className="text-text-mute">Start (anchor) date</span>
                <input className={fieldControlCls} type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
              </label>
              <label className="text-xs">
                <span className="text-text-mute">End date</span>
                <input className={fieldControlCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
          )}

          {ruleType === "periodic_tnm" && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <label className="text-xs">
                <span className="text-text-mute">Fallback day rate (USD)</span>
                <input className={fieldControlCls} type="number" min={0} value={rate} onChange={(e) => setRate(e.target.value)} placeholder="250" />
              </label>
              <label className="text-xs">
                <span className="text-text-mute">Start (anchor) date</span>
                <input className={fieldControlCls} type="date" value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} />
              </label>
              <label className="text-xs">
                <span className="text-text-mute">End date</span>
                <input className={fieldControlCls} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>
          )}

          {ruleType === "fixed_fee" && (
            <div className="space-y-2">
              {installments.map((inst, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <label className="text-xs">
                    <span className="text-text-mute">Due date</span>
                    <input className={fieldControlCls} type="date" value={inst.dueDate}
                      onChange={(e) => setInstallments((xs) => xs.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)))} />
                  </label>
                  <label className="text-xs">
                    <span className="text-text-mute">Amount</span>
                    <input className={fieldControlCls} type="number" min={0} value={inst.amount || ""}
                      onChange={(e) => setInstallments((xs) => xs.map((x, j) => (j === i ? { ...x, amount: Number(e.target.value) } : x)))} />
                  </label>
                  <label className="flex-1 text-xs">
                    <span className="text-text-mute">Label</span>
                    <input className={fieldControlCls} value={inst.label}
                      onChange={(e) => setInstallments((xs) => xs.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                  </label>
                  <button type="button" className="pb-2 text-text-mute hover:text-red-400"
                    onClick={() => setInstallments((xs) => xs.filter((_, j) => j !== i))} aria-label="Remove installment">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <PillButton variant="ghost" onClick={() => setInstallments((xs) => [...xs, { key: "", dueDate: "", amount: 0, label: "" }])}>
                <Plus className="mr-1 inline h-3.5 w-3.5" /> Add installment
              </PillButton>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <label className="text-xs">
              <span className="text-text-mute">Bill-to name</span>
              <input className={fieldControlCls} value={billToName} onChange={(e) => setBillToName(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-text-mute">Billing contact email</span>
              <input className={fieldControlCls} value={billToEmail} onChange={(e) => setBillToEmail(e.target.value)} />
            </label>
            <label className="text-xs">
              <span className="text-text-mute">VAT / tax ID{jurisdiction === "SA" ? " (required to issue in KSA)" : ""}</span>
              <input className={fieldControlCls} value={billToVat} onChange={(e) => setBillToVat(e.target.value)} />
            </label>
          </div>
          <label className="block text-xs">
            <span className="text-text-mute">Notes</span>
            <input className={fieldControlCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <PillButton disabled={busy} onClick={() => void createRule()}>
            {busy ? "Saving…" : "Create rule"}
          </PillButton>
        </div>
      )}
    </Card>
  );
}
