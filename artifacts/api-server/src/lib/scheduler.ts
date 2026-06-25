import cron, { type ScheduledTask } from "node-cron";
import { runPriceScrape } from "./scraper";
import { logger } from "./logger";
import { db, atelierUsers } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { runRosterSteward } from "../routes/atelier/rosterLifecycleRoutes";
import { runWalletRetentionSweep } from "../routes/atelier/walletRoutes";
import { runPaymentProposer } from "./atelier-payment-proposer";
import { runWinLossOverdueScan } from "../routes/atelier/winLossRoutes";

const SCRAPE_CRON = process.env.PRICE_SCRAPE_CRON ?? "0 3 * * *";
const ROSTER_STEWARD_CRON = process.env.ROSTER_STEWARD_CRON ?? "0 6 * * *";
const WALLET_RETENTION_CRON = process.env.WALLET_RETENTION_CRON ?? "0 4 * * *";
// Mon 03:00 UTC = Mon 06:00 GST — the start of the working week.
const WALLET_PAYMENT_PROPOSER_CRON = process.env.WALLET_PAYMENT_PROPOSER_CRON ?? "0 3 * * 1";
// Daily 05:00 UTC — escalate any Win/Loss debrief past its 14-day SLA.
const WINLOSS_SLA_CRON = process.env.WINLOSS_SLA_CRON ?? "0 5 * * *";

let scheduledTask: ScheduledTask | null = null;
let rosterStewardTask: ScheduledTask | null = null;
let walletRetentionTask: ScheduledTask | null = null;
let walletPaymentProposerTask: ScheduledTask | null = null;
let winLossSlaTask: ScheduledTask | null = null;

