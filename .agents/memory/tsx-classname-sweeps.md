---
name: Mechanical className sweeps over tsx
description: How to safely bulk-edit Tailwind classes across the Atelier tsx tree
---
Rule: never regex-match "any string literal" across whole tsx files to find className strings — apostrophes in comments (e.g. "server's") open a bogus quote span that swallows real code, and any whitespace normalization then corrupts it (comments eat following statements).

**Why:** a glassmorphism sweep first attempt mangled ~90 files this way; the safe rerun processed line-by-line, checked the enclosing JSX tag by scanning back to the nearest `<tag`, and skipped input/select/textarea/option + `fieldControlCls` lines so form controls stayed opaque.
**How to apply:** for bulk class edits, work line-based with token-boundary regexes (`(^|[\s"'\`])token(?=[\s"'\`]|$)`), verify with `git diff` samples + a stash-compare `tsc -b` run (baseline has pre-existing errors), and spot-check via the headless-browser recipe (session minted directly into atelier_auth_sessions — PK is token_hash, no id column; use the ungoogled-chromium-13x nix store binary).
