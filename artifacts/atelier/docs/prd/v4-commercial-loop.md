# Cognirise Portal v4 — Commercial Loop

> Product Requirements Document. Scope: close the firm's commercial loop
> (sign → invoice → collect → renew), surface engagement risk before it
> becomes loss, build the reference flywheel, and connect the portal to
> the email/calendar backbone so agents see the real work.
>
> This v4 PRD incorporates the gap-analysis doc *and* the conflict
> resolutions from the prior planning review. Where the gap-analysis
> doc proposed a new agent that duplicated an existing one, this PRD
> extends the existing agent instead.

## 1. What & Why

The firm has, through v1–v3, built the **Atelier** (knowledge,
agents, deliverables), the **Pipeline / CRM** (opportunities and
accounts), the **Ledger** (time), and the **Wallet** (expenses).
What it does not yet have is a **closed commercial loop**: signed
instruments, issued invoices, collected cash, recognised revenue,
forecasted runway, and a continuous read on whether the engagement
itself is healthy enough to renew.

v4 closes that loop, and connects the portal to the firm's
**email/calendar backbone** so that the agents already in production
(Time Steward, Account Cartographer, RAID Watchdog, Burn Sentinel)
ingest the real work surface instead of a thin facsimile of it.

## 2. Done looks like

- A Partner can draft an SOW from an opportunity, send it for
  e-signature, and see the signed instrument bound to the engagement
  — without leaving the portal.
- A Partner can issue a ZATCA-compliant invoice from logged time +
  expenses, watch AR aging, and see the dunning cadence the agent has
  scheduled.
- A 12-week cash flow forecast is visible to Partners with the next
  cash gap named.
- Every active engagement shows a single Health score
  (GREEN / AMBER / RED) with the dominant risk vector named, refreshed
  daily.
- A new top-level **Firm Health Map** at `/health` lists every active
  engagement as a tile.
- Clients see a 30-second monthly micro-pulse in the Salon (with a
  Partner-level kill switch per engagement).
- Closed engagements trigger an agent-orchestrated NPS + reference-
  capture flow.
- Google Workspace **and** Microsoft 365 mail/calendar are connected;
  the Time Steward, Account Cartographer, and Engagement Health
  Sentinel ingest those signals through one pipeline.

## 3. Out of scope (deferred to v5 or later)

- The Press (thought-leadership pipeline)
- The Studio (talent acquisition)
- The Guardhouse (SOC2 program)
- IP catalog deepening
- The Boardroom (board pack workflow)
- WhatsApp Business, Slack/Teams DM ingestion (stub only in v4)
- Async-video reference interviews (live/scheduled only in v4)

## 4. Conflict resolutions adopted (vs. raw v4 gap-analysis doc)

1. **Engagement Health Sentinel** is built as an **extension of Burn
   Sentinel + RAID Watchdog**, not a parallel agent. One health
   signal per engagement.
2. **Reference Interviewer** is a **second mode of the existing
   Win/Loss Interviewer**, not a new agent. Same evidence-binding
   pattern.
3. **Firm Health Map** mounts at **`/health`** (top level), not
   `/atelier/health`. `/atelier/*` stays the Knowledge Atelier.
4. **The Atelier index** gets a "Firm Health" tile only if/when the
   app shell defines an explicit Firm Home; otherwise the tile lives
   on the Firm Home / dashboard route, not on Knowledge Atelier
   index.
5. **Comms ingestion is one pipeline** (Comms Indexer) feeding the
   Time Steward, Account Cartographer, and Engagement Health
   Sentinel. No parallel ingestion paths.
6. **Internal Two-Partner Countersign gate must clear before E-Sign
   Orchestrator can dispatch** an external signing envelope. Encoded
   as a state machine on the contract instrument.
7. **Engagement Health Sentinel runs as a cost-capped daemon** but
   writes a run-log entry per execution to preserve the existing
   evidence-binding contract. No "invisible" agents.
