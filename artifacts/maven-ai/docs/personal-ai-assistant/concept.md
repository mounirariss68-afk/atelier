# Maven Personal Agent — concept document

> Working name: **Maven Personal Agent**. Per-persona agent personalities: **Atlas** (Sales) and **Ember** (HR).
>
> This document is the contract for the marketplace tool entry, the two demos (Cockpit and Mind), and the seed data underneath them. Read top-to-bottom in ~15 minutes.

---

## 1. Executive summary & the three killer angles

Most enterprise AI assistants today are smart chatbots wired to corporate data. They forget what you tell them when you switch tools. They forget you entirely when you switch jobs. They reason in a black box. And they pretend the human at work is unrelated to the human at home.

The **Maven Personal Agent** rejects all four assumptions. It is an always-on AI agent for every employee that learns the job and the person, stores that knowledge in a **Personal Context Graph (PCG)** the **employee owns and can carry between employers**, and acts autonomously under a **glass-box trust model** with one-click undo on every decision. It is one agent for the whole person — drafting your offer letter and remembering your daughter's recital — with a strict privacy boundary between work scope and personal scope.

Three killer angles, each a deliberate inversion of the prevailing market posture:

1. **Employee-owned, portable Personal Context Graph.** The PCG belongs to the employee. The employer pays for work-scope access; the memory leaves with the employee on day one of a new job. There is precedent (LinkedIn for professional identity, the early "memory portability" writing of Iury Souza, Plurality Network, Synthreo and Piyush) but no enterprise product has shipped this. We do.

2. **Glass-box trust.** Every assistant answer is grounded in the exact PCG nodes that informed it, surfaced live in a Context-used rail. Every autonomous action drops a receipt — what was done, which nodes informed it, the confidence, the time saved — with one-click undo. This is the antidote to surveillance and black-box anxiety.

3. **Cross-life agent.** One agent for the whole person, with an employee-controlled privacy boundary between work and personal scope. The employer sees only aggregate work-scope outcomes (hours saved, task types automated, satisfaction). They never see a raw observation or a chat turn.

The two demos make this real: the **Cockpit** (chat + workspace + glass-box rail) and the **Mind** (interactive PCG visualisation with a Day-1-to-Year-1 time scrubber).

---

## 2. Problem & opportunity

Three intersecting frustrations define the modern knowledge worker:

- **Productivity ceiling.** Even with copilots, the median knowledge worker still loses 20–30% of their week to coordination, status updates, follow-ups, scheduling, and the slow drafting of artefacts they have written a hundred times before.
- **Cross-domain time leak.** Work and personal life share the same hours. When the calendar collides with a recital, the family WhatsApp, and the deadline, productivity collapses for everyone — but no enterprise tool helps because enterprise tools refuse to look at the personal half of the calendar.
- **Memory lock-in.** Every minute the worker spends teaching ChatGPT, Copilot, or Cedric their preferences is a minute they will lose again the next time they change tools or jobs. Loyalty to the vendor's silo is paid for by the employee in re-onboarding tax.

The market is moving. Andy Jassy's June 2025 shareholder letter is unusually candid: "agents will change how we all work and live", and Amazon expects to "reduce its corporate workforce" as agents take over routine work (Andy Jassy, "Some thoughts on Generative AI", 2025). Bill Gates called AI agents "the next platform" two years earlier, in November 2023 (gatesnotes.com/AI-agents). The MIT 2025 AI Agent Index (Casper et al., 2025) and Anthropic's "Measuring agent autonomy in practice" both formalise the autonomy ladder. Microsoft 365 Copilot Memory shipped in 2025 — the closest existing analog to a PCG.

What is missing is the inversion: an agent that compounds context across an employee's entire career, transparent enough to be trusted with autonomy, that the employee owns.

---

## 3. Real-world prior art & differentiation

