-- Entity-scope fix for the Account Cartographer. A decision-maker's title can
-- sit at the named group OR at one of its operating subsidiaries/brands. Without
-- a scope, a subsidiary CEO (e.g. Al Tayer Insignia) was flattened into "CEO"
-- and read as the parent group's CEO — which is wrong for chair-/owner-led
-- groups that have no group CEO at all. These two nullable columns let a
-- subsidiary executive be stored correctly (entityScope='subsidiary' +
-- entityName='<subsidiary>') and surfaced as a "Subsidiary · X" badge instead
-- of group leadership.
--
-- entity_scope: 'parent_group' | 'subsidiary' | 'division' | 'standalone'.
-- Both columns nullable so existing rows keep validating with no backfill.
-- Idempotent so re-running on a partially migrated DB is safe.
ALTER TABLE "atelier_contacts" ADD COLUMN IF NOT EXISTS "entity_name" text;
ALTER TABLE "atelier_contacts" ADD COLUMN IF NOT EXISTS "entity_scope" text;
