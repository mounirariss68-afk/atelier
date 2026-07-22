---
name: Atelier structured person names
description: Invariants for the unified person model (atelier_persons) and the legacy fullName mirrors
---

- `atelier_persons` is the structured-name source of truth (honorific/first/middle/last/preferred); `display_name` is server-recomputed, never client-supplied. Domain rows (users/contacts/employees/contractors/PFRs) keep a legacy `fullName`/`name` mirror.
- **Rule:** every name UPDATE goes through `writePersonAndSync` (person row + ALL linked domain mirrors), never bare `writePerson`.
  **Why:** one person can be linked across domains (employee + login row + contact); updating only one mirror leaves the others stale.
  **How to apply:** bare `writePerson` is only acceptable for brand-new person rows created inside the same tx that inserts the sole domain row.
- Agents keep emitting free-text `fullName`; the server parses via `parsePersonName`. The parser's token cleaner deliberately preserves underscores.
  **Why:** synthetic/test names with tag prefixes must round-trip `composeFullName(parsePersonName(x)) === x`, and harness cleanup sweeps match on those prefixes.
- Ambiguous parses set `parse_review` (single_token, many_tokens, honorific_only_remainder, unrecognized_honorific — the last fires on a leading dotted abbreviation like "Rev." that isn't in the honorific canon). Surface, don't guess.
- Contract/e-sign signer snapshots: NEW snapshots upgrade signer names to `composeLegalName` (honorific + first + middle + last) via `legalNamesByEmail` inside BOTH `sendContract` and `sendSignatureRequest` (idempotent double-apply). Historical snapshots stay frozen by design.
- Invitation flow: structured fields ride in `personDraft`; accept-time write wins when first+last present, else the parser handles legacy fullName-only drafts. Creating a roster invitation requires a hiring source (sourceKind+sourceId) — probes must seed a hired candidate first.
- Me-lens self-edit intentionally accepts only `preferredName` (employee-only; contractors blocked); structured name self-edits are NOT whitelisted.
- Frontend shared helpers: `artifacts/atelier/src/components/StructuredNameFields.tsx` (splitLegacyFullName prefills, first+last required). Candidate/offer forms deliberately keep single `candidateName`.
- E2E probe: `artifacts/api-server/scripts/person-invite-probe.ts` (self-cleaning, boots app.listen(0), NODE_ENV=test persona bypass).
