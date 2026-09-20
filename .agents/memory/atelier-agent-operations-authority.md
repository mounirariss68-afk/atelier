---
name: Agent operations authority
description: Durable authority boundary for the Agents operations catalogue, profiles, runs, and decisions.
---

The executable runtime registry is the sole authority for whether an agent can run and for its capabilities, guardrails, checkpoints, prompt reference, model, and schemas. Database-only or stub catalogue rows may be identified as unavailable, but must never receive run controls or inferred runtime metadata.

**Why:** The retired lifecycle showcase represented disconnected design, evaluation, deployment, improvement, retirement, and outcome records as though they controlled execution. That made simulated and cache-only state look operational.

**How to apply:** Build Agents surfaces from runtime registry metadata plus organisation-scoped persisted run records. Persist and audit human decisions server-side. Do not reintroduce lifecycle tables, static client policy copy, or optimistic-only actions as operational truth.