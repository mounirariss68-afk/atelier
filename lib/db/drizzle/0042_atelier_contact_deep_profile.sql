-- Task #589 — deep stakeholder profiles on contacts (account-research Step 4).
-- The Account Cartographer now researches a contact's tenure, career history,
-- and education. Career/education are JSON arrays of small objects; time in role
-- is free text. All nullable / default empty so existing rows need no backfill.
ALTER TABLE "atelier_contacts" ADD COLUMN IF NOT EXISTS "time_in_role" text;
ALTER TABLE "atelier_contacts" ADD COLUMN IF NOT EXISTS "career_history" jsonb DEFAULT '[]'::jsonb NOT NULL;
ALTER TABLE "atelier_contacts" ADD COLUMN IF NOT EXISTS "education" jsonb DEFAULT '[]'::jsonb NOT NULL;
