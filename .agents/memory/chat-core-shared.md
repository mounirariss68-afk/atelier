---
name: Shared chat-core package
description: lib/chat-core (@workspace/chat-core) is the single source of truth for Atelier chat protocol types, SSE parsing/retry, and the frame→turn reducer for web + mobile.
---

Both chat clients (web `artifacts/atelier/src/components/cli/*` and mobile `artifacts/atelier-mobile/lib/chatFrames.ts`/`useChat.ts`) are thin shims over `@workspace/chat-core`. Protocol changes (new frame type, card shape, status) go in `lib/chat-core/src/types.ts` + `reducer.ts` — both clients then fail typecheck until handled. Never fork reducer logic back into a client.

**Semantics unified there (don't regress):**
- `applyFrame(turn, frame)` is 2-arg (whole ChatFrame with `receivedAt`); old mobile 3-arg form is gone.
- Narration frames append BOTH `turn.text` and `kind:"narration"` trace entries — mobile activity ticker must filter `kind !== "narration"`; progress breadcrumbs are `kind:"step"` with `phase` collapsing.
- `turn.error` is `{code,message}` (mobile used to hold a string).
- Clarification single-field fabrication moved out of the reducer into render-time `resolveClarificationFields()`.
- Transient-retry lives in `streamSse` (`allowRetry:true` only on dedupe-safe `/cli/turn`, NEVER confirm; retries only pre-first-frame on 502/503/504/network).
- Pending-clarification rehydration is shared (`restoreClarificationTurn`) and mounted in both clients, guarded so it never clobbers a live/loaded transcript.

**Why:** the two reducers had drifted (Task #567/#597 fixes existed on one side only); the extraction makes every future protocol fix land on both surfaces at once.

**How to apply:** touching chat streaming/turn state? Edit `lib/chat-core`, rebuild (`tsc -b lib/chat-core/tsconfig.json`), then run `test:cli-reducer` (web) + `tests/chat-frames-probe.ts` (mobile). Metro and Vite both resolve the workspace package fine.
