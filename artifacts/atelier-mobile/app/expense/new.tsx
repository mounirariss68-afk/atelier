import { Feather } from "@expo/vector-icons";
import {
  useAtelierCreateMyExpense,
  useAtelierGetExpenseTaxonomy,
  useAtelierGetMyReceiptUploadUrl,
  useAtelierSuggestExpenseCategory,
} from "@workspace/api-client-react";
import type { AtelierSelfExpenseCreate } from "@workspace/api-client-react";
import * as DocumentPicker from "expo-document-picker";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
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
import { apiJson, putFileToSignedUrl } from "@/lib/api";
import { enqueueExpense, isOnline } from "@/lib/offlineQueue";
import { classifyShareFile, consumePendingShare } from "@/lib/pendingShare";
import { runExclusivePick } from "@/lib/pickerGuard";

const today = () => new Date().toISOString().slice(0, 10);

// Task #748 — the read-only demo/reviewer account gets a 403 with a
// machine-readable code on every write; surface a friendly message instead
// of the generic error toast.
function isDemoReadOnly(err: unknown): boolean {
  const e = err as { status?: number; data?: unknown } | null;
  if (!e || e.status !== 403) return false;
  const data = e.data as { error?: string } | null;
  return data?.error === "demo-read-only";
}

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
  const [parseErrorText, setParseErrorText] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  // Task #411 — the auto pipeline creates the draft as soon as a receipt is
  // attached; re-attaching or saving reuses this id (no duplicate records).
  const [draftId, setDraftId] = useState<string | null>(null);

  // Task #477 — pickers launch via the Sheet's `defer` option (runs after the
  // modal has FULLY dismissed — iOS Modal onDismiss), replacing the old fixed
  // 550ms timer that raced the dismissal animation and could leave the native
  // document picker permanently stuck "in progress".

  // Task #411 — pick/pickPdf are memoized, so calling autoProcess directly
  // would freeze the first render's closure (draftId=null) and re-attaching
  // could create a duplicate draft. The ref always points at the latest one.
  const autoProcessRef = React.useRef<(uri: string, mime: string) => Promise<void>>(
    async () => {},
  );

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
      const out = await runExclusivePick(() =>
        mode === "camera"
          ? ImagePicker.launchCameraAsync({ quality: 0.7 })
          : ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7 }),
      );
      if (!out.ok) {
        if (out.reason === "failed") feedback.toast(t("picker.failed"), "error");
        return;
      }
      const res = out.value;
      if (res.canceled || !res.assets[0]) return;
      const asset = res.assets[0];
      void autoProcessRef.current(asset.uri, asset.mimeType ?? "image/jpeg");
    },
    [t, feedback],
  );

  // Task #396 — PDF invoice pickup. The server parses PDFs via text-layer
  // extraction with an OCR fallback.
  const pickPdf = useCallback(async () => {
    const out = await runExclusivePick(() =>
      DocumentPicker.getDocumentAsync({
        type: "application/pdf",
        copyToCacheDirectory: true,
        multiple: false,
      }),
    );
    if (!out.ok) {
      if (out.reason === "failed") feedback.toast(t("picker.failed"), "error");
      return;
    }
    const res = out.value;
    if (res.canceled || !res.assets?.[0]) return;
    const asset = res.assets[0];
    void autoProcessRef.current(asset.uri, asset.mimeType ?? "application/pdf");
  }, [t, feedback]);

  const receiptIsPdf = receiptMime === "application/pdf";

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

  // Task #411 — map server parse error codes onto translated messages.
  const parseErrorMessage = useCallback(
    (code: string | undefined): string => {
      if (code === "receipt-too-large") return t("exp.errTooLarge");
      if (code === "receipt-unreadable") return t("exp.errUnreadable");
      if (code === "auditor-refused") return t("exp.errRefused");
      return t("exp.parseFailed");
    },
    [t],
  );

  // Task #411 — launch the parse in the background and poll: the parse is
  // LLM-heavy (vision + auditor) and a held request would be 502'd by the
  // proxy. Staged progress labels while we wait.
  const runParse = useCallback(
    async (id: string): Promise<void> => {
      await apiJson(`/api/atelier/me/expenses/${id}/parse-receipt-async`, { method: "POST" });
      const started = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 2000));
        const elapsed = Date.now() - started;
        setBusyLabel(
          elapsed > 24000
            ? t("exp.categorizing")
            : elapsed > 10000
              ? t("exp.identifying")
              : t("exp.reading"),
        );
        const s = await apiJson<{
          status: "running" | "done" | "failed" | "none";
          error?: { body?: { error?: string } };
        }>(`/api/atelier/me/expenses/${id}/parse-receipt-status`, {});
        if (s.status === "done") return;
        if (s.status === "failed" || s.status === "none") {
          throw new Error(s.error?.body?.error ?? "parse-failed");
        }
        if (elapsed > 180000) throw new Error("parse-timeout");
      }
    },
    [t],
  );

  // Task #411 — fully automatic pipeline: attach → upload → draft create
  // (or reuse) → parse → review screen. Offline just stages the file; the
  // queue uploads + parses on drain.
  const autoProcess = useCallback(
    async (uri: string, mime: string) => {
      setReceiptUri(uri);
      setReceiptMime(mime);
      setParseFailedId(null);
      setParseErrorText(null);
      if (!(await isOnline())) return;
      setBusy(true);
      let id = draftId;
      try {
        setBusyLabel(t("exp.uploading"));
        const { uploadURL } = await uploadUrl.mutateAsync();
        await putFileToSignedUrl(uploadURL, uri, mime);
        if (id) {
          // Re-attach: swap the receipt on the existing draft, no duplicate.
          await apiJson(`/api/atelier/me/expenses/${id}`, {
            method: "PATCH",
            body: { receiptPath: uploadURL },
          });
        } else {
          setBusyLabel(t("exp.creating"));
          const amt = Number(amount);
          // Task #757 — carry ALL fields the user already typed into the
          // auto-created draft (previously description/category/funding were
          // silently dropped). The parse never overwrites a non-empty
          // description, so a typed description survives the pipeline.
          const created = await create.mutateAsync({
            data: {
              amount: Number.isFinite(amt) && amt > 0 ? amt : 0.01,
              currency: currency.trim().toUpperCase().slice(0, 3) || "USD",
              merchant: merchant.trim() || "Receipt",
              expenseDate: date || today(),
              receiptPath: uploadURL,
              ...(description.trim() ? { description: description.trim() } : {}),
              ...(category.trim() ? { category: category.trim() } : {}),
              ...(categoryCode && subCategoryCode
                ? { categoryCode, subCategoryCode }
                : {}),
              ...(fundingSource
                ? { fundingSource: fundingSource as AtelierSelfExpenseCreate["fundingSource"] }
                : {}),
              ...(fundingSource === "company_account" && fundingBankAccountId
                ? { fundingBankAccountId }
                : {}),
            },
          });
          id = created.expense.id;
          setDraftId(id);
        }
        setBusyLabel(t("exp.reading"));
        await runParse(id);
        hapticSuccess();
        router.replace(`/expense/${id}?parsed=1`);
      } catch (err) {
        hapticError();
        if (isDemoReadOnly(err)) {
          feedback.toast(t("exp.demoReadOnly"), "error");
          return;
        }
        if (id) {
          setParseFailedId(id);
          setParseErrorText(
            parseErrorMessage(err instanceof Error ? err.message : undefined),
          );
        } else {
          feedback.toast(t("common.error"), "error");
        }
      } finally {
        setBusy(false);
        setBusyLabel("");
      }
    },
    [draftId, amount, currency, merchant, date, description, category, categoryCode, subCategoryCode, fundingSource, fundingBankAccountId, uploadUrl, create, runParse, parseErrorMessage, router, t, feedback],
  );
  autoProcessRef.current = autoProcess;

  // Task #748 — a file shared in from the OS share sheet. Consumed once on
  // mount (the pending-share store is one-shot, so a second share while this
  // screen is busy opens a fresh screen instance / new draft — never a
  // duplicate against this one). Validates + converts the file to what the
  // server receipt parser accepts, then feeds the existing pipeline.
  const shareHandledRef = React.useRef(false);
  useEffect(() => {
    if (shareHandledRef.current) return;
    shareHandledRef.current = true;
    const share = consumePendingShare();
    if (!share) return;
    void (async () => {
      const kind = classifyShareFile(share.fileName, share.mime);
      if (kind === "unsupported") {
        hapticError();
        feedback.toast(t("share.unsupported"), "error");
        return;
      }
      let uri = share.uri;
      let mime = kind === "pdf" ? "application/pdf" : share.mime || "image/jpeg";
      if (kind === "heic") {
        // The share sheet delivers HEIC/HEIF raw (unlike the image picker,
        // which transcodes) — convert to JPEG or fail with a clear message.
        try {
          const out = await manipulateAsync(share.uri, [], {
            compress: 0.85,
            format: SaveFormat.JPEG,
          });
          uri = out.uri;
          mime = "image/jpeg";
        } catch {
          hapticError();
          feedback.toast(t("share.heicFailed"), "error");
          return;
        }
      }
      // Pre-flight size guard (server caps: 8MB photo / 15MB PDF). HEIC is
      // exempt — conversion re-encodes and typically shrinks the file.
      const maxBytes = kind === "pdf" ? 15 * 1024 * 1024 : 8 * 1024 * 1024;
      if (kind !== "heic" && share.size != null && share.size > maxBytes) {
        hapticError();
        feedback.toast(t("exp.errTooLarge"), "error");
        return;
      }
      if (!(await isOnline())) {
        // Offline share → enqueue as a NEW expense via the existing queue
        // (never against an existing draft); it syncs when back online.
        try {
          await enqueueExpense({
            localUri: uri,
            mime,
            fields: {
              amount: 0.01,
              currency: "USD",
              merchant: "Receipt",
              expenseDate: today(),
            },
          });
          hapticSuccess();
          feedback.toast(t("exp.offlineBody"), "success");
          router.back();
        } catch {
          hapticError();
          feedback.toast(t("common.error"), "error");
        }
        return;
      }
      void autoProcessRef.current(uri, mime);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(async () => {
    const fields = buildFields();
    if (!fields) return;
    setBusy(true);
    try {
      const online = await isOnline();
      if (!online && !draftId) {
        setBusyLabel(t("exp.saving"));
        await enqueueExpense({ localUri: receiptUri, mime: receiptMime, fields });
        hapticSuccess();
        feedback.toast(t("exp.offlineBody"), "success");
        router.back();
        return;
      }
      if (!online && draftId) {
        // The draft already exists on the server — queuing a create would
        // duplicate it. Be honest: edits need a connection.
        hapticError();
        feedback.toast(t("exp.offlineDraftEdit"), "error");
        return;
      }

      if (draftId) {
        // The auto pipeline already created the draft — just save the edits.
        setBusyLabel(t("exp.saving"));
        await apiJson(`/api/atelier/me/expenses/${draftId}`, {
          method: "PATCH",
          body: fields,
        });
        hapticSuccess();
        router.replace(`/expense/${draftId}`);
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
          await runParse(id);
        } catch (err) {
          // Parse failure is non-fatal but must be surfaced — the user
          // can retry or continue and fill the details manually.
          hapticError();
          setParseFailedId(id);
          setParseErrorText(
            parseErrorMessage(err instanceof Error ? err.message : undefined),
          );
          return;
        }
      }
      hapticSuccess();
      router.replace(`/expense/${id}`);
    } catch (err) {
      hapticError();
      feedback.toast(
        isDemoReadOnly(err) ? t("exp.demoReadOnly") : t("common.error"),
        "error",
      );
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [buildFields, draftId, receiptUri, receiptMime, uploadUrl, create, runParse, parseErrorMessage, router, t, feedback]);

  const retryParse = useCallback(async () => {
    if (!parseFailedId) return;
    setRetrying(true);
    try {
      await runParse(parseFailedId);
      hapticSuccess();
      router.replace(`/expense/${parseFailedId}?parsed=1`);
    } catch (err) {
      hapticError();
      feedback.toast(
        parseErrorMessage(err instanceof Error ? err.message : undefined),
        "error",
      );
    } finally {
      setRetrying(false);
    }
  }, [parseFailedId, runParse, parseErrorMessage, router, feedback]);

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
          {receiptUri && receiptIsPdf ? (
            <Pressable onPress={() => setSourceSheet(true)}>
              <View
                style={{
                  flexDirection: rtl.row,
                  alignItems: "center",
                  gap: 12,
                  padding: 18,
                  borderRadius: 18,
                  borderWidth: 1,
                  borderColor: c.tint25,
                  backgroundColor: c.tint08,
                }}
              >
                <Feather name="file-text" size={24} color={c.primary} />
                <Text
                  style={{
                    flex: 1,
                    color: c.foreground,
                    fontFamily: "PlusJakartaSans_600SemiBold",
                    fontSize: 14,
                    textAlign: rtl.textAlign,
                  }}
                  numberOfLines={1}
                >
                  {t("exp.pdfAttached")}
                </Text>
                <Feather name="chevron-down" size={16} color={c.mutedForeground} />
              </View>
            </Pressable>
          ) : receiptUri ? (
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
                  {parseErrorText ?? t("exp.parseFailed")}
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
          { label: t("exp.takePhoto"), icon: "camera", defer: true, onPress: () => void pick("camera") },
          { label: t("exp.gallery"), icon: "image", defer: true, onPress: () => void pick("library") },
          { label: t("exp.pickPdf"), icon: "file-text", defer: true, onPress: () => void pickPdf() },
        ]}
      />
    </View>
  );
}
