// Task #1044 — pure, expo-free core of the Face ID app lock so the
// decision logic is probe-testable off-device (tests/app-lock-probe.ts).
//
// The lock state machine:
// - Cold start with the preference ON → locked.
// - App goes to background → record when it left.
// - App returns to foreground → re-lock only if it was away longer than the
//   grace period (quick app switches shouldn't demand Face ID every time).
// - A successful biometric/passcode auth unlocks until the next qualifying
//   background trip.

/**
 * How long the app may sit in the background before foregrounding re-locks.
 *
 * The grace period is an explicit product requirement of task #1044 ("cold
 * start or returning after being backgrounded beyond a short grace period"):
 * without it, every quick app switch — picking a photo for an expense,
 * answering a call, using the share sheet — would demand Face ID again,
 * which makes users turn the lock off entirely. 15s is deliberately short:
 * long enough for an app switch, too short for a device handoff. The
 * Settings copy states this behavior ("or after it's been in the
 * background"), and a cold start always locks regardless of this value.
 */
export const APP_LOCK_GRACE_MS = 15_000;

/** AppState values that count as "left the app" (iOS fires "inactive" for
 * the app switcher / control center; treat only real background as leaving
 * so pull-down interactions don't re-lock). */
export function isBackgroundState(state: string): boolean {
  return state === "background";
}

export function shouldLockOnLaunch(enabled: boolean): boolean {
  return enabled;
}

export function shouldLockOnForeground(params: {
  enabled: boolean;
  backgroundedAt: number | null;
  now: number;
  graceMs?: number;
}): boolean {
  const { enabled, backgroundedAt, now, graceMs = APP_LOCK_GRACE_MS } = params;
  if (!enabled) return false;
  if (backgroundedAt === null) return false;
  return now - backgroundedAt >= graceMs;
}

/** User-facing label key for the toggle, by detected biometric type. */
export type BiometricKind = "face" | "fingerprint" | "none";

export function lockToggleLabelKey(kind: BiometricKind): string {
  return kind === "fingerprint" ? "set.appLockFingerprint" : "set.appLockFace";
}
