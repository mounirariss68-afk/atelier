---
name: Atelier HR module invariants
description: Invariants for the People/HR module (titles, invitations, joiner activation, nav single-source, edit-form comp policy)
---
- **Titles registry is empty by design** (`/roster/titles`): production no-seeding policy — UI seniority dropdowns must fall back to the legacy hardcoded list when the registry is empty. Never seed titles.
- **Invitations are source-restricted**: an invitation requires a source (hired candidate, accepted offer, or partner firm) with a valid source record. No free-standing invitations; the Joiners page has no add form.
- **Joiner login bootstrap is activation-link only**: the create-login onboarding step NEVER generates, returns, or emails a temporary password. It mints a single-use 72-hour token (SHA-256 hash stored) and the joiner sets their own password on the pre-auth `/activate` page. The credential row is created with a discarded random hash so sign-in is impossible pre-activation. Manually advancing the login step 422s.
- **People nav is single-source**: the People lens sections derive from the shared lifecycle STAGES list — edit the stages, not the lens config.
- **Stub policy**: removed HR sections are catalogued in `docs/HR_BACKLOG.md`; don't reintroduce empty stub tabs — build the backlog entry's backend first.
- **Country display**: HR stores ISO alpha-2, displays full names via the shared countries util + CountryCombobox; never add ad-hoc country maps or raw ISO text inputs.
- **Edit-form comp fields are read-only by design**: the person PATCH endpoint blocks pay/bank fields (SENSITIVE_EDIT_FIELDS); the Edit Person form shows them read-only for comp-cleared viewers. **Why:** IBAN's sole write path is the HR-approved bank-change flow and pay data flows through Finance — one audited write path for money fields.
- **Access tiers**: senior_manager sees all accounts but only assigned opps/engagements; assignments auto-create access grants via the shared auto-grant helper — new assignment surfaces must call it.
