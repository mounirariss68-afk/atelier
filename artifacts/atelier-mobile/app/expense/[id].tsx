import { Feather } from "@expo/vector-icons";
import {
  useAtelierDeleteMyExpense,
  useAtelierListMyExpenseContexts,
  useAtelierListMyExpenses,
  useAtelierSubmitMyExpense,
  useAtelierUpdateMyExpense,
} from "@workspace/api-client-react";
import type {
  AtelierIdName,
  AtelierSelfExpense,
  AtelierSelfExpenseCreateContextType,
} from "@workspace/api-client-react";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Card,
  Chip,
  ErrorState,
  Field,
  IconButton,
  Sheet,
  Skeleton,
  WEB_TOP_INSET,
  hapticError,
  hapticSuccess,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { HttpError } from "@/lib/api";

const CONTEXT_TYPES: AtelierSelfExpenseCreateContextType[] = [
  "bd",
  "account",
  "engagement",
  "internal",
];

function FindingsCard({ findings }: { findings: unknown }) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const list = Array.isArray(findings) ? findings : [];
  if (list.length === 0) return null;
  return (
    <Card style={{ gap: 8 }}>
      <Text
        style={{
          color: c.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 14,
          textAlign: rtl.textAlign,
        }}
      >
        {t("exp.findings")}
      </Text>
      {list.map((f, i) => {
        const item = f as { severity?: string; message?: string; code?: string };
        const sev = item.severity ?? "info";
        const color =
          sev === "red" ? c.destructive : sev === "amber" ? c.warning : c.mutedForeground;
        return (
          <View key={i} style={{ flexDirection: rtl.row, gap: 8, alignItems: "flex-start" }}>
            <Feather name="alert-circle" size={14} color={color} style={{ marginTop: 2 }} />
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                flex: 1,
                textAlign: rtl.textAlign,
              }}
            >
              {item.message ?? item.code ?? JSON.stringify(item)}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

export default function ExpenseDetailScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const list = useAtelierListMyExpenses();
  const contexts = useAtelierListMyExpenseContexts();
  const update = useAtelierUpdateMyExpense();
  const del = useAtelierDeleteMyExpense();
  const submit = useAtelierSubmitMyExpense();

  const expense: AtelierSelfExpense | undefined = useMemo(
    () => list.data?.expenses.find((e) => e.id === id),
    [list.data, id],
  );

  const editable = expense?.status === "draft" || expense?.status === "rejected";

  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [contextType, setContextType] = useState<AtelierSelfExpenseCreateContextType>("bd");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [internalLabel, setInternalLabel] = useState("");

  const [ctxSheet, setCtxSheet] = useState(false);
  const [pickSheet, setPickSheet] = useState(false);
  const [rationaleOpen, setRationaleOpen] = useState(false);
  const [rationale, setRationale] = useState("");
  const [blocked, setBlocked] = useState<unknown | null>(null);
  const [findings, setFindings] = useState<unknown | null>(null);

  useEffect(() => {
    if (!expense) return;
    setMerchant(expense.merchant ?? "");
    setAmount(String(expense.amount));
    setCurrency(expense.currency);
    setDate(expense.expenseDate ?? "");
    setCategory(expense.category ?? "");
    setDescription(expense.description ?? "");
    setContextType((expense.contextType as AtelierSelfExpenseCreateContextType) ?? "bd");
    setAccountId(expense.accountId ?? null);
    setEngagementId(expense.engagementId ?? null);
    setInternalLabel(expense.internalProjectLabel ?? "");
    setFindings(expense.policyFindings ?? null);
  }, [expense]);

  const patchBody = useCallback(() => {
    const amt = Number(amount);
    return {
      merchant: merchant.trim(),
      amount: Number.isFinite(amt) ? amt : undefined,
      currency: currency.trim().toUpperCase().slice(0, 3),
      expenseDate: date || undefined,
      category: category.trim() || undefined,
      description: description.trim() || undefined,
      contextType,
      accountId: contextType === "account" ? accountId ?? undefined : undefined,
      engagementId: contextType === "engagement" ? engagementId ?? undefined : undefined,
      internalProjectLabel:
        contextType === "internal" ? internalLabel.trim() || undefined : undefined,
    };
  }, [
    merchant,
    amount,
    currency,
    date,
    category,
    description,
    contextType,
    accountId,
    engagementId,
    internalLabel,
  ]);

  const save = useCallback(async () => {
    if (!id) return;
    try {
      await update.mutateAsync({ id, data: patchBody() });
      await list.refetch();
      hapticSuccess();
      Alert.alert(t("exp.savedDraft"));
    } catch {
      hapticError();
      Alert.alert(t("common.error"));
    }
  }, [id, update, patchBody, list, t]);

  const remove = useCallback(() => {
    if (!id) return;
    Alert.alert(t("exp.deleteTitle"), t("exp.deleteConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.delete"),
        style: "destructive",
        onPress: async () => {
          try {
            await del.mutateAsync({ id });
            await list.refetch();
            hapticSuccess();
            router.back();
          } catch {
            hapticError();
            Alert.alert(t("common.error"));
          }
        },
      },
    ]);
  }, [id, del, list, router, t]);

  const doSubmit = useCallback(
    async (overrideRationale?: string) => {
      if (!id) return;
      setBlocked(null);
      try {
        await update.mutateAsync({ id, data: patchBody() });
        await submit.mutateAsync({
          id,
          data: overrideRationale ? { overrideRationale } : {},
        });
        await list.refetch();
        hapticSuccess();
        setRationaleOpen(false);
        router.back();
      } catch (err) {
        hapticError();
        if (err instanceof HttpError && err.status === 409) {
          const data = err.data as { error?: string; findings?: unknown };
          setFindings(data.findings ?? null);
          if (data.error === "amber-requires-rationale") {
            setRationaleOpen(true);
          } else {
            setBlocked(data.findings ?? true);
          }
          return;
        }
        Alert.alert(t("common.error"));
      }
    },
    [id, update, submit, patchBody, list, router, t],
  );

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;

  const accounts = contexts.data?.accounts ?? [];
  const engagements = contexts.data?.engagements ?? [];
  const pickList: AtelierIdName[] = contextType === "account" ? accounts : engagements;
  const selectedId = contextType === "account" ? accountId : engagementId;
  const selectedName =
    pickList.find((x) => x.id === selectedId)?.name ??
    (contextType === "account" ? t("exp.pickAccount") : t("exp.pickEngagement"));

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
        <IconButton icon="chevron-left" onPress={() => router.back()} />
        <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
          {editable ? t("exp.review") : t("exp.detail")}
        </Text>
        {editable ? (
          <IconButton icon="trash-2" color={c.destructive} onPress={remove} />
        ) : (
          <View style={{ width: 30 }} />
        )}
      </View>

      {list.isLoading ? (
        <View style={{ padding: 16, gap: 12 }}>
          <Skeleton height={48} />
          <Skeleton height={48} />
          <Skeleton height={48} />
        </View>
      ) : !expense ? (
        <ErrorState message={t("exp.notFound")} onRetry={() => list.refetch()} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}>
            <View style={{ flexDirection: rtl.row, gap: 8, flexWrap: "wrap" }}>
              <Chip label={t(`exp.status.${expense.status}`)} />
              {expense.policyStatus !== "green" ? (
                <Chip
                  label={expense.policyStatus.toUpperCase()}
                  color={expense.policyStatus === "red" ? c.destructive : c.warning}
                />
              ) : null}
            </View>

            {expense.rejectedReason ? (
              <Card style={{ borderColor: c.destructive, gap: 6 }}>
                <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                  {t("exp.status.rejected")}
                </Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                  {expense.rejectedReason}
                </Text>
              </Card>
            ) : null}

            {editable ? (
              <>
                <Field label={t("exp.merchant")} value={merchant} onChangeText={setMerchant} />
                <View style={{ flexDirection: rtl.row, gap: 12 }}>
                  <View style={{ flex: 2 }}>
                    <Field
                      label={t("exp.amount")}
                      value={amount}
                      onChangeText={setAmount}
                      keyboardType="decimal-pad"
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={t("exp.currency")}
                      value={currency}
                      onChangeText={setCurrency}
                      autoCapitalize="characters"
                      maxLength={3}
                    />
                  </View>
                </View>
                <Field label={t("exp.date")} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
                <Field
                  label={t("exp.category")}
                  value={category}
                  onChangeText={setCategory}
                  placeholder={t("exp.categoryPlaceholder")}
                />
                <Field
                  label={t("exp.description")}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  style={{ minHeight: 72, textAlignVertical: "top" }}
                />

                <View style={{ gap: 6 }}>
                  <Text
                    style={{
                      color: c.mutedForeground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 13,
                      textAlign: rtl.textAlign,
                    }}
                  >
                    {t("exp.context")}
                  </Text>
                  <Pressable
                    onPress={() => setCtxSheet(true)}
                    style={{
                      backgroundColor: c.secondary,
                      borderRadius: c.radius + 2,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      paddingHorizontal: 14,
                      paddingVertical: 14,
                      flexDirection: rtl.row,
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                      {t(`exp.contextType.${contextType}`)}
                    </Text>
                    <Feather name="chevron-down" size={18} color={c.mutedForeground} />
                  </Pressable>
                </View>

                {contextType === "account" || contextType === "engagement" ? (
                  <Pressable
                    onPress={() => setPickSheet(true)}
                    style={{
                      backgroundColor: c.secondary,
                      borderRadius: c.radius + 2,
                      borderWidth: StyleSheet.hairlineWidth,
                      borderColor: c.border,
                      paddingHorizontal: 14,
                      paddingVertical: 14,
                      flexDirection: rtl.row,
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                      {selectedName}
                    </Text>
                    <Feather name="chevron-down" size={18} color={c.mutedForeground} />
                  </Pressable>
                ) : null}
                {contextType === "internal" ? (
                  <Field
                    label={t("exp.internalLabel")}
                    value={internalLabel}
                    onChangeText={setInternalLabel}
                  />
                ) : null}
              </>
            ) : (
              <Card style={{ gap: 12 }}>
                <ReadRow label={t("exp.merchant")} value={expense.merchant ?? "—"} />
                <ReadRow label={t("exp.amount")} value={`${expense.currency} ${expense.amount.toFixed(2)}`} />
                <ReadRow label={t("exp.date")} value={expense.expenseDate ?? "—"} />
                <ReadRow label={t("exp.category")} value={expense.category ?? "—"} />
                {expense.description ? (
                  <ReadRow label={t("exp.description")} value={expense.description} />
                ) : null}
                <ReadRow label={t("exp.context")} value={t(`exp.contextType.${expense.contextType}`)} />
              </Card>
            )}

            {blocked ? (
              <Card style={{ borderColor: c.destructive, gap: 8 }}>
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                  <Feather name="x-octagon" size={18} color={c.destructive} />
                  <Text style={{ color: c.destructive, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                    {t("exp.redTitle")}
                  </Text>
                </View>
                <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                  {t("exp.blockedBody")}
                </Text>
              </Card>
            ) : null}

            <FindingsCard findings={findings} />

            {editable ? (
              <View style={{ gap: 10 }}>
                <Button
                  label={t("exp.saveDraft")}
                  icon="save"
                  variant="secondary"
                  loading={update.isPending}
                  onPress={save}
                />
                <Button
                  label={t("exp.submit")}
                  icon="send"
                  loading={submit.isPending}
                  onPress={() => doSubmit()}
                />
              </View>
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}

      <Sheet
        visible={ctxSheet}
        title={t("exp.context")}
        cancelLabel={t("common.cancel")}
        onClose={() => setCtxSheet(false)}
        options={CONTEXT_TYPES.map((ct) => ({
          label: t(`exp.contextType.${ct}`),
          onPress: () => {
            setContextType(ct);
            if (ct === "account") setEngagementId(null);
            if (ct === "engagement") setAccountId(null);
          },
        }))}
      />

      <Sheet
        visible={pickSheet}
        title={contextType === "account" ? t("exp.pickAccount") : t("exp.pickEngagement")}
        cancelLabel={t("common.cancel")}
        onClose={() => setPickSheet(false)}
        options={pickList.map((x) => ({
          label: x.name,
          onPress: () => {
            if (contextType === "account") setAccountId(x.id);
            else setEngagementId(x.id);
          },
        }))}
      />

      <RationaleModal
        visible={rationaleOpen}
        value={rationale}
        onChange={setRationale}
        onClose={() => setRationaleOpen(false)}
        onSubmit={() => doSubmit(rationale.trim())}
        loading={submit.isPending}
      />
    </View>
  );
}

function ReadRow({ label, value }: { label: string; value: string }) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12, textAlign: rtl.textAlign }}>
        {label}
      </Text>
      <Text style={{ color: c.foreground, fontFamily: "Inter_500Medium", fontSize: 15, textAlign: rtl.textAlign }}>
        {value}
      </Text>
    </View>
  );
}

function RationaleModal({
  visible,
  value,
  onChange,
  onClose,
  onSubmit,
  loading,
}: {
  visible: boolean;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  loading?: boolean;
}) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  if (!visible) return null;
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "center", padding: 24 },
      ]}
    >
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
          <Feather name="alert-triangle" size={18} color={c.warning} />
          <Text style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16, flex: 1 }}>
            {t("exp.amberTitle")}
          </Text>
        </View>
        <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
          {t("exp.amberBody")}
        </Text>
        <Field
          label={t("exp.rationale")}
          value={value}
          onChangeText={onChange}
          multiline
          style={{ minHeight: 72, textAlignVertical: "top" }}
        />
        <View style={{ flexDirection: rtl.row, gap: 10 }}>
          <View style={{ flex: 1 }}>
            <Button label={t("common.cancel")} variant="secondary" onPress={onClose} />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t("exp.overrideResubmit")}
              icon="send"
              loading={loading}
              disabled={value.trim().length === 0}
              onPress={onSubmit}
            />
          </View>
        </View>
      </Card>
    </View>
  );
}
