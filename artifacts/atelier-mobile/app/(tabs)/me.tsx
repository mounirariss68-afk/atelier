import { Feather } from "@expo/vector-icons";
import {
  getAtelierDownloadMyDocumentUrl,
  useAtelierGetMyProfile,
  useAtelierListMyDocuments,
  useAtelierUploadMyPhoto,
} from "@workspace/api-client-react";
import type { AtelierSelfDocument } from "@workspace/api-client-react";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";

import {
  Button,
  Card,
  Chip,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  WEB_TAB_BAR,
  WEB_TOP_INSET,
  hapticError,
  hapticSuccess,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { API_BASE, authHeader } from "@/lib/api";

function docIcon(kind: string): React.ComponentProps<typeof Feather>["name"] {
  const k = kind.toLowerCase();
  if (k.includes("passport")) return "book";
  if (k.includes("visa") || k.includes("residency") || k.includes("permit")) return "credit-card";
  if (k.includes("id") || k.includes("national")) return "user";
  if (k.includes("contract")) return "file-text";
  if (k.includes("certif") || k.includes("degree")) return "award";
  return "file";
}

function vCard(name: string, title: string, email: string, phone: string): string {
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `N:${name}`,
    `FN:${name}`,
    "ORG:Cognirise",
    title ? `TITLE:${title}` : "",
    email ? `EMAIL;TYPE=WORK:${email}` : "",
    phone ? `TEL;TYPE=CELL:${phone}` : "",
    "END:VCARD",
  ].filter(Boolean);
  return lines.join("\n");
}

