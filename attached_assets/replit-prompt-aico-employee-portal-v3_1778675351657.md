# Replit Build Prompt — AICo Employee Portal **v3: The Roster, The Ledger, The Wallet**

**For:** AICo (working name "Maven AI" pending final brand decision) — boutique AI advisory & engineering firm, GCC.
**Authored by:** Mounir Ariss (Co-Founder) with Claude, May 12 2026.
**Builds on:** v1 PRD (`replit-prompt-aico-employee-portal.md` — The Atelier) and v2 PRD (`replit-prompt-aico-employee-portal-v2.md` — CRM + The Salon). Read both before applying v3.
**Status:** v3 PRD — extends The Atelier with **The Roster** (people + access), **The Ledger** (timesheets + utilization), and **The Wallet** (expenses + client-billable pass-through). All three modules are agentic-native.
**Pitch in one line:** v3 is when the firm stops being two co-founders and becomes a payroll. The portal must absorb that transition without losing the senior-led, partner-judgment voice.

---

## How to use this document

Paste everything below the line `<<<REPLIT PROMPT BEGINS>>>` into Replit's AI Agent / "Build an App" prompt **on the same repo that hosts v1 + v2**. The agent will extend the app with three new module families and a set of new agents.

**Pre-conditions (must be true before pasting):**
- v1 + v2 are shipped and passing their acceptance criteria.
- The `users`, `agents`, `agent_runs`, `audit_events`, `engagements`, `opportunities`, `deal_pricings`, and `rate_cards` tables exist.

**Defaults inherited from v1/v2:** Brand system, tech stack, principles, agent runtime, rate-card model.

**New defaults introduced in v3:**
- Three worker types are first-class: **Employee (FTE)**, **Contractor (1099 / independent)**, and **Partner-Firm Resource** (seconded from BGTS / Thoughtworks / Mobven / Prometa / etc.). Each has different access, rate-card, compliance, and offboarding flows.
- Timesheet capture is **AI-first**: the Time Steward agent drafts every employee's timesheet from signals (calendar, agent runs, meeting attendance, deliverable activity, Salon decisions); the human confirms or corrects. Manual entry is the fallback, not the default.
- Expense capture flows from a corporate card (Pleo / Brex / Mesh) **or** a manual receipt upload. OCR + policy check is automated; human approves the categorization and client-billability flag.
- VAT is handled correctly: 5% UAE, 15% KSA, 0% USD-billed international work. Multi-currency throughout.
- Utilization target is **65% billable for Principals, 50% for Partners, 75% for AI Engineers** — not a uniform 80% (the firm is senior-led and partners are expected to do BD and IP). The portal's utilization views respect these per-role targets.

---

## Important context — branded names for the v3 surfaces

Continuing the workshop-and-salon metaphor:

- **The Atelier** (v1) — internal workshop
- **The Salon** (v2) — client-facing collaboration room
- **The Roster** (v3) — the firm's people: who is in, in what role, on which engagements, with what access. The portrait gallery of the firm.
- **The Ledger** (v3) — the time record. Every hour the firm spends, against client value or against firm investment.
- **The Wallet** (v3) — the expense record. What the firm spent, what was billable, what cleared policy.

These names sit alongside The Atelier and The Salon, keeping the artisanal voice while making the operational modules feel native to the firm, not bolted-on HR software.

---

<<<REPLIT PROMPT BEGINS>>>

# Project: AICo Employee Portal — v3 (The Roster, The Ledger, The Wallet)

You are extending the AICo Atelier app (v1 + v2) with three new module families:

1. **The Roster** — employee, contractor, and partner-firm resource records; invitations; per-engagement access management; onboarding and offboarding.
2. **The Ledger** — timesheet capture, approval, billability, utilization analytics.
3. **The Wallet** — expense capture, approval, client-billability, VAT, multi-currency.

All three are agentic-native and inherit the v1 non-negotiables (agents prepare, humans commit; show the work; source-grounded; partner authority lock; immutable audit).

---

## 0. Non-negotiable principles (additions to v1 + v2)

1. **People records are tamper-evident.** Every change to compensation, role, or status is logged, signed, and auditable. The Roster is the firm's record of who's authorized to do what — treat it like a security register.
2. **Access is least-privilege by default.** Every new person joins with view-only access to Atelier home; engagement / agent access is granted per-engagement, per-act. Inviting someone to an engagement is a deliberate event, not a side-effect of being on the Roster.
3. **Time is captured, not invented.** The Time Steward proposes drafts from signals; humans confirm. The agent never silently saves a timesheet. Any synthetic-looking time entry (e.g., 16h on a single Tuesday with no signals) is flagged.
4. **Billable time is sourced.** Every billable hour ties to an engagement + work category. The Engagement Lead countersigns weekly. No client invoice can be raised until a week's billable hours are countersigned.
5. **Expenses pass two gates.** Policy gate (Expense Auditor agent) + Partner / Engagement Lead gate. Client-billable expenses pass a third gate (the Salon Publish Sentinel — does the client see it? does it carry the right markup?).
6. **Offboarding is a workflow, not a checkbox.** When someone leaves, the Offboarding Sentinel runs a strict sequence: revoke access, transfer ownership, redact from Salons (or rename to "Former AICo team"), preserve audit, return assets, exit interview. No half-offboarded humans in the system.
7. **Partner-firm staff are first-class but bounded.** A BGTS / Thoughtworks engineer seconded to an engagement has time and access in the system, but no firm-wide visibility, no Roster page, and no Atelier reuse rights. The portal makes the boundary obvious.
8. **GCC compliance is real.** DIFC, ADGM, KSA labor, KSA Saudization, UAE Wage Protection System — the relevant compliance hooks are stubbed and named, even if the actual filings are out of scope. Compliance failure is logged as a RED-tier audit event.

