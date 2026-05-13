# Replit Build Prompt — AICo Employee Portal **v2: The CRM + The Salon**

**For:** AICo (working name "Maven AI" pending final brand decision) — boutique AI advisory & engineering firm, GCC.
**Authored by:** Mounir Ariss (Co-Founder) with Claude, May 12 2026.
**Builds on:** v1 PRD `replit-prompt-aico-employee-portal.md` (The Atelier). Read v1 first; v2 extends, does not replace.
**Status:** v2 PRD — extends The Atelier with (1) a full CRM (clients, opportunities, sales lifecycle, pricing, win/loss, reporting) and (2) **The Salon** — the branded client-facing collaboration workspace. A v3 PRD covering People / Time / Expense is in `replit-prompt-aico-employee-portal-v3.md`.
**Pitch in one line:** The Atelier is where the work is made. The Salon is where the work is shaped with the client. Both are run by named agents.

---

## How to use this document

Paste everything below the line `<<<REPLIT PROMPT BEGINS>>>` into Replit's AI Agent / "Build an App" prompt **on the same repo that hosts v1**. The agent will extend the existing Atelier app — new routes, new tables, new agents — without breaking v1's modules.

**Pre-conditions (must be true before pasting):**
- v1 is shipped and passing its acceptance criteria.
- The same `org_id` row-level security model is in place.
- The `agents`, `agent_runs`, `audit_events`, and `accounts` tables exist.

**Defaults inherited from v1:**
- Brand system (deep navy + gold, Manrope + Fraunces + JetBrains Mono).
- Tech stack (Next.js 14, TypeScript, Tailwind, shadcn/ui, Vercel AI SDK, Drizzle, Postgres, Replit Auth / Clerk, Inngest, Claude as primary LLM).
- Principles (agents prepare, humans commit; show the work; source-grounded; partner authority lock; audit-first).

**New defaults introduced in v2:**
- CRM is the AICo system of record. External CRM (Salesforce/HubSpot) is one-way **export** only, behind a feature flag. No bidirectional sync in v2.
- The Salon is a separate Next.js route group with its own auth realm (client users, NOT AICo employees). Same monorepo; different tenant boundary at the row level.
- Identity for Salon users: SSO via SAML / OIDC (client IdP), Microsoft, or Google. Email-link fallback for small clients without IdP.
- File storage: same Replit Object Storage / Box. New "publishing rights" object enforces who can see what.
- Branding: The Salon can be co-branded with the client logo, but the AICo brand frame is fixed. Configurable per engagement.

---

## Important context for the Replit agent — what this branded name decision means

**"The Salon"** is the new branded name for the client-facing workspace. The choice is deliberate:

- **The Atelier** (v1) = the *workshop* — private, where AICo's craftspeople make the work.
- **The Salon** (v2) = the *gathering room* — shared, where AICo and the client *shape the work together*.

In 19th-century France, a salon was where artists, patrons, and intellectuals met to debate and refine ideas — exactly the metaphor for a senior-led consulting engagement. The pairing reinforces AICo's positioning: artisanal, senior, intellectual, collaborative.

A single engagement has one Atelier workspace (internal) and **may** have one Salon workspace (external) — Partner toggles this on per engagement.

---

<<<REPLIT PROMPT BEGINS>>>

# Project: AICo Employee Portal — v2 (CRM + The Salon)

You are extending the AICo Atelier app (from v1) with two major capability sets:

1. **The CRM** — full pipeline, account, deal, pricing, win/loss, and reporting capabilities. Replaces the lightweight opportunity-only model in v1.
2. **The Salon** — the client-facing collaboration workspace. A separate auth realm in the same repo. Co-branded with the client.

Every new module must follow v1's non-negotiable principles (agents prepare, humans commit; show the work; source-grounded; partner authority lock; immutable audit). Reuse v1's shell, agent runtime, brand system, and data model.

---

## 0. Non-negotiable principles (additions to v1)

1. **CRM data is sacred.** Forecast accuracy matters for partnership decisions and for any future investor conversation. Every stage transition is logged with reason and weighted-probability calibration. Agents cannot silently advance a stage.
2. **Pricing has a margin floor.** Every proposal that goes to a client must clear a configured target margin or the system requires a named Partner override. The Pricing Strategist agent must surface the margin before submission.
3. **Win/Loss is mandatory, not optional.** Every closed opportunity (won OR lost OR no-decision) triggers a debrief flow. Closing without debrief is permitted only with a Partner override + rationale. Lessons feed back into win-theme libraries.
4. **The Salon is the client's house.** No AICo-internal data leaks. Only artifacts explicitly marked "publish to Salon" become visible. The Salon never shows agent activity from the Atelier side — clients see polished output, not the workshop.
5. **Bilingual is real in The Salon.** Arabic is a first-class language in the Salon UI and for client-visible content (KSA government clients require this). The Atelier remains EN-default; the Salon defaults to the client's preferred language.
6. **Co-branding is configurable, not loose.** Each Salon workspace can carry the client logo + accent color, but the AICo navy + gold + typography frame is fixed. No skin that hides "Powered by AICo."
7. **Watermarking and access control are first-class.** Every Salon document carries a per-user watermark (name + email + timestamp). Download permissions are per-document. Screenshot warnings are rendered for export-restricted docs. Access expires on engagement-end + 90 days unless extended.
8. **The Salon has its own audit log, visible to the client.** Clients see a decision log of what they've approved, what they've rejected, what's pending. AICo sees a richer audit on the Atelier side; the two are linked.

---

## 1. New information architecture (additions to v1 routes)

### 1.1 Atelier (internal — adds to v1)

