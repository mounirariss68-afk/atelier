---
name: One-off DB cleanups
description: How ad-hoc data purges must be packaged to pass completion review
---
Rule: never leave a data cleanup as an interactive-SQL-only action. Commit an idempotent script (scripts/*.ts) that re-derives the target set, applies an EXPLICIT dependency policy for every table referencing the deleted ids (delete vs unlink, documented), writes a system-actor audit row, and no-ops when clean. Pair it with a probe that is rerun-safe on the reused crm_test scratch DB (assert only your tagged fixture ids / scope agent runs via input filters, teardown in finally — absolute counts break on reruns).
**Why:** Task-completion review rejected an invoice purge twice: first because the executed SQL wasn't a committed artifact and coverage was missing; then because the probe asserted absolute scan counts (flaky on rerun) and the script missed dependent tables (dunning events, promises-to-pay, cash applications, GL journals) that have no FK enforcement.
**How to apply:** any future orphan/test-data sweep (incl. prod go-live sweeps): grep the schema for every `invoice_id`/ref column before writing the delete list; billing-trigger-style rows with their own lifecycle get unlinked, derived rows get deleted.
