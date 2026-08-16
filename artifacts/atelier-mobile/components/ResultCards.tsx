import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Image, Linking, Pressable, Text, View } from "react-native";

import { Button, Card } from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import {
  formatCompact,
  formatCompactMoney,
  formatDate,
  looksLikeDate,
} from "@/lib/format";
import type { CapabilityShapes, ToolResult } from "@/lib/useChat";

type Json = Record<string, unknown>;

function asObj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
    return Number(v);
  return null;
}
function asStr(v: unknown): string {
  return v == null ? "" : String(v);
}

function humanLabel(key: string): string {
  return key
    .replace(/[_.]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/Usd\b/, "USD")
    .replace(/Pct\b/, "%")
    .replace(/^./, (ch) => ch.toUpperCase());
}

// Task #469 — money formatting must be OPT-IN by key: plain counts
// ("total", "value" used as a generic score) were rendered as "$0".
// Only keys that are unambiguously monetary get currency treatment.
const MONEY_KEY =
  /amount|dealsize|deal_size|valueusd|value_usd|weightedvalue|price|cost|budget|fee|revenue|spend/i;
const PCT_KEY = /pct|percent|probability/i;

function formatField(key: string, value: unknown, currency: string | null, lang: string): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const n = asNum(value);
  if (n != null) {
    if (MONEY_KEY.test(key)) return formatCompactMoney(n, currency);
    if (PCT_KEY.test(key)) return `${Math.round(n <= 1 ? n * 100 : n)}%`;
    return formatCompact(n);
  }
  const s = asStr(value);
  if (looksLikeDate(s)) return formatDate(s, lang);
  return s;
}

// Chrome keys excluded from the auto-generated attribute grid.
const SKIP_KEYS = new Set([
  "id", "name", "title", "label", "merchant", "href", "navigateTo", "shape",
  "status", "decision", "disposition", "count", "createdCount", "ids",
  "attachmentIds", "preview", "missingFields", "dispatched", "currency",
  "entity", "options", "stage", "verb", "payload",
  // Task #469 — internal/meta fields that must never render as card rows.
  "total", "scoped", "scopedNote", "source", "note", "prompt", "empty",
  // Task #637 — external Outlook draft link renders as a tappable row,
  // never as a raw-URL grid cell.
  "outlookDraftLink",
]);

// Task #794 — internal href → expo-router mapping lives in a pure
// module so a Node-side probe can pin it without pulling in RN deps.
import { internalRouteFor } from "@/lib/internalRoute";

