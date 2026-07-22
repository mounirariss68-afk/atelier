# Partners Lens — Backlog

Task #513 rationalized the Partners lens around a unified partner-firm
registry with real CRUD, CRM-linked co-sell, roster/RCTI-backed co-deliver,
and e-sign-backed agreements. The following capabilities existed as
hardcoded illustrative sections in the old lens and were deliberately
**removed rather than rebuilt**. They are candidates for future work; each
should be built on real data flows, not static content.

## Removed sections and how to rebuild them properly

### 1. Market Development Funds (MDF)
Old lens showed a static MDF budget/claims table.
Rebuild: an `atelier_partner_mdf` ledger (allocations, claims, approvals)
linked to a partner firm and to finance (GL journal lines for claim
reimbursements). Approval should follow the founder/finance approval
patterns used for expenses.

### 2. Joint marketing campaigns
Old lens listed fictional campaigns.
Rebuild: campaign records linked to a partner firm + optional joint-pipeline
entries (attribution of sourced opportunities). Should integrate with the
Studio/press surfaces if marketing tracking is expanded firm-wide.

### 3. Quarterly Business Reviews (QBRs)
Old lens showed a fake QBR cadence.
Rebuild: QBR records per firm (date, attendees, notes, actions), ideally as
meetings with `partner_firm` polymorphic parent so they ride the existing
meeting/transcript pipeline. Actions should create real tasks.

### 4. Partner scorecards
Old lens hardcoded composite health scores.
Rebuild: computed scorecards derived from real signals — joint pipeline
volume/win-rate, resource utilization from timesheets, RCTI dispute rate,
certification coverage, conflict count — rather than manually entered
scores. Capability scores (Qualify) already cover the manual dimension.

### 5. Sub-contract SOWs
Old lens listed illustrative sub-contract statements of work.
Rebuild: SOWs as real e-sign contracts (instrument type `subcontract_sow`)
with the partner firm as counterparty, linked to an engagement. The Govern
tab already surfaces any agreement created this way; the gap is a dedicated
authoring flow with engagement linkage and value tracking against
partner-resource costs.

### 6. Partner economics
The `partner_economics` table and its illustrative revenue-share figures
were removed. Rebuild: derive partner economics from real data — joint
pipeline splits (`cognirisePct`/`partnerPct` on won opportunities), RCTI
invoice spend per firm, and engagement margins — surfaced as a read-only
analytics view in Co-deliver or Renew.

### 7. Alliance agent (AllianceChoreographer)
The agent that generated illustrative alliance narratives was removed.
Rebuild: an agent grounded in the real registry (firms, pipeline,
agreements, conflicts) producing renewal briefs, conflict-check sweeps
against the CRM account base, or QBR prep packs. Follow the async
launch-map pattern used by other long-running agents.

## Notes
- No seeding: all partner data enters via the UI/API only.
- Access: readers = anyone passing the Partners lens gate; writers =
  founding_partner / partner / senior_manager / finance.
- Tier changes are auto-recorded in `tierHistory` on the firm record when
  tier is edited — future renewals work can build on that audit trail.

### 8. Evaluation framework Stages 4–7 as agent output (Task #526 out-of-scope)
The Alliance Cartographer covers framework Stages 1–2 + 8–9 (fit scorecard,
due diligence, risk register, phasing) as pending proposals. Stages 4–7 —
deal-structure selection, the commercial-model toolkit, protective terms,
and compliance gates — stay human/legal for now (the agent may emit a short
archetype + phasing note only). Rebuild: extend the Cartographer output
schema with a suggested deal-structure + commercial-model section grounded
in the archetype, and link protective-terms checklists to the e-sign
contract flow; keep everything proposals-only behind partner review.