### Amazon Cedric (Sept 2024 onward)
Internal Amazon assistant, Bedrock + Anthropic Claude. Reported by Eugene Kim in Business Insider (Sept 2024) as "safer than ChatGPT", drafting memos in seconds, with encrypted history. Cedric is a **single chatbot** with corporate-data grounding. It does not maintain an employee-portable graph, does not surface its grounding live, and has no cross-life dimension.

### Amazon Q Business
AWS's enterprise data-grounded assistant with role specialisations. Inherits the same single-chatbot architecture and the same memory silo: contexts live inside Q, gated by IAM, not portable.

### Andy Jassy 2024 memo and 2025 shareholder letter
Frame agents as the next computing platform and explicitly tell shareholders the workforce will shrink as agents take over routine work. Amazon's commercial product strategy will follow Cedric's mould — vendor-owned memory, employer-owned access.

### Microsoft 365 Copilot Memory (2025)
The closest market analog to a PCG. Captures preferences and context across Copilot interactions — but **inside Microsoft's tenant**, owned by the employer, not portable to a different vendor or a different job. Memory is a feature, not a wallet.

### Bill Gates — "AI agents are the next platform" (gatesnotes.com/AI-agents, Nov 2023)
Foundational vision piece: agents that observe what you do, predict what you need, and act on your behalf — explicitly arguing they will reshape healthcare, education, productivity and entertainment. The vision document for the entire category.

### MIT 2025 AI Agent Index (Casper et al., 2025) and Anthropic "Measuring agent autonomy in practice"
The two reference frameworks for autonomy levels, capability-by-capability evaluation, and the safety case for graduated autonomy. We adopt the five-level ladder directly.

### Memory-portability writing (Souza, Plurality Network, Synthreo, Piyush)
Independent writers and small startups have argued for years that AI memory should be a user-owned wallet, exportable, and portable across vendors. The argument is unrebutted in the market. No major enterprise vendor has shipped on it. **This is the gap we own.**

### Agent-UI taxonomy — Devin / Manus (delegation), Cursor (collaboration), Lindy (workflow)
Three live UI paradigms. Devin and Manus give the agent a workspace and let it work asynchronously (delegation). Cursor pairs the human and the agent at the same artefact (collaboration). Lindy chains tools through declarative workflows. Our **Cockpit** deliberately blends collaboration (left-pane chat) and delegation (centre workspace) on the same screen, so the same context drives both modes.

### Differentiation statement (one paragraph)
Cedric, Amazon Q Business and Microsoft 365 Copilot Memory are smart chatbots whose memory belongs to the employer or the vendor; the employee re-onboards on every job change. Devin and Manus are excellent at delegation but treat memory as session-local. Lindy chains tools but has no concept of a personal graph at all. The Maven Personal Agent is the only design where (a) memory is a portable employee-owned graph, (b) every answer and every action is surfaced live with the exact graph nodes that grounded it, and (c) the same agent serves both the work and the personal life of the employee under a clean privacy boundary. The three killer angles are not features layered on a chatbot; they are the architecture.

---

## 4. Job-class taxonomy

Six classes. Each row: typical PCG nodes · top-3 jobs-to-be-done · top tools touched · autonomy ceiling for the typical task type.

### HR
- *HR Business Partner* — people, policies, cases, sentiment · drafting offer letters / drafting case notes / answering policy questions · Workday, Greenhouse, ServiceNow HR, Slack · L3 (auto-with-undo) for FAQ / draft offer letter; L1 (suggest) for compensation decisions.
- *Talent Acquisition* — candidates, requisitions, hiring managers, interview loops · scheduling loops / drafting outreach / shortlisting from intake notes · Greenhouse, LinkedIn Recruiter, Gem, calendar · L3 for outreach drafts and scheduling; L1 for shortlist decisions.
- *People Ops / HR Ops* — policies, payroll cases, benefits enrolments · answering policy questions / generating one-page FAQs / triaging tickets · ServiceNow HR, Workday, Notion · L3 for FAQ generation; L2 (confirm-to-act) for ticket triage.
- *Learning & Development* — competencies, programmes, cohorts · drafting curriculum / nudging managers / summarising 1:1 themes · LMS, calendar, Slack · L3 for nudges and summaries.

