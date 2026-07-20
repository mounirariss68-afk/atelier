import { Feather } from "@expo/vector-icons";
import {
  useAtelierCreateMyExpense,
  useAtelierGetExpenseTaxonomy,
  useAtelierGetMyReceiptUploadUrl,
  useAtelierParseMyExpenseReceipt,
  useAtelierSuggestExpenseCategory,
} from "@workspace/api-client-react";
import type { AtelierSelfExpenseCreate } from "@workspace/api-client-react";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
  FadeInView,
  Field,
  IconButton,
  Sheet,
  WEB_TOP_INSET,
  hapticError,
  hapticSuccess,
} from "@/components/ui";
import { useFeedback } from "@/components/feedback";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { putFileToSignedUrl } from "@/lib/api";
import { enqueueExpense, isOnline } from "@/lib/offlineQueue";

const today = () => new Date().toISOString().slice(0, 10);

// Task #383 — compact tappable row that opens a picker sheet.
function PickerRow({
  label,
  value,
  onPress,
  testID,
}: {
  label: string;
  value: string;
  onPress: () => void;
  testID?: string;
}) {
  const c = useColors();
  const rtl = useRTL();
  return (
    <Pressable
      onPress={onPress}
      testID={testID}
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

export default function NewExpenseScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const feedback = useFeedback();

  const uploadUrl = useAtelierGetMyReceiptUploadUrl();
  const create = useAtelierCreateMyExpense();
  const parse = useAtelierParseMyExpenseReceipt();
  // Task #383 — taxonomy-as-data categories + merchant-memory/AI suggestion.
  const taxonomyQuery = useAtelierGetExpenseTaxonomy();
  const suggestMut = useAtelierSuggestExpenseCategory();

  const [sourceSheet, setSourceSheet] = useState(false);
  const [catSheet, setCatSheet] = useState(false);
  const [subSheet, setSubSheet] = useState(false);
  const [fundingSheet, setFundingSheet] = useState(false);
  const [bankSheet, setBankSheet] = useState(false);
  const [fundingBankAccountId, setFundingBankAccountId] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [subCategoryCode, setSubCategoryCode] = useState("");
  const [fundingSource, setFundingSource] = useState("personal_claim");
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [receiptUri, setReceiptUri] = useState<string | null>(null);
  const [receiptMime, setReceiptMime] = useState<string>("image/jpeg");
  const [merchant, setMerchant] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [date, setDate] = useState(today());
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState("");
  // Set when the receipt was uploaded but AI parsing failed — offers a retry.
  const [parseFailedId, setParseFailedId] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const pick = useCallback(
    async (mode: "camera" | "library") => {
      const perm =
        mode === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        feedback.toast(t(mode === "camera" ? "perm.camera" : "perm.photos"), "error");
        return;
      }
      const res =
        mode === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
          : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 });
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      setReceiptUri(asset.uri);
      setReceiptMime(asset.mimeType ?? "image/jpeg");
    },
    [t, feedback],
  );

  const buildFields = useCallback((): AtelierSelfExpenseCreate | null => {
    const amt = Number(amount);
    if (!merchant.trim() || !Number.isFinite(amt) || amt <= 0) {
      // Merchant/amount can be missing when a receipt will be parsed.
      if (!receiptUri) {
        hapticError();
        feedback.toast(t("exp.requiredFields"), "error");
        return null;
      }
    }
    const fields: AtelierSelfExpenseCreate = {
      amount: Number.isFinite(amt) && amt > 0 ? amt : 0.01,
      currency: currency.trim().toUpperCase().slice(0, 3) || "USD",
      merchant: merchant.trim() || "Receipt",
      expenseDate: date || today(),
    };
    if (category.trim()) fields.category = category.trim();
    if (categoryCode) fields.categoryCode = categoryCode;
    if (subCategoryCode) fields.subCategoryCode = subCategoryCode;
    if (fundingSource) fields.fundingSource = fundingSource as AtelierSelfExpenseCreate["fundingSource"];
    if (fundingSource === "company_account" && fundingBankAccountId) {
      fields.fundingBankAccountId = fundingBankAccountId;
    }
    if (description.trim()) fields.description = description.trim();
    return fields;
  }, [amount, merchant, currency, date, category, categoryCode, subCategoryCode, fundingSource, fundingBankAccountId, description, receiptUri, t, feedback]);

  const taxonomy = taxonomyQuery.data ?? null;
  const selectedCat = taxonomy?.categories.find((cc) => cc.code === categoryCode) ?? null;
  const selectedSub = selectedCat?.subCategories?.find((s) => s.code === subCategoryCode) ?? null;

  const runSuggest = useCallback(async () => {
    if (!merchant.trim() && !description.trim()) return;
    setSuggestNote(null);
    try {
      const r = await suggestMut.mutateAsync({
        data: {
          merchant: merchant.trim() || undefined,
          description: description.trim() || undefined,
          amount: Number(amount) > 0 ? Number(amount) : undefined,
          currency: currency || undefined,
        },
      });
      if (r.suggestion) {
        setCategoryCode(r.suggestion.categoryCode);
        setSubCategoryCode(r.suggestion.subCategoryCode);
        setSuggestNote(
          r.suggestion.source === "merchant_memory" ? t("exp.suggestMemory") : t("exp.suggestAi"),
        );
      } else {
        setSuggestNote(r.aiError ? t("exp.suggestFailed") : t("exp.suggestNone"));
      }
    } catch {
      setSuggestNote(t("exp.suggestFailed"));
    }
  }, [merchant, description, amount, currency, suggestMut, t]);

  const save = useCallback(async () => {
    const fields = buildFields();
    if (!fields) return;
    setBusy(true);
    try {
      const online = await isOnline();
      if (!online) {
        setBusyLabel(t("exp.saving"));
        await enqueueExpense({ localUri: receiptUri, mime: receiptMime, fields });
        hapticSuccess();
        feedback.toast(t("exp.offlineBody"), "success");
        router.back();
        return;
      }

      let receiptPath: string | undefined;
      if (receiptUri) {
        setBusyLabel(t("exp.uploading"));
        const { uploadURL } = await uploadUrl.mutateAsync();
        await putFileToSignedUrl(uploadURL, receiptUri, receiptMime);
        receiptPath = uploadURL;
      }

      setBusyLabel(t("exp.creating"));
      const created = await create.mutateAsync({
        data: { ...fields, receiptPath },
      });
      const id = created.expense.id;

      if (receiptPath) {
        setBusyLabel(t("exp.reading"));
        try {
          await parse.mutateAsync({ id });
        } catch {
          // Parse failure is non-fatal but must be surfaced — the user
          // can retry or continue and fill the details manually.
          hapticError();
          setParseFailedId(id);
          return;
        }
      }
      hapticSuccess();
      router.replace(`/expense/${id}`);
    } catch {
      hapticError();
      feedback.toast(t("common.error"), "error");
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [buildFields, receiptUri, receiptMime, uploadUrl, create, parse, router, t, feedback]);

  const retryParse = useCallback(async () => {
    if (!parseFailedId) return;
    setRetrying(true);
    try {
      await parse.mutateAsync({ id: parseFailedId });
      hapticSuccess();
      router.replace(`/expense/${parseFailedId}`);
    } catch {
      hapticError();
      feedback.toast(t("exp.parseFailed"), "error");
    } finally {
      setRetrying(false);
    }
  }, [parseFailedId, parse, router, t, feedback]);

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;

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
        <IconButton icon="x" onPress={() => router.back()} filled />
        <Text style={{ color: c.foreground, fontFamily: "PlusJakartaSans_800ExtraBold", fontSize: 18, letterSpacing: -0.3 }}>
          {t("exp.new")}
        </Text>
        <View style={{ width: 40 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        <ScrollView
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 48 }}
          keyboardShouldPersistTaps="handled"
        >
          {receiptUri ? (
            <Pressable onPress={() => setSourceSheet(true)}>
              <Image
                source={{ uri: receiptUri }}
                style={{ width: "100%", height: 200, borderRadius: 18 }}
                resizeMode="cover"
              />
            </Pressable>
          ) : (
            <Pressable onPress={() => setSourceSheet(true)}>
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  paddingVertical: 36,
                  borderStyle: "dashed",
                  borderWidth: 1.5,
                  borderColor: c.tint25,
                  borderRadius: 18,
                  backgroundColor: c.tint08,
                }}
              >
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 18,
                    backgroundColor: c.card,
                    borderWidth: 1,
                    borderColor: c.tint25,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather name="camera" size={24} color={c.primary} />
                </View>
                <Text
                  style={{
                    color: c.primary,
                    fontFamily: "PlusJakartaSans_700Bold",
                    fontSize: 14,
                  }}
                >
                  {t("exp.chooseSource")}
                </Text>
              </View>
            </Pressable>
          )}

          <FadeInView delay={60}>
          <Card style={{ gap: 16, padding: 18 }}>
          <Field
            label={t("exp.merchant")}
            value={merchant}
            onChangeText={setMerchant}
            placeholder={t("exp.merchant")}
          />
          <View style={{ flexDirection: rtl.row, gap: 12 }}>
            <View style={{ flex: 2 }}>
              <Field
                label={t("exp.amount")}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="0.00"
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
          {taxonomy ? (
            <View style={{ gap: 10 }}>
              <PickerRow
                label={t("exp.category")}
                value={selectedCat?.label ?? t("exp.pickCategory")}
                onPress={() => setCatSheet(true)}
                testID="exp-category-picker"
              />
              <PickerRow
                label={t("exp.subcategory")}
                value={selectedSub?.label ?? (selectedCat ? t("exp.pickSubcategory") : "—")}
                onPress={() => selectedCat && setSubSheet(true)}
                testID="exp-subcategory-picker"
              />
              <Pressable
                onPress={runSuggest}
                disabled={suggestMut.isPending || (!merchant.trim() && !description.trim())}
                style={{ flexDirection: rtl.row, alignItems: "center", gap: 8, opacity: suggestMut.isPending ? 0.6 : 1 }}
              >
                {suggestMut.isPending ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Feather name="zap" size={14} color={c.primary} />
                )}
                <Text style={{ color: c.primary, fontFamily: "PlusJakartaSans_600SemiBold", fontSize: 13 }}>
                  {t("exp.suggest")}
                </Text>
              </Pressable>
              {suggestNote ? (
                <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 12 }}>
                  {suggestNote}
                </Text>
              ) : null}
              <PickerRow
                label={t("exp.funding")}
                value={t(`exp.funding.${fundingSource}`)}
                onPress={() => setFundingSheet(true)}
                testID="exp-funding-picker"
              />
              {fundingSource === "company_account" ? (
                <PickerRow
                  label={t("exp.fundingBank")}
                  value={
                    (taxonomy?.bankAccounts ?? []).find((b) => b.id === fundingBankAccountId)
                      ?.label ?? t("exp.fundingBank.select")
                  }
                  onPress={() => setBankSheet(true)}
                  testID="exp-funding-bank-picker"
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
          </Card>
          </FadeInView>

          {parseFailedId ? (
            <Card style={{ gap: 12, borderColor: c.destructive }}>
              <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
                <Feather name="alert-triangle" size={16} color={c.destructive} />
                <Text
                  style={{
                    flex: 1,
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 14,
                    textAlign: rtl.textAlign,
                  }}
                >
                  {t("exp.parseFailed")}
                </Text>
              </View>
              {retrying ? (
                <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "center", gap: 10 }}>
                  <ActivityIndicator color={c.primary} />
                  <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 14 }}>
                    {t("exp.reading")}
                  </Text>
                </View>
              ) : (
                <View style={{ flexDirection: rtl.row, gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Button
                      label={t("common.continue")}
                      variant="secondary"
                      onPress={() => router.replace(`/expense/${parseFailedId}`)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button label={t("exp.parseRetry")} icon="refresh-cw" onPress={retryParse} />
                  </View>
                </View>
              )}
            </Card>
          ) : busy ? (
            <View style={{ flexDirection: rtl.row, alignItems: "center", justifyContent: "center", gap: 10 }}>
              <ActivityIndicator color={c.primary} />
              <Text style={{ color: c.mutedForeground, fontFamily: "PlusJakartaSans_500Medium", fontSize: 14 }}>
                {busyLabel}
              </Text>
            </View>
          ) : (
            <Button label={t("exp.saveDraft")} icon="save" onPress={save} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={catSheet}
        title={t("exp.pickCategory")}
        cancelLabel={t("common.cancel")}
        onClose={() => setCatSheet(false)}
        options={(taxonomy?.categories ?? []).map((cat) => ({
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
        options={(taxonomy?.fundingSources ?? ["personal_claim", "partner_paid", "company_account"]).map(
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
          (taxonomy?.bankAccounts ?? []).length > 0
            ? (taxonomy?.bankAccounts ?? []).map((b) => ({
                label: b.label,
                icon: "credit-card" as const,
                onPress: () => setFundingBankAccountId(b.id),
              }))
            : [{ label: t("exp.fundingBank.none"), icon: "credit-card" as const, onPress: () => {} }]
        }
      />
      <Sheet
        visible={sourceSheet}
        title={t("exp.chooseSource")}
        cancelLabel={t("common.cancel")}
        onClose={() => setSourceSheet(false)}
        options={[
          { label: t("exp.takePhoto"), icon: "camera", onPress: () => pick("camera") },
          { label: t("exp.gallery"), icon: "image", onPress: () => pick("library") },
        ]}
      />
    </View>
  );
}