```
/crm                                → CRM home (replaces v1 /pipeline as the primary funnel surface)
  /accounts                         → Account list (table + map of org relationships)
  /accounts/[accountId]             → Account workspace (tabs below)
    /profile                        → Firm-shaped profile (industry, hierarchy, signals)
    /decision-makers                → Decision-maker map (org chart as data)
    /opportunities                  → All opps for this account (open + closed)
    /engagements                    → All engagements for this account
    /relationships                  → AICo team's relationship strength scoring
    /whitespace                     → Untapped offerings × buyer-personas grid
    /qbr                            → Quarterly Business Review canvas
    /audit                          → Account audit feed

  /opportunities                    → Pipeline (kanban + table + forecast)
    /opportunities/[oppId]          → Opportunity workspace (extends v1 with new tabs)
      /commercials                  → Pricing model, margin lock, alternative structures
      /forecast                     → Stage history, weighted value, probability calibration
      /win-loss                     → Debrief workspace (post-close)
      ...v1 tabs (brief, research, pov, proposal, meetings, artifacts, audit)

  /forecast                         → Roll-ups (by partner, offering, sector, quarter)
  /reports                          → Saved + ad-hoc reports
  /pricing                          → Rate cards + pricing rules + margin floors
  /win-loss                         → Win/loss library (all closed opps, themes, lessons)

/atelier                            → Knowledge Atelier (extended)
  /credentials                      → Now first-class (was stub in v1)
  /win-themes                       → Distilled themes from win/loss
```

### 1.2 The Salon (external — entirely new)

```
/salon                              → Salon landing (for a signed-in client user)
/salon/[engagementSlug]             → Single Salon workspace per engagement
  /overview                         → Engagement at a glance: objectives, status, next milestone
  /value                            → Value tracker (baseline → target → realized)
  /workplan                         → Visible portion of the workplan + milestones
  /deliverables                     → Deliverables shared with client + approval flow
  /deliverables/[id]                → Single deliverable viewer (co-authoring + approval)
  /decisions                        → Decision log visible to client
  /meetings                         → Shared meeting summaries + recordings
  /team                             → Who's on the engagement (named + role)
  /requests                         → Client raises requests / changes
  /settings                         → Client user mgmt (admin only)
```

Auth realm separation: routes under `/salon/*` require a `client_user` role. Routes elsewhere require an `aico_employee` role. The middleware enforces this strictly.

---

## 2. CRM — full functional spec

### 2.1 Accounts (clients)

Account is the firm AICo sells to (e.g., "Tasama"). An Account has zero or more Engagements and zero or more Opportunities. Accounts can have parent/child relationships (PIF → Tasama; Etihad Group → Etihad Engineering, etc.).

**Account record:**

```ts
Account {
  id, slug, name,
  legal_entity_name,
  parent_account_id?,           // hierarchy (PIF → Tasama)
  child_account_ids[],          // computed
  country,                      // 'KSA' | 'UAE' | 'GCC' | 'Other'
  sector,                       // 'Public Sector' | 'Telecom' | 'BFSI' | 'Real Estate' | ...
  size,                         // employee bands
  hq_city,
  primary_currency,             // SAR | AED | USD
  primary_language,             // 'en' | 'ar'
  tier,                         // 'A' (strategic) | 'B' (target) | 'C' (transactional) | 'D' (do-not-pursue)
  status,                       // 'active' | 'dormant' | 'do_not_pursue'
  partner_owner_id,             // FK → users (the AICo Partner owning this account)
  relationship_strength,        // 0–10 (computed from decision_maker scores + last_contact)
  enriched_at, source_signals_jsonb,
  ...standard fields
}
```

The **Account Cartographer** agent (see §6) maintains the org map, decision-maker list, recent news, and computed relationship strength.

**Account Profile tab** renders: firm snapshot, latest news (citation-bound), strategic priorities (citation-bound), AICo's hypothesis about where to play, comparable AICo work.

### 2.2 Contacts and decision-maker map

```ts
Contact {
  id, account_id, full_name, role, seniority,
  email, phone, linkedin_url,
  buyer_persona,                // 'CEO' | 'COO' | 'CIO' | 'CDO' | 'CXO' | 'business_head' | 'procurement' | 'technical_evaluator'
  influence_score,              // 1–5
  disposition,                  // 'champion' | 'supporter' | 'neutral' | 'skeptic' | 'blocker' | 'unknown'
  last_contact_at,
  contact_owner_id,             // who in AICo owns this relationship
  notes,
  org_relationships_jsonb       // [{contactId, type: 'reports_to'|'partners_with'|'blocks'}]
}
```

The **Decision-Makers tab** renders an org chart (graph view) with disposition color-coded. Champion / supporter = gold, neutral = mute, skeptic / blocker = danger. The Account Cartographer keeps this up to date and proposes additions when LinkedIn / news mentions surface new names.

### 2.3 Opportunities — extended sales lifecycle

The v1 opportunity model is replaced. The v2 lifecycle is finer-grained for CRM hygiene, while still respecting AICo's lean, senior-led pace.

**Sales stages (10 stages, mapped to the 6 PLM gates):**

| # | Stage | Stage % (default) | PLM stage | Exit criteria |
|---|---|---|---|---|
| 1 | Lead | 5% | Identify | Account + buyer hypothesis logged; AICo Partner-of-account named |
| 2 | Qualified | 15% | Identify→Shape | 5C Qualify verdict GO; budget hypothesis logged |
| 3 | Discovery scheduled | 25% | Shape | Discovery meeting on calendar; pre-meeting brief prepped |
| 4 | POV in flight | 35% | Shape | POV draft v1 reviewed; client engagement signals positive |
| 5 | Proposal in flight | 50% | Pursue | Proposal scoped; pricing approved by Partner |
| 6 | Submitted | 65% | Pursue | Proposal delivered; clarification window underway |
| 7 | Verbal commit | 80% | Pursue→Mobilize | Client verbal accept; legal terms in draft |
| 8 | Signed | 100% (won) | Mobilize | LOI / SOW signed; charter underway |
| 9 | Lost / No-decision | 0% (closed) | — | Client decision negative or stalled past threshold |
| 10 | Withdrawn (no-go) | 0% (closed) | — | AICo internal withdrawal with documented reason |

