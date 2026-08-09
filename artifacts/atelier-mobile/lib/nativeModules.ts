// Task #841 — statically imported, platform-guarded access to native-only
// Expo modules. Runtime `await import(...)` resolves by numeric Metro module
// id, and when the shipped bundle drifts from the dependency graph (stale
// Metro cache, dev-client/OTA mismatch) the lookup fails with
// `Requiring unknown module "NNNN"` and crashes the app. Static imports keep
// these modules in the bundle's static graph so that can never happen.
//
// This file is the native implementation; Metro picks nativeModules.web.ts
// for web builds, where both accessors return null (call sites already
// platform-guard or no-op when the module is unavailable).

import * as FileSystemLegacy from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";

export type FileSystemModule = typeof FileSystemLegacy;
export type SharingModule = typeof Sharing;

export function getFileSystem(): FileSystemModule | null {
  return FileSystemLegacy;
}

export function getSharing(): SharingModule | null {
  return Sharing;
}
