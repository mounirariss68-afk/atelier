---
name: Atelier Account AI tab wiring
description: How the Account AI tab in Account.tsx talks to the three account-management agents
---
The three account-management agents (Next-Best-Action, Relationship-Health, Pre-Meeting Briefing) expose bespoke account-scoped POST routes (`/api/atelier/accounts/:accountId/agents/<slug>/run`, plus `/relationship-health/dismiss`) that are NOT in `lib/api-spec/openapi.yaml`, so there are no orval hooks for them.

**Rule:** The Account AI tab (`AccountAgentsTab` in `artifacts/atelier/src/pages/Account.tsx`) calls those run/dismiss endpoints with raw `fetch` (credentials:"include"); each run returns `{ runId, output }`. Reuse codegen hooks ONLY for downstream side effects that already have spec coverage — accept→task uses `useAtelierCreateActivity`.

**Why:** These agents are proposal/human-checkpoint surfaces, not CRUD resources; adding them to the openapi spec would imply a stable resource contract they don't have. Acceptance must still create REAL tasks via the existing Activity layer (per AGENT_STANDARD.md), hence the hook for that one write.

**How to apply:** When adding another account-scoped agent UI, mirror the raw-fetch `runAccountAgent<T>()` helper rather than expecting a generated hook. Account.tsx tabs are local `useState` only (no URL deep-linking), so a new tab needs a TabKey union member + TABS entry + render branch.
