---
name: Post-merge database push timeout
description: The schema pull in post-merge setup can exceed the former 90-second allowance.
---

Keep the post-merge setup timeout at five minutes when the script runs the database schema push.

**Why:** A normal schema pull and push completed successfully in about 92 seconds, just beyond the former 90-second limit. The platform reported the task as stuck in merging even though Git had merged correctly.

**How to apply:** When a merge setup log stops at “Pulling schema from database,” distinguish a real schema failure from timeout. Preserve the idempotent script and rerun with the five-minute allowance.