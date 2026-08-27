# Cognirise Atelier Design System

The reusable visual language and component library extracted from the Atelier
employee portal.

## Included

- `tokens.json` — DTCG source-of-truth tokens for light and dark themes
- `src/generated/tokens.tsx` — generated token exports
- `src/index.css` — theme variables, base styles and Atelier signature patterns
- `src/components/ui/` — themed, reusable UI components
- `src/preview/` — living component browser and demos
- `docs/` — web/Expo consumption guidance and component inventory
- `public/` and `docs/references/logos/` — Cognirise logos and visual assets
- `scripts/build-tokens.mjs` — token build step
- `package.json`, `tsconfig.json`, `vite.config.ts` — package and preview configuration

## Visual language

Atelier uses a dark navy foundation with Cognirise gold and magenta accents,
Comfortaa for headings/brand display, Inter for body and interface text, and a
glass-surface treatment for cards, panels and shell chrome. The system supports
light and dark themes while retaining the same brand roles.

Signature patterns include:

- glass cards, panels and popovers
- page hero islands
- eyebrow, section label, divider and lede primitives
- pill buttons and mono/status chips
- tab navigation with accent underline
- branded backdrop layers and logo treatment

## Using it in a web app

Install the package dependencies in the consuming app, then:

```tsx
import "@workspace/cognirise-atelier/styles.css";
import { Button } from "@workspace/cognirise-atelier/components/button";
```

The package exports tokens, styles, components, hooks and utilities through
`package.json`. See `docs/consuming-web.md` for the complete setup, theme
provider guidance and required CSS/runtime wiring.

## Using it in Expo

See `docs/consuming-expo.md` for the native token consumption approach,
Comfortaa/Inter font setup and the Expo-specific theme guidance.

## Working with tokens

Edit `tokens.json`, then regenerate the typed token module:

```bash
pnpm tokens
```

Do not hand-edit `src/generated/tokens.tsx`; it is generated from
`tokens.json`.

## Scope

This package contains reusable design-system foundations and components. It
does not include Atelier product pages, API clients, business workflows or
data-model-specific compositions.