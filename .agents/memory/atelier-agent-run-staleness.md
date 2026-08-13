---
name: Agent-run staleness rules
description: Dead agent runs — boot sweep + 2h heartbeat freshness rule for every reader of "running" agent runs
---

Agent runs are plain in-process promises: a crash or wedged promise leaves rows stuck at status "running" forever, so the bell/status chips spin indefinitely and relaunch guards stay locked.

**Rule:** anything treating a "running" agent run as actually in flight — bell pseudo-jobs, duplicate-run guards, per-agent status loaders, the monitor list/detail, and the in-memory launch maps — must apply the shared staleness helpers (shared run-staleness helpers): the SQL freshness predicate for queries, the row/launch-entry normalizers for rows already in hand (stale running → error), and the boot sweep chore that repairs rows after a restart.

**Why:** the durable background-jobs registry has its own sweep/reaper, but agent runs did not; read-time freshness is also the only defense that fixes production before its next deploy (prod DB is read-only to the agent).

**In-memory launch maps:** start time alone must never declare a launch dead — a >2h run still heartbeating its durable row is live (check the fresh-running-row predicate first). Reclaiming a wedged slot needs an ownership token: the ousted promise's completion/cleanup writes must no-op once a newer launch owns the slot, or its late settlement clobbers the new run's state.

**How to apply:** new readers of running agent runs include the freshness predicate in the WHERE (or normalize the status at render). Heartbeat = updated_at stamped by runner progress callbacks; if a new agent can legitimately go >2h without progress it must heartbeat mid-call or the threshold needs raising.
