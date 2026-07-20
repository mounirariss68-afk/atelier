---
name: Atelier finance route shadowing
description: FinanceSection placeholder routes in App.tsx shadow real pages
---
App.tsx uses a wouter Switch — first matching Route wins. Several /finance/* paths have FinanceSection placeholder landing routes (`{() => <FinanceSection sectionId=...>}`). Adding a real page at the same path later in the file silently never renders.

**Why:** the /finance/ledger GL page appeared blank-ish (landing card) until the earlier placeholder route was removed.
**How to apply:** when promoting a FinanceSection subpage to a real page, delete/replace the placeholder route at the SAME path, and flip the subPage status to "live" in FinanceSection.tsx.
