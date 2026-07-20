---
name: Headless browser E2E in this workspace
description: How to drive the logged-in Atelier UI in a real browser from the shell
---
The app sits behind the global login gate, so screenshot tools can't exercise it. Working recipe:
- Nix chromium exists (`ls /nix/store | grep chromium`); drive it with `puppeteer-core` (`pnpm add -w -D puppeteer-core`, remove afterwards — `pnpm remove` rewrites the lockfile's `catalogs:` section, so `git checkout -- pnpm-lock.yaml` after).
- Launch with `--no-sandbox --disable-dev-shm-usage`, log in via the seeded founder credentials, then click through `data-testid` selectors.
- Shell commands are hard-capped at ~115s and background/nohup processes die when the shell exits: split the flow into phase scripts that each fit in one command, redirect output to a file, and make later phases resume from persisted state (e.g. an already-active template).
- Live LLM field detection and LibreOffice docx→PDF each take a few seconds and fit fine; a full upload→create→send flow fits in ~100s.
- Fill EVERY required template field in create dialogs — live LLM detection may mark more fields required than the stub does.

**Why:** first attempt failed twice (missing tables → `@workspace/db push` + orphan-FK cleanup needed on fresh isolated DBs; then a required fee field left blank).
**How to apply:** any future "verify screens in the browser" task on this project.

**Expo mobile web variant:** react-native-web Pressables ignore synthetic MouseEvent dispatch — don't script the login form. Instead pre-seed `localStorage.atelier_session_token` via `evaluateOnNewDocument` and stub ALL `/api/*` responses with puppeteer request interception (answer OPTIONS preflights with full CORS headers or cross-origin fetches silently fail). This renders any auth-gated mobile screen with fixture data, no DB or server auth needed.

**Auth without a password:** mint a session directly — random hex token, insert its sha256 into `atelier_auth_sessions` (token_hash/user_id/email/expires_at) via psql, set cookie `atelier_auth_session=<token>` on localhost in puppeteer. Delete the row after. Note: puppeteer scripts must live inside the workspace (not /tmp) to resolve node_modules; className checks for active tabs must exact-match `text-gold` (hover:text-gold false-positives).

- Vite dev server (e.g. :24797) does NOT proxy /api — drive the browser at the shared proxy `http://localhost:80/<path>` or auth/session calls miss and login screen shows.