/** Task #785 — tappable row that routes to an in-app screen. */
function InternalLinkRow({ route, label }: { route: string; label: string }) {
  const c = useColors();
  const rtl = useRTL();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(route as never)}
      style={{
        flexDirection: rtl.row,
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
      }}
      accessibilityRole="link"
    >
      <Feather name="arrow-right-circle" size={13} color={c.primary} />
      <Text
        numberOfLines={1}
        style={{
          color: c.primary,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** Task #637 — tappable row for an external https link on a result card
 * (e.g. the Outlook draft created by email_my_documents). */
function ExternalLinkRow({ url, label }: { url: string; label: string }) {
  const c = useColors();
  const rtl = useRTL();
  if (!/^https?:\/\//i.test(url)) return null;
  return (
    <Pressable
      onPress={() => Linking.openURL(url).catch(() => {})}
      style={{
        flexDirection: rtl.row,
        alignItems: "center",
        gap: 6,
        paddingVertical: 6,
      }}
      accessibilityRole="link"
    >
      <Feather name="external-link" size={13} color={c.primary} />
      <Text
        numberOfLines={1}
        style={{
          color: c.primary,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/* ─────────────────────── shared chrome ─────────────────────── */

function CardHeader({ icon, title, ok }: { icon: React.ComponentProps<typeof Feather>["name"]; title: string; ok: boolean }) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: 28,
          height: 28,
          borderRadius: 10,
          backgroundColor: ok ? c.tint08 : c.destructiveTint,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={14} color={ok ? c.primary : c.destructive} />
      </View>
      <Text
        numberOfLines={1}
        style={{
          flex: 1,
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 12,
          letterSpacing: 0.4,
          textTransform: "uppercase",
          textAlign: rtl.textAlign,
        }}
      >
        {title}
      </Text>
      <View
        style={{
          width: 7,
          height: 7,
          borderRadius: 4,
          backgroundColor: ok ? c.success : c.destructive,
        }}
      />
    </View>
  );
}

function FieldGrid({ entries, currency, lang }: { entries: [string, unknown][]; currency: string | null; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  if (entries.length === 0) return null;
  return (
    <View style={{ flexDirection: rtl.row, flexWrap: "wrap", marginTop: 4 }}>
      {entries.map(([k, v]) => (
        <View key={k} style={{ width: "50%", paddingVertical: 5, paddingEnd: 8 }}>
          <Text
            numberOfLines={1}
            style={{
              color: c.faint,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 10.5,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              textAlign: rtl.textAlign,
            }}
          >
            {humanLabel(k)}
          </Text>
          <Text
            numberOfLines={2}
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 13.5,
              textAlign: rtl.textAlign,
            }}
          >
            {formatField(k, v, currency, lang)}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Flatten a payload into displayable [key, value] pairs. */
function displayEntries(data: Json, max = 8): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(data)) {
    if (SKIP_KEYS.has(k)) continue;
    if (v == null || v === "") continue;
    if (typeof v === "object") {
      if (Array.isArray(v)) {
        if (v.length > 0 && v.every((x) => typeof x === "string")) {
          out.push([k, (v as string[]).slice(0, 4).join(", ")]);
        }
        continue;
      }
      continue;
    }
    out.push([k, v]);
    if (out.length >= max) break;
  }
  return out;
}

/* ─────────────────────── shape renderers ─────────────────────── */

function WriteSuccess({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const label =
    asStr(data.name) || asStr(data.title) || asStr(data.label) || asStr(data.merchant);
  const currency = asStr(data.currency) || null;
  const entries = displayEntries(data, 6);
  return (
    <Card style={{ gap: 8, borderRadius: 8, padding: 12, borderColor: c.border }}>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
        <Feather name="check-circle" size={16} color={c.success} />
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            color: c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 14.5,
            textAlign: rtl.textAlign,
          }}
        >
          {label || humanLabel(asStr(data.shape) || "Saved")}
        </Text>
      </View>
      <FieldGrid entries={entries} currency={currency} lang={lang} />
      {(() => {
        // Task #637 — surface the Outlook draft (or any external https
        // href) as a tappable row.
        const link = asStr(data.outlookDraftLink) || asStr(data.href);
        if (/^https?:\/\//i.test(link)) {
          return <ExternalLinkRow url={link} label="Open in Outlook" />;
        }
        // Task #785 — internal destinations (e.g. /me/profile after a
        // document save/delete) get an in-app route row so mobile lands
        // on the same real page web navigates to.
        const nav = asStr(asObj(data.navigateTo).path) || link;
        const internal = internalRouteFor(nav);
        return internal ? (
          <InternalLinkRow route={internal.route} label={internal.label} />
        ) : null;
      })()}
    </Card>
  );
}

function KpiStrip({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const currency = asStr(data.currency) || null;
  // Either stages[] rows or a flat object of numbers.
  const stages = asArr(data.stages).map((s) => asObj(s));
  let items: { label: string; value: string }[] = [];
  if (stages.length > 0) {
    // Task #469 — only treat the row as monetary when a monetary field
    // is actually present; bare counts must not render as "$N".
    items = stages.slice(0, 8).map((s) => {
      const money = s.totalValue ?? s.value ?? s.amount;
      return {
        label: asStr(s.stage ?? s.label ?? s.name) || "—",
        value:
          money != null
            ? formatField("valueUsd", money, asStr(s.currency) || currency, lang)
            : formatField("count", s.count, null, lang),
      };
    });
  } else {
    items = Object.entries(data)
      .filter(([k, v]) => !SKIP_KEYS.has(k) && asNum(v) != null)
      .slice(0, 8)
      .map(([k, v]) => ({ label: humanLabel(k), value: formatField(k, v, currency, lang) }));
  }
  if (items.length === 0) return <FallbackGrid data={data} lang={lang} />;
  return (
    <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
      {items.map((it, i) => (
        <View
          key={i}
          style={{
            minWidth: "30%",
            flexGrow: 1,
            backgroundColor: c.elevate2,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: c.borderSoft,
            paddingHorizontal: 12,
            paddingVertical: 10,
          }}
        >
          <Text
            numberOfLines={1}
            style={{
              color: c.faint,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 10.5,
              letterSpacing: 0.3,
              textTransform: "uppercase",
              textAlign: rtl.textAlign,
            }}
          >
            {it.label}
          </Text>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_800ExtraBold",
              fontSize: 17,
              fontVariant: ["tabular-nums"],
              textAlign: rtl.textAlign,
            }}
          >
            {it.value}
          </Text>
        </View>
      ))}
    </View>
  );
}

function RankedList({
  data,
  lang,
  onPrompt,
}: {
  data: Json;
  lang: string;
  onPrompt?: (text: string) => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  // Task #721 — paging state must sit above the empty-list early return
  // (hooks may not be conditional).
  const [page, setPage] = React.useState(0);
  const rows = (
    asArr(data.items).length > 0
      ? asArr(data.items)
      : asArr(data.rows).length > 0
        ? asArr(data.rows)
        : asArr(data.results)
  ).map((r) => asObj(r));
  if (rows.length === 0) {
    // Task #469 — an explicitly-empty list renders a clear prose line
    // instead of falling through to a metadata grid or a bare "✓" card.
    const hasListKey =
      Array.isArray(data.items) || Array.isArray(data.rows) || Array.isArray(data.results);
    if (hasListKey) {
      return (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {lang === "ar" ? "لا توجد نتائج." : lang === "fr" ? "Aucun résultat." : "No results found."}
        </Text>
      );
    }
    return <FallbackGrid data={data} lang={lang} />;
  }
  const currency = asStr(data.currency) || null;
  // Task #715 — rich flight cards: travel.search_flights items carry a
  // structured `flight` object; render those Google-Flights style.
  const isFlightList = rows.some((r) => r.flight && typeof r.flight === "object");
  // Task #721 — client-side Prev/Next paging over the fetched results.
  const pageSize = Math.max(1, asNum(data.pageSize) ?? (isFlightList ? 10 : 8));
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const paged = rows.slice(safePage * pageSize, (safePage + 1) * pageSize);
  const itinerary = asObj(data.itinerary);
  const isItinerary = data.itinerary != null && typeof data.itinerary === "object";
  const pagerLabel = (dir: "prev" | "next") =>
    lang === "ar" ? (dir === "prev" ? "السابق" : "التالي") : dir === "prev" ? "← Prev" : "Next →";
  const pager =
    pageCount > 1 ? (
      <View
        style={{
          flexDirection: rtl.row,
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 6,
        }}
      >
        {(["prev", "next"] as const).map((dir, i) => {
          const disabled = dir === "prev" ? safePage === 0 : safePage >= pageCount - 1;
          const mid = i === 0 && (
            <Text
              key="mid"
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 11,
                fontVariant: ["tabular-nums"],
              }}
            >
              {`${safePage + 1} / ${pageCount}`}
            </Text>
          );
          return (
            <React.Fragment key={dir}>
              <Pressable
                disabled={disabled}
                onPress={() =>
                  setPage(dir === "prev" ? Math.max(0, safePage - 1) : Math.min(pageCount - 1, safePage + 1))
                }
                style={{
                  borderWidth: 1,
                  borderColor: c.borderSoft,
                  borderRadius: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  opacity: disabled ? 0.4 : 1,
                }}
              >
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 11,
                  }}
                >
                  {pagerLabel(dir)}
                </Text>
              </Pressable>
              {mid}
            </React.Fragment>
          );
        })}
      </View>
    ) : null;
  // Task #745 — itinerary travellers list ("Travellers: You — Mounir; …").
  const travellers = asArr(itinerary.travellers).map((t) => asObj(t));
  const travellerLine =
    travellers.length > 0
      ? travellers
          .map((t) => {
            const name = asStr(t.name);
            const rel = asStr(t.relationship);
            if (t.kind === "self") return `${lang === "ar" ? "أنت" : "You"} — ${name}`;
            return rel ? `${name} (${rel})` : name;
          })
          .filter(Boolean)
          .join("; ")
      : "";
  const itineraryHeader = isItinerary ? (
    <View style={{ marginBottom: 4, gap: 2 }}>
      <View
        style={{
          flexDirection: rtl.row,
          alignItems: "baseline",
          justifyContent: "space-between",
        }}
      >
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 13,
          }}
        >
          {lang === "ar" ? "ملخص خط الرحلة" : "Itinerary summary"}
        </Text>
        {asStr(itinerary.totalDisplay) ? (
          <Text
            style={{
              color: c.primary,
              fontFamily: "PlusJakartaSans_700Bold",
              fontSize: 13,
              fontVariant: ["tabular-nums"],
            }}
          >
            {asStr(itinerary.totalDisplay)}
          </Text>
        ) : null}
      </View>
      {travellerLine ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 11.5,
            textAlign: rtl.textAlign,
          }}
        >
          {(lang === "ar" ? "المسافرون: " : "Travellers: ") + travellerLine}
        </Text>
      ) : null}
    </View>
  ) : null;
  // Task #745 — subtle multi-leg progress line ("Leg 1 of 2 · DXB → RUH").
  const legContext = asObj(data.legContext);
  const legLabel = asStr(legContext.label);
  const legIndex = asNum(legContext.legIndex);
  const legCount = asNum(legContext.legCount);
  const legLine =
    legLabel || (legIndex != null && legCount != null)
      ? `${
          legIndex != null && legCount != null
            ? lang === "ar"
              ? `الرحلة ${legIndex} من ${legCount}`
              : `Leg ${legIndex} of ${legCount}`
            : ""
        }${legLabel ? (legIndex != null && legCount != null ? " · " : "") + legLabel : ""}`
      : "";
  const legProgress =
    legLine && isFlightList ? (
      <Text
        style={{
          color: c.faint,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 11,
          letterSpacing: 0.3,
          textAlign: rtl.textAlign,
        }}
      >
        {legLine}
      </Text>
    ) : null;
  const testBanner =
    data.testMode === true ? (
      <View
        style={{
          flexDirection: rtl.row,
          alignItems: "center",
          gap: 6,
          backgroundColor: c.warningTint,
          borderRadius: 8,
          paddingHorizontal: 8,
          paddingVertical: 6,
          marginBottom: 6,
        }}
      >
        <Feather name="alert-triangle" size={12} color={c.warning} />
        <Text
          style={{
            flex: 1,
            color: c.warning,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 11,
            textAlign: rtl.textAlign,
          }}
        >
          {lang === "ar"
            ? "بيانات تجريبية — هذه العروض ليست رحلات حقيقية قابلة للحجز."
            : "Test data — these offers are sandbox results, not bookable real flights."}
        </Text>
      </View>
    ) : null;
  if (isFlightList) {
    return (
      <View style={{ gap: 8 }}>
        {itineraryHeader}
        {legProgress}
        {testBanner}
        {paged.map((r, i) => (
          <FlightOfferRow
            key={safePage * pageSize + i}
            item={r}
            legContext={legContext}
            // Itinerary-summary leg cards keep the link row only — they
            // are NOT flight-select targets.
            onPrompt={isItinerary ? undefined : onPrompt}
          />
        ))}
        {pager}
      </View>
    );
  }
  return (
    <View style={{ gap: 2 }}>
      {testBanner}
      {paged.map((r, pageIdx) => {
        const i = safePage * pageSize + pageIdx;
        const label =
          asStr(r.name) || asStr(r.title) || asStr(r.label) || asStr(r.account) || `#${i + 1}`;
        // Task #469 — split monetary fields from plain counts/scores so
        // "count: 3" never renders as "$3".
        const moneyRaw = r.weightedValueUsd ?? r.value ?? r.amount ?? r.totalValue;
        const valueRaw = moneyRaw ?? r.count ?? r.score;
        const valueKey = moneyRaw != null ? "valueUsd" : "count";
        const sub = asStr(r.stage ?? r.status ?? r.owner ?? r.subtitle);
        // Task #706 — external links (travel booking handoffs etc.)
        // open in the device browser; internal hrefs stay non-pressable
        // (mobile has no portal webview for arbitrary paths).
        const href = asStr(r.href);
        const externalUrl = /^https?:\/\//i.test(href) ? href : null;
        const Row = externalUrl ? Pressable : View;
        const rowPressProps = externalUrl
          ? { onPress: () => Linking.openURL(externalUrl).catch(() => {}) }
          : {};
        return (
          <Row
            key={i}
            {...rowPressProps}
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              gap: 10,
              paddingVertical: 8,
              borderBottomWidth: pageIdx < paged.length - 1 ? 1 : 0,
              borderBottomColor: c.borderSoft,
            }}
          >
            <Text
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_700Bold",
                fontSize: 12,
                width: 18,
                textAlign: "center",
              }}
            >
              {i + 1}
            </Text>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 14,
                  textAlign: rtl.textAlign,
                }}
              >
                {label}
              </Text>
              {sub ? (
                <Text
                  numberOfLines={1}
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_500Medium",
                    fontSize: 12,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {sub}
                </Text>
              ) : null}
            </View>
            {valueRaw != null ? (
              <Text
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_700Bold",
                  fontSize: 14,
                  fontVariant: ["tabular-nums"],
                }}
              >
                {formatField(valueKey, valueRaw, asStr(r.currency) || currency, lang)}
              </Text>
            ) : null}
          </Row>
        );
      })}
    </View>
  );
}

