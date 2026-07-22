import * as React from "react";
import { Input } from "@/components/ui/input";
import { ReferenceCombobox } from "@/components/ReferenceCombobox";
import { countryDisplayName } from "@/lib/country-uae";

// =============================================================
// Shared HR pickers (Task #509 / T5) — no raw-ID free text.
// Roster endpoints are raw fetch (not openapi codegen).
// =============================================================

const SELECT_CLS =
  "w-full bg-bg-elev border border-line rounded px-2 py-1 text-sm";

export type WorkerType = "employee" | "contractor" | "partner_firm_resource";

// -------------------------------------------------------------
// Country — searchable all-countries dropdown, stores ISO code,
// displays full country name (via the shared ReferenceCombobox).
// -------------------------------------------------------------
export function CountrySelect({
  value,
  onChange,
  placeholder = "Select country…",
  testIdPrefix,
  size = "sm",
  disabled,
}: {
  value: string;
  onChange: (isoCode: string) => void;
  placeholder?: string;
  testIdPrefix?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
}): React.ReactElement {
  return (
    <ReferenceCombobox
      kind="country"
      valueMode="code"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      size={size}
      disabled={disabled}
      testIdPrefix={testIdPrefix}
    />
  );
}

export { countryDisplayName };

// -------------------------------------------------------------
// Titles registry — GET /roster/titles (title → seniority/rank).
// -------------------------------------------------------------
export interface TitleRow {
  id: string;
  title: string;
  seniority: string;
  rank: number;
  workerTypes: string[];
  status: string;
  notes: string | null;
}

