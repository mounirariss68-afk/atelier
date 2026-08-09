/**
 * Task #827 — expense analytics charts for the mobile Expenses screen.
 *
 * Two compact charts above the month list, both fed by amounts the server
 * has already converted into the user's display currency (`display` block
 * on each claim):
 *   - current-year spend by category (donut)
 *   - monthly spend (vertical bars, current year)
 *
 * Queued offline drafts are not included — they have no server FX
 * conversion yet, so charting them would invent rates.
 */
import type { AtelierSelfExpense } from "@workspace/api-client-react";
import React, { useMemo } from "react";
import { Text, View } from "react-native";
import Svg, { Circle, G, Path } from "react-native-svg";

import { Card } from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { displayAmountOf } from "@/lib/expenseTotals";

// Task #835 — Cognirise brand palette, sampled from the logo mark's
// purple→magenta→pink→coral gradient (assets/images/cognirise-mark.png),
// ordered so adjacent donut segments stay distinguishable on light and
// dark cards.
const CHART_COLORS = [
  "#CD41B2", // magenta (brand core)
  "#7C3BE0", // deep purple
  "#F25081", // pink
  "#B345F0", // violet
  "#FF7B5A", // coral
  "#8A2C77", // dark magenta (overflow/"Other")
];

/** Locale-formatted number without the currency code (code renders on its own line). */
function formatAmountOnly(amount: number, lang: string): string {
  try {
    const locale = lang === "ar" ? "ar" : lang === "tr" ? "tr" : "en";
    return amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  } catch {
    return amount.toFixed(2);
  }
}

function categoryLabel(cat: string | null | undefined): string {
  const k = (cat ?? "other").replace(/[_-]+/g, " ").trim();
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : "Other";
}

/** Donut segment path (SVG arc) from startAngle to endAngle (radians). */
function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  // Guard: a full circle can't be one arc; cap just below 2π.
  const span = Math.min(end - start, Math.PI * 2 - 0.0001);
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(start + span);
  const y2 = cy + r * Math.sin(start + span);
  const large = span > Math.PI ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

