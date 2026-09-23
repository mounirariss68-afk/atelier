---
name: CRM relationship semantics
description: Governance rules for account/person aliases and bounded CRM relationship reads.
---

CRM aliases may target canonical accounts or canonical persons. The same normalized alias may belong to multiple visible targets; that is an ambiguity to disclose, never a reason to auto-merge or silently prefer one identity. Archived source records are not live resolution targets, while restoration can reactivate the existing alias history.

**Why:** Alias precedence can silently redirect a natural-language question to the wrong customer or person, and pre-ACL caps can leak or suppress inaccessible candidates. CRM links also cross record types with different visibility rules.

**How to apply:** Resolve against current source rows, authorize each candidate and related record before public caps or counts, traverse only fixed one-hop relationships, keep CRM contacts separate from HR and partner-resource domains, and attach validity/provenance/evidence only from authoritative fields the caller may see.