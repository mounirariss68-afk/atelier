import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, hapticError } from "@/components/ui";
import { useAuth } from "@/contexts/AuthContext";
import { useI18n } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";
import { apiJson } from "@/lib/api";

function cmpSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) > (pb[i] ?? 0)) return 1;
    if ((pa[i] ?? 0) < (pb[i] ?? 0)) return -1;
  }
  return 0;
}

const APP_VERSION = Constants.expoConfig?.version ?? "1.0.0";

export default function LoginScreen() {
  const c = useColors();
  const { t } = useI18n();
  const { login } = useAuth();
  const insets = useSafeAreaInsets();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [updateRequired, setUpdateRequired] = useState(false);

  useEffect(() => {
    apiJson<{ minSupportedAppVersion: string }>("/api/auth/app-meta", {
      auth: false,
    })
      .then((meta) => {
        if (cmpSemver(APP_VERSION, meta.minSupportedAppVersion) < 0)
          setUpdateRequired(true);
      })
      .catch(() => {
        // fail open — do not block on a failed meta check
      });
  }, []);

  const onSubmit = async () => {
    setError(null);
    setLoading(true);
    const res = await login(email.trim(), password);
    setLoading(false);
    if (!res.ok) {
      hapticError();
      setError(t(res.errorKey ?? "login.failed"));
    }
  };

  if (updateRequired) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: c.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 16,
        }}
      >
        <Feather name="download-cloud" size={48} color={c.primary} />
        <Text
          style={{
            color: c.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 22,
            textAlign: "center",
          }}
        >
          {t("update.title")}
        </Text>
        <Text
          style={{
            color: c.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            textAlign: "center",
          }}
        >
          {t("update.body")}
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1, backgroundColor: c.background }}
    >
      <ScrollView
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 28,
          paddingTop: insets.top + 40,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", marginBottom: 36 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 20,
              backgroundColor: c.primary,
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 20,
            }}
          >
            <Feather name="feather" size={34} color={c.primaryForeground} />
          </View>
          <Text
            style={{
              color: c.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 26,
            }}
          >
            {t("login.title")}
          </Text>
          <Text
            style={{
              color: c.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              marginTop: 4,
            }}
          >
            {t("login.subtitle")}
          </Text>
        </View>

        <View style={{ gap: 16 }}>
          <Field
            label={t("login.email")}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="you@cognirise.com"
          />
          <Field
            label={t("login.password")}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete="password"
            textContentType="password"
            placeholder="••••••••••"
            onSubmitEditing={onSubmit}
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
            label={t("login.signIn")}
            onPress={onSubmit}
            loading={loading}
            disabled={!email || !password}
            icon="log-in"
          />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
