---
name: Atelier GL-derived statements
description: Invariants of the GL statement engine that replaced seeded entity financials
---
Entity P&L/BS/CF and working-capital reports are built from the GL journal via pure functions in the api-server finance GL statements module (single grouped SQL agg → in-memory math).

**Invariants to preserve:**
- BS balances and CF ties to Δcash *by construction* — every BS bucket must be classified into ops/investing/financing; adding a new stock bucket without wiring it into buildCfFromStocks breaks the tie-out (residual lands in fxOnCash).
- Intercompany is tagged by account NAME ("intercompany"/"inter-company"/"IC " prefix), not code; eliminations derive from these tagged flows/stocks × avg/closing FX. Default chart has no IC accounts, so eliminations are honest zeros until finance books IC journals.
- Budget vs actuals is firm-level only (committed FP&A scenario); per-entity budget/forecast are honest zeros on purpose.
- `preliminary`/`closedPeriods` come from period-close locks covering the "gl" module; closed-period stability rests on the journal being append-only + locked-period posting rejection.
- Pure math is pinned by `test:finance-reports` (no DB). Route probes: boot app.listen(0) with NODE_ENV=test and cookie `atelier_persona=<real user id>` (role names 401).
