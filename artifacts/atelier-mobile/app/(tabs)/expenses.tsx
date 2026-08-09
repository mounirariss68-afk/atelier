import { Feather } from "@expo/vector-icons";
import { useAtelierListMyExpenses } from "@workspace/api-client-react";
import type { AtelierSelfExpense } from "@workspace/api-client-react";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  FadeInView,
  Glass,
  PressScale,
  Skeleton,
  WEB_TAB_BAR,
  WEB_TOP_INSET,
  softShadow,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { formatMoney } from "@/lib/format";
import { ExpenseCharts } from "@/components/ExpenseCharts";
import { flushQueue, listQueue, type QueuedExpense } from "@/lib/offlineQueue";

function statusStyle(
  status: string,
  c: ReturnType<typeof useColors>,
): { color: string; bg: string } {
  switch (status) {
    case "approved":
    case "reimbursed":
      return { color: c.success, bg: c.successTint };
    case "rejected":
      return { color: c.destructive, bg: c.destructiveTint };
    case "submitted":
      return { color: c.accent, bg: c.tint08 };
    default:
      return { color: c.mutedForeground, bg: c.elevate2 };
  }
}

function categoryIcon(category?: string | null): React.ComponentProps<typeof Feather>["name"] {
  const k = (category ?? "").toLowerCase();
  if (k.includes("travel") || k.includes("flight") || k.includes("air")) return "send";
  if (k.includes("hotel") || k.includes("lodg") || k.includes("accom")) return "home";
  if (k.includes("meal") || k.includes("food") || k.includes("dinner") || k.includes("lunch")) return "coffee";
  if (k.includes("taxi") || k.includes("transport") || k.includes("car") || k.includes("uber")) return "navigation";
  if (k.includes("software") || k.includes("subscript") || k.includes("saas")) return "monitor";
  if (k.includes("office") || k.includes("suppl")) return "briefcase";
  if (k.includes("phone") || k.includes("comm")) return "phone";
  return "credit-card";
}

function PolicyBadge({ policyStatus }: { policyStatus: string }) {
  const c = useColors();
  const { t } = useI18n();
  if (policyStatus === "green") return null;
  const danger = policyStatus === "red";
  return (
    <Chip
      icon={danger ? "x-octagon" : "alert-triangle"}
      label={danger ? t("exp.redTitle") : t("exp.amberTitle")}
      color={danger ? c.destructive : c.warning}
      bg={danger ? c.destructiveTint : c.warningTint}
    />
  );
}

function ExpenseRow({
  item,
  index,
  onPress,
}: {
  item: AtelierSelfExpense;
  index: number;
  onPress: () => void;
}) {
  const c = useColors();
  const { t, lang } = useI18n();
  const rtl = useRTL();
  const sc = statusStyle(item.status, c);
  const date = item.expenseDate ?? item.createdAt?.slice(0, 10);
  return (
    <FadeInView delay={Math.min(index, 8) * 45}>
      <PressScale onPress={onPress}>
        <Card style={{ gap: 12 }}>
          <View
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              gap: 12,
            }}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 15,
                backgroundColor: c.tint08,
                borderWidth: 1,
                borderColor: c.tint25,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name={categoryIcon(item.category)} size={19} color={c.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text
                numberOfLines={1}
                style={{
                  color: c.foreground,
                  fontFamily: "PlusJakartaSans_700Bold",
                  fontSize: 15.5,
                  textAlign: rtl.textAlign,
                }}
              >
                {item.merchant || t("exp.merchant")}
              </Text>
              <Text
                style={{
                  color: c.mutedForeground,
                  fontFamily: "PlusJakartaSans_500Medium",
                  fontSize: 12.5,
                  textAlign: rtl.textAlign,
                }}
              >
                {date}
              </Text>
            </View>
            <Text
              style={{
                color: c.foreground,
                fontFamily: "PlusJakartaSans_800ExtraBold",
                fontSize: 16.5,
                fontVariant: ["tabular-nums"],
              }}
            >
              {formatMoney(item.amount, item.currency, lang)}
            </Text>
          </View>
          <View
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <Chip label={t(`exp.status.${item.status}`)} color={sc.color} bg={sc.bg} />
            <PolicyBadge policyStatus={item.policyStatus} />
          </View>
        </Card>
      </PressScale>
    </FadeInView>
  );
}

