import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  useFonts,
  PlusJakartaSans_800ExtraBold,
} from "@expo-google-fonts/plus-jakarta-sans";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/feedback";
import { ShareIntentHandler } from "@/components/ShareIntentHandler";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider, useThemePref, useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { API_BASE } from "@/lib/api";
import { triggerUnauthorized } from "@/lib/authEvents";
import { getTokenSync } from "@/lib/token";

// ---------------------------------------------------------------------------
// Networking wiring (module top-level, outside any component).
// ---------------------------------------------------------------------------
setBaseUrl(API_BASE);
setAuthTokenGetter(() => getTokenSync());

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) {
        triggerUnauthorized();
      }
    },
  }),
});

function ThemedStatusBar() {
  const scheme = useThemeScheme();
  return <StatusBar style={scheme === "dark" ? "light" : "dark"} translucent />;
}

function ThemeGate({ children }: { children: React.ReactNode }) {
  const { hydrated } = useThemePref();

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync();
  }, [hydrated]);

  if (!hydrated) return null;

  return (
    <>
      <ThemedStatusBar />
      {children}
    </>
  );
}

function Gate() {
  const { ready, token, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colors = useColors();

  useEffect(() => {
    if (!ready) return;
    const seg0 = segments[0];
    const onLogin = seg0 === "login";
    const onChange = seg0 === "change-password";

    if (!token) {
      if (!onLogin) router.replace("/login");
      return;
    }
    if (mustChangePassword) {
      if (!onChange) router.replace("/change-password");
      return;
    }
    if (onLogin || onChange) router.replace("/(tabs)");
  }, [ready, token, mustChangePassword, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.background,
          gap: 20,
        }}
      >
        <LinearGradient
          colors={["#5B7CFF", "#8A5BD6", "#C45BB8", "#FF7B5A"]}
          locations={[0, 0.35, 0.65, 1]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 76,
            height: 76,
            borderRadius: 24,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Image
            source={require("@/assets/images/cognirise-mark.png")}
            style={{ width: 44, height: 44 }}
            resizeMode="contain"
          />
        </LinearGradient>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="change-password" />
      <Stack.Screen name="expense/new" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="expense/[id]" options={{ headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <ThemeGate>
              <I18nProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <FeedbackProvider>
                    <AuthProvider>
                      <ShareIntentHandler />
                      <Gate />
                    </AuthProvider>
                  </FeedbackProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </I18nProvider>
            </ThemeGate>
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
