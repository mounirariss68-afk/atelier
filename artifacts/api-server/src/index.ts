import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureAtelierAuthSeed } from "./lib/atelier-seed-auth";
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
  // All demo-data seeding was removed for production (2026-07-16): the only
  // boot-time seed left is the auth credential seed above. Real data is
  // entered through the app.
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
