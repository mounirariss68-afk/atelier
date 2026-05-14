# Lead-to-Cash Gap Analysis & Roadmap

> **Scope.** Atelier is the AICo employee portal for a professional-services firm
> (consulting + delivery + advisory). This document audits the firm's
> end-to-end **Lead-to-Cash (L2C)** loop against what the portal ships today,
> identifies the structural gaps, and sequences the remediation as four
> delivery waves.
>
> **Intended audience.** Founding partners, Finance, the v4/v5 working group,
> and any agent (human or LLM) picking up an L2C-related capability after
> Task #357.
>
> **Companion docs.**
> - `artifacts/atelier/docs/prd/v4-commercial-loop.md` — the v4 commercial-loop
>   PRD (CRM → Pipeline → Proposal → Engagement → Wallet → Ledger).
> - `artifacts/atelier/docs/v5-scale-and-trust.md` — the v5 Scale & Trust track
>   (Press, Alliances, Studio, Guardhouse, IP) which runs **orthogonal** to L2C.
>
> **What this document is *not*.** It is not a build spec for any single
> capability — every gap section ends with the artifact you would author
> *next* (route handler, agent, schema migration, card renderer) so that the
> implementing task agent has a clear seam.

---

## A. Gap Analysis

### A.1 Reference L2C — the 13 stages we audit against

| # | Stage | Owning persona(s) | "Done" signal |
|---|-------|-------------------|---------------|
| 1 | **Demand capture** (inbound + outbound triggers) | partner, senior_manager | Account row created with `tier`, `partnerOwnerName`. |
| 2 | **Account qualification** (tier, sector fit) | partner | Account `tier` ∈ {A, B, C, D} set; whitespace mapped. |
| 3 | **Opportunity creation & qualification** | partner, senior_manager | Opportunity in `salesStage=suspect` with rubric. |
| 4 | **Pursuit** (POV, research, meetings) | partner, senior_manager, consultant | Opportunity advances `prospect → convert → runner`. |
| 5 | **Proposal & pricing** | partner, senior_manager | Proposal artifact + commercials block. |
| 6 | **Contracting / CLM** | partner (countersign) | Signed MSA + SOW; opportunity → `contract`. |
| 7 | **Engagement setup** (charter, team, RAID) | partner, senior_manager | `atelier_engagement` row with charter + access grants. |
| 8 | **Delivery & timekeeping** | senior_manager, consultant, contractor | Timesheets approved against the engagement. |
| 9 | **Change control** (scope, rate, term changes) | partner | A formal change-order artifact attached to the engagement. |
| 10 | **Revenue recognition** | finance | A per-period revenue posting matched to performance. |
| 11 | **Invoicing & e-invoicing** | finance | Customer-facing invoice document + tax-authority submission. |
| 12 | **Collections & cash application** | finance | Cash received and applied to the invoice; AR aging closed. |
| 13 | **Renewal / expansion / churn** | partner, senior_manager | Renewal opportunity opened OR engagement closed with reason. |

### A.2 Coverage today (what Atelier actually does)

The current portal covers stages **1 → 8** end-to-end and stage **9** partially:

- **Stages 1–4** are owned by `/crm` (Accounts) and `/opportunities` (Pipeline — 5-band funnel:
  Suspect → Prospect → Convert → Runner → Contract), and the per-opportunity
  workspace tabs (Brief, Research, POV, Meetings, Proposal, Commercials).
- **Stage 5** has Proposal + Commercials tabs and the pricing capability.
- **Stage 6** captures the *outcome* of contracting (the opportunity moves to
  `contract`) but the contract artifact itself is uploaded as an attachment —
  there is no CLM, no clause library, no redline ledger.
- **Stage 7** is the Engagement workspace (charter, RAID, access grants,
  deliverables).
- **Stage 8** is `/wallet` (timesheets, expenses, lead-approve, partner
  approve) backed by the Wallet capability cluster.
- **Stage 9** (change orders) exists informally as a RAID item or a charter
  edit; there is no first-class change-order artifact.

Everything from **stage 10 onward** is currently outside the portal.

