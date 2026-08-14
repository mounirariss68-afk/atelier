---
name: Entity allocation engine invariants
description: Benefit-principle entity allocation for expenses & supplier invoices — rule precedence, lifecycle, head entity, probe pitfalls.
---

- All entity-allocation prefill goes through the shared engine helpers (propose/decide); never inline allocation rules on a new surface.
- Rule precedence: explicit > engagement contracting entity > registry match (lessor/country) > travel destination-vs-home > person home > head/default entity. AI fallback confidence < 0.6 ⇒ `needs_input`, never a guess; AI-inferred trip context re-runs the deterministic rules so decisions stay deterministic when a rule fires.
- Firm-wide/shared costs go to the single flagged head entity (`isHeadEntity` on the legal-entity registry; registry write path keeps at most one flagged per org) and are marked shared for a future recharge.
- Lifecycle: proposed/needs_input → approved/overridden (fp/partner/finance only). Override requires a reason; decided rows are never re-proposed; bookkeeper skips undecided rows with an `allocation_pending` exception; period-close locks block post-posting entity changes.
- **Why:** intercompany benefit principle with mandatory human approval and audit — a silent guess or unaudited override is a compliance bug.
- **Probe pitfall:** the shared scratch DB accumulates active legal-entity rows across probe runs; country-uniqueness rules then silently fail. Archive pre-existing entities at probe setup before inserting fixtures.