### Finance
- *FP&A Analyst* — accounts, drivers, scenarios, variance commentary · variance commentary / scenario modelling / month-end pack drafts · NetSuite, Adaptive, Pigment · L3 for variance commentary; L2 for scenario re-runs.
- *AR / Collections* — customer ageing, contacts, prior promises · dunning sequences / collections call prep / disputes triage · NetSuite, Salesforce, email · L3 for dunning drafts; L2 for disputes.
- *Procure-to-Pay* — vendors, contracts, invoices, anomalies · invoice exception triage / vendor master cleanup / contract clause search · Coupa, NetSuite, Ironclad · L2 for exception routing.

### Sales
- *Senior AE* — accounts, contacts, opportunities, plays, preferences · follow-ups / pre-meeting briefs / next-best-action · Salesforce, Outreach, Gong, calendar · L3 for follow-ups and briefs; L1 for pricing.
- *SDR* — prospects, sequences, objections, calls · sequence drafting / objection libraries / triage replies · Outreach, Gong, Salesforce, LinkedIn · L3 for outbound; L2 for inbound triage.
- *Sales Engineer* — products, configs, technical objections, customer architectures · technical Q&A / RFP responses / demo scripts · Salesforce, Notion, Slack · L3 for Q&A drafts.
- *Customer Success* — customers, health scores, renewals, expansion · QBR drafts / renewal risk briefs / expansion plays · Gainsight, Salesforce, calendar · L3 for QBR drafts.

### Procurement
- *Category Manager* — categories, suppliers, contracts, market intel · supplier shortlists / RFQ drafts / negotiation prep · Coupa, Ariba, market intel feeds · L2 for RFQ drafts; L1 for award decisions.
- *Sourcing Analyst* — bids, savings claims, supplier diligence · bid analysis / clause comparisons / savings tracking · Excel, Coupa, Ironclad · L3 for bid analysis.
- *Supplier Manager* — supplier relationships, KPIs, risk events · QBR prep / supplier scorecards / risk follow-ups · Salesforce, Coupa, news feeds · L3 for QBR prep.

### Product Management
- *Senior PM* — features, OKRs, customer feedback, competitor moves · spec drafts / customer research synthesis / release notes · Linear, Notion, Pendo, Slack · L3 for release notes and synthesis; L2 for spec drafts.
- *Technical PM* — APIs, dependencies, technical debt items · roadmap docs / dependency narratives / changelog drafting · Linear, GitHub, Notion · L3 for changelogs.

### Marketing
- *Demand Gen Marketer* — campaigns, segments, content, MQL pipeline · campaign briefs / email drafting / performance summaries · Marketo, Salesforce, GA4 · L3 for drafts and summaries.
- *Content Marketer* — content calendar, briefs, editorial guidelines, SEO · brief drafting / editorial QA / repurposing · Notion, CMS, Ahrefs · L3 for repurposing.
- *Product Marketer* — launches, positioning, sales enablement · launch comms / sales enablement updates / battlecard refresh · Notion, Slack, Salesforce · L3 for enablement updates.

The two personas in section 5 are the **Sales — Senior AE** and **HR — HR Business Partner** rows above, expanded.

---

## 5. The two personas in deep detail

### Persona A — Sales · Mariam Al-Hashimi · agent name **Atlas**

- **Name & role.** Mariam Al-Hashimi, Senior Account Executive, Northwind Cloud (B2B SaaS, MENA region).
- **Day-in-the-life.** Mariam manages 24 enterprise accounts across UAE, KSA and Egypt. Her morning is meeting prep and follow-ups; afternoon is calls; evening is admin she resents — Salesforce hygiene, sequence updates, internal updates. Atlas absorbs the third bucket.
- **Top 5 jobs-to-be-done.**
  1. Draft a pitch-perfect follow-up after every meeting, threaded back to prior conversation.
  2. Brief her in two paragraphs before any first or second meeting with full account context.
  3. Surface the next-best-action across her book of accounts every morning.
  4. Detect signal (LinkedIn posts, news, Gong call themes) on her named contacts and propose timely outreach.
  5. Keep Salesforce honest without her having to type into Salesforce.