The stage **% default** is editable per opportunity (Partner can recalibrate). The **Pipeline Forecaster** agent (see §6) flags opportunities where stage % feels miscalibrated based on signals (e.g., 65% submitted but no client touch in 21 days → suggest 35%).

**Stage transitions are first-class events:**

```ts
OpportunityStageTransition {
  id, opportunity_id, from_stage, to_stage,
  transitioned_by_user_id, ts,
  rationale_text, evidence_artifact_ids[],
  prior_probability_pct, new_probability_pct,
  next_milestone, next_milestone_date,
  agent_recommended bool,           // did an agent suggest this?
  partner_override bool             // did a Partner override an agent's flag?
}
```

The opportunity workspace has a prominent **stage history strip** rendered as a timeline, with rationale tooltips.

### 2.4 Pricing — rate cards, deal pricing, margin lock

**Rate cards** (firm-wide, with overrides):

```ts
RateCard {
  id, name, status,            // 'draft' | 'active' | 'archived'
  geography, currency,
  effective_from, effective_to,
  rows[]: { role, seniority, day_rate_internal_cost, day_rate_client_price, overhead_pct }
  source_url?                   // for the "we calibrated to McKinsey 2025 KSA" memory
}
```

AICo's seniority bands: Partner, Principal, Subject-Matter Lead, AI Engineer, Designer, Analyst. (No "Associate"; this is a senior-led firm.) Each band has a day rate per geography.

**Deal pricing (per opportunity):**

```ts
DealPricing {
  id, opportunity_id,
  pricing_model,                // 'fixed_fee' | 'time_and_materials' | 'monthly_retainer' | 'outcome_based' | 'hybrid'
  duration_days, duration_weeks,
  team_mix_jsonb[]: { role, seniority, fte_pct, weeks }
  computed_cost_usd,
  computed_price_usd,
  computed_margin_pct,
  target_margin_pct,            // pulled from firm policy
  margin_lock_status,           // 'green' | 'amber' | 'red'
  partner_override_id?,         // if margin breached and Partner overrode
  alternative_structures_jsonb, // 'good / better / best' renderings
  pricing_strategist_brief_id   // FK → AgentRun
}
```

The **Commercials tab** of an opportunity renders a price-build view: team-mix table → computed cost → markup → price → margin chip. A "What if" panel lets the Partner change duration / mix / model and watches margin in real time.

**Margin lock policy:**
- Default target margin: 55% (boutique, senior-led; configurable in `/pricing` admin).
- Margin < target by 5pts → AMBER chip; Partner sign-off required to submit.
- Margin < target by 10pts → RED chip; Partner *and* second Partner sign-off required (two-Partner rule).
- The Pricing Strategist agent always proposes 2–3 alternative structures alongside the requested one.

### 2.5 Win/Loss analysis

Every closed opportunity (Won, Lost, No-Decision, Withdrawn) triggers a debrief flow within 14 days of close. The flow is mandatory; the system surfaces it in Atelier Home Pane A until completed.

**Debrief structure (research-backed — both buyer and seller perspective):**

```ts
WinLossDebrief {
  id, opportunity_id, outcome,
  status,                         // 'pending' | 'buyer_scheduled' | 'buyer_done' | 'seller_done' | 'synthesized' | 'closed'

  // Seller debrief (AICo team)
  seller_inputs[]: { user_id, role_on_deal, response_jsonb }
  seller_perceived_reasons[],

  // Buyer debrief (client interview by Win/Loss Interviewer agent or human)
  buyer_interview_scheduled_at,
  buyer_interview_conducted_by,   // agent_run_id OR user_id
  buyer_responses_jsonb,
  buyer_authentic_reasons[],

  // Synthesis
  hidden_competitor,              // 'direct' | 'partner_firm' | 'status_quo' | 'inhouse' | 'unknown'
  themes[],                       // tagged: 'pricing', 'capability_gap', 'relationship', 'timing', ...
  what_we_would_do_differently,
  lessons_to_atelier[],           // FK → atelier_assets (auto-promoted on Partner approve)
}
```

The **Win/Loss Interviewer agent** (see §6) drafts an interview script, runs the interview (live via Salon link, or async via async-video tool — async stub in v2), and produces the buyer reasons. Research-backed insight: **never have the deal owner conduct the buyer interview** — the agent provides the impartial third-party voice the research literature recommends.

**Win themes library** (`/win-loss` route) aggregates themes across closed deals — "we win on senior delivery (74% of wins)", "we lose to status quo more than to competitors (51% of losses)" — and feeds the Proposal Composer's win-theme insertion.

### 2.6 Forecasting & reporting

**Forecast roll-ups** (`/forecast`):

- By Partner-owner: pipeline value, weighted pipeline, gap-to-quota, win rate.
- By offering: agentic AI vs. legacy modernization vs. data foundations vs. AI product studio.
- By sector / country.
- By quarter (current + next 2 quarters).
- By stage (funnel view with conversion rates).

Each roll-up is rendered as a card with: total value, weighted value, count, change vs. last week, top 3 movers. Click into any card opens a drill-down table.

**Saved reports** (`/reports`): users can compose, save, and schedule reports. Pre-built templates:
- "Mounir's Monday morning" — weekly Partner roll-up.
- "Pipeline health" — stage age, stalled deals, missing next-milestone.
- "Margin watch" — opportunities with AMBER/RED margin.
- "Account heat map" — relationship strength × pipeline × revenue.
- "Win rate by offering, last 12 months."
- "Lessons in flight" — Atelier lessons not yet applied to live deals.

Reports are exportable to PDF (branded) and CSV. A Slack / email digest schedule is settable per user.

### 2.7 Quarterly Business Review (QBR)

Per Account (Tier A and B), a QBR canvas is auto-prepped quarterly by the **Account Cartographer**:
- Last quarter outcomes (engagements delivered, value realized, NPS-style score from Salon).
- Pipeline state.
- Strategic priorities (refreshed from client signals).
- Whitespace recommendations.
- Risks (relationship, delivery, commercial).
- Recommended Partner moves for the quarter ahead.

