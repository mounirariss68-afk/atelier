---
name: Partner capability profiles & RAG
description: Two-dimensional partner stage model, capabilityProfile approval flow, partner_firm RAG chunks, and the prod re-run obligations.
---

# Partner capability profiles & RAG (Task #871 era)

- Stage model is two-dimensional: `partnershipStage` (consideration → exploration → agreed; legacy "candidate" maps to consideration at boot via the atelier-cli-rag.sql DO block) plus `agreementStage` (preparing → negotiating → reviewing → signing → signed), which is non-NULL **iff** agreed. `reconcileStages()` in partnersRoutes and the chat `alliance_partner_add` both enforce the pairing — any new write surface must too, or the boot backfill ("agreed + NULL → signed") will misclassify the row as legacy.
- `capabilityProfile` (summary + domains with evidence/sourceUrls) is written ONLY via the pendingUpdates approval path; the Alliance Cartographer proposes it (prompt + normalizer + `partnerProposalKey` strips researchedAt/researchedBy so re-runs dedupe).
- RAG: `partner-capability-rag.ts` owns refresh/remove/search. Refresh (fire-and-forget) fires on: firm create (REST, chat, target-promote, coverage tool), name/speciality/capabilities PATCH, and approval of profile-ish proposal fields; remove fires on archive. Chunks are rebuilt wholesale per firm (`<firmId>#cNNN`, brute-force cosine, org-scoped in every read). Entity embedding mirrors via `mirrorEntityEmbedding` — the general entity-embedding backfill still EXCLUDES partner_firm on purpose.
- Riser answers via the `alliance.partner_capabilities` capability (no employee/contractor in requiredRoles; self-only clamp also applies). Citations = per-chunk sourceUrls.
- **Why fire-and-forget refresh bit us once**: a one-off script that `process.exit(0)`s right after approving proposals kills the in-flight refresh — the last-approved firm ends up with zero chunks. Wait or refresh explicitly in scripts.

**PROD RE-RUN AT GO-LIVE** (dev DB data never merges): run `scripts/src/t871-alliance-partners-ingest.ts all` against prod (in-process test-mode app pattern won't work in prod — persona cookie needs the dev switcher; adapt to a real session) to re-create the 7 partners (BGTS, Argano, Thoughtworks agreed/signing/signing/reviewing; Lupitor agreed/negotiating; Agentic Dynamic agreed/preparing; Ekimetrics + Extra360 exploration) with live research + approvals. The stage backfill SQL runs itself at boot.
