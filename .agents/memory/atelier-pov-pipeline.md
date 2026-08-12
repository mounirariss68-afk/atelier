---
name: Atelier POV quality pipeline
description: Durable invariants for POV evidence snapshots, the deterministic citation gate, and the deep-research pass.
---

- **Evidence snapshot freezes at outline APPROVAL** (not outline creation/regeneration) — partners review evidence during outline review, so promotions/demotions made before approval must land in the set the draft runs on; changes after approval must not. Regenerating an outline clears the snapshot; it re-freezes at the new approval. An approval-time snapshot is honoured even when empty (never silently fall back to a live promoted-facts query for snapshotted POVs).
- **The citation gate audits the FINAL stylist HTML, section by section.** Coverage must be derived from citations actually present in each section's slice of the final document — never from the pre-stylist section pass — or a stylist that drops all citations sails through. Sections whose headings can't be found in the final HTML are fail-closed unsupported; the stylist directive therefore requires headings preserved verbatim.
- **Deep-research facts are admissible only when their sourceUrl matches a URL the retrieval dossier actually returned** (minimal deliberate canonicalization) — the synthesis model can hallucinate valid-looking URLs, and an unprovenanced fact must never become promotable evidence.
- **Final-document heading contract is `<h2>` exactly, uniquely matched** — missing, prose-only, duplicated, or demoted (`<h3>`) section headings fail closed in the citation gate.
- **Snapshot writes commit BEFORE the approval decision is recorded**, and draft/revise refuse (412) without a persisted snapshot — that ordering, not a lock, is what makes freeze-at-approval race-safe.
- **New POV-side launch endpoints must org-scope the target opportunity** (`opp.orgId === me.orgId`) before starting paid research/LLM jobs — the generic opportunity loader does NOT filter by org, and background jobs would otherwise write facts across org boundaries.
