---
name: Alliance evaluation agents
description: Alliance Cartographer/Executive Mapper invariants — proposal keys, status semantics, opp-delete lint allowlist
---

- Proposal dedupe: `partnerProposalKey` must strip volatile fields (scoredAt/scoredBy, assessedAt/assessedBy, riskRegister item ids) — otherwise identical agent re-runs queue duplicate proposals. **Why:** those fields are code-stamped per run.
- Agent status route: only launch-map entries report "succeeded"; a CHAINED mapper (fire-and-forget, no launch entry) shows the durable run-row terminal status "complete". UI keys only off running/failed, so both are fine. Launch map takes precedence over DB rows; DB rows drive status only after a server restart.
- `queuePartnerFirmProposals` audit rows carry `orgId` from the locked firm row (multi-tenant integrity).
- The five candidates (Argano, BGTS, Thoughtworks, Mobven, Prometa.ai=competitor_monitor) were ingested 2026-07-22 via a one-off self-deleted script and both agents ran live on all five; proposals await human review — never re-seed.
- cli-catalog opportunity-delete lint: scratch-DB probe cleanup deletes belong in `ALLOWED_FILES` in `atelier-lint-opportunity-deletes.ts`; new probes that delete their own opp fixture rows must be allow-listed or the suite fails.
