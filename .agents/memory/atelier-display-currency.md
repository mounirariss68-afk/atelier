---
name: Display currency preference
description: Per-user display currency for money rollups (mobile expenses charts/totals)
---

- Preference lives on `atelier_users.display_currency` (default USD); read/write via self-scope GET/PATCH `/me/preferences` (raw fetch on mobile, not in openapi), audited as `me.preferences.updated`.
- **Rule:** any client rollup over mixed-currency money must use the server-converted `display` block on `/me/expenses` rows (converted via USD with `convertUsdTo`, rates stored quote-per-USD) — never convert client-side or total raw amounts. Mark converted totals "≈".
- Queued offline drafts have no server FX; include them in totals only when already in the display currency, else flag approx.
- Mobile Settings must invalidate `getAtelierListMyExpensesQueryKey()` after the PATCH or the Expenses tab keeps stale currency for the session.
