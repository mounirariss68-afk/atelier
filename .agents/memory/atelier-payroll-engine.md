---
name: Statutory payroll engine invariants
description: Durable rules for the statutory payroll engine — comp history, advances, EOSB final pay, dual-path guard. Read before touching payroll compute/post/settle paths.
---

- **Comp history is the pay SoT.** Runs value each day from effective-dated comp-change records; the roster row is only a no-history fallback. The first recorded change must also capture the prior package as a baseline, or a mid-month raise silently applies to the whole month.
- **Everything money-per-month is segment-weighted.** Pay, housing allowance, AND statutory contribution amounts must be computed per comp segment weighted by paid days — never "end-of-month wage × proration factor". Payslips/run lines carry the prorated figures, not contractual monthly ones.
- **Salary advances are an entity-scoped asset, never expense.** Recovery paths (run deductions, settlement offsets) must filter advances by the issuing legal entity — after an employee transfer, another entity's run must not deduct or clear the asset. Deductions respect the AE legal caps and never push net negative; shortfall rolls forward.
- **Settlement figures are settle-time, not draft-time.** A draft settlement's advance offset is a snapshot; settling must recompute current outstanding and derive both the GL credit and the payable from the exact repayments applied.
- **Final-salary inclusion is employee-line scoped.** "Already paid by a posted run" means that employee has a line in the posted run for the leave month — a run that merely exists (but excluded them) must not suppress their final salary.
- **Payslips ride the idempotent re-post.** The already-posted early-return path regenerates missing payslip documents, making re-post the repair path after a partial failure.
- **Final-month salary is paid EXACTLY once — settlement or run, never both.** Compute drops employees whose settled EOSB settlement already included that month's salary; settle re-derives salary inclusion under the shared period lock from the current posted-line state; post 409s if a leaver on the draft was settled with salary after compute.
- **Salary-journal posting is atomic + advisory-locked.** Journal, advance repayments and status flip commit in ONE transaction; every path that posts salaries for an entity/period (statutory post, legacy approve) takes the shared per-entity/period advisory lock before its cross-path guard, and advance rows are locked FOR UPDATE before validating deductions.
- **Dual-path guard is bidirectional and checked before cheaper validations** (an empty legacy run must not mask the guard). The statutory engine is the system of record for salary journals (see UAE-RULES-REVIEW.md in the payroll lib).

**Why:** every rule above corresponds to a real defect caught in probes/review: whole-month raises, contribution bases charged at raised wage all month, cross-entity advance clearing, stale advance snapshots over-crediting the asset, missing payslips after partial post, and empty-run masking of the guard.
