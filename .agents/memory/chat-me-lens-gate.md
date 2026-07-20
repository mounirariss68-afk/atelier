---
name: Chat blocked for Me-lens personas
description: /cli/turn is 403 for contractor/employee/partner_firm_resource via the central boundary gate; capability ACLs are the second layer.
---
Restricted personas (contractor, employee, partner_firm_resource) never reach the chat orchestrator: the central Me-lens boundary gate in the atelier router rejects `/cli/*` with 403 (error codes `contractor-self-scope`, `employee-self-scope`, `non-employee-persona-not-allowed-here`).

**Why:** Their whole world is `/me/*` + `/personas`; chat is org-wide. Roster capability ACLs (roster_list/person_reports deny on isRestrictedPersona; person_detail via roster-scope predicate + hard card projection stripping CHAT_PERSON_FORBIDDEN_FIELDS) are defense-in-depth only.

**How to apply:** If chat is ever opened to these personas, the boundary gate must be relaxed deliberately and the capability probe (tests/crm/chat-roster-acl-probe.ts) re-run — it pins both layers. Capability entries can be exercised in-process via `findByToolName(...).run(input, { persona })`.
