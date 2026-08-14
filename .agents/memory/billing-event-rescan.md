---
name: Durable deferred-retry principle for locked background runs
description: When a single-flight lock forces skipping a triggered run, the retry signal must be durable + CAS-acknowledged.
---

**Rule:** when an event-triggered background run is skipped because a single-flight lock is held, never park the retry in process memory (timers/Sets). Persist a per-scope pending signal (atomic upsert so duplicates coalesce across instances) and consume it at every point the lock can free: right after arming, on run completion AND failure, and in boot recovery. Acknowledge the signal only after a successor run has actually started, using compare-and-set on the arm time so a signal re-armed mid-consume is retained.

**Why:** review rejected both an in-process retry loop (duplicates across instances, lost on restart) and a timestamp-window rescan (release-then-rescan gap lets a competing run advance the coverage boundary past an unprocessed event).

**How to apply:** any future "run again once the lock frees" requirement on the durable job registry — model the pending state in the DB, chain through the same lock, and make ack conditional on witnessing the arm you consumed.
