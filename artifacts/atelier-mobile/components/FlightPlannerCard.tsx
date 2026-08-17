import { Feather } from "@expo/vector-icons";
import DateTimePicker from "@react-native-community/datetimepicker";
import React from "react";
import { Platform, Pressable, Text, TextInput, View } from "react-native";

import { Button } from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { firstOutOfOrderLeg, reconcileLegDates } from "@/lib/plannerDates";
import type {
  ChatFlightPlanner,
  ChatPlannerSegment,
  ChatPlannerTripType,
} from "@workspace/chat-core";

/* ── Task #745 — guided flight planner card (mobile) ─────────────────
 * Emirates-style trip planner rendered when a clarification field has
 * `inputType: "flight_planner"`. Submits through the normal
 * clarification path: `onSubmit({ plan: JSON.stringify(plan), answer })`.
 * The parent maps `plan` onto the field name.
 *
 * Task #843 — dates open the native date picker (inline component, no
 * Modal/sheet race — see rn-sheet-picker-defer for why timer-launched
 * pickers are banned). Past dates and returns before departure can't be
 * picked; the disabled Search button names the first missing field.
 * IATA blocks use fixed widths, not maxWidth, to avoid one-char-per-line
 * shrink-wrap collapse inside alignItems parents. */

const CABIN_OPTIONS: { value: string; label: string }[] = [
  { value: "economy", label: "Economy" },
  { value: "premium_economy", label: "Premium economy" },
  { value: "business", label: "Business" },
  { value: "first", label: "First" },
];

