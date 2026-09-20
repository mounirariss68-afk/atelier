/**
 * AddRequirementForm — inline form to create a new staffing requirement
 * via POST /engagements/:id/mobilization/requirements.
 *
 * Rate fields (rateSource, rateAmount, rateCurrency) are:
 *   - hidden in the UI when !canViewCost
 *   - omitted entirely from the POST body when !canViewCost
 *     (the server 403s if a non-costing-viewer sends any rate field)
 */
import * as React from "react";
import { PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import {
  API,
  FIELD_CLS,
  SENIORITIES,
  AVAIL_OPTIONS,
  CURRENCIES,
} from "./constants";
import { FormField } from "./FormPrimitives";
import type { MobilizationEngagement } from "./types";

interface AddRequirementFormProps {
  engId: string;
  eng: MobilizationEngagement;
  canViewCost: boolean;
  onDone: () => void;
  onCancel: () => void;
}

export function AddRequirementForm({
  engId,
  eng,
  canViewCost,
  onDone,
  onCancel,
}: AddRequirementFormProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [form, setForm] = React.useState({
    role: "",
    seniority: "manager",
    allocationPct: 100,
    startDate: eng.startDate ?? "",
    endDate: eng.plannedEndDate ?? "",
    required: true,
    availabilityStatus: "unknown",
    // Rate fields — only used when canViewCost; never sent otherwise.
    rateSource: "",
    rateAmount: "",
    rateCurrency: "USD",
    notes: "",
  });

  function set(k: string, v: string | number | boolean) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.role.trim() || !form.seniority) return;
    setBusy(true);
    try {
      // Build base body — never include rate fields for non-costing viewers.
      const body: Record<string, unknown> = {
        role: form.role.trim(),
        seniority: form.seniority,
        allocationPct: Number(form.allocationPct),
        startDate: form.startDate,
        endDate: form.endDate,
        required: form.required,
        availabilityStatus: form.availabilityStatus,
        notes: form.notes || null,
      };
      // Only costing-viewers may send rate fields; server 403s otherwise.
      if (canViewCost) {
        body.rateSource = form.rateSource || null;
        body.rateAmount = form.rateAmount ? Number(form.rateAmount) : null;
        body.rateCurrency = form.rateCurrency || "USD";
      }
      const r = await fetch(`${API}/engagements/${engId}/mobilization/requirements`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `req_${r.status}`);
      toast({ title: "Requirement added" });
      onDone();
    } catch (err) {
      toast({
        title: "Failed to add requirement",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="rounded-md p-4 space-y-4 border border-border-soft bg-bg-deep"
      data-testid="add-requirement-form"
    >
      <div className="text-xs font-mono uppercase tracking-widest text-text-mute">
        New staffing requirement
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Role *">
          <input
            type="text"
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="e.g. Project Manager"
            required
            className={FIELD_CLS}
            data-testid="req-role"
          />
        </FormField>

        <FormField label="Seniority *">
          <select
            value={form.seniority}
            onChange={(e) => set("seniority", e.target.value)}
            className={FIELD_CLS}
            data-testid="req-seniority"
          >
            {SENIORITIES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Allocation %">
          <input
            type="number"
            min={0}
            max={100}
            value={form.allocationPct}
            onChange={(e) => set("allocationPct", e.target.value)}
            className={FIELD_CLS}
            data-testid="req-allocation"
          />
        </FormField>

        <FormField label="Availability">
          <select
            value={form.availabilityStatus}
            onChange={(e) => set("availabilityStatus", e.target.value)}
            className={FIELD_CLS}
            data-testid="req-avail"
          >
            {AVAIL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Start date *">
          <input
            type="date"
            value={form.startDate}
            onChange={(e) => set("startDate", e.target.value)}
            required
            className={FIELD_CLS}
            data-testid="req-start"
          />
        </FormField>

        <FormField label="End date *">
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            required
            className={FIELD_CLS}
            data-testid="req-end"
          />
        </FormField>

        {/* Rate fields — only shown and submitted for costing-viewers */}
        {canViewCost && (
          <>
            <FormField label="Rate source">
              <input
                type="text"
                value={form.rateSource}
                onChange={(e) => set("rateSource", e.target.value)}
                placeholder="e.g. rate_card"
                className={FIELD_CLS}
                data-testid="req-rate-source"
              />
            </FormField>

            <FormField label="Rate amount">
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0}
                  value={form.rateAmount}
                  onChange={(e) => set("rateAmount", e.target.value)}
                  placeholder="0"
                  className={`${FIELD_CLS} flex-1`}
                  data-testid="req-rate-amount"
                />
                <select
                  value={form.rateCurrency}
                  onChange={(e) => set("rateCurrency", e.target.value)}
                  className={`${FIELD_CLS} w-24`}
                  data-testid="req-rate-currency"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </FormField>
          </>
        )}

        <FormField label="Notes" className="sm:col-span-2">
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="Optional notes…"
            className={`${FIELD_CLS} resize-none`}
            data-testid="req-notes"
          />
        </FormField>

        <div className="sm:col-span-2 flex items-center gap-2">
          <input
            id="req-required"
            type="checkbox"
            checked={form.required}
            onChange={(e) => set("required", e.target.checked)}
            className="rounded"
            data-testid="req-required-check"
          />
          <label htmlFor="req-required" className="text-sm text-text">
            Required for activation
          </label>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <PillButton
          type="submit"
          variant="primary"
          disabled={busy}
          data-testid="btn-req-submit"
        >
          {busy ? "Adding…" : "Add requirement"}
        </PillButton>
        <PillButton
          type="button"
          variant="ghost"
          onClick={onCancel}
          data-testid="btn-req-cancel"
        >
          Cancel
        </PillButton>
      </div>
    </form>
  );
}
