---
name: Atelier mobile share-sheet import
description: Durable invariants for the OS share-sheet → expense receipt flow and expo-share-intent pitfalls
---
- expo-share-intent's major version must match the Expo SDK major (its peer range enforces this); its README's patch-package/xcode patch was NOT needed — verify native output with the temp-copy prebuild approach, never in-repo.
- **Why:** installing the latest major fails peer resolution and prebuild silently misconfigures the extension.
- Android intent-filter config can't express `application/pdf`; PDFs ride a wildcard filter and unsupported types must be filtered client-side with a friendly message.
- Handoff invariant: a shared file goes into a one-shot pending store and is cleared ONLY when the New Expense screen consumes it. The navigation effect must be route-aware (re-run on segment changes) because the auth Gate's own login→tabs redirect can land after the share push; and it must wait only when the New Expense screen itself is in front — other expense routes never consume, so waiting there strands the share.
- Shared HEIC/HEIF arrives untranscoded (unlike the image picker) — convert to JPEG before upload or the server parser fails; conversion failure gets a clear "unsupported" message.
- Offline share enqueues a NEW expense through the existing offline queue (placeholder fields, parse on drain) — never against an existing draft.
- Demo read-only account: blocked writes 403 with a machine-readable `demo-read-only` code; both the raw-fetch and codegen error classes duck-type `status`+`data` for detection.
- Share extensions don't run in Expo Go/web (native module is optional-loaded, hook is safe); real end-to-end verification requires a dev build with a signing team + App Group enabled.
