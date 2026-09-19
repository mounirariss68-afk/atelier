-- Task #1342: stable-person relationship classification and idempotent admin mappings.
ALTER TABLE "atelier_nep_comp_plans"
 ADD COLUMN IF NOT EXISTS "governing_contract_id" text,
 ADD COLUMN IF NOT EXISTS "governing_contract_version_id" text;

CREATE TABLE IF NOT EXISTS "atelier_person_relationship_classifications" (
 "id" text PRIMARY KEY NOT NULL, "org_id" text NOT NULL DEFAULT 'aico', "person_id" text NOT NULL,
 "relationship_type" text NOT NULL, "compensation_basis" text, "status" text NOT NULL DEFAULT 'active',
 "effective_from" date NOT NULL, "effective_to" date, "source" text NOT NULL DEFAULT 'admin',
 "provenance_id" text, "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(),
 "created_by_user_id" text, "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_person_relationship_effective" ON "atelier_person_relationship_classifications" ("org_id","person_id","effective_from");
CREATE INDEX IF NOT EXISTS "idx_atelier_person_relationship_person" ON "atelier_person_relationship_classifications" ("org_id","person_id");
CREATE TABLE IF NOT EXISTS "atelier_admin_person_mappings" (
 "id" text PRIMARY KEY NOT NULL, "org_id" text NOT NULL DEFAULT 'aico', "stable_key" text NOT NULL, "person_id" text NOT NULL,
 "metadata" jsonb NOT NULL DEFAULT '{}', "created_at" timestamp NOT NULL DEFAULT now(), "updated_at" timestamp NOT NULL DEFAULT now(),
 "created_by_user_id" text, "deleted_at" timestamp
);
CREATE UNIQUE INDEX IF NOT EXISTS "uq_atelier_admin_mapping_key" ON "atelier_admin_person_mappings" ("org_id","stable_key");
DO $$ BEGIN
 ALTER TABLE "atelier_person_relationship_classifications" ENABLE ROW LEVEL SECURITY;
 ALTER TABLE "atelier_person_relationship_classifications" FORCE ROW LEVEL SECURITY;
 DROP POLICY IF EXISTS "atelier_person_relationship_org" ON "atelier_person_relationship_classifications";
 CREATE POLICY "atelier_person_relationship_org" ON "atelier_person_relationship_classifications" USING (org_id=atelier_current_org()) WITH CHECK (org_id=atelier_current_org());
 ALTER TABLE "atelier_admin_person_mappings" ENABLE ROW LEVEL SECURITY;
 ALTER TABLE "atelier_admin_person_mappings" FORCE ROW LEVEL SECURITY;
 DROP POLICY IF EXISTS "atelier_admin_mapping_org" ON "atelier_admin_person_mappings";
 CREATE POLICY "atelier_admin_mapping_org" ON "atelier_admin_person_mappings" USING (org_id=atelier_current_org()) WITH CHECK (org_id=atelier_current_org());
END $$;