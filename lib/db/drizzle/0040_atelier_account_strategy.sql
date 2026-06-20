-- Task #566 — Cognirise-authored account strategy + competitive landscape.
-- Both nullable/defaulted so existing rows need no backfill.
-- accountStrategy: { objectives[{id,text,targetValue?,targetDate?}],
--                    targetServiceLines[], winHypothesis, keyPlays[] }
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "account_strategy" jsonb;
-- competitors: [{id, name, holds?, displacementAngle?}]
ALTER TABLE "atelier_accounts" ADD COLUMN IF NOT EXISTS "competitors" jsonb DEFAULT '[]'::jsonb NOT NULL;
