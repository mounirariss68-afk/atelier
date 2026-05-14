# AICo Portal v5 — Scale & Trust

This v5 PRD builds the firm's scaling capabilities on top of the v4 commercial
loop: visibility (Press), partner leverage (Alliances), talent funnel (Studio),
trust posture (Guardhouse), and IP / asset depth (extends /atelier/assets).

It is the SOC2-ready posture and the publishing flywheel that lets the firm
compete with Tier-1 by year 2.

## Conflict resolutions adopted (vs. raw v5 doc)

The same conflict-resolution discipline applied to v4. Where the original
doc proposed a new agent that duplicated a v1–v4 agent, v5 **extends** rather
than parallels. Net new agents land closer to ~12 than the doc's 18.

| Original v5 doc | What v5 ships |
|---|---|
| Thought Leadership Editor (new agent) | **POV Author — Press mode** (`prompts/pov_author/v2_press_mode.md`) |
| Field Notes Editor (new agent) | **Field Notes Scheduler** — thin scheduling/composition layer over POV Author + Theme Curator |
| Partner Cartographer (new agent) | **Account Cartographer — Partner mode** (`prompts/account_cartographer/v2_partner_mode.md`) |
| Recruiting Sourcer (new agent) | **Pursuit Scout — Recruiting mode** (`prompts/pursuit_scout/v2_recruiting_mode.md`) |
| IP Steward (separate module) | Lives **inside** the Knowledge Atelier at `/atelier/ip` |
| Demo Environment Curator (top-level agent) | **Sub-agent of IP Steward** |

## What ships in v5 (this task)

### Routes (Atelier frontend)
- `/press` — editorial calendar, in-flight content, Partner posting cadence,
  Field Notes newsletter, speaking opportunities, press-mention register
- `/alliances` — partner firms, joint pipeline + split economics,
  certifications (AWS / Azure / GCP / Anthropic / Databricks / Snowflake),
  alliance conflicts
- `/studio` — open roles, candidate CRM, interview panels + scorecards,
  reference checks, offer queue, internal referrals
- `/guardhouse` — control library (SOC2 + ISO 27001), evidence register,
  pentest register, vendor risk, incident register, DSAR queue, backup runs
- `/atelier/ip` — code asset registry, OSS compliance, demo environments,
  IP licensing log

### New agent prompts (`artifacts/api-server/prompts/`)
**Press**
- `linkedin_composer/v1.md`
- `press_monitor/v1.md`
- `field_notes_scheduler/v1.md`
- `partner_voice_mounir/v1.md`, `partner_voice_gokhan/v1.md` — voice profiles
  loaded into LinkedIn Composer / POV Author when drafting under each byline

**Alliances**
- `alliance_choreographer/v1.md`
- `certification_tracker/v1.md`

**Studio**
- `interview_designer/v1.md`
- `reference_caller/v1.md` (async-video graduates from v4 deferral)
- `offer_composer/v1.md`

**Guardhouse**
- `compliance_sentinel/v1.md`
- `incident_responder/v1.md`
- `dsar_concierge/v1.md`
- `backup_auditor/v1.md`

**IP / Asset catalog**
- `ip_steward/v1.md`
- `oss_compliance_sentinel/v1.md`
- `demo_environment_curator/v1.md`

### Mode extensions (existing v1 prompts get a v2 mode file)
- `pov_author/v2_press_mode.md` — public-facing rewrite of an internal POV
- `account_cartographer/v2_partner_mode.md` — counterparty type = partner firm
- `pursuit_scout/v2_recruiting_mode.md` — counterparty type = candidate

### Persona model
Two new personas in `artifacts/api-server/src/routes/atelier/personaRoles.ts`:
- **`recruiter`** — write access into `/studio`; cannot see client engagements
- **`compliance_officer`** — evidence write access in `/guardhouse`, plus
  read-only across audit-relevant surfaces (audit log, access reviews,
  backups, incidents, DSARs)

### Agent loader
`artifacts/api-server/src/lib/atelier-agents/loader.ts` — `AtelierAgentId`
union extended with the 15 new agent ids above.

## Out of scope (deferred to v6+)

- The Boardroom (board pack workflow) — defer until the 49% partner is signed
- Knowledge depth / RAG-as-a-service — defer until corpus exceeds ~200
  engagements
- Operations backbone (vendor / IT / procurement workflows) — defer until
  ~15 headcount
- TR / FR / HI / UR localization — defer until pulled by demand
- Full Slack/Teams DM ingestion beyond public channels
- Phone-call integration (Aircall/Dialpad)

## Cross-cutting patches

- **WhatsApp Business — full integration** — graduates the v4 stub. Routed
  through the existing Comms Indexer. Compliance scopes per Access Sentinel.
  *(Stubbed in v5; data model + prompts only — full integration depends on a
  WhatsApp Business connector.)*
- **Win Themes ↔ Press feedback loop** — Theme Curator promotes high-confidence
  themes into the Press editorial calendar as POV candidates. The candidate
  rows in `EDITORIAL_CALENDAR` carry a `themeId` referencing the source theme.

## What is mocked vs. wired

This task ships the **frontend scaffolding + agent prompts + persona-model
extension + loader registration**. The agent prompts are real (eval-ready);
the front-end pages are seeded with realistic mock data so the Partner can
walk the v5 demo end-to-end. Persisting Press/Alliances/Studio/Guardhouse/IP
data in Postgres (Drizzle tables, routes, hooks) is the v5.1 follow-up.
