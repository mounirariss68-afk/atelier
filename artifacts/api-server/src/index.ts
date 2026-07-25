import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureAtelierAuthSeed } from "./lib/atelier-seed-auth";
import { ensureAtelierSelfLinkage } from "./lib/atelier-self-linkage";
import { ensureAtelierReferenceSeed } from "./lib/atelier-seed-reference";
import { ensureAtelierPricingSeed } from "./lib/atelier-seed-pricing";
import { startLedgerNudgeJob } from "./lib/atelier-agents/ledgerNudges";
import { startEsignPolling } from "./lib/atelier-esign";
import { applyAtelierCliRagSql } from "./lib/atelier-cli/rag-bootstrap";
import { warmEmbedder } from "./lib/atelier-cli/embeddings";
import { backfillChunkEmbeddings } from "./lib/atelier-cli/attachments/retrieval";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Task #185 — last-resort process guards. A transient DB disconnect (or any
// stray async failure) must not kill the deployment: log it loudly and keep
// serving. We deliberately do NOT process.exit here — the express request
// path has its own error handling, and the one truly unrecoverable boot
// failure (embedding model load) exits explicitly below.
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "UNHANDLED PROMISE REJECTION — continuing");
});
process.on("uncaughtException", (err) => {
  logger.error({ err }, "UNCAUGHT EXCEPTION — continuing");
});

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
  // Task #185 — these boot chores each open DB connections; running them all
  // in parallel exhausted the platform's connection-attempt permits in prod
  // ("Too many database connection attempts are currently ongoing"). Run them
  // strictly one after another; each still logs its own failure and never
  // blocks the next.
  void (async () => {
    await ensureAtelierAuthSeed().catch((err) => {
      logger.error(
        { err },
        "Auth credential seed failed — logins will not work",
      );
    });
    // Task #50 — user↔person linkage repair so the Me lens resolves a roster
    // record for every existing user (data-only identity repair, not seeding).
    await ensureAtelierSelfLinkage().catch((err) => {
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
    await ensureAtelierReferenceSeed().catch((err) => {
      logger.error(
        { err },
        "Reference-data seed failed — country/industry dropdowns will be empty",
      );
    });
    await ensureAtelierPricingSeed().catch((err) => {
      logger.error(
        { err },
        "Pricing seed failed — Pricing module has no active rate card",
      );
    });
    // Task #383 — expense taxonomy is configuration (like reference data):
    // install missing category rows idempotently, then backfill the two-axis
    // codes onto legacy expense rows (only touches rows with NULL codes).
    await (async () => {
      const { ensureExpenseTaxonomy, migrateLegacyExpenseRows } = await import(
        "./lib/atelier-expense-taxonomy"
      );
      await ensureExpenseTaxonomy();
      // Task #654 — idempotent backfill of engagement legal_entity_id from
      // unambiguous invoice history (only touches rows with NULL entity).
      const { backfillEngagementLegalEntities } = await import(
        "./lib/atelier-engagement-entity"
      );
      const res = await backfillEngagementLegalEntities();
      if (res.filled > 0)
        logger.info({ ...res }, "Engagement legal-entity backfill complete");
      const migrated = await migrateLegacyExpenseRows();
      if (migrated > 0) logger.info({ migrated }, "Expense rows migrated to taxonomy");
    })().catch((err) => {
      logger.error(
        { err },
        "Expense taxonomy install failed — category dropdowns will be empty",
      );
    });
    // Task #396 — warm the merchant fuzzy-match token index so the first
    // receipt parse doesn't pay the full-table scan.
    await (async () => {
      const { warmupMerchantIndex } = await import("./lib/atelier-merchant/matcher");
      await warmupMerchantIndex();
    })().catch((err) => {
      logger.error({ err }, "Merchant index warmup failed — first parse will be slow");
    });
    // Task #108 — regression tripwire: dummy/test data was permanently purged
    // (2026-07-17). Count accounts and scream if any row matching the old test
    // tag patterns ever reappears, so reintroduction is visible immediately.
    try {
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
    } catch (err) {
      logger.warn({ err }, "Data tripwire check failed");
    }
    // Task #679 — sync capability embeddings at BOOT instead of lazily on
    // the first chat turn. New capabilities added in a deploy previously
    // stayed invisible to ranked retrieval until someone chatted after the
    // restart AND the lazy bootstrap ran; users saw "that feature doesn't
    // exist". Loud on failure; the per-turn bootstrap remains as a
    // fail-loud backstop.
    await (async () => {
      const { ensureCapabilityEmbeddings } = await import(
        "./lib/atelier-cli/capability-retriever"
      );
      await ensureCapabilityEmbeddings();
      logger.info("Capability embeddings synced at boot");
    })().catch((err) => {
      logger.error(
        { err },
        "CAPABILITY EMBEDDING SYNC FAILED — new chat tools may be invisible to ranked retrieval until the next successful sync",
      );
    });
    // Task #411 — install pg_trgm + pgvector (when available) and the
    // GIN trgm indexes the hybrid resolver hits. Idempotent. Runs last in
    // the serialized boot chain (Task #185) so it never competes with the
    // seeds above for connection permits.
    await applyAtelierCliRagSql()
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
  })().catch((err) => {
    logger.error({ err }, "Serialized boot chores chain failed unexpectedly");
  });
  // v3 Ledger: Sun 21:00 GST submit-due / Tue 12:00 GST approve-due nudges
  // (writes audit_event rows; idempotent per (week, kind)).
  startLedgerNudgeJob();
  // Task #62 — polling fallback that reconciles open signature requests
  // against DocuSeal (webhooks can't always reach the dev environment).
  startEsignPolling();
});