---

## 1. Information architecture (additions to v1 + v2)

```
/roster                             → The Roster
  /people                           → All people (FTE + contractor + partner-firm)
  /people/[personId]                → Person profile (tabs below)
    /profile                        → Bio, role, seniority, contract type, status, photo
    /access                         → Engagements they're on, agents they can run, Salons they can enter
    /skills                         → Skill graph entries, certifications, languages
    /engagements                    → History of engagements
    /timesheet-summary              → Their utilization at a glance
    /documents                      → Contract, NDA, conflict-of-interest, NDAs by client
    /audit                          → Their audit trail
  /invitations                      → Pending and recent invitations
  /onboarding                       → Active onboardings + checklist progress
  /offboarding                      → Active offboardings + sequence progress
  /compliance                       → DIFC / ADGM / KSA + WPS / Saudization hooks
  /skill-graph                      → Firm-wide skill map (extends v1 stub)
  /access-matrix                    → Cross-cutting: who has access to what (admin only)

/ledger                             → The Ledger
  /timesheets                       → My timesheet (current week) + history
  /timesheets/[userId]/[weekIso]    → Specific timesheet
  /approvals                        → Approvals waiting on me (Engagement Lead view)
  /utilization                      → Personal utilization
  /engagement-economics             → Per-engagement: planned vs. actual hours, margin variance
  /firm-economics                   → Partner-level firm view: utilization, realization, leakage

/wallet                             → The Wallet
  /expenses                         → My expenses (open + history)
  /expenses/new                     → Submit an expense
  /approvals                        → Approvals waiting on me
  /cards                            → Linked corporate cards
  /policy                           → Expense policy (firm-wide; editable by admin)
  /client-billable                  → Per-engagement client-billable expense queue
  /vat                              → VAT register (auditor view)
```

Where v2 added new tabs to existing entities (e.g., Opportunity Commercials), v3 mostly adds new top-level modules. The right rail (Agent Activity Stream) and the Atelier Home are unchanged in chrome.

---

## 2. The Roster — full functional spec

### 2.1 Worker types and their records

Three distinct entity types, all extending a common `person` base:

#### Employee (FTE)

```ts
Employee extends Person {
  employment_status,            // 'active' | 'on_leave' | 'notice' | 'former'
  employing_entity,             // 'DIFC' | 'ADGM' | 'KSA' | 'Other'
  start_date, notice_period_days,
  seniority,                    // 'Partner' | 'Principal' | 'SME Lead' | 'AI Engineer' | 'Designer' | 'Analyst'
  base_currency,
  base_compensation,            // optional, restricted view
  partner_economics?,           // FK → PartnerEconomics (revenue share, not salary, for Partners)
  utilization_target_pct,       // role-specific default; overridable
  employee_id_external,         // payroll system external ID
  iban?, swift?, payroll_country
}
```

#### Contractor (independent / 1099-equivalent)

```ts
Contractor extends Person {
  status,                       // 'active' | 'paused' | 'former'
  contract_type,                // 'fixed_term' | 'rolling' | 'task_order'
  contract_start, contract_end,
  day_rate_internal_cost,       // what AICo pays them per day
  currency,
  payment_terms_days,
  vat_treatment,                // 'inclusive' | 'exclusive' | 'zero_rated'
  engagement_scope_default,     // 'engagement_only' (cannot access Atelier home / cross-engagement)
  contracting_entity,           // their own legal entity name + jurisdiction
  conflicts_disclosed[]         // other clients / firms they work for
}
```

Contractors **do not** see the Atelier Home or cross-engagement views by default. They live inside their assigned engagement(s) and can be granted bench-side Atelier access by Partner override (logged).

#### Partner-Firm Resource

```ts
PartnerFirmResource extends Person {
  partner_firm_id,              // FK → PartnerFirm (BGTS, Thoughtworks, Mobven, Prometa, ...)
  seconded_to_engagement_ids[], // mandatory; cannot exist without an engagement
  role_on_engagement, seniority_band,
  cost_to_aico_per_day,         // pass-through cost
  visible_to_client_in_team_tab bool,
  partner_firm_pm_user_id?,     // their delivery manager on the partner-firm side
  status                        // 'requested' | 'active' | 'rolled_off'
}
```

Partner-firm staff:
- Are **never** added to the firm-wide Skill Graph.
- **Do not** see the Pipeline, Forecast, Atelier home, or any other engagement.
- See only `/engagements/[their engagement]/*` and any agents the Engagement Lead has granted them.
- Their identity in the Salon team tab is configurable (e.g., "Karim — Senior Engineer (BGTS, partner firm)" — explicit, no hiding).

### 2.2 PartnerFirm records

```ts
PartnerFirm {
  id, name, hq_country,
  master_agreement_status,     // 'in_negotiation' | 'signed' | 'expired'
  master_agreement_end,
  primary_contact_user_id,     // an Employee at AICo who owns the relationship
  default_payment_terms_days,
  rate_card_id?,               // optional partner-firm-specific rate card
  default_billing_currency,
  insurance_status,
  notes
}
```

A partner firm cannot supply a resource without an active master agreement (the system enforces this on `PartnerFirmResource` creation).

### 2.3 Skill graph (extends v1 stub)

```ts
Skill { id, name, kind: 'tech'|'industry'|'function'|'language'|'tool', taxonomy_parent_id? }
PersonSkill {
  person_id, skill_id,
  proficiency,                 // 1–5
  source,                      // 'self' | 'partner_attested' | 'evidence_atelier' | 'certification' | 'agent_inferred'
  evidence_artifact_ids[],
  verified_by_user_id?, verified_at?
}
```

