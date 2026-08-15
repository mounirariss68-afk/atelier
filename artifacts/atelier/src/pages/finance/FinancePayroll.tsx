/**
 * FinancePayroll — statutory payroll runs, EOSB liability and leaver
 * settlements per legal entity (Task #655).
 *
 * Task #1146 — added salary-advance management panel (issue, list,
 * pause/resume/payoff) and a comp-change dialog accessible from the run
 * lines table (effectiveFrom + reason + history).
 *
 * Raw fetch (finance-page convention, see FinanceClose.tsx) — the payroll
 * routes are bespoke and not in the OpenAPI spec. Country statutory rules
 * (GPSSA / GOSI / GRSIA / SGK, WPS, EOSB bands) live server-side as an
 * effective-dated rules-as-code registry; this page only displays and
 * drives runs.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHero, SectionHead, Card, MonoChip, PillButton, Eyebrow, BackLink } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  PlayCircle, BookOpenCheck, RefreshCw, AlertTriangle, CheckCircle2,
  Undo2, Plus, X, ChevronDown, ChevronUp, Pause, Play, DollarSign,
  History,
} from "lucide-react";

const API_BASE = `${import.meta.env?.BASE_URL ?? "/"}api/atelier`;

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

// ─── Data shapes ─────────────────────────────────────────────────────────────

interface RunTotals {
  headcount: number;
  grossSalaries: number;
  employerContributions: number;
  employeeWithholdings: number;
  eosbAccrual: number;
  netPay: number;
}
interface RunRow {
  id: string;
  legalEntityId: string;
  periodLabel: string;
  status: string;
  currency: string;
  countryCode: string;
  totals: RunTotals;
  validationErrors: Array<{ employeeId?: string; name?: string; message: string }> | null;
  postedAt: string | null;
}
interface LineRow {
  id: string;
  employeeId: string;
  personName: string;
  nationality: string | null;
  monthlyGross: number;
  monthlyBasic: number;
  serviceYears: number;
  employerTotal: number;
  employeeTotal: number;
  eosbAccrual: number;
  daysInMonth?: number;
  payableDays?: number;
  unpaidLeaveDays?: number;
  prorationBasis?: string | null;
  advanceDeduction?: number;
  netPay?: number;
  detail: { contributions?: Array<{ schemeKey: string; name: string; employerAmount: number; employeeAmount: number }> } | null;
}
interface EntityCard {
  id: string;
  shortName: string;
  country: string;
  baseCurrency: string;
  covered: boolean;
  regime: {
    effectiveFrom: string;
    eosb: { name: string } | null;
    contributions: Array<{ key: string; name: string; authority: string }>;
    filings: Array<{ key: string; name: string; authority: string; cadence: string }>;
  } | null;
}
interface Overview {
  entities: EntityCard[];
  runs: RunRow[];
}
interface EosbReportRow {
  employeeId: string;
  personName: string;
  nationality: string | null;
  serviceYears: number;
  wageMonthly: number;
  liabilityToDate: number;
  accruedInGl: number;
  eligible: boolean;
  note: string | null;
}
interface SettlementRow {
  id: string;
  employeeId: string;
  personName: string;
  leaveDate: string;
  reason: string;
  status: string;
  currency: string;
  serviceYears: number;
  entitlementGross: number;
  adjustmentFactor: number;
  finalAmount: number;
}
interface FilingItem {
  id: string;
  entityId: string;
  kind: string;
  authority: string;
  description: string;
  dueOn: string;
  status: "not_started" | "in_progress" | "filed" | "overdue";
  owner: string;
  filedOn?: string | null;
  filedByName?: string | null;
  sourceKey?: string | null;
}

// Task #1146
interface SalaryAdvance {
  id: string;
  employeeId: string;
  personName: string;
  currency: string;
  principal: number;
  installmentAmount: number;
  startPeriod: string;
  outstanding: number;
  status: "active" | "paused" | "repaid";
  issuedOn: string;
  note: string | null;
}
interface AdvanceRepayment {
  id: string;
  advanceId: string;
  amount: number;
  periodLabel: string;
  createdAt: string;
}
interface CompChange {
  id: string;
  employeeId: string;
  effectiveFrom: string;
  baseCompensation: number;
  baseCurrency: string;
  basicWageMonthly: number | null;
  housingAllowanceMonthly: number | null;
  reason: string;
  note: string | null;
}
interface RosterPerson {
  id: string;
  fullName: string;
  workerType: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmt2(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function currentPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}
function daysUntil(iso: string): number {
  return Math.round((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
function fmtRel(d: number): string {
  if (d < 0) return `${Math.abs(d)}d overdue`;
  if (d === 0) return "due today";
  return `due in ${d}d`;
}

// ─── Comp-change dialog ───────────────────────────────────────────────────────

interface CompDialogProps {
  personId: string;
  personName: string;
  onClose: () => void;
  onSaved: () => void;
}

function CompChangeDialog({ personId, personName, onClose, onSaved }: CompDialogProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    baseCompensation: "",
    baseCurrency: "",
    basicWageMonthly: "",
    housingAllowanceMonthly: "",
    effectiveFrom: new Date().toISOString().slice(0, 10),
    reason: "adjustment" as "promotion" | "raise" | "adjustment" | "correction",
    changeNote: "",
  });

  const historyQ = useQuery({
    queryKey: ["comp-changes", personId],
    queryFn: async () =>
      (await jfetch(`/finance/payroll/comp-changes?employeeId=${encodeURIComponent(personId)}`)) as {
        items: CompChange[];
      },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function save() {
    const patch: Record<string, unknown> = {};
    if (form.baseCompensation.trim()) {
      const v = parseFloat(form.baseCompensation);
      if (isNaN(v) || v <= 0) { toast({ title: "Invalid compensation amount", variant: "destructive" }); return; }
      patch.baseCompensation = v;
    }
    if (form.baseCurrency.trim()) patch.baseCurrency = form.baseCurrency.trim().toUpperCase();
    if (form.basicWageMonthly.trim()) {
      const v = parseFloat(form.basicWageMonthly);
      if (!isNaN(v) && v >= 0) patch.basicWageMonthly = v;
    }
    if (form.housingAllowanceMonthly.trim()) {
      const v = parseFloat(form.housingAllowanceMonthly);
      if (!isNaN(v) && v >= 0) patch.housingAllowanceMonthly = v;
    }
    if (Object.keys(patch).length === 0) {
      toast({ title: "Enter at least one comp field to update", variant: "destructive" });
      return;
    }
    patch.effectiveFrom = form.effectiveFrom;
    patch.reason = form.reason;
    if (form.changeNote.trim()) patch.changeNote = form.changeNote.trim();
    setBusy(true);
    try {
      await jfetch(`/roster/people/${personId}/payroll`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      toast({ title: `Comp change recorded for ${personName}` });
      onSaved();
      onClose();
    } catch (e) {
      toast({ title: "Comp change failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  const history = historyQ.data?.items ?? [];
  const reasonLabels: Record<string, string> = {
    promotion: "Promotion",
    raise: "Merit raise",
    adjustment: "Adjustment",
    correction: "Correction",
    initial: "Initial",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-bg border border-border rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Comp change</p>
            <h2 className="text-lg font-semibold mt-0.5">{personName}</h2>
          </div>
          <button onClick={onClose} className="text-text-mute hover:text-text p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-5">
          {/* ── New comp entry ── */}
          <section>
            <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-3">Record comp change</p>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Annual gross</span>
                <input
                  type="number" min="0" step="1"
                  placeholder="e.g. 120000"
                  value={form.baseCompensation}
                  onChange={set("baseCompensation")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="comp-dialog-base"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Currency</span>
                <input
                  type="text" maxLength={3} placeholder="USD"
                  value={form.baseCurrency}
                  onChange={set("baseCurrency")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text uppercase"
                  data-testid="comp-dialog-currency"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Basic wage / mo</span>
                <input
                  type="number" min="0" step="1"
                  placeholder="Optional"
                  value={form.basicWageMonthly}
                  onChange={set("basicWageMonthly")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="comp-dialog-basic"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Housing / mo</span>
                <input
                  type="number" min="0" step="1"
                  placeholder="Optional"
                  value={form.housingAllowanceMonthly}
                  onChange={set("housingAllowanceMonthly")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="comp-dialog-housing"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Effective from</span>
                <input
                  type="date"
                  value={form.effectiveFrom}
                  onChange={set("effectiveFrom")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="comp-dialog-effective"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Reason</span>
                <select
                  value={form.reason}
                  onChange={set("reason")}
                  className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="comp-dialog-reason"
                >
                  <option value="promotion">Promotion</option>
                  <option value="raise">Merit raise</option>
                  <option value="adjustment">Adjustment</option>
                  <option value="correction">Correction</option>
                </select>
              </label>
            </div>
            <label className="flex flex-col gap-1 mt-3">
              <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Note</span>
              <textarea
                rows={2}
                maxLength={500}
                placeholder="Optional — added to the audit trail"
                value={form.changeNote}
                onChange={set("changeNote")}
                className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text resize-none"
                data-testid="comp-dialog-note"
              />
            </label>
            <div className="mt-3 flex justify-end">
              <PillButton disabled={busy} onClick={save} data-testid="comp-dialog-save">
                {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BookOpenCheck className="w-4 h-4" />}
                Save comp change
              </PillButton>
            </div>
          </section>

          {/* ── History ── */}
          <section className="border-t border-border pt-4">
            <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-3 flex items-center gap-2">
              <History className="w-3.5 h-3.5" /> Comp-change history
            </p>
            {historyQ.isLoading && <p className="text-sm text-text-mute">Loading…</p>}
            {history.length === 0 && !historyQ.isLoading && (
              <p className="text-sm text-text-mute">No history yet — changes are recorded here after the first save.</p>
            )}
            {history.length > 0 && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                    <th className="py-2 pr-3">Effective</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 pr-3 text-right">Annual gross</th>
                    <th className="py-2 pr-3 text-right">Basic / mo</th>
                    <th className="py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className="border-b border-border/50">
                      <td className="py-2 pr-3 font-mono">{h.effectiveFrom}</td>
                      <td className="py-2 pr-3"><MonoChip>{reasonLabels[h.reason] ?? h.reason}</MonoChip></td>
                      <td className="py-2 pr-3 text-right font-mono">{fmt(h.baseCompensation)} {h.baseCurrency}</td>
                      <td className="py-2 pr-3 text-right font-mono">{h.basicWageMonthly != null ? fmt(h.basicWageMonthly) : "—"}</td>
                      <td className="py-2 text-xs text-text-mute">{h.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ─── Issue-advance dialog ─────────────────────────────────────────────────────

interface IssueAdvanceDialogProps {
  employees: RosterPerson[];
  onClose: () => void;
  onIssued: () => void;
}

function IssueAdvanceDialog({ employees, onClose, onIssued }: IssueAdvanceDialogProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    employeeId: employees[0]?.id ?? "",
    amount: "",
    installmentAmount: "",
    startPeriod: currentPeriod(),
    note: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    const amount = parseFloat(form.amount);
    const installment = parseFloat(form.installmentAmount);
    if (!form.employeeId) { toast({ title: "Select an employee", variant: "destructive" }); return; }
    if (isNaN(amount) || amount <= 0) { toast({ title: "Enter a valid advance amount", variant: "destructive" }); return; }
    if (isNaN(installment) || installment <= 0) { toast({ title: "Enter a valid monthly installment", variant: "destructive" }); return; }
    if (installment > amount) { toast({ title: "Installment cannot exceed the advance amount", variant: "destructive" }); return; }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.startPeriod)) { toast({ title: "Enter a valid start period (YYYY-MM)", variant: "destructive" }); return; }
    setBusy(true);
    try {
      await jfetch("/finance/payroll/advances", {
        method: "POST",
        body: JSON.stringify({
          employeeId: form.employeeId,
          amount,
          installmentAmount: installment,
          startPeriod: form.startPeriod,
          note: form.note.trim() || null,
        }),
      });
      const emp = employees.find((e) => e.id === form.employeeId);
      toast({ title: `Advance issued to ${emp?.fullName ?? "employee"}` });
      onIssued();
      onClose();
    } catch (e) {
      toast({ title: "Issue failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-bg border border-border rounded-lg w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-border">
          <div>
            <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Salary advance</p>
            <h2 className="text-lg font-semibold mt-0.5">Issue advance</h2>
          </div>
          <button onClick={onClose} className="text-text-mute hover:text-text p-1"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Employee</span>
            <select
              value={form.employeeId}
              onChange={set("employeeId")}
              className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
              data-testid="advance-dialog-employee"
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.fullName}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Advance amount</span>
              <input
                type="number" min="1" step="1"
                placeholder="e.g. 5000"
                value={form.amount}
                onChange={set("amount")}
                className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                data-testid="advance-dialog-amount"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Monthly installment</span>
              <input
                type="number" min="1" step="1"
                placeholder="e.g. 500"
                value={form.installmentAmount}
                onChange={set("installmentAmount")}
                className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                data-testid="advance-dialog-installment"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Repayment starts (YYYY-MM)</span>
            <input
              type="month"
              value={form.startPeriod}
              onChange={set("startPeriod")}
              className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
              data-testid="advance-dialog-start"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-mono uppercase tracking-widest text-text-mute">Note (optional)</span>
            <textarea
              rows={2} maxLength={500}
              placeholder="Reason or reference"
              value={form.note}
              onChange={set("note")}
              className="bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text resize-none"
              data-testid="advance-dialog-note"
            />
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose} className="px-4 py-2 text-sm font-mono uppercase tracking-widest text-text-mute hover:text-text">Cancel</button>
            <PillButton disabled={busy} onClick={submit} data-testid="advance-dialog-submit">
              {busy ? <RefreshCw className="w-4 h-4 animate-spin" /> : <DollarSign className="w-4 h-4" />}
              Issue advance
            </PillButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Advances section ─────────────────────────────────────────────────────────

interface AdvancesSectionProps {
  employees: RosterPerson[];
}

function AdvancesSection({ employees }: AdvancesSectionProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [expandedId, setExpandedId] = React.useState<string | null>(null);

  const advancesQ = useQuery({
    queryKey: ["payroll-advances"],
    queryFn: async () =>
      (await jfetch("/finance/payroll/advances")) as {
        items: SalaryAdvance[];
        repayments: AdvanceRepayment[];
      },
  });

  const advances = advancesQ.data?.items ?? [];
  const repayments = advancesQ.data?.repayments ?? [];

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: ok });
      await qc.invalidateQueries({ queryKey: ["payroll-advances"] });
      await qc.invalidateQueries({ queryKey: ["payroll-overview"] });
      await qc.invalidateQueries({ queryKey: ["payroll-run"] });
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const statusTone = (s: string) => s === "repaid" ? "green" : s === "paused" ? "amber" : "default";

  return (
    <section data-testid="advances-section">
      <SectionHead headline="Salary advances" />
      <Card className="p-6 mt-4">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm text-text-mute">
            Outstanding balances and repayment schedule. Installments deduct automatically each payroll run.
          </p>
          {employees.length > 0 && (
            <PillButton onClick={() => setIssueOpen(true)} data-testid="advance-issue-btn">
              <Plus className="w-4 h-4" /> Issue advance
            </PillButton>
          )}
        </div>

        {advancesQ.isLoading && <p className="text-sm text-text-mute">Loading…</p>}
        {advancesQ.isError && <p className="text-sm text-red-400">{(advancesQ.error as Error).message}</p>}

        {advances.length === 0 && !advancesQ.isLoading && (
          <p className="text-sm text-text-mute">No advances recorded yet.</p>
        )}

        {advances.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                  <th className="py-2 pr-4">Employee</th>
                  <th className="py-2 pr-4">Issued</th>
                  <th className="py-2 pr-4 text-right">Principal</th>
                  <th className="py-2 pr-4 text-right">Outstanding</th>
                  <th className="py-2 pr-4 text-right">Installment</th>
                  <th className="py-2 pr-4">Starts</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {advances.map((adv) => {
                  const advRep = repayments.filter((r) => r.advanceId === adv.id).sort((a, b) => b.periodLabel.localeCompare(a.periodLabel));
                  const expanded = expandedId === adv.id;
                  return (
                    <React.Fragment key={adv.id}>
                      <tr className="border-b border-border/50" data-testid={`advance-row-${adv.id}`}>
                        <td className="py-2 pr-4">{adv.personName}</td>
                        <td className="py-2 pr-4 font-mono">{adv.issuedOn}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt2(adv.principal)} {adv.currency}</td>
                        <td className="py-2 pr-4 text-right font-mono">
                          <span className={adv.outstanding > 0 && adv.status !== "repaid" ? "text-amber-400" : ""}>
                            {fmt2(adv.outstanding)} {adv.currency}
                          </span>
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt2(adv.installmentAmount)}</td>
                        <td className="py-2 pr-4 font-mono">{adv.startPeriod}</td>
                        <td className="py-2 pr-4">
                          <MonoChip tone={statusTone(adv.status)}>{adv.status}</MonoChip>
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            {advRep.length > 0 && (
                              <button
                                className="text-xs font-mono uppercase tracking-widest text-text-faint hover:text-text inline-flex items-center gap-1"
                                onClick={() => setExpandedId(expanded ? null : adv.id)}
                                data-testid={`advance-history-${adv.id}`}
                              >
                                {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                                {advRep.length} payment{advRep.length !== 1 ? "s" : ""}
                              </button>
                            )}
                            {adv.status === "active" && (
                              <PillButton
                                disabled={busy !== null}
                                onClick={() => act(`pause-${adv.id}`, () => jfetch(`/finance/payroll/advances/${adv.id}/pause`, { method: "POST" }), "Advance paused")}
                                data-testid={`advance-pause-${adv.id}`}
                              >
                                <Pause className="w-3.5 h-3.5" /> Pause
                              </PillButton>
                            )}
                            {adv.status === "paused" && (
                              <PillButton
                                disabled={busy !== null}
                                onClick={() => act(`resume-${adv.id}`, () => jfetch(`/finance/payroll/advances/${adv.id}/resume`, { method: "POST" }), "Advance resumed")}
                                data-testid={`advance-resume-${adv.id}`}
                              >
                                <Play className="w-3.5 h-3.5" /> Resume
                              </PillButton>
                            )}
                            {adv.status !== "repaid" && (
                              <PillButton
                                disabled={busy !== null}
                                onClick={() => act(`payoff-${adv.id}`, () => jfetch(`/finance/payroll/advances/${adv.id}/payoff`, { method: "POST" }), "Advance paid off")}
                                data-testid={`advance-payoff-${adv.id}`}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" /> Pay off
                              </PillButton>
                            )}
                          </div>
                        </td>
                      </tr>
                      {expanded && advRep.length > 0 && (
                        <tr className="border-b border-border/50 bg-bg-elevate/30">
                          <td colSpan={8} className="px-6 py-3">
                            <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-2">Repayment history</p>
                            <table className="text-xs w-full">
                              <thead>
                                <tr className="text-left text-text-faint border-b border-border/50">
                                  <th className="py-1 pr-4">Period</th>
                                  <th className="py-1 pr-4 text-right">Amount</th>
                                  <th className="py-1">Date</th>
                                </tr>
                              </thead>
                              <tbody>
                                {advRep.map((r) => (
                                  <tr key={r.id}>
                                    <td className="py-1 pr-4 font-mono">{r.periodLabel}</td>
                                    <td className="py-1 pr-4 text-right font-mono">{fmt2(r.amount)} {adv.currency}</td>
                                    <td className="py-1 font-mono text-text-faint">{r.createdAt?.slice(0, 10) ?? "—"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                      {adv.note && (
                        <tr className="border-b border-border/30">
                          <td colSpan={8} className="px-2 pb-2 text-xs text-text-faint">{adv.note}</td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {issueOpen && employees.length > 0 && (
        <IssueAdvanceDialog
          employees={employees}
          onClose={() => setIssueOpen(false)}
          onIssued={() => {
            void qc.invalidateQueries({ queryKey: ["payroll-advances"] });
          }}
        />
      )}
    </section>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FinancePayroll() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const overviewQ = useQuery({
    queryKey: ["payroll-overview"],
    queryFn: async () => (await jfetch("/finance/payroll/overview")) as Overview,
  });
  const entities = overviewQ.data?.entities ?? [];
  const [entityId, setEntityId] = React.useState<string>("");
  React.useEffect(() => {
    if (!entityId && entities.length > 0) setEntityId(entities.find((e) => e.covered)?.id ?? entities[0].id);
  }, [entities, entityId]);
  const entity = entities.find((e) => e.id === entityId) ?? null;
  const [period, setPeriod] = React.useState(currentPeriod());
  const [busy, setBusy] = React.useState<string | null>(null);

  const runs = (overviewQ.data?.runs ?? []).filter((r) => r.legalEntityId === entityId);
  const [openRunId, setOpenRunId] = React.useState<string | null>(null);
  const runQ = useQuery({
    queryKey: ["payroll-run", openRunId],
    enabled: !!openRunId,
    queryFn: async () => (await jfetch(`/finance/payroll/runs/${openRunId}`)) as { run: RunRow; lines: LineRow[] },
  });
  const coveredCount = entities.filter((e) => e.covered).length;
  const consolidatedQ = useQuery({
    queryKey: ["eosb-consolidated"],
    enabled: coveredCount > 1,
    queryFn: async () => (await jfetch("/finance/payroll/eosb/report")) as {
      consolidated: true;
      entities: Array<{ entityId: string; entityName: string; currency: string; headcount: number; totalLiability: number; totalAccruedInGl: number }>;
      groupTotals: Record<string, { totalLiability: number; totalAccruedInGl: number }>;
    },
  });
  const eosbQ = useQuery({
    queryKey: ["eosb-report", entityId],
    enabled: !!entityId && !!entity?.covered,
    queryFn: async () => (await jfetch(`/finance/payroll/eosb/report?entityId=${entityId}`)) as {
      rows: EosbReportRow[]; totalLiability: number; totalAccruedInGl: number; currency: string;
    },
  });
  const settlementsQ = useQuery({
    queryKey: ["eosb-settlements"],
    queryFn: async () => (await jfetch("/finance/payroll/eosb/settlements")) as { items: SettlementRow[] },
  });
  const filingsQ = useQuery({
    queryKey: ["statutory-filings"],
    enabled: !!overviewQ.data,
    queryFn: async () => (await jfetch("/finance/comply/statutory")) as { items: FilingItem[] },
  });

  // Task #1146 — roster employees for the advance issue form and comp dialog.
  const employeesQ = useQuery({
    queryKey: ["roster-employees-payroll"],
    queryFn: async () =>
      (await jfetch("/roster/people?workerType=employee&status=active")) as { people: RosterPerson[] },
  });
  const employees = employeesQ.data?.people ?? [];

  // Task #1146 — comp edit dialog state.
  const [compDialogPerson, setCompDialogPerson] = React.useState<{ id: string; name: string } | null>(null);

  const allFilings = filingsQ.data?.items ?? [];
  const overdueFilings = allFilings.filter((f) => f.status === "overdue");
  const entityFilings = allFilings
    .filter((f) => f.entityId === entityId)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
  const openEntityFilings = entityFilings.filter((f) => f.status !== "filed");
  const filedEntityFilings = entityFilings.filter((f) => f.status === "filed").slice(-6);

  async function act(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      toast({ title: ok });
      await qc.invalidateQueries({ queryKey: ["payroll-overview"] });
      await qc.invalidateQueries({ queryKey: ["payroll-run"] });
      await qc.invalidateQueries({ queryKey: ["eosb-report"] });
      await qc.invalidateQueries({ queryKey: ["eosb-settlements"] });
      await qc.invalidateQueries({ queryKey: ["statutory-filings"] });
      await qc.invalidateQueries({ queryKey: ["atelier-v5", "finance-statutory"] });
    } catch (e) {
      toast({ title: "Payroll", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="animate-in fade-in">
      <PageHero>
        <div className="container-atelier">
          <BackLink href="/finance/close">Finance · Close</BackLink>
        </div>
        <Eyebrow>Manage · Finance · Payroll</Eyebrow>
        <h1 className="headline mt-3">Statutory payroll</h1>
        <p className="lede mt-3 max-w-3xl">
          Country statutory layer per legal entity — end-of-service (EOSB) accrual bands,
          social-security contributions (GPSSA · GOSI · GRSIA · SGK) and wage-protection /
          filing calendars (WPS · MUHSGK), computed from an effective-dated rules registry
          and posted to the general ledger.
        </p>
        <div className="mt-6 flex flex-wrap gap-2" data-testid="payroll-entity-filters">
          {entities.map((e) => (
            <button
              key={e.id}
              onClick={() => { setEntityId(e.id); setOpenRunId(null); }}
              className={`px-3 py-1 rounded text-xs font-mono uppercase tracking-widest transition-colors ${
                entityId === e.id ? "bg-gold text-bg" : "bg-bg-elevate text-text-mute hover:text-text"
              }`}
              data-testid={`payroll-entity-${e.id}`}
            >{e.shortName} · {e.country}</button>
          ))}
        </div>
      </PageHero>

      <div className="container-atelier pb-24 space-y-10">
        {overviewQ.isLoading && <p className="text-text-mute text-sm">Loading…</p>}
        {overviewQ.isError && (
          <Card className="p-6"><p className="text-sm text-red-400">{(overviewQ.error as Error).message}</p></Card>
        )}

        {overdueFilings.length > 0 && (
          <Card className="p-4 border border-red-500/40 bg-red-500/5" data-testid="filings-overdue-banner">
            <p className="text-sm text-red-400 flex items-center gap-2 font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {overdueFilings.length} statutory filing{overdueFilings.length === 1 ? " is" : "s are"} overdue
              {" — "}missed WPS / social-security filings carry penalties.
            </p>
            <ul className="mt-2 space-y-1 text-xs text-text-mute">
              {overdueFilings.slice(0, 5).map((f) => {
                const ent = entities.find((e) => e.id === f.entityId);
                return (
                  <li key={f.id} className="font-mono">
                    {ent?.shortName ?? f.entityId} · {f.kind} · due {f.dueOn} ({fmtRel(daysUntil(f.dueOn))})
                  </li>
                );
              })}
              {overdueFilings.length > 5 && <li>…and {overdueFilings.length - 5} more</li>}
            </ul>
          </Card>
        )}

        {entity && (
          <section>
            <SectionHead headline={`Statutory regime — ${entity.country}`} />
            {!entity.covered ? (
              <Card className="p-6 mt-4">
                <p className="text-sm text-text-mute flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4" />
                  No statutory rules seeded for {entity.country}. Payroll runs are still available (salaries + GL posting) but no contributions or EOSB accrue.
                </p>
              </Card>
            ) : (
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <Card className="p-6">
                  <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Contribution schemes</p>
                  <ul className="mt-3 space-y-2">
                    {entity.regime?.contributions.map((c) => (
                      <li key={c.key} className="text-sm flex items-baseline justify-between gap-3">
                        <span>{c.name}</span>
                        <MonoChip>{c.authority}</MonoChip>
                      </li>
                    ))}
                    {entity.regime?.contributions.length === 0 && <li className="text-sm text-text-mute">None</li>}
                  </ul>
                </Card>
                <Card className="p-6">
                  <p className="text-xs font-mono uppercase tracking-widest text-text-mute">Statutory filings</p>
                  <ul className="mt-3 space-y-2">
                    {entity.regime?.filings.map((f) => (
                      <li key={f.key} className="text-sm flex items-baseline justify-between gap-3">
                        <span>{f.name}</span>
                        <MonoChip>{f.cadence}</MonoChip>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-mute mt-3">
                    Filing deadlines are auto-attached to the statutory filings register.
                  </p>
                </Card>
              </div>
            )}
          </section>
        )}

        {entity && (
          <section data-testid="filing-deadlines-section">
            <SectionHead headline={`Filing deadlines — ${entity.shortName}`} />
            <Card className="p-6 mt-4">
              {filingsQ.isLoading && <p className="text-sm text-text-mute">Loading…</p>}
              {filingsQ.isError && <p className="text-sm text-red-400">{(filingsQ.error as Error).message}</p>}
              {!filingsQ.isLoading && !filingsQ.isError && entityFilings.length === 0 && (
                <p className="text-sm text-text-mute">
                  No statutory filings attached to this entity yet. Deadlines are auto-attached
                  for covered countries when payroll data loads.
                </p>
              )}
              {openEntityFilings.length > 0 && (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                      <th className="py-2 pr-4">Filing</th>
                      <th className="py-2 pr-4">Authority</th>
                      <th className="py-2 pr-4">Due</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {openEntityFilings.map((f) => {
                      const d = daysUntil(f.dueOn);
                      const tone = f.status === "overdue" ? "red" : d <= 7 ? "amber" : "default";
                      return (
                        <tr key={f.id} className="border-b border-border/50" data-testid={`filing-row-${f.id}`}>
                          <td className="py-2 pr-4">
                            <div className="font-medium">{f.kind}</div>
                            <div className="text-xs text-text-mute">{f.description}</div>
                          </td>
                          <td className="py-2 pr-4"><MonoChip>{f.authority}</MonoChip></td>
                          <td className="py-2 pr-4">
                            <div className="font-mono">{f.dueOn}</div>
                            <div className={`font-mono text-[10px] ${f.status === "overdue" ? "text-red-400" : "text-text-faint"}`}>{fmtRel(d)}</div>
                          </td>
                          <td className="py-2 pr-4">
                            <MonoChip tone={tone}>{f.status.replace("_", " ")}</MonoChip>
                          </td>
                          <td className="py-2 text-right">
                            <PillButton
                              disabled={busy !== null}
                              onClick={() => act(`file-${f.id}`, () => jfetch(`/finance/comply/statutory/${f.id}/mark-filed`, {
                                method: "POST",
                                body: JSON.stringify({}),
                              }), "Filing marked as filed")}
                              data-testid={`filing-mark-filed-${f.id}`}
                            ><CheckCircle2 className="w-4 h-4" /> Mark filed</PillButton>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {filedEntityFilings.length > 0 && (
                <div className={openEntityFilings.length > 0 ? "mt-6 border-t border-border pt-4" : ""}>
                  <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-2">Recently filed</p>
                  <ul className="space-y-1.5">
                    {filedEntityFilings.map((f) => (
                      <li key={f.id} className="text-sm flex flex-wrap items-center justify-between gap-2" data-testid={`filing-filed-${f.id}`}>
                        <span className="text-text-mute">
                          {f.kind} · due {f.dueOn}
                          {f.filedOn ? ` · filed ${f.filedOn}` : ""}
                          {f.filedByName ? ` by ${f.filedByName}` : ""}
                        </span>
                        <span className="flex items-center gap-2">
                          <MonoChip tone="green">filed</MonoChip>
                          <button
                            className="text-xs font-mono uppercase tracking-widest text-text-faint hover:text-text inline-flex items-center gap-1"
                            disabled={busy !== null}
                            onClick={() => act(`reopen-${f.id}`, () => jfetch(`/finance/comply/statutory/${f.id}/mark-filed`, {
                              method: "POST",
                              body: JSON.stringify({ reopen: true }),
                            }), "Filing reopened")}
                            data-testid={`filing-reopen-${f.id}`}
                          ><Undo2 className="w-3 h-3" /> Reopen</button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </section>
        )}

        <section>
          <SectionHead headline="Payroll runs" />
          <Card className="p-6 mt-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-xs font-mono uppercase tracking-widest text-text-mute">
                Period
                <input
                  type="month"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="block mt-1 bg-bg-elevate border border-border rounded px-3 py-2 text-sm text-text"
                  data-testid="payroll-period-input"
                />
              </label>
              <PillButton
                disabled={!entityId || busy !== null}
                onClick={() => act("compute", () => jfetch("/finance/payroll/runs", {
                  method: "POST",
                  body: JSON.stringify({ entityId, periodLabel: period }),
                }), "Payroll run computed")}
                data-testid="payroll-compute-btn"
              >
                {busy === "compute" ? <RefreshCw className="w-4 h-4 animate-spin" /> : <PlayCircle className="w-4 h-4" />} Compute run
              </PillButton>
            </div>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                    <th className="py-2 pr-4">Period</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4 text-right">People</th>
                    <th className="py-2 pr-4 text-right">Gross</th>
                    <th className="py-2 pr-4 text-right">Employer contrib.</th>
                    <th className="py-2 pr-4 text-right">EOSB accrual</th>
                    <th className="py-2 pr-4 text-right">Net pay</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b border-border/50" data-testid={`payroll-run-${r.periodLabel}`}>
                      <td className="py-2 pr-4 font-mono">{r.periodLabel}</td>
                      <td className="py-2 pr-4">
                        <MonoChip tone={r.status === "posted" ? "green" : (r.validationErrors?.length ? "red" : "amber")}>
                          {r.status}{r.validationErrors?.length ? ` · ${r.validationErrors.length} issue(s)` : ""}
                        </MonoChip>
                      </td>
                      <td className="py-2 pr-4 text-right">{r.totals.headcount}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.grossSalaries)} {r.currency}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.employerContributions)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.eosbAccrual)}</td>
                      <td className="py-2 pr-4 text-right font-mono">{fmt(r.totals.netPay)}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button
                          className="text-xs font-mono uppercase tracking-widest text-text-mute hover:text-text mr-3"
                          onClick={() => setOpenRunId(openRunId === r.id ? null : r.id)}
                          data-testid={`payroll-run-open-${r.periodLabel}`}
                        >{openRunId === r.id ? "Hide" : "Lines"}</button>
                        {r.status === "draft" && (
                          <PillButton
                            disabled={busy !== null || !!r.validationErrors?.length}
                            onClick={() => act(`post-${r.id}`, () => jfetch(`/finance/payroll/runs/${r.id}/post`, { method: "POST" }), "Payroll posted to GL")}
                            data-testid={`payroll-post-${r.periodLabel}`}
                          ><BookOpenCheck className="w-4 h-4" /> Post</PillButton>
                        )}
                      </td>
                    </tr>
                  ))}
                  {runs.length === 0 && (
                    <tr><td colSpan={8} className="py-4 text-text-mute">No payroll runs yet for this entity.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {openRunId && runQ.data && (
              <div className="mt-6 border-t border-border pt-4">
                {(runQ.data.run.validationErrors?.length ?? 0) > 0 && (
                  <div className="mb-3 text-sm text-red-400">
                    {runQ.data.run.validationErrors!.map((v, i) => (
                      <p key={i}>• {v.name ? `${v.name}: ` : ""}{v.message}</p>
                    ))}
                  </div>
                )}
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                      <th className="py-2 pr-4">Person</th>
                      <th className="py-2 pr-4">Nationality</th>
                      <th className="py-2 pr-4 text-right">Service yrs</th>
                      <th className="py-2 pr-4 text-right">Days</th>
                      <th className="py-2 pr-4 text-right">Gross</th>
                      <th className="py-2 pr-4 text-right">Employer</th>
                      <th className="py-2 pr-4 text-right">Employee</th>
                      <th className="py-2 pr-4 text-right">Advance</th>
                      <th className="py-2 pr-4 text-right">Net</th>
                      <th className="py-2 pr-4 text-right">EOSB Δ</th>
                      <th className="py-2 pr-4">Schemes</th>
                      <th className="py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {runQ.data.lines.map((l) => (
                      <tr key={l.id} className="border-b border-border/50">
                        <td className="py-2 pr-4">{l.personName}</td>
                        <td className="py-2 pr-4">{l.nationality ?? "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono">{l.serviceYears.toFixed(1)}</td>
                        <td
                          className="py-2 pr-4 text-right font-mono"
                          title={l.prorationBasis ?? undefined}
                          data-testid={`payroll-line-days-${l.id}`}
                        >
                          {l.payableDays != null && l.daysInMonth != null ? `${l.payableDays}/${l.daysInMonth}` : "—"}
                          {(l.unpaidLeaveDays ?? 0) > 0 ? <span className="text-amber-400"> ({l.unpaidLeaveDays}u)</span> : null}
                        </td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.monthlyGross)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.employerTotal)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.employeeTotal)}</td>
                        <td className="py-2 pr-4 text-right font-mono">{(l.advanceDeduction ?? 0) > 0 ? fmt(l.advanceDeduction!) : "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono">{l.netPay != null ? fmt(l.netPay) : "—"}</td>
                        <td className="py-2 pr-4 text-right font-mono">{fmt(l.eosbAccrual)}</td>
                        <td className="py-2 pr-4 text-xs text-text-mute">
                          {(l.detail?.contributions ?? []).map((c) => c.schemeKey).join(", ") || "—"}
                        </td>
                        <td className="py-2 text-right">
                          {l.employeeId && (
                            <button
                              className="text-xs font-mono uppercase tracking-widest text-text-faint hover:text-gold transition-colors"
                              onClick={() => setCompDialogPerson({ id: l.employeeId, name: l.personName })}
                              data-testid={`payroll-edit-comp-${l.id}`}
                              title="Edit comp / view history"
                            >
                              Edit comp
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </section>

        {/* Task #1146 — Salary advances panel */}
        <AdvancesSection employees={employees} />

        {entity?.covered && (
          <section>
            <SectionHead headline="EOSB liability" />
            {consolidatedQ.data && consolidatedQ.data.entities.length > 1 && (
              <Card className="p-6 mt-4" data-testid="eosb-consolidated">
                <p className="text-xs font-mono uppercase tracking-widest text-text-mute mb-3">Group rollup — all covered entities</p>
                <div className="flex flex-wrap gap-2 mb-3 text-xs font-mono">
                  {Object.entries(consolidatedQ.data.groupTotals).map(([cur, t]) => (
                    <MonoChip key={cur}>{cur} liability {fmt(t.totalLiability)} · accrued {fmt(t.totalAccruedInGl)}</MonoChip>
                  ))}
                </div>
                <ul className="text-sm space-y-1">
                  {consolidatedQ.data.entities.map((e) => (
                    <li key={e.entityId} className="flex justify-between gap-4">
                      <span>{e.entityName} · {e.headcount} people</span>
                      <span className="font-mono">{fmt(e.totalLiability)} {e.currency}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <Card className="p-6 mt-4">
              {eosbQ.isLoading && <p className="text-sm text-text-mute">Loading…</p>}
              {eosbQ.data && (
                <>
                  <div className="flex flex-wrap gap-2 mb-4 text-xs font-mono">
                    <MonoChip>Liability to date {fmt(eosbQ.data.totalLiability)} {eosbQ.data.currency}</MonoChip>
                    <MonoChip tone={Math.abs(eosbQ.data.totalAccruedInGl - eosbQ.data.totalLiability) < 1 ? "green" : "amber"}>
                      Accrued in GL {fmt(eosbQ.data.totalAccruedInGl)} {eosbQ.data.currency}
                    </MonoChip>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                        <th className="py-2 pr-4">Person</th>
                        <th className="py-2 pr-4">Nationality</th>
                        <th className="py-2 pr-4 text-right">Service yrs</th>
                        <th className="py-2 pr-4 text-right">Wage / mo</th>
                        <th className="py-2 pr-4 text-right">Liability</th>
                        <th className="py-2 pr-4 text-right">Accrued</th>
                        <th className="py-2 pr-4">Note</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eosbQ.data.rows.map((r) => (
                        <tr key={r.employeeId} className="border-b border-border/50">
                          <td className="py-2 pr-4">{r.personName}</td>
                          <td className="py-2 pr-4">{r.nationality ?? "—"}</td>
                          <td className="py-2 pr-4 text-right font-mono">{r.serviceYears.toFixed(1)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.wageMonthly)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.liabilityToDate)}</td>
                          <td className="py-2 pr-4 text-right font-mono">{fmt(r.accruedInGl)}</td>
                          <td className="py-2 pr-4 text-xs text-text-mute">{r.note ?? "—"}</td>
                        </tr>
                      ))}
                      {eosbQ.data.rows.length === 0 && (
                        <tr><td colSpan={7} className="py-4 text-text-mute">No EOSB-eligible people linked to this entity.</td></tr>
                      )}
                    </tbody>
                  </table>
                </>
              )}
            </Card>
          </section>
        )}

        <section>
          <SectionHead headline="Leaver settlements" />
          <Card className="p-6 mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-mono uppercase tracking-widest text-text-mute border-b border-border">
                  <th className="py-2 pr-4">Person</th>
                  <th className="py-2 pr-4">Leave date</th>
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-right">Amount</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {(settlementsQ.data?.items ?? []).map((s) => (
                  <tr key={s.id} className="border-b border-border/50" data-testid={`eosb-settlement-${s.id}`}>
                    <td className="py-2 pr-4">{s.personName}</td>
                    <td className="py-2 pr-4 font-mono">{s.leaveDate}</td>
                    <td className="py-2 pr-4">{s.reason}{s.adjustmentFactor !== 1 ? ` · ×${s.adjustmentFactor}` : ""}</td>
                    <td className="py-2 pr-4 text-right font-mono">{fmt(s.finalAmount)} {s.currency}</td>
                    <td className="py-2 pr-4"><MonoChip tone={s.status === "settled" ? "green" : "amber"}>{s.status}</MonoChip></td>
                    <td className="py-2 text-right">
                      {s.status === "draft" && (
                        <PillButton
                          disabled={busy !== null}
                          onClick={() => act(`settle-${s.id}`, () => jfetch(`/finance/payroll/eosb/settlements/${s.id}/settle`, { method: "POST" }), "Settlement posted to GL")}
                          data-testid={`eosb-settle-${s.id}`}
                        ><BookOpenCheck className="w-4 h-4" /> Settle & post</PillButton>
                      )}
                    </td>
                  </tr>
                ))}
                {(settlementsQ.data?.items ?? []).length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-text-mute">No settlements. Leaver settlements are created from the person's offboarding or via the API.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </section>
      </div>

      {/* Task #1146 — comp-change dialog */}
      {compDialogPerson && (
        <CompChangeDialog
          personId={compDialogPerson.id}
          personName={compDialogPerson.name}
          onClose={() => setCompDialogPerson(null)}
          onSaved={() => {
            void qc.invalidateQueries({ queryKey: ["comp-changes", compDialogPerson.id] });
            void qc.invalidateQueries({ queryKey: ["payroll-overview"] });
            void qc.invalidateQueries({ queryKey: ["payroll-run"] });
          }}
        />
      )}
    </div>
  );
}
