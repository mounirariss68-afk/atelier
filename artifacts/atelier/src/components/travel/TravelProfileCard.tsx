/**
 * Task #744 — employee travel loyalty programs & preferences.
 *
 * Shared card used by the roster employee profile (HR-edit surface) and
 * the Me self-service profile. Renders frequent-flyer + hotel loyalty
 * programs and a travel-preferences form; the parent supplies the save
 * transport (roster PATCH vs /me/travel PUT).
 *
 * Membership numbers may arrive masked (••••123) for viewers without
 * the sensitive-people gate — the card renders whatever the API gave it
 * and warns editors that saving with masked values would persist them.
 */
import * as React from "react";
import { Card, MonoChip } from "@/components/ui/primitives";

export interface TravelAirlineProgram {
  airlineIata: string;
  programName: string;
  membershipNumber: string;
  tier?: string | null;
}
export interface TravelHotelProgram {
  chainCode: string;
  programName: string;
  membershipNumber: string;
  tier?: string | null;
}
export interface TravelPreferences {
  preferredAirlines?: string[];
  preferredHotelChains?: string[];
  cabinClass?: string | null;
  seatPreference?: string | null;
  mealPreference?: string | null;
  departureTimeWindow?: string | null;
  arrivalTimeWindow?: string | null;
  notes?: string | null;
}
export interface TravelProfileValue {
  airlinePrograms?: TravelAirlineProgram[];
  hotelPrograms?: TravelHotelProgram[];
  preferences?: TravelPreferences;
}

const CABINS = ["", "economy", "premium_economy", "business", "first"];
const SEATS = ["", "aisle", "window", "middle", "no_preference"];

function nice(s: string | null | undefined): string {
  return s ? s.replace(/_/g, " ") : "—";
}

const isMasked = (n: string) => n.includes("••••") || n.includes("(restricted)");