The **Skill Mapper** agent (already in v1 catalog, now functional) maintains entries from signals — engagement work, deliverables authored, Atelier assets contributed, certifications uploaded. Self-attested skills are always accepted but lower-trust than evidence-backed.

A search box on `/roster/skill-graph` answers "who knows Databricks + KSA public sector?" — returning a ranked list with evidence links.

### 2.4 Per-engagement access management

Access is a graph: `(person) -- has_role --> (engagement)` with role-typed edges.

```ts
EngagementAccess {
  id, engagement_id, person_id,
  role_on_engagement,           // 'partner_owner' | 'engagement_lead' | 'sme_lead' | 'engineer' | 'designer' | 'analyst' | 'observer'
  allocation_pct,               // capacity allocation (informational; full Gantt is v4)
  start_date, end_date,
  granted_by_user_id, granted_at,
  scope: {
    can_view_charter, can_edit_charter,
    can_view_pricing, can_view_margin,
    can_run_agents[],             // specific agent_ids
    can_publish_to_salon,
    can_approve_deliverables,
    can_invite_others
  },
  status                        // 'pending' | 'active' | 'paused' | 'revoked'
}
```

The **Access Sentinel** agent (see §5) keeps this consistent: e.g., if a contractor is on an engagement and the engagement ends, access is revoked automatically (with grace period). If a Partner removes themselves from an engagement, the agent re-assigns or alerts.

### 2.5 Onboarding workflow

Driven by the **Onboarding Concierge** agent. Triggered when a new Person is created with status `pending_start`. Runs a sequence (customized per worker type):

| Step | FTE | Contractor | Partner-Firm |
|---|---|---|---|
| Right-to-work / contracting entity validation | ✓ | ✓ | n/a |
| NDA signed | ✓ | ✓ | ✓ (covered by Master) |
| Conflict-of-interest declaration | ✓ | ✓ | n/a |
| Identity provisioning (Google / Microsoft / Okta) | ✓ | engagement-scoped | engagement-scoped |
| Email + Slack accounts | ✓ | optional | optional |
| Atelier access grant | full | engagement-only | engagement-only |
| Agent access defaults | full role-based | engagement-only | engagement-only |
| First Salon access (if any) | as needed | as needed | as needed |
| Brand training (45-min) | ✓ | optional | n/a |
| Compliance training (KSA / UAE) | ✓ | optional | n/a |
| First engagement assignment | ✓ | ✓ (creates contractor) | ✓ (creates record) |
| Manager 1:1 scheduled | ✓ | n/a | n/a |

Each step has a status (`pending` / `in_progress` / `complete` / `blocked`), an owner, and a deadline. The Concierge agent nudges and escalates.

### 2.6 Offboarding workflow

Driven by the **Offboarding Sentinel** agent. Triggered on status change to `notice` or `rolled_off`. Strict, non-skippable sequence:

1. Knowledge transfer plan drafted (Atelier assets the person owns, engagement context, client relationships).
2. Engagement reassignments completed.
3. Salon presence updated (renamed to "Former AICo team" or removed, per Partner choice; client notified if appropriate).
4. Agent ownership transferred (any prompts / Atelier assets they authored).
5. Audit-log preservation confirmed (no deletion; status flips to `former`).
6. Access revoked across all engagements + Atelier + Salons (immediate on final day).
7. SSO / email / Slack offboarded.
8. Assets returned (laptop, hardware).
9. Exit interview scheduled (run by an agent in async-video mode or by a non-deal Partner).
10. Final pay / contractor settlement processed (handoff to payroll system).
11. Audit-log of the offboarding generated + Partner-signed.

A leaver remains in the database as `status = former` — never deleted, for audit integrity.

### 2.7 GCC compliance hooks

Stubbed (the system records the data; filings are out of scope). The compliance view (`/roster/compliance`) shows:

- DIFC / ADGM employer registrations and their staff.
- KSA labor: Saudization quota progress (target / current / gap), GOSI status per employee, residence permit (Iqama) expirations.
- UAE Wage Protection System (WPS) status per employee (file-ready, not auto-filed).
- Visa status per employee (DIFC / ADGM / KSA / GCC entry).
- VAT registration status of contracting entities.

The **Roster Steward** agent (see §5) watches for expirations and surfaces them on the Atelier Home Pane A 30 / 60 / 90 days in advance.

### 2.8 Conflict of interest tracking

```ts
ConflictDisclosure {
  id, person_id,
  declared_party,              // a client, account, competitor, family member
  nature,                      // 'former_employer' | 'family_relationship' | 'investment' | 'side_consulting' | ...
  scope_impact,                // 'do_not_staff_on' | 'disclose_to_client' | 'monitor'
  status,                      // 'active' | 'resolved'
  declared_at, last_reviewed_at
}
```

When an engagement is created for an account where a team member has an active conflict, the Access Sentinel **blocks** that team member from being added until the conflict is reviewed and a scope-impact verdict is logged.

---

## 3. The Ledger — full functional spec

### 3.1 Time entry model

