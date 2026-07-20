import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
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
        }}
      >
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
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider>
            <I18nProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <AuthProvider>
                    <Gate />
                  </AuthProvider>
                </KeyboardProvider>
              </GestureHandlerRootView>
            </I18nProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
