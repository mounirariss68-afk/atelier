# AICo Employee Portal — Gap Analysis + v4 / v5 Backlog

**For:** Mounir Ariss
**Authored:** May 12 2026
**Companion to:** v1 (`replit-prompt-aico-employee-portal.md` — The Atelier), v2 (`replit-prompt-aico-employee-portal-v2.md` — CRM + The Salon), v3 (`replit-prompt-aico-employee-portal-v3.md` — Roster / Ledger / Wallet).
**Purpose:** Honest stress-test of the v1–v3 portal design. Identifies what would make the system *operationally complete* for a senior-led GCC consulting firm scaling from 2 co-founders to 15–25 people over 24 months. Proposes the new modules, the agents needed, and a sequenced v4 / v5 plan.

---

## How to use this document

This is a planning brief, not a Replit prompt. After reviewing it, prompt me with **"Generate the v4 PRD"** to produce the next Replit-ready prompt covering the critical-gap items below. v5 can be drafted when v4 is in flight.

Items below are tagged by criticality:

- **🔴 Critical** — the firm cannot operate cleanly past ~$3M ARR without this. Belongs in v4.
- **🟡 Important** — needed before ~$8M ARR or before a SOC2 / enterprise procurement push. Belongs in v4 or v5.
- **🟢 Nice-to-have** — value is real but the firm can run without it for 12+ months. v5 or later.

---

## 1. What v1–v3 already covers

Before listing gaps, the audit-positive view: v1–v3 cover **opportunity-to-cash + delivery + knowledge + people-time-expense** end-to-end. That's already more functional surface than most boutique-stage firms ever build. Specifically:

- Opportunity, account, pricing, win/loss, forecasting, reporting (v2).
- Engagement charter, workplan, deliverables, processes, agents, audit (v1).
- Client-facing collaboration with watermarking and SSO (v2 — The Salon).
- People records across FTE, contractor, partner-firm, with access governance (v3 — The Roster).
- Timesheet capture + utilization + realization (v3 — The Ledger).
- Expense capture + policy + VAT + multi-currency (v3 — The Wallet).
- 45 named agents across the three versions.

That's the spine of the firm. The gaps below sit around it.

---

## 2. Material gaps — what's missing

### 2.1 Contract Lifecycle Management (CLM) — 🔴 Critical for v4

**Missing.** v3 references e-signature as a v4 stub but the firm has no system for the contract instrument family: MSAs, SOWs, NDAs, DPAs, change orders, contractor agreements, partner-firm master agreements, renewal contracts, side letters.

**Why it matters.** In GCC enterprise sales, the contract is the deal. Government clients especially are procurement-heavy. AICo will lose months per opportunity if SOWs are drafted in Word from scratch every time, and lose six-figure exposures if a DPA isn't on file when client data arrives.

**Proposed module — "The Codex"** (continuing the artisanal naming):
- MSA / SOW / NDA / DPA / change-order templates as versioned, parameterized instruments.
- Per-engagement contract chain: which MSA governs which SOW; which DPA covers which dataset.
- Redline tracking against the client's preferred terms.
- E-signature (DocuSign / Adobe Sign / Tabellio for KSA-compliant signing).
- Renewal calendar with proactive nudges (the **Renewal Watchdog** agent).
- Insurance certificates (general liability, professional indemnity, cyber).
- Counterparty registry — every client, partner firm, and contractor's legal entity, with KYC status.

**New agents needed:**
- **Contract Composer** — drafts SOW / MSA / NDA / DPA / change orders from templates + opportunity context, with citations to clauses the client has accepted before.
- **Redline Analyst** — reads a client-returned redline and produces a clause-by-clause diff with risk commentary (the most valuable agent in this set — saves a Partner 3–5h per contract).
- **E-Sign Orchestrator** — drives multi-party signing, sequence, reminders, archive.
- **Renewal Watchdog** — watches expiries 90 / 60 / 30 days out; drafts renewal options.
- **DPA Sentinel** — flags engagements with regulated data that lack an active DPA.

---

### 2.2 Full Finance Loop — 🔴 Critical for v4

**Missing.** v3 stops at "invoice line drafts." The firm has no surface for: actual invoice generation and dispatch, accounts receivable aging, collections/dunning, revenue recognition (especially for fixed-fee and outcome-based engagements), cash flow forecasting, corporate tax (UAE 9%, KSA Zakat 2.5%, plus the new GCC pillars), board / management accounts.

