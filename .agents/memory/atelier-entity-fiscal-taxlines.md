---
name: Entity fiscal calendar → forecast tax lines
description: How VAT/CT tax outflows enter the 13-week cash forecast and their staleness pitfall
---
Tax outflows in the 13-week cash forecast come only from the legal-entity registry's `fiscal` data (VAT period monthly/quarterly, next VAT/CT filing dates, expected amounts in entity base currency — entered by finance leadership; never fabricated).

**Why:** the demo fiscal-calendar seed was removed under the no-demo-data policy; the registry is the only real source.

**How to apply:**
- VAT recurs from the recorded next filing date by the period (capped occurrences); CT is a single dated line. Both feed the standard disbursement engine (FX conversion, week bucketing, overrides).
- Filing dates are strictly validated as real ISO dates at the API; the forecast resolver also guards non-finite week indexes.
- Pitfall: once a filing date passes, occurrences silently fall out of the window — next dates are static until a human updates them (roll-forward is a proposed follow-up).
- The legal-entity routes are NOT in openapi (UI uses raw fetch), so fiscal changes need no codegen.
