import cron, { type ScheduledTask } from "node-cron";
import { runPriceScrape } from "./scraper";
import { logger } from "./logger";
import { db, atelierUsers } from "@workspace/db";
import { eq, or } from "drizzle-orm";
import { runRosterSteward } from "../routes/atelier/rosterLifecycleRoutes";

const SCRAPE_CRON = process.env.PRICE_SCRAPE_CRON ?? "0 3 * * *";
const ROSTER_STEWARD_CRON = process.env.ROSTER_STEWARD_CRON ?? "0 6 * * *";

let scheduledTask: ScheduledTask | null = null;
let rosterStewardTask: ScheduledTask | null = null;

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
            .where(or(eq(atelierUsers.role, "partner"), eq(atelierUsers.role, "operations")));
          if (targets.length === 0) {
            logger.warn("Roster Steward cron: no Partner/Operations users found, skipping");
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
