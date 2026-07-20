---
name: Chat person lookups cross-domain fallback
description: contact_detail/person_detail auto-fallback between CRM contacts and internal roster; narration marker strip
---

- `contact_detail` and `person_detail` (atelier-cli people reads) each auto-fall-back to the sibling domain on a miss: CRM miss → caller-scoped roster (`internalPersonFallback`), roster miss → `canSeeAccount`-gated CRM contacts (`crmContactFallback`). Fallback payloads carry `source` + `note`; not_found messages name both domains.
- **Why:** "phone of Mounir" (internal founder) dead-ended in contact_detail; "CEO of tasama" wrongly hit roster. One tool call must be enough.
- **How to apply:** any new person-shaped chat read must either cross-check both domains or clearly say it didn't. ACL rule: fetch a wide candidate set BEFORE the visibility filter, then cap — filtering after a small LIMIT false-negatives restricted callers.
- Narration frames are stripped of leading `final:`/`answer:`/`narration:` markers server-side at the record() point; the SYSTEM_PROMPT also forbids them. Mobile ResultCards: money formatting is opt-in by key (never bare `value`/`total`), meta keys (total/scoped/source/note/prompt) never render as rows, empty lists render "No results" prose, not_found renders muted (not red).
