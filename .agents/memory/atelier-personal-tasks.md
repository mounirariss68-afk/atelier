---
name: Personal tasks & reminders
description: Durable invariants for the self-scoped personal tasks feature (Me → Tasks, me.task_* chat caps, reminder tick)
---

- Personal tasks are scoped to the owning **user id**; every read/write puts ownership in the WHERE clause — cross-user access is a 404/null, never a filtered list.
- Due-reminder cards use a deterministic id derived from (task id, due instant) with insert-or-ignore. **Why:** the periodic tick must be idempotent per occurrence; a reschedule changes the instant and thus legitimately yields one fresh card.
- Any mutation that completes, reschedules, or deletes a task must also dismiss its outstanding reminder cards, or stale nags survive. **How to apply:** new mutation surfaces (recurrence, assignment, push) reuse the shared dismiss helper and keep the deterministic-id contract.
- Chat caps are me.\* so the self-only role clamp covers employee/contractor automatically; create/reschedule are two-phase confirm with the caller's tz pinned into the pending input; complete is single-phase.
- Bare wall time resolves to its NEXT occurrence in the caller's timezone (past ⇒ tomorrow); date without time defaults to 09:00.