export function startScheduler(): void {
  if (scheduledTask) {
    logger.warn("Scheduler already running, skipping duplicate start");
    return;
  }

  if (!cron.validate(SCRAPE_CRON)) {
    logger.error(
      { cron: SCRAPE_CRON },
      "Invalid PRICE_SCRAPE_CRON expression, scheduler not started",
    );
    return;
  }

  scheduledTask = cron.schedule(
    SCRAPE_CRON,
    async () => {
      logger.info("Scheduled price scrape starting...");
      try {
        const result = await runPriceScrape("scheduled");
        logger.info(
          {
            runId: result.runId,
            status: result.status,
            matchedProducts: result.matchedProducts,
            matchedCompetitors: result.matchedCompetitors,
            priceChanges: result.priceChanges,
          },
          "Scheduled price scrape finished",
        );
      } catch (err) {
        logger.error({ err }, "Scheduled price scrape encountered an error");
      }
    },
    { timezone: "Etc/UTC" },
  );

  logger.info(
    { cron: SCRAPE_CRON },
    "Price scrape scheduler started",
  );

  // Daily Roster Steward — scans atelier compliance records, materialises
  // Pane A items for Partners + Operations users so visa/Iqama/firm-license
  // expirations surface on Mounir's dashboard without manual triggering.
  if (cron.validate(ROSTER_STEWARD_CRON)) {
    rosterStewardTask = cron.schedule(
      ROSTER_STEWARD_CRON,
      async () => {
        try {
          const targets = await db
            .select({ id: atelierUsers.id })
            .from(atelierUsers)
            // Task #292 — ops split into finance|hr; partner-tier covers both.
            .where(
              or(
                eq(atelierUsers.role, "founding_partner"),
                eq(atelierUsers.role, "partner"),
                eq(atelierUsers.role, "finance"),
                eq(atelierUsers.role, "hr"),
              ),
            );
          if (targets.length === 0) {
            logger.warn("Roster Steward cron: no partner-tier / finance / hr users found, skipping");
            return;
          }
          const out = await runRosterSteward({ targetUserIds: targets.map((t) => t.id) });
          logger.info({ ...out, targets: targets.length }, "Roster Steward cron finished");
        } catch (err) {
          logger.error({ err }, "Roster Steward cron encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: ROSTER_STEWARD_CRON }, "Roster Steward scheduler started");
  } else {
    logger.error(
      { cron: ROSTER_STEWARD_CRON },
      "Invalid ROSTER_STEWARD_CRON expression, Roster Steward not scheduled",
    );
  }

  // Daily Wallet retention sweep — redacts OCR payloads older than 90 days
  // so receipt images / parsed text don't linger past the retention window.
  if (cron.validate(WALLET_RETENTION_CRON)) {
    walletRetentionTask = cron.schedule(
      WALLET_RETENTION_CRON,
      async () => {
        try {
          const out = await runWalletRetentionSweep();
          logger.info(out, "Wallet retention sweep finished");
        } catch (err) {
          logger.error({ err }, "Wallet retention sweep encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: WALLET_RETENTION_CRON }, "Wallet retention scheduler started");
  } else {
    logger.error(
      { cron: WALLET_RETENTION_CRON },
      "Invalid WALLET_RETENTION_CRON expression, wallet retention not scheduled",
    );
  }

  // Weekly Payment Proposer — composes contractor + partner-firm payment
  // proposal rows from approved billable hours so Partners arrive at a
  // queued review every Monday morning (GST).
  if (cron.validate(WALLET_PAYMENT_PROPOSER_CRON)) {
    walletPaymentProposerTask = cron.schedule(
      WALLET_PAYMENT_PROPOSER_CRON,
      async () => {
        try {
          const out = await runPaymentProposer({ triggeredBy: "cron" });
          logger.info(out, "Wallet payment proposer finished");
        } catch (err) {
          logger.error({ err }, "Wallet payment proposer encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info(
      { cron: WALLET_PAYMENT_PROPOSER_CRON },
      "Wallet payment proposer scheduler started",
    );
  } else {
    logger.error(
      { cron: WALLET_PAYMENT_PROPOSER_CRON },
      "Invalid WALLET_PAYMENT_PROPOSER_CRON expression, payment proposer not scheduled",
    );
  }

  // Daily Win/Loss SLA monitor (Task #653) — escalates debriefs past their
  // 14-day SLA automatically so overdue debriefs surface without anyone
  // remembering to POST /win-loss/overdue/scan.
  if (cron.validate(WINLOSS_SLA_CRON)) {
    winLossSlaTask = cron.schedule(
      WINLOSS_SLA_CRON,
      async () => {
        try {
          const out = await runWinLossOverdueScan();
          logger.info(out, "Win/Loss SLA scan finished");
        } catch (err) {
          logger.error({ err }, "Win/Loss SLA scan encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: WINLOSS_SLA_CRON }, "Win/Loss SLA scheduler started");
  } else {
    logger.error(
      { cron: WINLOSS_SLA_CRON },
      "Invalid WINLOSS_SLA_CRON expression, Win/Loss SLA monitor not scheduled",
    );
  }
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info("Price scrape scheduler stopped");
  }
  if (rosterStewardTask) {
    rosterStewardTask.stop();
    rosterStewardTask = null;
    logger.info("Roster Steward scheduler stopped");
  }
  if (walletRetentionTask) {
    walletRetentionTask.stop();
    walletRetentionTask = null;
    logger.info("Wallet retention scheduler stopped");
  }
  if (walletPaymentProposerTask) {
    walletPaymentProposerTask.stop();
    walletPaymentProposerTask = null;
    logger.info("Wallet payment proposer scheduler stopped");
  }
  if (winLossSlaTask) {
    winLossSlaTask.stop();
    winLossSlaTask = null;
    logger.info("Win/Loss SLA scheduler stopped");
  }
}

export function getSchedulerStatus(): {
  running: boolean;
  cronExpression: string;
} {
  return {
    running: scheduledTask !== null,
    cronExpression: SCRAPE_CRON,
  };
}