### A.3 The 12 gaps

Each gap below is named, scoped, and tagged with the persona(s) most
penalised by its absence. The companion sections (B–E) refer to these gaps
by id (`G01`–`G12`).

| ID | Gap | Stage(s) | Penalty today |
|----|-----|----------|---------------|
| **G01** | **CLM / Codex of clauses & contracts** | 6 | Redlines live in email; no clause reuse; no countersign trail. |
| **G02** | **Change-order workflow** | 9 | Scope creep is invisible until margin slips; no audit of who approved what. |
| **G03** | **ASC 606 revenue recognition** | 10 | No deferred revenue, no POC %-complete posting, no schedule. |
| **G04** | **WIP & unbilled-revenue report** | 10 | Finance cannot answer "what have we earned but not invoiced?" |
| **G05** | **Real invoicing** (document, not a wallet line) | 11 | Invoices are produced in spreadsheets and lose link to the engagement. |
| **G06** | **E-invoicing compliance** (ZATCA / FTA / Peppol) | 11 | Manual portal submissions; no clearance status on the invoice. |
| **G07** | **AR aging & DSO tracking** | 12 | DSO is computed quarterly by hand; no live aging buckets. |
| **G08** | **Collections Concierge & dunning** | 12 | Reminder emails are ad-hoc; no escalation ladder; no promise-to-pay log. |
| **G09** | **Inbound cash application & bank reconciliation** | 12 | Cash receipts arrive as bank statements; matching to invoice is manual. |
| **G10** | **Cash-flow forecast** (13-week rolling) | 12 | Treasury cannot see when cash will land vs. payroll outflow. |
| **G11** | **Renewals, NRR & expansion tracking** | 13 | Renewals are reactive — no auto-opened renewal opportunity at T-90d. |
| **G12** | **Leakage / realization & per-engagement margin variance** | 8, 10 | No view of billable rate vs. realized rate; partners cannot see which engagements bleed. |

### A.4 KPIs the portal cannot compute today

These are the headline numbers a services CFO reports to the board. Each
maps to one or more gaps; the gap must close before the KPI is trustable.

| KPI | Definition | Blocked by |
|-----|------------|------------|
| **DSO** (Days Sales Outstanding) | (AR / Revenue) × days in period | G05, G07 |
| **CEI** (Collections Effectiveness Index) | Collected ÷ (Beginning AR + Credit Sales − Ending AR) | G07, G08, G09 |
| **Realization rate** | Billed $ ÷ (Billable hours × standard rate) | G05, G12 |
| **Utilization** (already computed) | Billable hours ÷ Capacity hours | — (covered by Wallet) |
| **Engagement margin** | (Revenue − Direct cost) ÷ Revenue | G03, G12 |
| **NRR** (Net Revenue Retention) | (Starting ARR + Expansion − Churn) ÷ Starting ARR | G11 |
| **Unbilled WIP** | Earned but un-invoiced revenue at period end | G03, G04, G05 |
| **Cash-conversion cycle** | DSO − DPO + DIO | G05, G07, G09, G10 |
| **Backlog** | Signed contract value − recognised revenue | G01, G03 |
| **Renewal rate** | Renewed contract value ÷ Contract value up for renewal | G11 |

---

## B. UX & Information-Architecture Spec

### B.1 IA principle — *no new top-nav slot per gap*

The current `Shell.tsx` top nav exposes the Commercial realm as a small
set of named entries (Accounts → `/crm`, Opportunities → `/opportunities`,
plus the Scale and IP realms). The L2C waves must not bloat that header
into an accounting product. Concretely:

- **Reuse the Commercial realm.** `/wallet` is the existing finance
  surface for the firm. New finance surfaces (Invoices, AR, Cash) are
  **secondary destinations** reached from a Wallet sub-nav, not from
  the top nav.
- **Treasury is not a persona realm.** It is a Wallet sub-section gated
  to `finance` + `founding_partner`. If a top-nav entry for Wallet is
  added (it currently is not), it may carry an aggregate "needs action"
  badge (overdue invoices + unmatched receipts), but the link target
  stays `/wallet`.
