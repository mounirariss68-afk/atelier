// Task #841 — web counterpart of lib/nativeModules.ts. Metro resolves this
// file for web builds so the native-only modules (expo-file-system/legacy,
// expo-sharing) never enter the web bundle. All call sites platform-guard
// (Platform.OS === "web" opens URLs in the browser instead), so returning
// null here is safe.

import type { FileSystemModule, SharingModule } from "./nativeModules";

export type { FileSystemModule, SharingModule };

export function getFileSystem(): FileSystemModule | null {
  return null;
}

export function getSharing(): SharingModule | null {
  return null;
}