8. **Pulse-in-Salon** ships behind a per-engagement Partner toggle
   (default ON for new engagements, OFF for in-flight). Salon's
   identity stays decision/request-first; pulse is a footer surface,
   not a takeover.
9. **Reference catalog** is a **view onto Win Themes** filtered by
   client-consent state — not a parallel registry.
10. **Predictive agents** (Cash Flow Forecaster, Tax Sentinel, Health
    Sentinel) bind to **input-evidence** (the data snapshot they ran
    on) rather than output-evidence, preserving the audit chain.
11. **CRM and Pipeline routes are not renamed in v4.** Naming
    inconsistency is acknowledged and deferred.

## 5. Open decisions baked in

Defaults below; flip in implementation if the user objects.

1. **Signing platform:** DocuSign primary, Tabellio adapter for KSA-
   mandated signing. Adobe Sign deferred.
2. **Accounting backbone:** Xero (DIFC-friendly, strong API).
   QuickBooks adapter deferred.
3. **Email/calendar:** Google Workspace + Microsoft 365 both in v4
   (founders run mixed stacks).
4. **Pulse cadence:** monthly micro + end-of-engagement NPS. Per-
   engagement Partner kill switch.
5. **Reference interview format:** scheduled live (v4); async-video
   deferred to v5.
6. **WhatsApp Business:** stub only in v4; full build in v5.
7. **Health Sentinel:** daemon, cost-capped per engagement,
   run-logged.

## 6. Steps

### A. The Codex (Contract Lifecycle)

1. **Codex data model & route** — Build `/codex` as the contract
   instrument workspace. Counterparty registry (clients, partner
   firms, contractors with KYC state), instrument types (MSA, SOW,
   NDA, DPA, change order, side letter), version chain, and per-
   engagement contract chain (which MSA governs which SOW; which
   DPA covers which dataset). Insurance certificates registry.
2. **Contract Composer agent** — Drafts SOW / MSA / NDA / DPA /
   change orders from versioned templates + opportunity context.
   Cites clauses the client has accepted before. Evidence-bound to
   the opportunity snapshot.
3. **Redline Analyst agent** — Ingests a client-returned redline;
   produces a clause-by-clause diff with risk commentary tied to the
   firm's clause library.
4. **E-Sign Orchestrator agent** — DocuSign (default) + Tabellio
   (KSA) adapters. Multi-party signing sequence, reminders,
   archive. **Gated on Two-Partner Countersign clearing first.**
5. **Renewal Watchdog agent** — 90 / 60 / 30-day expiry watcher;
   drafts renewal options. Surfaces to the Partner cockpit.
6. **DPA Sentinel agent** — Flags any engagement with regulated data
   that lacks an active DPA; blocks ingestion until cleared.

### B. The Treasury (Finance loop)

7. **Treasury data model & route** — Build `/treasury` with: invoice
   register, AR aging by client / engagement / responsible Partner,
   dunning queue, cash flow forecast workspace, revenue-recognition
   rules per engagement, engagement P&L view, firm P&L by month /
   quarter / sector / offering, corporate tax (UAE CT) + KSA Zakat
   tracking.
8. **Invoice line drafts bridge** — Build the Wallet → Treasury
   handoff that v3 implied but never shipped: line drafts from
   Ledger (time) + Wallet (expenses) become invoice candidates.
9. **Invoice Builder agent** — Generates jurisdiction-correct
   e-invoices: ZATCA Phase-2 for KSA, FTA e-invoicing (when
   mandated) for UAE, plain PDF elsewhere. Xero handoff.
10. **Collections Concierge agent** — Schedules and drafts the
    dunning cadence (polite → firm → escalation), Partner sign-off
    required before send. Flags AR risk on the responsible Partner's
    cockpit.
11. **Revenue Recognizer agent** — Applies engagement revenue rules
    (fixed-fee milestones, T&M monthly, outcome-based on event);
    produces month-end accruals.
12. **Cash Flow Forecaster agent** — Rolling 12-week forecast with
    sensitivity ranges; names the next cash gap. Input-evidence-
    bound to the AR + AP + payroll snapshot.
