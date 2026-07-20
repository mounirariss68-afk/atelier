import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, hapticError, hapticSuccess, IconButton } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { HttpError } from "@/lib/api";

export default function ChangePasswordScreen() {
  const c = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { changePassword, mustChangePassword, logout } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (next.length < 10) {
      setError(t("cp.min"));
      return;
    }
    if (next !== confirm) {
      setError(t("cp.mismatch"));
      return;
    }
    setLoading(true);
    try {
      await changePassword(current, next);
      hapticSuccess();
      if (!mustChangePassword) router.back();
    } catch (e) {
      hapticError();
      if (e instanceof HttpError && e.status === 400) {
        const d = e.data as { message?: string } | null;
        setError(d?.message ?? t("common.error"));
      } else {
        setError(t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 28,
          paddingTop: insets.top + 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        {!mustChangePassword ? (
          <View style={{ marginBottom: 8 }}>
            <IconButton icon="chevron-left" onPress={() => router.back()} />
          </View>
        ) : null}

        <View style={{ marginBottom: 28 }}>
          <Feather name="lock" size={36} color={c.primary} />
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 24,
              marginTop: 14,
            }}
          >
            {t("cp.title")}
          </Text>
          {mustChangePassword ? (
            <Text
              style={{
                color: c.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                marginTop: 6,
              }}
            >
              {t("cp.forced")}
            </Text>
          ) : null}
        </View>

        <View style={{ gap: 16 }}>
          <Field
            label={t("cp.current")}
            value={current}
            onChangeText={setCurrent}
            secureTextEntry
            placeholder="••••••••••"
          />
          <Field
            label={t("cp.new")}
            value={next}
            onChangeText={setNext}
            secureTextEntry
            placeholder="••••••••••"
          />
          <Field
            label={t("cp.confirm")}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            placeholder="••••••••••"
          />
          {error ? (
            <Text
              style={{
                color: c.destructive,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
              }}
            >
              {error}
            </Text>
          ) : null}
          <Button
            label={t("cp.update")}
            onPress={onSubmit}
            loading={loading}
            disabled={!current || !next || !confirm}
            icon="check"
          />
          {mustChangePassword ? (
            <Button label={t("set.logout")} onPress={logout} variant="ghost" />
          ) : null}
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
