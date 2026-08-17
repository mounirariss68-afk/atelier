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

import { Button, Card, FadeInView, Field, hapticError, hapticSuccess } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { AppBackground } from "@/components/AppBackground";
import { AppHeader } from "@/components/AppHeader";
import { useColors } from "@/hooks/useColors";
import { HttpError } from "@/lib/api";

export default function ChangePasswordScreen() {
  const c = useColors();
  const { t } = useI18n();
  const router = useRouter();
  const { changePassword, mustChangePassword, logout } = useAuth();

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Task #821 — step-up: server may demand a fresh two-factor code.
  const [needsCode, setNeedsCode] = useState(false);
  const [totpCode, setTotpCode] = useState("");

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
      await changePassword(current, next, needsCode ? totpCode : undefined);
      hapticSuccess();
      if (!mustChangePassword) router.back();
    } catch (e) {
      hapticError();
      if (e instanceof HttpError && e.status === 403) {
        const d = e.data as { error?: string; message?: string } | null;
        if (d?.error === "step-up-required" || d?.error === "step-up-invalid-code") {
          setNeedsCode(true);
          setError(t("password.stepUpNeeded"));
          return;
        }
        setError(d?.message ?? t("common.error"));
      } else if (e instanceof HttpError && e.status === 400) {
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
      <AppBackground />
      {/* Task #1014 — shared navy branded header; back button only when the
          change isn't forced (forced flow must not be escapable). */}
      <AppHeader
        title={t("cp.title")}
        onBack={!mustChangePassword ? () => router.back() : undefined}
      />
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          padding: 28,
          paddingTop: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ marginBottom: 28 }}>
          <View
            style={{
              width: 60,
              height: 60,
              borderRadius: 20,
              backgroundColor: c.tint08,
              borderWidth: 1,
              borderColor: c.tint25,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="lock" size={26} color={c.primary} />
          </View>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Comfortaa_700Bold",
              fontSize: 25,
              letterSpacing: -0.4,
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

        <FadeInView>
        <Card style={{ gap: 16, padding: 20 }}>
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
          {needsCode ? (
            <Field
              label={t("password.twoFactorCode")}
              value={totpCode}
              onChangeText={setTotpCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              placeholder="123 456"
            />
          ) : null}
          {error ? (
            <Text
              style={{
                color: c.destructive,
                fontFamily: "Inter_400Regular",
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
        </Card>
        </FadeInView>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