- **Home Workspace shelf is the cross-realm surface.** New tiles
  (Receivables, Cash forecast, Renewals at-risk) live there mirroring the
  existing Approvals / Ledger / Roster shelf cards.
- **Card-first principle.** Every CLI capability that produces a finance
  result must return a typed `resultCard` shape (B.2). The chrome surface
  is then a thin assembly of those cards, never a bespoke layout per page.

### B.2 New result-card shapes

These extend the existing renderer set in
`artifacts/atelier/src/components/cli/ResultCardRenderers.tsx` (current
shapes: `kpi_strip`, `ranked_list`, `time_series`, `entity_card`,
`audit_timeline`, plus the per-entity cards added in Task #349). The
`ResultCard` union in
`artifacts/api-server/src/lib/atelier-cli/capability-catalog.ts` must be
extended in the same PR that ships the first capability that emits each
shape — the catalog hash check breaks the build otherwise.

| Shape | Purpose | Required fields | Optional fields |
|-------|---------|-----------------|-----------------|
| **`invoice_card`** | One invoice with header + lines + status. | `invoiceId`, `invoiceNumber`, `customerName`, `engagementId`, `issueDate`, `dueDate`, `currency`, `subtotal`, `tax`, `total`, `status` (draft/issued/paid/void), `lines[]` | `clearanceStatus` (for e-invoicing), `clearanceUuid`, `pdfUrl` |
| **`ar_aging_grid`** | AR aged into 0/30/60/90+ buckets. | `asOf`, `currency`, `rows[]` of `{customerId, customerName, current, d30, d60, d90, d120plus, total}`, `totals` | `dsoDays`, `top5DelinquentIds[]` |
| **`cash_forecast_strip`** | 13-week rolling cash position. | `startWeek`, `weeks[]` of `{weekStart, expectedIn, expectedOut, openingBalance, closingBalance}` | `confidenceLow[]`, `confidenceHigh[]` (band) |
| **`dunning_card`** | One customer's collection state + ladder position. | `customerId`, `customerName`, `arTotal`, `oldestInvoiceAgeDays`, `ladderStep` (gentle/firm/escalation/legal), `lastTouchAt`, `nextActionDueAt`, `promisesToPay[]` | `escalationOwnerName`, `holdShipments?: boolean` |
| **`revenue_schedule`** | Per-engagement deferred-revenue / POC schedule. | `engagementId`, `engagementName`, `method` (POC, ratable, milestone), `currency`, `periods[]` of `{periodStart, recognisedAmount, deferredEnding, basisPct}` | `contractValue`, `recognisedToDate`, `unbilledWip` |
| **`change_order_card`** | One change order proposed against an engagement. | `changeOrderId`, `engagementId`, `summary`, `kind` (scope/rate/term/team), `oldValue`, `newValue`, `valueDeltaUsd`, `status` (draft/proposed/accepted/rejected), `requestedByName`, `partnerApproverName` | `clientApproverName`, `clientApprovedAt`, `linkedRaidId` |
| **`renewal_card`** | Renewal opportunity, NRR contribution, risk tier. | `renewalId`, `engagementId`, `accountName`, `currentArrUsd`, `proposedArrUsd`, `nrrDeltaPct`, `renewalDueAt`, `riskTier` (green/amber/red), `partnerOwnerName` | `lastQbrAt`, `csatScore`, `expansionThemes[]` |

Each new shape needs a renderer, a story in the mockup-sandbox, and a
contract test in `artifacts/api-server/tests/cli-smoke/run.ts` (B.4).

### B.3 Where each new surface lives in the chrome

| New surface | Surface route | Reached via | Top-nav badge contribution |
|-------------|---------------|-------------|----------------------------|
| Codex (CLM clause library) | `/wallet/codex` | Wallet sub-nav · *Documents* | none |
| Change orders | `/engagements/:id` → new **Changes** tab | Engagement workspace | engagement-card "Δ open" chip |
| Revenue recognition | `/wallet/revrec` | Wallet sub-nav · *Revenue* | none (period-close badge only) |
| WIP report | `/wallet/wip` | Wallet sub-nav · *Revenue* | none |
| Invoices | `/wallet/invoices` | Wallet sub-nav · *Receivables* | overdue count |
| AR aging | `/wallet/ar` | Wallet sub-nav · *Receivables* | overdue count |
| Cash forecast | `/wallet/treasury` | Wallet sub-nav · *Treasury* | none |
| Collections Concierge | `/wallet/collections` | Wallet sub-nav · *Receivables* | dunning queue count |
| Renewals dashboard | `/accounts` → new **Renewals** filter + Home shelf tile | Account workspace + Home | red-tier renewal count |
| Leakage / margin | `/engagements/:id` → existing Commercials tab + Home shelf tile | Engagement + Home | none |

### B.4 Acceptance signals

Each new surface ships when:

1. The route renders the result-card shape via the CLI renderer (no
   bespoke layout outside the card).
2. The capability is reachable as a slash-command and as a
   representativePrompt suggestion chip from the relevant Surface.
3. A row exists in `tests/cli-smoke/run.ts` exercising the read
   capability and (if write) the two-phase confirm path.

---

## C. Persona × Capability RBAC Matrix

The 11 canonical roles (`artifacts/api-server/src/routes/atelier/personaRoles.ts`):
`founding_partner`, `partner`, `finance`, `hr`, `senior_manager`,
`consultant`, `contractor`, `partner_firm_resource`, `board_observer`,
`recruiter`, `compliance_officer`.

**Restricted set** (`contractor`, `partner_firm_resource`, `recruiter`)
must remain narrowed to their explicit engagement grants — they get
**no** Treasury, AR, invoice, cash, or revrec visibility regardless of
the matrix below. Enforcement is **not** at the catalog `requiredRoles`
gate (today the default gate only excludes `board_observer`); it is
enforced by RLS on the underlying tables and by the per-surface guards
that already narrow restricted personas to their `atelier_engagement_access`
rows. New L2C tables added in waves 1–4 must follow that same RLS
pattern (deny-by-default for the restricted set).

**`board_observer` is hard-filtered today.** `capabilitiesForPersona()`
in `capability-catalog.ts` restricts the observer to read-only `meta`
+ `raid` capabilities. The R grants below for `board_observer` are
therefore the **target state** that ships alongside Wave 2 — they
require relaxing the observer filter to also allow read-only `wallet`,
`ledger`, and `report` modules. Until that one-line filter change
lands, the matrix below should be read as "denied" for `board_observer`.

Legend: **W**=write, **R**=read, **A**=approve (two-phase confirm), **·**=denied.

| Capability cluster | founding_partner | partner | finance | hr | senior_manager | consultant | board_observer | compliance_officer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| **G01** Codex — read clause library | R | R | R | · | R | R | · | R |
| **G01** Codex — author / publish clause | A | A | W | · | · | · | · | · |
| **G01** Contract — countersign | A | A | · | · | · | · | · | · |
| **G02** Change order — propose | W | W | · | · | W | · | · | · |
| **G02** Change order — approve | A | A | · | · | · | · | · | · |
| **G03** Revenue schedule — read | R | R | R | · | R (own engs) | · | R | R |
| **G03** Post period revenue | A | · | A | · | · | · | · | · |
| **G04** WIP report — read | R | R | R | · | R (own engs) | · | R | R |
| **G05** Invoice — draft | · | · | W | · | · | · | · | · |
| **G05** Invoice — issue | A | A | A | · | · | · | · | · |
| **G05** Invoice — void | A | · | A | · | · | · | · | · |
| **G06** E-invoicing submit | · | · | W | · | · | · | · | · |
| **G07** AR aging — read | R | R | R | · | R (own accts) | · | R | R |
| **G08** Dunning — send (outboundChannel: email) | · | A | A | · | · | · | · | · |
| **G09** Cash receipt — apply | · | · | W | · | · | · | · | · |
| **G09** Bank reconciliation — finalise | A | · | A | · | · | · | · | · |
| **G10** Cash forecast — read | R | R | R | · | · | · | R | R |
| **G11** Renewal — open opportunity | W | W | · | · | W | · | · | · |
| **G11** Renewal — close-lost | A | A | · | · | · | · | · | · |
| **G12** Leakage / margin — read | R | R | R | · | R (own engs) | · | R | R |

**Rules baked in:**

- **Treasury writes (invoice issue, void, dunning, cash apply, bank rec)
  are `finance`-anchored.** `founding_partner` co-approves but does not
  initiate. `partner` only co-approves dunning sends.
- **Codex redline / publish requires partner-tier countersign.** Mirrors
  the existing two-phase write pattern in the catalog.
- **Senior managers see "own engagements" / "own accounts" only.**
  Already enforced by `atelier_engagement_access` for engagement-scoped
  rows; finance reports inherit that scope when the request comes from a
  senior_manager.
- **`board_observer` is read-only across all finance.** No approvals,
  no email side-effects, no cash writes.
- **`compliance_officer` gets firm-wide read on revenue / AR / cash for
  audit purposes** (matches their Guardhouse-firm-wide-read posture)
  but no writes and no email side-effects.
- **`hr` is denied across the L2C cluster** — they keep Roster, comp,
  and personnel-contract realms only.
- **Contractors / partner-firm resources / recruiters are denied
  across the L2C cluster** by RESTRICTED-set policy.

---

## D. CLI / Agent Integration Spec — per gap

Each gap registers one or more capabilities via `defineCapability` in the
catalog (`artifacts/api-server/src/lib/atelier-cli/capability-catalog.ts`)
and is colocated with its route handler via `defineRouteCapability`. Each
write capability MUST also emit a row in `tests/cli-smoke/run.ts` so the
CLI smoke suite covers it.

For brevity below, `2PC` = `twoPhaseConfirm: true`, `irrev` =
`irreversible: true`, `email` = `outboundChannel: "email"`.

### G01 — CLM / Codex

```text
toolName: codex_search_clauses
slashAliases.en: ["/codex", "/clauses", "/clause-search"]
representativePrompts.en:
  - "Find termination-for-convenience clauses we used in MENA SOWs."
  - "Show indemnity caps from contracts signed in the last 12 months."
resultCard: ranked_list
isWrite: false ; 2PC: false ; outboundChannel: null
requiredRoles: (default — everyone except board_observer; restricted set denied)
surfaceOn: ["wallet", "opportunity_workspace", "global"]

toolName: codex_publish_clause
slashAliases.en: ["/clause-publish"]
resultCard: entity_card
isWrite: true ; 2PC ; irrev (publishes to firm-wide library)
requiredRoles: ["founding_partner","partner","finance"]

toolName: contract_countersign
resultCard: entity_card
isWrite: true ; 2PC ; irrev
outboundChannel: "email"  (sends signed PDF to client)
requiredRoles: ["founding_partner","partner"]
```

Smoke fixture: a search returning ≥1 clause; a dry-run publish.

### G02 — Change orders

```text
toolName: change_order_propose
slashAliases.en: ["/change-order", "/co", "/scope-change"]
representativePrompts.en:
  - "Propose a +20% scope change on Engagement E-1042 with rationale."
resultCard: change_order_card
isWrite: true ; 2PC ; outboundChannel: null
requiredRoles: ["founding_partner","partner","senior_manager"]
surfaceOn: ["engagement_dashboard"]

toolName: change_order_approve
resultCard: change_order_card
isWrite: true ; 2PC ; irrev
outboundChannel: "email"
requiredRoles: ["founding_partner","partner"]
```

### G03 — Revenue recognition

```text
toolName: revrec_compute_schedule
representativePrompts.en:
  - "Compute the POC revenue schedule for Engagement E-1042 using current burn."
resultCard: revenue_schedule
isWrite: false  (deterministic compute over current state)

toolName: revrec_post_period
slashAliases.en: ["/post-revenue", "/revrec"]
resultCard: revenue_schedule
isWrite: true ; 2PC ; irrev (creates immutable period postings)
requiredRoles: ["founding_partner","finance"]
surfaceOn: ["wallet"]
```

### G04 — WIP report

```text
toolName: wip_report
slashAliases.en: ["/wip", "/unbilled"]
resultCard: kpi_strip   (engagement-level breakdown follows in a chained ranked_list call via followUpTriggers)
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
```

### G05 — Invoicing

```text
toolName: invoice_draft
representativePrompts.en:
  - "Draft an invoice for E-1042 covering October time and expenses."
resultCard: invoice_card
isWrite: true ; 2PC
requiredRoles: ["finance"]

toolName: invoice_issue
resultCard: invoice_card
isWrite: true ; 2PC ; irrev
outboundChannel: "email"  (PDF + dunning-clock starts)
requiredRoles: ["founding_partner","partner","finance"]

toolName: invoice_void
isWrite: true ; 2PC ; irrev
requiredRoles: ["founding_partner","finance"]
```

### G06 — E-invoicing (ZATCA / FTA / Peppol)

```text
toolName: einvoice_submit
slashAliases.en: ["/einvoice", "/zatca", "/fta-submit"]
resultCard: invoice_card  (clearanceStatus populated)
isWrite: true ; 2PC ; irrev (tax-authority submission)
outboundChannel: null  (server-to-server, not email)
requiredRoles: ["finance"]
```

### G07 — AR aging

```text
toolName: ar_aging_report
slashAliases.en: ["/ar", "/aging"]
representativePrompts.en:
  - "Show me AR aging by customer as of today."
  - "Which Tier-A accounts are over 60 days past due?"
resultCard: ar_aging_grid
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
surfaceOn: ["wallet","home"]
```

### G08 — Collections Concierge

```text
toolName: dunning_next_action
resultCard: dunning_card
isWrite: false  (advises ladder step)

toolName: dunning_send_reminder
slashAliases.en: ["/chase", "/dunning"]
representativePrompts.en:
  - "Send the second-reminder dunning for ACME on invoice INV-2310."
resultCard: dunning_card
isWrite: true ; 2PC
outboundChannel: "email"  (always — undo blocked)
requiredRoles: ["partner","finance"]

toolName: dunning_log_promise_to_pay
isWrite: true ; 2PC: false  (low-stakes log entry)
requiredRoles: ["partner","finance","senior_manager"]
```

### G09 — Cash application & bank rec

```text
toolName: cash_apply
resultCard: invoice_card  (status flips to paid)
isWrite: true ; 2PC ; irrev
requiredRoles: ["finance"]

toolName: bank_recon_finalise
resultCard: kpi_strip
isWrite: true ; 2PC ; irrev
requiredRoles: ["founding_partner","finance"]
```

### G10 — Cash-flow forecast

```text
toolName: cash_forecast_13w
slashAliases.en: ["/cash", "/forecast-cash", "/treasury"]
resultCard: cash_forecast_strip
isWrite: false
requiredRoles: ["founding_partner","partner","finance","compliance_officer","board_observer"]
surfaceOn: ["wallet","home"]
```

### G11 — Renewals & NRR

```text
toolName: renewal_open_opportunity
representativePrompts.en:
  - "Open a renewal opportunity for ACME's annual retainer due in Q2."
resultCard: renewal_card
isWrite: true ; 2PC
requiredRoles: ["founding_partner","partner","senior_manager"]
surfaceOn: ["account_workspace","home"]

toolName: renewal_close_lost
isWrite: true ; 2PC ; irrev
requiredRoles: ["founding_partner","partner"]
```

### G12 — Leakage / realization

```text
toolName: leakage_report
slashAliases.en: ["/leakage", "/realization", "/margin"]
representativePrompts.en:
  - "Which engagements had >10% realization slip last quarter?"
resultCard: ranked_list  (engagement rows w/ variance)
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
surfaceOn: ["engagement_dashboard","home"]
```

### Smoke-test fixtures

Add one row per capability above to
`artifacts/api-server/tests/cli-smoke/run.ts`. The pattern is the same
as the existing wallet/ledger fixtures: a deterministic prompt, an
expected `resultCard` type, and (for writes) a confirm POST in dry-run
mode that asserts the diff envelope shape without committing.

---

## E. Sequenced Roadmap — four delivery waves

The waves are ordered so each wave unlocks the dependencies of the next.
You cannot ship invoicing before Codex (you need a contract artifact to
invoice against); you cannot ship AR before invoicing; you cannot ship
cash forecast before AR. Each wave is a single deployable slice — the
portal stays consistent at the end of every wave.

### Wave 1 — **Codex + Change Orders** (foundations of the contract record)

**Goal.** Make the contract a first-class artifact in the portal so
everything downstream (revrec, invoicing, AR) has a stable referent.

- Gaps: **G01, G02**.
- New schema: `atelier_contract`, `atelier_contract_clause`,
  `atelier_change_order` (+ link tables to engagement / opportunity).
- New routes: `routes/atelier/codex/*`, `routes/atelier/change-orders/*`.
- New surfaces: `/wallet/codex`, Engagement → **Changes** tab.
- New capabilities: `codex_search_clauses`, `codex_publish_clause`,
  `contract_countersign`, `change_order_propose`, `change_order_approve`.
- Card shapes added to the union: `change_order_card` (clauses reuse
  existing `entity_card` + `ranked_list`).
- Acceptance: every `salesStage=contract` opportunity carries a Codex
  contract row; every engagement can host change orders; the v4
  Commercials tab can deep-link to the contract.
- Out of scope: signing UX (still e-mail PDF in this wave).

### Wave 2 — **Revenue Recognition + WIP** (the earnings ledger)

**Goal.** Move from "we billed X" to "we earned X" — the prerequisite
for any honest engagement-margin number.

- Gaps: **G03, G04, G12**.
- New schema: `atelier_revenue_schedule`,
  `atelier_revenue_period_posting`, `atelier_unbilled_wip_snapshot`.
- New routes: `routes/atelier/revrec/*`, `routes/atelier/wip/*`.
- New surfaces: `/wallet/revrec`, `/wallet/wip`, Home shelf tile **Margin
  & WIP**.
- New capabilities: `revrec_compute_schedule`, `revrec_post_period`,
  `wip_report`, `leakage_report`.
- Card shape added: `revenue_schedule`.
- Depends on Wave 1 (`contractValue` lives on the contract).
- Acceptance: period-close runs a deterministic POC schedule per
  engagement; finance can post a period; `leakage_report` returns one
  row per engagement with realised vs. billable rate variance.

### Wave 3 — **Invoicing + AR + e-invoicing** (the receivables stack)

**Goal.** Issue real invoices, age them, and meet ZATCA / FTA / Peppol
obligations.

- Gaps: **G05, G06, G07, G08**.
- New schema: `atelier_invoice`, `atelier_invoice_line`,
  `atelier_dunning_event`, `atelier_einvoice_submission`.
- New routes: `routes/atelier/invoices/*`, `routes/atelier/ar/*`,
  `routes/atelier/dunning/*`, `routes/atelier/einvoice/*`.
- New surfaces: `/wallet/invoices`, `/wallet/ar`, `/wallet/collections`,
  Home shelf tile **Receivables**.
- New capabilities: `invoice_draft`, `invoice_issue`, `invoice_void`,
  `einvoice_submit`, `ar_aging_report`, `dunning_next_action`,
  `dunning_send_reminder`, `dunning_log_promise_to_pay`.
- Card shapes added: `invoice_card`, `ar_aging_grid`, `dunning_card`.
- Depends on Wave 2 (invoice draws from revenue schedule + WIP) and
  Wave 1 (invoice references a contract).
- Acceptance: a finance user can draft → partner-issue an invoice;
  ZATCA/FTA clearance status is reflected on the card; AR aging shows
  the issued invoice; dunning ladder advances with each send.

### Wave 4 — **Cash, Bank Rec & Renewals** (closing the loop)

**Goal.** Close the cash leg of L2C and add the forward-looking
renewal motion.

- Gaps: **G09, G10, G11**.
- New schema: `atelier_cash_receipt`, `atelier_bank_recon_period`,
  `atelier_renewal` (+ link from `atelier_engagement`).
- New routes: `routes/atelier/cash/*`, `routes/atelier/treasury/*`,
  `routes/atelier/renewals/*`.
- New surfaces: `/wallet/treasury`, `/accounts` Renewals filter, Home
  shelf tile **Renewals at risk**.
- New capabilities: `cash_apply`, `bank_recon_finalise`,
  `cash_forecast_13w`, `renewal_open_opportunity`,
  `renewal_close_lost`.
- Card shapes added: `cash_forecast_strip`, `renewal_card`.
- Depends on Wave 3 (cash applies to an invoice).
- Acceptance: receipt → cash-apply flips invoice to paid; bank rec
  finalises a period; the Treasury page shows a 13-week strip; the
  renewal motion auto-opens a `renewal_card` at T-90d and contributes
  to NRR.

### Cross-wave plumbing (do once, in Wave 1)

- Extend the `ResultCard` union with all seven new shapes up-front so
  the catalog hash check is monotonic across the four waves.
- Add a `/wallet` sub-nav component in `Shell.tsx` (the top nav itself
  does not change). Sub-nav slots are gated by the RBAC matrix in C.
- Add `finance` and `compliance_officer` to the Home Workspace shelf
  query so they receive the Receivables / Treasury / Margin tiles as
  their persona unlocks.

---

## F. Cross-references

### F.1 Anchored in v4

The v4 commercial-loop PRD (`docs/prd/v4-commercial-loop.md`) explicitly
names the full sign → invoice → collect → renew arc as in-scope and
includes a `/treasury` data model and ZATCA / FTA / dunning / cash
forecast / revrec acceptance criteria. **All twelve gaps in this
document are gaps between v4-as-specified and v4-as-built**, not gaps
in the v4 specification itself.

This document does **not** redefine v4. It (a) re-states the L2C
ambition against the canonical 13-stage process so the gap inventory
is unambiguous, (b) decomposes the un-built portion into 12 named
gaps (G01–G12), (c) attaches each gap to a concrete CLI capability +
result-card shape so implementation can begin at the catalog seam,
and (d) sequences the build into four waves whose dependency order
matches the data dependencies (you cannot age an invoice that does
not exist; you cannot apply cash to a missing AR row).

The v4 surfaces that remain canonical and unchanged here are: the
Pipeline funnel (Suspect → Prospect → Convert → Runner → Contract),
the per-opportunity tabs (Brief / Research / POV / Meetings / Proposal
/ Commercials), the Engagement charter / RAID / access model, and
Wallet timekeeping.

### F.2 Orthogonal to v5

The v5 Scale & Trust track (`docs/v5-scale-and-trust.md`) is **orthogonal**
to L2C. v5 introduces:

- **Press, Alliances, Studio, Guardhouse, IP** — all firm-of-the-firm
  surfaces that produce demand or de-risk operations, but none of which
  participate in invoicing or cash.
- Two new personas — `recruiter` (Studio-only) and `compliance_officer`
  (Guardhouse + firm-wide audit read).

L2C touch-points with v5 are limited to:

- The `compliance_officer` persona is granted firm-wide **read** on
  L2C surfaces (G03 / G04 / G07 / G10 / G12) so audit evidence is
  collectable from the same portal. They get **no** writes and **no**
  email side-effects on L2C.
- The `recruiter` persona stays in the RESTRICTED set across L2C —
  they cannot see invoices, AR, cash, or renewals.
- Two v5 agents are demand-adjacent and may eventually fire renewal
  signals into G11: `offer_composer` (proposal-side) and
  `alliance_choreographer` (partner co-sell). The integration seam is
  a future `renewal_signal_ingest` capability — explicitly **out of
  scope** for waves 1–4.

### F.3 Where to start

The next implementing task agent should pick up **Wave 1 (G01 + G02)**
and propose it as a single project task. The seam is clean (new
schema + new routes + two new capabilities + one new card shape +
one new Engagement tab); no v4 surface needs to change other than the
Commercials tab gaining a deep-link into the new contract record.
