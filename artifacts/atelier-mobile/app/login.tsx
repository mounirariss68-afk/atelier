import { Feather } from "@expo/vector-icons";
import Constants from "expo-constants";
import React, { useEffect, useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LinearGradient } from "expo-linear-gradient";

import {
  Button,
  Card,
  FadeInView,
  Field,
  hapticError,
  softShadow,
} from "@/components/ui";
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
const NAVY = "#0A1230";

const logoDark = require("@/assets/images/cognirise-logo-dark-bg.png");

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
          backgroundColor: NAVY,
          alignItems: "center",
          justifyContent: "center",
          padding: 32,
          gap: 18,
        }}
      >
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 28,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="download-cloud" size={38} color="#FFFFFF" />
        </View>
        <Text
          style={{
            color: "#EEF1FA",
            fontFamily: "PlusJakartaSans_800ExtraBold",
            fontSize: 23,
            textAlign: "center",
            letterSpacing: -0.4,
          }}
        >
          {t("update.title")}
        </Text>
        <Text
          style={{
            color: "#9AA5C4",
            fontFamily: "PlusJakartaSans_400Regular",
            fontSize: 15,
            lineHeight: 22,
            textAlign: "center",
          }}
        >
          {t("update.body")}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: NAVY }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1 }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {/* Navy hero with gradient glow and brand logo */}
          <View
            style={{
              paddingTop: insets.top + 64,
              paddingBottom: 48,
              alignItems: "center",
              gap: 22,
              overflow: "hidden",
            }}
          >
            {/* Hero-only gradient glow — retired 4-color branding, intentionally
                kept for this one spot. Do not reuse elsewhere. */}
            <LinearGradient
              colors={["#5B7CFF", "#8A5BD6", "#C45BB8", "#FF7B5A"]}
              locations={[0, 0.35, 0.65, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                position: "absolute",
                top: -140,
                left: -80,
                right: -80,
                height: 300,
                opacity: 0.22,
                borderRadius: 300,
              }}
            />
            <FadeInView style={{ alignItems: "center", gap: 22 }}>
              <Image
                source={logoDark}
                style={{ width: 210, height: 56 }}
                resizeMode="contain"
              />
              <View style={{ alignItems: "center", gap: 6 }}>
                <Text
                  style={{
                    color: "#EEF1FA",
                    fontFamily: "PlusJakartaSans_800ExtraBold",
                    fontSize: 27,
                    letterSpacing: -0.5,
                  }}
                >
                  {t("login.title")}
                </Text>
                <Text
                  style={{
                    color: "#9AA5C4",
                    fontFamily: "PlusJakartaSans_500Medium",
                    fontSize: 15,
                  }}
                >
                  {t("login.subtitle")}
                </Text>
              </View>
            </FadeInView>
          </View>

          {/* Form card rises out of the navy hero */}
          <View
            style={{
              flex: 1,
              backgroundColor: c.background,
              borderTopLeftRadius: 32,
              borderTopRightRadius: 32,
              padding: 24,
              paddingTop: 32,
              paddingBottom: insets.bottom + 32,
            }}
          >
            <FadeInView delay={120}>
              <Card style={{ gap: 16, padding: 20 }}>
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
                  onSubmitEditing={onSubmit}
                  error={error}
                />
                <Button
                  label={t("login.signIn")}
                  onPress={onSubmit}
                  loading={loading}
                  disabled={!email || !password}
                  icon="log-in"
                />
              </Card>
            </FadeInView>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
