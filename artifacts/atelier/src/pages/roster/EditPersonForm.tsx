import * as React from "react";
import { useAtelierUpdateRosterPerson } from "@workspace/api-client-react";
import type { AtelierRosterPersonEdit } from "@workspace/api-client-react";
import { Card, MonoChip } from "@/components/ui/primitives";
// Task #509 (T4) — shared country picker + titles registry + legal-entity register.
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
  employingEntity: string;
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

interface LegalEntityRow {
  name: string;
  jurisdiction?: string | null;
  officeAddress?: string | null;
  country?: string | null;
}

// Best-effort split of a legacy full name when structured fields are absent.
function splitLegacy(fullName: string | null | undefined): { first: string; middle: string; last: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: "", middle: "", last: "" };
  if (parts.length === 1) return { first: parts[0], middle: "", last: "" };
  return { first: parts[0], middle: parts.slice(1, -1).join(" "), last: parts[parts.length - 1] };
}

function draftFrom(p: EditablePerson, personalEmail: string | null): Draft {
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
    employingEntity: p.employingEntity ?? "",
    contractType: p.contractType ?? "",
    vendorEntity: p.vendorEntity ?? "",
    partnerFirmId: p.partnerFirmId ?? "",
    startDate: p.startDate ?? "",
    endDate: p.endDate ?? "",
    noticePeriodDays:
      p.noticePeriodDays != null ? String(p.noticePeriodDays) : "",
    nationality: p.nationality ?? "",
    gender: p.gender ?? "unspecified",
    cellPhones: (p.cellPhones ?? []).map((c) => ({ ...c })),
    officeAddress: p.officeAddress ?? "",
  };
}

