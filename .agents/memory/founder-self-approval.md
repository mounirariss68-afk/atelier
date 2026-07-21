---
name: Founder expense self-approval
description: Expense self-approval rules — founders self-approve (founder_self), everyone else gets explicit 403.
---
Rule: expense approve/reject checks self first — `founding_partner` approving own claim returns route stamp `founder_self`; any other role gets 403 `{error:"no-self-approval"}` before leadership/HR/lead routes resolve. The /me/approvals digest keeps founders' own claims visible (self-filter skipped for founding_partner only). Every submit (wallet + Me lens) notifies all founders via `notifyFoundersOfSubmittedExpense` (submitting founder skipped).

**Why:** two-founder firm — nobody outranks a founder, so blocking self-approval would deadlock their claims; the distinct stamp keeps the audit trail honest.

**How to apply:** any new expense approve/reject or digest surface must preserve the self-check ordering (self-check FIRST) and the founder digest exception; new submit surfaces must call the founder-notify helper.