**Why it matters.** Every consulting firm's number-one financial pain is **realization on cash**: how much of what we thought we'd bill actually arrives in the bank, and when. A firm with 8-month payment terms from a KSA government client and 30-day terms with contractors goes cash-negative fast. Without dunning and AR aging surfaced to Partners, late payment becomes a year-end surprise rather than a managed lever.

**Proposed module — "The Treasury"**:
- Invoice generation from the line drafts in v3 (PDF + e-invoice in KSA's ZATCA format; UAE Federal Tax Authority's e-invoicing when mandated).
- AR aging by client, by engagement, with the responsible Partner attached.
- Dunning sequence — agent-drafted polite-then-firm follow-ups, scheduled with Partner sign-off.
- Cash flow forecast (12-week rolling): inflows from AR + outflows from contractor / partner-firm / payroll / opex.
- Revenue recognition rules — fixed-fee milestones, T&M monthly, outcome-based on event.
- Engagement profitability — combines v3 Ledger + Wallet + this module into a single P&L view per engagement.
- Firm-level P&L by month / quarter, by sector, by offering.
- Corporate tax (UAE CT) + KSA Zakat tracking (data; filings remain accountant-led).

**New agents needed:**
- **Invoice Builder** — finishes what v3's Invoice Composer started: produces e-compliant invoices in the right format per jurisdiction.
- **Collections Concierge** — schedules and drafts the dunning cadence; escalates politely; flags AR risk to the responsible Partner.
- **Revenue Recognizer** — applies the engagement's revenue rules; produces the month-end accruals.
- **Cash Flow Forecaster** — rolling 12-week forecast with sensitivity ranges; identifies the next cash gap before it hits.
- **Tax Sentinel** — watches VAT returns, corporate tax filings, and Zakat / DIFC / ADGM nuances; surfaces deadlines.

---

### 2.3 Engagement Health Intelligence — 🔴 Critical for v4

**Missing.** v1 has a RAID Watchdog and a Synthesis Critic. v3 has a Burn Sentinel. But no agent watches the **whole engagement** across signals to flag "this is going sideways" *before* the client says it. In a senior-led firm with 6–10 engagements running simultaneously, this is where Partner attention should be focused, and it's the highest-leverage agent function the portal could add.

**Why it matters.** The single most common cause of revenue loss in consulting isn't sales — it's **client-relationship erosion mid-engagement**: a missed milestone, an unanswered request in the Salon, a Synthesis Critic alert that wasn't acted on, a Pricing Strategist's burn flag, a contractor's late timesheets. Individually trivial; together a leading indicator of a save-or-lose moment. A multi-signal sentinel is what differentiates a senior-led firm with leverage from one that just has overworked Partners reading PowerPoint summaries.

**Proposed addition — extends The Atelier**:
- A new "Engagement Health" tab on every active engagement, with a single score and a trend line.
- A "Firm Health Map" view at `/atelier/health` — every active engagement as a tile, color-coded GREEN/AMBER/RED with the dominant risk vector named.

**New agent needed:**
- **Engagement Health Sentinel** — runs daily; ingests 12+ signals (cadence drop, missed milestone, RAID-AMBER, Synthesis-RED, low Salon activity, late approvals, declining client meeting frequency, deliverable cycle time, agent-run failure rate, expense burn vs. plan, hours burn vs. plan, NPS / pulse signals); produces a per-engagement narrative + risk score + recommended Partner move.

---

### 2.4 Voice of the Client — 🔴 Critical for v4

**Missing.** The Salon captures decisions and requests but never asks the client "how are we doing?" There's no NPS, no pulse, no end-of-engagement reference capture, no testimonial workflow. This is a glaring gap for a senior-led firm whose primary growth lever is **reference-led**.

**Why it matters.** Boutiques compete on reputation, and reputation is built on documented references. Without an explicit Voice-of-the-Client surface, the firm relies on memory and goodwill — fragile in year 1, fatal in year 3.

**Proposed addition** — new module **"The Pulse"** (cross-cutting; lives partly in The Atelier and partly in The Salon):
- Monthly micro-pulse in the Salon (1 question + 1 free-text, 30s to complete).
- End-of-engagement NPS + CSAT survey, agent-orchestrated.
- Quarterly reference-capture flow — after a positive engagement, a 15-minute interview with the client, transcribed, summarized, and converted into a credential.
- Reference catalog: which client can be referenced for which capability, with consent state.
- Sentiment trends from the Salon (comment tone, approval cycle time, request volume).

