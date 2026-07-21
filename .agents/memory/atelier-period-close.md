---
name: Atelier period-close & collections invariants
description: Close-cycle workflow, sign-off lock semantics, and Collections Agent ladder rules
---

- Close sign-off is hard-blocked server-side (409 not_ready) while any checklist item is open/blocked or any accrual is `proposed`; second sign-off must be a DISTINCT partner and engages atelierPeriodCloseLock modules ["revrec","gl","bank_rec"], merging into any existing lock row for that period.
- Quarter/year cycles roll up child periods as pre_close items (`month-YYYY-MM` / `quarter-YYYY-Qn` must be signed off first).
- Year-end retained-earnings rollover posts with sourceKind "year_close", sourceRef `${entityId}:${year}`; it is exempt from month locks but blocked by an annual `YYYY` lock. Idempotent (alreadyPosted).
- Accrual approve posts a kind "accrual" / sourceKind "close_accrual" journal dated last day of the month; requires the entity's chart seeded (400 missing_account otherwise).
- **Collections Agent only reads `isDefault: true` dunning ladders**, keyed by invoice `jurisdiction` — a non-default ladder is silently ignored (invoices count as "not yet due"). Probe tests should use a unique jurisdiction to avoid colliding with a real default ladder.
- Escalation drafts (ladder exhausted) are internal: approve-send marks them sent via "internal" with NO email and NO dunning event; normal sends re-validate invoice state, event count === stepIndex, and open future promise-to-pay at send time.
- Probe: `artifacts/api-server/scripts/close-probe.ts` (period 2019-01/year 2019, tag __T432, self-cleaning; personas p_mounir_ariss + p_gokhan_guney for the two-partner flow).