```ts
TimesheetEntry {
  id, person_id, work_date,
  engagement_id?,              // null for non-billable time
  work_category,               // 'delivery' | 'business_dev' | 'firm_investment' | 'training' | 'leave' | 'admin'
  hours,                       // numeric, 0.25h granularity
  description,                 // 1-line, what was done
  source,                      // 'agent_drafted' | 'manual' | 'calendar_imported' | 'agent_run_signal' | 'salon_signal'
  signal_evidence[],           // FK to source signals
  status,                      // 'draft' | 'submitted' | 'lead_approved' | 'rejected' | 'invoiced'
  approved_by_user_id?, approved_at?,
  rejected_reason?
}

TimesheetWeek {
  id, person_id, iso_week, year,
  total_hours, billable_hours, non_billable_hours,
  status,                      // 'open' | 'submitted' | 'partial_approved' | 'approved' | 'late'
  submitted_at, due_at,
  approver_id
}
```

### 3.2 AI-first time capture (the Time Steward)

The **Time Steward** agent (see §5) runs daily for every Employee. It pulls signals:

- Calendar events (meetings, durations, attendees).
- Agent runs the person triggered (each run is timestamped; attribute to the engagement context it ran in).
- Meetings the person attended in any engagement.
- Deliverable activity (edits, reviews, approvals).
- Salon activity (decisions logged, comments authored).
- Slack / DM activity (out of scope in v3 MVP — flagged for v4).

It produces a **draft daily timesheet** — typically populated to 70–90% — and presents it to the person each morning. The person:
- Confirms entries (one click).
- Edits durations or categories.
- Adds missing entries (e.g., "1.5h thinking" — uncaptured by signals).
- Submits weekly.

The Time Steward never auto-submits. The default flow is **review-and-confirm**, not auto-approve.

### 3.3 Approval flow

- Employees submit by Sunday 21:00 GST for the week ending.
- Engagement Leads approve their engagement's hours by Tuesday 12:00 GST.
- Partners receive the firm-wide utilization view Wednesday morning.

Late timesheets trigger nudges from the Time Steward; chronic lateness escalates to the Engagement Lead.

### 3.4 Utilization analytics

**Per-person view (`/ledger/utilization`):**
- Billable utilization % (rolling 4 weeks + YTD).
- Engagement mix (billable + investment + BD).
- Variance vs. role target.

**Per-engagement view (`/ledger/engagement-economics`):**
- Planned vs. actual hours by role-seniority.
- Planned vs. actual cost.
- Realized margin (vs. priced margin from the v2 deal pricing).
- Burn rate; weeks of runway at current spend.
- Variance commentary (auto-drafted by the **Utilization Analyst** agent).

**Firm-wide view (`/ledger/firm-economics`):**
- Partner-by-Partner utilization.
- Sector-by-sector margin realization.
- Realization rate (billed / capacity at full rate).
- Leakage report — billable hours not invoiced; under-billing.

### 3.5 Realization rate (the bookend metric)

Realization = Hours invoiced at full rate / Hours available at full rate. The Utilization Analyst computes this weekly per Partner and per role. Below-target realization triggers an automatic re-look at engagement pricing in v2.

### 3.6 Contractor time

Contractors submit timesheets like Employees but:
- Their submitted hours feed directly into a **contractor payment proposal** which appears in the Wallet's Approvals queue weekly.
- Approval by the Engagement Lead is the green-light for payment processing (handoff to bank rails — stub in v3).

### 3.7 Partner-firm resource time

Partner-firm resources do not enter timesheets in AICo's portal. AICo records:
- A planned-hours commitment per engagement.
- The partner firm's reported hours (CSV upload by their PM, or API ingest if available).
- Variance between commitment and reported.

The Engagement Lead approves the partner-firm invoice in The Wallet; AICo's cost is then recognized in the engagement economics.

---

## 4. The Wallet — full functional spec

### 4.1 Expense model

```ts
Expense {
  id, person_id, expense_date, currency,
  amount, vat_amount, vat_treatment, country,
  merchant, category,           // 'travel' | 'meals' | 'lodging' | 'software' | 'workshop' | 'client_gift' | ...
  source,                       // 'card_pleo' | 'card_brex' | 'card_other' | 'manual_upload' | 'mileage'
  receipt_file_id?,
  engagement_id?,               // null for firm expenses
  client_billable,              // bool — only true if engagement exists and contract allows
  markup_pct,                   // 0 by default; engagement-contract-driven
  client_billed_amount,         // computed
  policy_check_result,          // jsonb from Expense Auditor
  status,                       // 'draft' | 'submitted' | 'approved' | 'rejected' | 'invoiced'
  approved_by_user_id?, approved_at?
}
```

### 4.2 Capture paths

1. **Corporate card (preferred):** Pleo / Brex / Mesh feed expenses automatically. Each transaction lands in the person's Wallet draft state. They attach a receipt (camera or upload), confirm category and engagement, submit.
2. **Manual upload:** Receipt photo → **Expense Auditor** OCRs amount + date + merchant + VAT → person confirms → submits.
3. **Mileage:** Person enters distance + purpose; system applies the configured per-km rate.
4. **Per-diem:** Person logs a travel day; per-diem auto-computed from policy.

### 4.3 Approval flow

- Person submits.
- Expense Auditor runs the policy check (in <10s).
- Engagement Lead approves engagement-billable; otherwise Partner approves firm expenses > $250.
- Client-billable expenses pass an additional gate: Salon Publish Sentinel checks markup, watermark, and category before the expense lands on the client invoice.

### 4.4 Policy engine

Configurable rules. v3 ships with these defaults; admin (`/wallet/policy`) can edit:

- Flights > 6h: business class permitted for Partner, Principal; premium economy for SME Lead and below.
- Hotels: capped at $400/night Tier-1 city (Dubai, Riyadh, Jeddah); $300/night elsewhere.
- Client meals: capped at $150/person; alcohol on a client meal requires Partner pre-approval.
- Client gifts: capped at $200; pre-approval required > $200.
- Software subscriptions: > $50/month requires Partner approval (catches Atelier-bypassing tools).
- Workshop / training: > $1000 requires Partner approval.

