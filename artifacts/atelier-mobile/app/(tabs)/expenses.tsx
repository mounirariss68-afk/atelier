import { Feather } from "@expo/vector-icons";
import { useAtelierListMyExpenses } from "@workspace/api-client-react";
import type { AtelierSelfExpense } from "@workspace/api-client-react";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  WEB_TAB_BAR,
  WEB_TOP_INSET,
  hapticLight,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { flushQueue, getQueueCount } from "@/lib/offlineQueue";

function statusColors(
  status: string,
  c: ReturnType<typeof useColors>,
): { color: string; bg: string } {
  switch (status) {
    case "approved":
    case "reimbursed":
      return { color: c.success, bg: c.secondary };
    case "rejected":
      return { color: c.destructive, bg: c.secondary };
    case "submitted":
      return { color: c.accent, bg: c.secondary };
    default:
      return { color: c.mutedForeground, bg: c.secondary };
  }
}

function policyColor(policyStatus: string, c: ReturnType<typeof useColors>): string {
  if (policyStatus === "red") return c.destructive;
  if (policyStatus === "amber") return c.warning;
  return c.success;
}

function ExpenseRow({ item, onPress }: { item: AtelierSelfExpense; onPress: () => void }) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const sc = statusColors(item.status, c);
  const date = item.expenseDate ?? item.createdAt?.slice(0, 10);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8, flex: 1 }}>
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: policyColor(item.policyStatus, c),
              }}
            />
            <Text
              numberOfLines={1}
              style={{
                color: c.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 16,
                flex: 1,
                textAlign: rtl.textAlign,
              }}
            >
              {item.merchant || t("exp.merchant")}
            </Text>
          </View>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 16,
            }}
          >
            {item.currency} {item.amount.toFixed(2)}
          </Text>
        </View>
        <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              textAlign: rtl.textAlign,
            }}
          >
            {date}
          </Text>
          <Chip label={t(`exp.status.${item.status}`)} color={sc.color} bg={sc.bg} />
        </View>
      </Card>
    </Pressable>
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

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom) + 24;

  const expenses = query.data?.expenses ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: c.background }}>
      <View
        style={{
          flexDirection: rtl.row,
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingTop: topPad,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
        }}
      >
        <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
          {t("exp.title")}
        </Text>
        <IconButton
          icon="plus"
          color={c.primary}
          size={26}
          onPress={() => {
            hapticLight();
            router.push("/expense/new");
          }}
        />
      </View>

      {queued > 0 ? (
        <View
          style={{
            flexDirection: rtl.row,
            alignItems: "center",
            gap: 8,
            marginHorizontal: 16,
            marginTop: 12,
            padding: 12,
            borderRadius: c.radius + 4,
            backgroundColor: c.secondary,
          }}
        >
          <Feather name="cloud-off" size={16} color={c.warning} />
          <Text
            style={{
              color: c.secondaryForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              flex: 1,
              textAlign: rtl.textAlign,
            }}
          >
            {t("exp.queuedBanner", { n: queued })}
          </Text>
        </View>
      ) : null}

      {query.isLoading ? (
        <View style={{ padding: 16, gap: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} style={{ gap: 12 }}>
              <Skeleton height={18} width="60%" />
              <Skeleton height={14} width="40%" />
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
            />
          }
          renderItem={({ item }) => (
            <ExpenseRow item={item} onPress={() => router.push(`/expense/${item.id}`)} />
          )}
        />
      )}
    </View>
  );
}
