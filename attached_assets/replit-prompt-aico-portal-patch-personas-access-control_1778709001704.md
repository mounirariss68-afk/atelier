# Replit Build Prompt — Patch to v1 + v2 + v3: Personas & Access Control

**For:** AICo (working name "Maven AI").
**Authored:** May 12 2026 — Mounir Ariss with Claude.
**Type:** Patch document. Modifies v1 (§3 Personas, §8.3 agent catalog), v2 (§3 The Salon access, §6 agent permissions), and v3 (§2.4 EngagementAccess, the entire Roster module).
**Status:** Drop-in patch. Apply during the v3 build, or as a follow-up if v3 has shipped.

**Pitch in one line:** A formal, code-enforced access-control model for AICo with **nine personas**, **two data sensitivity classes**, a **BD-active flag**, **six agent families**, and **per-engagement overrides** — so every employee, contractor, partner-firm resource, and board observer sees exactly the right slice of the firm.

---

## How to use this document

Paste everything below `<<<REPLIT PROMPT BEGINS>>>` into Replit's AI Agent on the same repo as v1 + v2 + v3. The agent will replace the v1 persona-picker stub with a full access-control system, add Postgres row-level security policies on every table, add a Boardroom shell for Board Observers, and migrate existing users into the new model.

**Pre-conditions:** v1 + v2 + v3 are shipped or in flight. The `users`, `employees`, `contractors`, `partner_firm_resources`, `engagement_access`, `engagements`, and `opportunities` tables exist.

**Defaults inherited:** Brand system, tech stack, principles. Auth (Replit Auth / Clerk).

---

<<<REPLIT PROMPT BEGINS>>>

# Project Patch: Personas & Access Control

You are extending the AICo Atelier app (v1 + v2 + v3) with a formal access-control model. The v1 persona switcher was a UX seed; this patch replaces it with a code-enforced system that gates every read, write, and agent run.

Inherit all v1 + v2 + v3 non-negotiables (agents prepare, humans commit; show the work; source-grounded; partner authority lock; immutable audit; bilingual-aware; watermark synthetic data; people records tamper-evident; access least-privilege).

---

## 0. Non-negotiable principles (additions)

1. **Personas are bundles, not boundaries.** A persona sets the baseline. Per-engagement access can grant or restrict more narrowly on a specific engagement. The narrower scope always wins.
2. **Data sensitivity is enforced at the column, not just the route.** Compensation and personnel-contract data are policy-locked at the database level — RLS blocks SELECTs, the UI never has to ask.
3. **Self-service is invariant.** Every person can always read and edit their own record (profile, bio consents, timesheet, expenses, notifications, own documents). The persona system never overrides this.
4. **The Founding Partner override exists, and is audited.** Founding Partners can elevate to read margin / compensation / contract data outside the default rules, but every elevation writes a `principle_override` audit event with a rationale field.
5. **Worker type drives persona for non-FTEs.** Contractors and Partner-Firm Resources cannot have their persona picked from the FTE list. The system applies the right persona on creation and locks it.
6. **Board Observers live in their own auth realm.** They never see operational data — no CRM, no engagements, no Roster, no Atelier, no Salon. Boardroom only.
7. **Access changes are first-class events.** Every persona change, every engagement-access grant, every BD-flag flip writes to the audit log with the named actor.

---

## 1. The nine personas

### 1.1 The taxonomy

| # | Persona | Picked or derived? | Applies to | Notes |
|---|---|---|---|---|
| 1 | **Founding Partner** | Picked (FTE) | Mounir, Gökhan, and any future founding-equity Partners | Full firm access incl. compensation, contracts, all margins, all audit |
| 2 | **Partner** | Picked (FTE) | Non-founding partners (e.g., promoted Principals, partners brought in via the 49% strategic partnership) | Full operational access, no compensation/contract data, margin only on engagements they are on |
| 3 | **Finance** | Picked (FTE) | Finance Director / Bookkeeper / Controller | Full pipeline, pricing, all financial + billing + agents; read-only CRM / engagements / Atelier; no Salon access; sees compensation data for accruals |
| 4 | **HR** | Picked (FTE) | People Operations (typically unfilled in year 1; bundled into Founding Partner) | Full Roster, full compensation, full personnel-contract; HR agents; no CRM/pipeline/financial/Salon |
| 5 | **Senior Manager** | Picked (FTE) | Principals, SME Leads who are BD-active by default | Own engagements, own bd-tagged opportunities, Atelier, agents (Pipeline + Delivery + Atelier families) |
| 6 | **Consultant** | Picked (FTE) | AI Engineers, Designers, Analysts | Own engagements, Atelier, agents (Delivery + Atelier families); no Pipeline by default; pipeline access unlocks via `bd_active=true` |
| 7 | **Contractor** | Derived from `worker_type=contractor` | Independent contractors | Own engagements only; no Atelier reuse rights (read-only within engagement); no Pipeline; no Skill Graph visibility |
| 8 | **Partner-Firm Resource** | Derived from `worker_type=partner_firm` | Seconded staff from BGTS / Thoughtworks / Mobven / Prometa / etc. | Own engagement(s) only; no Atelier at all (only the engagement workspace); no firm-wide views |
| 9 | **Board Observer** | Created in Boardroom auth realm | External governance stakeholders (e.g., 49% strategic partner directors) | Boardroom only: KPI dashboard, board pack, cap table, shareholder updates. No CRM, no engagements, no Roster, no Atelier, no Salon |