**New agents needed:**
- **Pulse Listener** — synthesizes Salon-side sentiment + pulse + NPS into per-engagement health signal (feeds the Engagement Health Sentinel).
- **Reference Interviewer** — runs the reference-capture interview (async-video or scheduled live), produces a credential draft + a public-facing testimonial.
- **Consent Steward** — manages whether the firm can name a client publicly; tracks consent versions and scope.

---

### 2.5 Thought Leadership / Marketing Pipeline — 🟡 Important (v4 or v5)

**Missing.** The public website mentions "Field notes from the work. No recycled trend pieces." The firm wants to publish to compete with Tier-1. But there's no pipeline from internal POVs / case studies → public articles, newsletters, LinkedIn posts, speaking pitches.

**Why it matters.** A senior-led boutique earns the right to charge premium rates by being visible. Visibility comes from publishing. Publishing dies first when Partners are busy. The portal can fix that.

**Proposed module — "The Press"**:
- Editorial calendar of in-flight content.
- POV → Public Article pipeline: a Synthesis Critic-cleared internal POV becomes a draft public article in the firm's voice.
- LinkedIn post composer (linked to a calendar of Partner posting cadence).
- Newsletter ("Field Notes") composer + distribution stub.
- Speaking opportunity tracker — events the firm targets, who's pitching, status.
- Press monitoring — mentions, sentiment, competitor coverage.

**New agents needed:**
- **Thought Leadership Editor** — turns an internal POV into a 1500–2000-word public article, mirroring the firm's voice from the website.
- **LinkedIn Composer** — drafts Partner posts from internal artifacts; respects each Partner's voice (Mounir's voice ≠ Gökhan's voice).
- **Field Notes Editor** — assembles the monthly newsletter from the Atelier's recent harvests.
- **Press Monitor** — daily mention scan + competitor coverage; produces a weekly digest.

---

### 2.6 Partner / Alliance Management — 🟡 Important (v4)

**Missing.** v3 has PartnerFirm records and seconded resources, but no surface for managing the *partnership* itself: joint pipeline with BGTS / Thoughtworks / Mobven / Prometa / MEXT, joint marketing, joint go-to-market, certification status (AWS, Azure, GCP, Anthropic, Databricks, Snowflake).

**Why it matters.** The fourth lever from the website is *partner leverage*. The firm's plan depends on partner-firm co-delivery and platform certifications. Without a partner CRM mirror to the client CRM, alliances drift.

**Proposed addition** — extends `/crm` and `/roster`:
- Partner-firm workspace (parallel to the Account workspace).
- Joint pipeline — opportunities AICo is pursuing with a partner firm, with split economics.
- Certifications register — every cloud + tooling partner certification AICo holds, with renewals.
- Joint marketing plan + asset library.

**New agents needed:**
- **Partner Cartographer** — parallel to Account Cartographer; tracks each partner firm's relationship strength, recent moves, joint pipeline.
- **Alliance Choreographer** — drives joint pursuits and joint deliveries; computes the split, manages the joint comms.
- **Certification Tracker** — watches platform certifications, surfaces who needs to recert, schedules the exam.

---

### 2.7 Talent Acquisition — 🟡 Important (v5)

**Missing.** v3 has The Roster for people who joined; nothing for sourcing, interviewing, offering. A senior-led firm needs to recruit Principals and SME Leads — scarce people. AICo will spend 6–12 months filling each.

**Why it matters.** The hiring funnel is fragmented if it lives in Mounir's inbox. Once the firm crosses 5 people, recruiting becomes its own pipeline that needs the same discipline as the sales pipeline.

**Proposed module — "The Studio"**:
- Candidate CRM (parallel structure to client CRM).
- Role definition + scorecard.
- Interview panel + structured kit + scorecard.
- Reference checks (agent-orchestrated async interviews).
- Offer composer.
- Internal referral tracker.

**New agents needed:**
- **Recruiting Sourcer** — scans LinkedIn / GitHub / industry signals for candidates fitting the role spec.
- **Interview Designer** — drafts panels, scorecards, take-home prompts (especially for AI Engineer roles).
- **Reference Caller** — runs async-video or scheduled live reference checks; produces a structured reference summary.
- **Offer Composer** — drafts the offer letter + the comp narrative (esp. partner economics).

---

### 2.8 Security, Compliance & Audit — 🟡 Important (v4 for the basics, v5 for the full SOC2 push)

