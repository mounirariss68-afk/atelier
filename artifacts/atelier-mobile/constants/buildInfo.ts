// Build stamp — Task #1176. A human-readable identifier baked into the bundle
// so anyone can tell from a screenshot which build a phone is actually running.
// Bump BUILD_MARKER (and app.json "version") whenever you need to verify that a
// device picked up a new bundle.
import Constants from "expo-constants";

export const BUILD_MARKER = "2026-08-15 tabs-v3";

export const BUILD_STAMP = `v${Constants.expoConfig?.version ?? "?"} · ${BUILD_MARKER}`;
