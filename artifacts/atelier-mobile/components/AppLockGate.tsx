// Task #1044 — the app-lock overlay. Wraps the whole app: when the lock
// preference is ON, a branded lock screen covers everything on cold start
// and when returning from background after the grace period, until Face ID /
// Touch ID (or the device passcode fallback) succeeds.
//
// Decision logic lives in lib/appLockCore.ts (pure, probed off-device);
// biometric calls live in lib/appLock.ts (fail-safe when the native module
// is missing — in that case `capability.supported` is false and this gate
// never blocks).
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Image, Modal, Pressable, Text, View } from "react-native";

import {
  authenticateForAppLock,
  getAppLockCapability,
  loadAppLockEnabled,
  subscribeAppLockEnabled,
} from "@/lib/appLock";
import {
  isBackgroundState,
  shouldLockOnForeground,
  shouldLockOnLaunch,
} from "@/lib/appLockCore";
import { useI18n } from "@/contexts/I18nContext";
import { useColors } from "@/hooks/useColors";

export function AppLockGate({ children }: { children: React.ReactNode }) {
  const c = useColors();
  const { t } = useI18n();

  // null = preference not hydrated yet (render nothing lock-related; the
  // splash/theme gate is still settling at that point anyway).
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [supported, setSupported] = useState(false);
  const [locked, setLocked] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const backgroundedAt = useRef<number | null>(null);
  const lockedRef = useRef(false);
  lockedRef.current = locked;

  // Hydrate preference + capability once; cold-start lock decision.
  useEffect(() => {
    let alive = true;
    (async () => {
      const [on, cap] = await Promise.all([loadAppLockEnabled(), getAppLockCapability()]);
      if (!alive) return;
      setSupported(cap.supported);
      setEnabled(on);
      if (cap.supported && shouldLockOnLaunch(on)) setLocked(true);
    })();
    const unsub = subscribeAppLockEnabled((on) => {
      setEnabled(on);
      // Turning the lock OFF (already authenticated in Settings) releases
      // any active lock; turning it ON does not lock mid-session.
      if (!on) setLocked(false);
    });
    return () => {
      alive = false;
      unsub();
    };
  }, []);

  // Background / foreground transitions.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const supportedRef = useRef(supported);
  supportedRef.current = supported;
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (isBackgroundState(state)) {
        if (backgroundedAt.current === null) backgroundedAt.current = Date.now();
        return;
      }
      if (state === "active") {
        const shouldLock =
          supportedRef.current &&
          shouldLockOnForeground({
            enabled: enabledRef.current === true,
            backgroundedAt: backgroundedAt.current,
            now: Date.now(),
          });
        backgroundedAt.current = null;
        if (shouldLock && !lockedRef.current) setLocked(true);
      }
    });
    return () => sub.remove();
  }, []);

  const tryUnlock = useCallback(async () => {
    if (authBusy) return;
    setAuthBusy(true);
    try {
      const ok = await authenticateForAppLock(t("set.appLockPrompt"));
      if (ok) setLocked(false);
    } finally {
      setAuthBusy(false);
    }
  }, [authBusy, t]);

  // Auto-prompt when the lock screen appears (no extra tap needed).
  const promptedFor = useRef(0);
  useEffect(() => {
    if (!locked) return;
    const token = ++promptedFor.current;
    // Small delay: prompting while the app is still transitioning to
    // "active" can make iOS dismiss the Face ID sheet immediately.
    const id = setTimeout(() => {
      if (promptedFor.current === token && lockedRef.current) void tryUnlock();
    }, 350);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  return (
    <View style={{ flex: 1 }}>
      {children}
      {/* Review fix: while the preference/capability are still hydrating we
          must not expose content — an enabled lock would otherwise flash the
          app interactable for a moment on cold start. Opaque cover, no
          controls; it resolves within milliseconds (AsyncStorage read). */}
      {enabled === null ? (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: c.background,
          }}
          testID="app-lock-hydrating"
        />
      ) : null}
      {/* Review fix: the lock screen is a native Modal (not an absolute
          View) so it presents ABOVE any already-open RN Modal (e.g. the
          FeedbackProvider confirmation dialog) — an overlay View could not
          cover those, leaving their buttons tappable while "locked". */}
      <Modal
        visible={locked}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {
          // Android back button: keep the lock; offer the auth prompt again.
          void tryUnlock();
        }}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: c.background,
            alignItems: "center",
            justifyContent: "center",
            gap: 22,
            padding: 32,
          }}
          testID="app-lock-screen"
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
          <Text
            style={{
              color: c.foreground,
              fontFamily: "PlusJakartaSans_700Bold",
              fontSize: 18,
              textAlign: "center",
            }}
          >
            {t("set.appLockLockedTitle")}
          </Text>
          <Pressable
            onPress={() => void tryUnlock()}
            disabled={authBusy}
            testID="app-lock-unlock"
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
              borderRadius: 16,
              paddingHorizontal: 24,
              paddingVertical: 13,
              backgroundColor: c.primary,
              opacity: pressed || authBusy ? 0.7 : 1,
            })}
          >
            <Feather name="unlock" size={16} color="#FFFFFF" />
            <Text style={{ color: "#FFFFFF", fontFamily: "PlusJakartaSans_700Bold", fontSize: 15 }}>
              {t("set.appLockUnlock")}
            </Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}
