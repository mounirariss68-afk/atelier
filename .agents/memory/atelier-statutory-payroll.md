---
name: Atelier statutory payroll
description: Durable invariants for the country statutory payroll layer (EOSB, social security, WPS filings) for AE/SA/QA/TR
---

- GCC nationals in AE/QA route to pension (GPSSA/GRSIA via the GCC unified protection extension), NOT gratuity — eligibility checks must test GCC membership, not nationality===country.
- Rules registry is pure & effective-dated: later versions override contribution schemes BY KEY and inherit eosb when null; rate changes are appended as new versions, history never edited.
- Payroll run posting is blocked by validation errors (409). Employees with a NULL `legalEntityId` become "unattributed" errors whenever the org has more than one active entity — scratch/test DBs accumulate entities across probe runs, so probes must park or link every unlinked employee row before compute.
- Wage split: `basicWageMonthly` null ⇒ whole `baseCompensation/12` treated as basic; `schemeRegisteredOn` falls back to `startDate` for old/new-law routing (GPSSA Oct-2023, GOSI Jul-2024 boundaries).
- Filing idempotency key is `stat_<entityId>_<obligationKey>_<YYYY-MM>`; overview GET idempotently backfills filings per active covered entity.
- EOSB report response uses {personName, wageMonthly, liabilityToDate, accruedInGl}; settlements use {entitlementGross, adjustmentFactor, finalAmount} — payroll routes are raw-fetch (not in openapi), so UI shapes must be checked against the route, not codegen.
- Cash-13w statutory lines carry EMPLOYER contributions only — roster `dis_payroll_*` lines already hold gross salary (net pay + withholdings); adding those again double-counts salary cash.
- Offboarding auto-drafts the EOSB settlement: joiner deactivation with markLeaver (employees only) calls the shared settlement creator best-effort — failures land in the audit payload, never block deactivation; the close checklist payroll gate is monthly-cycle only (quarter/year use child-signoff rollups).
- TR per-year kıdem ceiling + SGK ceiling update semi-annually with the minimum wage: apply by APPENDING a new effective-dated registry version (official 2026: kıdem 64,948.77; SGK 9×min-wage = 297,270); per-entity `statutory` jsonb overrides (ceilingOverride/employerPctOverride/optOut) exist for interim/entity-specific deviation. Raising ceilings can un-bind test caps — bump test wages so cap assertions still bite.

**Why:** posting money to the GL from partially-linked rosters silently misattributes liabilities; the validation gate + parking pattern keeps runs honest.
**How to apply:** any new payroll surface (probe, seeding, import) must link employees to a legal entity or expect 409 on post; tests: `test:payroll-statutory` (pure) + `tests/payroll-statutory/api-probe.ts` (live API, scratch DB).
