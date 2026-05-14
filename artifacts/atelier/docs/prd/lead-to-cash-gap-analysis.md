# Lead-to-Cash Gap Analysis & Roadmap

> **Scope.** Atelier is the AICo employee portal for a professional-services
> firm (consulting + delivery + advisory). This document audits the firm's
> end-to-end **Lead-to-Cash (L2C)** loop against what the portal ships
> today, anchors every gap to the v4 commercial-loop PRD that already
> specifies it, and sequences the un-built portion as four delivery waves.
>
> **Audience.** Founding partners, Finance, the v4/v5 working group, and
> any agent (human or LLM) implementing an L2C-related capability after
> Task #357.
>
> **Companion docs.**
> - `artifacts/atelier/docs/prd/v4-commercial-loop.md` — the v4 commercial-
>   loop PRD (the *spec* for everything in this gap analysis).
> - `artifacts/atelier/docs/v5-scale-and-trust.md` — the v5 Scale & Trust
>   track (orthogonal to L2C).
>
> **What this is *not*.** Not a build spec for any single capability —
> every gap section ends with the artifact you would author *next* (route,
> agent, schema migration, card renderer) so the implementing agent has a
> clear seam.
>
> **Authoritative file references.**
> All file paths in this document point at code in `main` as of Task #357.
> If a downstream task moves a file, the link must be updated in the same
> PR.

---

## A. Gap Analysis

### A.1 Reference L2C — the 13 stages, mapped to current code, v4 spec, v5 scope, and best practice

This is the single comparative table the rest of the document leans on.
Each row is one canonical L2C stage.

