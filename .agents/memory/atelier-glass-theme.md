---
name: Atelier glassmorphism theme
description: How the Task #897 glass restyle works and its fallback/rollback rules
---

- Glass is knob-driven: `--glass-card/popover/panel-alpha` (% tokens per theme block in `src/index.css`) feed `color-mix(in srgb, <hex token> var(--knob), transparent)` inside `@theme inline`. Rollback = set knobs to 100%.
- **Why color-mix:** Atelier tokens are hex, not HSL triplets, so `hsl(var()/alpha)` composition is impossible.
- Any surface styled with a FIXED Tailwind alpha class (e.g. `bg-bg-deep/60`) is NOT covered by the knobs — it must be added to the escaped-selector override lists in the `@supports not (backdrop-filter…)` and `prefers-reduced-transparency` blocks in index.css, or it stays see-through without blur.
- `bg-popover`/`bg-card` are translucent now: any NEW component using them must also carry a `backdrop-blur-*` class or it renders as unblurred tint.
- Backdrop gradient lives on `body::before` (fixed pseudo, tokens-only) — never `background-attachment: fixed` (broken on iOS). Page roots must not paint opaque `bg-bg` or they hide it.
- Rail logo box uses `.rail-logo-glass` (navy color-mix glass; heavier tint in light theme for the light wordmark) — never revert it to a solid `bg-[#141C42]` fill; its opaque fallback lives in both no-blur override blocks.
- Chat composer/pill/slash surfaces must carry a `backdrop-blur-*` class alongside their fixed-alpha fills or they read as flat tint; light-theme pill alpha lives in the `[data-theme="light"] .cli-composer-pill` rule.
- Agent rail is anchored LEFT since this task: drag/keyboard width semantics in Shell.tsx are +deltaX/ArrowRight-widens; LTR floating bubble no longer offsets by rail width (RTL does).
