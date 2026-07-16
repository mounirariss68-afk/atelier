---
name: Long LLM jobs need a workflow
description: Background tsx probes running multi-minute web-search LLM calls stall/die in agent shell; run them as a temporary workflow instead.
---
Rule: to run a multi-minute LLM job (e.g. Cartographer web-search research) outside the server, register a temporary console workflow (`configureWorkflow` → run → `getWorkflowStatus` → `removeWorkflow`), never `nohup`/`setsid` from the bash tool.

**Why:** two nohup attempts stalled mid-stream for 15-28 min (idle/cap abort timers never fired) and a third was killed by an environment restart, which also wiped its log. The same code completed in ~2 min under a workflow. Short streaming probes (<10s) work fine from the shell.

**How to apply:** any one-off script that awaits `callClaudeJsonWithWebSearch`/agent runners. Also: if a run row is orphaned `running`, mark it failed manually.
