import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  Button,
  Card,
  Chip,
  EmptyState,
  hapticError,
  hapticLight,
  IconButton,
  Sheet,
  WEB_TOP_INSET,
} from "@/components/ui";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { MAX_ATTACHMENT_BYTES } from "@/lib/api";
import { type ChatTurn, useChat } from "@/lib/useChat";

interface PendingAttachment {
  id: string;
  name: string;
}

/** Very small markdown-ish renderer: bold (**x**) and bullet/numbered lines. */
function MarkdownText({ text, color }: { text: string; color: string }) {
  const rtl = useRTL();
  const lines = text.split(/\r?\n/);
  return (
    <View style={{ gap: 2 }}>
      {lines.map((line, i) => {
        const bullet = /^\s*([-*])\s+/.test(line);
        const numbered = /^\s*\d+\.\s+/.test(line);
        const content = line.replace(/^\s*([-*]|\d+\.)\s+/, "");
        const parts = content.split(/(\*\*[^*]+\*\*)/g);
        return (
          <View
            key={i}
            style={{ flexDirection: rtl.row, gap: 6, alignItems: "flex-start" }}
          >
            {bullet || numbered ? (
              <Text
                style={{
                  color,
                  fontFamily: "Inter_400Regular",
                  fontSize: 15,
                  lineHeight: 22,
                }}
              >
                {numbered ? `${line.match(/^\s*(\d+)\./)?.[1]}.` : "•"}
              </Text>
            ) : null}
            <Text
              style={{
                color,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                lineHeight: 22,
                flex: 1,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            >
              {parts.map((p, j) =>
                p.startsWith("**") && p.endsWith("**") ? (
                  <Text key={j} style={{ fontFamily: "Inter_600SemiBold" }}>
                    {p.slice(2, -2)}
                  </Text>
                ) : (
                  <Text key={j}>{p}</Text>
                ),
              )}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function ClarificationCard({
  turn,
  onSubmit,
}: {
  turn: ChatTurn;
  onSubmit: (values: Record<string, string>) => void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = turn.clarification?.fields ?? [];
  return (
    <Card style={{ marginTop: 8, gap: 12 }}>
      {turn.clarification?.question ? (
        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 15,
            textAlign: rtl.textAlign,
          }}
        >
          {turn.clarification.question}
        </Text>
      ) : null}
      {fields.map((f) => (
        <View key={f.field} style={{ gap: 6 }}>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_500Medium",
              fontSize: 13,
              textAlign: rtl.textAlign,
            }}
          >
            {f.label}
          </Text>
          {f.options && f.options.length > 0 ? (
            <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
              {f.options.map((opt) => {
                const active = values[f.field] === opt;
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      hapticLight();
                      setValues((v) => ({ ...v, [f.field]: opt }));
                    }}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: active ? c.primary : c.secondary,
                    }}
                  >
                    <Text
                      style={{
                        color: active ? c.primaryForeground : c.secondaryForeground,
                        fontFamily: "Inter_500Medium",
                        fontSize: 14,
                      }}
                    >
                      {opt}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <TextInput
              placeholder={f.hint}
              placeholderTextColor={c.mutedForeground}
              value={values[f.field] ?? ""}
              onChangeText={(text) =>
                setValues((v) => ({ ...v, [f.field]: text }))
              }
              style={{
                backgroundColor: c.secondary,
                borderRadius: c.radius + 2,
                borderWidth: StyleSheet.hairlineWidth,
                borderColor: c.border,
                paddingHorizontal: 14,
                paddingVertical: 12,
                color: c.foreground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            />
          )}
        </View>
      ))}
      <Button label={t("chat.send")} onPress={() => onSubmit(values)} icon="send" />
    </Card>
  );
}

function ConfirmCard({
  turn,
  onConfirm,
  onCancel,
}: {
  turn: ChatTurn;
  onConfirm: (typedName?: string) => void;
  onCancel: () => void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const [typed, setTyped] = useState("");
  const p = turn.pending;
  const needName = !!p?.requiresTypedName;
  const canConfirm = !needName || typed.trim().length > 0;
  return (
    <Card style={{ marginTop: 8, gap: 12, borderColor: c.primary }}>
      <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
        <Feather name="alert-circle" size={18} color={c.primary} />
        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 15,
            flex: 1,
            textAlign: rtl.textAlign,
          }}
        >
          {p?.title ?? t("chat.confirmTitle")}
        </Text>
      </View>
      {p?.summary ? (
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 14,
            textAlign: rtl.textAlign,
          }}
        >
          {p.summary}
        </Text>
      ) : null}
      {needName ? (
        <TextInput
          placeholder={t("chat.typeName")}
          placeholderTextColor={c.mutedForeground}
          value={typed}
          onChangeText={setTyped}
          autoCapitalize="words"
          style={{
            backgroundColor: c.secondary,
            borderRadius: c.radius + 2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: c.foreground,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            textAlign: rtl.textAlign,
          }}
        />
      ) : null}
      <View style={{ flexDirection: rtl.row, gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Button label={t("chat.cancel")} onPress={onCancel} variant="secondary" />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            label={t("chat.confirm")}
            onPress={() => onConfirm(needName ? typed.trim() : undefined)}
            disabled={!canConfirm}
            icon="check"
          />
        </View>
      </View>
    </Card>
  );
}

function TurnBlock({
  turn,
  onAnswer,
  onConfirm,
  onCancel,
  onRetry,
}: {
  turn: ChatTurn;
  onAnswer: (key: string, values: Record<string, string>) => void;
  onConfirm: (key: string, typedName?: string) => void;
  onCancel: (key: string) => void;
  onRetry: (prompt: string) => void;
}) {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      {turn.prompt ? (
        <View style={{ alignItems: rtl.isRTL ? "flex-start" : "flex-end" }}>
          <View
            style={{
              backgroundColor: c.primary,
              borderRadius: 18,
              paddingHorizontal: 14,
              paddingVertical: 10,
              maxWidth: "85%",
            }}
          >
            <Text
              style={{
                color: c.primaryForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                lineHeight: 21,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            >
              {turn.prompt}
            </Text>
          </View>
          {turn.attachments && turn.attachments.length > 0 ? (
            <View
              style={{
                flexDirection: rtl.row,
                flexWrap: "wrap",
                gap: 6,
                marginTop: 6,
              }}
            >
              {turn.attachments.map((a) => (
                <Chip key={a.id} label={a.name} />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {turn.trace.length > 0 && turn.status === "streaming" ? (
        <View style={{ gap: 2 }}>
          {turn.trace.slice(-3).map((tr, i) => (
            <Text
              key={i}
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                textAlign: rtl.textAlign,
              }}
            >
              {tr.text}
            </Text>
          ))}
        </View>
      ) : null}

      {turn.text ? (
        <View style={{ alignItems: rtl.isRTL ? "flex-end" : "flex-start" }}>
          <View style={{ maxWidth: "92%" }}>
            <MarkdownText text={turn.text} color={c.foreground} />
          </View>
        </View>
      ) : turn.status === "streaming" && turn.trace.length === 0 ? (
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={c.mutedForeground} />
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
            }}
          >
            {t("chat.thinking")}
          </Text>
        </View>
      ) : null}

      {turn.status === "needs_clarification" ? (
        <ClarificationCard
          turn={turn}
          onSubmit={(values) => onAnswer(turn.key, values)}
        />
      ) : null}

      {turn.status === "needs_confirmation" ? (
        <ConfirmCard
          turn={turn}
          onConfirm={(name) => onConfirm(turn.key, name)}
          onCancel={() => onCancel(turn.key)}
        />
      ) : null}

      {turn.status === "error" ? (
        <Card style={{ marginTop: 4, gap: 10, borderColor: c.destructive }}>
          <Text
            style={{
              color: c.destructive,
              fontFamily: "Inter_500Medium",
              fontSize: 14,
              textAlign: rtl.textAlign,
            }}
          >
            {turn.error ?? t("common.error")}
          </Text>
          <Button
            label={t("chat.retry")}
            variant="secondary"
            icon="refresh-cw"
            onPress={() => onRetry(turn.prompt)}
          />
        </Card>
      ) : null}
    </View>
  );
}

export default function ChatScreen() {
  const c = useColors();
  const { t } = useI18n();
  const rtl = useRTL();
  const insets = useSafeAreaInsets();
  const chat = useChat();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachSheet, setAttachSheet] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const reversed = useMemo(() => [...chat.turns].reverse(), [chat.turns]);

  const openHistory = useCallback(() => {
    setHistoryOpen(true);
    chat.refreshSessions();
  }, [chat]);

  const send = useCallback(() => {
    const prompt = input.trim();
    if (!prompt && attachments.length === 0) return;
    const atts = attachments.map((a) => ({ id: a.id, name: a.name }));
    setInput("");
    setAttachments([]);
    chat.submit(prompt, atts.length > 0 ? atts : undefined);
  }, [input, attachments, chat]);

  const pickImage = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.8,
    });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.fileSize && asset.fileSize > MAX_ATTACHMENT_BYTES) {
      hapticError();
      return;
    }
    setUploading(true);
    try {
      const up = await chat.uploadAttachment({
        uri: asset.uri,
        name: asset.fileName ?? `image_${Date.now()}.jpg`,
        mime: asset.mimeType ?? "image/jpeg",
      });
      setAttachments((a) => [...a, up]);
    } catch {
      hapticError();
    } finally {
      setUploading(false);
    }
  }, [chat]);

  const pickDocument = useCallback(async () => {
    const res = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (res.canceled || !res.assets[0]) return;
    const asset = res.assets[0];
    if (asset.size && asset.size > MAX_ATTACHMENT_BYTES) {
      hapticError();
      return;
    }
    setUploading(true);
    try {
      const up = await chat.uploadAttachment({
        uri: asset.uri,
        name: asset.name,
        mime: asset.mimeType ?? "application/octet-stream",
      });
      setAttachments((a) => [...a, up]);
    } catch {
      hapticError();
    } finally {
      setUploading(false);
    }
  }, [chat]);

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
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: c.border,
          backgroundColor: c.background,
        }}
      >
        <IconButton icon="clock" onPress={openHistory} />
        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 17,
          }}
        >
          {t("tab.chat")}
        </Text>
        <IconButton icon="edit" onPress={() => chat.newChat()} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {chat.turns.length === 0 ? (
          <View style={{ flex: 1, justifyContent: "center" }}>
            <EmptyState
              icon="message-circle"
              title={t("chat.empty")}
              body={t("chat.emptyBody")}
            />
          </View>
        ) : (
          <FlatList
            data={reversed}
            inverted
            keyExtractor={(item) => item.key}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 12 }}
            renderItem={({ item }) => (
              <TurnBlock
                turn={item}
                onAnswer={chat.answerClarification}
                onConfirm={chat.confirm}
                onCancel={chat.cancelConfirmation}
                onRetry={(prompt) => chat.submit(prompt)}
              />
            )}
          />
        )}

        <View
          style={{
            borderTopWidth: StyleSheet.hairlineWidth,
            borderTopColor: c.border,
            paddingHorizontal: 12,
            paddingTop: 10,
            paddingBottom: Platform.OS === "web" ? 12 : Math.max(insets.bottom, 10),
            backgroundColor: c.background,
            gap: 8,
          }}
        >
          {attachments.length > 0 || uploading ? (
            <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
              {attachments.map((a) => (
                <Pressable
                  key={a.id}
                  onPress={() =>
                    setAttachments((list) => list.filter((x) => x.id !== a.id))
                  }
                  style={{
                    flexDirection: rtl.row,
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    borderRadius: 999,
                    backgroundColor: c.secondary,
                  }}
                >
                  <Feather name="paperclip" size={12} color={c.secondaryForeground} />
                  <Text
                    style={{
                      color: c.secondaryForeground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 12,
                      maxWidth: 140,
                    }}
                    numberOfLines={1}
                  >
                    {a.name}
                  </Text>
                  <Feather name="x" size={12} color={c.mutedForeground} />
                </Pressable>
              ))}
              {uploading ? <ActivityIndicator size="small" color={c.primary} /> : null}
            </View>
          ) : null}

          <View style={{ flexDirection: rtl.row, alignItems: "flex-end", gap: 8 }}>
            <IconButton icon="plus-circle" onPress={() => setAttachSheet(true)} />
            <TextInput
              placeholder={t("chat.placeholder")}
              placeholderTextColor={c.mutedForeground}
              value={input}
              onChangeText={setInput}
              multiline
              style={{
                flex: 1,
                maxHeight: 120,
                backgroundColor: c.secondary,
                borderRadius: 20,
                paddingHorizontal: 16,
                paddingTop: 10,
                paddingBottom: 10,
                color: c.foreground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            />
            {chat.busy ? (
              <IconButton icon="square" color={c.destructive} onPress={chat.stop} />
            ) : (
              <IconButton
                icon="arrow-up-circle"
                color={c.primary}
                size={30}
                onPress={send}
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>

      <Sheet
        visible={attachSheet}
        title={t("chat.attachSheet")}
        cancelLabel={t("common.cancel")}
        onClose={() => setAttachSheet(false)}
        options={[
          { label: t("chat.attachImage"), icon: "image", onPress: pickImage },
          { label: t("chat.attachFile"), icon: "file", onPress: pickDocument },
        ]}
      />

      <Modal
        visible={historyOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setHistoryOpen(false)}
      >
        <View style={{ flex: 1, backgroundColor: c.background }}>
          <View
            style={{
              flexDirection: rtl.row,
              alignItems: "center",
              justifyContent: "space-between",
              padding: 16,
              paddingTop: Platform.OS === "web" ? 16 : insets.top + 8,
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: c.border,
            }}
          >
            <Text
              style={{
                color: c.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 17,
              }}
            >
              {t("chat.history")}
            </Text>
            <IconButton icon="x" onPress={() => setHistoryOpen(false)} />
          </View>
          <View style={{ padding: 16 }}>
            <Button
              label={t("chat.newChat")}
              icon="plus"
              onPress={() => {
                chat.newChat();
                setHistoryOpen(false);
              }}
            />
          </View>
          {chat.sessions.length === 0 ? (
            <EmptyState icon="clock" title={t("chat.noSessions")} />
          ) : (
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16 }}>
              {chat.sessions.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => {
                    hapticLight();
                    chat.loadSession(s.id);
                    setHistoryOpen(false);
                  }}
                  style={({ pressed }) => ({
                    paddingVertical: 14,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                    borderBottomColor: c.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text
                    style={{
                      color: c.foreground,
                      fontFamily: "Inter_500Medium",
                      fontSize: 15,
                      textAlign: rtl.textAlign,
                    }}
                    numberOfLines={1}
                  >
                    {s.title ?? t("chat.newChat")}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </Modal>
    </View>
  );
}
