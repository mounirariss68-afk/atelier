---
name: Pre-formation entity cost pools
description: Durable invariants for the pre-formation cost-pool / clearing-account / settlement lifecycle.
---

- Costs tagged to a pre-formation entity quarantine on the HOME (UAE) entity's ledger in the pre-incorporation clearing asset account, with the pool's entity id stamped on the journal LINE. Never opex.
- **Why:** the entity doesn't legally exist; the clearing bucket is the segregation mechanism and the pool total is the net of stamped clearing lines.
- Quarantine eligibility = the pool is UNSETTLED, in every direction: an activated entity with an unsettled pool still quarantines, and a settled pool never does (even while still in_formation) — a settled pool is CLOSED for new costs (tagging rejected at attribution time; already-tagged costs surface as Bookkeeper exceptions, never posted).
- jsonb caveat: the settlement key may exist as JSON null — predicates must treat SQL NULL and `'null'::jsonb` alike or activated-unsettled pools silently leak into opex.
- Never reuse an existing chart code for a new account: duplicate codes in the default chart are silently dropped by the unique index and journals hit the WRONG account. Charts seeded before a new code existed self-heal at settle time from the default chart.
- Settlement blocks while approved/paid tagged items are not yet bookkept; idempotency rides a unique source index (replay ⇒ conflict). Founder-owned settlements require an approval note; JV splits must sum to 100 (last split absorbs rounding).
- The settlement stamp is never client-writable through the entity PATCH — only the settle route writes it.
