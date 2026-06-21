import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureAtelierPricingSeed } from "./lib/atelier-seed-pricing";
import { ensureAtelierV5Seed } from "./lib/atelier-seed-v5";
import { ensureAtelierAgentsLensSeed } from "./lib/atelier-seed-agents-lens";
import { ensureAtelierL2cSeed } from "./lib/atelier-seed-l2c";
import { ensureAtelierAccountPlanSeed } from "./lib/atelier-seed-account-plan";
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
  // Idempotent — guarantees Pricing module is usable on first boot
  // without a manual Partner setup step (Task #240 acceptance).
  void ensureAtelierPricingSeed();
  // Task #354 — Press / Alliances / Studio / Guardhouse / IP catalog
  // demo data (idempotent). Migrates the former TS seed files to Postgres.
  void ensureAtelierV5Seed();
  // Task #373 — Agents lens (Design / Build / Evaluate / Deploy / Improve /
  // Retire) demo data (idempotent). Migrates the former TS seed file to Postgres.
  void ensureAtelierAgentsLensSeed();
  // Task #360 — Wave-1 L2C demo seed: counterparties, clauses, contracts,
  // DPA, and signed deliverable acceptance bound to existing engagements.
  // Fail-fast on bootstrap so partial-state startup is visible in logs.
  void ensureAtelierL2cSeed().catch((err) => {
    logger.error(
      { err },
      "Wave-1 L2C demo seed bootstrap failed — workspace will show no Codex data",
    );
  });
  // Task #571 — Account planning & execution demo seed: account actions,
  // account risk register, and goal-progress rows for the demo accounts.
  void ensureAtelierAccountPlanSeed().catch((err) => {
    logger.error(
      { err },
      "Account-plan demo seed bootstrap failed — Account Plan tab will be empty",
    );
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