/* ────────── Task #715 — Google-Flights-style flight card (mobile) ────────── */

function FlightOfferRow({
  item,
  onPrompt,
  legContext,
}: {
  item: Json;
  onPrompt?: (text: string) => void;
  legContext?: Json;
}) {
  const c = useColors();
  const rtl = useRTL();
  const f = asObj(item.flight);
  const legs = asArr(f.legs).map((l) => asObj(l));
  const outbound = asObj(f.outbound ?? legs[0]);
  const price = asObj(f.price);
  const href = asStr(item.href);
  const externalUrl = /^https?:\/\//i.test(href) ? href : null;
  // Task #745 — the card body is now a flight-SELECT target (fires a
  // normal chat turn the model turns into travel_select_flight) when a
  // prompt callback is available AND the item carries a flight object.
  const hasFlight = item.flight != null && typeof item.flight === "object";
  const selectable = !!onPrompt && hasFlight;
  const aedAmount = asNum(price.aedAmount);
  const amount = asNum(price.amount);
  const currency = asStr(price.currency);
  const approx = price.aedApprox === true;
  const priceMain =
    aedAmount != null
      ? `AED ${Math.round(aedAmount).toLocaleString("en-US")}`
      : amount != null
        ? `${currency} ${amount.toLocaleString("en-US")}`
        : asStr(item.label);
  const tripType = asStr(f.tripType);
  const checkedBags = asNum(f.checkedBags);
  const carriers = asStr(outbound.carriersLabel) || asStr(f.airline);
  const stopsDur = [asStr(outbound.stopsLabel), asStr(outbound.durationLabel)]
    .filter(Boolean)
    .join(" · ");
  // Task #721 — airline logo (CDN, hidden on error) + flight numbers.
  const logoUrl = asStr(outbound.logoUrl) || asStr(f.logoUrl);
  const [logoFailed, setLogoFailed] = React.useState(false);
  const flightNumbers = asStr(outbound.flightNumbersLabel);
  const returnLegs = legs.slice(1);

  // Task #745 — assemble the select prompt from the flight/outbound
  // fields, omitting missing pieces gracefully.
  const buildSelectPrompt = (): string => {
    const airline = carriers;
    const flightNumbersLabel = flightNumbers;
    const originIata = asStr(outbound.originIata);
    const destinationIata = asStr(outbound.destinationIata);
    const departDate = asStr(outbound.departDate ?? f.departDate);
    const departTime = asStr(outbound.departTime);
    const arriveTime = asStr(outbound.arriveTime);
    const cabin = asStr(f.cabin ?? f.cabinClass);
    const priceCurrency = currency;
    const priceAmount = amount;
    const stopsLabel = asStr(outbound.stopsLabel);
    const durationLabel = asStr(outbound.durationLabel);
    const lc = asObj(legContext);
    const lcIndex = asNum(lc.legIndex);
    const lcCount = asNum(lc.legCount);
    let s = `I pick this flight: ${airline}${
      flightNumbersLabel ? " " + flightNumbersLabel : ""
    } ${originIata} → ${destinationIata} on ${departDate}, departs ${departTime}, arrives ${arriveTime}, cabin ${cabin}, price ${priceCurrency} ${
      priceAmount != null ? priceAmount : ""
    }`;
    if (stopsLabel) s += `, ${stopsLabel}`;
    if (durationLabel) s += `, ${durationLabel}`;
    if (lcIndex != null && lcCount != null) s += ` (leg ${lcIndex} of ${lcCount})`;
    if (href) s += `. Booking link: ${href}`;
    return s;
  };

  const Row = selectable ? Pressable : externalUrl && !selectable ? Pressable : View;
  const rowPressProps = selectable
    ? { onPress: () => onPrompt!(buildSelectPrompt()) }
    : externalUrl
      ? { onPress: () => Linking.openURL(externalUrl).catch(() => {}) }
      : {};
  const timeStyle = {
    color: c.foreground,
    fontFamily: "PlusJakartaSans_800ExtraBold",
    fontSize: 17,
    fontVariant: ["tabular-nums"] as ("tabular-nums")[],
  };
  const iataStyle = {
    color: c.faint,
    fontFamily: "PlusJakartaSans_600SemiBold",
    fontSize: 10.5,
    letterSpacing: 0.4,
  };
  return (
    <Row
      {...rowPressProps}
      style={{
        borderWidth: 1,
        borderColor: c.borderSoft,
        borderRadius: 12,
        padding: 10,
        gap: 4,
      }}
    >
      <View style={{ flexDirection: rtl.row, alignItems: "flex-start", gap: 10 }}>
        {logoUrl && !logoFailed ? (
          <Image
            source={{ uri: logoUrl }}
            onError={() => setLogoFailed(true)}
            style={{
              width: 24,
              height: 24,
              borderRadius: 5,
              marginTop: 2,
              backgroundColor: "#FFFFFFE6",
            }}
            resizeMode="contain"
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
            <View>
              <Text style={timeStyle}>{asStr(outbound.departTime)}</Text>
              <Text style={iataStyle}>{asStr(outbound.originIata)}</Text>
            </View>
            <View
              style={{
                flex: 1,
                height: 1,
                backgroundColor: c.borderSoft,
                minWidth: 16,
              }}
            />
            <View>
              <Text style={timeStyle}>
                {asStr(outbound.arriveTime)}
                {outbound.arrivesNextDay === true ? (
                  <Text
                    style={{
                      color: c.warning,
                      fontFamily: "PlusJakartaSans_700Bold",
                      fontSize: 11,
                    }}
                  >
                    {" "}
                    +1
                  </Text>
                ) : null}
              </Text>
              <Text style={iataStyle}>{asStr(outbound.destinationIata)}</Text>
            </View>
          </View>
          {stopsDur ? (
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 12,
                marginTop: 4,
                textAlign: rtl.textAlign,
              }}
            >
              {stopsDur}
            </Text>
          ) : null}
          {carriers ? (
            <Text
              numberOfLines={1}
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 12,
                textAlign: rtl.textAlign,
              }}
            >
              {carriers}
              {flightNumbers ? (
                <Text
                  style={{
                    color: c.faint,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 11,
                  }}
                >
                  {`  ${flightNumbers}`}
                </Text>
              ) : null}
            </Text>
          ) : null}
          {!carriers && flightNumbers ? (
            <Text
              numberOfLines={1}
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 11,
                textAlign: rtl.textAlign,
              }}
            >
              {flightNumbers}
            </Text>
          ) : null}
          {returnLegs.length > 0 ? (
            <Text
              numberOfLines={2}
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 11,
                marginTop: 3,
                textAlign: rtl.textAlign,
              }}
            >
              {returnLegs
                .map(
                  (l) =>
                    `↩ ${asStr(l.originIata)} ${asStr(l.departTime)} → ${asStr(l.destinationIata)} ${asStr(l.arriveTime)}${l.arrivesNextDay === true ? " +1" : ""}`,
                )
                .join("\n")}
            </Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {checkedBags === 0 ? (
              <Feather name="slash" size={11} color={c.faint} />
            ) : null}
            {checkedBags != null && checkedBags > 0 ? (
              <Text
                style={{
                  color: c.faint,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 11,
                }}
              >
                🧳{checkedBags}
              </Text>
            ) : null}
            <Text
              style={{
                color: c.success,
                fontFamily: "PlusJakartaSans_800ExtraBold",
                fontSize: 16,
                fontVariant: ["tabular-nums"],
              }}
            >
              {priceMain}
            </Text>
          </View>
          {tripType ? (
            <Text
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 11,
              }}
            >
              {tripType}
            </Text>
          ) : null}
          {approx && aedAmount != null && amount != null ? (
            <Text
              style={{
                color: c.faint,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 10,
              }}
            >
              ≈ from {currency} {amount.toLocaleString("en-US")}
            </Text>
          ) : null}
        </View>
      </View>
      {/* Task #745 — when the body is a select target, the booking link
          still needs a dedicated affordance (a separate Pressable that
          opens the URL externally, not the select action). */}
      {selectable && externalUrl ? (
        <Pressable
          onPress={() => Linking.openURL(externalUrl).catch(() => {})}
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            gap: 5,
            alignSelf: rtl.isRTL ? "flex-end" : "flex-start",
            marginTop: 4,
          }}
          accessibilityRole="link"
        >
          <Feather name="external-link" size={12} color={c.primary} />
          <Text
            style={{
              color: c.primary,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 12,
            }}
          >
            Open booking link ↗
          </Text>
        </Pressable>
      ) : null}
    </Row>
  );
}

