---
name: sendEmail log-only semantics
description: api-server sendEmail returns ok:true in log-only mode — nothing was delivered
---
The api-server email helper returns `{ ok: true, via: "log-only" }` when Resend isn't configured; `ok` does NOT mean the recipient received anything.

**Why:** Callers that surface delivery status (e.g. joiner welcome email) treated `ok` as "sent" would mislead HR into thinking credentials were delivered.

**How to apply:** When exposing delivery outcome to users, treat `via !== "resend"` as not-delivered ("not configured" if ok, "failed" otherwise). Only `ok && via === "resend"` means sent.
