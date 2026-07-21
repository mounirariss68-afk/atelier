import { Feather } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { useFeedback } from "@/components/feedback";
import { runExclusivePick } from "@/lib/pickerGuard";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
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
  PressScale,
  Sheet,
  WEB_TAB_BAR,
  WEB_TOP_INSET,
  softShadow,
} from "@/components/ui";
import { ToolResultCards } from "@/components/ResultCards";
import { useI18n, useRTL } from "@/contexts/I18nContext";
import { useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { MAX_ATTACHMENT_BYTES } from "@/lib/api";
import { type ChatTurn, useCapabilityShapes, useChat } from "@/lib/useChat";

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
                  fontFamily: "PlusJakartaSans_400Regular",
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                {numbered ? `${line.match(/^\s*(\d+)\./)?.[1]}.` : "•"}
              </Text>
            ) : null}
            <Text
              style={{
                color,
                fontFamily: "PlusJakartaSans_400Regular",
                fontSize: 14,
                lineHeight: 20,
                flex: 1,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            >
              {parts.map((p, j) =>
                p.startsWith("**") && p.endsWith("**") ? (
                  <Text key={j} style={{ fontFamily: "PlusJakartaSans_600SemiBold" }}>
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
  const scheme = useThemeScheme();
  const [values, setValues] = useState<Record<string, string>>({});
  const fields = turn.clarification?.fields ?? [];
  return (
    <Card style={{ marginTop: 8, gap: 12 }}>
      {turn.clarification?.question ? (
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_600SemiBold",
            fontSize: 15,
            textAlign: rtl.textAlign,
          }}
        >
          {turn.clarification.question}
        </Text>
      ) : null}
      {fields.map((f) => {
        // Task #410 — normalize both chip sources: server suggestion
        // choices ({id,label} — submit the id) and plain string options.
        const chips: { value: string; label: string }[] =
          f.choices && f.choices.length > 0
            ? f.choices.map((ch) => ({ value: ch.id, label: ch.label }))
            : (f.options ?? []).map((opt) => ({ value: opt, label: opt }));
        return (
        <View key={f.field} style={{ gap: 6 }}>
          {f.label ? (
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 13,
                textAlign: rtl.textAlign,
              }}
            >
              {f.label}
            </Text>
          ) : null}
          {chips.length > 0 ? (
            <View style={{ flexDirection: rtl.row, flexWrap: "wrap", gap: 8 }}>
              {chips.map((opt) => {
                const active = values[f.field] === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    onPress={() => {
                      hapticLight();
                      setValues((v) => ({ ...v, [f.field]: opt.value }));
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
                        fontFamily: "PlusJakartaSans_500Medium",
                        fontSize: 14,
                      }}
                    >
                      {opt.label}
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
              keyboardAppearance={scheme}
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
                fontFamily: "PlusJakartaSans_400Regular",
                fontSize: 15,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            />
          )}
        </View>
        );
      })}
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
  const scheme = useThemeScheme();
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
            fontFamily: "PlusJakartaSans_600SemiBold",
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
            fontFamily: "PlusJakartaSans_400Regular",
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
          keyboardAppearance={scheme}
          style={{
            backgroundColor: c.secondary,
            borderRadius: c.radius + 2,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: c.border,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: c.foreground,
            fontFamily: "PlusJakartaSans_400Regular",
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
  const shapes = useCapabilityShapes();
  return (
    <View style={{ gap: 8, paddingVertical: 8 }}>
      {turn.prompt ? (
        <View style={{ alignItems: rtl.isRTL ? "flex-start" : "flex-end" }}>
          <View
            style={{
              backgroundColor: c.primary,
              borderRadius: 20,
              borderBottomRightRadius: rtl.isRTL ? 20 : 6,
              borderBottomLeftRadius: rtl.isRTL ? 6 : 20,
              paddingHorizontal: 14,
              paddingVertical: 10,
              maxWidth: "85%",
            }}
          >
            <Text
              style={{
                color: "#FFFFFF",
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 14,
                lineHeight: 20,
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
                fontFamily: "PlusJakartaSans_400Regular",
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
          {/* width (not maxWidth) — with alignItems:flex-start the parent
              shrink-wraps its child, and the flex:1 Text rows inside
              MarkdownText then collapse to ~0 width mid-stream, wrapping
              one character per line. A fixed 92% keeps the text bounded
              AND stretched. */}
          <View style={{ width: "92%" }}>
            <MarkdownText text={turn.text} color={c.foreground} />
          </View>
        </View>
      ) : turn.status === "streaming" && turn.trace.length === 0 ? (
        <View style={{ flexDirection: rtl.row, alignItems: "center", gap: 8 }}>
          <ActivityIndicator size="small" color={c.mutedForeground} />
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "PlusJakartaSans_400Regular",
              fontSize: 13,
            }}
          >
            {turn.reconnecting ? t("chat.reconnecting") : t("chat.thinking")}
          </Text>
        </View>
      ) : null}

      {turn.toolResults.length > 0 && turn.status !== "streaming" ? (
        <ToolResultCards toolResults={turn.toolResults} shapes={shapes} />
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
              fontFamily: "PlusJakartaSans_500Medium",
              fontSize: 14,
              textAlign: rtl.textAlign,
            }}
          >
            {turn.errorKind === "network"
              ? t("chat.serverUnreachable")
              : (turn.error ?? t("common.error"))}
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
  const feedback = useFeedback();
  const chat = useChat();
  const scheme = useThemeScheme();
  const [input, setInput] = useState("");
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setKeyboardOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setKeyboardOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
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
    const out = await runExclusivePick(() =>
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.8,
      }),
    );
    if (!out.ok) {
      if (out.reason === "failed") {
        hapticError();
        feedback.toast(t("picker.failed"), "error");
      }
      return;
    }
    const res = out.value;
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
  }, [chat, feedback, t]);

  const pickDocument = useCallback(async () => {
    const out = await runExclusivePick(() =>
      DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true }),
    );
    if (!out.ok) {
      if (out.reason === "failed") {
        hapticError();
        feedback.toast(t("picker.failed"), "error");
      }
      return;
    }
    const res = out.value;
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
  }, [chat, feedback, t]);

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
          backgroundColor: c.background,
        }}
      >
        <IconButton icon="clock" onPress={openHistory} filled />
        <Text
          style={{
            color: c.foreground,
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 18,
            letterSpacing: -0.3,
          }}
        >
          {t("tab.chat")}
        </Text>
        <IconButton icon="edit" onPress={() => chat.newChat()} filled />
      </View>
      <View style={{ height: 2, backgroundColor: c.primary, opacity: 0.85 }} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
        {chat.turns.length === 0 ? (
          // Tapping the empty area outside the input dismisses the keyboard
          // (the FlatList branch handles this via keyboardShouldPersistTaps).
          <Pressable
            style={{ flex: 1, justifyContent: "center" }}
            onPress={() => Keyboard.dismiss()}
            accessible={false}
          >
            <EmptyState
              icon="message-circle"
              title={t("chat.empty")}
              body={t("chat.emptyBody")}
            />
          </Pressable>
        ) : (
          <FlatList
            data={reversed}
            inverted
            keyExtractor={(item) => item.key}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
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
            paddingHorizontal: 12,
            paddingTop: 10,
            // The floating tab bar hides behind the keyboard, so the
            // input only needs tab-bar clearance while the keyboard is
            // closed. When it's open, hug the keyboard instead.
            paddingBottom:
              Platform.OS === "web"
                ? WEB_TAB_BAR + 4
                : keyboardOpen
                  ? 10
                  : Math.max(insets.bottom, 10) + 78,
            backgroundColor: "transparent",
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
                      fontFamily: "PlusJakartaSans_500Medium",
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
            {keyboardOpen && Platform.OS !== "web" ? (
              <IconButton icon="chevron-down" onPress={() => Keyboard.dismiss()} filled />
            ) : (
              <IconButton icon="plus-circle" onPress={() => setAttachSheet(true)} filled />
            )}
            <TextInput
              placeholder={t("chat.placeholder")}
              placeholderTextColor={c.faint}
              value={input}
              onChangeText={setInput}
              keyboardAppearance={scheme}
              multiline
              style={{
                flex: 1,
                maxHeight: 120,
                backgroundColor: c.secondary,
                borderRadius: 22,
                borderWidth: 1,
                borderColor: c.borderSoft,
                paddingHorizontal: 16,
                paddingTop: 11,
                paddingBottom: 11,
                color: c.foreground,
                fontFamily: "PlusJakartaSans_500Medium",
                fontSize: 14,
                textAlign: rtl.textAlign,
                writingDirection: rtl.writingDirection,
              }}
            />
            {chat.busy ? (
              <IconButton icon="square" color={c.destructive} onPress={chat.stop} filled />
            ) : (
              <PressScale onPress={send} scaleTo={0.88}>
                <View
                  style={[
                    {
                      width: 42,
                      height: 42,
                      borderRadius: 21,
                      backgroundColor: c.primary,
                      alignItems: "center",
                      justifyContent: "center",
                    },
                    softShadow(c.tint45),
                  ]}
                >
                  <Feather name="arrow-up" size={20} color="#FFFFFF" />
                </View>
              </PressScale>
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
          { label: t("chat.attachImage"), icon: "image", defer: true, onPress: () => void pickImage() },
          { label: t("chat.attachFile"), icon: "file", defer: true, onPress: () => void pickDocument() },
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
                fontFamily: "PlusJakartaSans_600SemiBold",
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
                      fontFamily: "PlusJakartaSans_500Medium",
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
