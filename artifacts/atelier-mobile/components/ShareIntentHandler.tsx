// Task #748 — bridge between the OS share sheet (expo-share-intent) and the
// New Expense screen. Mounted inside AuthProvider so it can defer navigation
// until the session is established: a share arriving while logged out is held
// in the pending-share store and picked up right after sign-in.
import { useRouter, useSegments } from "expo-router";
import React, { useEffect, useState } from "react";
import { Platform } from "react-native";
import { useShareIntent } from "expo-share-intent";

import { useAuth } from "@/contexts/AuthContext";
import {
  hasPendingShare,
  setPendingShare,
  shareNavigationAction,
  subscribePendingShare,
} from "@/lib/pendingShare";

const SHARE_OPTIONS = {
  // Keep the share alive across the login round-trip — the default clears it
  // whenever the app backgrounds, which would drop logged-out shares.
  resetOnBackground: false,
  disabled: Platform.OS === "web",
};

export function ShareIntentHandler() {
  const { ready, token, mustChangePassword } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const { hasShareIntent, shareIntent, resetShareIntent } =
    useShareIntent(SHARE_OPTIONS);
  const [pendingTick, setPendingTick] = useState(0);

  useEffect(
    () => subscribePendingShare(() => setPendingTick((n) => n + 1)),
    [],
  );

  // Stash the first shared file (multi-share imports the first file only —
  // out of scope to fan out) and clear the native intent so a relaunch
  // doesn't re-import it.
  useEffect(() => {
    if (!hasShareIntent) return;
    const file = shareIntent.files?.[0];
    if (file?.path) {
      setPendingShare({
        uri: file.path,
        mime: file.mimeType ?? "",
        fileName: file.fileName ?? null,
        size: file.size ?? null,
        receivedAt: Date.now(),
      });
    }
    resetShareIntent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  // Once authenticated (and not stuck on forced password change), route to
  // the New Expense screen, which consumes the pending share on mount.
  //
  // Route-aware on purpose: the auth Gate runs its own redirect (login →
  // tabs) during the same sign-in transition and can land after our push.
  // Depending on `segments` re-runs this effect on every route change, so as
  // long as the share is still pending (only the New Expense screen clears
  // it, by consuming it) we re-navigate until that screen is in front.
  useEffect(() => {
    const action = shareNavigationAction({
      ready,
      token,
      mustChangePassword,
      seg0: (segments as string[])[0] as string | undefined,
      seg1: (segments as string[])[1] as string | undefined,
      pending: hasPendingShare(),
    });
    if (action === "navigate") router.push("/expense/new?fromShare=1");
  }, [ready, token, mustChangePassword, pendingTick, segments, router]);

  return null;
}