export default function MeScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();

  const profile = useAtelierGetMyProfile();
  const docs = useAtelierListMyDocuments();
  const uploadPhoto = useAtelierUploadMyPhoto();

  const [qrOpen, setQrOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const user = profile.data?.user;
  const person = profile.data?.person;

  const name = user?.name ?? person?.fullName ?? "";
  const title = user?.title ?? person?.title ?? "";
  const email = user?.email ?? person?.email ?? "";
  const phone = person?.cellPhones?.[0]?.number ?? "";
  const avatarUrl = user?.avatarUrl ?? person?.avatarUrl ?? null;

  const card = useMemo(() => vCard(name, title, email, phone), [name, title, email, phone]);

  const changePhoto = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t("perm.photos"));
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
      allowsEditing: true,
      aspect: [1, 1],
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    try {
      const file = {
        uri: asset.uri,
        name: asset.fileName ?? `photo_${Date.now()}.jpg`,
        type: asset.mimeType ?? "image/jpeg",
      } as unknown as Blob;
      await uploadPhoto.mutateAsync({ data: { file } });
      await profile.refetch();
      hapticSuccess();
    } catch {
      hapticError();
      Alert.alert(t("common.error"));
    }
  }, [uploadPhoto, profile, t]);

  const openDocument = useCallback(
    async (doc: AtelierSelfDocument) => {
      if (!doc.hasFile) return;
      const path = getAtelierDownloadMyDocumentUrl(doc.id);
      const url = `${API_BASE}${path}`;
      if (Platform.OS === "web") {
        Linking.openURL(url);
        return;
      }
      setDownloadingId(doc.id);
      try {
        const FileSystem = await import("expo-file-system/legacy");
        const Sharing = await import("expo-sharing");
        const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        const safeName = (doc.fileName ?? `${doc.title}`).replace(/[^\w.\-]+/g, "_");
        const dest = `${dir}${Date.now()}_${safeName}`;
        const result = await FileSystem.downloadAsync(url, dest, {
          headers: authHeader(),
        });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(result.uri);
        }
        hapticSuccess();
      } catch {
        hapticError();
        Alert.alert(t("me.downloadFailed"));
      } finally {
        setDownloadingId(null);
      }
    },
    [t],
  );

  const topPad = Platform.OS === "web" ? WEB_TOP_INSET : insets.top + 8;
  const bottomPad = (Platform.OS === "web" ? WEB_TAB_BAR : insets.bottom) + 24;
  const documents = docs.data?.documents ?? [];

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
          {t("me.title")}
        </Text>
        <IconButton icon="maximize" onPress={() => setQrOpen(true)} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: bottomPad }}>
        {profile.isLoading ? (
          <Card style={{ alignItems: "center", gap: 12 }}>
            <Skeleton height={88} width={88} style={{ borderRadius: 44 }} />
            <Skeleton height={18} width="50%" />
            <Skeleton height={14} width="40%" />
          </Card>
        ) : profile.isError ? (
          <ErrorState onRetry={() => profile.refetch()} message={t("common.error")} />
        ) : (
          <Card style={{ alignItems: "center", gap: 10 }}>
            <Pressable onPress={changePhoto} style={{ alignItems: "center" }}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: 88, height: 88, borderRadius: 44 }}
                />
              ) : (
                <View
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: 44,
                    backgroundColor: c.secondary,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 28 }}>
                    {user?.initials ?? name.slice(0, 2).toUpperCase()}
                  </Text>
                </View>
              )}
              <View
                style={{
                  position: "absolute",
                  bottom: 0,
                  right: 0,
                  backgroundColor: c.primary,
                  borderRadius: 14,
                  width: 28,
                  height: 28,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 2,
                  borderColor: c.card,
                }}
              >
                {uploadPhoto.isPending ? (
                  <ActivityIndicator size="small" color={c.primaryForeground} />
                ) : (
                  <Feather name="camera" size={14} color={c.primaryForeground} />
                )}
              </View>
            </Pressable>
            <Text style={{ color: c.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
              {name}
            </Text>
            {title ? (
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
                {title}
              </Text>
            ) : null}
            {email ? (
              <Text style={{ color: c.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {email}
              </Text>
            ) : null}
            <View style={{ height: 4 }} />
            <Button label={t("me.shareCard")} icon="share-2" variant="secondary" onPress={() => setQrOpen(true)} />
          </Card>
        )}

        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 16,
            textAlign: rtl.textAlign,
            marginTop: 4,
          }}
        >
          {t("me.documents")}
        </Text>

        {docs.isLoading ? (
          <View style={{ gap: 12 }}>
            {[0, 1, 2].map((i) => (
              <Card key={i}>
                <Skeleton height={16} width="60%" />
              </Card>
            ))}
          </View>
        ) : docs.isError ? (
          <ErrorState onRetry={() => docs.refetch()} message={t("common.error")} />
        ) : documents.length === 0 ? (
          <EmptyState icon="folder" title={t("me.noDocuments")} body={t("me.noDocumentsBody")} />
        ) : (
          <View style={{ gap: 12 }}>
            {documents.map((doc) => (
              <Pressable
                key={doc.id}
                onPress={() => openDocument(doc)}
                disabled={!doc.hasFile}
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Card style={{ flexDirection: rtl.row, alignItems: "center", gap: 12 }}>
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: c.radius + 2,
                      backgroundColor: c.secondary,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather name={docIcon(doc.kind)} size={20} color={c.primary} />
                  </View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: c.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, textAlign: rtl.textAlign }}
                    >
                      {doc.title}
                    </Text>
                    {typeof doc.daysToExpiry === "number" ? (
                      <Chip
                        label={doc.daysToExpiry < 0 ? t("me.expired") : t("me.expires", { n: doc.daysToExpiry })}
                        color={doc.daysToExpiry < 30 ? c.destructive : c.mutedForeground}
                      />
                    ) : null}
                  </View>
                  {downloadingId === doc.id ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : doc.hasFile ? (
                    <Feather name={Platform.OS === "web" ? "external-link" : "download"} size={18} color={c.mutedForeground} />
                  ) : null}
                </Card>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>

      <Modal visible={qrOpen} animationType="slide" transparent onRequestClose={() => setQrOpen(false)}>
        <Pressable
          onPress={() => setQrOpen(false)}
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", padding: 32 }}
        >
          <Pressable onPress={(e) => e.stopPropagation()}>
            <View style={{ backgroundColor: "#FFFFFF", borderRadius: 20, padding: 24, alignItems: "center", gap: 16 }}>
              <Text style={{ color: "#0A1230", fontFamily: "Inter_700Bold", fontSize: 18 }}>
                {t("me.qrTitle")}
              </Text>
              <View style={{ padding: 12, backgroundColor: "#FFFFFF" }}>
                <QRCode value={card || "BEGIN:VCARD\nEND:VCARD"} size={220} backgroundColor="#FFFFFF" color="#0A1230" />
              </View>
              <Text style={{ color: "#0A1230", fontFamily: "Inter_600SemiBold", fontSize: 16 }}>{name}</Text>
              {title ? (
                <Text style={{ color: "#4A5675", fontFamily: "Inter_400Regular", fontSize: 13 }}>{title}</Text>
              ) : null}
              <Text style={{ color: "#4A5675", fontFamily: "Inter_400Regular", fontSize: 12 }}>
                {t("me.qrHint")}
              </Text>
              <Button label={t("common.close")} variant="secondary" onPress={() => setQrOpen(false)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
