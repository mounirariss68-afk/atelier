---
name: Holiday override review layer
description: How tentative TR/MENA holiday dates are confirmed/adjusted and merged at read time
---

The curated holiday dataset stays immutable; org-scoped override rows (keyed `country|baseDate|name`) are merged at read time via `applyHolidayOverrides`.

**Why:** moon-sighting-dependent Islamic dates are tentative until officially announced; overriding at read time keeps the dataset a clean source and makes clears trivial.

**How to apply:**
- Any new consumer of holiday dates (banners, OOO return-day, on-leave-today) must load org overrides and pass them through — never read the raw dataset directly, or adjusted dates silently diverge.
- Range filtering must happen AFTER adjustment (an adjusted date can move into/out of the window).
- Adjustments are capped to ±30 days drift from the base date; review write surface is HR/leadership-gated and audited (`holiday.review.set`/`.clear`).
- `nextYearMissing` fires when the dataset's max year <= current year — extending coverage means adding to DATASET_YEARS in the curated dataset.
