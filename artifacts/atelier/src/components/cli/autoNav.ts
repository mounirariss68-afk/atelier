/**
 * Task #498 — auto-navigation preference + helpers.
 *
 * The chat agent (Task #495) auto-navigates Atelier app to the
 * relevant screen when it proposes or commits a write. Some users find
 * the silent jump jarring, so:
 *   - we surface a non-blocking toast with a "Stay here" affordance
 *     that restores the previous route (handled in CommandBar.tsx),
 *   - and we let users opt out entirely via this preference.
 *
 * The setting is persisted in localStorage and synced across tabs via
 * the standard `storage` event so the Settings page and the CommandBar
 * stay consistent without a global store.
 */

import * as React from "react";

const STORAGE_KEY = "atelier-cli-autonav-enabled";
const CHANGE_EVENT = "atelier-cli-autonav-changed";

/** Read the setting synchronously. Defaults to `true` (enabled). */
export function readAutoNavEnabled(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return true;
    return raw !== "false";
  } catch {
    return true;
  }
}

/** Persist + broadcast the setting. */
export function writeAutoNavEnabled(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "true" : "false");
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: next }));
  } catch {
    /* ignore storage errors (private mode, full quota, etc.) */
  }
}

/**
 * React hook returning `[enabled, setEnabled]` — re-renders when the
 * setting changes in this tab (custom event) or any other tab
 * (`storage` event).
 */
export function useAutoNavEnabled(): [boolean, (next: boolean) => void] {
  const [enabled, setEnabled] = React.useState<boolean>(() => readAutoNavEnabled());

  React.useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      setEnabled(readAutoNavEnabled());
    };
    const onCustom = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setEnabled(typeof detail === "boolean" ? detail : readAutoNavEnabled());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onCustom as EventListener);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onCustom as EventListener);
    };
  }, []);

  const update = React.useCallback((next: boolean) => {
    writeAutoNavEnabled(next);
    setEnabled(next);
  }, []);

  return [enabled, update];
}
