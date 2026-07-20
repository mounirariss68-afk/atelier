import { Feather } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { Card } from "@/components/ui";
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
]);

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

function RankedList({ data, lang }: { data: Json; lang: string }) {
  const c = useColors();
  const rtl = useRTL();
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
  return (
    <View style={{ gap: 2 }}>
      {rows.slice(0, 8).map((r, i) => {
        const label =
          asStr(r.name) || asStr(r.title) || asStr(r.label) || asStr(r.account) || `#${i + 1}`;
        // Task #469 — split monetary fields from plain counts/scores so
        // "count: 3" never renders as "$3".
        const moneyRaw = r.weightedValueUsd ?? r.value ?? r.amount ?? r.totalValue;
        const valueRaw = moneyRaw ?? r.count ?? r.score;
        const valueKey = moneyRaw != null ? "valueUsd" : "count";
        const sub = asStr(r.stage ?? r.status ?? r.owner ?? r.subtitle);
        return (
          <View
            key={i}
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              gap: 10,
              paddingVertical: 8,
              borderBottomWidth: i < Math.min(rows.length, 8) - 1 ? 1 : 0,
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
          </View>
        );
      })}
    </View>
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

const SHAPE_ICON: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  kpi_strip: "bar-chart-2",
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
};

/**
 * Rich result cards for the chat transcript — the mobile port of the
 * portal's ResultCardRenderers. Renders each tool_result frame with a
 * shape-appropriate treatment and degrades to a key/value grid.
 */
export function ToolResultCards({
  toolResults,
  shapes,
}: {
  toolResults: ToolResult[];
  shapes: CapabilityShapes;
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
            case "ranked_list":
            case "time_series":
            case "ar_aging_grid":
              body = <RankedList data={dataObj} lang={lang} />;
              break;
            case "audit_timeline":
              body = <AuditTimeline data={dataObj} lang={lang} />;
              break;
            case "entity_card":
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
