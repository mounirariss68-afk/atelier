---
name: Roster quick-add & shared login provisioning
description: Direct roster create bypasses the hiring pipeline; portal logins have exactly one provisioning helper.
---

- Roster people can be created two ways: the formal pipeline (candidate → offer → invitation accept materialises the person) and the quick-add direct create (`POST /roster/people`, employee/contractor only — partner-firm resources must go through the firm registry pipeline). Both gate on the invitation permission (`isPartnerOrOps`: founding_partner/partner/finance/hr).
- **Portal logins are created ONLY via the shared `provisionPortalLogin` helper** in the roster lifecycle routes (credential row with random placeholder hash + `userManaged: true` + `mustChangeReason: "joiner"`, one-time 72h activation token, welcome email, M365 provisioning). Any new surface that needs a login must call it — never re-implement credential/token writes.
  - **Why:** duplicated login logic previously risked seed-overwrite and token-handling drift; the helper also auto-completes an onboarding sequence when login was the last step.
  - **How to apply:** pass `onboarding: null` for login-without-onboarding; the helper audits `onboarding.login.created` against entityType person in that case.
- Quick-add audits `roster.person.created` with `payload.method: "quick_add"`; duplicate roster email → 409 before any row is written; a login failure after person creation is reported in the 201 body (`login.ok:false`), never rolled back.