export function EditPersonForm({
  person,
  viewerCanEditTitle,
  viewerCanSeeComp = false,
  onSaved,
  onClose,
}: {
  person: EditablePerson;
  viewerCanEditTitle: boolean;
  viewerCanSeeComp?: boolean;
  onSaved: (updated: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const isEmployee = person.workerType === "employee";
  const isContractor = person.workerType === "contractor";
  const isPfr = person.workerType === "partner_firm_resource";

  // personalEmail lives outside the person wire — prefill from the
  // personal-data view (editors are all personnel-contract viewers).
  const [personalEmail0, setPersonalEmail0] = React.useState<string | null>(null);
  const [personalLoaded, setPersonalLoaded] = React.useState(isPfr);
  const [firms, setFirms] = React.useState<Array<{ id: string; name: string }>>([]);
  const [legalEntities, setLegalEntities] = React.useState<LegalEntityRow[]>([]);
  const [draft, setDraft] = React.useState<Draft>(() => draftFrom(person, null));
  const [error, setError] = React.useState<string | null>(null);
  const mutation = useAtelierUpdateRosterPerson();
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
    if (!isPfr) {
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
    if (isEmployee) {
      // Task #509 (T4) — employing-entity picker sourced from the firm's
      // legal-entity register (carries office address + country per entity).
      fetch(`/api/atelier/firm-profile`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (!alive || !d) return;
          // Firm-profile wire shape is { published, latestDraft, canPublish };
          // the register lives under <version>.payload.legalEntities.
          const payload =
            (d?.published?.payload as Record<string, unknown> | undefined) ??
            (d?.latestDraft?.payload as Record<string, unknown> | undefined) ??
            {};
          const entities = (payload.legalEntities ?? []) as LegalEntityRow[];
          setLegalEntities(entities);
        })
        .catch(() => undefined);
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person.id]);

  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const buildPatch = (): AtelierRosterPersonEdit | { error: string } => {
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
      diffStr("employingEntity", "employingEntity", true);
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

  const save = async () => {
    setError(null);
    const patch = buildPatch();
    if ("error" in patch && typeof patch.error === "string" && Object.keys(patch).length === 1) {
      setError(patch.error);
      return;
    }
    const body = patch as AtelierRosterPersonEdit;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    try {
      const resp = await mutation.mutateAsync({ id: person.id, data: body });
      onSaved(resp.person as Record<string, unknown>);
      onClose();
    } catch (e: unknown) {
      const status = (e as { status?: number })?.status;
      if (status === 403) setError("You are not authorized to edit this person.");
      else if (status === 409) setError("That work email is already in use by someone else.");
      else if (status === 422) setError("Some fields are invalid — please check the values.");
      else setError("Save failed. Please try again.");
    }
  };

  const input =
    "bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-xs w-full";
  const label = "text-[10px] font-mono uppercase tracking-widest text-text-mute";

  return (
    <Card className="p-4 space-y-4" data-testid="edit-person-form">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-mono text-xs uppercase text-text-mute">
          Edit person · {person.fullName}
        </h3>
        <MonoChip>pay &amp; bank fields stay locked to finance flows</MonoChip>
      </div>

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
          {!isPfr && (
            <FieldWrap label={`Personal email${personalLoaded ? "" : " (loading…)"}`}>
              <input className={input} value={draft.personalEmail} maxLength={320} type="email"
                disabled={!personalLoaded}
                onChange={(e) => set({ personalEmail: e.target.value })} data-testid="edit-personalemail" />
            </FieldWrap>
          )}
          {isEmployee && viewerCanEditTitle && (
            <FieldWrap label="Job title (HR / Founding Partner only)">
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
              <FieldWrap label="Employment type">
                <select className={input} value={draft.employmentType}
                  onChange={(e) => set({ employmentType: e.target.value })} data-testid="edit-employmenttype">
                  <option value="FTE">FTE</option>
                  <option value="fixed_term">fixed term</option>
                  <option value="intern">intern</option>
                </select>
              </FieldWrap>
              <FieldWrap label="Employment status">
                <select className={input} value={draft.employmentStatus}
                  onChange={(e) => set({ employmentStatus: e.target.value })} data-testid="edit-employmentstatus">
                  <option value="active">active</option>
                  <option value="notice">notice</option>
                  <option value="on_leave">on leave</option>
                  <option value="terminated">terminated</option>
                </select>
              </FieldWrap>
              <FieldWrap label="Employing entity">
                {legalEntities.length > 0 ? (
                  <select className={input} value={draft.employingEntity} data-testid="edit-employingentity"
                    onChange={(e) => {
                      const name = e.target.value;
                      const ent = legalEntities.find((le) => le.name === name);
                      const patch: Partial<Draft> = { employingEntity: name };
                      // Autofill office address + country from the register;
                      // both remain editable below (country is overridable).
                      if (ent?.officeAddress && !draft.officeAddress.trim()) patch.officeAddress = ent.officeAddress;
                      if (ent?.country) {
                        const iso = countryCode(ent.country) ?? ent.country;
                        if (!draft.country.trim()) patch.country = iso;
                      }
                      set(patch);
                    }}>
                    <option value="">—</option>
                    {legalEntities.some((le) => le.name === draft.employingEntity) || !draft.employingEntity ? null : (
                      <option value={draft.employingEntity}>{draft.employingEntity}</option>
                    )}
                    {legalEntities.map((le) => (
                      <option key={le.name} value={le.name}>
                        {le.name}{le.jurisdiction ? ` (${le.jurisdiction})` : ""}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input className={input} value={draft.employingEntity} maxLength={120}
                    placeholder="DIFC / ADGM / KSA / Other"
                    onChange={(e) => set({ employingEntity: e.target.value })} data-testid="edit-employingentity" />
                )}
              </FieldWrap>
              <FieldWrap label="Home office">
                <input className={input} value={draft.homeOffice} maxLength={120}
                  onChange={(e) => set({ homeOffice: e.target.value })} data-testid="edit-homeoffice" />
              </FieldWrap>
              <FieldWrap label="Notice period (days)">
                <input className={input} value={draft.noticePeriodDays} inputMode="numeric"
                  onChange={(e) => set({ noticePeriodDays: e.target.value })} data-testid="edit-noticeperiod" />
              </FieldWrap>
            </>
          )}
          {isContractor && (
            <>
              <FieldWrap label="Vendor entity">
                <input className={input} value={draft.vendorEntity} maxLength={200}
                  onChange={(e) => set({ vendorEntity: e.target.value })} data-testid="edit-vendorentity" />
              </FieldWrap>
              <FieldWrap label="Contract type">
                <select className={input} value={draft.contractType}
                  onChange={(e) => set({ contractType: e.target.value })} data-testid="edit-contracttype">
                  <option value="">—</option>
                  <option value="T&M">T&amp;M</option>
                  <option value="fixed_fee">fixed fee</option>
                  <option value="retainer">retainer</option>
                </select>
              </FieldWrap>
            </>
          )}
          {isPfr && (
            <FieldWrap label="Partner firm">
              <select className={input} value={draft.partnerFirmId}
                onChange={(e) => set({ partnerFirmId: e.target.value })} data-testid="edit-partnerfirm">
                {firms.length === 0 && draft.partnerFirmId && (
                  <option value={draft.partnerFirmId}>{person.partnerFirmName ?? draft.partnerFirmId}</option>
                )}
                {firms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            </FieldWrap>
          )}
          <FieldWrap label="Start date (correction only)">
            <input className={input} type="date" value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })} data-testid="edit-startdate" />
          </FieldWrap>
          <FieldWrap label="End date (correction only)">
            <input className={input} type="date" value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })} data-testid="edit-enddate" />
          </FieldWrap>
        </div>
      </section>

      {/* Contact */}
      {!isPfr && (
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

      {/* Compensation & banking — mirrors the profile card for comp-cleared
          viewers. These fields are deliberately read-only here: bank details
          change only via the HR-approved bank-change flow, and pay data via
          the finance flows. */}
      {viewerCanSeeComp && (
        <section className="space-y-2" data-testid="edit-comp-section">
          <div className={label}>Compensation &amp; banking (read-only)</div>
          <div className="grid gap-3 md:grid-cols-2">
            <FieldWrap label="Payroll country">
              <input className={input} value={countryName(person.payrollCountry) ?? person.payrollCountry ?? ""} disabled readOnly data-testid="edit-payrollcountry-ro" />
            </FieldWrap>
            <FieldWrap label="Day rate">
              <input
                className={input}
                value={
                  person.dayRateAmount != null
                    ? `${(person.dayRateAmount / 100).toLocaleString()} ${person.dayRateCurrency ?? ""}`
                    : ""
                }
                disabled readOnly data-testid="edit-dayrate-ro"
              />
            </FieldWrap>
            <FieldWrap label="IBAN">
              <input className={input} value={person.iban ?? ""} disabled readOnly data-testid="edit-iban-ro" />
            </FieldWrap>
            <FieldWrap label="SWIFT">
              <input className={input} value={person.swift ?? ""} disabled readOnly data-testid="edit-swift-ro" />
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
          <FieldWrap label="Nationality">
            <CountryCombobox value={draft.nationality} allowClear testIdPrefix="edit-nationality"
              onChange={(iso) => set({ nationality: iso })} />
          </FieldWrap>
          <FieldWrap label="Gender (self-identified)">
            <select className={input} value={draft.gender}
              onChange={(e) => set({ gender: e.target.value })} data-testid="edit-gender">
              <option value="unspecified">unspecified</option>
              <option value="female">female</option>
              <option value="male">male</option>
            </select>
          </FieldWrap>
        </div>
      </section>

      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border-soft">
        {error && (
          <span className="text-warn text-[11px] mr-auto" data-testid="edit-error">{error}</span>
        )}
        <button
          onClick={onClose}
          disabled={mutation.isPending}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-3 py-1">
          Cancel
        </button>
        <button
          onClick={save}
          disabled={mutation.isPending}
          className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-3 py-1 rounded disabled:opacity-50"
          data-testid="edit-save">
          {mutation.isPending ? "Saving…" : "Save changes"}
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
