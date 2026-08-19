import * as React from "react";
import { Link, useLocation } from "wouter";
import {
  useAtelierQuickAddRosterPerson,
  useAtelierUpdateRosterPerson,
} from "@workspace/api-client-react";
import type {
  AtelierRosterPersonEdit,
  AtelierRosterQuickAddRequest,
} from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
// Task #509 (T4) — shared country picker + titles registry.
import { CountryCombobox } from "@/components/CountryCombobox";
import { countryCode, countryName } from "@/lib/countries";
import { useRosterTitles, FALLBACK_SENIORITIES } from "@/lib/rosterTitles";

/**
 * Task #199 — full "Edit person" form on the roster person page.
 *
 * One comprehensive, section-organised form covering every editable field
 * for the person's worker type. Only DIRTY fields are sent, the server
 * whitelists per worker type and audits field-by-field. Pay / bank /
 * lifecycle fields are deliberately absent — they stay on their dedicated
 * flows. Title inputs render only for hr / founding_partner (mirrors the
 * server gate).
 */

export interface EditablePerson {
  id: string;
  workerType: "employee" | "contractor" | "partner_firm_resource";
  fullName: string;
  // Task #538 — structured name fields (from the linked person record).
  honorific?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  lastName?: string | null;
  email: string | null;
  role: string | null;
  seniority: string | null;
  title: string | null;
  country: string | null;
  status: string;
  startDate: string | null;
  endDate: string | null;
  preferredName?: string | null;
  employmentType?: string | null;
  employmentStatus?: string | null;
  employingEntity?: string | null;
  contractType?: string | null;
  vendorEntity?: string | null;
  partnerFirmId?: string | null;
  partnerFirmName?: string | null;
  homeOffice?: string | null;
  noticePeriodDays?: number | null;
  nationality?: string | null;
  gender?: string | null;
  cellPhones?: Array<{ country: string; number: string }> | null;
  officeAddress?: string | null;
  payrollCountry?: string | null;
  iban?: string | null;
  swift?: string | null;
  dayRateAmount?: number | null;
  dayRateCurrency?: string | null;
  // Task #660 — statutory payroll fields (employees, comp-gated wire).
  baseCompensation?: number | null;
  baseCurrency?: string | null;
  legalEntityId?: string | null;
  basicWageMonthly?: number | null;
  housingAllowanceMonthly?: number | null;
  schemeRegisteredOn?: string | null;
  // Task #1137 — whether current comp differs from the signed contract.
  compDiffersFromContract?: boolean | null;
}

// Task #660 — payroll draft, saved via the dedicated payroll PATCH (raw
// fetch — payroll routes stay off the codegen'd OpenAPI surface).
type PayrollDraft = {
  legalEntityId: string;
  baseCompensation: string;
  baseCurrency: string;
  basicWageMonthly: string;
  housingAllowanceMonthly: string;
  schemeRegisteredOn: string;
};

function payrollDraftFrom(p: EditablePerson): PayrollDraft {
  return {
    legalEntityId: p.legalEntityId ?? "",
    baseCompensation: p.baseCompensation != null ? String(p.baseCompensation) : "",
    baseCurrency: p.baseCurrency ?? "",
    basicWageMonthly: p.basicWageMonthly != null ? String(p.basicWageMonthly) : "",
    housingAllowanceMonthly:
      p.housingAllowanceMonthly != null ? String(p.housingAllowanceMonthly) : "",
    schemeRegisteredOn: p.schemeRegisteredOn ?? "",
  };
}

interface PayrollEntityOption {
  id: string;
  name: string;
  country: string;
  baseCurrency: string | null;
  officeAddress?: string | null;
}

type Draft = {
  honorific: string;
  firstName: string;
  middleName: string;
  lastName: string;
  preferredName: string;
  email: string;
  personalEmail: string;
  seniority: string;
  title: string;
  role: string;
  homeOffice: string;
  country: string;
  employmentType: string;
  employmentStatus: string;
  legalEntityName: string;
  contractType: string;
  vendorEntity: string;
  partnerFirmId: string;
  startDate: string;
  endDate: string;
  noticePeriodDays: string;
  nationality: string;
  gender: string;
  cellPhones: Array<{ country: string; number: string }>;
  officeAddress: string;
};