function AuditTimeline({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const rows = (
    asArr(data.events).length > 0 ? asArr(data.events) : asArr(data.items)
  ).map((r) => asObj(r));
  if (rows.length === 0) return <FallbackGrid data={data} lang={lang} />;
  return (
    <View style={{ gap: 10 }}>
      {rows.slice(0, 8).map((r, i) => {
        const label =
          asStr(r.summary) || asStr(r.action) || asStr(r.label) || asStr(r.type) || "—";
        const when = asStr(r.at ?? r.createdAt ?? r.timestamp);
        const who = asStr(r.actor ?? r.actorName ?? r.by);
        return (
          <View key={i} style={{ flexDirection: rtl.row, gap: 10 }}>
            <View style={{ alignItems: "center", width: 10 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: c.primary,
                  marginTop: 5,
                }}
              />
              {i < Math.min(rows.length, 8) - 1 ? (
                <View style={{ flex: 1, width: 1.5, backgroundColor: c.borderSoft, marginTop: 3 }} />
              ) : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 2 }}>
              <Text
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 13.5,
                  textAlign: rtl.textAlign,
                }}
              >
                {humanLabel(label)}
              </Text>
              {(who || when) ? (
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_500Medium",
                    fontSize: 11.5,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {[who, when && looksLikeDate(when) ? formatDate(when, lang) : when]
                    .filter(Boolean)
                    .join(" · ")}
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

// Task #450 — person_workload capacity keys are rendered as a prominent
// banner instead of ordinary grid rows.
const CAPACITY_KEYS = new Set(["totalAllocationPct", "capacityStatus", "availablePct"]);

function CapacityBanner({ totalPct, hiddenCount, lang }: { totalPct: number; hiddenCount: number; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const over = totalPct > 100;
  const full = totalPct === 100;
  const availablePct = Math.max(0, 100 - totalPct);
  const tone = over ? c.destructive : full ? "#b8860b" : "#2e7d32";
  const label = over
    ? ar
      ? `محمّل زيادة بنسبة ${Math.round(totalPct - 100)}٪`
      : `Overallocated by ${Math.round(totalPct - 100)}%`
    : full
      ? ar
        ? "مخصص بالكامل"
        : "Fully allocated"
      : ar
        ? `متاح بنسبة ${Math.round(availablePct)}٪`
        : `${Math.round(availablePct)}% available`;
  const barPct = Math.min(100, Math.max(0, totalPct));
  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: tone + "55",
        backgroundColor: tone + "14",
        borderRadius: 8,
        padding: 10,
        gap: 6,
      }}
    >
      <View
        style={{
          flexDirection: rtl.row,
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 17,
          }}
        >
          {Math.round(totalPct)}%{" "}
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_500Medium",
              fontSize: 11,
            }}
          >
            {ar ? "إجمالي التخصيص" : "total allocation"}
          </Text>
        </Text>
        <Text
          style={{
            color: tone,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 12,
          }}
        >
          {label}
        </Text>
      </View>
      <View
        style={{
          height: 6,
          borderRadius: 3,
          backgroundColor: c.border,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            height: "100%",
            width: `${barPct}%`,
            borderRadius: 3,
            backgroundColor: tone,
          }}
        />
      </View>
      {hiddenCount > 0 ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 11,
            textAlign: rtl.textAlign,
          }}
        >
          {ar
            ? "قد يكون التخصيص الفعلي أعلى — بعض الحسابات خارج نطاق صلاحياتك."
            : "Actual load may be higher — some accounts are outside your visibility."}
        </Text>
      ) : null}
    </View>
  );
}