Rule violations are surfaced as AMBER warnings (Partner can override with rationale) or RED blocks (must split / re-categorize / withdraw).

### 4.5 VAT handling

The Wallet VAT register (`/wallet/vat`):
- KSA VAT (15%): captured on every KSA expense; categorized for input-VAT reclaim (some categories not reclaimable — meals, entertainment).
- UAE VAT (5%): same.
- Non-GCC expenses: out of scope of input reclaim; recorded for clarity.

VAT register is exportable to CSV for the accountant.

### 4.6 Multi-currency

- Person can submit in expense currency (e.g., SAR for KSA card).
- System stores both the original currency amount + a USD reference amount (FX rate at submission date).
- Reports in USD by default; toggle to AED / SAR.
- FX rates pulled daily from an open FX API (stub OK, deterministic for the build).

### 4.7 Engagement invoicing surface (preview, not full)

Per engagement, `/ledger/engagement-economics` carries an **invoicing companion** panel:
- Approved billable hours × applicable rates.
- Approved client-billable expenses × markup.
- Generates a **draft invoice line set** for handoff to the accounting system (Xero / QuickBooks / DIFC-compliant accounting — stub).
- The invoice itself is not generated in v3; the surface is the line set the accountant will use.

Full invoicing and dunning is v4 scope (flagged).

---

## 5. New agents introduced in v3

Group | Agent | Module | Purpose (one line)
---|---|---|---
**Roster** | Roster Steward★ | Roster | Maintains person records, watches for compliance expirations, surfaces what needs attention.
**Roster** | Onboarding Concierge★ | Roster | Runs the joiner sequence (FTE / contractor / partner-firm) end-to-end with named owners and SLAs.
**Roster** | Offboarding Sentinel★ | Roster | Runs the leaver sequence; revokes, transfers, preserves audit, processes settlement.
**Roster** | Access Sentinel★ | Roster | Enforces least-privilege access per engagement; auto-grants, auto-revokes, flags conflicts.
**Roster** | Skill Mapper (v3 functional) | Roster | Builds the firm skill graph from signals; promotes self-attested skills with evidence.
**Ledger** | Time Steward★ | Ledger | Drafts daily timesheets from calendar / agent runs / meetings / deliverable signals; requests confirmation.
**Ledger** | Utilization Analyst★ | Ledger | Produces per-person, per-engagement, and firm-wide utilization & realization views; flags risks.
**Ledger** | Burn Sentinel | Ledger | Watches per-engagement hours vs. plan; alerts the Engagement Lead at 60% / 80% / 100% burn.
**Wallet** | Expense Auditor★ | Wallet | OCRs receipts, classifies, runs policy, computes VAT, proposes client-billability + markup.
**Wallet** | Payment Proposer | Wallet | Builds weekly contractor + partner-firm payment proposals for Partner approval.
**Wallet** | Invoice Composer | Wallet | Drafts engagement invoice line sets from approved time + expenses; hands to accounting.

### 5.1 Detailed specs — the v3 MVP 7 starred agents

Same Agent interface as v1.

#### 5.1.1 Roster Steward

- **Purpose:** Maintain person records; watch for compliance expirations (visas, Iqamas, master agreements, certifications); surface what needs attention to the right Partner.
- **Inputs:** `{ scope: 'firm' | 'employee_id' | 'partner_firm_id', focus: 'expirations' | 'profile_changes' | 'all', horizon_days: 30|60|90 }`
- **Output:** `{ items[]: { person_id?, partner_firm_id?, kind, severity, due_in_days, suggested_action }, summary, sources[] }`
- **Tools:** `roster.read`, `calendar.read` (for visa appointments), `knowledge.search` (compliance reference library).
- **Schedule:** Daily.
- **Guardrails:** No PII to third-party LLMs in cleartext; visa / Iqama numbers redacted in agent inputs (Steward operates on metadata, not numbers).
- **Human checkpoints:** Profile changes require Engagement Lead or Operations Partner approval; expirations are alerts, not actions.
- **Evals:** Seed roster with timed expirations; measure detection precision and lead-time accuracy.

#### 5.1.2 Onboarding Concierge

- **Purpose:** Run the joiner sequence end-to-end, customized per worker type.
- **Inputs:** `{ person_id, worker_type, target_start_date, first_engagement_id?, custom_steps?: [] }`
- **Output:** `{ sequence_state, steps_in_progress[], next_actions[], blockers[], audit_entries[] }`
- **Tools:** `email.send`, `sso.provision`, `calendar.schedule`, `file.write` (NDA / contract templates), `knowledge.search` (compliance docs).
- **Schedule:** Triggered on Person creation; runs continuously until sequence complete.
- **Guardrails:** Cannot grant Atelier-wide access without Operations Partner sign-off; cannot complete the sequence with any compliance step blocked.
- **Human checkpoints:** Operations Partner approves final access grant; Engagement Lead confirms first engagement assignment.
- **Evals:** Synthetic onboardings (FTE, contractor, partner-firm); measure time-to-productive (first billable hour), blocker recovery.

#### 5.1.3 Offboarding Sentinel