The QBR is rendered as a one-page PDF for the Partner's internal use, **not** shared with the client. (A separate, client-facing QBR is generated for The Salon — see §3.)

---

## 3. The Salon — full functional spec

### 3.1 Visual identity and frame

The Salon inherits the AICo brand (navy + gold + typography) and overlays:
- The client's logo top-left of the navigation, with a thin gold rule between it and the AICo wordmark.
- A configurable client accent color, used **only** for the right-side milestone progress rail and for client-action affordances (so "your turn" always feels client-coded).
- The eyebrow on every page reads `ENGAGEMENT · [Client Name] × AICo`.

Bilingual: the language toggle is top-right; the persisted user preference flips the entire layout RTL when Arabic is chosen.

### 3.2 Salon information architecture

Recall:

```
/salon                              → Client's portfolio (for users with access to multiple engagements)
/salon/[engagementSlug]/overview    → at-a-glance
.../value                           → value tracker
.../workplan                        → workplan + milestones (filtered to client-visible)
.../deliverables                    → deliverable list
.../deliverables/[id]               → single deliverable workspace
.../decisions                       → decision log
.../meetings                        → shared meeting summaries
.../team                            → engagement team
.../requests                        → client requests
.../settings                        → client admin only
```

### 3.3 Overview tab (the lobby)

The default landing for a client user. Renders four panes:

1. **Where we are** — current PLM stage (Mobilize / Deliver / Compound), days into the engagement, next milestone with date.
2. **What needs your attention** — list of items awaiting client approval, decision, or input. Top of mind; no more than 5 items.
3. **What's coming** — next 3 milestones with dates and the AICo person responsible.
4. **Value snapshot** — baseline → target → realized, one-line.

Bottom of overview: link to the latest weekly executive summary (auto-drafted by the **Engagement Curator** agent and Partner-signed before publication).

### 3.4 Value tab