function EntityBody({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const name =
    asStr(data.name) || asStr(data.title) || asStr(data.label) || asStr(data.merchant);
  const status = asStr(data.status ?? data.decision ?? data.disposition);
  const currency = asStr(data.currency) || null;
  const totalAlloc = asNum(data.totalAllocationPct);
  const showCapacity =
    totalAlloc != null &&
    Array.isArray(data.engagementStaffings) &&
    data.linkedUser === true;
  const entries = displayEntries(data).filter(
    ([k]) => !(showCapacity && CAPACITY_KEYS.has(k)),
  );
  return (
    <View style={{ gap: 4 }}>
      {name ? (
        <Text
          numberOfLines={2}
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 15.5,
            textAlign: rtl.textAlign,
          }}
        >
          {name}
        </Text>
      ) : null}
      {status ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 12,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            textAlign: rtl.textAlign,
          }}
        >
          {humanLabel(status)}
        </Text>
      ) : null}
      {showCapacity && totalAlloc != null ? (
        <CapacityBanner
          totalPct={totalAlloc}
          hiddenCount={asNum(data.hiddenAccountCount) ?? 0}
          lang={lang}
        />
      ) : null}
      <FieldGrid entries={entries} currency={currency} lang={lang} />
    </View>
  );
}

/* ─────────── Task #994 — /recap body (proactive-card parity) ─────────── */

function RecapBody({ data }: { data: Json }) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const accomplishments = asArr(data.accomplishments)
    .map((a) => asStr(a))
    .filter((a) => a.trim().length > 0);
  const openThreads = asArr(data.openThreads)
    .map((o) => asStr(o))
    .filter((o) => o.trim().length > 0);
  return (
    <View style={{ gap: 4 }}>
      <Text
        style={{
          color: "#C9A24E",
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 11,
          letterSpacing: 1,
          textTransform: "uppercase",
          textAlign: rtl.textAlign,
        }}
      >
        {t("chat.recapTitle")}
      </Text>
      {accomplishments.map((a, i) => (
        <Text
          key={i}
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_400Regular",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {"• "}
          {a}
        </Text>
      ))}
      {openThreads.length > 0 ? (
        <View style={{ gap: 2, paddingTop: 2 }}>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: rtl.textAlign,
            }}
          >
            {t("chat.recapStillOpen")}
          </Text>
          {openThreads.map((o, i) => (
            <Text
              key={i}
              style={{
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_400Regular",
                fontSize: 12,
                textAlign: rtl.textAlign,
              }}
            >
              {o}
            </Text>
          ))}
        </View>
      ) : null}
      {asArr(data.entities).length > 0 ? (
        <View
          style={{
            flexDirection: rtl.row,
            flexWrap: "wrap",
            gap: 6,
            paddingTop: 2,
          }}
        >
          {asArr(data.entities)
            .map((e) => asObj(e))
            .filter((e) => asStr(e.label).trim().length > 0)
            .map((e, i) => (
              <View
                key={`${asStr(e.kind)}:${asStr(e.id)}-${i}`}
                style={{
                  borderWidth: 1,
                  borderColor: c.border,
                  borderRadius: 4,
                  paddingHorizontal: 6,
                  paddingVertical: 2,
                }}
              >
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_400Regular",
                    fontSize: 10,
                  }}
                >
                  {asStr(e.kind)}: {asStr(e.label)}
                </Text>
              </View>
            ))}
        </View>
      ) : null}
    </View>
  );
}

function FallbackGrid({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const entries = displayEntries(data);
  if (entries.length === 0) {
    // Try one level down: single nested object payloads ({account:{…}}).
    const nested = Object.values(data).find(
      (v) => v && typeof v === "object" && !Array.isArray(v),
    );
    if (nested) return <EntityBody data={asObj(nested)} lang={lang} />;
    return (
      <Text
        style={{
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_500Medium",
          fontSize: 13,
          textAlign: rtl.textAlign,
        }}
      >
        ✓
      </Text>
    );
  }
  return <FieldGrid entries={entries} currency={asStr(data.currency) || null} lang={lang} />;
}

/* ────────── Task #1248 — finance-document ingest/classify (mobile) ────────── */

// Friendly supplier-invoice card (preview + committed phases of
// ingest_supplier_invoice): supplier, amount+currency, reference,
// period and status — never raw ids or JSON.
function SupplierInvoiceBody({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const supplier = asStr(data.supplierName) || "—";
  const amount = asNum(data.amount);
  const currency = asStr(data.currency) || "";
  const committed = asStr(data.stage) === "committed";
  const status = asStr(data.status) || (data.alreadyFiled === true ? "already filed" : "");
  const firmName = asStr(asObj(data.linkedFirm).name);
  const message = asStr(data.message);
  const entries: [string, unknown][] = [];
  if (asStr(data.reference)) entries.push(["reference", asStr(data.reference)]);
  if (asStr(data.invoiceDate)) entries.push(["invoiceDate", asStr(data.invoiceDate)]);
  if (asStr(data.periodLabel)) entries.push(["period", asStr(data.periodLabel)]);
  if (firmName) entries.push(["linkedFirm", firmName]);
  if (status) entries.push(["status", status]);
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: rtl.row, alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Text
          numberOfLines={2}
          style={{
            flex: 1,
            color: c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 14.5,
            textAlign: rtl.textAlign,
          }}
        >
          {supplier}
        </Text>
        <Text
          style={{
            color: committed ? c.success : c.foreground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 15,
          }}
        >
          {amount != null ? `${currency} ${amount.toFixed(2)}` : "—"}
        </Text>
      </View>
      <FieldGrid entries={entries} currency={currency || null} lang={lang} />
      {committed && !!message && (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 12,
            textAlign: rtl.textAlign,
          }}
        >
          {message}
        </Text>
      )}
    </View>
  );
}

const CLASSIFY_KIND_LABEL_M: Record<string, { en: string; ar: string }> = {
  supplier_invoice: { en: "Supplier invoice", ar: "فاتورة مورد" },
  bank_statement: { en: "Bank statement", ar: "كشف حساب بنكي" },
  bank_letter: { en: "Bank letter", ar: "خطاب بنكي" },
  receipt: { en: "Receipt", ar: "إيصال" },
  client_billing: { en: "Client billing", ar: "فوترة عميل" },
  unknown: { en: "Unrecognised document", ar: "مستند غير معروف" },
};