- **Purpose:** Run the leaver sequence with no shortcuts.
- **Inputs:** `{ person_id, leave_kind: 'voluntary'|'involuntary'|'contract_end'|'rolloff', last_day }`
- **Output:** `{ sequence_state, transfers_pending[], revocations_completed[], salon_renames[], final_audit_pack_id }`
- **Tools:** `sso.revoke`, `email.disable`, `slack.disable`, `salon.rename_team_member`, `file.read`, `audit.export`.
- **Schedule:** Triggered on status → `notice`; runs until `former`.
- **Guardrails:** Access revocation is immediate on the leaver's final day, no retro-active extensions without Partner override; offboarding cannot complete if engagement reassignments are missing.
- **Human checkpoints:** Engagement Lead signs off on reassignments; Operations Partner signs off on the final offboarding pack.
- **Evals:** Synthetic leavers across worker types; measure access revoked < SLA, audit completeness.

#### 5.1.4 Access Sentinel

- **Purpose:** Enforce least-privilege per engagement; manage grants and revocations; flag conflicts of interest.
- **Inputs:** `{ event: 'engagement_added' | 'engagement_closed' | 'access_request' | 'conflict_change', payload }`
- **Output:** `{ access_changes[]: { person_id, engagement_id, scope_delta, reason }, conflict_flags[], suggested_partner_review }`
- **Tools:** `roster.read`, `engagements.read`, `conflicts.lookup`, `audit.write`.
- **Schedule:** Event-driven (engagement / person / conflict).
- **Guardrails:** Cannot grant `can_view_pricing` or `can_view_margin` to contractors or partner-firm staff (architectural rule); cannot grant access where an active conflict exists; cannot retain access beyond engagement-end + 30 days.
- **Human checkpoints:** Engagement Lead approves every new access grant; Operations Partner reviews conflict overrides.
- **Evals:** Synthetic engagement lifecycles; measure access leakage, false-conflict rate.

#### 5.1.5 Time Steward

- **Purpose:** Draft each Employee's daily and weekly timesheet from signals; ask for confirmation; nudge submission.
- **Inputs:** `{ person_id, target_date, signals_window_hours: 24 | 168 }`
- **Output:** `{ draft_entries[]: { engagement_id?, category, hours, description, evidence[] }, confidence_overall, missing_hours_warning, total_drafted_hours }`
- **Tools:** `calendar.read`, `agent_runs.read`, `meetings.read`, `deliverable_activity.read`, `salon_activity.read`, `knowledge.search`.
- **Model:** Haiku 4.5 for drafting; Sonnet 4.6 for category classification edge cases.
- **Guardrails:** Never submits autonomously; always presents draft with evidence; flags suspicious patterns (>14h in a day, double-booked hours, fully-billable days with zero meetings).
- **Human checkpoints:** Daily review (1-tap confirm) and weekly submit (with Engagement Lead approval flow downstream).
- **Evals:** Seeded persona-week logs (Mounir Partner-week, an Engineer week, a Contractor week); measure draft accuracy ( % of confirmed entries the agent got right), confidence calibration.

#### 5.1.6 Utilization Analyst

- **Purpose:** Produce the per-person, per-engagement, and firm utilization & realization views; flag risks.
- **Inputs:** `{ view: 'person' | 'engagement' | 'firm', target_id?, period: { from, to } }`
- **Output:** `{ summary, charts_data, risks[]: { kind, severity, narrative }, recommended_actions[] }`
- **Tools:** `timesheets.read`, `engagements.read`, `deal_pricings.read`, `expenses.read`, `rate_cards.read`.
- **Model:** Sonnet 4.6 for narrative; deterministic SQL for numbers.
- **Guardrails:** No invented numbers — all charts hydrate from the database; narrative is generated only after numbers are computed.
- **Human checkpoints:** Partner reviews the weekly firm view; Engagement Lead reviews engagement views on demand.
- **Evals:** Golden week of seeded timesheets + engagements; measure narrative accuracy, alert precision.

#### 5.1.7 Expense Auditor

- **Purpose:** OCR, classify, policy-check every expense; compute VAT and propose client-billability + markup; handle currency.
- **Inputs:** `{ expense_draft, engagement_id?, person_role, country }`
- **Output:** `{ extracted: { amount, currency, vat, merchant, date }, category_proposed, policy_checks[], vat_treatment, client_billable_proposed, markup_proposed, audit_notes }`
- **Tools:** `ocr.parse`, `fx.rate_at_date`, `policy.lookup`, `knowledge.search` (per-client expense agreements).
- **Model:** Haiku 4.5 for OCR + classification; Sonnet 4.6 for edge cases.
- **Guardrails:** Cannot mark client-billable without checking the engagement contract for an expenses clause; cannot apply markup beyond the engagement-contracted cap.
- **Human checkpoints:** Person confirms classification; Engagement Lead / Partner approves submission.
- **Evals:** Seeded receipts (in EN + AR), various currencies; measure OCR accuracy, classification precision, policy-check correctness.

---

## 6. Data model (additions to v1 + v2)

New tables:

- `employees` (extends `users`; `users` becomes a thin auth row, `employees` carries firm data)
- `contractors`
- `partner_firms`
- `partner_firm_resources`
- `persons` view union: `employees ∪ contractors ∪ partner_firm_resources`
- `skills`, `person_skills` (extended from v1 stub)
- `engagement_access` (per §2.4)
- `onboardings`, `onboarding_steps`
- `offboardings`, `offboarding_steps`
- `conflict_disclosures`
- `compliance_records` (visas, Iqamas, certifications, master agreements)
- `timesheet_entries`, `timesheet_weeks`
- `timesheet_signals` (immutable log of what agents pulled to draft a timesheet — auditable)
- `expenses`
- `corporate_cards` (linked card metadata)
- `expense_policies` (rule rows)
- `partner_firm_invoices`
- `contractor_payments`
- `invoice_line_drafts` (engagement-billing companion)
- `fx_rates`
- `vat_register`
- `utilization_snapshots` (computed weekly)

