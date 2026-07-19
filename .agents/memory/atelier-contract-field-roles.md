---
name: Atelier contract field roles
description: Task-#291 smart fill-in fields — role/options/defaultHint metadata, backfill normalization, reference sequences
---

- Template field schema carries optional `options` (dropdown), `role` ("standard"|"second_party"|"reference"), `defaultHint` ("today"). Old reviewed schemas lack these — every read/consumer path must go through `normalizeFieldSchema()` (deterministic `classifyFieldRole()` heuristics; explicit metadata always wins).
- **Why:** backfill is done at read time, never by rewriting stored schemas; a raw `version.fieldSchema` read silently loses role semantics (asks for second-party/reference values, misses today defaults).
- **How to apply:** any new code touching contract field schemas (routes, capabilities, fill paths) must normalize first and exclude non-"standard" roles from user-supplied/missing-required logic; explicit values for reference fields are ignored (allocated race-safe at prepare-commit via `allocateReferenceSeries` INSERT…ON CONFLICT on atelier_contract_reference_sequences, unique templateId+year, yearly reset).
- Second-party date fields become DocuSeal extraFields date boxes at send time; non-date second-party placeholders stay literal in the doc (accepted).
- The sequences table was created by one-off raw SQL in dev because `db push` wanted to drop the pgvector column. Prod gets it via the Publish schema diff (dev DB vs prod DB — the supported path; startup-time DDL for prod schema is forbidden by platform policy). Verified 2026-07-19: dev has table+unique index, prod not yet.
