---
name: CLI slash-command composer quirks
description: Slash aliases carry a leading "/"; slash menu vs Enter-submit interplay in CommandBar
---
- Capability `slashAliases` are stored WITH the leading slash (e.g. "/contract-prepare"). Any code that re-inserts them into the composer must strip it or you get "//contract-prepare".
- The slash suggestion menu must close once the user has typed arguments after the command token (`/^\/\S+\s+\S/`); while it is open, Enter picks the highlighted candidate and RESETS the composer — a slash command with args could never be submitted by Enter before this guard.
- **Why:** both bugs were invisible to API-level tests; only a real browser run (typing keystroke-by-keystroke) surfaced them.
- **How to apply:** when touching CommandBar slash handling or adding aliases, test Enter-submit with arguments in the browser, not just handleSubmit unit paths.
- The decision logic is now pure helpers in `slashComposer.ts` (insertion text, menu-open predicate, Enter pick-vs-submit), pinned by the tsx suite `test:slash-composer`; keep CommandBar delegating to them instead of inlining regex/ordering logic.

Also from the same E2E run: controlled inputs that parse-and-rejoin their value on every keystroke (comma-separated options in the template field review) eat commas/spaces as you type — keep a raw per-field draft string and parse alongside it.
