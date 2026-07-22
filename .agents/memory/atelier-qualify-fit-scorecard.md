---
name: Qualify fit-scorecard adjust
description: Invariants for the Partners → Qualify manual fit-scorecard adjustment surface
---
- The Qualify tab renders the Cartographer's 9-dimension fitScorecard; the legacy freeform `capabilities` column is unused there (old values not migrated).
- Adjust route recomputes weightedTotal/verdict ONLY via shared `computeFitTotals` (alliance-cartographer.ts); never duplicate weights/thresholds client- or route-side. UI FIT_DIMENSIONS list must mirror ALLIANCE_FIT_DIMENSIONS.
- Per-dimension + top-level `adjustedAt/adjustedByUserId` distinguish manual vs agent scores; noop adjust (same values) returns 200 with NO audit row — tests rely on that.
**Why:** two sources of truth for the weighted framework would drift silently.
**How to apply:** any new surface writing fitScorecard scores must call computeFitTotals and stamp adjust fields.
