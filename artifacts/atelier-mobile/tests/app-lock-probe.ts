// Task #1044 — offline probe for the Face ID app lock.
// Run: npx tsx --tsconfig tests/tsconfig.app-lock-probe.json tests/app-lock-probe.ts
//
// Covers:
// - pure lock decisions (cold start, grace period, disabled)
// - capability detection (face / fingerprint / no hardware / module throwing)
// - authenticate wrapper (success, cancel, throw → fail closed)
// - preference store round-trip + listeners

/* eslint-disable no-console */
import {
  APP_LOCK_GRACE_MS,
  isBackgroundState,
  lockToggleLabelKey,
  shouldLockOnForeground,
  shouldLockOnLaunch,
} from "../lib/appLockCore";
import {
  authenticateForAppLock,
  getAppLockCapability,
  loadAppLockEnabled,
  setAppLockEnabled,
  subscribeAppLockEnabled,
} from "../lib/appLock";
import {
  AuthenticationType,
  __setScenario,
  authCalls,
} from "./mocks/expo-local-authentication";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`);
  }
}

async function main() {
  // --- pure core ---------------------------------------------------------
  check("cold start locks only when enabled", shouldLockOnLaunch(true) && !shouldLockOnLaunch(false));
  check("background state detection", isBackgroundState("background") && !isBackgroundState("inactive") && !isBackgroundState("active"));
  const now = 1_000_000_000;
  check(
    "quick app switch inside grace does NOT re-lock",
    !shouldLockOnForeground({ enabled: true, backgroundedAt: now - APP_LOCK_GRACE_MS + 1000, now }),
  );
  check(
    "long background trip re-locks",
    shouldLockOnForeground({ enabled: true, backgroundedAt: now - APP_LOCK_GRACE_MS - 1, now }),
  );
  check(
    "disabled never locks on foreground",
    !shouldLockOnForeground({ enabled: false, backgroundedAt: now - 10 * APP_LOCK_GRACE_MS, now }),
  );
  check(
    "no recorded background time never locks",
    !shouldLockOnForeground({ enabled: true, backgroundedAt: null, now }),
  );
  check(
    "toggle label follows biometric kind",
    lockToggleLabelKey("face") === "set.appLockFace" &&
      lockToggleLabelKey("fingerprint") === "set.appLockFingerprint",
  );

  // --- capability --------------------------------------------------------
  __setScenario({ hasHardware: true, types: [AuthenticationType.FACIAL_RECOGNITION], enrolled: true });
  let cap = await getAppLockCapability();
  check("Face ID device → supported face, enrolled", cap.supported && cap.kind === "face" && cap.enrolled);

  __setScenario({ types: [AuthenticationType.FINGERPRINT], enrolled: false });
  cap = await getAppLockCapability();
  check("fingerprint device, not enrolled", cap.supported && cap.kind === "fingerprint" && !cap.enrolled);

  __setScenario({ hasHardware: false });
  cap = await getAppLockCapability();
  check("no hardware → unsupported", !cap.supported && cap.kind === "none");

  __setScenario({ hasHardware: true, moduleThrows: true });
  cap = await getAppLockCapability();
  check("module throwing → unsupported, no crash", !cap.supported);

  // --- authenticate wrapper ----------------------------------------------
  __setScenario({ moduleThrows: false, authResult: true, types: [AuthenticationType.FACIAL_RECOGNITION], enrolled: true, hasHardware: true });
  check("auth success unlocks", (await authenticateForAppLock("Unlock Atelier")) === true);
  const lastCall = authCalls[authCalls.length - 1];
  check("prompt message + passcode fallback passed", lastCall.promptMessage === "Unlock Atelier" && lastCall.disableDeviceFallback === false);

  __setScenario({ authResult: false });
  check("auth cancel stays locked", (await authenticateForAppLock("x")) === false);

  __setScenario({ authResult: "throw" });
  check("auth throw fails closed", (await authenticateForAppLock("x")) === false);

  // --- preference store ---------------------------------------------------
  check("default preference is off", (await loadAppLockEnabled()) === false);
  let notified: boolean | null = null;
  const unsub = subscribeAppLockEnabled((v) => (notified = v));
  await setAppLockEnabled(true);
  check("enable persists and notifies listeners", (await loadAppLockEnabled()) === true && notified === true);
  await setAppLockEnabled(false);
  check("disable persists and notifies listeners", (await loadAppLockEnabled()) === false && notified === false);
  unsub();

  if (failures) {
    console.error(`\n${failures} app-lock probe check(s) FAILED`);
    process.exit(1);
  }
  console.log("\nAll app-lock probe checks passed");
}

void main();
