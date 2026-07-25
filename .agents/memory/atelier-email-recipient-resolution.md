---
name: Chat email recipient name resolution
description: How chat email tools resolve people names to addresses and the company-document email split
---
Rule: any chat capability that accepts a `to` list must run entries through the shared email-recipient resolver — raw emails pass through, names resolve against roster + CRM contacts (contact candidates ACL-filtered via canSeeAccount BEFORE capping); 1 match → resolved email pinned into the two-phase pending input, >1 → `email_recipient` disambiguation (option id = email), 0 → recipient_not_found (there is no invalid_recipients path for names anymore).

**Why:** "email X to Gokhan" used to fail because tools only accepted raw addresses; pinning the resolved email in pending input keeps the confirm card and the commit atomically consistent.

**How to apply:** personal docs go through the me.* email tool; company Document Library docs go through the separate `document.email` capability (module meta, deliberately NOT me.* so self-only roles never get it; visibility via canSeeDocument). New email-out surfaces reuse the resolver, never re-implement name lookup.