**Missing.** The portal has immutable audit, watermarking, and RLS. But it doesn't run a **compliance program**: SOC2 evidence collection, GDPR / UAE PDPL data subject access requests, security incident response, vendor security assessments, penetration test results, backup verification, data classification policy enforcement.

**Why it matters.** Enterprise procurement in GCC (especially government and BFSI) increasingly demands SOC2 or ISO 27001. KSA's PDPL is in force. UAE's data protection law applies in DIFC. A firm that ships AI agents into regulated environments will face a vendor security assessment before year 2.

**Proposed module — "The Guardhouse"**:
- Control library mapped to SOC2 Type II + ISO 27001.
- Evidence collection automation (the agent pulls audit logs, access reviews, backup logs, training completions).
- Penetration test register + remediation tracker.
- Vendor security assessments (incoming — clients asking AICo; and outgoing — AICo assessing its own vendors).
- Incident register + post-mortem template.
- Data classification + retention policy enforcement.
- DSAR (Data Subject Access Request) intake + response workflow.

**New agents needed:**
- **Compliance Sentinel** — maintains control posture; auto-collects evidence; flags gaps.
- **Incident Responder** — runs the incident playbook; drafts the comms; preserves the audit chain.
- **DSAR Concierge** — drives the data subject access request response within statutory windows.
- **Backup Auditor** — verifies that backups are running and restorable; runs a quarterly restore drill.

---

### 2.9 IP & Asset Catalog (deeper than the Atelier) — 🟡 Important (v5)

**Missing.** v1's Atelier captures artifacts and prompts. It doesn't manage *code* IP: private GitHub / GitLab repos, open-source compliance, licensing of internal IP to client engagements, demo environments and their freshness.

**Why it matters.** AICo's value compounds through reusable IP. Without a registry, IP either gets lost in client repos (legal exposure) or gets re-built per engagement (margin loss).

**Proposed addition** — extends `/atelier/assets`:
- Code asset registry: every internal repo, with license, owner, used-in engagements.
- OSS compliance: every external dependency, with license and approval state.
- Demo environment registry: live demo URLs, what they show, who owns them, freshness state.
- IP licensing log — when AICo IP is granted to a client engagement, the grant is logged with scope.

**New agents needed:**
- **IP Steward** — tracks ownership, freshness, licensing of internal IP.
- **OSS Compliance Sentinel** — scans dependencies for license compatibility.
- **Demo Environment Curator** — keeps the demo URLs alive, fresh, and discoverable to the team.

---

### 2.10 Board / Investor / Partnership Governance — 🟡 Important (v4 or v5)

**Missing.** The 51 / 49 partnership structure (with Maven Insights / BGTS / UAE investor candidates) demands clean partnership governance: board pack generation, KPI dashboards for the partnership, cap table, shareholder communications, investor updates.

**Why it matters.** Once the 49% partner is on, monthly or quarterly governance becomes a contractual obligation. Without a Board Pack workflow, this becomes a Friday-night Mounir task.

**Proposed module — "The Boardroom"** (admin-restricted route):
- Cap table view.
- Board / partnership KPI dashboard (TCV, ARR, gross margin, utilization, win rate, NPS, runway).
- Board pack composer (monthly or quarterly).
- Shareholder communications template + distribution.

**New agents needed:**
- **Board Pack Composer** — assembles the monthly / quarterly board pack from CRM / Ledger / Wallet / Pulse signals.
- **KPI Choreographer** — defines, computes, and explains the firm's headline KPIs.
- **Shareholder Comms Writer** — drafts the monthly investor update in the Partner's voice.

---

### 2.11 Communications Backbone (Email / Calendar / Slack / WhatsApp) — 🟡 Important (v4)

**Missing.** v1–v3 mostly assume signals come from inside the portal. Real life: most client touch is over email, Teams / Slack, WhatsApp, and calendar. The portal needs bidirectional integration so the agents see the work.

**Why it matters.** The Time Steward, Engagement Health Sentinel, Account Cartographer, and Pulse Listener are all dramatically more useful when they can read the firm's email + calendar. Without these connectors, the portal is a self-contained world that misses 70% of the work.

**Proposed additions** (no new module — connectors and consent surfaces):
- Google Workspace + Microsoft 365 mail / calendar integration (read + send-on-behalf).
- Slack / Teams workspace integration (read public channels + DMs the user consents to share).
- WhatsApp Business integration (heavy in GCC client comms — compliance-scoped).
- Phone call integration (Aircall / Dialpad — optional; record / transcribe / log to CRM).