### 1.2 BD-active flag

Independent of persona, every Person has a boolean `bd_active`:

- For **Senior Manager**, default is `true` (they originate by default).
- For **Consultant**, default is `false`.
- For all others, the flag is irrelevant (their persona already grants or excludes pipeline).

When `bd_active=true`, the Person gains:
- Read + create access to opportunities they own or are tagged on (`opportunity.owner_id` or `opportunity.collaborator_ids`).
- Read on the kanban scoped to those opportunities only (not the full firm pipeline).
- Pipeline agent family access scoped to their tagged opportunities.

The flag is set or unset by **Founding Partner** or **HR** (or the person themselves if Founding Partner). Every flip writes to the audit log.

### 1.3 Persona picker UI

On the create / edit Person screen:

- For `worker_type=employee`, the UI shows a dropdown with the six FTE-facing personas (1–6).
- For `worker_type=contractor`, the UI shows a locked field reading "Contractor (auto-applied)."
- For `worker_type=partner_firm`, same locked pattern with "Partner-Firm Resource (auto-applied)."
- For Board users, the creation flow happens at `/boardroom/admin/users` (see §10), not at `/roster/people`. The persona is locked to "Board Observer."

The persona dropdown is gated: only Founding Partner and HR can assign Founding Partner, Partner, Finance, or HR personas. Senior Manager and Consultant personas can be assigned by Founding Partner, HR, or any Partner.

---

## 2. Data sensitivity classes

Two new column-level classes enforced at the database (Postgres RLS) and at the API layer:

### 2.1 `compensation_sensitive`

Columns marked `compensation_sensitive`:

- `employees.base_compensation`
- `employees.partner_economics` (jsonb)
- `contractors.day_rate_internal_cost`
- `partner_firm_resources.cost_to_aico_per_day`
- `deal_pricings.computed_cost_usd`
- `deal_pricings.computed_margin_pct`
- `deal_pricings.partner_override_id` (and its rationale)
- `engagement_economics.realized_margin_pct`
- Any view-derived margin figure

**Read access:** Founding Partner (all). HR (only the compensation columns on Person records). Finance (all). Partner (only `deal_pricings.computed_margin_pct` and `engagement_economics.realized_margin_pct` on engagements they own — see §5).

**Write access:** Founding Partner (all). HR (Person compensation only). Finance (deal pricing cost/margin only). Partners cannot write compensation.

### 2.2 `personnel_contract_sensitive`

Columns marked `personnel_contract_sensitive`:

