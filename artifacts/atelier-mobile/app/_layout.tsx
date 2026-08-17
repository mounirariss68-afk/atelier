import {
  Comfortaa_400Regular,
  Comfortaa_700Bold,
} from "@expo-google-fonts/comfortaa";
import {
  Inter_400Regular,
  Inter_600SemiBold,
  Inter_800ExtraBold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  setAuthTokenGetter,
  setBaseUrl,
} from "@workspace/api-client-react";
import * as Notifications from "expo-notifications";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { LinearGradient } from "expo-linear-gradient";
import React, { useEffect } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AppLockGate } from "@/components/AppLockGate";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { FeedbackProvider } from "@/components/feedback";
import { ShareIntentHandler } from "@/components/ShareIntentHandler";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { ThemeProvider, useThemePref, useThemeScheme } from "@/contexts/ThemeContext";
import { useColors } from "@/hooks/useColors";
import { API_BASE } from "@/lib/api";
import { triggerUnauthorized } from "@/lib/authEvents";
import {
  routeForNotificationResponse,
  stashPushRoute,
  takePushRoute,
} from "@/lib/pushRoute";
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
  // Task #1043 — main screens sit under the fixed dark-navy AppHeader (and
  // login/change-password open with a navy hero), so the status bar
  // (time/signal/battery) must be white there even in the light theme —
  // theme-following dark icons were illegible on the navy. Headerless
  // screens (e.g. not-found) keep theme-appropriate icons.
  const scheme = useThemeScheme();
  const segments = useSegments();
  const headerless = segments[0] === "+not-found";
  return <StatusBar style={headerless && scheme === "light" ? "dark" : "light"} translucent />;
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

// Task #1015 — deep-link on notification tap. The pending-route stash lives
// in lib/pushRoute.ts; this flag ensures the cold-start response is read once.
let coldStartResponseConsumed = false;

function Gate() {
  const { ready, token, mustChangePassword } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const colors = useColors();

  const consumePendingRoute = React.useCallback(() => {
    // Gate redirects handle the not-ready / logged-out / must-change cases;
    // the route stays stashed until navigation is allowed.
    const route = takePushRoute(ready && !!token && !mustChangePassword);
    if (route) router.push(route as never);
  }, [ready, token, mustChangePassword, router]);

  // Keep the latest callback available to the long-lived listener below, so a
  // warm-app tap uses current auth state (not the first render's closure).
  const consumeRef = React.useRef(consumePendingRoute);
  useEffect(() => {
    consumeRef.current = consumePendingRoute;
  }, [consumePendingRoute]);

  // Foreground/background taps.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const route = routeForNotificationResponse(response);
      if (route) {
        stashPushRoute(route);
        consumeRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  // Cold start: the tap that launched the app.
  useEffect(() => {
    if (coldStartResponseConsumed) return;
    coldStartResponseConsumed = true;
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const route = routeForNotificationResponse(response);
        if (route) {
          stashPushRoute(route);
          consumeRef.current();
        }
      })
      .catch(() => {
        // best effort — app just opens normally
      });
  }, []);

  // Consume a stashed route once auth becomes ready (cold start ordering).
  useEffect(() => {
    consumePendingRoute();
  }, [consumePendingRoute]);

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
        {/* Task #1043 — this headerless loading surface follows the theme
            background, so override the global light status-bar icons while
            it's mounted (most recently mounted StatusBar wins). */}
        <StatusBar
          style={colors.background === "#0A1230" ? "light" : "dark"}
          translucent
        />
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
  // Task #1279 — brand typography parity with the web app (Task #1278):
  // Comfortaa 400/700 for headings/display/wordmark, Inter 400/600/800 for
  // body/UI. Splash stays up (preventAutoHideAsync above + null render here)
  // until fonts resolve, so there is no flash of unstyled text.
  const [fontsLoaded, fontError] = useFonts({
    Comfortaa_400Regular,
    Comfortaa_700Bold,
    Inter_400Regular,
    Inter_600SemiBold,
    Inter_800ExtraBold,
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
                      {/* Task #1044 — optional Face ID app lock overlays
                          everything (including login) when enabled. */}
                      <AppLockGate>
                        <ShareIntentHandler />
                        <Gate />
                      </AppLockGate>
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
