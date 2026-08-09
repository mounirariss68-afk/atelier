-- Task #821 — two-factor authentication (TOTP).
-- Credentials: enrolment state, encrypted secret, anti-replay step marker,
-- hashed single-use backup codes. Sessions: step-up freshness stamp.
ALTER TABLE "atelier_auth_credentials" ADD COLUMN IF NOT EXISTS "totp_enabled" boolean NOT NULL DEFAULT false;
ALTER TABLE "atelier_auth_credentials" ADD COLUMN IF NOT EXISTS "totp_secret_enc" text;
ALTER TABLE "atelier_auth_credentials" ADD COLUMN IF NOT EXISTS "totp_last_step" integer;
ALTER TABLE "atelier_auth_credentials" ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb;
ALTER TABLE "atelier_auth_sessions" ADD COLUMN IF NOT EXISTS "totp_verified_at" timestamp;
