import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureAtelierAuthSeed } from "./lib/atelier-seed-auth";
import { ensureAtelierSelfLinkage } from "./lib/atelier-self-linkage";
import { ensureAtelierReferenceSeed } from "./lib/atelier-seed-reference";
import { ensureAtelierPricingSeed } from "./lib/atelier-seed-pricing";
import { startLedgerNudgeJob } from "./lib/atelier-agents/ledgerNudges";
import { applyAtelierCliRagSql } from "./lib/atelier-cli/rag-bootstrap";
import { warmEmbedder } from "./lib/atelier-cli/embeddings";
import { backfillChunkEmbeddings } from "./lib/atelier-cli/attachments/retrieval";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  startScheduler();
  // Task #1 — real auth: create credentials/sessions tables if missing and
  // seed the two allowed logins (idempotent; covers production on redeploy).
  // Fail loudly: without this the API is a wall of 401s.
  void ensureAtelierAuthSeed().catch((err) => {
    logger.error({ err }, "Auth credential seed failed — logins will not work");
  });
  // Task #50 — user↔person linkage repair so the Me lens resolves a roster
  // record for every existing user (data-only identity repair, not seeding).
  void ensureAtelierSelfLinkage().catch((err) => {
    logger.error(
      { err },
      "Self-linkage repair failed — /me/profile may miss roster records",
    );
  });
  // All demo-data seeding was removed for production (2026-07-16). The only
  // boot-time seeds left are configuration, not demo data: the auth
  // credential seed above, the reference-data seed (countries / industries /
  // sub-industries — the dropdowns are unusable without it), and the
  // baseline rate-card + margin-policy seed (Pricing is a wall of 409s
  // without an active rate card). All are gated on empty tables so user
  // edits are never overwritten. Real CRM data is entered through the app.
  void ensureAtelierReferenceSeed().catch((err) => {
    logger.error(
      { err },
      "Reference-data seed failed — country/industry dropdowns will be empty",
    );
  });
  void ensureAtelierPricingSeed().catch((err) => {
    logger.error(
      { err },
      "Pricing seed failed — Pricing module has no active rate card",
    );
  });
  // Task #108 — regression tripwire: dummy/test data was permanently purged
  // (2026-07-17). Count accounts and scream if any row matching the old test
  // tag patterns ever reappears, so reintroduction is visible immediately.
  void (async () => {
    const res = await db.execute<{ accounts: string; tagged: string }>(sql`
      SELECT
        (SELECT count(*) FROM atelier_accounts WHERE deleted_at IS NULL) AS accounts,
        (
          (SELECT count(*) FROM atelier_accounts WHERE id ~ 't542|t627' OR name ~ '__t542|t627')
          + (SELECT count(*) FROM atelier_opportunities WHERE id ~ 't542|t627' OR name ~ '__t542|t627')
          + (SELECT count(*) FROM atelier_engagements WHERE id ~ 't542|t627' OR name ~ '__t542|t627')
          + (SELECT count(*) FROM atelier_users WHERE id LIKE 'p_test_%')
        ) AS tagged
    `);
    const row = res.rows[0];
    const tagged = Number(row?.tagged ?? 0);
    logger.info(
      { accounts: Number(row?.accounts ?? 0), taggedTestRows: tagged },
      "Data tripwire: account count at boot",
    );
    if (tagged > 0) {
      logger.error(
        { taggedTestRows: tagged },
        "DATA TRIPWIRE: rows matching test tag patterns (t542/t627/p_test_*) exist — test data is leaking into the live database again",
      );
    }
  })().catch((err) => {
    logger.warn({ err }, "Data tripwire check failed");
  });
  // v3 Ledger: Sun 21:00 GST submit-due / Tue 12:00 GST approve-due nudges
  // (writes audit_event rows; idempotent per (week, kind)).
  startLedgerNudgeJob();
  // Task #411 — install pg_trgm + pgvector (when available) and the
  // GIN trgm indexes the hybrid resolver hits. Idempotent.
  void applyAtelierCliRagSql()
    .then(async () => {
      // Task #575 — warm the local embedding model and backfill any
      // documents that lack current-provider chunk vectors (re-embed
      // migration). Guarded by a pg advisory lock so only one instance
      // runs the backfill across a multi-process deploy. Fail loudly if
      // the model can't load: RAG retrieval has no silent lexical-only
      // fallback, so a broken model must crash boot rather than degrade
      // search invisibly.
      try {
        await warmEmbedder();
      } catch (err) {
        logger.fatal(
          { err },
          "Embedding model failed to load — Atelier RAG cannot serve; exiting",
        );
        process.exit(1);
      }
      const LOCK_KEY = 575_000_001;
      const got = await db.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`,
      );
      if (!got.rows[0]?.locked) return;
      try {
        const res = await backfillChunkEmbeddings();
        if (res.attachments > 0) {
          logger.info(
            { ...res },
            "Atelier RAG chunk-embedding backfill complete",
          );
        }
      } finally {
        await db.execute(sql`SELECT pg_advisory_unlock(${LOCK_KEY})`);
      }
    })
    .catch((err) => {
      logger.warn(
        { err },
        "Atelier Chat RAG SQL bootstrap failed — chat will degrade to brute-force resolution",
      );
    });
});
