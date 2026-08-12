---
name: Expo Liquid Glass gating
description: How iOS Liquid Glass (expo-glass-effect) is safely feature-gated in the mobile app
---

- `isLiquidGlassAvailable()` from expo-glass-effect **throws** when the binary doesn't ship the native module (Expo Go, older installed builds getting JS via update) — it is NOT a safe probe. Always wrap in try/catch defaulting to false.
- **Why:** the check calls `requireNativeModule('ExpoGlassEffect')` before reading the availability constant; module-level evaluation would crash app startup on such binaries.
- **How to apply:** any new Liquid Glass usage must go through the shared `Glass` component's `liquidGlass` flag (guarded IIFE) rather than calling the lib directly. Liquid Glass renders only on real iOS 26+ native builds — never in the browser dev preview/Expo Go, which keep the BlurView/CSS path.
- Content cards deliberately use a translucent wash (`cardGlass` token), not per-card blur — per-card BlurView/GlassView is too costly in long lists. Android + iOS Reduce Transparency keep opaque surfaces (reduce-transparency hook errs opaque until the system setting resolves, cached module-wide).
- Mobile backdrop artwork now exists in BOTH themes via AppBackground (light = portrait crop of the web wave asset + pale scrim).
