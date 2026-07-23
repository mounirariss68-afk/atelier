---
name: Demo-account showcase data
description: How the App Store demo persona's fake profile/expenses/meetings are maintained and kept invisible to real users
---

The read-only App Store demo persona ("Max Headrom", p_demo_reviewer) gets its showcase data (name/initials/phone, 3 expenses, 3 "Catch up" internal meetings with fictional attendees) ONLY from the boot seed's ensureDemoAccount/ensureDemoShowcaseData — demoReadOnlyGuard 403s all its REST writes, so REST seeding is impossible.

**Why:** the no-seeding policy stands for real data; this is a user-approved exception strictly scoped to the demo user. Demo meetings created by the demo user are explicitly filtered out of internalMeetingsForWindow for every non-demo viewer, or founders' real calendars get polluted (founding_partner sees all internal meetings).

Demo chat: demoReadOnlyGuard allowlists exactly POST /atelier/cli/turn for the demo user; /cli/turn short-circuits demo turns into runDemoShowcaseTurn (lib/atelier-cli/demo-showcase.ts) — deterministic canned capability/topic cards, no LLM/tools/DB, nothing persisted. /cli/turn/:id/confirm and all other writes stay 403. If new chat entry surfaces are added, they must either short-circuit for the demo user the same way or stay blocked.

**How to apply:** any new surface that lists internal meetings broadly must exclude `createdByUserId === DEMO_USER_ID` for non-demo viewers. Demo meetings roll forward into the upcoming week on each boot; expenses insert once by fixed id (exp_demo_1..3, personId = user id).