// Task #757 — queued offline expense rendered inside its month group.
function QueuedRow({ item }: { item: QueuedExpense }) {
  const c = useColors();
  const { t, lang } = useI18n();
  const rtl = useRTL();
  const date = item.fields.expenseDate ?? item.createdAt.slice(0, 10);
  return (
    <Card style={{ gap: 12, borderStyle: "dashed", borderColor: c.warning }}>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 12 }}>
        <View
          style={{
            width: 44,
            height: 44,
            borderRadius: 15,
            backgroundColor: c.warningTint,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="cloud-off" size={19} color={c.warning} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            numberOfLines={1}
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_700Bold",
              fontSize: 15.5,
              textAlign: rtl.textAlign,
            }}
          >
            {item.fields.merchant || t("exp.merchant")}
          </Text>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_500Medium",
              fontSize: 12.5,
              textAlign: rtl.textAlign,
            }}
          >
            {date}
          </Text>
        </View>
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 16.5,
            fontVariant: ["tabular-nums"],
          }}
        >
          {formatMoney(item.fields.amount, item.fields.currency ?? "USD", lang)}
        </Text>
      </View>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
        <Chip icon="cloud-off" label={t("exp.queuedRow")} color={c.warning} bg={c.warningTint} />
      </View>
    </Card>
  );
}

// ---------------------------------------------------------------------
// Task #757 — status filters. The single server `status` field is split
// into three user-facing axes; each axis is optional (null = all) and
// they combine with AND.
// ---------------------------------------------------------------------
type SubmissionFilter = "draft" | "submitted" | null;
type ApprovalFilter = "pending" | "approved" | "rejected" | null;
type PaymentFilter = "reimbursed" | "unpaid" | null;

function matchesFilters(
  status: string,
  submission: SubmissionFilter,
  approval: ApprovalFilter,
  payment: PaymentFilter,
): boolean {
  if (submission === "draft" && status !== "draft") return false;
  if (submission === "submitted" && status === "draft") return false;
  if (approval === "pending" && status !== "submitted") return false;
  if (approval === "approved" && status !== "approved" && status !== "reimbursed") return false;
  if (approval === "rejected" && status !== "rejected") return false;
  if (payment === "reimbursed" && status !== "reimbursed") return false;
  if (payment === "unpaid" && status !== "approved") return false;
  return true;
}

