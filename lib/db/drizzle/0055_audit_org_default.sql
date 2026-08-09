-- Task #822 — tenant-correct audit attribution. Audit writers that omit
-- org_id previously fell back to the static 'aico' default; now the default
-- picks up the request's RLS org (app.org_id GUC set by the api-server) so
-- events are attributed to the tenant performing the action.
ALTER TABLE "atelier_audit_events"
  ALTER COLUMN "org_id" SET DEFAULT coalesce(nullif(current_setting('app.org_id', true), ''), 'aico');
