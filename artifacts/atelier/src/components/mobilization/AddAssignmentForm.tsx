/**
 * AddAssignmentForm — inline form to propose a named roster person as a
 * staffing assignment via POST /engagements/:id/mobilization/assignments.
 * Uses PersonPicker (real roster search) — no raw-ID entry.
 *
 * Rate fields (rateSource, rateAmount, rateCurrency) are:
 *   - hidden in the UI when !canViewCost
 *   - omitted entirely from the POST body when !canViewCost
 *     (the server 403s if a non-costing-viewer sends any rate field)
 */
import * as React from "react";
import { PillButton } from "@/components/ui/primitives";
import { useToast } from "@/hooks/use-toast";
import { PersonPicker, type PersonPickerRow } from "@/pages/roster/rosterPickers";
import {
  API,
  FIELD_CLS,
  SENIORITIES,
  AVAIL_OPTIONS,
  CURRENCIES,
  seniorityLabel,
} from "./constants";
import { FormField } from "./FormPrimitives";
import type { MobilizationEngagement, StaffingRequirement } from "./types";

interface AddAssignmentFormProps {
  engId: string;
  eng: MobilizationEngagement;
  requirements: StaffingRequirement[];
  canViewCost: boolean;
  onDone: () => void;
  onCancel: () => void;
}

export function AddAssignmentForm({
  engId,
  eng,
  requirements,
  canViewCost,
  onDone,
  onCancel,
}: AddAssignmentFormProps) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [selectedPerson, setSelectedPerson] = React.useState<PersonPickerRow | null>(null);
  const [personId, setPersonId] = React.useState("");
  const [form, setForm] = React.useState({
    requirementId: "",
    role: "",
    seniority: "manager",
    allocationPct: 100,
    startDate: eng.startDate ?? "",
    endDate: eng.plannedEndDate ?? "",
    availabilityStatus: "unknown",
    rateSource: "",
    rateAmount: "",
    rateCurrency: "USD",
  });

  function set(k: string, v: string | number) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function onRequirementChange(reqId: string) {
    const req = requirements.find((r) => r.id === reqId);
    if (req) {
      setForm((f) => ({
        ...f,
        requirementId: reqId,
        role: req.role,
        seniority: req.seniority,
        allocationPct: req.allocationPct,
        startDate: req.startDate,
        endDate: req.endDate,
        availabilityStatus: req.availabilityStatus,
      }));
    } else {
      setForm((f) => ({ ...f, requirementId: reqId }));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!personId || !form.role.trim()) return;
    setBusy(true);
    try {
      // Build base body — never include rate fields for non-costing viewers.
      const body: Record<string, unknown> = {
        personId,
        requirementId: form.requirementId || null,
        role: form.role.trim(),
        seniority: form.seniority,
        allocationPct: Number(form.allocationPct),
        startDate: form.startDate,
        endDate: form.endDate,
        availabilityStatus: form.availabilityStatus,
        idempotencyKey: `asg-${engId}-${personId}-${Date.now()}`,
      };
      // Only costing-viewers may send rate fields; server 403s otherwise.
      if (canViewCost) {
        body.rateSource = form.rateSource || null;
        body.rateAmount = form.rateAmount ? Number(form.rateAmount) : null;
        body.rateCurrency = form.rateCurrency || "USD";
      }
      const r = await fetch(`${API}/engagements/${engId}/mobilization/assignments`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await r.json().catch(() => null)) as { error?: string } | null;
      if (!r.ok) throw new Error(j?.error ?? `asg_${r.status}`);
      toast({
        title: "Assignment proposed",
        description: selectedPerson
          ? `${selectedPerson.fullName} has been proposed.`
          : "Assignment proposed.",
      });
      onDone();
    } catch (err) {
      toast({
        title: "Failed to propose assignment",
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
      data-testid="add-assignment-form"
    >
      <div className="text-xs font-mono uppercase tracking-widest text-text-mute">
        Propose person
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="Person *" className="sm:col-span-2">
          <PersonPicker
            value={personId}
            onChange={(id, person) => {
              setPersonId(id);
              setSelectedPerson(person);
              if (person?.title && !form.role) {
                set("role", person.title);
              }
            }}
            placeholder="Search roster…"
            testId="asg-person-picker"
          />
        </FormField>

        {requirements.length > 0 && (
          <FormField label="Against requirement" className="sm:col-span-2">
            <select
              value={form.requirementId}
              onChange={(e) => onRequirementChange(e.target.value)}
              className={FIELD_CLS}
              data-testid="asg-requirement"
            >
              <option value="">-- none / free-form --</option>
              {requirements.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.role} · {seniorityLabel(r.seniority)} ({r.allocationPct}%)
                </option>
              ))}
            </select>
          </FormField>
        )}

        <FormField label="Role *">
          <input
            type="text"
            value={form.role}
            onChange={(e) => set("role", e.target.value)}
            placeholder="e.g. Project Manager"
            required
            className={FIELD_CLS}
            data-testid="asg-role"
          />
        </FormField>

        <FormField label="Seniority *">
          <select
            value={form.seniority}
            onChange={(e) => set("seniority", e.target.value)}
            className={FIELD_CLS}
            data-testid="asg-seniority"
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
            data-testid="asg-allocation"
          />
        </FormField>

        <FormField label="Availability">
          <select
            value={form.availabilityStatus}
            onChange={(e) => set("availabilityStatus", e.target.value)}
            className={FIELD_CLS}
            data-testid="asg-avail"
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
            data-testid="asg-start"
          />
        </FormField>

        <FormField label="End date *">
          <input
            type="date"
            value={form.endDate}
            onChange={(e) => set("endDate", e.target.value)}
            required
            className={FIELD_CLS}
            data-testid="asg-end"
          />
        </FormField>

        {canViewCost && (
          <>
            <FormField label="Rate source">
              <input
                type="text"
                value={form.rateSource}
                onChange={(e) => set("rateSource", e.target.value)}
                placeholder="e.g. rate_card"
                className={FIELD_CLS}
                data-testid="asg-rate-source"
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
                  data-testid="asg-rate-amount"
                />
                <select
                  value={form.rateCurrency}
                  onChange={(e) => set("rateCurrency", e.target.value)}
                  className={`${FIELD_CLS} w-24`}
                  data-testid="asg-rate-currency"
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
      </div>

      <div className="flex items-center gap-2 pt-1">
        <PillButton
          type="submit"
          variant="primary"
          disabled={busy || !personId}
          data-testid="btn-asg-submit"
        >
          {busy ? "Proposing…" : "Propose assignment"}
        </PillButton>
        <PillButton
          type="button"
          variant="ghost"
          onClick={onCancel}
          data-testid="btn-asg-cancel"
        >
          Cancel
        </PillButton>
      </div>
    </form>
  );
}
