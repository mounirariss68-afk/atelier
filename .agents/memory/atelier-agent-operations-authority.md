---
name: Agent operations authority
description: Durable authority boundary for the Agents operations catalogue, profiles, runs, and decisions.
---

The executable runtime registry is the sole authority for whether an agent can run and for its capabilities, guardrails, checkpoints, prompt reference, model, and schemas. Database-only or stub catalogue rows may be identified as unavailable, but must never receive run controls or inferred runtime metadata.

**Why:** The retired lifecycle showcase represented disconnected design, evaluation, deployment, improvement, retirement, and outcome records as though they controlled execution. That made simulated and cache-only state look operational.

**How to apply:** Build Agents surfaces from runtime registry metadata plus organisation-scoped persisted run records. Persist and audit human decisions server-side. Do not reintroduce lifecycle tables, static client policy copy, or optimistic-only actions as operational truth.

Registry visibility and generic dispatch are separate contracts. Every non-generic capability must declare whether it is account-scoped or an orchestrator and link to the operational surface that owns its checks and approvals. Generic run routes and assistant capability projection must reject or omit those entries.

**Why:** Account research agents and Riser need catalogue visibility, but projecting them as generic runs would bypass account access, proposal approval, workflow persistence, or orchestrator policy controls.

**How to apply:** Default legacy entries to generic. For account-scoped and orchestrator entries, keep the real bespoke entry point, expose its operational link in the catalogue, and fail closed in generic dispatch even when a valid registry record exists.

Reviewed capability and CRM manifests authorize operational descriptions; persisted specialist runs provide historical evidence only. Riser turns/actions and specialist runs are separate record types and metric namespaces. Retrieval, graph, and RAG projections may describe relationships but must never create executability, widen roles or confirmation policy, or launch work.

**Why:** Persisted rows and semantic projections can be stale, malformed, or adversarial. Treating them as authority can misclassify Riser or an unknown agent as a reviewed specialist and leak labels, counts, evidence, or provenance before authorization.

**How to apply:** For specialist run reads, apply org scope first, then require a reviewed executable/advisory specialist identity, caller role, and canonical target-record ACL before exposing labels or counts. Unknown/partial targets fail closed; targetless and firm-wide runs are firm-leader-only. Include immutable prompt/catalog/model provenance when available and use explicit unknown/data-quality flags otherwise.