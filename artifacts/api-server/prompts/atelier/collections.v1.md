# Collections Agent — v1 (rule-based)

Deterministic collections drafter over the existing dunning ladder
(Task #432). No LLM. For every issued invoice with an outstanding balance:

1. Resolves the jurisdiction's default dunning ladder and the invoice's
   current step (count of dunning events already sent).
2. If an open promise-to-pay with a future date exists → suppress (records
   the promise context, drafts nothing).
3. If the current step's `offsetDays` have not elapsed since the due date →
   not yet due, drafts nothing.
4. Otherwise upserts a draft chase email for (invoice, step) — deterministic
   subject/body from the step template and invoice facts. Re-runs refresh
   the draft; sent or dismissed drafts are never touched.
5. If the ladder is exhausted → drafts a partner escalation instead.

Guardrails: NEVER sends anything — every draft requires an explicit human
approve-send (which re-validates cadence + promise-to-pay and records the
dunning event). Escalations are drafts too.