let titlesPromise: Promise<TitleRow[]> | null = null;
export function useTitles(): TitleRow[] | null {
  const [rows, setRows] = React.useState<TitleRow[] | null>(null);
  React.useEffect(() => {
    let mounted = true;
    if (!titlesPromise) {
      titlesPromise = fetch("/api/atelier/roster/titles", { credentials: "include" })
        .then((r) => r.json())
        .then((d) => (d.titles ?? []) as TitleRow[])
        .catch(() => [] as TitleRow[]);
    }
    titlesPromise.then((t) => mounted && setRows(t));
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}

export function invalidateTitles(): void {
  titlesPromise = null;
}

/**
 * Title dropdown. Value = the stored title string. Emits the full row so
 * callers can also persist the mapped seniority (kept compatible with rate
 * cards / pricing gates).
 */
export function TitleSelect({
  value,
  onChange,
  workerType,
  testId,
  includeBlank = true,
}: {
  value: string;
  onChange: (title: string, row: TitleRow | null) => void;
  workerType?: WorkerType;
  testId?: string;
  includeBlank?: boolean;
}): React.ReactElement {
  const titles = useTitles();
  const options = React.useMemo(() => {
    const all = titles ?? [];
    if (!workerType) return all;
    return all.filter(
      (t) => !t.workerTypes || t.workerTypes.length === 0 || t.workerTypes.includes(workerType),
    );
  }, [titles, workerType]);
  return (
    <select
      className={SELECT_CLS}
      value={value}
      onChange={(e) => {
        const row = options.find((t) => t.title === e.target.value) ?? null;
        onChange(e.target.value, row);
      }}
      data-testid={testId}
    >
      {includeBlank && <option value="">Select title…</option>}
      {options.map((t) => (
        <option key={t.id} value={t.title}>
          {t.title} · {t.seniority}
        </option>
      ))}
    </select>
  );
}

// -------------------------------------------------------------
// Partner-firm dropdown — GET /roster/partner-firms.
// -------------------------------------------------------------
export interface PartnerFirmRow {
  id: string;
  name: string;
}

export function usePartnerFirms(): PartnerFirmRow[] | null {
  const [rows, setRows] = React.useState<PartnerFirmRow[] | null>(null);
  React.useEffect(() => {
    let mounted = true;
    fetch("/api/atelier/roster/partner-firms", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : { firms: [] }))
      .then((d) => mounted && setRows((d.firms ?? []) as PartnerFirmRow[]))
      .catch(() => mounted && setRows([]));
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}

export function PartnerFirmSelect({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (id: string) => void;
  testId?: string;
}): React.ReactElement {
  const firms = usePartnerFirms();
  return (
    <select
      className={SELECT_CLS}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
    >
      <option value="">Select partner firm…</option>
      {(firms ?? []).map((f) => (
        <option key={f.id} value={f.id}>
          {f.name}
        </option>
      ))}
    </select>
  );
}

// -------------------------------------------------------------
// Employing entity — sourced from firm-profile legal-entities
// register. Selecting autofills office address + country.
// -------------------------------------------------------------
export interface LegalEntity {
  name: string;
  officeAddress?: string;
  country?: string;
  [k: string]: unknown;
}

export function useLegalEntities(): LegalEntity[] | null {
  const [rows, setRows] = React.useState<LegalEntity[] | null>(null);
  React.useEffect(() => {
    let mounted = true;
    fetch("/api/atelier/firm-profile", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!mounted) return;
        const payload =
          (d?.published?.payload as Record<string, unknown> | undefined) ??
          (d?.latestDraft?.payload as Record<string, unknown> | undefined) ??
          {};
        const entities = (payload.legalEntities as LegalEntity[] | undefined) ?? [];
        setRows(entities);
      })
      .catch(() => mounted && setRows([]));
    return () => {
      mounted = false;
    };
  }, []);
  return rows;
}

export function EmployingEntitySelect({
  value,
  onChange,
  onSelectEntity,
  testId,
}: {
  value: string;
  onChange: (name: string) => void;
  onSelectEntity?: (entity: LegalEntity | null) => void;
  testId?: string;
}): React.ReactElement {
  const entities = useLegalEntities();
  return (
    <select
      className={SELECT_CLS}
      value={value}
      onChange={(e) => {
        onChange(e.target.value);
        const ent = (entities ?? []).find((x) => x.name === e.target.value) ?? null;
        onSelectEntity?.(ent);
      }}
      data-testid={testId}
    >
      <option value="">Select employing entity…</option>
      {(entities ?? []).map((ent) => (
        <option key={ent.name} value={ent.name}>
          {ent.name}
        </option>
      ))}
    </select>
  );
}

// -------------------------------------------------------------
// Jurisdiction dropdown (GCC + common jurisdictions).
// -------------------------------------------------------------
export const JURISDICTIONS: Array<{ code: string; label: string }> = [
  { code: "KSA", label: "Saudi Arabia (KSA)" },
  { code: "UAE", label: "United Arab Emirates" },
  { code: "DIFC", label: "DIFC (Dubai)" },
  { code: "ADGM", label: "ADGM (Abu Dhabi)" },
  { code: "QAT", label: "Qatar" },
  { code: "KWT", label: "Kuwait" },
  { code: "BHR", label: "Bahrain" },
  { code: "OMN", label: "Oman" },
  { code: "EGY", label: "Egypt" },
  { code: "GBR", label: "United Kingdom" },
  { code: "USA", label: "United States" },
  { code: "OTHER", label: "Other" },
];

export function JurisdictionSelect({
  value,
  onChange,
  testId,
}: {
  value: string;
  onChange: (v: string) => void;
  testId?: string;
}): React.ReactElement {
  const known = JURISDICTIONS.some((j) => j.code === value);
  return (
    <select
      className={SELECT_CLS}
      value={known ? value : value ? "OTHER" : ""}
      onChange={(e) => onChange(e.target.value)}
      data-testid={testId}
    >
      <option value="">Select jurisdiction…</option>
      {JURISDICTIONS.map((j) => (
        <option key={j.code} value={j.code}>
          {j.label}
        </option>
      ))}
    </select>
  );
}

// -------------------------------------------------------------
// Person picker — searchable roster search (GET /roster/people).
// Replaces raw "Person ID" text inputs.
// -------------------------------------------------------------
export interface PersonPickerRow {
  id: string;
  workerType: WorkerType;
  fullName: string;
  title?: string | null;
  email?: string | null;
}

export function PersonPicker({
  value,
  onChange,
  placeholder = "Search roster…",
  testId,
}: {
  value: string;
  onChange: (personId: string, person: PersonPickerRow | null) => void;
  placeholder?: string;
  testId?: string;
}): React.ReactElement {
  const [query, setQuery] = React.useState("");
  const [rows, setRows] = React.useState<PersonPickerRow[]>([]);
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<PersonPickerRow | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const handle = setTimeout(() => {
      const sp = new URLSearchParams();
      if (query.trim()) sp.set("q", query.trim());
      fetch(`/api/atelier/roster/people?${sp.toString()}`, { credentials: "include" })
        .then((r) => (r.ok ? r.json() : { people: [] }))
        .then((d) => setRows((d.people ?? []) as PersonPickerRow[]))
        .catch(() => setRows([]));
    }, 200);
    return () => clearTimeout(handle);
  }, [query, open]);

  const label = selected
    ? `${selected.fullName}${selected.title ? ` · ${selected.title}` : ""}`
    : value || "";

  return (
    <div className="relative">
      <Input
        value={open ? query : label}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        data-testid={testId}
      />
      {open && rows.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-64 overflow-y-auto bg-bg-elev border border-line rounded shadow-lg">
          {rows.map((p) => (
            <button
              key={p.id}
              type="button"
              className="w-full text-left px-3 py-2 text-sm hover:bg-bg-elevate-2"
              onMouseDown={(e) => {
                e.preventDefault();
                setSelected(p);
                setQuery("");
                setOpen(false);
                onChange(p.id, p);
              }}
              data-testid={testId ? `${testId}-opt-${p.id}` : undefined}
            >
              <div className="font-medium">{p.fullName}</div>
              <div className="text-text-mute text-xs">
                {p.workerType}
                {p.title ? ` · ${p.title}` : ""}
                {p.email ? ` · ${p.email}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
