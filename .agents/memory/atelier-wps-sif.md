---
name: WPS SIF export & Payroll Clerk
description: UAE WPS SIF generation invariants and the rule-based Payroll Clerk agent pattern
---

- The SIF pipeline is deliberately split: a PURE deterministic format builder (timestamp injected, no DB) and a separate DB export seam that a future Wio API replaces. Keep DB reads out of the builder.
- **Why:** determinism enables pure format tests, and the seam isolates the manual Wio-portal handoff from a future API integration.
- Exempt ≠ invalid: non-AE, DIFC/ADGM free-zone regimes, or an explicit entity WPS-exempt flag produce an on-screen reason and no file; missing employer config or employee bank/MOHRE identifiers are blocking problems listing exactly who/what. UAE IBANs must pass MOD-97, not just the AE+21-digit shape.
- The export must itself materialize the statutory comply register and hard-fail if the WPS filing row can't be linked — never export with a silent null link.
- WPS employee identifiers write only via the audited payroll PATCH; IBAN stays read-only there (pay-hub HR approve remains the sole IBAN write path). GPSSA stays a separate filing line, never in the SIF.
- The clerk agent is rule-based, drafts and flags only (never posts/pays), runs monthly ahead of close under the shared exclusive lock, and supersedes its prior draft notification per org+period on rerun instead of stacking duplicates.
- **Tenant scoping lesson:** new agents must thread the caller's orgId all the way down — entity/user queries, notification recipients, AND the agent-run row (startRun accepts orgId; the schema default is the legacy tenant).
- **How to apply:** future bank-file formats copy this split (pure builder + export seam + guaranteed comply link); multi-org probes should run the flow as a second org and assert no cross-org rows/notifications.