// Best-effort split of a legacy full name when structured fields are absent.
function splitLegacy(fullName: string | null | undefined): { first: string; middle: string; last: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

function blankDraft(): Draft {
  return {
    honorific: "",
    firstName: "",
    middleName: "",
    lastName: "",
    preferredName: "",
    email: "",
    personalEmail: "",
    seniority: "",
    title: "",
    role: "",
    homeOffice: "",
    country: "",
    employmentType: "FTE",
    employmentStatus: "active",
    legalEntityName: "",
    contractType: "",
    vendorEntity: "",
    partnerFirmId: "",
    startDate: "",
    endDate: "",
    noticePeriodDays: "",
    nationality: "",
    gender: "",
    cellPhones: [],
    officeAddress: "",
  };
}

function draftFrom(p: EditablePerson | null, personalEmail: string | null): Draft {
  if (!p) return blankDraft();
  const legacy = p.firstName && p.lastName ? null : splitLegacy(p.fullName);
  return {
    honorific: p.honorific ?? "",
    firstName: p.firstName ?? legacy?.first ?? "",
    middleName: p.middleName ?? legacy?.middle ?? "",
    lastName: p.lastName ?? legacy?.last ?? "",
    preferredName: p.preferredName ?? "",
    email: p.email ?? "",
    personalEmail: personalEmail ?? "",
    seniority: p.seniority ?? "",
    title: p.title ?? "",
    role: p.role ?? "",
    homeOffice: p.homeOffice ?? "",
    country: p.country ?? "",
    employmentType: p.employmentType ?? "FTE",
    employmentStatus: p.employmentStatus ?? "active",
    legalEntityName: "",
    contractType: p.contractType ?? "",
    vendorEntity: p.vendorEntity ?? "",
    partnerFirmId: p.partnerFirmId ?? "",
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    noticePeriodDays:
      p.noticePeriodDays != null ? String(p.noticePeriodDays) : "",
    nationality: p.nationality ?? "",
    // Legacy `unspecified` values are intentionally represented as blank in
    // this form. Leaving the field untouched therefore never sends a gender
    // patch for those records.
    gender: p.gender === "female" || p.gender === "male" ? p.gender : "",
    cellPhones: (p.cellPhones ?? []).map((c) => ({ ...c })),
    officeAddress: p.officeAddress ?? "",
  };
}

export function EditPersonForm({
  person,
  createWorkerType = "employee",
  viewerCanEditTitle,
  viewerCanSeeComp = false,
  onSaved,
  onCreated,
  onClose,
}: {
  person: EditablePerson | null;
  /** Worker type used while the form is creating a new roster person. */
  createWorkerType?: "employee" | "contractor";
  viewerCanEditTitle: boolean;
  viewerCanSeeComp?: boolean;
  onSaved: (updated: Record<string, unknown>) => void;
  onCreated?: (created: { id: string; fullName: string }) => void;
  onClose: () => void;
}) {
  const isCreate = !person;
  const [createType, setCreateType] = React.useState<"employee" | "contractor">(createWorkerType);
  const workerType = person?.workerType ?? createType;
  const isEmployee = workerType === "employee";
  const isContractor = workerType === "contractor";
  const isPfr = workerType === "partner_firm_resource";
  const [, navigate] = useLocation();

  // personalEmail lives outside the person wire — prefill from the
  // personal-data view (editors are all personnel-contract viewers).
  const [personalEmail0, setPersonalEmail0] = React.useState<string | null>(null);
  const [personalLoaded, setPersonalLoaded] = React.useState(isPfr);
  const [firms, setFirms] = React.useState<Array<{ id: string; name: string }>>([]);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(person, null));
  const [error, setError] = React.useState<string | null>(null);
  const [runOnboarding, setRunOnboarding] = React.useState(false);
  const [createLogin, setCreateLogin] = React.useState(false);
  const [managerPersonId, setManagerPersonId] = React.useState("");
  const [managers, setManagers] = React.useState<
    Array<{ id: string; fullName: string; title: string | null }>
  >([]);
  const [success, setSuccess] = React.useState<{
    id: string;
    fullName: string;
    status: string;
    onboardingId: string | null;
    login: {
      ok?: boolean;
      error?: string;
      message?: string;
      activationUrl?: string;
      welcomeEmail?: { sent?: boolean; status?: string } | null;
    } | null;
  } | null>(null);
  // Task #660 — payroll fields (comp-gated, employees only).
  const showPayroll = !isCreate && isEmployee && viewerCanSeeComp;
  const [payrollEntities, setPayrollEntities] = React.useState<PayrollEntityOption[]>([]);
  const [payroll, setPayroll] = React.useState<PayrollDraft>(() =>
    person ? payrollDraftFrom(person) : { legalEntityId: "", baseCompensation: "", baseCurrency: "", basicWageMonthly: "", housingAllowanceMonthly: "", schemeRegisteredOn: "" },
  );
  const [payrollSaving, setPayrollSaving] = React.useState(false);
  const mutation = useAtelierUpdateRosterPerson();
  const quickAddMutation = useAtelierQuickAddRosterPerson();
  // Task #509 (T4) — seniority options from the titles registry; when the
  // registry is empty we fall back to the legacy hardcoded ladder.
  const { titles } = useRosterTitles();
  const seniorityOptions = React.useMemo(() => {
    const fromTitles = Array.from(new Set(titles.map((t) => t.seniority).filter(Boolean)));
    const opts = fromTitles.length > 0 ? fromTitles : FALLBACK_SENIORITIES;
    if (draft.seniority && !opts.includes(draft.seniority)) return [draft.seniority, ...opts];
    return opts;
  }, [titles, draft.seniority]);

  React.useEffect(() => {
    let alive = true;
    if (!isCreate && !isPfr && person) {
      fetch(`/api/atelier/roster/people/${person.id}/personal`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive) return;
          const pe = (d?.person?.personalEmail as string | null) ?? null;
          setPersonalEmail0(pe);
          setDraft((prev) => ({ ...prev, personalEmail: pe ?? "" }));
          setPersonalLoaded(true);
        })
        .catch(() => alive && setPersonalLoaded(true));
    }
    if (isPfr) {
      fetch(`/api/atelier/roster/partner-firms`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { firms: [] }))
        .then((d) => alive && setFirms(d.firms ?? []))
        .catch(() => undefined);
    }
    if (isEmployee && (showPayroll || isCreate)) {
      // Task #660 — active legal-entity register. In create mode this
      // supplies the same canonical selector used by payroll and maps the
      // selected name to the quick-add endpoint's existing field.
      fetch(`/api/atelier/roster/legal-entities`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { entities: [] }))
        .then((d) => alive && setPayrollEntities(d.entities ?? []))
        .catch(() => undefined);
    }
    if (isCreate) {
      fetch("/api/atelier/roster/people?workerType=employee", { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) =>
          alive &&
          setManagers(
            ((d.people ?? []) as Array<{
              id: string;
              fullName: string;
              title: string | null;
              status: string;
            }>)
              .filter((p) => p.status === "active")
              .map((p) => ({ id: p.id, fullName: p.fullName, title: p.title })),
          ),
        )
        .catch(() => alive && setManagers([]));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person?.id, isCreate, isEmployee, isPfr, showPayroll]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const buildPatch = (): AtelierRosterPersonEdit | { error: string } => {
    if (!person) return { error: "Create mode uses the roster create flow." };
    const base = draftFrom(person, personalEmail0);
    const patch: Record<string, unknown> = {};
    const strOrNull = (s: string) => (s.trim() ? s.trim() : null);

    const diffStr = (key: keyof Draft, out: string, nullable: boolean) => {
      if (draft[key] === base[key]) return;
      patch[out] = nullable ? strOrNull(draft[key] as string) : (draft[key] as string).trim();
    };

    // Task #538 — structured name fields; if any name part changed, send
    // the full structured set so the server recomputes fullName/displayName.
    const nameChanged =
      draft.honorific !== base.honorific ||
      draft.firstName !== base.firstName ||
      draft.middleName !== base.middleName ||
      draft.lastName !== base.lastName;
    if (nameChanged) {
      if (!draft.firstName.trim() || !draft.lastName.trim())
        return { error: "First and last name are required." };
      patch.honorific = strOrNull(draft.honorific);
      patch.firstName = draft.firstName.trim();
      patch.middleName = strOrNull(draft.middleName);
      patch.lastName = draft.lastName.trim();
    }
    if (!isPfr) {
      diffStr("personalEmail", "personalEmail", true);
    }
    if (draft.email !== base.email) {
      patch.email = isPfr ? strOrNull(draft.email) : draft.email.trim();
    }
    diffStr("country", "country", true);
    if (draft.nationality !== base.nationality) {
      patch.nationality = strOrNull(draft.nationality)?.toUpperCase() ?? null;
    }
    if (draft.gender !== base.gender) patch.gender = draft.gender;
    diffStr("startDate", "startDate", true);
    diffStr("endDate", "endDate", true);

    if (isEmployee) {
      diffStr("preferredName", "preferredName", true);
      if (draft.seniority !== base.seniority && draft.seniority) patch.seniority = draft.seniority;
      if (viewerCanEditTitle) diffStr("title", "title", false);
      diffStr("homeOffice", "homeOffice", true);
      if (draft.employmentType !== base.employmentType) patch.employmentType = draft.employmentType;
      if (draft.employmentStatus !== base.employmentStatus)
        patch.employmentStatus = draft.employmentStatus;
      if (draft.noticePeriodDays !== base.noticePeriodDays && draft.noticePeriodDays.trim()) {
        const n = Number(draft.noticePeriodDays);
        if (!Number.isInteger(n) || n < 0 || n > 365)
          return { error: "Notice period must be a whole number of days (0–365)." };
        patch.noticePeriodDays = n;
      }
    }
    if (isContractor) {
      diffStr("vendorEntity", "vendorEntity", true);
      if (draft.contractType !== base.contractType)
        patch.contractType = draft.contractType || null;
    }
    if (isPfr) {
      diffStr("role", "role", true);
      diffStr("seniority", "seniority", true);
      if (draft.partnerFirmId !== base.partnerFirmId && draft.partnerFirmId)
        patch.partnerFirmId = draft.partnerFirmId;
    }
    if (!isPfr) {
      const cellsChanged =
        JSON.stringify(draft.cellPhones) !== JSON.stringify(base.cellPhones);
      if (cellsChanged) {
        const cleaned = draft.cellPhones
          .map((c) => ({ country: c.country.trim(), number: c.number.trim() }))
          .filter((c) => c.country || c.number);
        if (cleaned.some((c) => !c.country || !c.number))
          return { error: "Each cell phone needs both a country label and a number." };
        patch.cellPhones = cleaned;
      }
      diffStr("officeAddress", "officeAddress", true);
    }

    if ("title" in patch && patch.title === "") return { error: "Title cannot be blank." };
    if ("email" in patch && !isPfr && !String(patch.email ?? "").includes("@"))
      return { error: "Work email must be a valid email address." };
    const sd = ("startDate" in patch ? patch.startDate : base.startDate || null) as string | null;
    const ed = ("endDate" in patch ? patch.endDate : base.endDate || null) as string | null;
    if (sd && ed && ed < sd) return { error: "End date cannot be before the start date." };
    return patch as AtelierRosterPersonEdit;
  };

  // Task #660 — dirty payroll fields → body for the dedicated payroll PATCH.
  const buildPayrollPatch = (): Record<string, unknown> | { error: string } | null => {
    if (!showPayroll) return null;
    const base = payrollDraftFrom(person!);
    const patch: Record<string, unknown> = {};
    if (payroll.legalEntityId !== base.legalEntityId) {
      patch.legalEntityId = payroll.legalEntityId || null;
    }
    const num = (key: "baseCompensation" | "basicWageMonthly" | "housingAllowanceMonthly", label: string, allowZero: boolean) => {
      if (payroll[key] === base[key]) return null;
      const s = payroll[key].trim();
      if (!s) {
        patch[key] = null;
        return null;
      }
      const n = Number(s.replace(/,/g, ""));
      if (!Number.isFinite(n) || n < 0 || (!allowZero && n <= 0)) return `${label} must be a positive number.`;
      patch[key] = n;
      return null;
    };
    const errs = [
      num("baseCompensation", "Annual base compensation", false),
      num("basicWageMonthly", "Basic wage (monthly)", false),
      num("housingAllowanceMonthly", "Housing allowance (monthly)", true),
    ].filter(Boolean);
    if (errs.length > 0) return { error: String(errs[0]) };
    if (payroll.baseCurrency !== base.baseCurrency) {
      const c = payroll.baseCurrency.trim().toUpperCase();
      if (c && !/^[A-Z]{3}$/.test(c)) return { error: "Base currency must be a 3-letter code (e.g. AED)." };
      patch.baseCurrency = c || null;
    }
    if (payroll.schemeRegisteredOn !== base.schemeRegisteredOn) {
      patch.schemeRegisteredOn = payroll.schemeRegisteredOn || null;
    }
    return Object.keys(patch).length > 0 ? patch : null;
  };

  const buildCreateBody = (): AtelierRosterQuickAddRequest | { error: string } => {
    if (!draft.firstName.trim() || !draft.lastName.trim())
      return { error: "First and last name are required." };
    if (!draft.email.trim().includes("@")) return { error: "Work email must be a valid email address." };
    if (draft.startDate && draft.endDate && draft.endDate < draft.startDate)
      return { error: "End date cannot be before the start date." };
    return {
      workerType: createType,
      honorific: draft.honorific.trim() || null,
      firstName: draft.firstName.trim(),
      middleName: draft.middleName.trim() || null,
      lastName: draft.lastName.trim(),
      preferredName: isEmployee ? draft.preferredName.trim() || null : null,
      email: draft.email.trim(),
      role: draft.role.trim() || null,
      seniority: draft.seniority.trim() || null,
      title: draft.title.trim() || null,
      country: draft.country || null,
      startDate: draft.startDate || null,
      // The create API deliberately still uses this field name. It receives
      // the selected canonical legal entity's display name, never a free-text
      // "Employing entity" value from an edit-style patch.
      employingEntity: isEmployee ? draft.legalEntityName || null : null,
      vendorEntity: isContractor ? draft.vendorEntity.trim() || null : null,
      managerPersonId: managerPersonId || null,
      runOnboarding,
      createLogin,
    };
  };

  const save = async () => {
    setError(null);
    if (isCreate) {
      const createBody = buildCreateBody();
      if ("error" in createBody) {
        setError(createBody.error);
        return;
      }
      try {
        const created = await quickAddMutation.mutateAsync({ data: createBody });
        onCreated?.({ id: created.id, fullName: created.fullName });
        setSuccess({
          id: created.id,
          fullName: created.fullName,
          status: created.status,
          onboardingId: created.onboardingId ?? null,
          login: (created.login as {
            ok?: boolean;
            error?: string;
            message?: string;
            activationUrl?: string;
            welcomeEmail?: { sent?: boolean; status?: string } | null;
          } | null) ?? null,
        });
      } catch (e: unknown) {
        const err = e as { data?: { message?: string; error?: string }; message?: string; status?: number };
        if (err.status === 409) setError("That work email is already in use by someone else.");
        else setError(err.data?.message ?? err.data?.error ?? err.message ?? "Failed to add person.");
      }
      return;
    }
    const patch = buildPatch();
    if ("error" in patch && typeof patch.error === "string" && Object.keys(patch).length === 1) {
      setError(patch.error);
      return;
    }
    const payrollPatch = buildPayrollPatch();
    if (payrollPatch && "error" in payrollPatch && typeof payrollPatch.error === "string") {
      setError(payrollPatch.error);
      return;
    }
    const body = patch as AtelierRosterPersonEdit;
    if (Object.keys(body).length === 0 && !payrollPatch) {
      onClose();
      return;
    }
    try {
      let saved: Record<string, unknown> | null = null;
      if (Object.keys(body).length > 0) {
        const resp = await mutation.mutateAsync({ id: person!.id, data: body });
        saved = resp.person as Record<string, unknown>;
      }
      if (payrollPatch) {
        setPayrollSaving(true);
        const r = await fetch(`/api/atelier/roster/people/${person!.id}/payroll`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(payrollPatch),
        });
        setPayrollSaving(false);
        if (!r.ok) {
          const d = (await r.json().catch(() => null)) as { error?: string } | null;
          if (r.status === 403) setError("You are not authorized to edit payroll fields.");
          else if (d?.error === "legal-entity-not-found")
            setError("That legal entity is no longer active — refresh and pick again.");
          else setError("Payroll fields failed to save — please check the values.");
          if (saved) onSaved(saved);
          return;
        }
        const d = (await r.json()) as { person?: Record<string, unknown> };
        if (d.person) saved = d.person;
      }
      if (saved) onSaved(saved);
      onClose();
    } catch (e: unknown) {
      setPayrollSaving(false);
      const status = (e as { status?: number })?.status;
      if (status === 403) setError("You are not authorized to edit this person.");
      else if (status === 409) setError("That work email is already in use by someone else.");
      else if (status === 422) setError("Some fields are invalid — please check the values.");
      else setError("Save failed. Please try again.");
    }
  };

  const input =
    "glass-surface border border-border-soft rounded px-2 py-1 text-text text-xs w-full";
  const label = "text-[10px] font-mono uppercase tracking-widest text-text-mute";

  if (success) {
    return (
      <Card className="p-4 space-y-4" data-testid="create-person-success">
        <div>
          <h3 className="font-mono text-xs uppercase text-text-mute">
            {success.fullName} is on the roster
          </h3>
          <p className="mt-2 text-sm text-text-mute">
            Added as {workerType} · status <span className="font-mono">{success.status}</span>
            {success.onboardingId ? " · onboarding checklist started" : ""}.
          </p>
        </div>
        {success.login?.ok && success.login.activationUrl && (
          <div className="space-y-2">
            <p className="text-sm text-text-mute">
              Portal login created. The one-time activation link expires in 72 hours and is shown
              only once. Welcome email:{" "}
              {success.login.welcomeEmail?.sent
                ? "sent"
                : success.login.welcomeEmail?.status ?? "not sent"}
              .
            </p>
            <div
              className="bg-bg-deep/60 border border-line rounded p-3 font-mono text-xs break-all select-all"
              data-testid="quick-add-activation-link"
            >
              {success.login.activationUrl}
            </div>
          </div>
        )}
        {success.login?.ok === false && (
          <p className="text-sm text-red-500 font-mono" data-testid="quick-add-login-error">
            Person added, but the portal login couldn’t be created:{" "}
            {success.login.message ?? success.login.error}. You can create it later from
            Onboarding.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-3 py-1"
            data-testid="quick-add-done"
          >
            Close
          </button>
          <button
            onClick={() => {
              onClose();
              navigate(`/roster/people/${success.id}`);
            }}
            className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-3 py-1 rounded"
            data-testid="quick-add-view-person"
          >
            View person
          </button>
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-4" data-testid="edit-person-form">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          {isCreate ? "Add person to the roster" : `Edit person · ${person!.fullName}`}
        </h3>
        {!isCreate && <MonoChip>pay &amp; bank fields stay locked to finance flows</MonoChip>}
      </div>

      {isCreate && (
        <section className="space-y-3">
          <p className="text-sm text-text-mute">
            For people who are already hired or historical joiners. Formal recruits should use the{" "}
            <Link href="/roster/invitations" className="text-gold hover:underline">
              hiring flow
            </Link>
            .
          </p>
          <div className="flex gap-2">
            {(["employee", "contractor"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setCreateType(type)}
                className={`px-3 py-1.5 rounded text-xs font-mono uppercase tracking-widest border transition-colors ${
                  createType === type
                    ? "bg-gold text-bg border-gold"
                    : "border-border text-text-mute hover:text-text"
                }`}
                data-testid={`quick-add-type-${type}`}
              >
                {type}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Identity */}
      <section className="space-y-2">
        <div className={label}>Identity</div>
        <div className="grid gap-3 md:grid-cols-2">
          <FieldWrap label="Honorific">
            <input className={input} value={draft.honorific} maxLength={40}
              placeholder="Dr."
              onChange={(e) => set({ honorific: e.target.value })} data-testid="edit-honorific" />
          </FieldWrap>
          <FieldWrap label="First name *">
            <input className={input} value={draft.firstName} maxLength={120}
              onChange={(e) => set({ firstName: e.target.value })} data-testid="edit-firstname" />
          </FieldWrap>
          <FieldWrap label="Middle name">
            <input className={input} value={draft.middleName} maxLength={120}
              onChange={(e) => set({ middleName: e.target.value })} data-testid="edit-middlename" />
          </FieldWrap>
          <FieldWrap label="Last name *">
            <input className={input} value={draft.lastName} maxLength={120}
              onChange={(e) => set({ lastName: e.target.value })} data-testid="edit-lastname" />
          </FieldWrap>
          {isEmployee && (
            <FieldWrap label="Preferred name">
              <input className={input} value={draft.preferredName} maxLength={120}
                onChange={(e) => set({ preferredName: e.target.value })} data-testid="edit-preferredname" />
            </FieldWrap>
          )}
          <FieldWrap label="Work email">
            <input className={input} value={draft.email} maxLength={320} type="email"
              onChange={(e) => set({ email: e.target.value })} data-testid="edit-email" />
          </FieldWrap>
          {!isPfr && !isCreate && (
            <FieldWrap label={`Personal email${personalLoaded ? "" : " (loading…)"}`}>
              <input className={input} value={draft.personalEmail} maxLength={320} type="email"
                disabled={!personalLoaded}
                onChange={(e) => set({ personalEmail: e.target.value })} data-testid="edit-personalemail" />
            </FieldWrap>
          )}
          {isEmployee && (isCreate || viewerCanEditTitle) && (
            <FieldWrap label={isCreate ? "Job title" : "Job title (HR / Founding Partner only)"}>
              <input className={input} value={draft.title} maxLength={120}
                onChange={(e) => set({ title: e.target.value })} data-testid="edit-title" />
            </FieldWrap>
          )}
          {isEmployee && (
            <FieldWrap label="Seniority">
              <select className={input} value={draft.seniority}
                onChange={(e) => set({ seniority: e.target.value })} data-testid="edit-seniority">
                <option value="">—</option>
                {seniorityOptions.map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
                ))}
              </select>
            </FieldWrap>
          )}
          {isPfr && (
            <>
              <FieldWrap label="Role on engagement">
                <input className={input} value={draft.role} maxLength={120}
                  onChange={(e) => set({ role: e.target.value })} data-testid="edit-role" />
              </FieldWrap>
              <FieldWrap label="Seniority">
                <input className={input} value={draft.seniority} maxLength={60}
                  onChange={(e) => set({ seniority: e.target.value })} data-testid="edit-seniority" />
              </FieldWrap>
            </>
          )}
        </div>
      </section>

      {/* Employment */}
      <section className="space-y-2">
        <div className={label}>Employment</div>
        <div className="grid gap-3 md:grid-cols-2">
          {isEmployee && (
            <>
              {!isCreate && <FieldWrap label="Employment type">
                <select className={input} value={draft.employmentType}
                  onChange={(e) => set({ employmentType: e.target.value })} data-testid="edit-employmenttype">
                  <option value="FTE">FTE</option>
                  <option value="fixed_term">fixed term</option>
                  <option value="intern">intern</option>
                </select>
              </FieldWrap>}
              {!isCreate && <FieldWrap label="Employment status">
                <select className={input} value={draft.employmentStatus}
                  onChange={(e) => set({ employmentStatus: e.target.value })} data-testid="edit-employmentstatus">
                  <option value="active">active</option>
                  <option value="notice">notice</option>
                  <option value="on_leave">on leave</option>
                  <option value="terminated">terminated</option>
                </select>
              </FieldWrap>}
              {isCreate && (
                <FieldWrap label="Employing legal entity">
                  <select
                    className={input}
                    value={payroll.legalEntityId}
                    data-testid="create-payroll-entity"
                    onChange={(e) => {
                      const id = e.target.value;
                      const entity = payrollEntities.find((x) => x.id === id);
                      const patch: Partial<Draft> = { legalEntityName: entity?.name ?? "" };
                      // Quick-add persists country and the legacy display
                      // name; the richer location/payroll defaults are only
                      // applied by the existing-person payroll editor, whose
                      // dedicated audited endpoint persists them.
                      if (entity?.country && !draft.country.trim())
                        patch.country = countryCode(entity.country) ?? entity.country;
                      set(patch);
                      setPayroll((current) => ({
                        ...current,
                        legalEntityId: id,
                      }));
                    }}
                  >
                    <option value="">— not linked —</option>
                    {payrollEntities.map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name} ({entity.country}
                        {entity.baseCurrency ? ` · ${entity.baseCurrency}` : ""})
                      </option>
                    ))}
                  </select>
                </FieldWrap>
              )}
              {!isCreate && <FieldWrap label="Home office">
                <input className={input} value={draft.homeOffice} maxLength={120}
                  onChange={(e) => set({ homeOffice: e.target.value })} data-testid="edit-homeoffice" />
              </FieldWrap>}
              {!isCreate && <FieldWrap label="Notice period (days)">
                <input className={input} value={draft.noticePeriodDays} inputMode="numeric"
                  onChange={(e) => set({ noticePeriodDays: e.target.value })} data-testid="edit-noticeperiod" />
              </FieldWrap>}
            </>
          )}
          {isContractor && (
            <>
              <FieldWrap label="Vendor entity">
                <input className={input} value={draft.vendorEntity} maxLength={200}
                  onChange={(e) => set({ vendorEntity: e.target.value })} data-testid="edit-vendorentity" />
              </FieldWrap>
              {!isCreate && <FieldWrap label="Contract type">
                <select className={input} value={draft.contractType}
                  onChange={(e) => set({ contractType: e.target.value })} data-testid="edit-contracttype">
                  <option value="">—</option>
                  <option value="T&M">T&amp;M</option>
                  <option value="fixed_fee">fixed fee</option>
                  <option value="retainer">retainer</option>
                </select>
              </FieldWrap>}
            </>
          )}
          {isPfr && (
            <FieldWrap label="Partner firm">
              <select className={input} value={draft.partnerFirmId}
                onChange={(e) => set({ partnerFirmId: e.target.value })} data-testid="edit-partnerfirm">
                {firms.length === 0 && draft.partnerFirmId && (
                    <option value={draft.partnerFirmId}>{person!.partnerFirmName ?? draft.partnerFirmId}</option>
                )}
                {firms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </FieldWrap>
          )}
          <FieldWrap label={isCreate ? "Start date" : "Start date (correction only)"}>
            <input className={input} type="date" value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })} data-testid="edit-startdate" />
          </FieldWrap>
          {!isCreate && <FieldWrap label="End date (correction only)">
            <input className={input} type="date" value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })} data-testid="edit-enddate" />
          </FieldWrap>}
        </div>
      </section>

      {/* Contact */}
      {!isPfr && !isCreate && (
        <section className="space-y-2">
          <div className={label}>Contact</div>
          {draft.cellPhones.map((c, i) => (
            <div key={i} className="flex items-center gap-2">
              <input className={`${input} !w-32`} value={c.country} placeholder="Country (e.g. UAE)"
                onChange={(e) =>
                  set({ cellPhones: draft.cellPhones.map((x, j) => (j === i ? { ...x, country: e.target.value } : x)) })}
                data-testid={`edit-cell-country-${i}`} />
              <input className={input} value={c.number} placeholder="+971 50 123 4567"
                onChange={(e) =>
                  set({ cellPhones: draft.cellPhones.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)) })}
                data-testid={`edit-cell-number-${i}`} />
              <button
                onClick={() => set({ cellPhones: draft.cellPhones.filter((_, j) => j !== i) })}
                className="text-[10px] font-mono uppercase text-text-faint hover:text-warn px-1"
                data-testid={`edit-cell-remove-${i}`}>
                ✕
              </button>
            </div>
          ))}
          {draft.cellPhones.length < 3 && (
            <button
              onClick={() => set({ cellPhones: [...draft.cellPhones, { country: "", number: "" }] })}
              className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
              data-testid="edit-cell-add">
              + Add cell
            </button>
          )}
          <FieldWrap label="Office address">
            <textarea className={input} rows={2} value={draft.officeAddress} maxLength={500}
              onChange={(e) => set({ officeAddress: e.target.value })} data-testid="edit-officeaddress" />
          </FieldWrap>
        </section>
      )}

      {/* Task #660 — payroll fields (employees, comp-cleared editors only).
          Saved via the dedicated payroll PATCH so pay data keeps a single
          audited write path, separate from the general profile edit. */}
      {showPayroll && (
        <section className="space-y-2" data-testid="edit-payroll-section">
          <div className={label}>Payroll (statutory)</div>
          {/* Task #1137 — subtle warning when current comp differs from the
              signed contract; links to the salary review queue. */}
          {person?.compDiffersFromContract === true && (
            <Link href="/people/reward/salary">
              <div
                className="flex items-center gap-2 rounded border border-warn/40 bg-warn/5 px-2 py-1 text-[11px] text-warn hover:border-warn/70"
                data-testid="edit-payroll-comp-differs"
              >
                <span>⚠ Current comp differs from the signed contract — review &amp; reconcile →</span>
              </div>
            </Link>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            <FieldWrap label="Employing legal entity *">
              <select className={input} value={payroll.legalEntityId} data-testid="edit-payroll-entity"
                onChange={(e) => {
                  const id = e.target.value;
                  const ent = payrollEntities.find((x) => x.id === id);
                  const autofill: Partial<Draft> = {};
                  // The payroll entity selector replaces the retired
                  // employing-entity field as the one canonical source for
                  // location defaults. Values already entered by the editor
                  // remain authoritative.
                  if (ent?.officeAddress && !draft.officeAddress.trim())
                    autofill.officeAddress = ent.officeAddress;
                  if (ent?.country && !draft.country.trim())
                    autofill.country = countryCode(ent.country) ?? ent.country;
                  if (Object.keys(autofill).length > 0) set(autofill);
                  setPayroll((p) => ({
                    ...p,
                    legalEntityId: id,
                    // Autofill the entity's base currency when none set yet —
                    // payroll runs are single-currency per entity.
                    baseCurrency:
                      id && ent?.baseCurrency && !p.baseCurrency.trim()
                        ? ent.baseCurrency
                        : p.baseCurrency,
                  }));
                }}>
                <option value="">— not linked —</option>
                {payroll.legalEntityId && !payrollEntities.some((x) => x.id === payroll.legalEntityId) && (
                  <option value={payroll.legalEntityId}>{payroll.legalEntityId}</option>
                )}
                {payrollEntities.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name} ({x.country}{x.baseCurrency ? ` · ${x.baseCurrency}` : ""})
                  </option>
                ))}
              </select>
            </FieldWrap>
            <FieldWrap label="Base currency *">
              <input className={input} value={payroll.baseCurrency} maxLength={3} placeholder="AED"
                onChange={(e) => setPayroll((p) => ({ ...p, baseCurrency: e.target.value.toUpperCase() }))}
                data-testid="edit-payroll-currency" />
            </FieldWrap>
            <FieldWrap label="Annual base compensation *">
              <input className={input} value={payroll.baseCompensation} inputMode="decimal"
                onChange={(e) => setPayroll((p) => ({ ...p, baseCompensation: e.target.value }))}
                data-testid="edit-payroll-basecomp" />
            </FieldWrap>
            <FieldWrap label="Basic wage (monthly, optional)">
              <input className={input} value={payroll.basicWageMonthly} inputMode="decimal"
                placeholder="blank = full monthly salary"
                onChange={(e) => setPayroll((p) => ({ ...p, basicWageMonthly: e.target.value }))}
                data-testid="edit-payroll-basicwage" />
            </FieldWrap>
            <FieldWrap label="Housing allowance (monthly, optional)">
              <input className={input} value={payroll.housingAllowanceMonthly} inputMode="decimal"
                onChange={(e) => setPayroll((p) => ({ ...p, housingAllowanceMonthly: e.target.value }))}
                data-testid="edit-payroll-housing" />
            </FieldWrap>
            <FieldWrap label="Scheme registered on (optional)">
              <input className={input} type="date" value={payroll.schemeRegisteredOn}
                onChange={(e) => setPayroll((p) => ({ ...p, schemeRegisteredOn: e.target.value }))}
                data-testid="edit-payroll-schemedate" />
            </FieldWrap>
          </div>
          <p className="text-[11px] text-text-faint">
            Payroll runs need the entity link, annual base compensation, base
            currency, start date and nationality before they can post. Scheme
            registration date defaults to the start date when blank.
          </p>
        </section>
      )}

      {/* Compensation & banking — mirrors the profile card for comp-cleared
          viewers. These fields are deliberately read-only here: bank details
          change only via the HR-approved bank-change flow, and pay data via
          the finance flows. */}
      {!isCreate && viewerCanSeeComp && (
        <section className="space-y-2" data-testid="edit-comp-section">
          <div className={label}>Compensation &amp; banking (read-only)</div>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldWrap label="Payroll country">
              <input className={input} value={countryName(person!.payrollCountry) ?? person!.payrollCountry ?? ""} disabled readOnly data-testid="edit-payrollcountry-ro" />
            </FieldWrap>
            <FieldWrap label="Day rate">
              <input
                className={input}
                value={
                  person!.dayRateAmount != null
                    ? `${(person!.dayRateAmount / 100).toLocaleString()} ${person!.dayRateCurrency ?? ""}`
                    : ""
                }
                disabled readOnly data-testid="edit-dayrate-ro"
              />
            </FieldWrap>
            <FieldWrap label="IBAN">
              <input className={input} value={person!.iban ?? ""} disabled readOnly data-testid="edit-iban-ro" />
            </FieldWrap>
            <FieldWrap label="SWIFT">
              <input className={input} value={person!.swift ?? ""} disabled readOnly data-testid="edit-swift-ro" />
            </FieldWrap>
          </div>
          <p className="text-[11px] text-text-faint">
            Bank details change via the HR-approved bank-change flow; pay data
            via Finance. This keeps a single audited write path for money
            fields.
          </p>
        </section>
      )}

      {/* Demographics */}
      <section className="space-y-2">
        <div className={label}>Demographics &amp; location</div>
        <div className="grid gap-3 md:grid-cols-3">
          <FieldWrap label="Country (location)">
            <CountryCombobox value={draft.country} allowClear testIdPrefix="edit-country"
              onChange={(iso) => set({ country: iso })} />
          </FieldWrap>
          {!isCreate && <FieldWrap label="Nationality">
            <CountryCombobox value={draft.nationality} allowClear testIdPrefix="edit-nationality"
              onChange={(iso) => set({ nationality: iso })} />
          </FieldWrap>}
          {!isCreate && <FieldWrap label="Gender">
            <select className={input} value={draft.gender}
              onChange={(e) => set({ gender: e.target.value })} data-testid="edit-gender">
              <option value="" disabled>—</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </FieldWrap>}
        </div>
      </section>

      {isCreate && (
        <section className="border-t border-border-soft pt-3 space-y-3" data-testid="create-person-options">
          <FieldWrap label="Manager (optional)">
            <select
              className={input}
              value={managerPersonId}
              onChange={(e) => setManagerPersonId(e.target.value)}
              data-testid="quick-add-manager"
            >
              <option value="">No manager</option>
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.fullName}
                  {manager.title ? ` · ${manager.title}` : ""}
                </option>
              ))}
            </select>
          </FieldWrap>
          <label className="flex items-start gap-2 text-sm text-text-mute">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={runOnboarding}
              onChange={(e) => setRunOnboarding(e.target.checked)}
              data-testid="quick-add-run-onboarding"
            />
            <span>
              Run the onboarding checklist
              <span className="block text-[11px] text-text-faint">
                They’ll start as <span className="font-mono">onboarding</span> with the standard{" "}
                {workerType} sequence; otherwise they’re <span className="font-mono">active</span>{" "}
                immediately.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm text-text-mute">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={createLogin}
              onChange={(e) => setCreateLogin(e.target.checked)}
              data-testid="quick-add-create-login"
            />
            <span>
              Send welcome invitation &amp; create portal login
              <span className="block text-[11px] text-text-faint">
                A one-time activation link lets them choose their own password. Untick for a
                roster-only record with no login.
              </span>
            </span>
          </label>
        </section>
      )}

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft">
        {error && (
          <span
            className="text-warn text-[11px] mr-auto"
            data-testid={isCreate ? "quick-add-error" : "edit-error"}
          >
            {error}
          </span>
        )}
        <button
          onClick={onClose}
          disabled={mutation.isPending || quickAddMutation.isPending || payrollSaving}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-3 py-1"
          data-testid={isCreate ? "quick-add-cancel" : undefined}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={mutation.isPending || quickAddMutation.isPending || payrollSaving}
          className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-3 py-1 rounded disabled:opacity-50"
          data-testid={isCreate ? "quick-add-submit" : "edit-save"}
        >
          {mutation.isPending || quickAddMutation.isPending || payrollSaving
            ? isCreate
              ? "Adding…"
              : "Saving…"
            : isCreate
              ? "Add to roster"
              : "Save changes"}
        </button>
      </div>
    </Card>
  );
}

function FieldWrap({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-mono uppercase tracking-widest text-text-mute">{label}</span>
      {children}
    </label>
  );
}