| # | Stage | Owning persona(s) | **Current Atelier coverage (file paths)** | **v4 PRD anchor** (`v4-commercial-loop.md`) | v5 delivered scope | Industry best practice |
|---|-------|---------|---|---|---|---|
| 1 | **Demand capture** | partner, senior_manager | `artifacts/atelier/src/pages/Crm.tsx`, `artifacts/api-server/src/routes/atelier/accountRoutes.ts` (`createAccount`, account list) | §6 — pre-existing (v3); v4 leaves CRM unchanged (Resolution 11). | n/a | Inbound + outbound triggers normalised to a single Account record with tier and partner-owner. |
| 2 | **Account qualification** | partner | `Crm.tsx` tier filter; `accountRoutes.ts` (`tier` field on account); whitespace tab in `Account.tsx` | §6 — pre-existing. | n/a | Tier × sector matrix; ICP scoring; whitespace map per Tier-A account. |
| 3 | **Opportunity creation & qualification** | partner, senior_manager | `artifacts/atelier/src/pages/Pipeline.tsx`, `artifacts/atelier/src/components/CreateOpportunityDialog.tsx`, `artifacts/atelier/src/components/QualifierSheet.tsx`, opportunity routes in api-server | §6 — pre-existing. | n/a | MEDDIC / SPICED-style rubric attached to every opportunity; named hypothesis. |
| 4 | **Pursuit** (POV, research, meetings) | partner, senior_manager, consultant | `artifacts/atelier/src/pages/Opportunity.tsx` tabs (Brief, Research, POV, Meetings); `artifacts/atelier/src/components/tabs/*` | §6 — pre-existing. | n/a | POV → CFO POV → exec sponsor pattern; meeting transcripts bound to opp. |
| 5 | **Proposal & pricing** | partner, senior_manager | `artifacts/atelier/src/components/tabs/ProposalTab.tsx`, `.../CommercialsTab.tsx`, `artifacts/api-server/src/routes/atelier/pricingRoutes.ts`, `proposalRoutes.ts` | §6 — pre-existing; v4 §6.A.2 (Contract Composer) builds *on top of* the proposal. | n/a | Templated SOW; clause reuse; commercial discount governance. |
| 6 | **Contracting / CLM** | partner (countersign) | Outcome only: opportunity moves to `salesStage=contract` via `StageTransitionDialog.tsx`. **No contract artifact, no clause library, no redline ledger.** | **§6.A** *The Codex (Contract Lifecycle)* — steps 1–6: `/codex` route, Counterparty registry, Contract Composer, Redline Analyst, E-Sign Orchestrator, Renewal Watchdog, DPA Sentinel. Two-Partner Countersign gate (Resolution 6). | n/a (v5 #354 persists adjacent Trust surfaces but not Codex). | Clause library + version chain; e-sign with countersign gate; per-engagement contract chain (which MSA governs which SOW). |
| 7 | **Engagement setup** | partner, senior_manager | `artifacts/atelier/src/pages/Engagement.tsx`, `artifacts/api-server/src/routes/atelier/engagementRoutes.ts`, `atelier_engagement_access` table for ACLs | §6.C extends this surface; engagement *creation* itself is pre-existing (v3). | n/a | Charter + RAID + access grants from day 1; partner sign-off on charter. |
| 8 | **Delivery & timekeeping** | senior_manager, consultant, contractor | `artifacts/atelier/src/pages/wallet/*`, `artifacts/api-server/src/routes/atelier/walletRoutes.ts`, `ledgerRoutes.ts` | §6 — pre-existing (Ledger v3, Wallet v3). | n/a | Daily time + expense capture; lead-approve → partner-approve. |
| 9 | **Change control** | partner | None. Scope changes are filed as RAID items in `engagementRoutes.ts` or as a charter-edit; no first-class change-order artifact. | **§6.A.1** mentions change order as an *instrument type* in the Codex; not separately built. | n/a | Per-engagement change-order register with $ delta, partner approval, client countersign. |
| 10 | **Revenue recognition** | finance | None. No deferred-revenue table, no POC %-complete, no period postings. | **§6.B step 11** *Revenue Recognizer agent* — milestone / T&M / outcome rules, month-end accruals. | n/a | ASC 606 method per engagement; period close locks postings. |
| 11 | **Invoicing & e-invoicing** | finance | None as a portal artifact. Invoices are produced in spreadsheets and lose link to the engagement. | **§6.B steps 7–9** — `/treasury` route, Wallet → Treasury invoice-line bridge, Invoice Builder agent (ZATCA Phase-2 KSA, FTA UAE, Xero handoff). | n/a | Jurisdiction-correct e-invoice; tax-authority clearance status on the document. |
| 12 | **Collections & cash application** | finance | None. AR aging is a quarterly hand-roll; cash is matched off-portal. | **§6.B step 7** AR aging + dunning queue; **step 10** Collections Concierge agent (polite → firm → escalation, partner sign-off); **step 12** Cash Flow Forecaster. | n/a | Live aging buckets; dunning ladder with promise-to-pay log; cash applied at receipt; daily bank rec. |
| 13 | **Renewal / expansion / churn** | partner, senior_manager | None. Renewals are reactive — no T-90d trigger, no NRR view. | **§6.A step 5** Renewal Watchdog (90/60/30-day expiry watcher); v4 §6.D (Pulse) feeds renewal risk. | n/a | T-90d auto-opened renewal opportunity; NRR + GRR tracked monthly; expansion themes harvested from QBR. |

**Reading the table.**

- The **v4 PRD anchor** column proves every gap below is a gap between
  v4-as-specified and v4-as-built; v4 already calls for the surface,
  agent, or data model. This document does **not** invent new product
  scope.
- The **v5 delivered scope** column is uniformly *n/a* because v5
  (Press / Alliances / Studio / Guardhouse / IP) is orthogonal to L2C.
  See §F.2 for the explicit non-overlap argument and §F.3 for the
  Task #354 / #355 boundary.
- The **best-practice** column is the bar a top-quartile services CFO
  expects; it is what the v4 PRD itself targets.

### A.2 Coverage today — the seam

The current portal covers stages **1 → 8** end-to-end and stage **9**
*informally* (RAID-as-change-order). **Stages 10–13 are entirely
outside the portal.** That seam — between stage 8 (Wallet timekeeping)
and stage 10 (revenue) — is where waves 1–4 plug in.

### A.3 The 12 gaps (with severity and v4-section anchors)

Severity uses three levels:

- **🔴 Blocking** — without this, no downstream gap can be honestly
  closed (data dependency).
- **🟠 High** — KPIs or a partner-level workflow are unreliable
  without it.
- **🟡 Medium** — manual workaround exists; portal automation is
  the value-add.

| ID | Gap | Stage | Severity | v4 anchor | One-paragraph rationale |
|----|-----|-------|----------|-----------|-------------------------|
| **G01** | **Codex / CLM (clause library + contract record)** | 6 | 🔴 Blocking | §6.A steps 1–4 (Codex data model, Contract Composer, Redline Analyst, E-Sign Orchestrator); Resolution 6 (Two-Partner Countersign gate) | Without a first-class contract record, every downstream wave has nothing to anchor to: revrec needs `contractValue` and a recognition method; invoicing needs the bill-to entity and tax jurisdiction; renewals need the term end-date. v4 spec'd the Codex first for exactly this reason; we mirror that ordering. |
| **G02** | **Change-order workflow** | 9 | 🟠 High | §6.A step 1 names change orders as a Codex instrument type | Scope creep is invisible to Finance until margin slips. v4 lists `change order` as an instrument under §6.A.1 but does not separately specify the workflow; this gap closes that with the same propose → partner-approve → client-countersign pattern as MSA/SOW. |
| **G03** | **ASC 606 revenue recognition** | 10 | 🔴 Blocking | §6.B step 11 (Revenue Recognizer agent) | Invoicing without revrec is just billing — it lies about earnings. v4 §6.B.11 explicitly calls for milestone / T&M / outcome rules with month-end accruals; this is also the floor for honest engagement margin (G12). |
| **G04** | **WIP / unbilled-revenue report** | 10 | 🟠 High | §6.B step 7 names "engagement P&L view" inside `/treasury` | The board number "what have we earned but not invoiced?" is unanswerable today. WIP is a downstream view of G03 — once revrec exists, WIP is a one-route compute. |
| **G05** | **Real invoicing (document, not a wallet line)** | 11 | 🔴 Blocking | §6.B steps 7–9 (Treasury, Wallet→Treasury bridge, Invoice Builder) | Cash, AR aging, and dunning all key off the invoice document. Without it the entire Wave 3 stack is unreachable. v4 §6.B.8 specifically calls out the Wallet → Treasury invoice-line bridge as "what v3 implied but never shipped". |
| **G06** | **E-invoicing compliance (ZATCA / FTA / Peppol)** | 11 | 🟠 High | §6.B step 9 (Invoice Builder, jurisdiction-correct) | KSA ZATCA Phase-2 is mandatory for the firm's KSA clients; UAE FTA e-invoicing is rolling out. Manual portal submission is a regulatory risk and prevents the invoice card from showing clearance status. |
| **G07** | **AR aging & DSO tracking** | 12 | 🟠 High | §6.B step 7 (AR aging by client / engagement / partner) | DSO is computed quarterly by hand; partners cannot see live aging on their accounts. Required for the dunning ladder (G08) and the cash forecast (G10). |
| **G08** | **Collections Concierge & dunning ladder** | 12 | 🟠 High | §6.B step 10 (Collections Concierge agent) | Reminder emails are ad-hoc; no escalation ladder; no promise-to-pay log; no partner sign-off gate before send. v4 §6.B.10 is unambiguous: polite → firm → escalation, partner-approved. |
| **G09** | **Inbound cash application & bank reconciliation** | 12 | 🟠 High | §6.B step 7 ("invoice register" implies cash application closes it) | Cash receipts arrive as bank statements; matching to invoice is manual; AR cannot be trusted until cash is applied and bank rec finalised. |
| **G10** | **Cash-flow forecast (13-week rolling)** | 12 | 🟡 Medium | §6.B step 12 (Cash Flow Forecaster, rolling 12-week) | Treasury cannot see when cash will land vs. payroll. v4 calls for 12-week rolling with sensitivity ranges; we land 13-week to align with treasury convention but the data model is identical. Input-evidence-bound to AR + AP + payroll snapshot per Resolution 10. |
| **G11** | **Renewals, NRR & expansion tracking** | 13 | 🟠 High | §6.A step 5 (Renewal Watchdog, 90/60/30-day) | Renewals are reactive. v4 specifies the 90/60/30-day watcher; we add the NRR view because that is the headline number a board asks for. |
| **G12** | **Leakage / realization & per-engagement margin variance** | 8, 10 | 🟠 High | §6.B step 7 ("engagement P&L view"); §6.C (Engagement Health signals) | Partners cannot see which engagements bleed. Realization (billed $ ÷ standard-rate × hours) and engagement margin (revenue − direct cost) require both timesheets (have) and revenue postings (G03). v4 §6.C lists "hours burn vs. plan" and "expense burn vs. plan" as health signals; this gap turns those into a finance number. |

### A.4 KPI appendix — definitions, computation status, surface location, blockers

| KPI | Definition | **Computation status today** | **Where it should surface** | Blocked by |
|-----|------------|------------------------------|----------------------------|-----------|
| **DSO** (Days Sales Outstanding) | (AR / Revenue) × days in period | **Missing** | `/wallet/treasury` KPI strip; Home shelf | G05, G07 |
| **CEI** (Collections Effectiveness Index) | Collected ÷ (Beginning AR + Credit Sales − Ending AR) | **Missing** | `/wallet/collections` header strip | G07, G08, G09 |
| **Realization rate** | Billed $ ÷ (Billable hours × standard rate) | **Missing** | Per-engagement Commercials tab; firm-level on `/wallet/wip` | G05, G12 |
| **Utilization** | Billable hours ÷ Capacity hours | **Computed** (Wallet + Roster) | Already on `/roster` and `/wallet`; reused as-is | — |
| **Engagement margin** | (Revenue − Direct cost) ÷ Revenue | **Partial** — direct cost (time + expense) computed; revenue side missing | Per-engagement Commercials tab | G03, G12 |
| **NRR** (Net Revenue Retention) | (Starting ARR + Expansion − Churn) ÷ Starting ARR | **Missing** | `/crm` Renewals filter header; Home shelf | G11 |
| **Unbilled WIP** | Earned but un-invoiced revenue at period end | **Missing** | `/wallet/wip` KPI strip; Home shelf | G03, G04, G05 |
| **Cash-conversion cycle** | DSO − DPO + DIO (services firms: DSO − DPO) | **Missing** | `/wallet/treasury` | G05, G07, G09, G10 |
| **Backlog** | Signed contract value − recognised revenue | **Partial** — signed-value not tracked as a number; revenue side missing | Per-engagement Commercials tab; Home shelf | G01, G03 |
| **Renewal rate** | Renewed contract value ÷ Contract value up for renewal | **Missing** | `/crm` Renewals filter header | G11 |
| **Win rate** | Won opportunities ÷ (Won + Lost) over a period, sliceable by sector / partner / band | **Partial** — Pipeline counts the bands but does not compute a win-rate; needs a Closed-Won vs Closed-Lost denominator | Pipeline header strip on `/opportunities`; firm-level on Home shelf | none (needs new compute over existing `atelier_opportunity` rows) |
| **Leakage rate** | (Standard-rate × billable hours − Billed $) ÷ (Standard-rate × billable hours), per engagement and rolled up by partner | **Missing** | `/wallet/wip` (firm) + per-engagement Commercials tab; ranked-list on Home shelf | G03, G05, G12 |

---

## B. UX & Information-Architecture Spec

### B.1 IA principle — *one top-nav addition (Codex), all finance under Wallet*

The current `Shell.tsx` top nav exposes the Commercial realm as a small
set of named entries (Accounts → `/crm`, Opportunities → `/opportunities`,
plus the Scale and IP realms). The L2C waves make exactly **one**
addition to the top nav — `/codex` joins the Commercial realm as a
sibling of `/crm` and `/opportunities`, because the contract artifact
is a first-class commercial object that pre-exists invoicing and is
referenced from both Opportunity (pre-sign) and Engagement (post-sign)
workspaces. Everything else is a sub-surface:

- **Codex placement.** `/codex` is the firm-wide clause + contract
  library; it is **also** mirrored as a Codex tab on
  `/opportunities/:id` (pre-sign drafting context) and on
  `/engagements/:id` (post-sign chain-of-instruments context). The
  same component renders all three; only the filter scope changes.
- **Change orders are inline.** Change-order propose / approve runs
  as a **modal launched from the Charter section** of the engagement
  workspace, not as a separate tab — scope is owned by the charter, so
  scope-change motion is co-located with it.
- **Reuse the Commercial realm for finance.** `/wallet` is the
  existing finance surface for the firm. New finance surfaces
  (Invoices, AR, Cash, RevRec, WIP, Treasury, Collections) are
  **secondary destinations** reached from a Wallet sub-nav, not from
  the top nav.
- **Treasury is not a persona realm.** It is a Wallet sub-section gated
  to `finance` + `founding_partner`. If a top-nav entry for Wallet is
  added (it currently is not), it may carry an aggregate "needs action"
  badge (overdue invoices + unmatched receipts), but the link target
  stays `/wallet`.
- **Home Workspace shelf is the cross-realm surface.** New tiles
  (Receivables, Cash forecast, Renewals at-risk) live there mirroring
  the existing Approvals / Ledger / Roster shelf cards.
- **Card-first principle.** Every CLI capability that produces a finance
  result must return a typed `resultCard` shape (B.2). The chrome
  surface is then a thin assembly of those cards, never a bespoke
  layout per page.

### B.2 New `ResultCard` shapes — fields and wireframe sketches

These extend the existing renderer set in
`artifacts/atelier/src/components/cli/ResultCardRenderers.tsx` (current
shapes: `kpi_strip`, `ranked_list`, `time_series`, `entity_card`,
`audit_timeline`, plus the per-entity cards added in Task #349). The
`ResultCard` union in
`artifacts/api-server/src/lib/atelier-cli/capability-catalog.ts` must
be extended in the same PR that ships the first capability that emits
each shape — the catalog hash check breaks the build otherwise. Per the
wave-1 plumbing note (E.5), all seven shapes are added to the union
up-front in Wave 1.

Each shape is specified below as **fields** + a **wireframe sketch**
(key visual elements, primary action, link target).

**`invoice_card`**

- Required: `invoiceId`, `invoiceNumber`, `customerName`,
  `engagementId`, `issueDate`, `dueDate`, `currency`, `subtotal`, `tax`,
  `total`, `status` ∈ {draft, issued, paid, void}, `lines[]`.
- Optional: `clearanceStatus`, `clearanceUuid`, `pdfUrl`.
- *Wireframe.* Two-column header (left: invoice number + customer +
  engagement chip; right: status pill + total in large gold). Body:
  line-items table (description, hours/qty, rate, amount). Footer:
  subtotal / tax / total stack + clearance chip if non-null.
  **Primary action:** *Issue* (draft state) → opens two-phase
  confirm; *Send reminder* (issued/overdue) → routes into G08
  dunning; *View PDF* (paid). **Link target:** `/wallet/invoices/:id`.

**`ar_aging_grid`**

- Required: `asOf`, `currency`, `rows[]` of `{customerId, customerName,
  current, d30, d60, d90, d120plus, total}`, `totals`.
- Optional: `dsoDays`, `top5DelinquentIds[]`.
- *Wireframe.* Top KPI ribbon: total AR + DSO days + #customers ≥30d
  past due. Sortable grid below with five aging buckets coloured
  green→red left-to-right; row click expands to the customer's invoice
  list. **Primary action:** *Chase* on each row → opens the
  `dunning_card` for that customer. **Link target:**
  `/wallet/ar?customer=:customerId`.

**`cash_forecast_strip`**

- Required: `startWeek`, `weeks[]` of `{weekStart, expectedIn,
  expectedOut, openingBalance, closingBalance}`.
- Optional: `confidenceLow[]`, `confidenceHigh[]` (a single confidence
  band rendered as a shaded ribbon behind the line).
- *Wireframe.* 13 vertical week-columns with a stacked bar (in / out)
  and a closing-balance line over the top. Confidence band shaded.
  Below the chart: "next cash gap" callout naming the first week the
  closing balance crosses zero (per v4 §6.B.12 "names the next cash
  gap"). **Primary action:** *Open Treasury workspace* (no inline
  write). **Link target:** `/wallet/treasury`.

**`dunning_card`**

- Required: `customerId`, `customerName`, `arTotal`,
  `oldestInvoiceAgeDays`, `ladderStep` ∈ {gentle, firm, escalation,
  legal}, `lastTouchAt`, `nextActionDueAt`, `promisesToPay[]`.
- Optional: `escalationOwnerName`, `holdShipments?`.
- *Wireframe.* Left rail: ladder visual (gentle → firm → escalation
  → legal) with current step highlighted. Centre: AR total + oldest
  invoice age + next-action countdown. Right rail: promise-to-pay log
  (most recent on top). **Primary action:** *Send next reminder* →
  two-phase confirm with email body diff (irreversible because it
  ships email). **Link target:** `/wallet/collections?customer=:customerId`.

**`revenue_schedule`**

- Required: `engagementId`, `engagementName`, `method` ∈ {POC, ratable,
  milestone}, `currency`, `periods[]` of `{periodStart,
  recognisedAmount, deferredEnding, basisPct}`.
- Optional: `contractValue`, `recognisedToDate`, `unbilledWip`.
- *Wireframe.* Header strip: contract value + recognised-to-date +
  unbilled WIP. Body: per-period table with a small inline bar visual
  for `basisPct` (POC %-complete or milestone %-complete).
  **Primary action:** *Post period* (finance only, two-phase confirm,
  irreversible). **Link target:** `/wallet/revrec/:engagementId`.

**`change_order_card`**

- Required: `changeOrderId`, `engagementId`, `summary`, `kind` ∈
  {scope, rate, term, team}, `oldValue`, `newValue`, `valueDeltaUsd`,
  `status` ∈ {draft, proposed, accepted, rejected}, `requestedByName`,
  `partnerApproverName`.
- Optional: `clientApproverName`, `clientApprovedAt`, `linkedRaidId`.
- *Wireframe.* Two-column diff card: old vs. new values side-by-side
  with the `valueDeltaUsd` rendered in either gold (positive) or
  amber (negative). Status pill top-right; approval trail below
  (request → partner approve → client countersign). **Primary
  action:** *Propose to client* (partner+) → two-phase confirm with
  email send (irreversible). **Link target:**
  `/engagements/:engagementId?tab=changes&co=:changeOrderId`.

**`renewal_card`**

- Required: `renewalId`, `engagementId`, `accountName`,
  `currentArrUsd`, `proposedArrUsd`, `nrrDeltaPct`, `renewalDueAt`,
  `riskTier` ∈ {green, amber, red}, `partnerOwnerName`.
- Optional: `lastQbrAt`, `csatScore`, `expansionThemes[]`.
- *Wireframe.* Header: account name + risk pill (green/amber/red) +
  countdown to renewal date. Centre: ARR ladder (current → proposed)
  with the `nrrDeltaPct` in large type. Footer: last QBR date +
  expansion themes as chips. **Primary action:** *Open renewal
  opportunity* (partner+) → routes to a fresh `/opportunities/:id`
  pre-filled with the renewal-source flag. **Link target:**
  `/accounts/:accountId?tab=renewals`.

### B.3 Existing-shape reuse map (so we don't introduce parallel renderers)

For every gap, this maps which **existing** card shape (already in the
union) is reused before any new shape is invented. Any new shape from
B.2 is justified by a need that *cannot* be met by the existing set.

| Gap | Existing shapes reused | New shape introduced (and why) |
|-----|------------------------|--------------------------------|
| G01 (Codex) | `ranked_list` (clause search), `entity_card` (clause + contract entity), `audit_timeline` (countersign trail), `email_sent` (e-sign dispatch) | none — Codex slots into existing renderers. |
| G02 (Change orders) | none of the existing diff-renderers are diff-aware | `change_order_card` — needed because no current shape renders an old/new value diff with a $ delta. |
| G03 (Revrec) | `kpi_strip` (period headline), `time_series` (recognition curve) | `revenue_schedule` — needed for the per-period basis-% column with inline bar; `time_series` alone loses the method/basis context. |
| G04 (WIP) | `kpi_strip` (firm WIP); `ranked_list` (engagement breakdown) | none — WIP is a chained `kpi_strip` + `ranked_list` via `followUpTriggers`. |
| G05 (Invoicing) | `entity_card` is too generic for a multi-line tax document | `invoice_card` — needed for line-items table + tax + clearance status fields. |
| G06 (E-invoicing) | reuses `invoice_card` (clearance fields) | none — e-invoice submission writes back into the same card. |
| G07 (AR aging) | `kpi_strip` (DSO) + `ranked_list` (top delinquents) cover the headline | `ar_aging_grid` — needed because aging requires a 5-bucket grid layout that `ranked_list` cannot express. |
| G08 (Dunning) | `audit_timeline` (touchpoint history), `email_sent` (each send) | `dunning_card` — needed for the ladder visual + promise-to-pay panel. |
| G09 (Cash app / bank rec) | reuses `invoice_card` (status flips), `audit_timeline` (rec history), `kpi_strip` (period summary) | none. |
| G10 (Cash forecast) | `time_series` (closing balance line) is close but loses the in/out stack | `cash_forecast_strip` — needed for stacked-bar + line + confidence band. |
| G11 (Renewals) | `opportunity_card` (the renewal *is* an opportunity), `kpi_strip` (NRR firm-level) | `renewal_card` — needed for ARR ladder + risk tier + expansion themes; opportunity_card alone loses the renewal-specific dimensions. |
| G12 (Leakage) | `ranked_list` (engagements ranked by variance), `kpi_strip` (firm realization) | none. |

### B.4 Where each new surface lives in the chrome

| New surface | Surface route | Reached via | Top-nav badge contribution |
|-------------|---------------|-------------|----------------------------|
| Codex (CLM clause library) | `/codex` (top-level under the Commercial realm — sibling of `/crm` and `/opportunities`) | Top-nav · Commercial · *Codex*; **also** surfaced as a *Codex* tab on `/opportunities/:id` and `/engagements/:id` so partners reach the contract artifact in-context without leaving the workspace | none |
| Change orders | Inline modal launched from the **Charter** section of `/engagements/:id` (the engagement charter is where scope is owned, so scope-change motion is co-located with it); list of historical change orders shows as a collapsible panel beneath the Charter | Engagement workspace · Charter section | engagement-card "Δ open" chip |
| Revenue recognition | `/wallet/revrec` | Wallet sub-nav · *Revenue* | none (period-close badge only) |
| WIP report | `/wallet/wip` | Wallet sub-nav · *Revenue* | none |
| Invoices | `/wallet/invoices` | Wallet sub-nav · *Receivables* | overdue count |
| AR aging | `/wallet/ar` | Wallet sub-nav · *Receivables* | overdue count |
| Cash forecast | `/wallet/treasury` | Wallet sub-nav · *Treasury* | none |
| Collections Concierge | `/wallet/collections` | Wallet sub-nav · *Receivables* | dunning queue count |
| Renewals dashboard | `/crm` → new **Renewals** filter + Home shelf tile | Account workspace + Home | red-tier renewal count |
| Leakage / margin | `/engagements/:id` → existing Commercials tab + Home shelf tile | Engagement + Home | none |

### B.5 Acceptance signals

Each new surface ships when:

1. The route renders the result-card shape via the CLI renderer (no
   bespoke layout outside the card).
2. The capability is reachable as a slash-command and as a
   representativePrompt suggestion chip from the relevant Surface.
3. A row exists in `artifacts/api-server/tests/cli-smoke/run.ts`
   exercising the read capability and (if write) the two-phase confirm
   path.

---

## C. Persona × Capability RBAC Matrix

### C.1 The persona model — one-line descriptions

**Reconciliation note (authoritative).** The original L2C task brief
references a 12-persona model. The codebase today
(`artifacts/api-server/src/routes/atelier/personaRoles.ts`,
`ATELIER_PERSONA_ROLES`) enumerates **11 roles** — the missing 12th
slot from the brief was an early-design `client_user` (external client
contact persona) that was deferred to v6 along with the public Salon
client portal and is **not** in scope for any L2C wave. All RBAC, RLS,
and capability decisions in this document target the 11 roles in
`personaRoles.ts`; if a future task lands `client_user`, it must be
re-checked against C.2/C.3 (read-only on its own engagement's invoices
/ statements only; never firm-wide).

| Role | One-line description | L2C posture |
|------|----------------------|-------------|
| `founding_partner` | Apex partner; bypasses per-engagement ACLs; final approver. | All approvals; no daily writes (delegates to finance). |
| `partner` | Account-owning partner; signs contracts; co-approves dunning + change orders. | Initiates Codex/CO writes; approves dunning sends. |
| `finance` | Treasury operator (invoicing, cash, bank rec, ZATCA/FTA). | Sole initiator of treasury writes; co-approver. |
| `hr` | People-ops; owns Roster, comp visibility, personnel contracts. | **Denied across L2C** (out of scope for HR). |
| `senior_manager` | Engagement leader; runs the day-to-day on their engagements. | Read-only on their own engagements/accounts; can propose change orders + open renewals. |
| `consultant` | Delivery staff. | Read-only Codex (for reuse); no finance access. |
| `contractor` | External delivery; restricted to explicit engagement grants. | **Denied across L2C** (RESTRICTED set). |
| `partner_firm_resource` | Co-delivery partner-firm staff; restricted by engagement grants. | **Denied across L2C** (RESTRICTED set). |
| `board_observer` | External board read-only realm gate. | **Today: hard-filtered to meta+raid only.** Target post-Wave 2: read-only on **rollups only** — `wip_report`, `revrec_compute_schedule`, `ar_aging_report`, `cash_forecast_13w`, `leakage_report`. **Never** granted read on individual invoices, cash receipts, or per-customer dunning cards. |
| `recruiter` | v5 Studio persona (candidates, panels, offers). | **Denied across L2C** (RESTRICTED set). |
| `compliance_officer` | v5 Guardhouse persona; firm-wide read for audit. | Read-only across all L2C reporting; no writes; no email side-effects. |

The **RESTRICTED set** is `contractor`, `partner_firm_resource`,
`recruiter` — narrowed to their explicit `atelier_engagement_access`
grants.

### C.2 RBAC matrix

Legend: **W**=write, **R**=read, **A**=approve (two-phase confirm),
**·**=denied.

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
| **G09** Cash receipt — apply | A | A | W | · | · | · | · | · |
| **G09** Bank reconciliation — finalise | A | A | A | · | · | · | · | · |
| **G10** Cash forecast — read | R | R | R | · | · | · | R | R |
| **G11** Renewal — open opportunity | W | W | · | · | W | · | · | · |
| **G11** Renewal — close-lost | A | A | · | · | · | · | · | · |
| **G12** Leakage / margin — read | R | R | R | · | R (own engs) | · | R | R |

### C.3 RLS implications — table-by-table policy map

L2C tables fall into two scope buckets. Restricted personas are denied
on all of them; the difference is whether a non-restricted persona is
firm-wide or engagement-scoped.

| New table | Scope | RLS predicate (intent) | Notes |
|-----------|-------|------------------------|-------|
| `atelier_contract` | **engagement-scoped** | `engagement_id IN (atelier_engagement_access for current_user) OR isLeadership(current_user)` | Restricted denied; senior_manager sees only own engagements. |
| `atelier_contract_clause` | **firm-wide read** | non-restricted personas read; only finance + leadership write | Clause library is reused across engagements. |
| `atelier_change_order` | **engagement-scoped** | as `atelier_contract` | Same scope as the contract it amends. |
| `atelier_revenue_schedule` | **engagement-scoped** | as `atelier_contract`; **also visible to compliance_officer firm-wide** | Compliance audits revenue postings. |
| `atelier_revenue_period_posting` | **firm-wide read for finance + leadership + compliance**, engagement-scoped for senior_manager | Period postings are immutable once written. |
| `atelier_unbilled_wip_snapshot` | **firm-wide read for finance + leadership + compliance**, engagement-scoped for senior_manager | Snapshots are point-in-time. |
| `atelier_invoice` / `atelier_invoice_line` | **firm-wide read for finance + leadership + compliance**, engagement-scoped for senior_manager | Restricted personas always denied. **`board_observer` denied on individual invoice rows** — observers see only the AR aging rollup grid (`atelier_ar_aging_view`) and KPI strips, never the line-level invoice document. |
| `atelier_einvoice_submission` | **finance + leadership + compliance only** | Tax-authority submissions are finance-only. |
| `atelier_dunning_event` | **firm-wide read for finance + leadership + compliance**, partner-only writes (with finance) | Email side-effect — also gated on `outboundChannel: "email"` policy. |
| `atelier_cash_receipt` / `atelier_bank_recon_period` | **finance + leadership + compliance only** | Treasury writes; senior_manager has no read. |
| `atelier_renewal` | **engagement-scoped** | as `atelier_contract` | Visible to senior_manager on their accounts. |

Two non-RLS controls also bind:

- **`outboundChannel: "email"` policy.** Per the integration contract
  in §D, **only the dunning send capability** (`dunning_send_reminder`)
  carries `outboundChannel: "email"`. All other
  L2C writes route through purpose-built adapters (e-sign for contract
  / change-order countersign; Xero / portal handoff for invoice
  delivery; tax-authority API for ZATCA/FTA) and therefore set
  `outboundChannel: null`. Any email-channel capability is
  `irreversible: true`. Restricted personas (contractor /
  partner_firm_resource / recruiter) are blocked from every
  email-channel capability by an additional catalog-level check that
  must be added in Wave 1 (the current default gate only excludes
  `board_observer`).
- **`compliance_officer` firm-wide read** is granted by **not** adding
  it to engagement-scoped predicates' deny list — it is the inverse of
  the restricted-set rule.

---

## D. CLI / Agent Integration Spec — per gap

Each gap registers one or more capabilities via `defineCapability` /
`defineRouteCapability` in
`artifacts/api-server/src/lib/atelier-cli/capability-catalog.ts`,
colocated with its route handler. **Every** capability below ships with:

- 2–3 representative prompts (EN minimum; AR/FR encouraged) — the
  catalog `representativePrompts` field surfaces these in the slash-
  palette.
- A regression-fixture line in
  `artifacts/api-server/tests/cli-smoke/run.ts` (named at the bottom
  of each gap block).
- An explicit `requiredRoles` (matrix in C.2), `twoPhaseConfirm`,
  `outboundChannel`, `irreversible`, `resultCard`, and `surfaceOn`.

Shorthands: `2PC` = `twoPhaseConfirm: true`, `irrev` =
`irreversible: true`, `email` = `outboundChannel: "email"`.

### D.0 Existing-agents-extended vs net-new agents

Per v4 Resolution 1–2 (extend before duplicate), the integration spec
maps each gap to either an existing agent (extended) or a net-new
agent. The agent registry lives under `artifacts/api-server/prompts/`
and is loaded via the v5 agent-loader (Task #355).

| Gap | Existing agent extended | Net-new agent | Notes |
|-----|------------------------|---------------|-------|
| G01 | — | **Contract Composer**, **Redline Analyst**, **E-Sign Orchestrator**, **Renewal Watchdog**, **DPA Sentinel** (all named in v4 §6.A) | All five are net-new and pre-specified in v4. |
| G02 | — | (folded into Contract Composer) | Change-order is one of the instrument modes Contract Composer drafts. |
| G03 | — | **Revenue Recognizer** (v4 §6.B.11) | Net-new. |
| G04 | (no agent — pure SQL view) | — | WIP is deterministic over revrec output. |
| G05 | — | **Invoice Builder** (v4 §6.B.9) | Net-new; jurisdiction-correct e-invoice generation. |
| G06 | (folded into Invoice Builder) | — | Submission adapter, not a separate agent. |
| G07 | (no agent — pure SQL view) | — | AR aging is deterministic over invoice + cash tables. |
| G08 | — | **Collections Concierge** (v4 §6.B.10) | Net-new; drafts the dunning ladder copy. |
| G09 | — | **Cash Application Matcher** | Net-new — bank-statement to invoice fuzzy match; not pre-named in v4 but implied by §6.B.7. |
| G10 | — | **Cash Flow Forecaster** (v4 §6.B.12) | Net-new; input-evidence-bound to AR + AP + payroll snapshot per Resolution 10. |
| G11 | **Win/Loss Interviewer (Reference mode)** + **Account Cartographer** | (orchestrated by Renewal Watchdog from G01) | Reference mode already specified in v4 §6.D.21 — feeds NRR/expansion signal into G11. |
| G12 | **Burn Sentinel + RAID Watchdog** (the v4 Health Sentinel base) | — | Leakage is a finance-side projection of the same per-engagement signals; Resolution 1 says extend, do not duplicate. |

### G01 — CLM / Codex

```text
toolName: codex_search_clauses
slashAliases.en: ["/codex","/clauses","/clause-search"]
representativePrompts.en:
  - "Find termination-for-convenience clauses we used in MENA SOWs."
  - "Show indemnity caps from contracts signed in the last 12 months."
  - "Pull every limitation-of-liability clause cited by a Tier-A client."
representativePrompts.ar:
  - "ابحث عن بنود إنهاء العقد التي استخدمناها في عقود الشرق الأوسط."
resultCard: ranked_list
isWrite: false ; 2PC: false ; outboundChannel: null
requiredRoles: (default — everyone except board_observer + restricted set)
surfaceOn: ["wallet","opportunity_workspace","global"]

toolName: codex_publish_clause
slashAliases.en: ["/clause-publish"]
representativePrompts.en:
  - "Publish the new ZATCA-compliant invoicing clause to the firm library."
  - "Mark this NDA template as the firm-wide default."
  - "Retire the 2023 indemnity cap and publish the replacement."
resultCard: entity_card
isWrite: true ; 2PC ; irrev (publishes firm-wide)
requiredRoles: ["founding_partner","partner","finance"]

toolName: contract_countersign
representativePrompts.en:
  - "Countersign the ACME MSA — second partner is Layla."
  - "Apply my partner countersign to the SOW for Engagement E-1042."
  - "Counter-sign the Tabellio envelope I just received from BankCo."
resultCard: entity_card
isWrite: true ; 2PC ; irrev ; outboundChannel: null   (e-sign envelope dispatch is a server-to-DocuSign/Tabellio API call, not an email channel)
requiredRoles: ["founding_partner","partner"]
```

Smoke fixtures (`tests/cli-smoke/run.ts`):
`codex.search_clauses.read`, `codex.publish_clause.dryrun`,
`contract.countersign.dryrun`.

### G02 — Change orders

```text
toolName: change_order_propose
slashAliases.en: ["/change-order","/co","/scope-change"]
representativePrompts.en:
  - "Propose a +20% scope change on Engagement E-1042 with rationale."
  - "Add a rate-card change for the data team starting next month."
  - "Draft a term extension to Q3 for the BankCo retainer."
resultCard: change_order_card
isWrite: true ; 2PC ; outboundChannel: null
requiredRoles: ["founding_partner","partner","senior_manager"]
surfaceOn: ["engagement_dashboard"]

toolName: change_order_approve
representativePrompts.en:
  - "Approve change order CO-024 and send it to the client for countersign."
  - "Reject CO-019 with a note: client scope reduction not supportable."
  - "Approve all pending change orders on E-1042."
resultCard: change_order_card
isWrite: true ; 2PC ; irrev ; outboundChannel: null   (client countersign routes through the e-sign adapter, not direct email)
requiredRoles: ["founding_partner","partner"]
```

Smoke fixtures: `change_order.propose.dryrun`,
`change_order.approve.dryrun`.

### G03 — Revenue recognition

```text
toolName: revrec_compute_schedule
representativePrompts.en:
  - "Compute the POC revenue schedule for Engagement E-1042 using current burn."
  - "Show the milestone schedule for the BankCo fixed-fee SOW."
  - "Project T&M revenue for the next 6 periods on E-1042."
resultCard: revenue_schedule
isWrite: false  (deterministic compute)
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]

toolName: revrec_post_period
slashAliases.en: ["/post-revenue","/revrec"]
representativePrompts.en:
  - "Post October revenue for all engagements with a frozen schedule."
  - "Post the Q3 revenue close for the consulting practice."
  - "Lock the revenue posting for E-1042 for September."
resultCard: revenue_schedule
isWrite: true ; 2PC ; irrev (immutable period posting)
requiredRoles: ["founding_partner","finance"]
surfaceOn: ["wallet"]
```

Smoke fixtures: `revrec.compute_schedule.read`,
`revrec.post_period.dryrun`.

### G04 — WIP report

```text
toolName: wip_report
slashAliases.en: ["/wip","/unbilled"]
representativePrompts.en:
  - "Show me unbilled WIP across all engagements as of today."
  - "Which engagements have the highest unbilled WIP this quarter?"
  - "Break down WIP by responsible partner."
resultCard: kpi_strip
followUpTriggers: ["wip_report_by_engagement"]   (chains a ranked_list)
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
```

Smoke fixture: `wip.report.read`.

### G05 — Invoicing

```text
toolName: invoice_draft
representativePrompts.en:
  - "Draft an invoice for E-1042 covering October time and expenses."
  - "Draft this month's invoice for every active T&M engagement."
  - "Draft a milestone invoice for BankCo Phase-2 sign-off."
resultCard: invoice_card
isWrite: true ; 2PC
requiredRoles: ["finance"]

toolName: invoice_issue
representativePrompts.en:
  - "Issue invoice INV-2410 — partner co-approver is Hadi."
  - "Issue all draft invoices for the BankCo account."
  - "Issue this draft and send the PDF to the AP contact."
resultCard: invoice_card
isWrite: true ; 2PC ; irrev ; outboundChannel: null   (PDF delivery is a Xero/portal handoff, not an email channel; per-customer reminders go through G08 dunning)
requiredRoles: ["founding_partner","partner","finance"]

toolName: invoice_void
representativePrompts.en:
  - "Void invoice INV-2410 — wrong VAT rate."
  - "Void INV-2389 and re-issue with the corrected currency."
  - "Void the duplicate invoice INV-2401 issued this morning."
resultCard: invoice_card
isWrite: true ; 2PC ; irrev
requiredRoles: ["founding_partner","finance"]
```

Smoke fixtures: `invoice.draft.dryrun`, `invoice.issue.dryrun`,
`invoice.void.dryrun`.

### G06 — E-invoicing (ZATCA / FTA / Peppol)

```text
toolName: einvoice_submit
slashAliases.en: ["/einvoice","/zatca","/fta-submit"]
representativePrompts.en:
  - "Submit invoice INV-2410 to ZATCA."
  - "Submit all UAE invoices issued this week to the FTA portal."
  - "Re-submit INV-2389 to ZATCA after fixing the buyer VRN."
resultCard: invoice_card  (clearanceStatus populated)
isWrite: true ; 2PC ; irrev ; outboundChannel: null  (server-to-server)
requiredRoles: ["finance"]
```

Smoke fixture: `einvoice.submit.dryrun`.

### G07 — AR aging

```text
toolName: ar_aging_report
slashAliases.en: ["/ar","/aging"]
representativePrompts.en:
  - "Show me AR aging by customer as of today."
  - "Which Tier-A accounts are over 60 days past due?"
  - "What is our DSO for the consulting practice this quarter?"
resultCard: ar_aging_grid
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
surfaceOn: ["wallet","home"]
```

Smoke fixture: `ar.aging_report.read`.

### G08 — Collections Concierge

```text
toolName: dunning_next_action
representativePrompts.en:
  - "What is the next dunning action for ACME?"
  - "Suggest a dunning move for everyone over 90 days."
  - "What ladder step is BankCo on for INV-2389?"
resultCard: dunning_card
isWrite: false

toolName: dunning_send_reminder
slashAliases.en: ["/chase","/dunning"]
representativePrompts.en:
  - "Send the second-reminder dunning to ACME on invoice INV-2310."
  - "Escalate the BankCo collection to legal-tone with my partner sign-off."
  - "Send the polite first reminder to all customers 7 days past due."
resultCard: dunning_card
isWrite: true ; 2PC ; irrev ; outboundChannel: "email"
requiredRoles: ["partner","finance"]

toolName: dunning_log_promise_to_pay
representativePrompts.en:
  - "Log a promise from ACME to pay INV-2310 by end of next week."
  - "Note the BankCo CFO promise for $40k by Oct 30."
  - "Log a partial-pay commitment for 50% on INV-2401 next Monday."
isWrite: true ; 2PC: false  (low-stakes log)
requiredRoles: ["partner","finance","senior_manager"]
```

Smoke fixtures: `dunning.next_action.read`,
`dunning.send_reminder.dryrun`, `dunning.log_promise.dryrun`.

### G09 — Cash application & bank rec

```text
toolName: cash_apply
representativePrompts.en:
  - "Apply the $48k receipt from BankCo to invoice INV-2389."
  - "Apply this week's bank receipts to their matching invoices automatically."
  - "Apply the partial $20k to INV-2310 and leave the remainder open."
resultCard: invoice_card  (status flips to paid)
isWrite: true ; 2PC ; irrev
requiredRoles: ["finance"]   (drafts the application)
approverRoles: ["founding_partner","partner"]   (partner+ co-approves the irreversible posting per the Treasury control model — same pattern as invoice_issue)

toolName: bank_recon_finalise
representativePrompts.en:
  - "Finalise the September bank reconciliation."
  - "Close the Q3 bank rec for the DIFC account."
  - "Lock October bank rec — all variances cleared."
resultCard: kpi_strip
isWrite: true ; 2PC ; irrev
requiredRoles: ["finance"]
approverRoles: ["founding_partner","partner"]   (partner+ co-approves the period close)
```

Smoke fixtures: `cash.apply.dryrun`, `bank.recon_finalise.dryrun`.

**Treasury control model (applies to G05 invoice_issue, G05 invoice_void,
G08 dunning_send_reminder, G09 cash_apply, G09 bank_recon_finalise).**
Every irreversible Treasury write is two-phase with the *initiator* in
the `requiredRoles` set (typically `finance`) and an *approver* in the
`approverRoles` set (always partner+ — `founding_partner` or `partner`).
The catalog already supports this two-list pattern via the
`twoPhaseConfirm` mechanism; the additional `approverRoles` field is
new in Wave 3 (added to the `defineCapability` schema in the same PR
that ships `invoice_issue`).

### G10 — Cash-flow forecast

```text
toolName: cash_forecast_13w
slashAliases.en: ["/cash","/forecast-cash","/treasury"]
representativePrompts.en:
  - "Show me the 13-week cash forecast."
  - "When is our next cash gap?"
  - "What does the cash forecast look like if BankCo pays late?"
resultCard: cash_forecast_strip
isWrite: false
requiredRoles: ["founding_partner","partner","finance","compliance_officer","board_observer"]
surfaceOn: ["wallet","home"]
```

Smoke fixture: `cash.forecast_13w.read`.

### G11 — Renewals & NRR

```text
toolName: renewal_open_opportunity
representativePrompts.en:
  - "Open a renewal opportunity for ACME's annual retainer due in Q2."
  - "Open renewals for every account whose contract ends in the next 90 days."
  - "Open a renewal opp for BankCo with a 15% expansion target."
resultCard: renewal_card
isWrite: true ; 2PC
requiredRoles: ["founding_partner","partner","senior_manager"]
surfaceOn: ["account_workspace","home"]

toolName: renewal_close_lost
representativePrompts.en:
  - "Close the ACME renewal as lost — reason: budget freeze."
  - "Mark the BankCo renewal lost-to-competitor with note."
  - "Close-lost the FoodCo renewal — they are insourcing."
isWrite: true ; 2PC ; irrev
requiredRoles: ["founding_partner","partner"]
```

Smoke fixtures: `renewal.open_opportunity.dryrun`,
`renewal.close_lost.dryrun`.

### G12 — Leakage / realization

```text
toolName: leakage_report
slashAliases.en: ["/leakage","/realization","/margin"]
representativePrompts.en:
  - "Which engagements had >10% realization slip last quarter?"
  - "Show me firm-wide realization by partner."
  - "Rank my engagements by margin variance vs. plan."
resultCard: ranked_list
isWrite: false
requiredRoles: ["founding_partner","partner","finance","senior_manager","compliance_officer","board_observer"]
surfaceOn: ["engagement_dashboard","home"]
```

Smoke fixture: `leakage.report.read`.

---

## E. Sequenced Roadmap — four delivery waves

The waves are ordered so each wave unlocks the dependencies of the next.
You cannot ship invoicing before Codex (you need a contract artifact to
invoice against); you cannot ship AR before invoicing; you cannot ship
cash forecast before AR. Each wave is a single deployable slice — the
portal stays consistent at the end of every wave.

Each wave below specifies: **gaps closed**, **new schema**, **new
routes**, **new capabilities**, **new card shapes**, **new agents**
(per D.0), and **RBAC additions** (which `requiredRoles` rows in C.2
are net-new for that wave).

### Wave 1 — **Codex + Change Orders** (foundations of the contract record)

- **Gaps:** G01, G02.
- **New schema:** `atelier_contract`, `atelier_contract_clause`,
  `atelier_change_order` + link tables to engagement / opportunity.
- **New routes:** `routes/atelier/codex/*`,
  `routes/atelier/change-orders/*`.
- **New capabilities:** `codex_search_clauses`, `codex_publish_clause`,
  `contract_countersign`, `change_order_propose`, `change_order_approve`.
- **New card shapes added to the union:** `change_order_card` (clauses
  reuse `entity_card` + `ranked_list`).
- **New agents:** Contract Composer, Redline Analyst, E-Sign
  Orchestrator (DocuSign + Tabellio adapters), Renewal Watchdog (the
  *agent itself* ships in Wave 1; the renewal-opportunity *capability*
  ships in Wave 4 to avoid stranded UX), DPA Sentinel.
- **RBAC additions:** Codex publish writers (founding_partner / partner
  / finance); contract countersigners (founding_partner / partner);
  change-order proposers (founding_partner / partner / senior_manager)
  and approvers (founding_partner / partner). **Catalog change:**
  add a restricted-set deny gate to `capabilitiesForPersona()` so
  contractor / partner_firm_resource / recruiter cannot reach any
  `outboundChannel: "email"` capability even if the table predicate
  passes.
- **Acceptance:** every `salesStage=contract` opportunity carries a
  Codex contract row; every engagement can host change orders; the v4
  Commercials tab can deep-link to the contract.
- **Out of scope:** signing UX (still e-mail PDF in this wave).

### Wave 2 — **Revenue Recognition + WIP + Leakage** (the earnings ledger)

- **Gaps:** G03, G04, G12.
- **New schema:** `atelier_revenue_schedule`,
  `atelier_revenue_period_posting`, `atelier_unbilled_wip_snapshot`.
- **New routes:** `routes/atelier/revrec/*`, `routes/atelier/wip/*`.
- **New capabilities:** `revrec_compute_schedule`, `revrec_post_period`,
  `wip_report`, `leakage_report`.
- **New card shapes:** `revenue_schedule` (WIP + leakage reuse
  existing).
- **New agents:** Revenue Recognizer (net-new). Leakage extends Burn
  Sentinel + RAID Watchdog rather than introducing a parallel agent
  (per v4 Resolution 1).
- **RBAC additions:** revrec readers (all non-restricted, including
  `compliance_officer` firm-wide and `board_observer` on rollups only
  after the filter relax noted below); period-post approvers
  (founding_partner + finance). **Catalog change:** relax
  `capabilitiesForPersona()` so `board_observer` is also allowed an
  **explicit allow-list** of rollup capabilities (`wip_report`,
  `revrec_compute_schedule`, `ar_aging_report`, `cash_forecast_13w`,
  `leakage_report`). The relax must be allow-list, **not** module-wide,
  so that individual invoice / receipt / dunning-card capabilities
  remain denied to board observers.
- **Depends on Wave 1** (contract value lives on the contract record).
- **Acceptance:** period-close runs a deterministic POC schedule per
  engagement; finance can post a period; `leakage_report` returns one
  row per engagement with realised vs. billable rate variance.

### Wave 3 — **Invoicing + AR + e-invoicing + Collections** (the receivables stack)

- **Gaps:** G05, G06, G07, G08.
- **New schema:** `atelier_invoice`, `atelier_invoice_line`,
  `atelier_dunning_event`, `atelier_einvoice_submission`.
- **New routes:** `routes/atelier/invoices/*`,
  `routes/atelier/ar/*`, `routes/atelier/dunning/*`,
  `routes/atelier/einvoice/*`.
- **New capabilities:** `invoice_draft`, `invoice_issue`,
  `invoice_void`, `einvoice_submit`, `ar_aging_report`,
  `dunning_next_action`, `dunning_send_reminder`,
  `dunning_log_promise_to_pay`.
- **New card shapes:** `invoice_card`, `ar_aging_grid`, `dunning_card`.
- **New agents:** Invoice Builder (with embedded ZATCA / FTA
  jurisdiction adapters; Xero handoff per v4 §5.2), Collections
  Concierge.
- **RBAC additions:** invoice draft/issue/void writers and approvers;
  ZATCA/FTA submitters (finance only); dunning send approvers (partner
  + finance, two-phase, email-channel).
- **Depends on Wave 2** (invoice draws from revenue schedule + WIP)
  and **Wave 1** (invoice references a contract).
- **Acceptance:** finance user can draft → partner-issue an invoice;
  ZATCA/FTA clearance status reflected on the card; AR aging shows
  the issued invoice; dunning ladder advances with each send.

### Wave 4 — **Cash, Bank Rec & Renewals** (closing the loop)

- **Gaps:** G09, G10, G11.
- **New schema:** `atelier_cash_receipt`,
  `atelier_bank_recon_period`, `atelier_renewal` (+ link from
  `atelier_engagement`).
- **New routes:** `routes/atelier/cash/*`,
  `routes/atelier/treasury/*`, `routes/atelier/renewals/*`.
- **New capabilities:** `cash_apply`, `bank_recon_finalise`,
  `cash_forecast_13w`, `renewal_open_opportunity`,
  `renewal_close_lost`.
- **New card shapes:** `cash_forecast_strip`, `renewal_card`.
- **New agents:** Cash Application Matcher (net-new — bank-statement
  to invoice fuzzy match), Cash Flow Forecaster (input-evidence-bound
  per v4 Resolution 10). Renewal motion is orchestrated by the Renewal
  Watchdog already shipped in Wave 1 + the Win/Loss Interviewer
  (Reference mode) per v4 §6.D.21.
- **RBAC additions:** cash-apply writers (finance); bank-rec finalise
  approvers (founding_partner + finance); renewal opportunity
  proposers (founding_partner / partner / senior_manager) and
  close-lost approvers (founding_partner + partner).
- **Depends on Wave 3** (cash applies to an invoice).
- **Acceptance:** receipt → cash-apply flips invoice to paid; bank rec
  finalises a period; the Treasury page shows a 13-week strip; the
  renewal motion auto-opens a `renewal_card` at T-90d and contributes
  to NRR.

### E.5 Cross-wave plumbing (do once, in Wave 1)

- Extend the `ResultCard` union with **all seven new shapes up-front**
  so the catalog hash check is monotonic across the four waves.
- Add the **single** new top-nav entry — `/codex` — to the Commercial
  realm in `Shell.tsx`, sibling of `/crm` and `/opportunities`.
- Add a `/wallet` sub-nav component in `Shell.tsx` for all other new
  finance surfaces (RevRec, WIP, Invoices, AR, Treasury, Collections).
  Sub-nav slots are gated by the RBAC matrix in C.
- Add `finance` and `compliance_officer` to the Home Workspace shelf
  query so they receive the Receivables / Treasury / Margin tiles as
  their persona unlocks.
- Add the **restricted-set deny gate** to `capabilitiesForPersona()`
  so contractor / partner_firm_resource / recruiter cannot reach any
  capability with `outboundChannel: "email"` regardless of
  `requiredRoles`.

---

## F. Cross-references

### F.1 Per-gap mapping back to the v4 PRD

This is the single audit table that proves every gap below is anchored
in v4 spec, not invented here. Section numbers refer to
`artifacts/atelier/docs/prd/v4-commercial-loop.md`.

| Gap | v4 section(s) | v4 step(s) | v4 status | This document's contribution |
|-----|---------------|-----------|-----------|----------------------------|
| G01 | §6.A | 1, 2, 3, 4 | Specified, not built | Adds CLI capability surface + RBAC matrix + card shape |
| G02 | §6.A | 1 (instrument type only) | Specified as a type, not as a workflow | Adds the propose/approve workflow + `change_order_card` |
| G03 | §6.B | 11 | Specified, not built | Adds CLI capability + `revenue_schedule` card |
| G04 | §6.B | 7 (engagement P&L view) | Implied, not built | Adds explicit WIP report capability |
| G05 | §6.B | 7, 8, 9 | Specified, not built | Adds CLI capability + `invoice_card` |
| G06 | §6.B | 9 | Specified, not built | Adds the e-invoicing submit capability + clearance fields |
| G07 | §6.B | 7 | Specified as a sub-view of `/treasury`, not built | Promotes to a first-class capability + `ar_aging_grid` |
| G08 | §6.B | 10 | Specified, not built | Adds three-capability surface (next-action / send / log promise) |
| G09 | §6.B | 7 (invoice register implies cash app) | Implied, not built | Adds explicit cash-apply + bank-rec capabilities |
| G10 | §6.B | 12 | Specified, not built | 13-week landing (vs v4's 12-week) per treasury convention; same data model |
| G11 | §6.A + §6.D | 5 (Renewal Watchdog) + 21 (Reference mode) | Specified, not built | Adds NRR view + `renewal_card` |
| G12 | §6.B + §6.C | 7 (engagement P&L) + 14 (health signals) | Specified, not built | Promotes leakage to a finance-side capability |

### F.2 Orthogonal to v5

The v5 Scale & Trust track (`docs/v5-scale-and-trust.md`) is
**orthogonal** to L2C. v5 introduces:

- **Press, Alliances, Studio, Guardhouse, IP** — all firm-of-the-firm
  surfaces that produce demand or de-risk operations, but none of
  which participate in invoicing or cash.
- Two new personas — `recruiter` (Studio-only) and
  `compliance_officer` (Guardhouse + firm-wide audit read).

L2C touch-points with v5 are limited to:

- The `compliance_officer` persona is granted firm-wide **read** on
  L2C surfaces (G03 / G04 / G07 / G10 / G12) so audit evidence is
  collectable from the same portal. **No** writes; **no** email
  side-effects on L2C.
- The `recruiter` persona stays in the RESTRICTED set across L2C —
  no invoices, AR, cash, or renewals.
- Two v5 agents are demand-adjacent and may eventually fire renewal
  signals into G11: `offer_composer` (proposal-side) and
  `alliance_choreographer` (partner co-sell). The integration seam
  is a future `renewal_signal_ingest` capability — explicitly **out
  of scope** for waves 1–4.

### F.3 Non-overlap with in-flight tasks #354 / #355

Two v5 tasks are currently in MERGING:

- **Task #354** — *Persist Press, Alliances, Studio, Guardhouse, and
  IP catalog data in the database.* This task adds **net-new tables
  in the v5 surfaces**. The L2C waves below add **net-new tables in
  the wallet/finance surface** (`atelier_contract`,
  `atelier_invoice`, `atelier_revenue_schedule`, etc.). **No table
  is shared.** No migration in any L2C wave alters a v5-surface
  table. The only shared mechanism is the global RLS-helper module
  in `routes/atelier/rls.ts`, and the L2C waves only *read* its
  helpers (for `current_user`, restricted-set membership, etc.).
- **Task #355** — *Wire the 15 new v5 agents to the runner.* This
  task wires **v5 agents** (Press / Alliances / Studio / Guardhouse
  / IP). The L2C waves register **separate, finance-side agents**
  (Contract Composer, Revenue Recognizer, Invoice Builder, etc.).
  The two sets are disjoint in `artifacts/api-server/prompts/`. The
  shared mechanism is the agent-loader contract itself; L2C waves
  treat that contract as immutable upstream. If #355 changes the
  loader signature, L2C waves rebase against the new signature; no
  L2C wave should change the loader.

There are also two **proposed** tasks in the queue (#358 — let
editors update v5 records from the portal; #359 — recruiter access
test on /studio). Neither touches L2C.

### F.4 Where to start

The next implementing task agent should pick up **Wave 1 (G01 + G02)**
as a single project task. The seam is clean (new schema + new routes
+ five capabilities + one new card shape + one new Engagement tab);
no v4 surface needs to change other than the Commercials tab gaining
a deep-link into the new contract record. Follow-up tasks #360
(Wave 1) and #361 (Wave 2) have been proposed against this document
to seed that sequencing.
