---
name: Riser evaluation publish gate
description: Why the publish canary uses source-bound security evidence instead of provisioning a scratch database.
---

The publish builder runs live database-free Riser evaluation but checks reviewed, source-bound evidence for the database-backed security and concurrency observations. A full isolated evaluation must refresh that evidence before publishing changes to the covered authority sources.

**Why:** The deployment builder's scratch-database Drizzle push hung until its 180-second timeout, blocking publication even though the same security suite passed in the development environment. Removing the security gate outright would silently weaken the release boundary.

**How to apply:** Run the full Riser evaluation in an environment with an isolated scratch database and review its generated security evidence and report. Do not fake a passing snapshot or expand the publish builder's database privileges. Keep the source binding aligned with any newly introduced authority dependencies of the security probes.