// Friendly classification rows (classify_finance_document): file name,
// detected kind, confidence — no attachment ids, no raw JSON.
function DocClassificationBody({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const results = asArr(data.results).map((r) => asObj(r));
  if (results.length === 0) {
    return (
      <Text
        style={{
          color: c.mutedForeground,
          fontFamily: "PlusJakartaSans_500Medium",
          fontSize: 13,
          textAlign: rtl.textAlign,
        }}
      >
        {ar ? "لا توجد مستندات لتصنيفها." : "No documents to classify."}
      </Text>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {results.map((r, i) => {
        const fileName = asStr(r.fileName) || (ar ? "مرفق" : "Attachment");
        if (r.error) {
          return (
            <Text
              key={i}
              style={{
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 12.5,
                textAlign: rtl.textAlign,
              }}
            >
              {fileName} — {ar ? "تعذّر العثور على المرفق." : "attachment not found."}
            </Text>
          );
        }
        const kind = asStr(r.kind);
        const kl = CLASSIFY_KIND_LABEL_M[kind];
        const kindLabel = kl ? (ar ? kl.ar : kl.en) : humanLabel(kind || "document");
        const confidence = asNum(r.confidence);
        const low = r.lowConfidence === true;
        return (
          <View key={i} style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_600SemiBold",
                  fontSize: 13,
                  textAlign: rtl.textAlign,
                }}
              >
                {fileName}
              </Text>
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "PlusJakartaSans_500Medium",
                  fontSize: 11.5,
                  textAlign: rtl.textAlign,
                }}
              >
                {kindLabel}
              </Text>
            </View>
            <Text
              style={{
                color: low ? c.warning ?? c.mutedForeground : c.success,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 11,
              }}
            >
              {confidence != null ? `${Math.round(confidence * 100)}%` : "—"}
              {low ? (ar ? " — يحتاج تأكيدًا" : " — needs confirmation") : ""}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/* ────────── Task #1163 — account research brief (mobile) ────────── */

// Mobile rendering of the account.brief payload: distilled "Our view"
// headline, executive tensions (with evidence tags), what's changing,
// mandate angles and open questions. The distillation happened
// server-side — never renders raw stress-test fields. Degrades to a
// friendly hint when the account has no brief yet.
function AccountBriefBody({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const name = asStr(data.name);
  const sectionTitle = (label: string) => (
    <Text
      style={{
        color: c.mutedForeground,
        fontFamily: "PlusJakartaSans_600SemiBold",
        fontSize: 10,
        letterSpacing: 1,
        textTransform: "uppercase",
        textAlign: rtl.textAlign,
      }}
    >
      {label}
    </Text>
  );
  const bullet = (text: string, i: number, muted = false) => (
    <Text
      key={i}
      style={{
        color: muted ? c.mutedForeground : c.foreground,
        fontFamily: "PlusJakartaSans_400Regular",
        fontSize: 13,
        textAlign: rtl.textAlign,
      }}
    >
      {"• "}
      {text}
    </Text>
  );
  if (!("hasBrief" in data)) {
    return <FallbackGrid data={data} lang={lang} />;
  }
  if (data.hasBrief !== true) {
    return (
      <View style={{ gap: 4 }}>
        {name ? (
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 14,
              textAlign: rtl.textAlign,
            }}
          >
            {name}
          </Text>
        ) : null}
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_400Regular",
            fontSize: 13,
            textAlign: rtl.textAlign,
          }}
        >
          {ar
            ? "لا يوجد ملخص بحثي لهذا الحساب بعد — شغّل بحث Cartographer من صفحة الحساب."
            : "No research brief yet — run Cartographer research from the account page to generate one."}
        </Text>
      </View>
    );
  }
  const ourView = asStr(data.ourView);
  const claims = (v: unknown) =>
    asArr(v)
      .map((x) => asObj(x))
      .filter((x) => asStr(x.text).trim().length > 0);
  const tensions = claims(data.executiveTensions);
  const whatsChanging = claims(data.whatsChanging);
  const angles = asArr(data.mandateAngles)
    .map((x) => asObj(x))
    .filter((x) => asStr(x.title).trim().length > 0);
  const watchOuts = asArr(data.watchOuts).map(asStr).filter(Boolean);
  const openQuestions = asArr(data.openQuestions).map(asStr).filter(Boolean);
  return (
    <View style={{ gap: 6 }}>
      {name ? (
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 14,
            textAlign: rtl.textAlign,
          }}
        >
          {name}
        </Text>
      ) : null}
      {ourView ? (
        <View style={{ gap: 2 }}>
          <Text
            style={{
              color: "#C9A24E",
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              textAlign: rtl.textAlign,
            }}
          >
            {ar ? "رأينا" : "Our view"}
          </Text>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_400Regular",
              fontSize: 13,
              textAlign: rtl.textAlign,
            }}
          >
            {ourView}
          </Text>
        </View>
      ) : null}
      {tensions.length > 0 ? (
        <View style={{ gap: 2 }}>
          {sectionTitle(ar ? "التوترات التنفيذية" : "Executive tensions")}
          {tensions.slice(0, 5).map((t, i) => bullet(asStr(t.text), i))}
        </View>
      ) : null}
      {whatsChanging.length > 0 ? (
        <View style={{ gap: 2 }}>
          {sectionTitle(ar ? "ما الذي يتغيّر" : "What's changing")}
          {whatsChanging.slice(0, 4).map((w, i) => bullet(asStr(w.text), i, true))}
        </View>
      ) : null}
      {angles.length > 0 ? (
        <View style={{ gap: 2 }}>
          {sectionTitle(ar ? "زوايا الدخول" : "Mandate angles")}
          {angles.slice(0, 4).map((m, i) =>
            bullet(
              asStr(m.tension) ? `${asStr(m.title)} — ${asStr(m.tension)}` : asStr(m.title),
              i,
            ),
          )}
        </View>
      ) : null}
      {watchOuts.length > 0 ? (
        <View style={{ gap: 2 }}>
          {sectionTitle(ar ? "تحذيرات" : "Watch-outs")}
          {watchOuts.slice(0, 4).map((w, i) => bullet(w, i, true))}
        </View>
      ) : null}
      {openQuestions.length > 0 ? (
        <View style={{ gap: 2 }}>
          {sectionTitle(ar ? "أسئلة مفتوحة" : "Open questions")}
          {openQuestions.slice(0, 4).map((q, i) => bullet(q, i, true))}
        </View>
      ) : null}
    </View>
  );
}

/* ────────── Task #745 — traveller picker (mobile) ────────── */