Renders the engagement value case:
- Baseline (where the client started, with citation to the diagnostic).
- Target (committed in the SOW).
- Realized so far (with method shown — the **Value Case Tracker** agent's monthly readout).
- Forecast trajectory.

Client-readable. Every claim is sourced. No internal cost / margin data is exposed.

### 3.5 Deliverables tab and the approval flow

The center of the Salon. A list of all deliverables shared with the client, each with:
- Title, version, status (Draft → Under client review → Approved → Final), due date.
- A "Last update" stamp.
- Watermark badge (per-user dynamic watermark).
- Download permission state (View only / Download permitted / Download blocked + reason).

Click into a deliverable opens the **deliverable workspace**:

**Layout:**
- Center: the document, rendered inline (HTML and DOCX previewed via server-side conversion; PDFs rendered with PDF.js).
- Right rail: **comments** (anchored to text), **decisions requested**, **approval status**.
- Top: version selector with diff-against-previous.

**Co-authoring rights model:**
- AICo authors can edit until the deliverable is moved to "Under client review."
- Client reviewers can comment and request changes; they cannot edit the document body in v2 (live co-editing is v3+).
- An "Approve" button on the right rail is enabled for users with `approver` role for this deliverable; clicking requires a 1-line rationale; the system records the decision in the decision log and the audit.
- A "Request change" button captures the change ask, which posts back into the Atelier's deliverable workspace as a new task.

**The Approval Choreographer agent** (see §6) drives multi-step approval flows: for example, "Director reviews → Director signs off → CFO countersigns within 7 days." It surfaces nudges, escalations, and SLAs.

### 3.6 Decisions tab

A client-visible decision log:
- Every decision the client has made, who made it, when, with what rationale.
- Every decision *requested* of the client, with status and SLA.
- Filterable by status and decision-maker.

This is the client's audit log. It is a **subset** of the Atelier-side audit (AICo sees more, including agent activity).

### 3.7 Meetings tab

For every client meeting on the engagement, the Salon renders:
- Meeting title, date, attendees.
- Client-visible summary (Partner-approved, drafted by Meeting Scribe — uses the existing v1 agent).
- Decisions, action items (filtered to client-visible).
- Recording link (only if Partner has marked the recording client-shareable).

### 3.8 Team tab

The named AICo engagement team with photos, roles, bios, and primary contact channel (Salon message). The team list is **fixed at engagement start by the Partner**; changes require a re-publish. This matches AICo's positioning: "clients buy the people they meet."

### 3.9 Requests tab

The client can raise:
- A change request (scope / timing / deliverable).
- A new ask (often → new opportunity).
- A concern or risk.

Each request lands in the Atelier as a task on the Engagement Lead. Status visible to the client.

### 3.10 Salon settings (client admin only)

Client administrators (designated by the Partner at engagement start) can:
- Invite additional client users from the same domain (with `view` or `approver` role).
- Set per-user language preference.
- Set per-user notification preference.
- Request additional access (e.g., to a specific deliverable).

AICo retains the final approve on every client user invitation — the **Salon Concierge** agent (see §6) screens new invitations and surfaces them to the Engagement Lead for approval.

### 3.11 Salon access controls and security

- **SSO:** SAML 2.0 (Azure AD, Okta, Ping, Google Workspace, Microsoft Entra), OIDC. Email-link magic links for clients without SSO (rate-limited).
- **MFA:** Required for any client user with `approver` role. Optional for `view` role.
- **Watermark:** Every deliverable view rendered with a dynamic watermark: client user's name + email + timestamp + engagement code, at low-opacity diagonal across the document.
- **Download:** Per-deliverable permission. When blocked, attempting download shows an explanation card and creates a "Request copy" task on the Engagement Lead.
- **Screenshot warning:** On highly-restricted deliverables, a screenshot detection layer (best-effort on web) renders a warning toast and logs an attempted-screenshot event in the audit.
- **Session policy:** Idle timeout 30 minutes; absolute session 8 hours.
- **Access expiry:** Default access for a client user expires at engagement-end + 90 days. Partner can extend (logged).
- **IP allowlist (optional):** Per-engagement IP allowlist (for government clients that require it).
- **Geo-fencing (optional):** Per-engagement country restriction.
- **DLP-style content rules:** A configurable list of phrases (e.g., real ID numbers, real financial figures) is scanned on every publish; if matched, publishing is blocked until cleared. Run by the **Publish Sentinel** agent (see §6).

### 3.12 Salon notifications

Email + in-app + (optionally) WhatsApp for KSA / UAE clients (stub in v2, the channel is hard for compliance). Notification types:
- New deliverable for your review.
- Approval requested.
- Meeting summary ready.
- Decision recorded.
- Engagement weekly summary.

Notification cadence per user is configurable.

---

## 4. Data model (additions to v1)

All new tables carry `org_id` for tenant safety. Where a table is client-visible, it also carries `client_visibility` flags.

New tables / extensions:

- `accounts` (extended per §2.1)
- `contacts` (per §2.2)
- `contact_relationships` (graph edges)
- `opportunities` (extended; stage replaces v1 `plm_stage` as primary status; `plm_stage` is now derived)
- `opportunity_stage_transitions` (per §2.3)
- `rate_cards`, `rate_card_rows` (per §2.4)
- `deal_pricings` (per §2.4)
- `win_loss_debriefs` (per §2.5)
- `win_themes` (distilled themes; FK to debriefs)
- `account_qbrs` (per §2.7)
- `salon_workspaces` (one per engagement that has a Salon)
- `salon_users` (client users; distinct from `users`; FK to `accounts`)
- `salon_user_engagement_access` (many-to-many; roles: `viewer` | `approver` | `client_admin`)
- `deliverable_publishes` (records what was pushed from Atelier to Salon, by whom, when, with what watermark policy)
- `salon_decisions` (the client-visible decision log)
- `salon_requests` (client-raised requests, link back to Atelier tasks)
- `salon_notifications`
- `salon_audit_events` (Salon-specific, subset of the master audit; queryable by client)

The `deliverables` table from v1 gets two new columns: `latest_publish_id` (FK → `deliverable_publishes`) and `client_visibility` (`internal_only` | `published_view` | `published_download`).

### Forecast computation

A nightly Inngest job re-computes:
- Weighted pipeline per Partner / offering / sector / quarter.
- Stage-age flags.
- Margin watch flags.

Live drill-downs query directly from `opportunities` joined with `deal_pricings`.

---

## 5. Reporting — concrete v2 deliverables

Build the following pre-built reports:

1. **Pipeline by stage (waterfall)** — open ARR by stage, change vs. last week, conversion rates.
2. **Forecast roll-up by Partner** — best / commit / pipeline / gap-to-target.
3. **Margin watch** — list of open opps in AMBER/RED with the responsible Partner.
4. **Account heat map** — tile per Tier A/B account: relationship strength × open value × engagements live × recent contact.
5. **Win/loss rate by offering, last 4 quarters** — bar chart + table.
6. **Hidden competitor distribution** — bar chart of `hidden_competitor` from closed deals.
7. **Salon engagement health** — per active engagement: client satisfaction score (computed from approvals turnaround), open requests, days since last decision.
8. **Atelier reuse leaderboard** — top-reused assets, attributed to engagements.
9. **Senior-delivery proof** — % of hours on each engagement delivered by Partner / Principal seniority (against the "no bench-warming" promise).

Every report:
- Has a "Send to Slack / email" schedule.
- Exports to PDF (branded) and CSV.
- Carries a "View as of [date]" parameter so the Partner can produce historical comparisons.

---

## 6. New agents introduced in v2

Add the following to the agent registry. Implement the **★ starred** to full depth in v2; the rest as registered stubs.

Group | Agent | Stage | Purpose (one line)
---|---|---|---
**CRM** | Account Cartographer★ | All | Maintains account profile, decision-maker map, news signals, relationship strength.
**CRM** | Pipeline Forecaster | All | Re-computes weighted pipeline; flags stage-age and miscalibration; produces Partner roll-ups.
**CRM** | Pricing Strategist★ | Pursue | Builds the deal price model, surfaces margin, proposes 2–3 alternative structures, enforces margin lock.
**CRM** | Win/Loss Interviewer★ | Compound | Drafts interview script, runs client debrief, synthesizes seller + buyer perspectives.
**CRM** | Theme Curator | Compound, cross-cutting | Distills closed-deal debriefs into a refreshable Win Themes library; suggests insertions into open proposals.
**CRM** | Whitespace Mapper | All | For each Tier A/B account, surfaces untapped offerings × buyer-persona cells with rationale.
**CRM** | QBR Composer | Quarterly | Generates the internal QBR canvas and the client-facing QBR readout.
**Salon** | Salon Concierge★ | Mobilize→Deliver | Onboards a new client to a Salon: invitation flow, IdP setup, role assignment, watermark policy.
**Salon** | Engagement Curator★ | Deliver | Curates what's published to the Salon: weekly summary, deliverable framing, value snapshot updates.
**Salon** | Approval Choreographer★ | Deliver | Drives multi-step approval flows, SLAs, escalations.
**Salon** | Publish Sentinel★ | Deliver | Pre-publish DLP-style check on every Salon publish: redacts internal-only data, blocks on policy hits.
**Salon** | Feedback Distiller | Deliver | Synthesizes client comments + requests into structured insights for the engagement team.

### 6.1 Detailed specs — the v2 MVP 7 starred agents

Same Agent interface as v1 (see v1 §8.1). Below are the deep specs.

#### 6.1.1 Account Cartographer

- **Purpose:** Keep every Tier A and B account's profile, decision-maker map, news signals, and relationship strength current — so a Partner walks into any meeting with a 90-second brief.
- **Inputs:** `{ account_id, depth: 'refresh'|'deep', focus?: 'decision_makers'|'news'|'signals'|'all' }`
- **Output:** `{ profile_updates, decision_maker_updates[], news_signals[], strategic_priorities[], relationship_strength_score, recommended_partner_moves[], sources[] }` — citation-bound.
- **Tools:** `web_search`, `web_fetch`, `knowledge.search`, `linkedin.lookup`, `news.feed` (stub OK).
- **Schedule:** Refreshes every 72h for Tier A, every 7 days for Tier B, on-demand otherwise.
- **Guardrails:** Decision-maker personal data scoped to public sources only; no scraping of private platforms; relationship strength formula transparent and overridable by Partner.
- **Human checkpoints:** Decision-maker additions / disposition changes require Engagement Lead or Partner approval before merging.
- **Evals:** Tier-A seed set (Tasama, Dubai Municipality, DGE, Tahakom). Measure: % of named decision-makers Mounir would consider load-bearing; news-signal precision; partner-acceptance rate of recommendations.

#### 6.1.2 Pricing Strategist

- **Purpose:** Build the deal price model for an opportunity; surface margin against the firm floor; propose 2–3 alternative structures so the Partner can negotiate optionality.
- **Inputs:** `{ opportunity_id, primary_intent: { pricing_model, duration, team_mix }, target_margin_pct, alternative_lenses?: ['shorter_higher_seniority', 'outcome_based', 'phased', 'retainer'] }`
- **Output:** `{ primary_pricing, alternatives[]: { model, price, cost, margin, story }, margin_lock_chip, partner_override_required: bool, talking_points_for_partner[] }`
- **Tools:** `knowledge.search` (comparable deals), `pricing_rules.lookup`, `rate_card.read`.
- **Model:** Sonnet 4.6.
- **Guardrails:** Pricing always cites the active rate card; team_mix cannot include roles without active rate-card rows; margin computed deterministically (no LLM math for the final figure).
- **Human checkpoints:** Partner must confirm pricing before it lands in the proposal; if margin breaches floor, two-Partner rule kicks in.
- **Evals:** golden-deal set (Tasama BPO, DGE Effortless, Aldrees BOQ), measure: numerical accuracy, margin lock correctness, alternative-coverage.

#### 6.1.3 Win/Loss Interviewer

- **Purpose:** Conduct a debrief on every closed opportunity — drafting the script, running the buyer interview (or coaching a Partner to run it), and synthesizing the buyer + seller perspectives into authentic reasons and themes.
- **Inputs:** `{ opportunity_id, outcome, debrief_mode: 'agent_led_live'|'agent_led_async'|'partner_led_with_agent_support' }`
- **Output:** `{ buyer_interview_script, run_session_summary, buyer_authentic_reasons[], seller_responses_synthesized, hidden_competitor, themes[], what_we_would_do_differently[], suggested_atelier_lessons[] }`
- **Tools:** `meeting.schedule` (stub), `meeting.run_live` (v3 — async transcript ingest in v2), `knowledge.search`, `transcribe.audio`.
- **Model:** Sonnet 4.6.
- **Guardrails:** Buyer interview must be conducted by the agent or a Partner *not* on the deal team (research-backed objectivity rule). Themes must be evidence-bound to specific quotes or seller observations.
- **Human checkpoints:** Partner approves the synthesis before themes are pushed to the Win Themes library.
- **Evals:** golden debriefs; measure script quality, theme precision, partner-acceptance rate.

#### 6.1.4 Salon Concierge

- **Purpose:** Orchestrate the onboarding of a client into a Salon workspace — invitations, IdP / SSO setup, role assignment, watermark policy, language preference.
- **Inputs:** `{ engagement_id, client_admin_email, client_idp_kind?, additional_users_seed?: [{email, role}] }`
- **Output:** `{ salon_workspace_id, invitations_sent[], idp_setup_status, default_watermark_policy, default_language, audit_entries[] }`
- **Tools:** `email.send`, `sso.provision` (Replit Auth / Clerk's SSO API; stubs OK with realistic state), `knowledge.search` (prior client setups).
- **Model:** Haiku 4.5.
- **Guardrails:** No client user is provisioned without Engagement Lead approval; default role is `viewer` unless explicit otherwise; bilingual UI default = client's primary language.
- **Human checkpoints:** Engagement Lead approves each invitation batch.
- **Evals:** synthetic onboardings (Tasama Salon, DGE Salon); measure onboarding time, % of users active within 7 days.

#### 6.1.5 Engagement Curator

- **Purpose:** Curate what's published to the Salon week-by-week — weekly executive summary, value snapshot updates, deliverable framing for the client view.
- **Inputs:** `{ engagement_id, cadence: 'weekly'|'biweekly'|'on_demand', focus_themes?: [] }`
- **Output:** `{ weekly_summary_md, value_snapshot_update, deliverable_framings[]: { deliverable_id, framing_note }, recommended_publishes[] }`
- **Tools:** `knowledge.search` (engagement context), `file.read` (latest deliverable versions).
- **Model:** Sonnet 4.6; Opus 4.6 for high-stakes executive summaries (toggle).
- **Guardrails:** Never includes internal-only data; framings must be Partner-signed before publication; weekly summary written in client's primary language.
- **Human checkpoints:** Partner approves the weekly summary before it appears in the Salon.
- **Evals:** golden weekly summaries; measure tone (executive-readable), evidence coverage, partner-acceptance.

#### 6.1.6 Approval Choreographer

- **Purpose:** Drive multi-step client approval flows on deliverables — define approvers, sequence, SLAs, escalation rules; nudge stuck approvers; flag risks.
- **Inputs:** `{ deliverable_id, approval_chain[]: { role, required_approver_ids[], parallel_or_sequential, sla_days }, escalation_policy }`
- **Output:** `{ flow_state, current_step, blocked_on[], next_nudges_scheduled[], partner_alerts[] }`
- **Tools:** `notification.send`, `calendar.read` (stub), `knowledge.search` (prior flows for this client).
- **Model:** Haiku 4.5.
- **Guardrails:** Cannot send more than 2 nudges per approver without Engagement Lead consent; cannot escalate to client senior leadership without Partner consent.
- **Human checkpoints:** Engagement Lead defines the chain on first use; agent runs it autonomously thereafter with checkpoint events.
- **Evals:** simulated flows; measure on-time approval rate, false-nudge rate.

#### 6.1.7 Publish Sentinel

- **Purpose:** Final pre-publish check on every Salon publish. DLP-style content scan, watermark policy, download permission, language, branding compliance.
- **Inputs:** `{ deliverable_version_id, intended_visibility: 'view'|'download', client_id }`
- **Output:** `{ checks[]: { check_name, status: 'pass'|'warn'|'fail', detail, suggested_fix }, redactions_proposed[], publish_allowed: bool }`
- **Tools:** `dlp.scan` (rule-based in v2; ML-based in v3), `brand.check` (template diff), `knowledge.search` (client-specific terminology rules).
- **Model:** Haiku 4.5 for scans; Sonnet 4.6 for synthesis of fixes.
- **Guardrails:** Cannot let a deliverable publish if any check is `fail`; warns can be overridden by Partner with rationale.
- **Human checkpoints:** Engagement Lead reviews any warns; Partner reviews any failed checks.
- **Evals:** seeded deliverables with planted DLP traps; measure precision/recall.

### 6.2 Atelier-side agents that gain new capabilities in v2

- **Proposal Composer** — now pulls win themes from the Theme Curator and inserts them as positioning lines.
- **Meeting Scribe** — gains a `client_visible_summary` output mode used when the meeting is shared via the Salon.
- **Synthesis Critic** — now runs against the engagement's value case in addition to the hypothesis tree (does the deliverable advance the value commitment?).
- **Pursuit Scout** — now writes its enrichment back to the Account Profile (governed by Account Cartographer's approval).

---

## 7. MVP scope for v2 (what ships)

### 7.1 Modules in v2 MVP

1. **CRM Accounts module** (account profiles, decision-maker map, account workspace).
2. **CRM Opportunities module** (extended lifecycle, stage transitions, commercials tab, win/loss tab).
3. **Pricing module** (rate cards, deal pricing, margin lock, alternative structures).
4. **Win/Loss debrief flow** (full, including agent-led buyer interview from uploaded transcript).
5. **Forecast and reporting** (the 9 pre-built reports).
6. **The Salon** (full functional spec above for the seeded engagement — Tasama Agentic BPO).
7. **v2 agents** — 7 starred to full depth + remaining 5 as registered stubs.

### 7.2 Seed data the v2 build must add

- **Rate card:** "AICo 2026 KSA + UAE v1" with the 6 seniority bands and realistic day rates.
- **Margin policy:** target margin 55%, AMBER threshold 50%, RED threshold 45%.
- **Opportunities at every stage:** at least 10 spread across all 10 stages, including 2 won, 1 lost, 1 no-decision (debriefs pre-seeded).
- **Salon for Tasama Agentic BPO:** 3 client users (1 admin, 1 approver, 1 viewer), 4 published deliverables in different states, 6 decisions logged, 2 open requests.
- **Win themes seeded:** 6 distilled themes from prior context (senior delivery, speed to value, pricing wedge, partner leverage, agentic-native, GCC-context).

### 7.3 Acceptance criteria for v2 MVP (must all be true to ship)

A reviewer should be able to:

1. Open an Account (Tasama), see a populated decision-maker map with disposition colors, click a name to open their LinkedIn-cited profile.
2. Move an Opportunity from "Discovery scheduled" to "POV in flight" and see (a) the stage transition logged with rationale, (b) the probability % updated, (c) the audit row.
3. Build a deal pricing in the Commercials tab; see the margin chip turn AMBER as duration shortens; receive 3 alternative structures from the Pricing Strategist within 90 seconds.
4. Submit a proposal and have the system block on "Margin AMBER — Partner sign-off required"; sign off, see the proposal advance to Submitted stage, audit logged.
5. Close an opportunity as Lost; receive the debrief flow on the home pane; complete a seller debrief; upload a buyer transcript; receive the synthesized themes from the Win/Loss Interviewer; approve; see the themes land in the Win Themes library and become visible to the Proposal Composer.
6. Open `/forecast` and see roll-ups by Partner, offering, and quarter with at least 3 movers per card.
7. Open `/salon/tasama-agentic-bpo` (as a seeded client user via persona switcher) and see the Overview, Value, Workplan, Deliverables, Decisions, Meetings, Team, and Requests tabs — every one populated.
8. Open a Salon deliverable, see a dynamic watermark with the persona's name + email + timestamp, attempt to download (blocked deliverable shows a "Request copy" card), click "Approve" with rationale, see the decision land in the Decisions tab and the Atelier audit.
9. Trigger the Publish Sentinel on a deliverable that contains a planted DLP trap ("test_real_id_pattern") and see the publish blocked with a redaction proposal.
10. Generate a scheduled report ("Mounir's Monday morning") and receive it in-app + by email + by Slack stub.

### 7.4 Non-functional requirements (v2 additions)

- **Salon performance:** First Salon load < 2s; deliverable open < 3s for typical 30-page DOCX rendered to HTML.
- **Salon availability target:** 99.9% (clients see this).
- **Tenant isolation:** Add per-engagement RLS in addition to per-org RLS; agent runs cannot cross-read engagements without an explicit Atelier promotion record.
- **Compliance posture:** SOC2-readiness controls toggled on (encryption at rest, encryption in transit, immutable audit, MFA enforcement for approvers).
- **GCC data residency:** Configurable Postgres region; default to UAE (Replit's closest region or a Neon UAE/EU region).
- **Localization:** AR / EN strings for all Salon UI; AR strings for client-visible Atelier-generated summaries.
- **Accessibility:** WCAG 2.2 AA enforced on Salon (clients may have a11y requirements written into procurement).

### 7.5 Out of scope for v2 (explicitly defer)

- Live co-editing of deliverables in the Salon (v3+).
- WhatsApp notification channel (compliance-heavy in GCC; stub only).
- Mobile native client apps (responsive web only).
- Salesforce / HubSpot bidirectional sync.
- ML-based DLP (rule-based only in v2).
- E-signature integration for SOWs (DocuSign / Signeasy is v3).
- Salon offline mode.

---

## 8. Data migration & backwards compatibility

The Replit agent must write Drizzle migrations that:

1. Extend `accounts` (new columns: `parent_account_id`, `tier`, `relationship_strength`, etc.) without breaking v1 reads.
2. Replace `opportunities.plm_stage` source-of-truth with a new `opportunities.sales_stage` column; derive `plm_stage` via a generated column. Seed migration sets `sales_stage` from current `plm_stage`.
3. Add the new tables (`contacts`, `rate_cards`, `deal_pricings`, `win_loss_debriefs`, `salon_*`, etc.).
4. Add new agents to the registry.
5. Preserve all v1 audit history.

The Replit agent should write idempotent migration scripts and a `seed_v2.sql` script.

---

## 9. Build order (suggested)

1. CRM Accounts module + Account Cartographer.
2. CRM Opportunities extension + stage history + Pipeline Forecaster.
3. Pricing module + Pricing Strategist + margin lock UI.
4. Win/Loss debrief flow + Win/Loss Interviewer + Theme Curator + Win Themes library.
5. Forecast + reports.
6. Salon shell (auth realm, brand frame, info architecture).
7. Salon deliverable workspace + Engagement Curator + Approval Choreographer.
8. Publish Sentinel + watermarking + download controls.
9. Salon Concierge + invitation flow + SSO setup.
10. Salon Decisions / Meetings / Team / Requests tabs.
11. Acceptance-criteria walkthrough; ship.

---

## 10. Open decisions for the founder (do not implement; surface as TODO)

1. The exact target margin for AICo (55% default in this spec).
2. Whether Tier A account QBRs are quarterly or every 6 months in year 1.
3. Whether the firm wants a "deal review" board (weekly Partner forum to review AMBER margins, stuck deals) — easy add but cultural choice.
4. Whether the Salon offers async-video updates (Loom-style) as a first-class channel — value is real for executives in different time zones, build cost is small.
5. Whether to enable a "client-side discovery agent" in v3 — letting clients ask questions to a permission-scoped agent inside the Salon.

---

## 11. v3 backlog stub (do NOT implement now)

The v3 PRD lives in `replit-prompt-aico-employee-portal-v3.md` and covers:
- Employee, contractor, and partner-firm records.
- Invitations + per-engagement access management to Atelier modules, Salon workspaces, and agents.
- Timesheet management (with AI-powered time capture).
- Expense management (with corporate card integration).
- Utilization analytics, partner economics, and engagement profitability.

---

## 12. North star for v2 (paste into first system prompt)

> The Atelier (v1) gave AICo a system to make the work with named agents. v2 makes that work *commercial* — a real CRM that respects the firm's lean, senior-led model — and *collaborative* — The Salon, where AICo and the client shape the work together. Every commercial decision is sourced and partner-signed. Every client interaction is governed, watermarked, and audited. Every closed deal teaches the firm something. The agents are not features; they're staff — Cartographer, Strategist, Interviewer, Concierge, Curator, Choreographer, Sentinel — each prepares, drafts, or watches a piece of the lifecycle. Humans always decide.

<<<REPLIT PROMPT ENDS>>>

---

## Appendix B — My suggested modifications to the brief (read before building)

These are additions / changes I'm proposing relative to what was originally asked. Each one has a reason.

1. **The branded name: "The Salon."** You asked for a name consistent with The Atelier; the salon is the matching metaphor (artisans' workshop ↔ artists-and-patrons salon). The naming choice reinforces senior-led positioning — clients don't enter a "customer portal," they walk into a salon.

2. **Standalone CRM with one-way export only.** You signaled this with the clarifying answer. The cost is real: there is no soft fallback if Maven Insights / BGTS later mandates Salesforce. I'd hold this line because the discipline matters more than the integration.

3. **Margin lock and two-Partner rule.** Not in the brief. Added because in a senior-led boutique, margin erosion is the single biggest year-1 risk and the partnership economics require it. The two-Partner rule on deep discounts protects the partnership from a single Partner accommodating a client at a margin neither would accept on reflection.

4. **Mandatory win/loss with agent-led buyer interview.** Not in the brief. Added because the research evidence is unambiguous: 60% of sellers are wrong about why they lost; the buyer interview reveals it; the deal owner is the wrong person to ask. The agent solves the impartial-third-party problem at boutique scale.

5. **Decision log as a first-class client surface.** Added because the most common late-engagement complaint at every firm I've worked at is "I don't know what we decided and what's pending." Exposing a clean decision log to the client is differentiated and forces hygiene inside AICo.

6. **Watermarking, download permission per-deliverable, and access expiry.** Heavier than typical boutique portals. Added because government clients in KSA and UAE will require it and because it lets AICo charge confidently for genuinely sensitive work.

7. **Bilingual at parity in the Salon.** Added because the KSA government CX context (DGE, Tahakom, Tasama) demands Arabic as a first-class language for client-visible outputs.

8. **QBR as a portal-native artifact.** Added because in a senior-led firm, the QBR canvas is the partner's quarterly preparation document; producing it manually is a tax that kills account development time. The agent prepares; the Partner edits.

9. **The Whitespace Mapper.** Added because the firm's economics depend on land-and-expand. A surface that shows where each Tier-A account has untapped offerings × buyer-personas is the discipline that converts a client into a portfolio.

10. **Senior-delivery proof as a report.** Added because the website promises "Senior partners on every engagement. No bench-warming." That promise needs to be measurable, and the report makes it auditable to the client when they ask "who's actually on this work?"

---

*End of v2 PRD. The v3 PRD covers People, Time, and Expense — see `replit-prompt-aico-employee-portal-v3.md`.*
