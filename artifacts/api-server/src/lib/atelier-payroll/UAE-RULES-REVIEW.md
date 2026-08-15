# UAE payroll rules review — Task #1135 (August 2026)

Review of the AE entries in `statutoryRules.ts` against **Federal
Decree-Law 33/2021** (the Labour Law), **Cabinet Resolution 1/2022**
(its executive regulations), **Federal Decree-Law 13/2022** (ILOE) and
GPSSA pension law (Law 7/1999 old regime; **Federal Law 57/2023** new
regime). Corrections ship as new effective-dated registry versions —
history is never rewritten except where the original entry was
factually wrong at its own effective date (noted below).

## Confirmed correct (no change)

| Rule | Registry value | Law reference | Verdict |
| --- | --- | --- | --- |
| Gratuity bands | 21 days/yr (first 5 yrs), 30 days/yr after | Art. 51(2) 33/2021 | ✔ |
| Wage basis | **Basic** wage (allowances excluded) | Art. 51(1) | ✔ |
| Minimum service | 1 full year | Art. 51(1) | ✔ |
| Cap | 2 years' wage (24 months) | Art. 51(2) | ✔ |
| Resignation | No forfeiture/reduction (33/2021 abolished the old sliding scale) | Art. 51 | ✔ |
| GCC-national exclusion | AE + GCC nationals route to pension (GPSSA), not EOSB | GCC unified protection system | ✔ |
| GPSSA old regime (registered pre-2023-10-31) | employer 12.5%, employee 5%, ceiling AED 50k | Law 7/1999 | ✔ |
| GPSSA new regime (Law 57/2023) | employer 15%, employee 11%, ceiling AED 70k | Law 57/2023 | ✔ |

## Corrections applied

1. **ILOE effective date + tiers.** The registry carried a flat AED 5/mo
   employee premium from 2022-02-02. ILOE (Decree-Law 13/2022) only took
   effect **2023-01-01**, and the premium is tiered: **AED 5/mo when
   basic ≤ AED 16,000 (Cat A), AED 10/mo above (Cat B)**. Fixed by
   removing ILOE from the 2022-02-02 version (factually absent then) and
   appending a **2023-01-01 version** with `employeeFixedTiers`. ILOE is
   an **employee obligation the employer facilitates as a deduction** —
   it stays an employee-side amount, never an employer cost.
2. **Labor rules added** (new `labor` block on the 2022-02-02 version):
   - **Deduction caps** — advance recovery ≤ **20%** of the wage,
     all deductions combined ≤ **50%** (Art. 25). The run engine also
     floors net pay at zero; unrecovered installments roll forward.
   - **Unpaid leave excluded from service** — Art. 51(6): unpaid-leave
     days do not count toward the EOSB service term. Applied to both the
     monthly accrual and settlement service-year computations.
   - **Notice** — 30–90 days (Art. 43); pay in lieu equals the wage for
     the unserved period; the defaulting party owes it (employer pays on
     termination, recovered from the employee on resignation).
   - **Probation** — max 6 months; employer termination during probation
     needs 14 days' notice (Art. 9). Gratuity is nil (< 1 year service).
   - **Leave encashment basis** — **basic** wage (Art. 29(9)), computed
     from the employee's actual accrued balance in the leave module at
     daily rate = basic / 30.

## Engine behaviors this review mandates

- **Proration** is calendar-day within the month (payable days /
  days-in-month), covering mid-month joiners/leavers and approved unpaid
  leave; each day is valued at the comp package in effect that day, so a
  mid-month raise splits exactly. EOSB uses the **last basic wage**
  (package in effect on the last employed day), per Art. 51(1).
- **Salary advances** are an asset (account **1150 Salary advances
  receivable**): cash out at issuance (Dr 1150 / Cr 1000), drawn down by
  run deductions and settlement offsets (Cr 1150) — never expensed.
- **Final pay** = gratuity + leave encashment + notice(±) + final-month
  prorated salary (only when no posted statutory run already pays it)
  − outstanding advances; must be ≥ 0 to settle.
- **Free-zone regimes** (`EntityStatutory.freeZoneRegime`) remain
  informational; DIFC DEWS is explicitly out of scope (future work).
- **Overtime** is out of scope: all covered roles are salaried exempt —
  documented exclusion, not a silent omission.

## Dual-path consolidation (decision)

The legacy "simple monthly" payroll (`/payroll/*`, Task #654) and the
statutory engine (`/finance/payroll/*`, Task #655) both post
Dr 6000 / Cr 2100 salary journals. Decision: **the statutory engine is
the system of record for salary journals**. Hard guards (409) in both
directions prevent the same entity/period being posted by both paths:
`approvePayrollRunCore` refuses when a posted statutory run exists;
`postPayrollRun` refuses when a legacy run for the entity/period has
been approved. The legacy path is retained (not deleted) only for
entities/periods the statutory engine does not cover.