Row-level security additions:
- Contractors and partner-firm resources have a restricted RLS policy: they see only their assigned engagement(s) and explicit access grants.
- Compensation fields (`base_compensation`, `day_rate_internal_cost`) are columns with policy-restricted SELECT — only Partners and Operations role can read.

---

## 7. MVP scope for v3 (what ships)

### 7.1 Modules in v3 MVP

1. **Roster — full CRUD for FTE, Contractor, Partner-Firm Resource**; onboarding and offboarding workflows; access management; skill graph; conflict tracking; compliance hooks.
2. **Ledger — full timesheet flow** (AI-first draft + manual edit + Engagement-Lead approval); utilization views (person, engagement, firm); realization computation.
3. **Wallet — full expense flow** (card-ingest stub + manual upload + OCR + policy check + multi-currency + VAT); client-billable surfacing; contractor + partner-firm payment proposals.
4. **v3 agents — 7 starred to full depth**; the rest as registered stubs.
5. **Cross-cutting: per-engagement RLS strengthened**; compensation fields policy-locked; immutable audit on all Roster / Ledger / Wallet events.

### 7.2 Seed data v3 must add

- **5 Employees** across the 6 seniority bands (Mounir Partner, Gökhan Partner, one Principal, one SME Lead, one AI Engineer, one Designer).
- **2 Contractors** (one KSA-based, one UAE-based).
- **3 Partner Firms** (BGTS, Thoughtworks, Mobven) with master agreements and 4 seconded resources across them.
- **A populated skill graph** for the FTEs.
- **Two weeks of timesheets** seeded for every person, including drafted, submitted, approved, and rejected entries.
- **Twenty expenses** spanning currencies, categories, and client-billability states.
- **An onboarding-in-flight** for a new Principal joining in 2 weeks.
- **An offboarding-in-flight** for a contractor rolling off next week.

### 7.3 Acceptance criteria for v3 MVP

A reviewer should be able to:

1. Open `/roster/people`, filter by worker type, click into a Person, see their profile, access, skills, engagements, timesheet summary, and audit.
2. Add a new FTE via the Onboarding Concierge wizard; complete steps; see Atelier access activate at the right step; verify the access matrix updates.
3. Mark a contractor as rolling off; the Offboarding Sentinel runs the sequence; access revokes at the configured time; audit pack is generated and Partner-signed.
4. Add a Partner-Firm Resource to an engagement; verify they see only that engagement; verify they're absent from the Skill Graph; verify they appear on the Salon Team tab with the partner-firm label.
5. Open the Ledger as Mounir — see the Time Steward's draft for today populated from signals; confirm 4 entries with one tap; add 1 missing entry manually; submit the week.
6. Approve a team member's timesheet as Engagement Lead.
7. Open `/ledger/engagement-economics/[engagement]` and see planned vs. actual hours, cost, and margin variance with narrative from the Utilization Analyst.
8. Submit an expense via manual upload (a real receipt photo); receive Expense Auditor's OCR + classification + policy check within 30s; correct one field; submit.
9. Approve a client-billable expense as Engagement Lead; verify it appears on the engagement's draft invoice line set.
10. Open `/wallet/vat` and see the VAT register with correct UAE (5%) and KSA (15%) splits.
11. Open `/ledger/firm-economics` as Partner and see partner-by-partner utilization with realization rates and at least one risk narrative.
12. Trigger an Access Sentinel conflict block: try to add a person with an active conflict to an engagement and see the block + override flow.

### 7.4 Non-functional requirements (v3 additions)

- **Compensation field protection:** policy-locked SELECT; tamper-evident change log.
- **Audit pack export:** any Person's complete audit (including offboarding) can be exported as a signed PDF for HR/compliance.
- **FX freshness:** rates < 24h old at posting time; stale-rate warning if missing.
- **Receipt storage:** encrypted at rest; OCR retention 90 days then PII-redacted summary remains.
- **Mobile-friendly:** expense submission and timesheet confirmation must work on a phone (these are the high-frequency mobile flows).
- **Performance:** Timesheet draft load < 2s; expense OCR end-to-end < 30s; firm utilization view < 4s on the seeded dataset.

### 7.5 Out of scope for v3 (explicitly defer)

- Full invoice generation and dunning (line-set handoff only).
- Direct payroll runs (handoff via export).
- Slack signal ingestion for time capture.
- WhatsApp expense submission (channel compliance heavy).
- Live mobile native apps (responsive web only).
- Pension / GOSI / WPS file generation (read-only views; not auto-filed).
- Real-time bank rails for contractor / partner-firm payments.
- Multi-entity tax consolidation (DIFC + ADGM + KSA combined statutory reporting).

---

## 8. Data migration & backwards compatibility

The Replit agent must:

1. Extend `users` minimally (auth-only) and create the `employees` / `contractors` / `partner_firm_resources` tables; migrate v1/v2 user data into `employees` for existing AICo accounts.
2. Add the `engagement_access` table and back-fill from current engagement-team relationships in v1/v2.
3. Apply the new RLS policies without breaking v1/v2 reads.
4. Add the v3 agents to the registry.
5. Preserve all v1/v2 audit history.

The Replit agent must write idempotent migration scripts and a `seed_v3.sql`.

---

## 9. Build order (suggested)

1. Roster shell + person types + base profile.
2. Engagement access model + Access Sentinel + access matrix admin view.
3. Onboarding Concierge + first end-to-end FTE onboarding.
4. Offboarding Sentinel + first end-to-end leaver.
5. Skill graph (functional, extending v1 stub).
6. Compliance + conflict tracking.
7. Ledger timesheet entry + Time Steward + manual flow.
8. Approval flow + utilization views (person + engagement + firm).
9. Wallet expense entry + Expense Auditor + policy engine + VAT.
10. Client-billable surfacing + contractor / partner-firm payment proposals.
11. Acceptance walkthrough; ship.