export function ExpenseCharts({
  expenses,
  displayCurrency,
}: {
  expenses: AtelierSelfExpense[];
  displayCurrency: string;
}) {
  const c = useColors();
  const { t, lang } = useI18n();
  const rtl = useRTL();

  const year = new Date().getFullYear();
  const yearPrefix = `${year}-`;

  const yearRows = useMemo(
    () =>
      expenses.filter((e) =>
        ((e.expenseDate ?? e.createdAt) ?? "").startsWith(yearPrefix),
      ),
    [expenses, yearPrefix],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of yearRows) {
      const k = categoryLabel(e.category);
      map.set(k, (map.get(k) ?? 0) + displayAmountOf(e));
    }
    const sorted = Array.from(map.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 5);
    const rest = sorted.slice(5).reduce((s, [, v]) => s + v, 0);
    if (rest > 0) top.push([t("exp.chart.other"), rest]);
    return top;
  }, [yearRows, t]);

  const byMonth = useMemo(() => {
    const totals = new Array(12).fill(0) as number[];
    for (const e of yearRows) {
      const m = Number(((e.expenseDate ?? e.createdAt) ?? "").slice(5, 7));
      if (m >= 1 && m <= 12) totals[m - 1] += displayAmountOf(e);
    }
    return totals;
  }, [yearRows]);

  const categoryTotal = byCategory.reduce((s, [, v]) => s + v, 0);
  const maxMonth = Math.max(...byMonth, 1);
  const lastMonthWithData = byMonth.reduce((last, v, i) => (v > 0 ? i : last), -1);

  if (categoryTotal <= 0) return null;

  const SIZE = 132;
  const R = 52;
  const STROKE = 20;
  // Usable width of the donut hole (inner diameter minus breathing room).
  const HOLE = (R - STROKE / 2) * 2 - 8;
  let angle = -Math.PI / 2;

  const monthShort = (i: number): string => {
    try {
      const locale = lang === "ar" ? "ar" : lang === "tr" ? "tr" : "en";
      return new Date(Date.UTC(year, i, 1))
        .toLocaleDateString(locale, { month: "narrow", timeZone: "UTC" });
    } catch {
      return String(i + 1);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      {/* Category donut */}
      <Card style={{ gap: 10 }}>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 12,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            textAlign: rtl.textAlign,
          }}
        >
          {t("exp.chart.byCategory", { year: String(year) })}
        </Text>
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 16 }}>
          <View style={{ width: SIZE, height: SIZE, alignItems: "center", justifyContent: "center" }}>
            <Svg width={SIZE} height={SIZE}>
              <G>
                <Circle cx={SIZE / 2} cy={SIZE / 2} r={R} stroke={c.tint08} strokeWidth={STROKE} fill="none" />
                {byCategory.map(([label, value], i) => {
                  const frac = value / categoryTotal;
                  const start = angle;
                  const end = angle + frac * Math.PI * 2;
                  angle = end;
                  return (
                    <Path
                      key={label}
                      d={arcPath(SIZE / 2, SIZE / 2, R, start, end)}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={STROKE}
                      strokeLinecap="butt"
                      fill="none"
                    />
                  );
                })}
              </G>
            </Svg>
            {/* Task #835 — two stacked lines (currency, then amount), kept
                inside the donut hole so text never overlaps the ring. */}
            <View style={{ position: "absolute", alignItems: "center", maxWidth: HOLE }}>
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "PlusJakartaSans_700Bold",
                  fontSize: 10.5,
                  letterSpacing: 0.6,
                }}
                numberOfLines={1}
              >
                {displayCurrency}
              </Text>
              <Text
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_800ExtraBold",
                  fontSize: 14,
                  fontVariant: ["tabular-nums"],
                }}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {formatAmountOnly(categoryTotal, lang)}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {byCategory.map(([label, value], i) => (
              <View key={label} style={{ flexDirection: rtl.row, alignItems: "center", gap: 7 }}>
                <View
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 3,
                    backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                  }}
                />
                <Text
                  numberOfLines={1}
                  style={{
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 12,
                    flex: 1,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {label}
                </Text>
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 11.5,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {Math.round((value / categoryTotal) * 100)}%
                </Text>
              </View>
            ))}
          </View>
        </View>
      </Card>

      {/* Monthly bars */}
      <Card style={{ gap: 10 }}>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_700Bold",
            fontSize: 12,
            letterSpacing: 0.4,
            textTransform: "uppercase",
            textAlign: rtl.textAlign,
          }}
        >
          {t("exp.chart.byMonth", { year: String(year) })}
        </Text>
        <View
          style={{
            flexDirection: rtl.row,
            alignItems: "flex-end",
            gap: 5,
            height: 84,
            paddingTop: 4,
          }}
        >
          {byMonth.map((v, i) => {
            const active = i <= (lastMonthWithData < 0 ? 11 : Math.max(lastMonthWithData, new Date().getMonth()));
            const h = v > 0 ? Math.max(6, (v / maxMonth) * 64) : 3;
            return (
              <View key={i} style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <View
                  style={{
                    width: "100%",
                    maxWidth: 18,
                    height: h,
                    borderRadius: 4,
                    backgroundColor: v > 0 ? CHART_COLORS[0] : c.tint08,
                    opacity: active ? 1 : 0.35,
                  }}
                />
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 9.5,
                  }}
                >
                  {monthShort(i)}
                </Text>
              </View>
            );
          })}
        </View>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "PlusJakartaSans_500Medium",
            fontSize: 11,
            textAlign: rtl.textAlign,
          }}
        >
          {t("exp.chart.approxNote", { currency: displayCurrency })}
        </Text>
      </Card>
    </View>
  );
}
