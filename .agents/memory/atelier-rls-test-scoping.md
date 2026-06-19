---
name: Atelier RLS test scoping
description: Why CRM scoping tests assert helper-functions + app ACL instead of DB table policies, and where restricted personas are blocked.
---

# Atelier RLS / scoping — how to assert it in tests

In this project `DATABASE_URL` connects as a **superuser with BYPASSRLS**, so
Postgres row-level-security table policies are **NOT enforced** on the live
connection — deny policies still return all rows. Do not write tests that expect
table-policy narrowing on the pooled connection; they will give false greens.

**How to apply:** assert scoping at the two layers that ARE observable here:
1. The RLS helper *functions* (pure SQL) under transaction-local GUCs:
   `atelier_current_org()` (COALESCE(NULLIF(app.org_id,''),'aico')) and
   `atelier_engagement_allowed()` (empty `app.engagement_ids` = allow-all; CSV
   membership otherwise; `'__atelier_deny_all__'` sentinel = false). Set them with
   `set_config('app.org_id'|'app.engagement_ids', <val>, true)` inside a `db.transaction`.
2. The application ACL: `accessibleEngagementIds(user)` + `canSeeAccount()`.

**Restricted personas:** `partner_firm_resource` and `contractor` are globally
blocked by a non-employee boundary middleware (routes/atelier/index.ts) — they get
**403** on everything except engagement-scoped routes + `/me` + `/personas` (plus a
couple of ledger paths). So a restricted persona hitting `/accounts` is a 403, not a
filtered 200. Assert the exact 403, not a loose "denied-or-fewer-rows".

**Test harness:** `artifacts/api-server/tests/crm/run.ts` (script `test:crm`,
validation check `test-crm`). Pattern: set env (TEST_DATABASE_URL→DATABASE_URL,
ATELIER_MOCK_AGENTS=1) BEFORE dynamic-importing @workspace/db/app, boot app.listen(0),
auth via `atelier_persona=<id>` cookie, tag rows + clean in finally, scope audit
cleanup by actorId so a shared DB never loses other actors' audit rows.
