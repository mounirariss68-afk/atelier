import { Feather } from "@expo/vector-icons";
import {
  useAtelierCreateMyExpense,
  useAtelierGetMyReceiptUploadUrl,
  useAtelierParseMyExpenseReceipt,
} from "@workspace/api-client-react";
import type { AtelierSelfExpenseCreate } from "@workspace/api-client-react";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
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
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { HttpError, putFileToSignedUrl } from "@/lib/api";
import { enqueueExpense, isOnline } from "@/lib/offlineQueue";

const today = () => new Date().toISOString().slice(0, 10);

export default function NewExpenseScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const uploadUrl = useAtelierGetMyReceiptUploadUrl();
  const create = useAtelierCreateMyExpense();
  const parse = useAtelierParseMyExpenseReceipt();

  const [sourceSheet, setSourceSheet] = useState(false);
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

  const pick = useCallback(
    async (mode: "camera" | "library") => {
      const perm =
        mode === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t(mode === "camera" ? "perm.camera" : "perm.photos"));
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
    [t],
  );

  const buildFields = useCallback((): AtelierSelfExpenseCreate | null => {
    const amt = Number(amount);
    if (!merchant.trim() || !Number.isFinite(amt) || amt <= 0) {
      // Merchant/amount can be missing when a receipt will be parsed.
      if (!receiptUri) {
        hapticError();
        Alert.alert(t("exp.requiredFields"));
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
    if (description.trim()) fields.description = description.trim();
    return fields;
  }, [amount, merchant, currency, date, category, description, receiptUri, t]);

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
        Alert.alert(t("exp.offlineTitle"), t("exp.offlineBody"));
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
        } catch (err) {
          // 422 / parse failure is non-fatal — user fills details manually.
          if (!(err instanceof HttpError) || err.status !== 422) {
            // still non-fatal; surface a soft note
          }
        }
      }
      hapticSuccess();
      router.replace(`/expense/${id}`);
    } catch {
      hapticError();
      Alert.alert(t("common.error"));
    } finally {
      setBusy(false);
      setBusyLabel("");
    }
  }, [buildFields, receiptUri, receiptMime, uploadUrl, create, parse, router, t]);

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
          </Card>
          </FadeInView>

          {busy ? (
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
