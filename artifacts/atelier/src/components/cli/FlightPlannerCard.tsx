/**
 * Task #745 — guided flight planner card (web).
 *
 * Rendered in place of the generic clarification inputs when a
 * clarification field carries `inputType: "flight_planner"` and a
 * `planner` prefill. Emirates-style trip planner with Return / One-way
 * / Multi-city tabs, big FROM/TO blocks + swap, travel dates, and a
 * passengers & cabin row. On confirm it submits through the existing
 * clarification path with `values = { [field]: JSON.stringify(plan) }`
 * and a human-readable answer text.
 */

import * as React from "react";
import { ArrowLeftRight, Plus, X, Minus, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  CliFlightPlanner,
  CliLocale,
  CliPlannerSegment,
  CliPlannerTripType,
} from "./types";
import { s } from "./locale";

const CABIN_OPTIONS: Array<{ value: string; key: Parameters<typeof s>[0] }> = [
  { value: "economy", key: "plannerCabinEconomy" },
  { value: "premium_economy", key: "plannerCabinPremiumEconomy" },
  { value: "business", key: "plannerCabinBusiness" },
  { value: "first", key: "plannerCabinFirst" },
];

function cabinLabel(value: string, locale: CliLocale): string {
  const opt = CABIN_OPTIONS.find((o) => o.value === value);
  return opt ? s(opt.key, locale) : value;
}

function emptyAirport() {
  return { text: "", iata: null as string | null, label: null as string | null };
}

function emptySegment(): CliPlannerSegment {
  return { origin: emptyAirport(), destination: emptyAirport(), date: "" };
}

function segmentValid(seg: CliPlannerSegment): boolean {
  return (
    seg.origin.text.trim().length > 0 &&
    seg.destination.text.trim().length > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(seg.date.trim())
  );
}

/** Big airport code / text used on the FROM/TO blocks. */
function airportCode(text: string, iata?: string | null): string {
  if (iata && iata.trim()) return iata.trim().toUpperCase();
  const t = text.trim();
  if (/^[A-Za-z]{3}$/.test(t)) return t.toUpperCase();
  return t;
}