13. **Tax Sentinel agent** — Watches VAT returns, UAE CT, KSA Zakat,
    DIFC / ADGM nuances; surfaces deadlines. Filings remain
    accountant-led.

### C. Engagement Health (extends The Atelier)

14. **Health signal aggregator** — Extends Burn Sentinel and RAID
    Watchdog to ingest 12+ signals: cadence drop, missed milestone,
    RAID-AMBER, Synthesis-RED, low Salon activity, late approvals,
    declining client meeting frequency, deliverable cycle time,
    agent-run failure rate, expense burn vs. plan, hours burn vs.
    plan, Pulse signals. Produces a single per-engagement health
    score + dominant risk vector + recommended Partner move.
15. **Engagement Health tab** — On every engagement page, a Health
    tab with score, trend line, signal breakdown, and the
    Sentinel's narrative.
16. **Firm Health Map** — New top-level `/health` route. Tile per
    active engagement, color-coded GREEN / AMBER / RED, sortable by
    responsible Partner, sector, or score delta.
17. **Daemon scheduler with run-log** — Cost-capped daemon scheduler
    that runs the Health Sentinel daily per engagement and writes a
    run-log entry every execution.

### D. The Pulse (Voice of Client)

18. **Pulse data model** — Per-engagement pulse responses, NPS
    scores, reference state, consent versions and scope.
19. **Salon pulse footer** — 1-question + 1-free-text micro-pulse in
    the Salon, rendered as a footer surface (not a takeover). Per-
    engagement Partner toggle, default ON for new engagements.
20. **End-of-engagement NPS + reference flow** — Triggered on
    engagement closure. Sends NPS, on positive response triggers the
    Reference Interviewer.
21. **Win/Loss Interviewer — Reference mode** — Extends the existing
    agent with a second mode for positive-engagement reference
    interviews (scheduled live in v4). Produces a credential draft
    and a public-facing testimonial draft. Same evidence-binding
    pattern as Win/Loss mode.
22. **Pulse Listener agent** — Synthesizes Salon sentiment + pulse +
    NPS into the per-engagement health signal that feeds the
    Engagement Health Sentinel.
23. **Consent Steward agent** — Manages whether the firm can name a
    client publicly; tracks consent versions and scope. Enforces
    consent state on the reference catalog.
24. **Reference catalog view** — A filtered view of
    `/atelier/win-themes` that shows entries with active client
    consent. Not a parallel registry.

### E. Communications Backbone

25. **Comms ingestion pipeline** — One ingestion service for Google
    Workspace mail / calendar and Microsoft 365 mail / calendar.
    OAuth consent surfaces per user. WhatsApp Business stubbed.
26. **Comms Indexer agent** — Ingests email / calendar threads,
    links them to opportunities / engagements / accounts. Sole
    upstream for downstream agents (no parallel ingestion).
27. **Time Steward extension** — Consume calendar via Comms Indexer
    rather than a private connector.
28. **Account Cartographer extension** — Auto-ingest Comms Indexer
    signals into account history.
29. **Email Composer agent** — Drafts client emails in the
    responsible Partner's voice with engagement context. Send-on-
    behalf gated on Partner approval.
30. **Calendar Choreographer agent** — Proposes / books / reschedules
    client meetings respecting time zones and conflicts.
31. **Access Sentinel extension** — Extend the existing audit-
    contract layer to cover the new sensitive-data classes (mail
    bodies, calendar attendees, attachments). Per-user consent
    scopes; redaction of unconsented threads from cross-engagement
    views.

### F. Cross-cutting patches

32. **Synthesis Critic feedback loop** — Synthesis Critic ingests
    Pulse signals so deliverable-quality scores learn from client
    satisfaction.
33. **Atelier Curator reference harvest** — Treats reference
    interviews as first-class harvests; every reference becomes a
    credential candidate in `/atelier/credentials`.

## 7. Relevant files

- `artifacts/atelier`
- `artifacts/api-server`
- `artifacts/api-server/prompts`
- `artifacts/api-server/runner.ts`