function FilterChip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: active ? c.primary : c.tint25,
        backgroundColor: active ? c.primary : c.tint08,
      }}
    >
      <Text
        style={{
          color: active ? "#FFFFFF" : c.foreground,
          fontFamily: "PlusJakartaSans_600SemiBold",
          fontSize: 12.5,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------------------------------------------------------------------
// Task #757 — month grouping. Rows are grouped by the month of their
// expense date (falling back to created date), newest month first; the
// current month is expanded by default, others toggle on tap.
// ---------------------------------------------------------------------
type ListRow =
  | { kind: "header"; key: string; monthKey: string; label: string; count: number; total: string; approx: boolean; expanded: boolean }
  | { kind: "expense"; key: string; item: AtelierSelfExpense; index: number }
  | { kind: "queued"; key: string; item: QueuedExpense };

function monthKeyOf(dateStr: string | null | undefined): string {
  const s = (dateStr ?? "").slice(0, 7);
  return /^\d{4}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 7);
}

function monthLabel(monthKey: string, lang: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  try {
    const locale = lang === "ar" ? "ar" : lang === "tr" ? "tr" : "en";
    return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return monthKey;
  }
}

export default function ExpensesScreen() {
  const c = useColors();
  const { t, lang } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = useAtelierListMyExpenses();
  const [queuedItems, setQueuedItems] = useState<QueuedExpense[]>([]);

  const [submission, setSubmission] = useState<SubmissionFilter>(null);
  const [approval, setApproval] = useState<ApprovalFilter>(null);
  const [payment, setPayment] = useState<PaymentFilter>(null);
  const hasFilters = submission !== null || approval !== null || payment !== null;

  const currentMonth = new Date().toISOString().slice(0, 7);
  // Months the user explicitly toggled; current month starts expanded.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isExpanded = useCallback(
    (monthKey: string) => toggled[monthKey] ?? monthKey === currentMonth,
    [toggled, currentMonth],
  );
  const toggleMonth = useCallback((monthKey: string) => {
    setToggled((prev) => ({
      ...prev,
      [monthKey]: !(prev[monthKey] ?? monthKey === currentMonth),
    }));
  }, [currentMonth]);

  const refreshQueued = useCallback(async () => {
    setQueuedItems(await listQueue());
  }, []);

  const syncAndRefresh = useCallback(async () => {
    const synced = await flushQueue();
    await refreshQueued();
    if (synced > 0) query.refetch();
  }, [query, refreshQueued]);

  useEffect(() => {
    syncAndRefresh();
  }, [syncAndRefresh]);

  useFocusEffect(
    useCallback(() => {
      syncAndRefresh();
    }, [syncAndRefresh]),
  );

  const onRefresh = useCallback(async () => {
    await syncAndRefresh();
    await query.refetch();
  }, [query, syncAndRefresh]);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 10;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom + 90) + 24;
  const fabBottom = (Platform.OS === "web" ? WEB_TAB_BAR + 12 : Math.max(insets.bottom, 10) + 80);

  const expenses = query.data?.expenses ?? [];
  // Task #827 — server converts every row into the user's display currency.
  const displayCurrency = query.data?.displayCurrency ?? "USD";
  const queued = queuedItems.length;

  // Queued drafts have no server status yet — they behave like drafts for
  // filtering (visible under All and Draft; hidden by approval/payment
  // filters, which they cannot satisfy yet).
  const queuedVisible = useMemo(
    () =>
      queuedItems.filter(() =>
        matchesFilters("draft", submission, approval, payment),
      ),
    [queuedItems, submission, approval, payment],
  );

  const rows: ListRow[] = useMemo(() => {
    const filtered = expenses.filter((e) =>
      matchesFilters(e.status, submission, approval, payment),
    );
    type Group = { expenses: AtelierSelfExpense[]; queued: QueuedExpense[] };
    const groups = new Map<string, Group>();
    const groupOf = (key: string): Group => {
      let g = groups.get(key);
      if (!g) {
        g = { expenses: [], queued: [] };
        groups.set(key, g);
      }
      return g;
    };
    for (const e of filtered) {
      groupOf(monthKeyOf(e.expenseDate ?? e.createdAt)).expenses.push(e);
    }
    for (const q of queuedVisible) {
      groupOf(monthKeyOf(q.fields.expenseDate ?? q.createdAt)).queued.push(q);
    }
    const keys = Array.from(groups.keys()).sort((a, b) => (a < b ? 1 : -1));
    const out: ListRow[] = [];
    for (const key of keys) {
      const g = groups.get(key)!;
      const count = g.expenses.length + g.queued.length;
      // Task #827 — month totals always render in the user's display
      // currency: server rows carry a converted `display` amount; queued
      // offline drafts (no server FX yet) are included only when already
      // in the display currency, and mark the total as approximate
      // otherwise.
      let sum = 0;
      let approx = false;
      for (const e of g.expenses) {
        if (e.display) {
          sum += e.display.amount;
          if (e.display.converted) approx = true;
        } else if (e.currency === displayCurrency) {
          sum += e.amount;
        } else {
          approx = true;
        }
      }
      for (const q of g.queued) {
        if ((q.fields.currency ?? "USD") === displayCurrency) {
          sum += q.fields.amount;
        } else {
          approx = true;
        }
      }
      const total = count > 0 ? formatMoney(sum, displayCurrency, lang) : "";
      const expanded = isExpanded(key);
      out.push({
        kind: "header",
        key: `h_${key}`,
        monthKey: key,
        label: monthLabel(key, lang),
        count,
        total,
        approx,
        expanded,
      });
      if (expanded) {
        let idx = 0;
        for (const q of g.queued) {
          out.push({ kind: "queued", key: `q_${q.id}`, item: q });
          idx += 1;
        }
        for (const e of g.expenses) {
          out.push({ kind: "expense", key: e.id, item: e, index: idx });
          idx += 1;
        }
      }
    }
    return out;
  }, [expenses, queuedVisible, submission, approval, payment, isExpanded, lang, displayCurrency]);

  const clearFilters = useCallback(() => {
    setSubmission(null);
    setApproval(null);
    setPayment(null);
  }, []);

  const hasAnyData = expenses.length > 0 || queuedItems.length > 0;

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      {/* Dark-island header: stays navy in both themes. */}
      <View
        style={{
          backgroundColor: "#0A1230",
          paddingHorizontal: 20,
          paddingTop: topPad,
          paddingBottom: 18,
          borderBottomLeftRadius: 28,
          borderBottomRightRadius: 28,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: 3,
            backgroundColor: c.primary,
            opacity: 0.9,
          }}
        />
        <Text
          style={{
            color: "#EEF1FA",
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 26,
            letterSpacing: -0.4,
            textAlign: rtl.textAlign,
          }}
        >
          {t("exp.title")}
        </Text>
      </View>

      {queued > 0 ? (
        <Glass
          radius={16}
          style={{
            marginHorizontal: 16,
            marginTop: 14,
            padding: 12,
          }}
        >
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: 11,
                backgroundColor: c.warningTint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="cloud-off" size={15} color={c.warning} />
            </View>
            <Text
              style={{
                color: c.foreground,
                fontFamily: "PlusJakartaSans_600SemiBold",
                fontSize: 13,
                flex: 1,
                textAlign: rtl.textAlign,
              }}
            >
              {t("exp.queuedBanner", { n: queued })}
            </Text>
          </View>
        </Glass>
      ) : null}

      {/* Task #757 — filter chips: submission / approval / payment axes. */}
      {hasAnyData && !query.isLoading && !query.isError ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 12,
            gap: 8,
            flexDirection: rtl.row,
            alignItems: "center",
          }}
          style={{ flexGrow: 0 }}
        >
          <FilterChip
            label={t("exp.filter.all")}
            active={!hasFilters}
            onPress={clearFilters}
          />
          <View style={{ width: 1, height: 18, backgroundColor: c.tint25 }} />
          <FilterChip
            label={t("exp.status.draft")}
            active={submission === "draft"}
            onPress={() => setSubmission(submission === "draft" ? null : "draft")}
          />
          <FilterChip
            label={t("exp.status.submitted")}
            active={submission === "submitted"}
            onPress={() => setSubmission(submission === "submitted" ? null : "submitted")}
          />
          <View style={{ width: 1, height: 18, backgroundColor: c.tint25 }} />
          <FilterChip
            label={t("exp.filter.pending")}
            active={approval === "pending"}
            onPress={() => setApproval(approval === "pending" ? null : "pending")}
          />
          <FilterChip
            label={t("exp.status.approved")}
            active={approval === "approved"}
            onPress={() => setApproval(approval === "approved" ? null : "approved")}
          />
          <FilterChip
            label={t("exp.status.rejected")}
            active={approval === "rejected"}
            onPress={() => setApproval(approval === "rejected" ? null : "rejected")}
          />
          <View style={{ width: 1, height: 18, backgroundColor: c.tint25 }} />
          <FilterChip
            label={t("exp.status.reimbursed")}
            active={payment === "reimbursed"}
            onPress={() => setPayment(payment === "reimbursed" ? null : "reimbursed")}
          />
          <FilterChip
            label={t("exp.filter.unpaid")}
            active={payment === "unpaid"}
            onPress={() => setPayment(payment === "unpaid" ? null : "unpaid")}
          />
        </ScrollView>
      ) : null}

      {query.isLoading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} style={{ gap: 12 }}>
              <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                <Skeleton height={44} width={44} style={{ borderRadius: 15 }} />
                <View style={{ flex: 1, gap: 8 }}>
                  <Skeleton height={16} width="60%" />
                  <Skeleton height={12} width="35%" />
                </View>
              </View>
            </Card>
          ))}
        </View>
      ) : query.isError ? (
        <ErrorState onRetry={() => query.refetch()} message={t("common.error")} />
      ) : !hasAnyData ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState icon="credit-card" title={t("exp.empty")} body={t("exp.emptyBody")} />
        </View>
      ) : rows.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 14 }}>
          <EmptyState icon="filter" title={t("exp.filterEmpty")} body="" />
          <Pressable onPress={clearFilters} style={{ alignSelf: "center" }}>
            <Text
              style={{
                color: c.primary,
                fontFamily: "PlusJakartaSans_700Bold",
                fontSize: 14,
              }}
            >
              {t("exp.filterClear")}
            </Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.key}
          ListHeaderComponent={
            <ExpenseCharts expenses={expenses} displayCurrency={displayCurrency} />
          }
          contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: bottomPad }}
          refreshControl={
            <RefreshControl
              refreshing={query.isRefetching}
              onRefresh={onRefresh}
              tintColor={c.primary}
              colors={[c.primary]}
              progressBackgroundColor={c.card}
            />
          }
          renderItem={({ item: row }) =>
            row.kind === "header" ? (
              <Pressable
                onPress={() => toggleMonth(row.monthKey)}
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 8,
                  paddingHorizontal: 4,
                  paddingTop: 4,
                }}
              >
                <Text
                  style={{
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_800ExtraBold",
                    fontSize: 16,
                    letterSpacing: -0.2,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {row.label}
                </Text>
                <View
                  style={{
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                    borderRadius: 999,
                    backgroundColor: c.tint08,
                    borderWidth: 1,
                    borderColor: c.tint25,
                  }}
                >
                  <Text
                    style={{
                      color: c.mutedForeground,
                      fontFamily: "PlusJakartaSans_600SemiBold",
                      fontSize: 11.5,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {row.count}
                  </Text>
                </View>
                <View style={{ flex: 1 }} />
                {row.total ? (
                  <Text
                    style={{
                      color: c.mutedForeground,
                      fontFamily: "PlusJakartaSans_600SemiBold",
                      fontSize: 12.5,
                      fontVariant: ["tabular-nums"],
                    }}
                  >
                    {row.approx ? `≈ ${row.total}` : row.total}
                  </Text>
                ) : null}
                <Feather
                  name={row.expanded ? "chevron-up" : "chevron-down"}
                  size={17}
                  color={c.mutedForeground}
                />
              </Pressable>
            ) : row.kind === "queued" ? (
              <QueuedRow item={row.item} />
            ) : (
              <ExpenseRow
                item={row.item}
                index={row.index}
                onPress={() => router.push(`/expense/${row.item.id}`)}
              />
            )
          }
        />
      )}

      {/* Floating add button, above the pill tab bar. */}
      <View
        pointerEvents="box-none"
        style={{ position: "absolute", bottom: fabBottom, [rtl.isRTL ? "left" : "right"]: 20 }}
      >
        <PressScale onPress={() => router.push("/expense/new")} scaleTo={0.9}>
          <View
            style={[
              {
                width: 58,
                height: 58,
                borderRadius: 29,
                backgroundColor: c.primary,
                alignItems: "center",
                justifyContent: "center",
              },
              softShadow(c.tint45),
            ]}
          >
            <Feather name="plus" size={26} color="#FFFFFF" />
          </View>
        </PressScale>
      </View>
    </View>
  );
}
