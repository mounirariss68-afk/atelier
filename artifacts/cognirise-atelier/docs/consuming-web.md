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

## App shell & chat

These conventions come from the Atelier employee portal and are the standard
for every Cognirise app that ships an app shell or an assistant chat. See the
"App shell & chat" page in the preview browser for a live rendering.

### Title bar

- Sticky at the top (`sticky top-0`), rendered as a glass card: **56px tall**
  (`h-14`), `rounded-xl`, `border border-border`, translucent elevated
  background with backdrop blur (`.glass-panel`), `px-4`, `flex items-center
  gap-4`, subtle drop shadow.
- Left-to-right composition: **wordmark** (text set in `.font-wordmark`,
  `text-lg`, links home) → flexible spacer → right cluster (`ml-auto flex
  items-center gap-4`): **lens drop-down**, **theme mode selector**, optional
  icon utilities (notifications, motion toggle), then the **user menu**
  (32px avatar, `h-8 w-8 rounded-full`, 1px primary-tinted ring that
  strengthens on hover).
- An optional second card below the title bar holds contextual navigation:
  **44px tall** (`h-11`), same glass-card treatment, containing Home plus
  section tabs as small `rounded-full px-2.5 py-1` pill links in
  `text-xs font-mono uppercase tracking-widest`.

### Lens drop-down (title bar)

When an app has multiple lenses (top-level workspaces such as Clients,
People, Finance…), the lens selector is a **drop-down in the title bar**, in
the right cluster before the theme selector — never a sidebar section or a
separate page.

- Trigger: a compact bordered chip — `inline-flex items-center gap-1.5
  rounded-md border border-border px-2.5 py-1 text-sm font-medium` on a
  translucent elevated fill — showing the **active lens label** plus a
  14px chevron-down.
- Menu: a standard `DropdownMenu` about `w-44`, one item per lens the current
  role can see; optional keyboard shortcut hints right-aligned in
  `font-mono text-[10px] uppercase tracking-widest`.
- Selecting a lens navigates to that lens's home and persists the choice.
- Render the drop-down even when only one lens is visible (it doubles as the
  "where am I" label); hide it only for external/guest roles with no lenses.

### Theme mode selector (title bar)

Every app's title bar carries a **light / dark / system** mode selector,
placed immediately after the lens drop-down.

- Shape: an **icon-only ghost button** (no border, `text-muted-foreground`,
  hover to full text color) whose icon reflects the *resolved* mode — sun
  (light), moon (dark), monitor (following system) — opening a small
  drop-down with the three options: **Light, Dark, System**, the active one
  checked.
- Behavior: "System" follows the OS `prefers-color-scheme` and updates live
  when the OS switches. The choice persists in `localStorage`, and apps must
  apply the stored/derived theme in a pre-paint inline script so there is no
  flash of the wrong theme. Default for first-time visitors is **System**.
- Apply the theme with this package's mechanism: toggle the **`dark` class on
  `<html>`** (`document.documentElement.classList.toggle("dark", isDark)`)
  and set `style.colorScheme` to match. All package tokens and the Tailwind
  `dark:` variant key off the `.dark` class — there is no `data-theme`
  support.
- Note: this three-mode selector is the Cognirise standard going forward;
  apps that still ship a plain two-state light/dark toggle should upgrade to
  it when touched.

### Chat area

The assistant chat is **pinned to the window height** — it never scrolls
with the page.

- Layout: a full-height flex column (`h-full flex flex-col overflow-hidden`
  inside a viewport-pinned container, e.g. `fixed inset-y-0 left-0`). The
  message transcript is the only scrolling region: `flex-1 min-h-0
  overflow-y-auto`; the composer sits after it with `shrink-0`, so it stays
  fixed at the bottom.
- Docked rail form (preferred): a fixed **left** rail, collapsed **48px**
  wide, expanded **320px by default**, user-resizable **320–720px** and never
  more than 60% of the window width; main content pads left by the rail
  width. The rail stacks a 56px logo card and then the glass chat panel
  filling the remaining height (`flex-1 min-h-0`).
- Floating/modal form: **760px wide** (`sm:w-[760px]`,
  `max-w-[calc(100vw-2rem)]`), **640px tall** (`sm:h-[640px]`, capped
  `max-h-[calc(100vh-3rem)]`; full-width and `h-[88vh]` on phones),
  `rounded-2xl`, deep translucent background with heavy backdrop blur.
- Transcript: `p-4` padding, `space-y-5` between turns. User bubbles align
  right at `max-w-[85%]`, `rounded-2xl px-3 py-1.5 text-xs leading-relaxed`
  on an elevated fill. Assistant turns align left at `max-w-[92%]` beside a
  **24px** round assistant avatar.

### Chat composer

The composer is a fixed bar at the bottom of the chat column: top border,
subtle elevated translucent background with light blur, `p-3`, `shrink-0`.
Dragging files over it shows an inset 2px primary ring. Anatomy, left to
right (`flex items-end gap-2`):

1. **"+" (attach) button** — a **36×36px circle** (`w-9 h-9 rounded-full`),
   1px border, translucent deep fill with backdrop blur, 16px plus icon in
   `text-muted-foreground`, hover tints icon to the accent and lightens the
   fill. Uploads render as small `rounded-md text-xs font-mono` chips in a
   row *above* the composer (spinner while uploading, danger tint on
   failure, filenames truncated at 160px).
2. **Input pill** — fills the remaining width: `rounded-[22px]`, 1px border,
   translucent deep fill with backdrop blur, `ps-4 pe-1.5 py-1.5`, and
   `focus-within:ring-1` in the accent color. Inside sits a transparent,
   borderless **textarea**: `rows={1}`, `text-xs leading-relaxed`,
   auto-height capped at `max-h-40` (160px), `resize-none`, faint
   placeholder, dimmed to 60% opacity while a reply is streaming.
3. **Send button** — a **32×32px circle** (`w-8 h-8 rounded-full`) at the
   pill's end, accent background with white 16px send icon, hover at 90%
   opacity. Disabled (accent at 15% fill, icon at 70%) whenever the input is
   empty, a reply is streaming, the input is over-limit, or an upload is in
   flight.

Long inputs: cap at 4000 characters; show a `text-[10px] font-mono` counter
(`3850/4000`) only within 200 characters of the cap, switching to the danger
color — along with the pill border and ring — when over, which also disables
send.

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