- **Key relationships.** Maya Chen (VP Procurement, ACME — her largest live opportunity); Sara Park (Procurement Lead at ACME, reports to Maya); Hassan Idris (Mariam's sales manager); Layla Al-Mazrouei (Customer Success counterpart on her live accounts).
- **Sample PCG schema (representative ~18 nodes).** Role nodes: Senior AE, MENA enterprise. Skills: account planning, multi-threading, cloud-native pitch. Relationships: Maya Chen, Sara Park, Hassan Idris, Layla Al-Mazrouei, plus 8 named contacts. Preferences: Tuesday lunch slots inferred from 6 successful Maya meetings; vegetarian; Maya's daughter plays soccer. Personal: Mariam's daughter Layan; Layan's recital Thursday 6pm. Projects: ACME EU rollout; ACME pricing renegotiation. Tools: Salesforce, Outreach, Gong, calendar. Communication patterns: Mariam writes short, lists three options, signs "M.".
- **Personal dimension.** Mariam's daughter, Layan, has a recital Thursday 6pm. Atlas knows because Mariam mentioned it on a Gong call. Atlas blocks the calendar 5–8pm and pre-selects three local florists (one with vegan options because Mariam's mother-in-law is coming).
- **3-minute Cockpit storyboard.** (1) Mariam opens the Cockpit, sees three pending approvals — top one is the ACME follow-up. (2) She approves it; the chat acks "Done — sent to Maya at 3:42pm. I'll watch for her reply." Receipt drops with PCG citations. (3) Atlas proactively says: "Maya at ACME just posted on LinkedIn about their new EU rollout — want me to draft a congratulatory note that ties back to last week's pricing conversation?" The Context-used rail lights up showing both the LinkedIn observation node and the pricing-conversation node. (4) Mariam says yes; the draft appears with Edit / Approve. (5) She approves; the personal nudge appears about the recital.
- **3-minute Mind storyboard.** (1) Mariam opens the Mind, scope=Both, time=Day 1. The graph is sparse — 6 nodes, mostly Role and Tools. (2) She drags the scrubber to Year 1; nodes fan out into Relationships, Preferences, Personal constellations. (3) She clicks the Maya Chen node — sees how it grew (use count, edges to projects and preferences). (4) She toggles scope=Work — the personal constellation fades. (5) She clicks Export my graph — JSON-LD modal appears.

### Persona B — HR · Yusuf Demir · agent name **Ember**

- **Name & role.** Yusuf Demir, HR Business Partner — Engineering org, Northwind (200-engineer org).
- **Day-in-the-life.** Yusuf alternates between scheduled 1:1s with engineering leads, ad-hoc cases (visa, relocation, conflict, comp), and policy updates. Ember handles the FAQ surface, scheduling, drafting case notes, and tracking themes across cases.
- **Top 5 jobs-to-be-done.**
  1. Draft offer letters and exit communications grounded in the actual policy doc.
  2. Generate one-page FAQs the moment a question repeats across the team.
  3. Detect themes across Slack and 1:1s ("three engineers asked about sabbaticals this hour").
  4. Track open cases (visa, relocation, conflict) and nudge follow-ups.
  5. Prepare comp / promotion debriefs from the 9-box, performance comments and policy bands.
