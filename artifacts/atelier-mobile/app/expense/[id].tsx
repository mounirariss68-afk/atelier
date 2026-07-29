import { Feather } from "@expo/vector-icons";
import {
  useAtelierDeleteMyExpense,
  useAtelierGetExpenseTaxonomy,
  useAtelierGetMyProfile,
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
import DateTimePicker from "@react-native-community/datetimepicker";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
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
  PickerSheet,
  Sheet,
  Skeleton,
  WEB_TOP_INSET,
  hapticError,
  hapticSuccess,
} from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { HttpError, apiJson } from "@/lib/api";
import { formatMoney } from "@/lib/format";

// Task #757 — compact tappable row that opens a picker sheet (parity with
// the New Expense screen).
function PickerRow({
  label,
  value,
  onPress,
}: {
  label: string;
  value: string;
  onPress: () => void;
}) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: rtl.row,
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: c.tint25,
        backgroundColor: c.tint08,
        gap: 10,
      }}
    >
      <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 12 }}>
        {label}
      </Text>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 6, flexShrink: 1 }}>
        <Text
          numberOfLines={1}
          style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13, flexShrink: 1 }}
        >
          {value}
        </Text>
        <Feather name="chevron-down" size={14} color={c.mutedForeground} />
      </View>
    </Pressable>
  );
}

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
          fontFamily: "PlusJakartaSans_600SemiBold",
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
                fontFamily: "PlusJakartaSans_400Regular",
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
  const { t, lang } = useI18n();
  const rtl = useRTL();
  const feedback = useFeedback();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, parsed } = useLocalSearchParams<{ id: string; parsed?: string }>();

  const list = useAtelierListMyExpenses();
  const profile = useAtelierGetMyProfile();
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
  // Task #757 — parity with the New Expense screen: taxonomy + funding are
  // editable on a draft too, not only at create time.
  const taxonomyQuery = useAtelierGetExpenseTaxonomy();
  const [categoryCode, setCategoryCode] = useState("");
  const [subCategoryCode, setSubCategoryCode] = useState("");
  const [fundingSource, setFundingSource] = useState("personal_claim");
  const [fundingBankAccountId, setFundingBankAccountId] = useState("");
  const [catSheet, setCatSheet] = useState(false);
  const [subSheet, setSubSheet] = useState(false);
  const [fundingSheet, setFundingSheet] = useState(false);
  const [bankSheet, setBankSheet] = useState(false);
  const selectedCat =
    taxonomyQuery.data?.categories.find((cc) => cc.code === categoryCode) ?? null;
  const selectedSub =
    selectedCat?.subCategories.find((s) => s.code === subCategoryCode) ?? null;
  const [contextType, setContextType] = useState<AtelierSelfExpenseCreateContextType>("bd");
  const [accountId, setAccountId] = useState<string | null>(null);
  const [engagementId, setEngagementId] = useState<string | null>(null);
  const [internalLabel, setInternalLabel] = useState("");

  const [ctxSheet, setCtxSheet] = useState(false);
  const [pickSheet, setPickSheet] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
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
    setCategoryCode(expense.categoryCode ?? "");
    setSubCategoryCode(expense.subCategoryCode ?? "");
    setFundingSource(expense.fundingSource ?? "personal_claim");
    setFundingBankAccountId(expense.fundingBankAccountId ?? "");
  }, [expense]);

  // Task #757 — validation parity with the create screen: reject an
  // unparseable/non-positive amount or missing merchant up front instead of
  // silently dropping the field from the PATCH.
  const validate = useCallback((): boolean => {
    const amt = Number(amount);
    if (!merchant.trim() || !Number.isFinite(amt) || amt <= 0) {
      hapticError();
      feedback.toast(t("exp.requiredFields"), "error");
      return false;
    }
    return true;
  }, [amount, merchant, feedback, t]);

  const patchBody = useCallback(() => {
    const amt = Number(amount);
    return {
      merchant: merchant.trim(),
      amount: Number.isFinite(amt) && amt > 0 ? amt : undefined,
      currency: currency.trim().toUpperCase().slice(0, 3),
      expenseDate: date || undefined,
      // Empty string is meaningful here: it clears the field server-side
      // (category falls back to "other", description becomes null).
      category: category.trim(),
      description: description.trim(),
      ...(categoryCode && subCategoryCode ? { categoryCode, subCategoryCode } : {}),
      ...(fundingSource
        ? {
            fundingSource: fundingSource as "personal_claim" | "partner_paid" | "company_account",
            fundingBankAccountId:
              fundingSource === "company_account" && fundingBankAccountId
                ? fundingBankAccountId
                : undefined,
          }
        : {}),
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
    categoryCode,
    subCategoryCode,
    fundingSource,
    fundingBankAccountId,
    contextType,
    accountId,
    engagementId,
    internalLabel,
  ]);

  const save = useCallback(async () => {
    if (!id) return;
    if (!validate()) return;
    try {
      await update.mutateAsync({ id, data: patchBody() });
      await list.refetch();
      hapticSuccess();
      feedback.toast(t("exp.savedDraft"), "success");
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    }
  }, [id, update, patchBody, validate, list, t, feedback]);

  const remove = useCallback(async () => {
    if (!id) return;
    const ok = await feedback.confirm({
      title: t("exp.deleteTitle"),
      message: t("exp.deleteConfirm"),
      confirmLabel: t("common.delete"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await del.mutateAsync({ id });
      await list.refetch();
      hapticSuccess();
      router.back();
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    }
  }, [id, del, list, router, t, feedback]);

  const doSubmit = useCallback(
    async (overrideRationale?: string) => {
      if (!id) return;
      if (!validate()) return;
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
        feedback.toast(t("common.error"), "error");
      }
    },
    [id, update, submit, patchBody, validate, list, router, t, feedback],
  );

  // Task #501 — founding partners may approve/reject their OWN submitted
  // claim (stamped `founder_self` server-side). This screen is self-scoped,
  // so any claim shown here belongs to the viewer.
  const isFounder = profile.data?.user.role === "founding_partner";
  const [selfActing, setSelfActing] = useState(false);

  const selfApprove = useCallback(async () => {
    if (!id) return;
    setSelfActing(true);
    try {
      await apiJson(`/api/atelier/wallet/expenses/${id}/approve`, {
        method: "POST",
        body: {},
      });
      await list.refetch();
      hapticSuccess();
      feedback.toast(t("exp.selfApproved"), "success");
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    } finally {
      setSelfActing(false);
    }
  }, [id, list, t, feedback]);

  const selfReject = useCallback(async () => {
    if (!id) return;
    const ok = await feedback.confirm({
      title: t("exp.selfRejectTitle"),
      message: t("exp.selfRejectConfirm"),
      confirmLabel: t("exp.reject"),
      cancelLabel: t("common.cancel"),
      destructive: true,
    });
    if (!ok) return;
    setSelfActing(true);
    try {
      await apiJson(`/api/atelier/wallet/expenses/${id}/reject`, {
        method: "POST",
        body: { reason: t("exp.selfRejectReason") },
      });
      await list.refetch();
      hapticSuccess();
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    } finally {
      setSelfActing(false);
    }
  }, [id, list, t, feedback]);

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
          paddingBottom: 12,
        }}
      >
        <IconButton
          icon={rtl.isRTL ? "chevron-right" : "chevron-left"}
          onPress={() => router.back()}
          filled
        />
        <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, letterSpacing: -0.3 }}>
          {editable ? t("exp.review") : t("exp.detail")}
        </Text>
        {editable ? (
          <IconButton icon="trash-2" color={c.destructive} onPress={remove} filled />
        ) : (
          <View style={{ width: 40 }} />
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
              <Chip
                label={t(`exp.status.${expense.status}`)}
                color={
                  expense.status === "approved" || expense.status === "reimbursed"
                    ? c.success
                    : expense.status === "rejected"
                      ? c.destructive
                      : expense.status === "submitted"
                        ? c.accent
                        : c.mutedForeground
                }
                bg={
                  expense.status === "approved" || expense.status === "reimbursed"
                    ? c.successTint
                    : expense.status === "rejected"
                      ? c.destructiveTint
                      : expense.status === "submitted"
                        ? c.tint08
                        : c.elevate2
                }
              />
              {expense.approvalRoute === "founder_self" ? (
                <Chip
                  icon="award"
                  label={t("exp.selfApprovedChip")}
                  color={c.warning}
                  bg={c.warningTint}
                />
              ) : null}
              {expense.policyStatus !== "green" ? (
                <Chip
                  icon={expense.policyStatus === "red" ? "x-octagon" : "alert-triangle"}
                  label={expense.policyStatus.toUpperCase()}
                  color={expense.policyStatus === "red" ? c.destructive : c.warning}
                  bg={expense.policyStatus === "red" ? c.destructiveTint : c.warningTint}
                />
              ) : null}
            </View>

            {expense.rejectedReason ? (
              <Card style={{ borderColor: c.destructive, backgroundColor: c.destructiveTint, gap: 6 }}>
                <Text style={{ color: c.destructive, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 14 }}>
                  {t("exp.status.rejected")}
                </Text>
                <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>
                  {expense.rejectedReason}
                </Text>
              </Card>
            ) : null}

            {parsed === "1" && editable ? (
              <Card style={{ borderColor: c.accent, backgroundColor: c.tint08, gap: 8 }}>
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                  <Feather name="zap" size={16} color={c.accent} />
                  <Text
                    style={{
                      flex: 1,
                      color: c.foreground,
                      fontFamily: "PlusJakartaSans_500Medium",
                      fontSize: 13,
                      textAlign: rtl.textAlign,
                    }}
                  >
                    {t("exp.autoReview")}
                  </Text>
                </View>
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
                {Platform.OS === "web" ? (
                  <Field label={t("exp.date")} value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
                ) : (
                  <View style={{ gap: 6 }}>
                    <Text
                      style={{
                        color: c.mutedForeground,
                        fontFamily: "PlusJakartaSans_500Medium",
                        fontSize: 13,
                        textAlign: rtl.textAlign,
                      }}
                    >
                      {t("exp.date")}
                    </Text>
                    <Pressable
                      onPress={() => setDateOpen(true)}
                      style={{
                        backgroundColor: c.secondary,
                        borderRadius: 14,
                        borderWidth: 1.5,
                        borderColor: c.borderSoft,
                        paddingHorizontal: 14,
                        paddingVertical: 15,
                        flexDirection: rtl.row,
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 15 }}>
                        {date || "—"}
                      </Text>
                      <Feather name="calendar" size={18} color={c.mutedForeground} />
                    </Pressable>
                    {dateOpen ? (
                      <DateTimePicker
                        value={date ? new Date(date) : new Date()}
                        mode="date"
                        display={Platform.OS === "ios" ? "inline" : "default"}
                        themeVariant={undefined}
                        onChange={(event, selected) => {
                          if (Platform.OS === "android") setDateOpen(false);
                          if (event.type === "dismissed") {
                            setDateOpen(false);
                            return;
                          }
                          if (selected) {
                            setDate(selected.toISOString().slice(0, 10));
                            if (Platform.OS === "ios") setDateOpen(false);
                          }
                        }}
                      />
                    ) : null}
                  </View>
                )}
                {taxonomyQuery.data ? (
                  <View style={{ gap: 10 }}>
                    <PickerRow
                      label={t("exp.category")}
                      value={selectedCat?.label ?? (category || t("exp.pickCategory"))}
                      onPress={() => setCatSheet(true)}
                    />
                    <PickerRow
                      label={t("exp.subcategory")}
                      value={selectedSub?.label ?? (selectedCat ? t("exp.pickSubcategory") : "—")}
                      onPress={() => selectedCat && setSubSheet(true)}
                    />
                    <PickerRow
                      label={t("exp.funding")}
                      value={t(`exp.funding.${fundingSource}`)}
                      onPress={() => setFundingSheet(true)}
                    />
                    {fundingSource === "company_account" ? (
                      <PickerRow
                        label={t("exp.fundingBank")}
                        value={
                          (taxonomyQuery.data.bankAccounts ?? []).find(
                            (b) => b.id === fundingBankAccountId,
                          )?.label ?? t("exp.fundingBank.select")
                        }
                        onPress={() => setBankSheet(true)}
                      />
                    ) : null}
                  </View>
                ) : (
                  <Field
                    label={t("exp.category")}
                    value={category}
                    onChangeText={setCategory}
                    placeholder={t("exp.categoryPlaceholder")}
                  />
                )}
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
                      fontFamily: "PlusJakartaSans_500Medium",
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
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: c.borderSoft,
                      paddingHorizontal: 14,
                      paddingVertical: 15,
                      flexDirection: rtl.row,
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 15 }}>
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
                      borderRadius: 14,
                      borderWidth: 1.5,
                      borderColor: c.borderSoft,
                      paddingHorizontal: 14,
                      paddingVertical: 15,
                      flexDirection: rtl.row,
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 15 }}>
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
                <ReadRow label={t("exp.amount")} value={formatMoney(expense.amount, expense.currency, lang)} />
                <ReadRow label={t("exp.date")} value={expense.expenseDate ?? "—"} />
                <ReadRow label={t("exp.category")} value={expense.category ?? "—"} />
                {expense.description ? (
                  <ReadRow label={t("exp.description")} value={expense.description} />
                ) : null}
                {expense.summary ? (
                  <ReadRow label={t("exp.summary")} value={expense.summary} />
                ) : null}
                <ReadRow label={t("exp.context")} value={t(`exp.contextType.${expense.contextType}`)} />
              </Card>
            )}

            {blocked ? (
              <Card style={{ borderColor: c.destructive, backgroundColor: c.destructiveTint, gap: 8 }}>
                <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                  <Feather name="x-octagon" size={18} color={c.destructive} />
                  <Text style={{ color: c.destructive, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 15 }}>
                    {t("exp.redTitle")}
                  </Text>
                </View>
                <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>
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

            {expense.status === "submitted" && isFounder ? (
              <View style={{ gap: 10 }}>
                <Text
                  style={{
                    color: c.mutedForeground,
                    fontFamily: "PlusJakartaSans_400Regular",
                    fontSize: 13,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {t("exp.founderSelfHint")}
                </Text>
                <Button
                  label={t("exp.approveOwn")}
                  icon="check-circle"
                  loading={selfActing}
                  onPress={selfApprove}
                />
                <Button
                  label={t("exp.reject")}
                  icon="x-circle"
                  variant="secondary"
                  loading={selfActing}
                  onPress={selfReject}
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

      <PickerSheet
        visible={pickSheet}
        title={contextType === "account" ? t("exp.pickAccount") : t("exp.pickEngagement")}
        cancelLabel={t("common.cancel")}
        searchPlaceholder={t("common.search")}
        emptyLabel={t("common.noResults")}
        onClose={() => setPickSheet(false)}
        items={pickList.map((x) => ({ id: x.id, name: x.name }))}
        selectedId={selectedId}
        onSelect={(item) => {
          if (contextType === "account") setAccountId(item.id);
          else setEngagementId(item.id);
        }}
      />

      {/* Task #757 — taxonomy + funding sheets (parity with New Expense). */}
      <Sheet
        visible={catSheet}
        title={t("exp.pickCategory")}
        cancelLabel={t("common.cancel")}
        onClose={() => setCatSheet(false)}
        options={(taxonomyQuery.data?.categories ?? []).map((cat) => ({
          label: cat.label,
          icon: "tag" as const,
          onPress: () => {
            setCategoryCode(cat.code);
            setSubCategoryCode("");
          },
        }))}
      />
      <Sheet
        visible={subSheet}
        title={t("exp.pickSubcategory")}
        cancelLabel={t("common.cancel")}
        onClose={() => setSubSheet(false)}
        options={(selectedCat?.subCategories ?? []).map((s) => ({
          label: s.label,
          icon: "tag" as const,
          onPress: () => setSubCategoryCode(s.code),
        }))}
      />
      <Sheet
        visible={fundingSheet}
        title={t("exp.funding")}
        cancelLabel={t("common.cancel")}
        onClose={() => setFundingSheet(false)}
        options={(taxonomyQuery.data?.fundingSources ?? ["personal_claim", "partner_paid", "company_account"]).map(
          (fs) => ({
            label: t(`exp.funding.${fs}`),
            icon: "credit-card" as const,
            onPress: () => setFundingSource(fs),
          }),
        )}
      />
      <Sheet
        visible={bankSheet}
        title={t("exp.fundingBank")}
        cancelLabel={t("common.cancel")}
        onClose={() => setBankSheet(false)}
        options={
          (taxonomyQuery.data?.bankAccounts ?? []).length > 0
            ? (taxonomyQuery.data?.bankAccounts ?? []).map((b) => ({
                label: b.label,
                icon: "credit-card" as const,
                onPress: () => setFundingBankAccountId(b.id),
              }))
            : [{ label: t("exp.fundingBank.none"), icon: "credit-card" as const, onPress: () => {} }]
        }
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
      <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 12, textAlign: rtl.textAlign }}>
        {label}
      </Text>
      <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 15, fontVariant: ["tabular-nums"], textAlign: rtl.textAlign }}>
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
        { backgroundColor: c.scrim, justifyContent: "center", padding: 24 },
      ]}
    >
      <Card style={{ gap: 12 }}>
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
          <Feather name="alert-triangle" size={18} color={c.warning} />
          <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 16, flex: 1 }}>
            {t("exp.amberTitle")}
          </Text>
        </View>
        <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_400Regular", fontSize: 13 }}>
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
