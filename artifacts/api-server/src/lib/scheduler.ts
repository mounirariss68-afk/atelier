import cron, { type ScheduledTask } from "node-cron";
import { runPriceScrape } from "./scraper";
import { logger } from "./logger";

const SCRAPE_CRON = process.env.PRICE_SCRAPE_CRON ?? "0 3 * * *";

let scheduledTask: ScheduledTask | null = null;

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
}

export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    logger.info("Price scrape scheduler stopped");
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
