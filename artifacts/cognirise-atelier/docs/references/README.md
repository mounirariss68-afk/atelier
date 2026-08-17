# Cognirise Atelier — retained brand assets

Everything here is retained verbatim from the Atelier employee portal
(`artifacts/atelier/`). Do not redraw, recolor, or regenerate these files.
Consuming apps should copy the files they need into their own `public/` (or
`src/assets/`) — never hot-link across artifacts.

## Logos & marks (`logos/`)

| File | Use |
| --- | --- |
| `cognirise-logo.png` | Full lockup, light wordmark — for navy/dark surfaces (top nav, hero). |
| `cognirise-logo-light.png` | Full lockup, navy ink — for light/white surfaces (reports, print, exports). |
| `cognirise-mark.png` | Gradient "C" glyph only — reads on any background (favicons, avatars, sign-in). |
| `cognirise-favicon.svg` | The shipped favicon: the mark on a navy rounded square (SVG wrapping an embedded PNG — image-only, safe). |
| `cognirise-favicon.png` | PNG favicon fallback. |

Note: `pnpm tokens` regenerates `public/favicon.svg` from tokens; re-copy
`logos/cognirise-favicon.svg` over it afterwards to keep the real brand icon.

## Backdrop artwork & imagery

| File | Use |
| --- | --- |
| `dark-bg.webp` | Dark-theme wallpaper: navy network waves. |
| `light-bg-wave.webp` | Light-theme wallpaper: pale blue→magenta→coral wave. |
| `opengraph.jpg` | Social-share (OG) image reference. |
| `riser-avatar.png` | "Riser" assistant avatar used in chat/prep-card surfaces. |

## Backdrop layering pattern

Atelier paints its backdrop once, fixed, behind everything (bottom → top):

1. `body::before` — fixed 160° gradient (`--backdrop-deep → mid → hi`), the
   color fallback while artwork loads. Provided as `.cog-backdrop` on `<body>`.
2. Wallpaper layer — a fixed, pointer-events-none div with the theme's webp as
   a cover background, optionally under a scrim. Provided as
   `.cog-backdrop-art` (set `background-image` to the copied webp per theme).
3. Content — glass surfaces (`Card`, `.glass-panel`, `.page-hero`) blur over
   the layers below. Fixed pseudo-elements are used instead of
   `background-attachment: fixed` (broken/slow on iOS Safari).

The `--glass-*-alpha` knobs in `scripts/theme-template.css` control how much
fill each surface carries per theme; reduced-transparency and
no-backdrop-filter fallbacks re-opaque everything automatically.