- `employees.employment_contract_file_id`
- `employees.nda_file_id`
- `contractors.contract_file_id`
- `contractors.payment_terms_days`
- `conflict_disclosures` (all rows)
- `bio_consents` (other people's; everyone sees their own — self-service invariant)

**Read access:** Founding Partner (all). HR (all). Self (always — every person sees their own contract). No one else.

**Write access:** Founding Partner (all). HR (all). Self (own bio_consents only).

### 2.3 Distinction from client contracts

Client-side contracts (MSAs, SOWs, NDAs with clients, change orders) are **not** `personnel_contract_sensitive`. They follow the engagement-access rules of v3 §2.4 — anyone on the engagement with `can_view_charter` (default for all engagement members) sees them. Partners on the engagement always see them.

---

## 3. Full access matrix (the source of truth)

| Resource / Action | Founding Partner | Partner | Finance | HR | Senior Manager | Consultant | Contractor | Partner-Firm | Board Observer |
|---|---|---|---|---|---|---|---|---|---|
| **CRM — Accounts list** | all | all | all (read) | — | own-tagged + bd_active scope | own-tagged + bd_active scope | — | — | — |
| **CRM — Account workspace (read)** | all | all | all (read) | — | own-tagged | own-tagged + bd_active | — | — | — |
| **CRM — Account workspace (edit)** | all | all | — | — | own-tagged + bd_active | bd_active only | — | — | — |
| **Pipeline — kanban** | all | all | all (read) | — | own-tagged + bd_active | bd_active only | — | — | — |
| **Pipeline — opportunity workspace (read)** | all | own + tagged | all (read) | — | own + tagged | bd_active scope | — | — | — |
| **Pipeline — opportunity workspace (edit)** | all | own + tagged | — | — | own + tagged + bd_active | bd_active scope | — | — | — |
| **Pricing — rate cards (read)** | all | all | all | — | day-rate only (not internal cost) | day-rate only | — | — | — |
| **Pricing — rate cards (edit)** | all | — | all | — | — | — | — | — | — |
| **Pricing — deal pricing (read)** | all | own engagements | all | — | own engagements (no margin) | own engagements (no margin) | — | — | — |
| **Pricing — deal pricing margin** | all | own engagements | all | — | — | — | — | — | — |
| **Forecast / reports** | all | all (no comp) | all | — | own-tagged | bd_active scope | — | — | KPI dashboard only |
| **Engagements — list** | all | all | all (read) | — | own | own | own (only seconded) | own (only seconded) | — |
| **Engagement workspace** | all | own | all (read, no comp) | — | own | own | own (only seconded) | own (only seconded) | — |
| **Charter / Workplan / RAID** | all | own | read | — | own | own | own (assigned tasks only) | own (assigned tasks only) | — |
| **Deliverables (read)** | all | own | own only | — | own | own | own | own | — |
| **Deliverables (edit)** | all | own | — | — | own | own (own assigned) | own assigned | own assigned | — |
| **Deliverables (Partner approve = send to client)** | all | own | — | — | — | — | — | — | — |
| **Salon — push publish** | own | own | — | — | own (countersigned by EL) | prepare-only | — | — | — |
| **Salon — invite client users** | own | own | — | — | with EL sign-off | — | — | — | — |
| **Atelier — read assets** | all | all | all (read) | — | all | all | engagement-context only | none | — |
| **Atelier — promote asset** | all | all (own engagement) | — | — | with Partner sign-off | with Partner sign-off | — | — | — |
| **Atelier — prompts library** | all | all | all (read) | — | all | all | none | none | — |
| **Roster — list** | all | all (no comp / no contract) | all (no contract) | all | all (no comp / no contract) | all (no comp / no contract) | — | — | — |
| **Roster — Person profile** | all | all (no comp / no contract) | all (no contract) | all | all (no comp / no contract) | all (no comp / no contract) | — | — | — |
| **Roster — own profile** | self-edit | self-edit | self-edit | self-edit | self-edit | self-edit | self-edit | self-edit | self-edit |
| **Roster — change persona / bd_active** | all | — | — | all (except FP/Partner) | — | — | — | — | — |
| **Engagement access — grant/revoke** | all | own | — | — | own (lead) | — | — | — | — |
| **Onboarding / offboarding workflows** | all | — | — | all | — | — | — | — | — |
| **Skill graph — read** | all | all | all (read) | all | all | all | engagement context | none | — |
| **Skill graph — promote skill** | all | all | — | all | self | self | self | — | — |
| **Ledger — own timesheet** | self | self | self | self | self | self | self | n/a (partner-firm reports separately) | — |
| **Ledger — team timesheets (approve)** | all | own engagements | — | — | own engagements (lead role) | — | — | — | — |
| **Ledger — utilization views** | all | all (no comp) | all | all | own engagements | own | — | — | — |
| **Ledger — firm economics** | all | all (no comp) | all | — | — | — | — | — | — |
| **Wallet — own expenses** | self | self | self | self | self | self | self | n/a | — |
| **Wallet — engagement-billable approve** | all | own | own | — | own (lead) | — | — | — | — |
| **Wallet — policy edit** | all | — | all | — | — | — | — | — | — |
| **Wallet — VAT register** | all | — | all | — | — | — | — | — | — |
| **Compliance / conflict declarations** | all | own self-declaration | — | all | own self-declaration | own self-declaration | own self-declaration | own self-declaration | — |
| **Audit log (read)** | all | own engagements + own opps | financial entities | people entities | own engagements + own opps | own engagements + own actions | own engagements | own engagements | board events only |
| **Access matrix view** | all | — | — | all | — | — | — | — | — |
| **Boardroom — KPI dashboard** | all | — | — | — | — | — | — | — | yes |
| **Boardroom — board pack** | all | — | — | — | — | — | — | — | yes |
| **Boardroom — cap table** | all | — | — | — | — | — | — | — | yes (read-only) |
| **Boardroom — shareholder updates** | all | — | — | — | — | — | — | — | yes |

Where "own" appears: scoped via the `engagement_access` table (v3 §2.4) for engagements, or via `opportunity.owner_id` / `opportunity.collaborator_ids` for opportunities. "Own + tagged" includes `bd_active` scope where applicable.

---

## 4. Agent family groupings

Replace per-agent permission gating with **six agent families**. Each agent in the registry carries a `family` field. Personas inherit family-level permissions.

| Family | Member agents (across v1-v3) | Founding Partner | Partner | Finance | HR | Senior Manager | Consultant | Contractor | Partner-Firm | Board Observer |
|---|---|---|---|---|---|---|---|---|---|---|
| **Pipeline & Pursuit** | Pursuit Scout, Account Cartographer, Pipeline Forecaster, Qualifier, POV Author, Proposal Composer, Pricing Strategist, Theme Curator, Win/Loss Interviewer, Whitespace Mapper, QBR Composer, Case Study Picker, Compliance Reviewer, Pre-Meeting Prep | run (all) | run (own) | run (read-only output) | — | run (own + bd) | run only if bd_active | — | — | — |
| **Delivery** | Charter Architect, Workplan Planner, RAID Watchdog, Agent Architect, Prototype Forge, Synthesis Critic, Value Case Tracker, Meeting Scribe, Pricing Analyst (rate card), Burn Sentinel | run (all) | run (own engagements) | — | — | run (own engagements) | run (own engagements) | run scoped to assignments | run scoped to assignments | — |
| **Salon** | Salon Concierge, Engagement Curator, Approval Choreographer, Publish Sentinel, Feedback Distiller | run (own) | run (own) | — | — | run (own, lead countersign) | — | — | — | — |
| **Atelier** | Knowledge Concierge, Prompt Librarian, Skill Mapper, Atelier Curator | run | run | run (read-mode only) | run (people-context only) | run | run | engagement context only | — | — |
| **People** | Roster Steward, Onboarding Concierge, Offboarding Sentinel, Access Sentinel | run | — | — | run | — | — | — | — | — |
| **Finance** | Time Steward (self), Utilization Analyst, Expense Auditor (self), Burn Sentinel (read-only on others), Payment Proposer, Invoice Composer | run | read output (own engagements) | run | — | self-instance only (Time Steward, Expense Auditor) | self-instance only | self-instance only | — | — |

**Special case agents (always available regardless of persona):**

- **Time Steward** (self) — every person uses their own instance for their own timesheet drafting. Required for the v3 Ledger to work.
- **Expense Auditor** (self) — every person uses their own instance for their own expenses. Required for the v3 Wallet to work.
- **Audit Sentinel** — runs autonomously across all data; no persona triggers it.

The registry's `Agent.family` is enforced at the API layer: an `agent_run` create call validates that the requester's persona can run that family for the target entity.

---

## 5. Margin visibility — partners-on-engagement only

Margin data on a deal or engagement is visible to a Partner **only if they are on that engagement** (i.e., they appear in `engagement_access` with role `partner_owner` or are the named partner on the opportunity).

A Partner who is not on an engagement sees:
- Deal size (top-line)
- Stage and probability
- Workplan and deliverables (operational)
- No margin chip
- No `computed_cost_usd`
- No `realized_margin_pct`

This applies to forecasts and reports as well — when a non-engaged Partner views the firm forecast roll-up, the margin column shows "—" with an "out of scope" tooltip.

Founding Partners override this rule (they see all margins). The Boardroom shows aggregated margin at the firm level (no engagement-level detail) to Board Observers.

A `principle_override` button on the deal pricing tab lets a non-engaged Partner request temporary margin visibility — Founding Partner approves; the elevation is time-limited (default 24h) and audit-logged.

---

## 6. Per-engagement override layer

The v3 `engagement_access` table is the per-engagement overlay on persona baseline. Two cases:

**Grant case (add access beyond baseline):** A Consultant by default has no Pipeline access. If a Founding Partner adds them to an opportunity as a collaborator (`opportunity.collaborator_ids`), the Access Sentinel grants them read on that opportunity only — without changing the Consultant persona. Other opportunities remain invisible.

**Restrict case (remove access below baseline):** A Senior Manager normally has access to all engagements they're on. If a conflict of interest is declared on a specific engagement, the Access Sentinel revokes their access to that engagement only — without changing the Senior Manager persona.

In both cases, the persona baseline is unchanged; the overlay is per-engagement. The narrower scope always wins:

```
effective_permissions = persona_baseline ∩ engagement_access_grant
```

If a Partner has `engagement_access` to an engagement with `can_view_pricing = false`, they cannot view pricing on that engagement even though their persona permits it.

---

## 7. Self-service invariant

Independent of persona, every Person can always:

- Read and edit their own `profile` (name, photo, bio summary, languages, time zone).
- Read and edit their own `bio_consents` (photo, named, named-clients-in-history).
- Read and edit their own `skill_self_attestations`.
- Read their own `compensation` (always self-readable, never self-editable).
- Read their own `employment_contract`, `nda`, `conflict_disclosures` (always self-readable, only HR/Founding Partner editable).
- Read and edit their own `timesheet_entries` (until lead-approved).
- Read and edit their own `expenses` (until approved).
- Read their own `audit_log`.
- Read their own `engagement_access` records (see what they have access to).
- Read their own `notifications` and notification preferences.

This is hard-coded into RLS policies — `user_id = current_user_id()` always evaluates true for SELECT on these tables/columns.

---

## 8. Salon push permissions (extends v2 §3)

Patch v2's Salon push model with the persona rules:

| Action | Founding Partner | Partner (on engagement) | Senior Manager (on engagement) | Consultant (on engagement) | Others |
|---|---|---|---|---|---|
| Push deliverable to Salon | yes (auto-approved as principle override if not on engagement, audit-logged) | yes | yes, with Engagement Lead countersign | prepare-only; lead approves the push | no |
| Approve "Send to client" on a deliverable | yes | yes | — | — | no |
| Invite client users to Salon | yes | yes | yes, with Partner sign-off | no | no |
| Change Salon settings (watermark policy, language, branding) | yes | yes | — | — | no |
| Decommission Salon (archive) | yes (own engagements) | yes (own engagements) | — | — | no |

The Engagement Lead role is per-engagement (set in `engagement_access`), not a persona. Any persona can hold the Engagement Lead role on a specific engagement.

---

## 9. Audit access (extends v1 §0.7)

| Persona | What they see in the audit log |
|---|---|
| Founding Partner | All events |
| Partner | Events on engagements + opportunities they're on |
| Finance | Events on financial entities (invoices, expenses, payments, deal pricings) firm-wide |
| HR | Events on Roster + people-related (onboarding, offboarding, compensation changes, access grants) firm-wide |
| Senior Manager | Events on engagements + opportunities they're on (read scope same as Partner-on-engagement) |
| Consultant | Events on engagements they're on + own actions firm-wide |
| Contractor | Events on engagements they're assigned to + own actions |
| Partner-Firm Resource | Events on engagements they're seconded to + own actions |
| Board Observer | Board-events feed only (KPI dashboard refreshes, board pack publications, cap table edits, shareholder communications) |

**External Auditor** (a future persona, stubbed for now) — read-only across all audit logs, time-windowed to a configured scope. Created at `/admin/audit-access` by Founding Partner; expires automatically. Not in v1 of this patch; data model supports it.

---

## 10. Board Observer + minimal Boardroom shell

Build a thin Boardroom module to make the Board Observer persona functional. The module is intentionally minimal in this patch — full board-pack composer, KPI choreographer, and shareholder comms writer are v4/v5.

### 10.1 Routes

```
/boardroom                              → Boardroom landing (KPI dashboard)
/boardroom/kpis                         → KPI tiles (TCV, ARR, gross margin, utilization, win rate, NPS, runway, cash)
/boardroom/pack                         → Latest board pack + history
/boardroom/cap-table                    → Cap table (read-only)
/boardroom/shareholder-updates          → Shareholder update feed
/boardroom/audit                        → Board events feed
/boardroom/admin/users                  → Board user management (Founding Partner only)
```

### 10.2 Auth realm

Board users are a separate user type, similar to v2's `client_users`. They live in a `board_users` table:

```ts
BoardUser {
  id, email, full_name, photo_url,
  affiliated_party,                   // 'Maven Insights' | 'BGTS' | 'UAE Investor' | 'Independent' | ...
  appointed_by,                       // text — which shareholder / agreement appointed them
  appointment_letter_file_id?,
  rights,                             // 'observer' | 'voting' (observer-only in v1)
  start_date, end_date?,
  mfa_required,                       // default true
  preferred_language,
  status                              // 'pending' | 'active' | 'paused' | 'former'
}
```

Auth: SSO (SAML / OIDC), magic link fallback. MFA required. Session policy stricter than employee sessions (15-min idle, 4-hour absolute).

### 10.3 KPI dashboard (the only fully-built surface in this patch)

Renders eight KPI tiles, each with a 12-week sparkline and a current value:

- **TCV** — Total Contracted Value (sum of signed engagement totals, last 12 months).
- **ARR** — Annual Recurring Revenue equivalent (retainers + multi-year averaged).
- **Gross margin** — firm-level, aggregated only (no per-engagement detail).
- **Utilization** — firm average billable %.
- **Win rate** — last 12 months, Convert→Contract.
- **NPS / pulse signal** — average from active Salons (when v4's Pulse Listener ships).
- **Cash** — total cash across all entity bank accounts (when v4's Treasury ships).
- **Runway** — months of cash at current burn (when v4 ships).

Until v4 finance ships, the tiles render placeholder values labeled "v4 data pending." This is intentional — the surface exists, the values fill in as modules ship.

### 10.4 Board pack

A read-only viewer for PDF / HTML board packs uploaded by Founding Partner. Board Observers can:
- View the latest pack.
- View pack history (last 12 packs).
- Add comments to the current pack (private to Board Observers and Founding Partners; not engagement teams).
- Mark "Acknowledged."

The pack is generated by Founding Partner (manual upload in this patch; the `Board Pack Composer` agent is v4/v5).

### 10.5 Cap table

A read-only table showing:
- Shareholders (Mounir, Gökhan, the 49% strategic partner once signed, any minority holders).
- Shares / units held.
- Date of issue.
- Class of share (founder, ordinary, preferred).
- Vested vs. unvested.

The cap table is editable by Founding Partner only via a dedicated `/admin/cap-table` route. Board Observers see the read-only view at `/boardroom/cap-table`.

### 10.6 Shareholder updates

A feed of communications sent to shareholders (monthly investor updates, board meeting notices, AGM minutes, dividend declarations if any). Each update is a markdown-rendered post with attached files. Composed by Founding Partner; read-only to Board Observers.

### 10.7 What Board Observers do NOT see

Explicit zero-access list, hard-coded into RLS:

- No CRM / accounts / opportunities / pipeline
- No engagements / charters / deliverables
- No Roster (no other people's names, comp, or contracts)
- No Atelier / prompts / case studies
- No Salon (no client-facing surfaces)
- No Ledger (no timesheets, no utilization detail)
- No Wallet (no expenses)
- No agent runs

---

## 11. Data model

### 11.1 New tables

```ts
Persona {
  id, code,                           // 'founding_partner' | 'partner' | 'finance' | 'hr'
                                      // | 'senior_manager' | 'consultant'
                                      // | 'contractor' | 'partner_firm_resource' | 'board_observer'
  display_name, description,
  is_pickable_for_fte: bool,          // true for 1-6; false for 7-9
  derived_from_worker_type: bool      // true for 7-8; false otherwise
}

PersonaAssignment {
  id, person_id, persona_code,
  effective_from, effective_to?,
  assigned_by_user_id, assigned_at,
  audit_reason,
  is_active                            // computed
}

BoardUser { /* per §10.2 */ }

PrincipleOverride {
  id, person_id, resource_type, resource_id,
  scope,                              // 'view_margin' | 'view_compensation' | 'view_contract' | 'cross_persona'
  granted_by_user_id, granted_at,
  rationale_text, expires_at,
  audit_event_id
}
```

### 11.2 Column changes

- `employees.persona_code` → drop (use PersonaAssignment).
- `employees.bd_active` (bool, default false; default true for Senior Manager assignments via trigger).
- `contractors.persona_code` → always `'contractor'` (enforced).
- `partner_firm_resources.persona_code` → always `'partner_firm_resource'` (enforced).
- `agents.family` → new enum column with the six values.

### 11.3 RLS policies (Postgres)

Implement RLS policies on every table. Examples:

```sql
-- Compensation fields on employees
CREATE POLICY emp_comp_read ON employees
  FOR SELECT
  USING (
    -- Self always reads own comp
    id = current_user_person_id()
    -- Founding Partner, HR, Finance read all comp
    OR has_persona(current_user_id(), 'founding_partner')
    OR has_persona(current_user_id(), 'hr')
    OR has_persona(current_user_id(), 'finance')
  );

-- Employment contract files
CREATE POLICY emp_contract_read ON employees
  FOR SELECT
  USING (
    id = current_user_person_id()
    OR has_persona(current_user_id(), 'founding_partner')
    OR has_persona(current_user_id(), 'hr')
  );

-- Deal pricing margin
CREATE POLICY deal_margin_read ON deal_pricings
  FOR SELECT
  USING (
    has_persona(current_user_id(), 'founding_partner')
    OR has_persona(current_user_id(), 'finance')
    OR (
      has_persona(current_user_id(), 'partner')
      AND is_on_engagement(current_user_id(), opportunity_id)
    )
  );

-- Salon access (for AICo side)
CREATE POLICY salon_publish ON deliverable_publishes
  FOR INSERT
  WITH CHECK (
    has_persona(current_user_id(), 'founding_partner')
    OR (
      has_persona(current_user_id(), 'partner')
      AND is_on_engagement(current_user_id(), engagement_id)
    )
    OR (
      has_persona(current_user_id(), 'senior_manager')
      AND is_on_engagement(current_user_id(), engagement_id)
      AND has_engagement_lead_countersign(publish_id)
    )
  );
```

Use Postgres functions (`current_user_person_id()`, `has_persona()`, `is_on_engagement()`, etc.) to keep policies readable. All policy functions are SECURITY DEFINER and audited.

---

## 12. UI surfaces

### 12.1 Persona picker on Person create/edit

In `/roster/people/[personId]/profile`, a "Access" sub-section renders:

- **Persona** dropdown (or locked text for derived personas).
- **BD-active** toggle (only visible if persona is Senior Manager or Consultant).
- **Engagement access** list (read-only here; managed via the engagement workspaces).
- **Principle overrides active** (Founding Partners can see and revoke).

Every change writes an audit row with the named actor and reason.

### 12.2 Access matrix view

At `/roster/access-matrix` (Founding Partner + HR only): a large table with rows = Persons, columns = resources (CRM, Pipeline, Engagements, Atelier, Roster, Ledger, Wallet, Boardroom). Each cell shows persona-derived access + any overrides. Filterable by persona and by `bd_active`.

A second view at `/roster/access-matrix?view=by_engagement` (Founding Partner only) pivots by engagement and shows who has access to each.

### 12.3 Permission badges throughout the app

Every page renders the effective permission for the current user in a small JetBrains-Mono pill in the top-right of the content area: e.g., `view · own engagement`, `edit · founding partner`, `read · finance scope`. Clicking the pill opens a "Why can I see this?" drawer that explains the persona + overlay combination.

This is a v1 of the access-transparency feature — useful in development to catch mis-scoping; remains useful in production for trust.

### 12.4 Persona switcher (development only)

In v1 of the app, the persona switcher in the top-right was a UX seed. **Disable it in production** but keep it in development behind a `process.env.PERSONA_SWITCHER === 'dev_only'` flag. This lets reviewers test persona behavior without creating multiple users.

---

## 13. Agents added in this patch

| Agent | Family | Purpose |
|---|---|---|
| **Access Sentinel** (extended from v3) | People | Now also: enforces persona policies, evaluates conflicts, manages principle overrides, audits every elevation. |
| **Permission Explainer** (new) | Atelier | Answers "why can / can't I see X?" with a structured explanation referring to the persona baseline + any overlays. Used by the "Why can I see this?" drawer. |
| **Board Liaison** (new, minimal in this patch) | People | Drafts onboarding emails for new Board Observers; verifies SSO setup; produces the first KPI tour. Stub for v4's full Board Pack Composer. |

---

## 14. Migration

Write a Drizzle migration that:

1. Creates `personas`, `persona_assignments`, `board_users`, `principle_overrides` tables.
2. Seeds the 9 personas.
3. For every existing user in `users` / `employees`:
   - If they're Mounir or Gökhan → assign Founding Partner.
   - If they have prior `persona_code` text from v1's seed (likely Partner, Engagement Lead, SME Lead, AI Engineer, Designer, BD Lead) → map to the new personas as below.
4. For every existing contractor → assign Contractor persona (locked).
5. For every existing partner-firm resource → assign Partner-Firm Resource persona (locked).
6. Apply RLS policies on all tables.
7. Set `bd_active = true` for any user whose old role was 'BD Lead' or 'Engagement Lead' (typical Senior Manager pattern).
8. Audit-log every assignment as a `persona_assignment_migrated` event.

**Old-to-new mapping (v1 personas → v3.5 personas):**

| Old (v1 §3) | New |
|---|---|
| The Partner | Founding Partner if Mounir / Gökhan; else Partner |
| The Engagement Lead | Senior Manager (with `bd_active=true` and Engagement Lead role on assigned engagements) |
| The Subject Matter Lead | Senior Manager (with `bd_active=false`, BD off) |
| The AI Engineer | Consultant |
| The Business Developer / Pursuit Lead | Senior Manager (with `bd_active=true`) |

---

## 15. MVP scope of this patch

### 15.1 What ships

1. The nine personas, picker, and lock rules.
2. The two data sensitivity classes with column-level RLS.
3. The BD-active flag with the audit hook.
4. The six agent families gating agent_run creation.
5. The per-engagement override layer (uses the existing `engagement_access`).
6. The self-service invariant on RLS.
7. The full access matrix view.
8. The permission badge on every page + "Why can I see this?" drawer.
9. The Boardroom shell (KPI tiles with placeholder values, board pack viewer, cap table read-only, shareholder feed, audit feed).
10. The Board Observer auth realm + admin user management.
11. Migration of existing users + audit history.

### 15.2 Acceptance criteria

A reviewer should be able to:

1. Sign in as a Founding Partner (Mounir) and see every tab, every margin, every compensation field, every audit row, the Boardroom KPI view (with placeholder values), and the access matrix.
2. Switch persona (in dev mode) to Partner and verify:
   - All compensation columns are gone.
   - Margins on engagements they're not on are masked.
   - HR-only routes and Boardroom return 403s.
3. Switch to Finance and verify:
   - Pricing tab fully accessible, including cost/margin.
   - Engagements list visible read-only with no Salon links.
   - Compensation on employees visible (for accruals).
   - No Salon access — visiting a Salon URL returns 403.
4. Switch to HR and verify:
   - Full Roster, full compensation, full personnel contracts.
   - No CRM / engagements / Atelier write access.
   - HR agents available; Pipeline agents return 403.
5. Switch to Senior Manager and verify:
   - Default `bd_active=true` → Pipeline visible scoped to own/tagged opportunities.
   - Turn `bd_active=false` → Pipeline column hides; only own engagements remain.
6. Switch to Consultant and verify:
   - Default `bd_active=false` → no Pipeline.
   - Add them as collaborator to a specific opportunity → that one opportunity becomes visible while no others do.
7. Switch to a seeded Contractor user and verify:
   - Only the one engagement they're seconded to is visible.
   - No Atelier write; no firm-wide views.
8. Switch to a seeded Partner-Firm Resource and verify:
   - Only the seconded engagement.
   - No Atelier at all; no other engagements; no Pipeline.
9. Sign in as a seeded Board Observer at `/boardroom` and verify:
   - KPI tiles render (placeholders if v4 not yet shipped).
   - Board pack viewer + cap table + shareholder updates accessible.
   - Direct URL to any CRM / engagement / Atelier / Salon / Roster route returns 403.
10. Trigger a principle override: as a non-engaged Partner, click "Request margin elevation"; Founding Partner approves; verify 24-hour read access; verify expiry returns to masked.
11. Open the access matrix view; filter by persona; verify the displayed access matches the expectations in §3.
12. Open any page in the app as any persona; the permission badge renders correctly and the "Why can I see this?" drawer explains the persona + overlay logic.
13. Run an agent: as a Consultant, run Synthesis Critic on a deliverable on their engagement (allowed). Then try to run Pursuit Scout on an account they don't have access to → 403.

---

## 16. Out of scope for this patch

- The full Board Pack Composer + KPI Choreographer + Shareholder Comms Writer (v4/v5).
- External Auditor persona (stub in data model; UI in a later patch).
- Time-boxed temporary persona elevation beyond 24h (current spec: instant approval, 24h default expiry — longer windows are v4).
- Field-level redaction in agent outputs (current spec: RLS gates SELECT, so agents naturally see only what their caller sees; no separate redaction layer).
- Audit of "would-have-seen" attempts on RLS — Postgres logs the attempt; surfacing it in the UI is v4.
- Persona-aware UI personalization beyond access (e.g., a Finance-tailored home page) — this patch enforces gates only; personalization is later.

---

## 17. Build order

1. Personas + PersonaAssignment + BoardUser tables + migration.
2. RLS policy functions (`has_persona`, `is_on_engagement`, etc.).
3. RLS policies on every existing table.
4. Access matrix view + permission badge.
5. Persona picker on Person edit + lock rules.
6. BD-active flag + Senior Manager / Consultant defaults.
7. Agent family enum + agent_run gating.
8. Salon push permission patch.
9. Boardroom shell + Board Observer auth realm + admin.
10. Principle override flow.
11. Permission Explainer agent + drawer.
12. Acceptance walkthrough; ship.

---

## 18. North star for this patch (paste into first system prompt)

> AICo's portal must enforce who-sees-what at the database, not just the UI. Nine personas form the baseline — Founding Partner, Partner, Finance, HR, Senior Manager, Consultant, Contractor, Partner-Firm Resource, Board Observer — each with a clear and audited remit. Compensation and personnel contracts are policy-locked. Margins are partners-on-engagement only. Pipeline access is gated by a BD-active flag, not by seniority. Self-service is invariant. The Boardroom is a separate realm where governance happens — no operational data leaks in or out. Every elevation is named, audited, and time-limited. The portal trusts no caller and assumes no role; it asks every request to prove it.

<<<REPLIT PROMPT ENDS>>>

---

## Appendix E — Open decisions deferred to a later round

These were considered and left for v4/v5:

1. **External Auditor persona** — for SOC2 / financial audit. Data model ready; UI deferred.
2. **Per-deliverable redaction in agent outputs** — currently relies on RLS at SELECT time. Future: a redaction layer that filters before serialization.
3. **Time-boxed shadow access** for senior leadership reviews — e.g., a Founding Partner wants to give a candidate Partner a 30-day look at a sample engagement. Pattern: a special "Shadow" overlay on engagement_access with TTL.
4. **"In Vacation Mode"** — temporary persona delegation when a Partner is on leave. Currently handled by adjusting engagement_access manually; v5 could automate.
5. **Cross-firm secondment** — when an AICo person is seconded *to* a partner-firm engagement (inverse of Partner-Firm Resource). Rare but possible by year 2.

---

*End of patch. Sequence: apply after v3 ships (or alongside the v3 build). Pairs with the proposal-system patch and the sales-funnel patch; precedes v4.*
