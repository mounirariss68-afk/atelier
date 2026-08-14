---
name: Ledger drill-through deep-links
description: Design decisions/limits for GL ledger rows deep-linking to exact source rows
---

Decision: GL drill-through URLs are built ONLY by the shared server-side resolver (single source of truth); list-page destinations carry a row-focus query param the target page consumes with the shared deep-link focus hook (scroll + highlight + dismissible "not in this list" notice, reported only after the list has actually loaded — empty list ≠ still loading).

**Why:** hand-built URLs on other surfaces drifted from page params before; and reporting "missing" before load (or skipping it on empty lists) either flashes false notices or silently drops the user on an unfocused list.

Known limits (deliberate):
- Revrec posting lines aren't rendered client-side; the page resolves the line to its schedule row via the posting-lines endpoint. Adjustment lines have no schedule linkage → missing notice.
- Contractor payments stay a bare list destination: paid contractor-payment rows have no per-row UI anywhere (they surface downstream as self-billed invoices).

**How to apply:** new drill-through kinds/destinations extend the resolver + reuse the hook; keep the URL contract covered by the dedicated probe tests in both artifacts.
