# Component inventory — source: Atelier employee portal

Source library: the Atelier employee portal's component set (~60 modules). It is a
shadcn-based set themed entirely by CSS variables, so this design system's
scaffold components cover most families automatically once the Cognirise
tokens and brand layer are applied. Families are grouped below by how they
were carried over.

## Scaffold-covered (themed by tokens — no port needed)

accordion, alert, alert-dialog, avatar, badge, breadcrumb, button,
button-group, calendar, carousel, chart, checkbox, collapsible, command,
context-menu, dialog, drawer, dropdown-menu, empty, field, form, hover-card,
input, input-group, input-otp, item, kbd, menubar, navigation-menu,
pagination, popover, progress, radio-group, resizable, scroll-area, select,
separator, sheet, sidebar, skeleton, slider, sonner/toast, spinner, switch,
table, tabs, textarea, toggle, toggle-group, tooltip.

These pick up the extracted palette, radii, fonts, and elevation from
`tokens.json` + the brand layer. `card` was additionally customized (glass
surface, below).

## Atelier signature pieces (ported into the brand layer / pilot)

| Source | Here | Notes |
| --- | --- | --- |
| `.card` / `card.tsx` glass | `Card` component + `.glass-card` | knob-driven color-mix fill + 16px blur, `.card-hover` lift |
| `.glass-panel`, `.glass-surface` | `.glass-panel`, `.glass-popover` | shell chrome vs. popover fills |
| `.page-hero` dark island | `.page-hero` | navy band in both themes, island token re-declaration |
| `primitives.tsx` (Eyebrow, SectionDivider, SectionLabel, Lede, PillButton) | `.eyebrow`, `.section-divider`, `.section-label`, `.lede`, `.pill-btn*` | CSS classes; app-agnostic |
| `.mono-chip`, `.plm-pill` | `.mono-chip*`, `.accent-pill` | status colors via `--success/--warn/--danger` |
| `.tab-nav` | `.tab-nav*` | 2px accent underline tabs |
| `Logo.tsx` | brand assets in `docs/references/logos/` + Brand preview page | consumers wire their own theme switch |
| body backdrop layers | `.cog-backdrop`, `.cog-backdrop-art` | see `README.md` layering notes |

## App shell & chat conventions (documented, not shipped as components)

Title-bar composition (56px glass card: wordmark, lens drop-down,
light/dark/system mode selector, user avatar), the pinned full-height chat
column, and the chat composer anatomy ("+" button, input pill, send button)
are specified in `docs/consuming-web.md` under **App shell & chat**, with a
live rendering on the preview browser's "App shell & chat" page. Consumers
rebuild these compositions from the primitives; the spec is the contract.

## Deliberately not ported (app-specific)

`kpi-card.tsx`, `record-card.tsx`, `view-toggle.tsx`, `fieldControls.ts`
compositions tied to Atelier's data model, wouter routing, or api-client
types. Rebuild in the consuming app from this system's primitives if needed.

## Pilot set (presented for approval)

Button, Card (glass), Badge, Input, Tabs — plus the Brand and Glass patterns
preview pages demonstrating the signature elements.
