---
name: Engagement mobilization safety
description: Durable concurrency and access-provenance rules for won-project staffing.
---

Activation readiness and every write that can change readiness must use the same engagement advisory-lock protocol. Capacity-affecting assignment transitions also lock the affected person, with deterministic engagement-then-person ordering. Coverage and capacity are checked across date intervals, not by summing every assignment that overlaps anywhere.

**Why:** Validation outside the shared lock can activate against a stale staffing plan. A single overlap-wide allocation sum also creates both false readiness and false capacity conflicts when allocations vary over time.

**How to apply:** New requirement edits, assignment lifecycle actions, and activation checks must participate in the lock protocol and use interval-boundary allocation sweeps.

Engagement access created by mobilization must carry explicit assignment provenance. Assignment end/replacement may revoke only access that was created by mobilization; independent lead, reviewer, or manually granted access must remain untouched.

**Why:** Engagement access is both staffing metadata and an ACL. Reusing its unique person-engagement row without provenance can silently remove access that existed before mobilization.

**How to apply:** Preserve independent rows exactly. Keep derived access active while any accepted assignment remains, update its provenance deterministically, and revoke it only after the final accepted assignment ends.