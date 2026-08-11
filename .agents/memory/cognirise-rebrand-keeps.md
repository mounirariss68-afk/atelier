---
name: Cognirise rebrand — intentional "aico" keeps
description: Which "aico" tokens are deliberately retained after the AICo→Cognirise rename, and the grep blind spot that hides enum literals.
---

# Cognirise rebrand: what "aico" survivors are intentional

The Atelier product was renamed AICo → Cognirise. The rename covered all display
text, code identifiers, DB column names, agent enum literals, the salon `/team`
contract key, demo domains, and the artifact title.

**Deliberately KEPT (do NOT "finish the rename" on these):**
- The tenant org key value `"aico"` — `org_id` columns, `default("aico")`,
  `ORG`/`ORG_ID` test constants, `orgId` fallbacks (`?? "aico"`), RLS session GUC
  default, and explanatory comments about the org default.
- Opaque DB record-ID *values* embedding `aico`: `fe_aico_*`, `ba_aico_*`,
  `rcr_aico_*`, `mpol_aico_*`, `rc_aico_*`, `cmp_*_aico`, `cmp_v3_*_aico`,
  `cp_party_*_aico`, payroll/workspace ids like `W11_*`.

**Why:** The user explicitly chose to keep the opaque internal keys so historical
records, FK joins, and the tenant key stay stable; only human-facing/branding
surfaces change. Renaming these would risk breaking joins and seeded data.

**How to apply:** When auditing for leftover `aico`, exclude the keep-list above.
If asked to rename the tenant key itself later, that is a separate, riskier task
(touches every org-scoped row + RLS).

## Grep blind spot that bit us
A quoted `"aico"` is NOT always the org key. It can be a **business enum literal**
that must be renamed — e.g. a recipient `side: "aico" | "counterparty"` union.
Do not blanket-filter every quoted `"aico"` as "org key" when verifying; classify
each: org-key/RLS/test-const/comment → keep; enum/contract literal → rename.
Runner-side and codex/docusign-side `side` unions must agree (`"cognirise" |
"counterparty"`).

- The visual brand is now purple/magenta/coral (dotted-C mark); the CSS token names `--gold*` were RETAINED for stability but hold purple values (#C45BB8 etc). Never design new assets in literal navy/gold from stale docs — read `src/index.css` token values first. The Riser assistant avatar (`atelier/src/assets/riser-avatar.png`, mirrored in `atelier-mobile/assets/images/`) follows this palette.
