import { Feather } from "@expo/vector-icons";
import { useAtelierListMyExpenses } from "@workspace/api-client-react";
import type { AtelierSelfExpense } from "@workspace/api-client-react";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  RefreshControl,
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
import { flushQueue, getQueueCount } from "@/lib/offlineQueue";

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

export default function ExpensesScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const query = useAtelierListMyExpenses();
  const [queued, setQueued] = useState(0);

  const refreshQueued = useCallback(async () => {
    setQueued(await getQueueCount());
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
      ) : expenses.length === 0 ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <EmptyState icon="credit-card" title={t("exp.empty")} body={t("exp.emptyBody")} />
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
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
          renderItem={({ item, index }) => (
            <ExpenseRow
              item={item}
              index={index}
              onPress={() => router.push(`/expense/${item.id}`)}
            />
          )}
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