const TRIP_TABS: { value: ChatPlannerTripType; label: string }[] = [
  { value: "return", label: "Return" },
  { value: "one_way", label: "One-way" },
  { value: "multi_city", label: "Multi-city" },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function emptyAirport() {
  return { text: "", iata: null as string | null, label: null as string | null };
}

function blankSegment(): ChatPlannerSegment {
  return { origin: emptyAirport(), destination: emptyAirport(), date: "" };
}

function cabinLabel(value: string): string {
  return CABIN_OPTIONS.find((c) => c.value === value)?.label ?? value;
}

export function FlightPlannerCard({
  planner,
  onSubmit,
}: {
  planner: ChatFlightPlanner;
  onSubmit: (plan: string, answer: string) => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  const { lang } = useI18n();
  const scheme = useThemeScheme();

  // Normalize the prefill: a return trip carries 2 segments; multi-city a
  // list; one-way a single leg.
  const initialTrip: ChatPlannerTripType = planner.tripType ?? "return";
  const initialSegments =
    planner.segments && planner.segments.length > 0
      ? planner.segments.map((s) => ({
          origin: { ...emptyAirport(), ...(s.origin ?? {}) },
          destination: { ...emptyAirport(), ...(s.destination ?? {}) },
          date: s.date ?? "",
        }))
      : [blankSegment()];

  const [tripType, setTripType] = React.useState<ChatPlannerTripType>(initialTrip);
  const [segments, setSegments] = React.useState<ChatPlannerSegment[]>(initialSegments);
  const [returnDate, setReturnDate] = React.useState<string>(
    initialTrip === "return" ? (initialSegments[1]?.date ?? "") : "",
  );
  const [adults, setAdults] = React.useState<number>(
    Math.min(9, Math.max(1, planner.adults || 1)),
  );
  const [cabinClass, setCabinClass] = React.useState<string>(
    planner.cabinClass || "economy",
  );

  const ar = lang === "ar";

  // For Return/One-way the editable surface is the first segment only.
  const primary = segments[0] ?? blankSegment();

  const updateSegment = (idx: number, patch: Partial<ChatPlannerSegment>) => {
    setSegments((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const setPrimaryAirport = (
    which: "origin" | "destination",
    text: string,
  ) => {
    setSegments((prev) => {
      const first = prev[0] ?? blankSegment();
      const next = {
        ...first,
        [which]: { text, iata: null, label: null },
      };
      return [next, ...prev.slice(1)];
    });
  };

  const swapPrimary = () => {
    setSegments((prev) => {
      const first = prev[0] ?? blankSegment();
      const next = {
        ...first,
        origin: first.destination,
        destination: first.origin,
      };
      return [next, ...prev.slice(1)];
    });
  };

  const swapSegment = (idx: number) => {
    setSegments((prev) =>
      prev.map((s, i) =>
        i === idx ? { ...s, origin: s.destination, destination: s.origin } : s,
      ),
    );
  };

  const addLeg = () => {
    setSegments((prev) => (prev.length >= 8 ? prev : [...prev, blankSegment()]));
  };

  const removeLeg = (idx: number) => {
    setSegments((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  };

  // Build the effective segment list for the chosen trip type.
  const effectiveSegments = (): ChatPlannerSegment[] => {
    if (tripType === "one_way") return [primary];
    if (tripType === "return") {
      const back: ChatPlannerSegment = {
        origin: primary.destination,
        destination: primary.origin,
        date: returnDate,
      };
      return [primary, back];
    }
    return segments;
  };

  // Task #843 — native date pickers. `pickerFor` names the field the
  // picker edits; the picker is rendered inline in the card tree (no
  // Modal/sheet hand-off, so no deferral race — see rn-sheet-picker-defer).
  const [pickerFor, setPickerFor] = React.useState<
    { kind: "depart" } | { kind: "return" } | { kind: "leg"; idx: number } | null
  >(null);

  const todayStart = React.useMemo(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }, []);

  const ymdToDate = (s: string, fallback: Date): Date => {
    if (!DATE_RE.test(s.trim())) return fallback;
    const [y, m, d] = s.trim().split("-").map(Number);
    const out = new Date(y, m - 1, d);
    return isNaN(out.getTime()) ? fallback : out;
  };
  const dateToYmd = (d: Date): string => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };

  const pickerValue = (): Date => {
    if (!pickerFor) return todayStart;
    if (pickerFor.kind === "depart") return ymdToDate(primary.date, todayStart);
    if (pickerFor.kind === "return")
      return ymdToDate(returnDate, ymdToDate(primary.date, todayStart));
    const prevDate =
      pickerFor.idx > 0
        ? ymdToDate(segments[pickerFor.idx - 1]?.date ?? "", todayStart)
        : todayStart;
    return ymdToDate(segments[pickerFor.idx]?.date ?? "", prevDate);
  };
  const pickerMin = (): Date => {
    if (!pickerFor) return todayStart;
    if (pickerFor.kind === "return") return ymdToDate(primary.date, todayStart);
    if (pickerFor.kind === "leg" && pickerFor.idx > 0) {
      const prev = ymdToDate(segments[pickerFor.idx - 1]?.date ?? "", todayStart);
      return prev < todayStart ? todayStart : prev;
    }
    return todayStart;
  };
  const applyPicked = (d: Date) => {
    if (!pickerFor) return;
    const ymd = dateToYmd(d);
    if (pickerFor.kind === "depart") {
      updateSegment(0, { date: ymd });
      // A return before the new departure is no longer pickable — clear
      // it so the user re-picks instead of submitting a bad plan.
      if (returnDate && returnDate < ymd) setReturnDate("");
    } else if (pickerFor.kind === "return") {
      setReturnDate(ymd);
    } else {
      // Moving an earlier leg later must not strand a downstream leg on a
      // now-earlier date — clear such dates so the user re-picks them
      // (their picker minimum then enforces the new floor).
      const idx = pickerFor.idx;
      setSegments((prev) => {
        const reconciled = reconcileLegDates(
          prev.map((s) => s.date),
          idx,
          ymd,
        );
        return prev.map((s, i) => (s.date === reconciled[i] ? s : { ...s, date: reconciled[i] }));
      });
    }
  };

  const eff = effectiveSegments();
  // Multi-city legs must stay chronological even when an earlier leg was
  // edited after later legs were filled (prefill or state edge cases).
  const outOfOrderLeg =
    tripType === "multi_city" ? firstOutOfOrderLeg(eff.map((s) => s.date)) : null;
  const returnBeforeDepart =
    tripType === "return" &&
    DATE_RE.test(primary.date.trim()) &&
    DATE_RE.test(returnDate.trim()) &&
    returnDate.trim() < primary.date.trim();
  const valid =
    !returnBeforeDepart &&
    outOfOrderLeg === null &&
    eff.every(
      (s) =>
        s.origin.text.trim().length > 0 &&
        s.destination.text.trim().length > 0 &&
        DATE_RE.test(s.date.trim()),
    );

  // First missing/invalid field, named — shown under the disabled button.
  const firstProblem = (): string | null => {
    for (let i = 0; i < eff.length; i++) {
      const s = eff[i];
      const legTag =
        tripType === "multi_city" ? (ar ? ` (الرحلة ${i + 1})` : ` (leg ${i + 1})`) : "";
      if (!s.origin.text.trim())
        return (ar ? "أدخل مدينة المغادرة" : "Enter a departure city") + legTag;
      if (!s.destination.text.trim())
        return (ar ? "أدخل الوجهة" : "Enter a destination") + legTag;
      if (!DATE_RE.test(s.date.trim())) {
        if (tripType === "return" && i === 1)
          return ar ? "اختر تاريخ العودة" : "Pick a return date";
        if (tripType === "multi_city")
          return (ar ? "اختر التاريخ" : "Pick a date") + legTag;
        return ar ? "اختر تاريخ المغادرة" : "Pick a departure date";
      }
    }
    if (returnBeforeDepart)
      return ar
        ? "تاريخ العودة قبل تاريخ المغادرة"
        : "Return date can't be before departure";
    if (outOfOrderLeg !== null)
      return ar
        ? `تاريخ الرحلة ${outOfOrderLeg + 1} قبل الرحلة السابقة`
        : `Leg ${outOfOrderLeg + 1} date is before the previous leg`;
    return null;
  };

  const humanAnswer = (): string => {
    const tripLabel =
      tripType === "return" ? "Return" : tripType === "one_way" ? "One-way" : "Multi-city";
    const route =
      tripType === "multi_city"
        ? eff
            .map(
              (s) =>
                `${(s.origin.iata || s.origin.text).toUpperCase()} → ${(s.destination.iata || s.destination.text).toUpperCase()}`,
            )
            .join(", ")
        : `${(primary.origin.iata || primary.origin.text).toUpperCase()} → ${(primary.destination.iata || primary.destination.text).toUpperCase()}`;
    const dates =
      tripType === "return"
        ? `${primary.date} / ${returnDate}`
        : eff.map((s) => s.date).join(", ");
    const pax = `${adults} ${adults === 1 ? "passenger" : "passengers"}`;
    return `${tripLabel} ${route} · ${dates} · ${pax} · ${cabinLabel(cabinClass)}`;
  };

  const confirm = () => {
    if (!valid) return;
    const plan: ChatFlightPlanner = {
      tripType,
      segments: eff,
      adults,
      cabinClass,
    };
    onSubmit(JSON.stringify(plan), humanAnswer());
  };

  const inputStyle = {
    color: c.foreground,
    fontFamily: "Inter_600SemiBold",
    fontSize: 15,
    textAlign: rtl.textAlign,
  } as const;

  const labelStyle = {
    color: c.faint,
    fontFamily: "Inter_600SemiBold",
    fontSize: 10.5,
    letterSpacing: 0.4,
    textTransform: "uppercase" as const,
    textAlign: rtl.textAlign,
  };

  // Task #843 — tappable date field: opens the native date picker
  // instead of a keyboard. `target` identifies which date the picker
  // edits; tapping the active field again closes it (iOS inline).
  const dateBox = (
    value: string,
    target: { kind: "depart" } | { kind: "return" } | { kind: "leg"; idx: number },
    placeholder: string,
  ) => {
    const active =
      !!pickerFor &&
      pickerFor.kind === target.kind &&
      (pickerFor.kind !== "leg" ||
        (pickerFor as { idx: number }).idx === (target as { idx: number }).idx);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setPickerFor(active ? null : target)}
        style={{
          flex: 1,
          backgroundColor: c.secondary,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: active ? c.primary : c.borderSoft,
          paddingHorizontal: 10,
          paddingVertical: 8,
          gap: 2,
        }}
      >
        <Text style={labelStyle}>{placeholder}</Text>
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6 }}>
          <Feather name="calendar" size={13} color={value ? c.primary : c.faint} />
          <Text
            style={{
              color: value ? c.foreground : c.faint,
              fontFamily: "Inter_600SemiBold",
              fontSize: 14,
              fontVariant: ["tabular-nums"],
              textAlign: rtl.textAlign,
            }}
          >
            {value || (ar ? "اختر التاريخ" : "Select date")}
          </Text>
        </View>
      </Pressable>
    );
  };

  const datePicker = pickerFor ? (
    <DateTimePicker
      value={pickerValue()}
      mode="date"
      display={Platform.OS === "ios" ? "inline" : "default"}
      minimumDate={pickerMin()}
      themeVariant={scheme}
      onChange={(event, selected) => {
        // Android's dialog closes itself; iOS inline stays until the
        // user taps elsewhere — close on selection for both.
        if (event.type === "dismissed") {
          setPickerFor(null);
          return;
        }
        if (selected) applyPicked(selected);
        setPickerFor(null);
      }}
    />
  ) : null;

  const airportBlock = (
    seg: ChatPlannerSegment,
    which: "origin" | "destination",
    onChangeText: (t: string) => void,
  ) => {
    const ap = seg[which];
    const code = (ap.iata || ap.text || "").toUpperCase();
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.secondary,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: c.borderSoft,
          paddingHorizontal: 12,
          paddingVertical: 10,
          gap: 4,
        }}
      >
        <Text style={labelStyle}>
          {which === "origin" ? (ar ? "من" : "From") : ar ? "إلى" : "To"}
        </Text>
        <Text
          numberOfLines={1}
          style={{
            color: c.foreground,
            fontFamily: "Inter_800ExtraBold",
            fontSize: 22,
            letterSpacing: 0.5,
            textAlign: rtl.textAlign,
          }}
        >
          {code || "—"}
        </Text>
        <TextInput
          value={ap.text}
          onChangeText={onChangeText}
          placeholder={ar ? "المدينة أو المطار" : "City or airport"}
          placeholderTextColor={c.faint}
          keyboardAppearance={scheme}
          autoCorrect={false}
          style={inputStyle}
        />
        {ap.label ? (
          <Text
            numberOfLines={1}
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 11,
              textAlign: rtl.textAlign,
            }}
          >
            {ap.label}
          </Text>
        ) : null}
      </View>
    );
  };

  const swapButton = (onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={{
        width: 34,
        height: 34,
        borderRadius: 17,
        backgroundColor: c.tint08,
        borderWidth: 1,
        borderColor: c.borderSoft,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Feather name="repeat" size={15} color={c.primary} />
    </Pressable>
  );

  return (
    <View style={{ gap: 12 }}>
      {/* Trip-type tabs */}
      <View
        style={{
          flexDirection: rtl.row,
          backgroundColor: c.secondary,
          borderRadius: 12,
          padding: 3,
          gap: 3,
        }}
      >
        {TRIP_TABS.map((tab) => {
          const active = tripType === tab.value;
          return (
            <Pressable
              key={tab.value}
              onPress={() => setTripType(tab.value)}
              style={{
                flex: 1,
                paddingVertical: 8,
                borderRadius: 9,
                backgroundColor: active ? c.primary : "transparent",
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: active ? c.primaryForeground : c.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12.5,
                }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* FROM / TO */}
      {tripType === "multi_city" ? (
        <View style={{ gap: 10 }}>
          {segments.map((seg, idx) => (
            <View
              key={idx}
              style={{
                borderWidth: 1,
                borderColor: c.borderSoft,
                borderRadius: 14,
                padding: 8,
                gap: 8,
              }}
            >
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <Text style={labelStyle}>
                  {(ar ? "الرحلة " : "Leg ") + (idx + 1)}
                </Text>
                {segments.length > 1 ? (
                  <Pressable onPress={() => removeLeg(idx)} hitSlop={8}>
                    <Feather name="x-circle" size={16} color={c.faint} />
                  </Pressable>
                ) : null}
              </View>
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6 }}>
                {airportBlock(seg, "origin", (t) =>
                  updateSegment(idx, { origin: { text: t, iata: null, label: null } }),
                )}
                {swapButton(() => swapSegment(idx))}
                {airportBlock(seg, "destination", (t) =>
                  updateSegment(idx, {
                    destination: { text: t, iata: null, label: null },
                  }),
                )}
              </View>
              <View style={{ flexDirection: rtl.row, gap: 8 }}>
                {dateBox(seg.date, { kind: "leg", idx }, ar ? "التاريخ" : "Date")}
              </View>
              {pickerFor?.kind === "leg" && pickerFor.idx === idx ? datePicker : null}
            </View>
          ))}
          {segments.length < 8 ? (
            <Pressable
              onPress={addLeg}
              style={{
                flexDirection: rtl.row,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderStyle: "dashed",
                borderColor: c.border,
              }}
            >
              <Feather name="plus" size={15} color={c.primary} />
              <Text
                style={{
                  color: c.primary,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 13,
                }}
              >
                {ar ? "إضافة رحلة" : "Add leg"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <>
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6 }}>
            {airportBlock(primary, "origin", (t) => setPrimaryAirport("origin", t))}
            {swapButton(swapPrimary)}
            {airportBlock(primary, "destination", (t) =>
              setPrimaryAirport("destination", t),
            )}
          </View>
          <View style={{ flexDirection: rtl.row, gap: 8 }}>
            {dateBox(primary.date, { kind: "depart" }, ar ? "الذهاب" : "Departure")}
            {tripType === "return"
              ? dateBox(returnDate, { kind: "return" }, ar ? "العودة" : "Return")
              : null}
          </View>
          {pickerFor && pickerFor.kind !== "leg" ? datePicker : null}
        </>
      )}

      {/* Passengers + cabin */}
      <View style={{ gap: 8 }}>
        <View
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Text style={labelStyle}>{ar ? "المسافرون" : "Passengers"}</Text>
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 12 }}>
            <Pressable
              onPress={() => setAdults((n) => Math.max(1, n - 1))}
              disabled={adults <= 1}
              hitSlop={8}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: "center",
                justifyContent: "center",
                opacity: adults <= 1 ? 0.4 : 1,
              }}
            >
              <Feather name="minus" size={16} color={c.foreground} />
            </Pressable>
            <Text
              style={{
                color: c.foreground,
                fontFamily: "Inter_800ExtraBold",
                fontSize: 17,
                fontVariant: ["tabular-nums"],
                minWidth: 20,
                textAlign: "center",
              }}
            >
              {adults}
            </Text>
            <Pressable
              onPress={() => setAdults((n) => Math.min(9, n + 1))}
              disabled={adults >= 9}
              hitSlop={8}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: c.border,
                alignItems: "center",
                justifyContent: "center",
                opacity: adults >= 9 ? 0.4 : 1,
              }}
            >
              <Feather name="plus" size={16} color={c.foreground} />
            </Pressable>
          </View>
        </View>
        <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
          {CABIN_OPTIONS.map((opt) => {
            const active = cabinClass === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => setCabinClass(opt.value)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: active ? c.primary : c.secondary,
                  borderWidth: 1,
                  borderColor: active ? c.primary : c.borderSoft,
                }}
              >
                <Text
                  style={{
                    color: active ? c.primaryForeground : c.secondaryForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12.5,
                  }}
                >
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <Button
        label={ar ? "بحث عن الرحلات" : "Search flights"}
        onPress={confirm}
        disabled={!valid}
        icon="search"
      />
      {!valid ? (
        <View
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            marginTop: -4,
          }}
        >
          <Feather name="info" size={12} color={c.faint} />
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {firstProblem() ?? (ar ? "أكمل تفاصيل الرحلة" : "Complete the trip details")}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
