import app from "./app";
import { logger } from "./lib/logger";
import { startScheduler } from "./lib/scheduler";
import { ensureAtelierPricingSeed } from "./lib/atelier-seed-pricing";
import { ensureAtelierV5Seed } from "./lib/atelier-seed-v5";
import { ensureAtelierAgentsLensSeed } from "./lib/atelier-seed-agents-lens";
import { ensureAtelierL2cSeed } from "./lib/atelier-seed-l2c";
import { startLedgerNudgeJob } from "./lib/atelier-agents/ledgerNudges";

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
  // v3 Ledger: Sun 21:00 GST submit-due / Tue 12:00 GST approve-due nudges
  // (writes audit_event rows; idempotent per (week, kind)).
  startLedgerNudgeJob();
});
