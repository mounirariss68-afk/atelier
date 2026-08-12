---
name: Mocking expo modules in tsx probes
description: How to unit-probe atelier-mobile code that imports expo-notifications/expo-constants/AsyncStorage under plain tsx.
---
Rule: to probe mobile lib code that imports native/expo modules, run `npx tsx --tsconfig tests/tsconfig.<probe>.json tests/<probe>.ts` where the probe tsconfig overrides `paths` to map `expo-constants`, `expo-notifications`, `@react-native-async-storage/async-storage`, `react-native`, and any `@/lib/*` dependency to mock files in `tests/mocks/` (tsx honours tsconfig paths).

**Why:** these modules throw or fail to resolve under Node; jest isn't set up in atelier-mobile, and refactoring for dependency injection is overkill. See `tests/push-fallback-probe.ts` for a working example.

**How to apply:** mocks export mutable `state` objects so scenarios can flip environment (e.g. Expo Go vs standalone) mid-run. Beware module-level caches in the code under test — drive state through the public API (e.g. call enable/disable), not by poking the AsyncStorage mock store directly.

Related invariant: phone-alert delivery has two modes persisted in AsyncStorage (`atelier.taskPush.mode` remote|local). Remote push is impossible in Expo Go / without an EAS project id — `remotePushUnavailableReason()` must be checked before any `getExpoPushTokenAsync` call, and any new mode transition must cancel `taskloc_` local schedules to avoid double alerts.
