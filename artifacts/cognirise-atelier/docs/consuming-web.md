# Consuming Cognirise Atelier in web apps

Read `docs/AGENTS.md` first. This guide covers
React/Vite and other shadcn/Tailwind web consumers. If the app already contains
a local theme or component library, also read
`docs/migrating-web.md` before writing UI.

## Theme

Import this package's theme once from the app's main CSS:

```css
@import "@workspace/cognirise-atelier/styles.css";
```

`styles.css` already imports Tailwind, its plugins, and this package's token
theme. It also registers this package's component sources. Do not add a separate
Tailwind import or a `node_modules` source path in a Tailwind v4 consumer.
Tailwind v3 consumers keep their existing `@tailwind` directives and add
`node_modules/@workspace/cognirise-atelier/src/components` to `content`.

## Typography

Brand fonts: **Comfortaa** for all headings, display text, and the brand
wordmark (weights 400 and 700 only — never a synthesized 600); **Inter** for
body copy, UI labels, buttons, stats, and captions (weights 400, 600, 800).
The theme wires these automatically (`--font-sans` = Inter, `--font-serif` =
Comfortaa, plus an `h1`–`h6` rule and `.font-wordmark`), but the fonts
themselves must be loaded by the consuming app. Add this to the app's
`index.html` `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Comfortaa:wght@400;700&family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
```

Comfortaa has no italic; italic accents (`em.accent`) rely on `font-style`.
Do not use Comfortaa for body copy.

## Components and helpers

Import every provided primitive, `cn`, and toast API directly from this package:

```tsx
import { Button } from "@workspace/cognirise-atelier/components/ui/button";
import { cn } from "@workspace/cognirise-atelier/lib/utils";
import {
  toast,
  useToast,
} from "@workspace/cognirise-atelier/hooks/use-toast";
```

Use the package component whenever it provides the required family. Keep
product-specific compositions in the app, but compose them from package
primitives rather than recreating those primitives locally.

The packaged `Toaster` and toast hook share one in-memory store. Do not call a
local toast hook while rendering the packaged `Toaster`.

## Verify

After wiring the workspace dependency, import and render
`@workspace/cognirise-atelier/components/ui/button`. Run the app's typecheck
and dev server. The import must resolve and the Button must use this package's
theme before broader UI work begins.

## Ongoing rules

- Keep one source of theme variables.
- Import package-provided primitives and helpers from the package path.
- Add reusable product-agnostic components to this package first.
- For a non-shadcn app, use the tokens as the source of truth and adapt existing
  components to the token CSS variables without copying token values.