- **Key relationships.** Priya Nair (VP Engineering, Yusuf's primary partner); Ahmet Kaya (Head of Talent Acquisition); the 14 engineering leads Yusuf supports; the engineers with open cases.
- **Sample PCG schema (representative ~18 nodes).** Role: HRBP, Engineering. Skills: case management, drafting policy comms, sentiment reading. Relationships: Priya Nair, Ahmet Kaya, 14 engineering leads. Preferences: Priya prefers async written briefs over meetings; Ember writes FAQs in plain language with 5 Q&A maximum. Personal: Yusuf's mother's 70th birthday in 3 weeks; sister mentioned a surprise dinner in family group. Projects: Q4 hiring plan (14 reqs); sabbatical policy rollout. Tools: Workday, Greenhouse, ServiceNow HR, Slack. Communication patterns: Yusuf prefers bullet-pointed briefings; signs "Y. — HRBP".
- **Personal dimension.** Yusuf's mother's 70th is in 3 weeks. His sister mentioned a surprise dinner in the family group. Ember offers to draft a short toast based on the stories Yusuf has shared in past 1:1s.
- **3-minute Cockpit storyboard.** (1) Yusuf opens the Cockpit, sees three pending approvals — top one is a one-page FAQ on the new sabbatical policy. (2) Ember explains: three engineers asked Slack about it in the last hour; she's drafted the FAQ from the policy doc and scheduled a 15-min office-hours slot tomorrow at 2pm. (3) Yusuf approves; the receipt cites the policy node, the three Slack observation nodes and the calendar node. (4) Personal nudge appears about the toast. (5) Yusuf clicks Edit to add a personal anecdote — Ember acknowledges in chat.
- **3-minute Mind storyboard.** Same as Mariam's, but the Year-1 graph is dense around Policies, People, Cases. At Month 3, a Q4 hiring plan cluster appears with edges to 14 candidate nodes. Toggling Personal reveals a small but visible personal constellation.

---

## 6. The Personal Context Graph model

**Node types.** Role · Skill · Relationship · Preference · Personal · Project · Tool · Communication pattern · Domain knowledge.

**Edge types.** `knows`, `reports_to`, `works_on`, `prefers`, `owns`, `uses`, `remembers`, `attended`, `inferred_from`. Edges carry strength (0–1) and provenance.

**Sources.** Calendar, email, chat, meeting transcripts (Gong / Otter / Teams), document edits (Notion / Google Docs), CRM / ATS / ERP read-only feeds, employee corrections, explicit teach-me snippets ("Atlas, remember Maya is vegetarian.").

**Confidence scoring.** Each node carries 0–1 confidence. Confidence rises with corroboration (multiple sources agreeing), employee confirmation, or successful use ("I drafted x referencing this node and Mariam approved it"). Confidence falls with employee correction, contradiction or staleness.

**Decay over time.** Nodes carry `lastUsedAt`. After a threshold (default 90 days for preferences, 180 for relationships, 30 for project state) the confidence decays linearly to 0.4, where the agent flags the node as stale and asks before relying on it.

**Contradiction handling.** A new observation that contradicts an existing high-confidence node is queued as a `pending-contradiction`. The agent surfaces it to the employee at the next chat turn ("I had recorded that Maya prefers Tuesday lunches, but today's reschedule suggests otherwise — should I update?"). The employee resolves; the graph curator records the change.

**Work-vs-personal scope** is a first-class field on every node. A node tagged `personal` is invisible to the employer in any aggregate view. The employee can re-tag a node at any time, including bulk re-tags before exporting the graph.

**Portability model.** The PCG is exportable as JSON-LD (`@context: https://maven.ai/pcg/v1`) at any time. The exported payload includes every node, every edge, all provenance, and a manifest of the agent versions that wrote each node. A new employer that licenses Maven can import the **work-scope subset only** (the employee chooses what to share), and the graph curator merges nodes into the new employee's PCG with full provenance preserved.

---

## 7. The learning loop

`Observe → extract → propose → confirm → store`.

- **Observe.** Sub-agents tap connectors with read-only scope. Calendar attendance, email replies, chat reactions, doc edits.
- **Extract.** The Observation Extractor proposes new nodes and edges with confidence scores.
- **Propose.** The Graph Curator reviews proposals, dedupes against existing nodes, and either auto-stores (if confidence > 0.9 and no contradiction) or flags for confirm.
- **Confirm.** Most low-stakes confirmations happen silently (confidence rises across multiple corroborations). High-stakes or contradictory confirmations are surfaced inline ("Recording that Sara Park reports to Maya. Source: today's meeting transcript. Confidence 0.82. Confirm?").
- **Store.** The Graph Curator is the only writer to the PCG.

**Cold-start vs steady-state.** Day 1 is intentionally sparse — a 6-node Role and Tools constellation seeded from the offer letter and the first calendar sync. The first two weeks run in **shadow mode**: the agent observes and proposes but does not act autonomously. After the employee confirms the first 25 nodes, the agent moves to L1 (suggest) for low-stakes capabilities. L2 / L3 unlock per capability as the employee or the policy owner permits.

---

## 8. The autonomy ladder

Adopted from the MIT 2025 AI Agent Index and Anthropic's "Measuring agent autonomy in practice".

- **L0 — Informational.** The agent describes what it would do, takes no action.
- **L1 — Suggest.** The agent drafts; the human picks up, edits, sends.
- **L2 — Confirm-to-act.** The agent proposes a complete action (an email ready to send, a slot ready to book) with one-click Approve.
- **L3 — Auto-with-undo.** The agent acts immediately; a receipt drops with one-click Undo for a configurable window (default 5 minutes).
- **L4 — Fully autonomous.** The agent acts without a per-action receipt; aggregate reporting only. Reserved for low-stakes, high-volume, employee-controlled capabilities.

**Per-capability ceilings.** Every capability (e.g. "draft follow-up email", "book calendar slot", "publish FAQ", "send offer letter") carries its own ceiling. The **employee** owns the personal-scope ceiling at all levels. The **manager / policy owner** owns the work-scope ceiling per capability. Defaults: L3 for follow-ups and FAQs; L2 for offer letters and bookings touching customers; L1 for compensation decisions and any capability touching > $X of value.

---

## 9. Multi-agent orchestration

The PCG is the **shared substrate**. The Personal Planner (the named agent — Atlas, Ember) is the only planner. It dispatches to specialised sub-agents that all read and write through the Graph Curator:

- **Observation Extractor** — tap streams, propose nodes.
- **Graph Curator** — sole writer to the PCG; dedupe, confidence, decay, contradictions.
- **Context Retriever** — for any chat turn or autonomous task, pick the smallest sufficient subset of PCG nodes (graph traversal + embedding match) and hand them to the planner as the grounding bundle.
- **Drafter** — write the artefact (email, FAQ, offer letter, brief) in the persona's voice, grounded in the bundle.
- **Calendar / Email / Travel / Gift / Doc-writing / Follow-up / Meeting-prep / Recruiting / Payroll-query / Expense / Research** sub-agents — pluggable. Each owns one capability.
- **Autonomy Gate** — enforces the per-capability autonomy ceiling and routes to auto-execute, propose-with-undo, or ask-the-human-first.
- **Receipt Keeper** — writes the glass-box receipt for every autonomous action.

The pluggable sub-agent model is a deliberate differentiator vs single-chatbot products: the planner stays small, the capabilities scale independently, and the org can swap (e.g.) the Travel sub-agent without touching the PCG schema.

---

## 10. Trust, safety, privacy posture

The first-class design constraints, not feature toggles:

- **Work-vs-personal scope** is a tag on every node and every edge; the employer can never see the personal slice.
- **Employee-controlled personal scope at all autonomy levels** — even an L4 automation pauses if a personal-scope action would be triggered without explicit policy.
- **Full audit log** of every autonomous action. Every action carries an undo handle for a configurable window.
- **Encryption** in transit (TLS 1.3) and at rest (per-employee key in the customer's KMS for work scope; per-employee personal key for personal scope).
- **Right to export.** The employee can export their PCG at any time, free, in JSON-LD.
- **Right to forget.** The employee can delete any node or edge or the whole graph at any time.
- **Manager observability** is aggregate work-scope outcomes only — hours saved, automated task types, satisfaction. Never raw observations or chat content.
- **Grounding** to reduce hallucination. The Context Retriever's bundle is cited with every chat turn; the chat refuses to answer if grounding falls below a threshold.
- **Refusal patterns** for high-stakes actions: any capability above L2 that touches money, headcount, or customer commitments routes through an explicit human checkpoint regardless of policy.
- **Glass-box principle.** Trust is a product surface, not a footnote. Every answer cites; every action receipts.

---

## 11. Architecture sketch

A one-page diagram described in text (renderer in Demo 1's "How does this work?" modal):

- **Connectors.** Read-only OAuth into calendar, email, chat, transcripts, docs, CRM/ATS/ERP. Stream + poll.
- **Ingestion & extraction layer.** Observation Extractor, normaliser, PII-aware redactor, scope tagger.
- **PCG store.** Graph DB (Neo4j or AWS Neptune) per employee. Per-employee key. Personal-scope partitioned and separately encrypted.
- **Retrieval layer.** Hybrid: graph traversal for known relationships, embedding search for fuzzy "do I know anyone at TechCorp" queries.
- **Agent runtime.** Planner (named per persona) plus pluggable sub-agents. Each sub-agent declares its capability, autonomy ceiling, tool catalogue and audit fields.
- **UI layer.** Cockpit (chat + workspace + glass-box rail). Mind (PCG visualisation). Admin (autonomy policies, scope policies, export).
- **Audit & receipt layer.** Append-only log, undo handles, aggregate-roll-up for manager observability.
- **Identity & policy.** Per-employee identity (employee owns it). Per-employer policy (autonomy ceilings, connector scope, retention).

---

## 12. Org-level intelligence (briefly)

Anonymised "what worked for similar people in similar roles" playbooks flow back as suggestions — *"Senior AEs in MENA who use this template see 23% higher reply rates"* — derived from k-anonymous aggregations across the customer base, with the employee's explicit opt-in. Never identifies a specific person.

---

## 13. Manager observability (briefly)

A Manager sees: hours saved across team, top automated task types, employee-reported satisfaction, undo rate (a quality signal), capability adoption curve. A Manager never sees: any specific personal observation, any raw chat turn, any specific calendar item, any specific email body. Audit trail of what aggregations were ever computed is itself observable.

---

## 14. Voice & multimodal (briefly, out of demo scope)

Voice capture (always-on listener, employee toggle), in-meeting capture (Teams / Zoom plug-ins), screen-context extension (browser plug-in that streams page metadata, employee toggle). All paths obey the work / personal scope, the ceiling, and the receipt model. Out of demo scope but in the architecture.

---

## 15. Risks register

- **Privacy violation.** The graph contains personal life. Mitigation: per-scope encryption, per-employee key, employer never sees personal nodes, right-to-forget.
- **Hallucination.** Mitigation: grounded answers with explicit citations; refusal threshold; human checkpoint above L2 for stakes-bearing actions.
- **Incorrect autonomous action.** Mitigation: undo handle on every L3 action; L1/L2 default for any new capability; per-capability autonomy ceiling; refusal patterns for money / headcount / customer commitments.
- **Dependency, atrophy, deskilling.** Mitigation: explicit "pause and let me try" toggle; periodic "did the agent's draft match what you would have written?" prompts; capability adoption metrics surfaced to the employee, not the manager.
- **Two-tier productivity.** Mitigation: Personal Agent is a per-seat product available to every employee, not just senior staff; pricing tiers do not gate basic capabilities.
- **Surveillance perception.** The biggest threat to adoption. Mitigation: glass-box trust as a first-class design constraint; manager observability is aggregate-only and itself audited; the marketing posture leads with "your memory, not theirs".

---

## 16. What this is NOT

- **Not a surveillance tool.** Personal scope is invisible to the employer.
- **Not a replacement for the employee.** The employee signs the high-stakes work; the agent does the routine work.
- **Not a single chatbot.** The Personal Planner is one named agent backed by pluggable sub-agents and a graph.
- **Not a memory silo.** The PCG is portable, exportable, employee-owned.

---

## 17. Phased rollout

- **Phase 1 — Pilot.** Single team (e.g. 12 sales AEs or 6 HRBPs), L0–L1 only, 8 weeks, success criteria: ≥ 4 hours / week saved per pilot, ≥ 80% employee satisfaction, < 5% undo rate.
- **Phase 2 — Expansion.** Whole department (e.g. 200-person sales org or 40-person HR org), L0–L2 unlocked per capability, 12 weeks, success criteria: ≥ 6 hours / week saved per employee, ≥ 75% employee adoption.
- **Phase 3 — Org-wide.** L0–L3 with employee-controlled L4 personal scope; manager observability dashboards live; portability export available; 24 weeks; success criteria: ≥ 8 hours / week saved organisation-median, ≥ 90% adoption, regulator-grade audit pack.

---

## 18. Pricing & packaging

- **Per-seat enterprise license**, work scope. Tiers by autonomy ceiling and connector count.
- **Personal scope is free for the employee, forever.** The employee can use the Personal Agent for personal life even if they leave the employer; the personal scope, personal-key encryption, and right-to-export survive job change.
- **PCG export is always free.** Employee right.
- **Add-ons.** Voice capture, in-meeting capture, manager-observability dashboard, regulator-grade audit pack.

---

## 19. Demo-mapping appendix

Every decision in this document maps to a seed-data row, so the demos are auditable against the concept.

| Concept decision | Demo surface | Seed data row |
|---|---|---|
| Three killer angles lead the doc | Marketplace detail "Why we built it this way" strip | `MarketplaceDetail.tsx` strip + `tool.longDescription` |
| Per-persona agent name (Atlas / Ember) | Cockpit top bar; co-presence pill | `personas[].agentName` in `personal-agent-seed.ts` |
| PCG node categories | Mind constellation colours | `personas[].pcg.nodes[].category` |
| Time scrubber milestones (Day 1 / Week 1 / Month 1 / Month 6 / Year 1) | Mind bottom dock | `MILESTONES` array in `personal-agent-seed.ts` |
| Confidence ring around node | Mind node SVG render | `node.confidence` |
| Use count grows node size | Mind node sizing | `node.useCount` |
| Privacy scope filter | Mind top bar Work / Personal / Both toggle | `node.scope` |
| Glass-box receipt with PCG citations | Cockpit workspace "What I did today" | `cockpit.completed[].citedNodeIds` |
| Cross-life moment — Mariam's daughter Layan's recital | Cockpit personal nudge | `personas.sales.cockpit.nudge` |
| Cross-life moment — Yusuf's mother's 70th toast | Cockpit personal nudge | `personas.hr.cockpit.nudge` |
| Cross-source synthesis magic moment (Sales) | Cockpit chat-initiated suggestion + Context-used rail | `personas.sales.cockpit.proactive` |
| Pattern-detection magic moment (HR) | Cockpit pending card with three Slack citations | `personas.hr.cockpit.pending[0]` |
| L3 capability with one-click undo | Cockpit Approve flow | `pending[].autonomyLevel: "L3"` + `receipt.undoableUntil` |
| Right-to-forget | Mind node detail panel "Forget this" button | `MindNodePanel` action |
| Portable PCG export (JSON-LD) | Mind top bar "Export my graph" modal | `personas[].exportPayload` |
| Employee-owned, free-forever personal scope | Concept doc and pricing strip on marketplace detail | section 18 above |
| Manager observability is aggregate-only | Concept doc; not built in demo (out of scope) | section 13 above |
| Glass-box principle | Cockpit Context-used rail + every receipt | `Cockpit.tsx` rail rendering |
| Five sub-agents named in cast | Marketplace detail "How does this work?" modal | `agentCasts.ts → maven-personal-agent` |
| Concept doc is the contract | Marketplace detail "Concept & research" link | `/personal-agent/concept` route |
