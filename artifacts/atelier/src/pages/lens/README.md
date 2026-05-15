# Page header & navigation contract

Atelier has three layers of navigation, in this order:

1. **Top bar** (`Shell.tsx`) — Logo · Home · **Manage** picker ·
   contextual lens-section tabs (`LensSectionTabs`) · Ask · Bell · Avatar.
   This is global. Pages do NOT re-render it.
2. **Page hero** (`LensPageHeader`) — eyebrow · headline · lede · actions.
   This is per-page. The eyebrow is auto-derived from the URL.
3. **Sub-section tabs** (`SubSectionTabs`) — *only* when a section needs
   intra-section navigation that the shell strip can't express
   (e.g. Wallet's Expenses · Invoices · AR · Cards strip).

## The eyebrow rule

Every workspace page must use ONE of two patterns:

- **Managed lens page** → `Manage · {Lens} · {Section}`
  (e.g. `Manage · Clients · Opportunities`, `Manage · People · Hire`)
- **Firm-menu surface** → `Firm · {Area}`
  (e.g. `Firm · Atelier`, `Firm · Press`, `Firm · Wallet`)

`LensPageHeader` derives this automatically via `useLensSection()`.
The five lenses live in `src/lib/lens.ts` (LENSES). The firm areas
live in `src/lib/lensSection.ts` (FIRM_AREAS).

### Detail pages

Entity detail pages (Opportunity, Engagement, Deliverable, AgentRun…)
keep the **entity name** as the eyebrow — pass an explicit
`eyebrow={accountName}` to override the auto-derived one.

### Forbidden patterns

- ❌ `<MonoChip>` in the eyebrow slot. The eyebrow has its own
  typography (uppercase mono with a 24px gold leading rule). A chip
  is visual noise.
- ❌ Hand-rolled `<div className="text-xs font-mono">WALLET</div>`
  inside `<PageHero>`. Use `LensPageHeader`.
- ❌ Re-rendering the shell lens-section tabs inside the page body.
  The shell already owns them; duplicating them just multiplies the
  user's confusion when they don't match.

## Sub-section tabs

If a section has truly nested navigation (e.g. Wallet has Expenses,
Invoices, AR, Cards, Policy, VAT — too many for the shell strip),
use `<SubSectionTabs tabs={[…]} />` *below* the hero, not a
re-rolled `<TabNav>`. They render as a thinner, lower-contrast strip
so the shell tabs remain the dominant nav.

## Usage

```tsx
import { LensPageHeader } from "@/components/layout/LensPageHeader";
import { SubSectionTabs } from "@/components/layout/SubSectionTabs";

export default function WalletExpenses() {
  return (
    <div className="animate-in fade-in">
      <LensPageHeader
        headline="Expenses"
        lede="Every expense policy-checked, VAT-handled, traceable to the client."
      />
      <div className="container-atelier pt-6">
        <SubSectionTabs tabs={WALLET_TABS} />
      </div>
      {/* …page body… */}
    </div>
  );
}
```
