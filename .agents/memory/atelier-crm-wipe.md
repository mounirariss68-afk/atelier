---
name: No demo seeding — production data policy
description: All dummy-data seeding was removed (2026-07-16); DB holds only real data + 2 login users + config seeds (auth, reference data, baseline rate card). Never reintroduce demo seeders.
---
**Rule:** The database contains ONLY real user-entered data plus the two login users (`p_mounir_ariss`, `p_gokhan_guney`). The ONLY boot-time seeds are configuration, not demo data: (1) auth credential seed, (2) reference-data seed (countries/industries/sub-industries — `atelier-seed-reference.ts`, self-healing, ON CONFLICT DO NOTHING under an advisory lock, gated on row count below canonical), (3) baseline rate-card + margin-policy seed (`atelier-seed-pricing.ts`, existence-gated). All demo seeders (atelier/tasama/arcelik demo data, v5, agents-lens, l2c, account-plan, post-merge seed steps) stay deleted.

**Why:** the project is in production; the user ordered all dummy data deleted. But wiping reference tables broke every country/industry dropdown (blank comboboxes) — reference data is config the app cannot function without, and the production DB starts empty too, so it must seed at boot.

**How to apply:** never add demo-data seed steps to post-merge, boot, or workflows. Config seeds must be idempotent, gated so user edits are never overwritten, and live in the API server boot path (not scripts) so production gets them. Tests create and clean up their own tagged rows only.