export function FlightPlannerCard({
  planner,
  locale,
  onConfirm,
}: {
  planner: CliFlightPlanner;
  locale: CliLocale;
  /** Submits the finished plan. */
  onConfirm: (answerText: string, plan: CliFlightPlanner) => void;
}) {
  const initialTrip: CliPlannerTripType = planner.tripType ?? "return";
  const [tripType, setTripType] = React.useState<CliPlannerTripType>(initialTrip);
  const [segments, setSegments] = React.useState<CliPlannerSegment[]>(() => {
    const src = Array.isArray(planner.segments) && planner.segments.length > 0
      ? planner.segments.map((sg) => ({
          origin: { ...emptyAirport(), ...(sg.origin ?? {}) },
          destination: { ...emptyAirport(), ...(sg.destination ?? {}) },
          date: sg.date ?? "",
        }))
      : [emptySegment()];
    return src;
  });
  const [returnDate, setReturnDate] = React.useState<string>(() => {
    // For a return prefill the 2nd segment carries the return date.
    if (initialTrip === "return" && planner.segments?.[1]?.date) {
      return planner.segments[1].date;
    }
    return "";
  });
  const [adults, setAdults] = React.useState<number>(
    Math.min(9, Math.max(1, Math.round(planner.adults ?? 1))),
  );
  const [cabinClass, setCabinClass] = React.useState<string>(
    planner.cabinClass || "economy",
  );

  // The primary FROM/TO pair (used by return + one-way).
  const primary = segments[0] ?? emptySegment();

  function updatePrimary(next: CliPlannerSegment) {
    setSegments((prev) => {
      const copy = prev.slice();
      copy[0] = next;
      return copy;
    });
  }

  function setPrimaryOriginText(text: string) {
    updatePrimary({
      ...primary,
      origin: { text, iata: null, label: null },
    });
  }
  function setPrimaryDestText(text: string) {
    updatePrimary({
      ...primary,
      destination: { text, iata: null, label: null },
    });
  }
  function setPrimaryDate(date: string) {
    updatePrimary({ ...primary, date });
  }
  function swapPrimary() {
    updatePrimary({
      ...primary,
      origin: primary.destination,
      destination: primary.origin,
    });
  }

  function switchTrip(next: CliPlannerTripType) {
    setTripType(next);
    if (next !== "multi_city") {
      // Collapse to a single primary pair.
      setSegments((prev) => [prev[0] ?? emptySegment()]);
    } else {
      // Ensure at least 2 legs for multi-city.
      setSegments((prev) => (prev.length >= 2 ? prev : [prev[0] ?? emptySegment(), emptySegment()]));
    }
  }

  // Multi-city segment editing.
  function updateSeg(index: number, patch: Partial<CliPlannerSegment>) {
    setSegments((prev) => {
      const copy = prev.slice();
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  }
  function updateSegAirport(
    index: number,
    which: "origin" | "destination",
    text: string,
  ) {
    updateSeg(index, { [which]: { text, iata: null, label: null } } as Partial<CliPlannerSegment>);
  }
  function swapSeg(index: number) {
    setSegments((prev) => {
      const copy = prev.slice();
      const seg = copy[index];
      copy[index] = { ...seg, origin: seg.destination, destination: seg.origin };
      return copy;
    });
  }
  function addLeg() {
    setSegments((prev) => (prev.length >= 8 ? prev : [...prev, emptySegment()]));
  }
  function removeLeg(index: number) {
    setSegments((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  // Build the final plan + validation depending on trip type.
  function buildPlan(): CliFlightPlanner {
    if (tripType === "return") {
      const back: CliPlannerSegment = {
        origin: primary.destination,
        destination: primary.origin,
        date: returnDate,
      };
      return { tripType, segments: [primary, back], adults, cabinClass };
    }
    if (tripType === "one_way") {
      return { tripType, segments: [primary], adults, cabinClass };
    }
    return { tripType, segments, adults, cabinClass };
  }

  const isValid = (() => {
    if (tripType === "return") {
      return segmentValid(primary) && /^\d{4}-\d{2}-\d{2}$/.test(returnDate.trim());
    }
    if (tripType === "one_way") {
      return segmentValid(primary);
    }
    return segments.length > 0 && segments.every(segmentValid);
  })();

  function humanAnswer(plan: CliFlightPlanner): string {
    const tt =
      plan.tripType === "return"
        ? s("plannerReturn", locale)
        : plan.tripType === "one_way"
          ? s("plannerOneWay", locale)
          : s("plannerMultiCity", locale);
    const legLabel = (seg: CliPlannerSegment) => {
      const o = airportCode(seg.origin.text, seg.origin.iata);
      const d = airportCode(seg.destination.text, seg.destination.iata);
      return `${o} → ${d}`;
    };
    let route: string;
    let dates: string;
    if (plan.tripType === "return") {
      route = legLabel(plan.segments[0]);
      dates = `${plan.segments[0].date} / ${plan.segments[1]?.date ?? ""}`;
    } else if (plan.tripType === "one_way") {
      route = legLabel(plan.segments[0]);
      dates = plan.segments[0].date;
    } else {
      route = plan.segments.map(legLabel).join(", ");
      dates = plan.segments.map((sg) => sg.date).join(" / ");
    }
    const paxWord =
      plan.adults === 1
        ? s("plannerPassengersCount", locale).replace("{n}", "1")
        : s("plannerPassengersCountPlural", locale).replace("{n}", String(plan.adults));
    return `${tt} ${route} · ${dates} · ${paxWord} · ${cabinLabel(plan.cabinClass, locale)}`;
  }

  function confirm() {
    const plan = buildPlan();
    if (!isValid) return;
    onConfirm(humanAnswer(plan), plan);
  }

  const tabBtn = (
    tt: CliPlannerTripType,
    labelKey: Parameters<typeof s>[0],
    testid: string,
  ) => (
    <button
      type="button"
      onClick={() => switchTrip(tt)}
      className={cn(
        "px-3 py-1.5 text-xs rounded-full border transition-colors",
        tripType === tt
          ? "bg-gold text-bg-deep border-gold font-semibold"
          : "bg-bg-deep border-border-soft text-text-mute hover:border-gold/50",
      )}
      data-testid={testid}
      aria-pressed={tripType === tt}
    >
      {s(labelKey, locale)}
    </button>
  );

  return (
    <div
      className="bg-bg-elevate border border-gold/40 rounded-lg p-3 space-y-3"
      data-testid="flight-planner-card"
    >
      {/* Trip-type tabs */}
      <div className="flex flex-wrap gap-1.5" role="tablist">
        {tabBtn("return", "plannerReturn", "planner-tab-return")}
        {tabBtn("one_way", "plannerOneWay", "planner-tab-oneway")}
        {tabBtn("multi_city", "plannerMultiCity", "planner-tab-multicity")}
      </div>

      {tripType !== "multi_city" ? (
        <>
          {/* FROM / TO blocks with swap */}
          <div className="flex items-stretch gap-2">
            <AirportBlock
              label={s("plannerFrom", locale)}
              code={airportCode(primary.origin.text, primary.origin.iata)}
              sublabel={primary.origin.label ?? undefined}
              value={primary.origin.text}
              onChange={setPrimaryOriginText}
              testid="planner-from"
            />
            <button
              type="button"
              onClick={swapPrimary}
              className="self-center shrink-0 rounded-full border border-border-soft bg-bg-deep p-1.5 text-text-mute hover:text-gold hover:border-gold/50 transition-colors"
              title={s("plannerSwap", locale)}
              aria-label={s("plannerSwap", locale)}
              data-testid="planner-swap"
            >
              <ArrowLeftRight className="w-3.5 h-3.5" />
            </button>
            <AirportBlock
              label={s("plannerTo", locale)}
              code={airportCode(primary.destination.text, primary.destination.iata)}
              sublabel={primary.destination.label ?? undefined}
              value={primary.destination.text}
              onChange={setPrimaryDestText}
              testid="planner-to"
            />
          </div>

          {/* Dates */}
          <div className="flex flex-wrap gap-2">
            <DateField
              label={s("plannerDepartDate", locale)}
              value={primary.date}
              onChange={setPrimaryDate}
              testid="planner-date"
            />
            {tripType === "return" && (
              <DateField
                label={s("plannerReturnDate", locale)}
                value={returnDate}
                onChange={setReturnDate}
                testid="planner-return-date"
              />
            )}
          </div>
        </>
      ) : (
        <div className="space-y-2">
          {segments.map((seg, i) => (
            <div
              key={i}
              className="bg-bg-deep border border-border-soft rounded-md p-2 space-y-2"
              data-testid="planner-leg"
            >
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
                  {s("plannerLeg", locale).replace("{n}", String(i + 1))}
                </span>
                {segments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLeg(i)}
                    className="inline-flex items-center gap-1 text-[10px] text-text-mute hover:text-danger"
                    data-testid="planner-remove-leg"
                  >
                    <X className="w-3 h-3" />
                    {s("plannerRemoveLeg", locale)}
                  </button>
                )}
              </div>
              <div className="flex items-stretch gap-2">
                <AirportBlock
                  label={s("plannerFrom", locale)}
                  code={airportCode(seg.origin.text, seg.origin.iata)}
                  value={seg.origin.text}
                  onChange={(t) => updateSegAirport(i, "origin", t)}
                  testid={i === 0 ? "planner-from" : undefined}
                />
                <button
                  type="button"
                  onClick={() => swapSeg(i)}
                  className="self-center shrink-0 rounded-full border border-border-soft bg-bg-elevate p-1.5 text-text-mute hover:text-gold hover:border-gold/50 transition-colors"
                  title={s("plannerSwap", locale)}
                  aria-label={s("plannerSwap", locale)}
                  data-testid={i === 0 ? "planner-swap" : undefined}
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>
                <AirportBlock
                  label={s("plannerTo", locale)}
                  code={airportCode(seg.destination.text, seg.destination.iata)}
                  value={seg.destination.text}
                  onChange={(t) => updateSegAirport(i, "destination", t)}
                  testid={i === 0 ? "planner-to" : undefined}
                />
              </div>
              <DateField
                label={s("plannerDate", locale)}
                value={seg.date}
                onChange={(d) => updateSeg(i, { date: d })}
                testid={i === 0 ? "planner-date" : undefined}
              />
            </div>
          ))}
          {segments.length < 8 && (
            <button
              type="button"
              onClick={addLeg}
              className="inline-flex items-center gap-1.5 text-xs text-gold hover:underline"
              data-testid="planner-add-leg"
            >
              <Plus className="w-3.5 h-3.5" />
              {s("plannerAddLeg", locale)}
            </button>
          )}
        </div>
      )}

      {/* Passengers + cabin */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {s("plannerAdults", locale)}
          </div>
          <div
            className="inline-flex items-center gap-2 bg-bg-deep border border-border-soft rounded-md px-2 py-1"
            data-testid="planner-adults"
          >
            <button
              type="button"
              onClick={() => setAdults((a) => Math.max(1, a - 1))}
              disabled={adults <= 1}
              className="text-text-mute hover:text-gold disabled:opacity-30"
              aria-label="decrease adults"
              data-testid="planner-adults-dec"
            >
              <Minus className="w-3.5 h-3.5" />
            </button>
            <span className="text-sm font-semibold tabular-nums w-4 text-center" data-testid="planner-adults-value">
              {adults}
            </span>
            <button
              type="button"
              onClick={() => setAdults((a) => Math.min(9, a + 1))}
              disabled={adults >= 9}
              className="text-text-mute hover:text-gold disabled:opacity-30"
              aria-label="increase adults"
              data-testid="planner-adults-inc"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
        <div className="flex-1 min-w-[10rem]">
          <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
            {s("plannerCabin", locale)}
          </div>
          <select
            value={cabinClass}
            onChange={(e) => setCabinClass(e.target.value)}
            className="w-full bg-bg-deep border border-border-soft rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gold"
            data-testid="planner-cabin"
          >
            {CABIN_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {s(o.key, locale)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <button
        type="button"
        onClick={confirm}
        disabled={!isValid}
        className="inline-flex items-center gap-1.5 bg-gold text-bg-deep font-semibold text-xs px-4 py-2 rounded-md hover:bg-gold/90 disabled:opacity-50 disabled:cursor-not-allowed"
        data-testid="planner-confirm"
      >
        <Search className="w-3.5 h-3.5" />
        {s("plannerConfirm", locale)}
      </button>
    </div>
  );
}

function AirportBlock({
  label,
  code,
  sublabel,
  value,
  onChange,
  testid,
}: {
  label: string;
  code: string;
  sublabel?: string;
  value: string;
  onChange: (text: string) => void;
  testid?: string;
}) {
  return (
    <div className="flex-1 min-w-0 bg-bg-deep border border-border-soft rounded-md px-2.5 py-1.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-text-faint">
        {label}
      </div>
      <div className="text-xl font-semibold text-text leading-tight truncate min-h-[1.5rem]">
        {code || "—"}
      </div>
      {sublabel && (
        <div className="text-[10px] text-text-faint truncate">{sublabel}</div>
      )}
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={label}
        className="mt-1 w-full bg-transparent border-t border-border-soft pt-1 text-xs text-text-mute focus:outline-none focus:text-text"
        data-testid={testid}
      />
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  testid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  testid?: string;
}) {
  return (
    <label className="block">
      <span className="block text-[10px] font-mono uppercase tracking-wider text-text-faint mb-1">
        {label}
      </span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-bg-deep border border-border-soft rounded-md px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-gold"
        data-testid={testid}
      />
    </label>
  );
}
