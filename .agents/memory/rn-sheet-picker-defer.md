---
name: RN sheet → native picker deferral
description: Launching native pickers after closing an RN Modal sheet must be dismissal-gated, not timer-gated; pickers need a single-flight guard.
---
Rule: never launch a native picker (expo-document-picker / expo-image-picker / camera) on a fixed timer after closing an RN Modal sheet. Defer the action until the Modal has fully dismissed (iOS `Modal.onDismiss`; Android has no onDismiss — short setTimeout fallback; web immediate). Wrap every picker launch in the shared single-flight guard (`lib/pickerGuard.ts` runExclusivePick): concurrent taps are silent no-ops, native failures return a recoverable result (toast + retry) instead of an uncaught rejection.

**Why:** a fixed 550ms delay raced the iOS Modal dismissal animation; when it lost, the picker never presented AND `getDocumentAsync` never settled, wedging the native module so the next tap threw the red uncaught "Different document picking in progress" error.

**How to apply:** any new Sheet option that opens a native picker → set `defer: true` on the SheetOption and run the pick via `runExclusivePick`. `Modal.onDismiss` is iOS-only.