---

## 10. Open decisions for the founder (do not implement; surface as TODO)

1. **Operations Partner role** — does this role exist day 1 (likely an outsourced ops firm in DIFC initially), or does Mounir wear it through year 1?
2. **Per-role utilization targets** — defaults in this spec (65% Principal / 50% Partner / 75% Engineer) are reasonable for a senior-led model; you may want tighter targets in year 1 when pipeline is thin and senior bench should be hunting.
3. **Default markup on client-billable expenses** — set 0% as a senior-firm tradition, or 10% as a Tier-1 norm? I'd default 0% and surface a positive surprise to clients.
4. **Partner economics model** — equal partnership in year 1 vs. eat-what-you-kill plus a small base. The Roster supports either; the data model has the placeholder.
5. **Whether contractors should see Atelier reuse rights** — the default in this spec is no (the lean Tier-1 default). You may want a 90-day evaluation pathway for top contractors to receive Atelier access (and contribute IP back).
6. **Whether the firm uses one corporate card platform or two** — Pleo in UAE, Brex in US (if KSA-resident leaders bill US revenue); minor architecture decision but worth pinning early.
7. **VAT reclaim philosophy** — full input-VAT reclaim is a meaningful margin lever in GCC; do you want a dedicated VAT manager (likely outsourced) by year-2?
8. **E-signature** — DocuSign for SOWs, NDAs, and contractor agreements is a year-1 must; not built in this spec.

---

## 11. v4 backlog stub (do NOT implement)

- Invoice generation + dunning + bank-rail integration.
- E-signature on contracts + NDAs.
- Pension / GOSI / WPS file generation.
- Slack signal ingestion for time capture.
- Real-time mobile native apps.
- Multi-entity statutory consolidation.
- "Bench planning" — when the firm is >15 staff, capacity vs. pipeline.
- Procurement-grade vendor onboarding (the inverse of partner-firm).
- ML-based DLP for the Salon.
- Client-side discovery agent inside the Salon (clients ask permission-scoped agents directly).

---

## 12. North star for v3 (paste into first system prompt)

> v3 is when AICo crosses from "two co-founders" to "a firm." The Roster makes every person — Employee, Contractor, Partner-Firm Resource — a first-class record with the right access and compliance. The Ledger turns hours into commercial truth: utilization, realization, and engagement profitability that the partners actually act on. The Wallet keeps the firm clean: every expense policy-checked, VAT-handled, and traceable to the client. Across all three, named agents — Steward, Concierge, Sentinel, Analyst, Auditor — do the preparation that two co-founders can no longer do by hand. Humans approve. The audit holds.

<<<REPLIT PROMPT ENDS>>>

---

## Appendix C — My suggested modifications to the brief (read before building)

These are additions / changes I'm proposing relative to your original v3 ask. Each one has a reason.

1. **Three worker types, not two.** Partner-Firm Resources are first-class. This matches AICo's "partner leverage" pillar from the website. Without them, the Roster doesn't reflect how the firm actually works.

2. **Branded names: The Roster / The Ledger / The Wallet.** Consistent with The Atelier / The Salon — artisanal, plural-firm voice, not "HR module / time module / expense module."

3. **AI-first timesheet capture.** Not just "an agent helps with time" — the agent drafts the whole day from signals (calendar + agent runs + meetings + deliverable edits + Salon activity), and the human confirms. Research shows 2–5 hours/week saved across the firm. The Time Steward is the highest-leverage agent in v3.

4. **Per-role utilization targets.** A flat 80% target is wrong for a senior-led firm. Partners doing BD and IP should target 50%; Principals 65%; Engineers 75%. The portal's utilization views must reflect this or they'll surface fake risk.

5. **Realization rate as a first-class metric.** Not in the brief. Added because realization is where consulting firms actually lose money — discounted hours, write-offs, scope creep. Tracking it weekly per Partner is uncomfortable but essential.

6. **Conflict of interest as a hard gate.** Most boutiques discover conflicts after the engagement is staffed. The Access Sentinel blocks; the Partner overrides. Architectural rule beats heroic memory.

7. **VAT and multi-currency as first-class.** GCC tax is unforgiving and AICo will operate in SAR, AED, and USD from day one. Getting this wrong creates year-2 cleanup costs that compound. The Wallet handles it natively.

8. **Compensation column policy-lock.** Not in the brief. Added because in a small firm, leakage of comp data corrodes trust faster than anything else. The data model treats it as PII.

9. **Strict offboarding sequence.** Boutiques are casual about leaving; the consequences (client poaching, IP walking, audit gaps) are not. The Offboarding Sentinel is the discipline.

10. **Partner economics as a placeholder.** The Employee table carries an optional `partner_economics` row because Partners are paid on profit share, not salary, and the data model needs to support that without a v4 rewrite.

11. **Client-billable expense as a real gate.** Not just a checkbox. The Publish Sentinel (from v2) reaches into v3 — does the client even see this category on their contract? Does the markup match what they agreed?

12. **GCC compliance hooks as stubs, not silence.** Visa / Iqama / Saudization / WPS / DIFC / ADGM are real; v3 surfaces them as data, even if filings remain manual. The portal's job is to flag the deadline, not to file the return.

---

*End of v3 PRD. To extend to v4, prompt Claude with: "Continue from v3 PRD — generate v4 spec covering [areas]." The v4 backlog at §11 is the agreed scope.*
