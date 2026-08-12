---
name: Push tap deep-linking
description: Mobile notification-tap navigation pattern (stash + ref'd consumer)
---
Notification taps deep-link via pure `lib/pushRoute.ts` (href→route mapper + module-level pending stash), consumed by the Gate in `_layout.tsx`.

**Why:** `addNotificationResponseReceivedListener` is registered once; a closure over auth state goes stale, so warm-app taps silently no-op. The listener must call the latest consumer via a ref, and cold-start responses (`getLastNotificationResponseAsync`) arrive before auth is ready, so routes are stashed and consumed when `ready && token && !mustChangePassword`.

**How to apply:** New push href kinds → extend `routeForPushHref` (keep it in the pure module so `test:push-route` covers it; no expo imports there). Never navigate directly from the listener callback.