function TravellerPicker({
  data,
  lang,
  onPrompt,
}: {
  data: Json;
  lang: string;
  onPrompt?: (text: string) => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const items = asArr(data.items).map((it) => asObj(it));
  const requester = asObj(data.requester);
  const requesterName = asStr(requester.name);
  const adults = asNum(data.adults) ?? 1;
  const maxPicks = Math.max(0, adults - 1);
  const note = asStr(data.note);

  const [selected, setSelected] = React.useState<Set<string>>(new Set());

  // Dependents first, then colleagues.
  const dependents = items.filter((it) => asStr(it.kind) === "dependent");
  const colleagues = items.filter((it) => asStr(it.kind) !== "dependent");
  const ordered = [...dependents, ...colleagues];

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < maxPicks) {
        next.add(id);
      }
      return next;
    });
  };

  const confirm = () => {
    if (!onPrompt) return;
    let s = `Travellers for this trip: ${requesterName} (self)`;
    for (const it of ordered) {
      if (!selected.has(asStr(it.id))) continue;
      const name = asStr(it.name);
      const rel = asStr(it.relationship) || "colleague";
      s += `, ${name} (${rel})`;
    }
    onPrompt(s);
  };

  const rowBase = {
    flexDirection: rtl.row as "row" | "row-reverse",
    alignItems: "center" as const,
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  };

  return (
    <View style={{ gap: 8 }}>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "PlusJakartaSans_700Bold",
          fontSize: 14,
          textAlign: rtl.textAlign,
        }}
      >
        {ar
          ? `اختر المسافرين (${adults} مسافر)`
          : `Choose travellers (${adults} ${adults === 1 ? "passenger" : "passengers"})`}
      </Text>

      {/* Requester — fixed / always checked */}
      <View
        style={{
          ...rowBase,
          backgroundColor: c.tint08,
          borderColor: c.borderSoft,
        }}
      >
        <Feather name="check-circle" size={18} color={c.primary} />
        <Text
          style={{
            flex: 1,
            color: c.foreground,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 14,
            textAlign: rtl.textAlign,
          }}
        >
          {(ar ? "أنت — " : "You — ") + requesterName}
        </Text>
      </View>

      {ordered.map((it) => {
        const id = asStr(it.id);
        const active = selected.has(id);
        const kind = asStr(it.kind);
        const rel = asStr(it.relationship);
        const title = asStr(it.title);
        const atCap = !active && selected.size >= maxPicks;
        return (
          <Pressable
            key={id}
            onPress={() => toggle(id)}
            disabled={atCap}
            style={{
              ...rowBase,
              backgroundColor: active ? c.tint08 : c.secondary,
              borderColor: active ? c.primary : c.borderSoft,
              opacity: atCap ? 0.45 : 1,
            }}
          >
            <Feather
              name={active ? "check-square" : "square"}
              size={18}
              color={active ? c.primary : c.faint}
            />
            <View style={{ flex: 1 }}>
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 14,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {asStr(it.name)}
                </Text>
                {kind === "dependent" && rel ? (
                  <View
                    style={{
                      backgroundColor: c.elevate2,
                      borderRadius: 999,
                      paddingHorizontal: 8,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        color: c.mutedForeground,
                        fontFamily: "PlusJakartaSans_600SemiBold",
                        fontSize: 10.5,
                      }}
                    >
                      {rel}
                    </Text>
                  </View>
                ) : null}
              </View>
              {kind !== "dependent" && title ? (
                <Text
                  numberOfLines={1}
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_500Medium",
                    fontSize: 12,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {title}
                </Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}

      {note ? (
        <Text
          style={{
            color: c.faint,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 11.5,
            textAlign: rtl.textAlign,
          }}
        >
          {note}
        </Text>
      ) : null}

      {onPrompt ? (
        <Button
          label={ar ? "تأكيد المسافرين" : "Confirm travellers"}
          onPress={confirm}
          icon="check"
        />
      ) : null}
    </View>
  );
}

/* ────────── Task #745 — flight selection card affordances (mobile) ────────── */

function FlightSelectionCard({
  data,
  lang,
  onPrompt,
}: {
  data: Json;
  lang: string;
  onPrompt?: (text: string) => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  const ar = lang === "ar";
  const selection = asObj(data.selection);
  const href = asStr(selection.href);
  const externalUrl = /^https?:\/\//i.test(href) ? href : null;
  const fareOptions = asObj(data.fareOptions);
  const cabinAlternatives = asArr(fareOptions.cabinAlternatives)
    .map((x) => asStr(x))
    .filter(Boolean);

  const cabinHuman = (cabin: string): string =>
    ({
      economy: "Economy",
      premium_economy: "Premium economy",
      business: "Business",
      first: "First",
    })[cabin] ?? humanLabel(cabin);

  return (
    <View style={{ gap: 8 }}>
      <EntityBody data={data} lang={lang} />

      {externalUrl ? (
        <Pressable
          onPress={() => Linking.openURL(externalUrl).catch(() => {})}
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            gap: 6,
            paddingVertical: 4,
          }}
          accessibilityRole="link"
        >
          <Feather name="external-link" size={13} color={c.primary} />
          <Text
            style={{
              color: c.primary,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 13,
            }}
          >
            Open booking link ↗
          </Text>
        </Pressable>
      ) : null}

      {cabinAlternatives.length > 0 && onPrompt ? (
        <View style={{ gap: 6 }}>
          <Text
            style={{
              color: c.faint,
              fontFamily: "PlusJakartaSans_600SemiBold",
              fontSize: 11,
              textAlign: rtl.textAlign,
            }}
          >
            {ar
              ? "خيارات مقصورة أخرى (أسعار حقيقية — لا تتوفر عائلات أسعار)"
              : "Other cabin options (real prices — no fare families available)"}
          </Text>
          <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
            {cabinAlternatives.map((cabin) => (
              <Pressable
                key={cabin}
                onPress={() =>
                  onPrompt(`Show ${cabin} class options for this leg instead`)
                }
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderRadius: 999,
                  backgroundColor: c.secondary,
                  borderWidth: 1,
                  borderColor: c.borderSoft,
                }}
              >
                <Text
                  style={{
                    color: c.secondaryForeground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 12.5,
                  }}
                >
                  {cabinHuman(cabin)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const SHAPE_ICON: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  kpi_strip: "bar-chart-2",
  traveller_picker: "users",
  ranked_list: "list",
  time_series: "trending-up",
  entity_card: "file-text",
  audit_timeline: "clock",
  account_card: "briefcase",
  contact_card: "user",
  opportunity_card: "target",
  meeting_card: "calendar",
  deliverable_card: "package",
  expense_card: "credit-card",
  expense_batch: "credit-card",
  timesheet_card: "clock",
  invoice_card: "file-text",
  gate_report: "shield",
  // Task #853 — AR rollup cards.
  statement_of_account: "book-open",
  pending_invoices: "alert-circle",
  pov_card: "feather",
  ar_aging_grid: "grid",
  // Task #1248 — finance-document ingest/classify.
  supplier_invoice_card: "file-text",
  doc_classification_card: "file",
};

/* ────────── Task #853 — statement of account / pending invoices ────────── */

function StatementOfAccountBody({ data }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const account = asObj(data.account);
  const currencies = asArr(data.currencies) as Json[];
  const rowText = {
    color: c.foreground,
    fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 12,
    textAlign: rtl.textAlign,
  } as const;
  const muteText = { ...rowText, color: c.mutedForeground, fontSize: 11 } as const;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ ...rowText, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" }}>
        {asStr(account.name) || "Account"} — statement of account
      </Text>
      {currencies.length === 0 && <Text style={muteText}>No issued invoices on record.</Text>}
      {currencies.map((cur, ci) => {
        const totals = asObj(cur.totals);
        const aging = asObj(cur.aging);
        const invoices = asArr(cur.invoices) as Json[];
        return (
          <View key={ci} style={{ gap: 4 }}>
            <Text style={muteText}>
              {asStr(cur.currency)} · issued {formatCompact(asNum(totals.issued) ?? 0)} · paid{" "}
              {formatCompact(asNum(totals.paid) ?? 0)}
            </Text>
            <Text style={{ ...rowText, fontFamily: "PlusJakartaSans_600SemiBold" }}>
              Outstanding {asStr(cur.currency)} {formatCompact(asNum(totals.outstanding) ?? 0)}
            </Text>
            <Text style={muteText}>
              Aging — current {formatCompact(asNum(aging.current) ?? 0)} · 1–30 {formatCompact(asNum(aging.d1_30) ?? 0)} · 31–60{" "}
              {formatCompact(asNum(aging.d31_60) ?? 0)} · 61–90 {formatCompact(asNum(aging.d61_90) ?? 0)} · 90+{" "}
              {formatCompact(asNum(aging.d90_plus) ?? 0)}
            </Text>
            {invoices.slice(0, 6).map((inv, ii) => (
              <View key={ii} style={{ flexDirection: rtl.row, justifyContent: "space-between", gap: 8 }}>
                <Text style={{ ...muteText, flexShrink: 1 }} numberOfLines={1}>
                  {asStr(inv.invoiceNumber) || "(no number)"} · {asStr(inv.status)}
                  {(asNum(inv.daysOverdue) ?? 0) > 0 ? ` · ${asNum(inv.daysOverdue)}d overdue` : ""}
                </Text>
                <Text style={rowText}>{formatCompact(asNum(inv.outstanding) ?? 0)}</Text>
              </View>
            ))}
          </View>
        );
      })}
    </View>
  );
}

function PendingInvoicesBody({ data }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
  const scope = asObj(data.scope);
  const invoices = asArr(data.invoices) as Json[];
  const totals = asArr(data.totalsByCurrency) as Json[];
  const rowText = {
    color: c.foreground,
    fontFamily: "PlusJakartaSans_500Medium",
    fontSize: 12,
    textAlign: rtl.textAlign,
  } as const;
  const muteText = { ...rowText, color: c.mutedForeground, fontSize: 11 } as const;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ ...rowText, fontSize: 14, fontFamily: "PlusJakartaSans_600SemiBold" }}>
        Pending invoices — {asStr(scope.label) || "—"}
      </Text>
      {invoices.length === 0 ? (
        <Text style={muteText}>No outstanding invoices — all settled.</Text>
      ) : (
        <>
          <Text style={muteText}>
            {invoices.length} outstanding ·{" "}
            {totals.map((t) => `${asStr(t.currency)} ${formatCompact(asNum(t.amount) ?? 0)}`).join(" · ")}
          </Text>
          {invoices.slice(0, 8).map((inv, i) => (
            <View key={i} style={{ flexDirection: rtl.row, justifyContent: "space-between", gap: 8 }}>
              <Text style={{ ...muteText, flexShrink: 1 }} numberOfLines={1}>
                {asStr(inv.invoiceNumber) || "(no number)"}
                {(asNum(inv.daysOverdue) ?? 0) > 0
                  ? ` · ${asNum(inv.daysOverdue)}d overdue`
                  : ` · due ${asStr(inv.dueDate) || "—"}`}
              </Text>
              <Text style={rowText}>
                {asStr(inv.currency)} {formatCompact(asNum(inv.amountDue) ?? 0)}
              </Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

/**
 * Rich result cards for the chat transcript — the mobile port of the
 * portal's ResultCardRenderers. Renders each tool_result frame with a
 * shape-appropriate treatment and degrades to a key/value grid.
 */
export function ToolResultCards({
  toolResults,
  shapes,
  onPrompt,
}: {
  toolResults: ToolResult[];
  shapes: CapabilityShapes;
  /** Task #745 — fires a normal chat turn (prompt submission). When
   * present, flight result cards become tappable "select" targets and
   * the traveller picker / cabin chips submit follow-up prompts. */
  onPrompt?: (text: string) => void;
}) {
  const c = useColors();
  const { t, lang } = useI18n();
  const rtl = useRTL();
  if (toolResults.length === 0) return null;
  return (
    <View style={{ gap: 10 }}>
      {toolResults.map((tr, i) => {
        const dataObj = asObj(tr.data);
        const shape = asStr(dataObj.shape) || shapes[tr.tool] || null;

        // Clean entity resolutions are implied by the answer — hide.
        if (shape === "entity_resolution" && tr.ok) {
          const opts = asArr(dataObj.options);
          const entity = asObj(dataObj.entity);
          if (opts.length === 0 && entity.id) return null;
        }
        // Silent prelude failures are internal noise.
        if (tr.prelude && !tr.ok) return null;
        // Task #410 — a "clarification pending" tool result is not a real
        // result; the dedicated clarification card is the actual UI. The
        // raw key/value grid ("PREFILL FROM SPECIALIST / CLARIFICATION
        // PENDING / true") is confusing duplicate noise — hide it.
        if (tr.ok && dataObj.clarificationPending === true) return null;

        if (shape === "write_success" && tr.ok) {
          return <WriteSuccess key={`${tr.tool}-${i}`} data={dataObj} lang={lang} />;
        }

        // Task #469 — a not_found is an ordinary answer ("nobody by
        // that name"), not a failure: render it as muted prose, not a
        // red error card.
        const softMiss = !tr.ok && tr.errorCode === "not_found";
        let body: React.ReactNode;
        if (!tr.ok) {
          body = (
            <Text
              style={{
                color: softMiss ? c.mutedForeground : c.destructive,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 13,
                textAlign: rtl.textAlign,
              }}
            >
              {tr.errorMessage || t("common.error")}
            </Text>
          );
        } else {
          switch (shape) {
            case "kpi_strip":
            case "cash_forecast_strip":
              body = <KpiStrip data={dataObj} lang={lang} />;
              break;
            case "traveller_picker":
              // Task #745 — multi-select traveller picker (colleagues +
              // dependents) that submits a follow-up prompt.
              body = <TravellerPicker data={dataObj} lang={lang} onPrompt={onPrompt} />;
              break;
            case "ranked_list":
            case "time_series":
            case "ar_aging_grid":
              body = <RankedList data={dataObj} lang={lang} onPrompt={onPrompt} />;
              break;
            case "audit_timeline":
              body = <AuditTimeline data={dataObj} lang={lang} />;
              break;
            case "entity_card":
              // Task #745 — a flight_selection entity card adds a
              // booking-link affordance and other-cabin chips.
              if (asStr(dataObj.entityType) === "flight_selection") {
                body = <FlightSelectionCard data={dataObj} lang={lang} onPrompt={onPrompt} />;
                break;
              }
              body = <EntityBody data={dataObj} lang={lang} />;
              break;
            case "account_card":
            case "contact_card":
            case "opportunity_card":
            case "charter_card":
            case "section_card":
            case "proposal_card":
            case "qualifier_card":
            case "meeting_card":
            case "deliverable_card":
            case "raid_item":
            case "pov_card":
            case "expense_card":
            case "timesheet_card":
            case "invoice_card":
            case "renewal_card":
            case "change_order_card":
              body = <EntityBody data={dataObj} lang={lang} />;
              break;
            // Task #994 — /recap renders the same tidy card as the
            // proactive "Catching you up" treatment when composed lists
            // exist; legacy trace-only payloads keep the generic grid.
            case "recap_card":
              if (
                asArr(dataObj.accomplishments).length > 0 ||
                asArr(dataObj.openThreads).length > 0
              ) {
                body = <RecapBody data={dataObj} />;
                break;
              }
              body = <FallbackGrid data={dataObj} lang={lang} />;
              break;
            // Task #1163 — account research brief.
            case "account_brief":
              body = <AccountBriefBody data={dataObj} lang={lang} />;
              break;
            // Task #853 — AR rollup cards (universal chat lookups).
            case "statement_of_account":
              body = <StatementOfAccountBody data={dataObj} lang={lang} />;
              break;
            // Task #1248 — finance-document ingest/classify friendly cards.
            case "supplier_invoice_card":
              body = <SupplierInvoiceBody data={dataObj} lang={lang} />;
              break;
            case "doc_classification_card":
              body = <DocClassificationBody data={dataObj} lang={lang} />;
              break;
            case "pending_invoices":
              body = <PendingInvoicesBody data={dataObj} lang={lang} />;
              break;
            default:
              body = <FallbackGrid data={dataObj} lang={lang} />;
          }
        }

        return (
          <Card
            key={`${tr.tool}-${i}`}
            style={{ gap: 10, borderRadius: 8, padding: 12, borderColor: c.border }}
          >
            <CardHeader
              icon={SHAPE_ICON[shape ?? ""] ?? "cpu"}
              title={humanLabel(tr.tool)}
              ok={tr.ok || softMiss}
            />
            {body}
          </Card>
        );
      })}
    </View>
  );
}
