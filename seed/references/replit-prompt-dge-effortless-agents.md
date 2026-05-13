# DGE Effortless — Replit build prompt (anchor pattern)

> Pinned per spec §17. This is the canonical pattern Prototype Forge mirrors
> when generating Replit-ready prototype prompts inside opportunity workspaces.
> Agents (Prototype Forge especially) reference it for: scaffolding shape,
> non-negotiables block, data-policy block, and acceptance criteria.

## Context

You are building a senior-grade prototype of an "effortless services" agent
suite for the Department of Government Enablement (DGE). Three named agents,
one shared shell, deterministic mock-LLM behavior so demos are reproducible.

## Non-negotiables (do NOT relax)

- Brand: deep navy canvas, gold accents, JetBrains Mono mark.
- No silent fallbacks. If a model call fails, the UI says so explicitly.
- No fabricated citations. Every claim a user can act on has a source.
- Partner-final read gate on every external-facing artifact.

## Data policy

- All inputs treated as confidential by default.
- No cross-engagement reads without an explicit Atelier promotion record.
- PII redaction pass before any cross-engagement write.

## Acceptance criteria

1. Three agents register in the registry with starred MVP status.
2. Each agent has a structured prompt sheet (no free-text chat box).
3. Each agent's run produces an audit row.
4. Demo path runs end-to-end with mock LLM in <5min wall-clock.

## Build order

1. Shell + persona switcher.
2. Agent runtime + activity stream.
3. The three agents — prompt + evals + runner + route + UI.
4. Audit feed everywhere.
5. Partner-final read gate on external artifacts.
