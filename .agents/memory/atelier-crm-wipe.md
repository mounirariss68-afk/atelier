---
name: No demo seeding — production data policy
description: All dummy-data seeding was removed (2026-07-16); DB holds only real data + 2 login users. Never reintroduce seeders.
---
**Rule:** The database contains ONLY real user-entered data plus the two login users (`p_mounir_ariss`, `p_gokhan_guney`) and their auth credentials/sessions. The sole remaining seed is the boot-time auth credential seed in the API server. All other seeders were deleted: the scripts-package demo seeders (atelier/tasama/arcelik/reference + CRM wipe utility), the API boot seeds (pricing, v5, agents-lens, l2c, account-plan), and the post-merge seed steps.

**Why:** the project is moving to production; the user explicitly ordered all dummy data deleted and all seeding removed (keeping only logins). Any resurrected demo rows corrupt real data.

**How to apply:** never add seed steps to post-merge, boot, or workflows. If a module "needs" bootstrap rows (e.g. pricing rate cards were previously boot-seeded), it must be set up by the user through the app or an explicit user-approved one-off. Tests must create and clean up their own tagged rows only.