**New agents needed:**
- **Comms Indexer** — ingests email / calendar / chat threads, links them to opportunities / engagements / accounts.
- **Email Composer** — drafts client emails in the Partner's voice with context from the engagement.
- **Calendar Choreographer** — proposes / books / reschedules client meetings, respecting time zones and conflicts.

---

### 2.12 Knowledge Concierge → Full RAG-as-a-Service — 🟢 Nice-to-have (v5+)

**Already partially present** in v1. What's missing is the depth: enterprise-grade retrieval with re-ranking, structured + unstructured fusion, multi-hop reasoning across the Atelier + Ledger + Wallet + CRM + Codex. Will become important once the firm has 100+ engagements of memory and is responding to RFPs that draw across 5 years of context.

**New agents needed:**
- **Memory Cartographer** — re-organizes the Atelier's knowledge graph as the firm scales.
- **Cross-Module Retriever** — single retrieval surface over CRM + Ledger + Atelier + Codex + Press.

---

### 2.13 Operations Backbone (Vendor / Subscription / IT) — 🟢 Nice-to-have (v5+)

**Missing.** Vendor management (Anthropic, Replit, Pleo, Brex, Notion, Box, Slack), subscription tracking, IT asset tracking (laptops, phones, hardware tokens), procurement workflow.

Smaller value individually; useful around 15+ headcount.

---

### 2.14 Localization beyond AR — 🟢 Nice-to-have (v5+)

**Missing.** The portal supports EN / AR. Some GCC sub-markets and partner-firm collaborations may need TR (Gökhan + Turkish partners), FR (North Africa), even potentially HI / UR (subcontinent contractors). Defer until pulled by demand.

---

## 3. Consolidated new-agent catalog (gaps above)

If all gaps above were addressed, the firm gains the following new agents on top of the 45 already specced across v1–v3:

Module | Agent | Criticality
---|---|---
**The Codex (CLM)** | Contract Composer | 🔴
| Redline Analyst | 🔴
| E-Sign Orchestrator | 🔴
| Renewal Watchdog | 🔴
| DPA Sentinel | 🔴
**The Treasury (Finance)** | Invoice Builder | 🔴
| Collections Concierge | 🔴
| Revenue Recognizer | 🔴
| Cash Flow Forecaster | 🔴
| Tax Sentinel | 🔴
**Engagement Intelligence** | Engagement Health Sentinel | 🔴
**The Pulse (VoC)** | Pulse Listener | 🔴
| Reference Interviewer | 🔴
| Consent Steward | 🔴
**The Press (Marketing)** | Thought Leadership Editor | 🟡
| LinkedIn Composer | 🟡
| Field Notes Editor | 🟡
| Press Monitor | 🟡
**Partners / Alliances** | Partner Cartographer | 🟡
| Alliance Choreographer | 🟡
| Certification Tracker | 🟡
**The Studio (Talent)** | Recruiting Sourcer | 🟡
| Interview Designer | 🟡
| Reference Caller | 🟡
| Offer Composer | 🟡
**The Guardhouse (Compliance)** | Compliance Sentinel | 🟡
| Incident Responder | 🟡
| DSAR Concierge | 🟡
| Backup Auditor | 🟡
**IP / Asset Catalog** | IP Steward | 🟡
| OSS Compliance Sentinel | 🟡
| Demo Environment Curator | 🟡
**The Boardroom (Governance)** | Board Pack Composer | 🟡
| KPI Choreographer | 🟡
| Shareholder Comms Writer | 🟡
**Communications Backbone** | Comms Indexer | 🟡
| Email Composer | 🟡
| Calendar Choreographer | 🟡
**Knowledge (RAG depth)** | Memory Cartographer | 🟢
| Cross-Module Retriever | 🟢

That's **40 net-new agents** if everything ships. **Don't ship them all.** The right number for a firm of 15–25 people in years 2–3 is somewhere in the **20–25 net-new** range, sequenced as below.

---

## 4. Recommended sequencing

### v4 — "The firm gets paid, signed, and watched"

Critical gaps only. Target build: 8–10 weeks after v3 ships.

- **The Codex** — Contract Composer, Redline Analyst, E-Sign Orchestrator, Renewal Watchdog, DPA Sentinel.
- **The Treasury** — Invoice Builder, Collections Concierge, Revenue Recognizer, Cash Flow Forecaster, Tax Sentinel.
- **Engagement Health Sentinel** — extends the Atelier.
- **The Pulse** — Pulse Listener, Reference Interviewer, Consent Steward.
- **Communications backbone** — email + calendar integration (Google + MS365), Comms Indexer.

