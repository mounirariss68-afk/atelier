---
name: Riser evaluation publish gate
description: Why the publish canary uses source-bound security evidence instead of provisioning a scratch database.
---

The publish builder runs live database-free Riser evaluation but checks reviewed, source-bound evidence for the database-backed security and concurrency observations. A full isolated evaluation must refresh that evidence before publishing changes to the covered authority sources.

**Why:** The deployment builder's scratch-database Drizzle push hung until its 180-second timeout, blocking publication even though the same security suite passed in the development environment. Removing the security gate outright would silently weaken the release boundary.

**How to apply:** Run the full Riser evaluation in an environment with an isolated scratch database and review its generated security evidence and report. Do not fake a passing snapshot or expand the publish builder's database privileges. Keep the source binding aligned with any newly introduced authority dependencies of the security probes.

Action coverage must distinguish **tool selection** from **committed action evidence**. A smoke prompt that selects a write tool is not proof that confirmation, persisted state, and audit all succeeded. Track such actions as missing action-level evidence until a runnable assertion covers the outcome; do not relabel a generic dispatch check as action-specific.

**Why:** An early coverage matrix mistakenly labeled intent-only smoke prompts as supported actions, and the first vertical probe assumed its stubbed receipt parser and turn replay behaved differently from the actual runtime. The honest matrix exposed real, pre-existing gaps without claiming they passed.

**How to apply:** Keep a ratchet for known missing actions, block new unproven high-risk writes, and include executable vertical observations only after their source-of-truth assertions have run in scratch DB. For idempotent CLI turn retries, use both the original session and client turn key; inspect the returned turn identity rather than assuming a replay boolean is emitted.