export function TravelProfileCard({
  value,
  canEdit,
  onSave,
  testIdPrefix = "travel",
}: {
  value: TravelProfileValue | null | undefined;
  canEdit: boolean;
  onSave: (next: TravelProfileValue) => Promise<{ ok: boolean; error?: string }>;
  testIdPrefix?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<TravelProfileValue>({});

  const v: TravelProfileValue = value ?? {};
  const air = v.airlinePrograms ?? [];
  const hotel = v.hotelPrograms ?? [];
  const p = v.preferences ?? {};
  const anyMasked =
    air.some((a) => isMasked(a.membershipNumber)) ||
    hotel.some((h) => isMasked(h.membershipNumber));

  const beginEdit = () => {
    setDraft({
      airlinePrograms: air.map((a) => ({ ...a })),
      hotelPrograms: hotel.map((h) => ({ ...h })),
      preferences: {
        preferredAirlines: [...(p.preferredAirlines ?? [])],
        preferredHotelChains: [...(p.preferredHotelChains ?? [])],
        cabinClass: p.cabinClass ?? null,
        seatPreference: p.seatPreference ?? null,
        mealPreference: p.mealPreference ?? null,
        departureTimeWindow: p.departureTimeWindow ?? null,
        arrivalTimeWindow: p.arrivalTimeWindow ?? null,
        notes: p.notes ?? null,
      },
    });
    setError(null);
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const clean: TravelProfileValue = {
      airlinePrograms: (draft.airlinePrograms ?? []).filter(
        (a) => a.airlineIata.trim() && a.programName.trim() && a.membershipNumber.trim(),
      ),
      hotelPrograms: (draft.hotelPrograms ?? []).filter(
        (h) => h.chainCode.trim() && h.programName.trim() && h.membershipNumber.trim(),
      ),
      preferences: draft.preferences,
    };
    const r = await onSave(clean);
    setSaving(false);
    if (r.ok) setEditing(false);
    else setError(r.error ?? "Save failed.");
  };

  if (!editing) {
    return (
      <Card className="p-4 space-y-3 md:col-span-2" data-testid={`${testIdPrefix}-card`}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-mono text-xs uppercase text-text-mute flex items-center gap-2">
            Travel — loyalty & preferences
            {anyMasked && (
              <MonoChip className="text-warning border-warning/40">
                membership numbers restricted
              </MonoChip>
            )}
          </h3>
          {canEdit && (
            <button
              onClick={beginEdit}
              className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
              data-testid={`${testIdPrefix}-edit`}
            >
              Edit travel
            </button>
          )}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
              Frequent flyer programs
            </p>
            {air.length === 0 && <p className="text-sm text-text-mute">None recorded.</p>}
            {air.map((a, i) => (
              <p key={i} className="text-sm text-text" data-testid={`${testIdPrefix}-air-${i}`}>
                <span className="font-mono text-xs text-gold mr-1">{a.airlineIata}</span>
                {a.programName} · <span className="font-mono">{a.membershipNumber}</span>
                {a.tier ? <span className="text-text-mute"> · {a.tier}</span> : null}
              </p>
            ))}
          </div>
          <div className="space-y-1">
            <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">
              Hotel loyalty programs
            </p>
            {hotel.length === 0 && <p className="text-sm text-text-mute">None recorded.</p>}
            {hotel.map((h, i) => (
              <p key={i} className="text-sm text-text" data-testid={`${testIdPrefix}-hotel-${i}`}>
                <span className="font-mono text-xs text-gold mr-1">{h.chainCode}</span>
                {h.programName} · <span className="font-mono">{h.membershipNumber}</span>
                {h.tier ? <span className="text-text-mute"> · {h.tier}</span> : null}
              </p>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-border-soft">
          <MiniField label="Preferred airlines" value={(p.preferredAirlines ?? []).join(", ") || null} />
          <MiniField label="Preferred hotel chains" value={(p.preferredHotelChains ?? []).join(", ") || null} />
          <MiniField label="Cabin" value={p.cabinClass ? nice(p.cabinClass) : null} />
          <MiniField label="Seat" value={p.seatPreference ? nice(p.seatPreference) : null} />
          <MiniField label="Meal" value={p.mealPreference ?? null} />
          <MiniField label="Departure window" value={p.departureTimeWindow ?? null} />
          <MiniField label="Arrival window" value={p.arrivalTimeWindow ?? null} />
          <MiniField label="Notes" value={p.notes ?? null} />
        </div>
      </Card>
    );
  }

  const dAir = draft.airlinePrograms ?? [];
  const dHotel = draft.hotelPrograms ?? [];
  const dp = draft.preferences ?? {};
  const setPref = (patch: Partial<TravelPreferences>) =>
    setDraft((d) => ({ ...d, preferences: { ...(d.preferences ?? {}), ...patch } }));

  return (
    <Card className="p-4 space-y-4 md:col-span-2" data-testid={`${testIdPrefix}-editor`}>
      <h3 className="font-mono text-xs uppercase text-text-mute">
        Travel — loyalty & preferences (editing)
      </h3>
      {anyMasked && (
        <p className="text-[11px] text-warning">
          Some membership numbers are masked for your role — leave those rows untouched or
          re-enter the full number before saving.
        </p>
      )}
      <ProgramTable
        title="Frequent flyer programs"
        codeLabel="Airline IATA (2 chars)"
        codeMax={2}
        rows={dAir.map((a) => ({ code: a.airlineIata, name: a.programName, number: a.membershipNumber, tier: a.tier ?? "" }))}
        onChange={(rows) =>
          setDraft((d) => ({
            ...d,
            airlinePrograms: rows.map((r) => ({
              airlineIata: r.code.toUpperCase(),
              programName: r.name,
              membershipNumber: r.number,
              tier: r.tier.trim() ? r.tier : null,
            })),
          }))
        }
        testIdPrefix={`${testIdPrefix}-edit-air`}
      />
      <ProgramTable
        title="Hotel loyalty programs"
        codeLabel="Chain code (2-3 chars)"
        codeMax={3}
        rows={dHotel.map((h) => ({ code: h.chainCode, name: h.programName, number: h.membershipNumber, tier: h.tier ?? "" }))}
        onChange={(rows) =>
          setDraft((d) => ({
            ...d,
            hotelPrograms: rows.map((r) => ({
              chainCode: r.code.toUpperCase(),
              programName: r.name,
              membershipNumber: r.number,
              tier: r.tier.trim() ? r.tier : null,
            })),
          }))
        }
        testIdPrefix={`${testIdPrefix}-edit-hotel`}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <LabeledInput
          label="Preferred airlines (comma-separated names or IATA codes)"
          value={(dp.preferredAirlines ?? []).join(", ")}
          onChange={(s) =>
            setPref({ preferredAirlines: s.split(",").map((x) => x.trim()).filter(Boolean) })
          }
          testId={`${testIdPrefix}-pref-airlines`}
        />
        <LabeledInput
          label="Preferred hotel chains / brands (comma-separated)"
          value={(dp.preferredHotelChains ?? []).join(", ")}
          onChange={(s) =>
            setPref({ preferredHotelChains: s.split(",").map((x) => x.trim()).filter(Boolean) })
          }
          testId={`${testIdPrefix}-pref-hotels`}
        />
        <label className="text-sm space-y-1">
          <span className="text-text-mute text-xs">Cabin class</span>
          <select
            value={dp.cabinClass ?? ""}
            onChange={(e) => setPref({ cabinClass: e.target.value || null })}
            className="w-full bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm"
            data-testid={`${testIdPrefix}-pref-cabin`}
          >
            {CABINS.map((c) => (
              <option key={c} value={c}>{c ? nice(c) : "no preference"}</option>
            ))}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-text-mute text-xs">Seat preference</span>
          <select
            value={dp.seatPreference ?? ""}
            onChange={(e) => setPref({ seatPreference: e.target.value || null })}
            className="w-full bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm"
            data-testid={`${testIdPrefix}-pref-seat`}
          >
            {SEATS.map((s) => (
              <option key={s} value={s}>{s ? nice(s) : "no preference"}</option>
            ))}
          </select>
        </label>
        <LabeledInput
          label="Meal preference"
          value={dp.mealPreference ?? ""}
          onChange={(s) => setPref({ mealPreference: s.trim() ? s : null })}
          testId={`${testIdPrefix}-pref-meal`}
        />
        <LabeledInput
          label="Preferred departure window (e.g. 08:00–12:00)"
          value={dp.departureTimeWindow ?? ""}
          onChange={(s) => setPref({ departureTimeWindow: s.trim() ? s : null })}
          testId={`${testIdPrefix}-pref-dep`}
        />
        <LabeledInput
          label="Preferred arrival window"
          value={dp.arrivalTimeWindow ?? ""}
          onChange={(s) => setPref({ arrivalTimeWindow: s.trim() ? s : null })}
          testId={`${testIdPrefix}-pref-arr`}
        />
        <LabeledInput
          label="Other notes (visas, airports to avoid, etc.)"
          value={dp.notes ?? ""}
          onChange={(s) => setPref({ notes: s.trim() ? s : null })}
          testId={`${testIdPrefix}-pref-notes`}
        />
      </div>
      <div className="flex items-center justify-end gap-2">
        {error && <span className="text-warning text-[11px] mr-auto">{error}</span>}
        <button
          onClick={() => setEditing(false)}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-text px-2 py-1"
          data-testid={`${testIdPrefix}-cancel`}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="text-[10px] font-mono uppercase tracking-widest bg-gold text-bg px-3 py-1 rounded disabled:opacity-50"
          data-testid={`${testIdPrefix}-save`}
        >
          {saving ? "Saving…" : "Save travel profile"}
        </button>
      </div>
    </Card>
  );
}

function MiniField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{label}</p>
      <p className="text-sm text-text">{value ?? "—"}</p>
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  testId: string;
}) {
  return (
    <label className="text-sm space-y-1">
      <span className="text-text-mute text-xs">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm"
        data-testid={testId}
      />
    </label>
  );
}

function ProgramTable({
  title,
  codeLabel,
  codeMax,
  rows,
  onChange,
  testIdPrefix,
}: {
  title: string;
  codeLabel: string;
  codeMax: number;
  rows: Array<{ code: string; name: string; number: string; tier: string }>;
  onChange: (rows: Array<{ code: string; name: string; number: string; tier: string }>) => void;
  testIdPrefix: string;
}) {
  const upd = (i: number, patch: Partial<{ code: string; name: string; number: string; tier: string }>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-mono uppercase tracking-widest text-text-faint">{title}</p>
        <button
          onClick={() => onChange([...rows, { code: "", name: "", number: "", tier: "" }])}
          className="text-[10px] font-mono uppercase tracking-widest text-text-faint hover:text-gold"
          data-testid={`${testIdPrefix}-add`}
        >
          + Add program
        </button>
      </div>
      {rows.length === 0 && <p className="text-xs text-text-mute">None.</p>}
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[5rem_1fr_1fr_6rem_auto] gap-2 items-center">
          <input
            value={r.code}
            maxLength={codeMax}
            placeholder={codeLabel}
            onChange={(e) => upd(i, { code: e.target.value })}
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm font-mono uppercase"
            data-testid={`${testIdPrefix}-code-${i}`}
          />
          <input
            value={r.name}
            placeholder="Program name"
            onChange={(e) => upd(i, { name: e.target.value })}
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm"
            data-testid={`${testIdPrefix}-name-${i}`}
          />
          <input
            value={r.number}
            placeholder="Membership number"
            onChange={(e) => upd(i, { number: e.target.value })}
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm font-mono"
            data-testid={`${testIdPrefix}-number-${i}`}
          />
          <input
            value={r.tier}
            placeholder="Tier"
            onChange={(e) => upd(i, { tier: e.target.value })}
            className="bg-bg-elevate border border-border-soft rounded px-2 py-1 text-text text-sm"
            data-testid={`${testIdPrefix}-tier-${i}`}
          />
          <button
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
            className="text-[10px] font-mono uppercase text-text-faint hover:text-warning"
            data-testid={`${testIdPrefix}-remove-${i}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