≈ 15 net-new agents. Together these close the *commercial loop* (sign → invoice → collect → renew), surface *engagement risk* before it becomes loss, and build *reference flywheel*.

### v5 — "The firm scales and proves it"

Important gaps. Target build: 10–12 weeks after v4 ships, ideally aligned with first SOC2 push.

- **The Press** — thought leadership pipeline (4 agents).
- **Partners / Alliances** — Partner Cartographer, Alliance Choreographer, Certification Tracker.
- **The Studio** — talent acquisition (4 agents).
- **The Guardhouse** — Compliance Sentinel, Incident Responder, DSAR Concierge, Backup Auditor.
- **IP / Asset Catalog** — IP Steward, OSS Compliance Sentinel, Demo Environment Curator.

≈ 18 net-new agents. Together these scale the firm's *visibility, partner leverage, talent funnel, and trust posture*.

### v6+ — defer

- **The Boardroom** — when the 49% partner is signed and governance formalizes.
- **Knowledge depth** (RAG-as-a-service) — when the corpus exceeds ~200 engagements of memory.
- **Operations backbone** (vendor / IT / procurement) — at ~15 headcount.
- **TR / FR / HI / UR localization** — pulled by demand.

---

## 5. Cross-cutting modifications to v1–v3 implied by these gaps

A few additions to the existing v1–v3 specs that don't require a new module:

1. **The Salon should also surface a Pulse micro-survey** — patch into v2's Salon Overview tab. Tiny addition, big VoC payoff.
2. **The Atelier Home should add a "Firm Health" tile** — counts AMBER / RED engagements from the Engagement Health Sentinel. Lands as the 4th pane.
3. **Account Cartographer should auto-ingest signals from Comms Indexer** — emails and meetings into account history. Patch in v4 when communications backbone lands.
4. **The Wallet's invoice line drafts should feed The Treasury's Invoice Builder** — clean handoff, defined in v4.
5. **Synthesis Critic should learn from Pulse signals** — closes the loop between deliverable quality and client satisfaction.
6. **Atelier Curator should treat reference interviews as first-class harvest** — every reference becomes a credential candidate.

---

## 6. The honest "what we built vs. what a complete system would have" view

Of the capabilities a Tier-1 / Big-4 consulting firm runs internally, v1–v3 covers roughly **60–65%** of the operational surface. With v4 (closes commercial loop, engagement health, VoC, comms): **~80%**. With v5 (scaling capabilities — marketing, alliances, talent, security): **~92%**.

The remaining 8% is the territory of large-firm bureaucracy that a senior-led boutique should not adopt — formal performance review machinery, internal HR investigations, multi-band compensation calibration committees, etc. The portal should resist building these. The competitive thesis is the *absence* of that overhead.

---

## 7. Open decisions to inform v4 scope

A handful of strategic choices that bear on v4 design — worth resolving before I draft the v4 PRD:

1. **Which signing platform?** DocuSign is the safe default; Tabellio is KSA-compliant; Adobe Sign integrates with Microsoft 365. Choose one for v4.
2. **Accounting backbone — Xero or QuickBooks or DIFC-native?** The Treasury hands off to an accounting system; pick one to design the integration around.
3. **Email / calendar integration — Google Workspace or Microsoft 365 first?** Both will be needed eventually; pick the founders' day-1 stack.
4. **NPS / Pulse cadence — monthly micro or only end-of-engagement?** Monthly micro is more powerful but more intrusive.
5. **Reference interview format — async-video (Loom / SparkHire) or scheduled live?** Both are buildable; the agent's job changes.
6. **WhatsApp Business — in scope for v4 client comms or defer?** Compliance heavy; valuable in GCC; my recommendation is to stub in v4 and build in v5.
7. **Should the Engagement Health Sentinel run as a daemon or on-demand?** Daemon (default) gives early warning; on-demand is cheaper. My recommendation: daemon, cost-capped per engagement.

---

## 8. Next step

When you're ready, prompt me with **"Generate the v4 PRD"** and I'll produce the next Replit-ready build prompt covering the critical-gap set (Codex, Treasury, Engagement Health, Pulse, Communications backbone — ≈ 15 net-new agents).

If you want a different v4 cut — e.g., "skip Codex, build Press instead because we're losing voice to Tier-1 publicly" — say so and I'll re-sequence.

---

*End of gap analysis. v1, v2, v3 PRDs live alongside this file in the Maven folder.*
