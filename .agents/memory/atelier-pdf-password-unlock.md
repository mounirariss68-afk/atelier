---
name: PDF password unlock flow
description: Document unlock passwords are transient secrets — every layer (HTTP ingress, chat orchestrator, capabilities) must preserve them byte-for-byte in flight and persist them nowhere
---

Rule: a document unlock password is a TRANSIENT secret. It travels only
in-memory to the parser call, byte-for-byte (no trim, no cap, no
normalization — reject only empty), and must never land in any durable or
streamed surface: turn prompts, frames, tool-call records, clarification
partials, confirm pins, pending writes, session facts/summaries/titles, logs.

**Why:** the chat stack persists prompts, frames, tool calls, and pending
pins wholesale, and HTTP ingress trims/caps every prompt and truncates
clarification values. A capability that keeps its own partials clean is NOT
enough — without sensitive-aware handling at ingress AND in the
orchestrator, the secret is either stored (privacy breach) or silently
corrupted (a trimmed space or truncated tail makes a valid password fail as
"incorrect").

**How to apply:**
- HTTP ingress must detect a pending sensitive clarification BEFORE any
  prompt normalization, and only then bypass trim/caps/slash-command
  routing for that answer; ordinary requests keep the normal limits.
  Fail-closed: detection errors mean normal limits.
- The orchestrator persists a fixed placeholder as the answer turn's prompt
  and deep-REMOVES sensitive keys (removal, not masking — a rehydrated
  "[redacted]" literal would replay as the password) from every
  frame/tool-call/pin/fact at record time; resolver/LLM assists and the
  bare-prompt freshness gate are bypassed so the answer merges verbatim and
  can't be misrouted as a fresh request.
- After a successful unlocked parse, continuations must NOT re-parse (the
  password is gone): pin the parse job id + an HMAC token binding it to the
  attachment and re-fetch the job on resume; forged tokens degrade to a
  fresh parse, which re-asks.
- A wrong password gets a distinct "didn't unlock" retry clarification,
  never a generic failure.
- Testing: capability-level tests cannot see ingress mutations or
  orchestrator persistence — leak/byte-exactness checks must drive the real
  HTTP route end-to-end, using passwords with leading/trailing whitespace
  and lengths beyond every ingress cap, asserting both what the parser
  stub receives and what every persisted row contains.
