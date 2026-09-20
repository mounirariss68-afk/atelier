---
name: Engagement mobilization safety
description: General consistency rules for staffing readiness and access provenance.
---

Treat readiness as one consistent snapshot: activation and every write that changes its inputs must participate in the same serialization boundary. Measure coverage and capacity over each time interval rather than summing every record that overlaps somewhere.

**Why:** Otherwise activation can approve stale inputs, while broad overlap sums create false positives and false negatives when allocations vary over time.

**How to apply:** Any future readiness input or lifecycle action must join the existing serialization order and interval-based evaluation.

Access created as a side effect of staffing must remain distinguishable from access granted for an independent reason. Staffing lifecycle changes may alter only staffing-derived access.

**Why:** A shared access row can represent leadership, review, or manual grants; treating all access as staffing-derived can silently remove valid permissions.

**How to apply:** Preserve independent access unchanged. Recalculate derived access from all live staffing commitments and remove it only when none remain.