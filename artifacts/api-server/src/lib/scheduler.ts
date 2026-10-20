import cron, { type ScheduledTask } from "node-cron";
import { refreshFxRatesFromEcb } from "./atelier-fx.js";
import { runPriceScrape } from "./scraper";
import { logger } from "./logger";
import { db, atelierUsers, DEFAULT_ORG_ID } from "@workspace/db";
import { eq, or, sql } from "drizzle-orm";
import { runRosterSteward } from "../routes/atelier/rosterLifecycleRoutes";
import { runWalletRetentionSweep } from "../routes/atelier/walletRoutes";
import { runPaymentProposer } from "./atelier-payment-proposer";
import { runWinLossOverdueScan } from "../routes/atelier/winLossRoutes";
import { cleanupExpiredSessions } from "./auth/session";
import { runMsMeetingAutolog } from "./msMeetingAutolog";
import { runCalendarSubscriptionMaintenance } from "./msCalendarSync";
import { runMsLicenseSeatForecast } from "./msLicenseForecast";
import { runProcurementRenewalScan } from "./atelier-procurement-renewal";
import { runPartnerContractRenewalScan } from "./partnerNotify";
import { runSelfBillingClerk } from "./atelier-agents/selfBillingClerk";
import { runPayrollClerk } from "./atelier-agents/payrollClerk";
import { runCollectionsAgent } from "./atelier-agents/collections";
import { runRevenueRecognizerForOrg } from "./atelier-agents/revrec-scheduler";
import { runAgentExclusive } from "./atelier-agents/exclusive-runs";
import {
  quarantineLegacyAssistantTelemetry,
  runRetention as runAssistantRetention,
} from "./atelier-cli/retention";

const SCRAPE_CRON = process.env.PRICE_SCRAPE_CRON ?? "0 3 * * *";
const ROSTER_STEWARD_CRON = process.env.ROSTER_STEWARD_CRON ?? "0 6 * * *";
const WALLET_RETENTION_CRON = process.env.WALLET_RETENTION_CRON ?? "0 4 * * *";
// Phase 0 (Oct 2026 audit): daily FX import. The ECB publishes ~16:00 CET on
// TARGET business days; 16:30 UTC catches it the same day.
const FX_IMPORT_CRON = process.env.FX_IMPORT_CRON ?? "30 16 * * *";
const ASSISTANT_PRIVACY_CRON =
  process.env.ASSISTANT_PRIVACY_CRON ?? "15 4 * * *";
// Mon 03:00 UTC = Mon 06:00 GST — the start of the working week.
const WALLET_PAYMENT_PROPOSER_CRON = process.env.WALLET_PAYMENT_PROPOSER_CRON ?? "0 3 * * 1";
// Daily 05:00 UTC — escalate any Win/Loss debrief past its 14-day SLA.
const WINLOSS_SLA_CRON = process.env.WINLOSS_SLA_CRON ?? "0 5 * * *";
// Daily 02:00 UTC — delete expired auth session rows (Task #4).
const SESSION_CLEANUP_CRON = process.env.SESSION_CLEANUP_CRON ?? "0 2 * * *";
// Every 30 min — auto-log ended Microsoft 365 meetings as CRM activities
// (Task #336). Cheap no-op when MS is unconfigured or nobody is connected.
const MS_AUTOLOG_CRON = process.env.MS_AUTOLOG_CRON ?? "*/30 * * * *";
// Daily 04:30 UTC — Billing Orchestrator (Task #429): scan engagement
// billing rules, materialise due triggers, draft invoices for partner
// approval. Deterministic + idempotent, so a re-run is always safe.
const BILLING_ORCHESTRATOR_CRON = process.env.BILLING_ORCHESTRATOR_CRON ?? "30 4 * * *";
// Task #431 — Cash Flow Forecaster writes a fresh 13-week snapshot +
// raises cash-gap Pane A alerts every Monday 05:00 UTC by default.
const CASH_FORECASTER_CRON = process.env.CASH_FORECASTER_CRON ?? "0 5 * * 1";
// Task #632 — daily 05:15 UTC: compare upcoming joiner start dates against
// spare Microsoft 365 seats and warn founders/HR ONCE per shortfall so
// seats get bought in the GoDaddy portal before day one. Cheap no-op when
// MS admin creds/consent are missing.
const MS_LICENSE_FORECAST_CRON = process.env.MS_LICENSE_FORECAST_CRON ?? "15 5 * * *";
// Task #732 — daily 05:45 UTC: surface upcoming vendor-registration renewals
// (procurement.status renewal_due, or approaching per the researched guide's
// renewal cadence) on the responsible partner's Pane A + one-time email nudge.
const PROCUREMENT_RENEWAL_CRON = process.env.PROCUREMENT_RENEWAL_CRON ?? "45 5 * * *";
// Task #1173 — daily 05:50 UTC: notify partner firms whose master agreement
// (atelier_compliance_records kind master_agreement) expires within 30 days.
// One notification per firm, deduped by an existing row within 35 days.
const PARTNER_RENEWAL_CRON = process.env.PARTNER_RENEWAL_CRON ?? "50 5 * * *";

// Task #1091 — finance autopilot cadences. All rerun-safe: each agent is
// idempotent (drafts key off period/week, revrec skips frozen schedules)
// and concurrency-guarded through the background-jobs running-unique index
// (lockKey), so a double-fire or an overlapping manual run can't run twice.
// Self-Billing Clerk — weekly (Mon 03:30 UTC): draft RCTIs for the week.
const SELF_BILLING_CRON = process.env.SELF_BILLING_CRON ?? "30 3 * * 1";
// Collections Agent — daily (06:15 UTC): draft dunning/escalations.
const COLLECTIONS_AGENT_CRON = process.env.COLLECTIONS_AGENT_CRON ?? "15 6 * * *";
// Revenue Recognizer — monthly (1st, 04:00 UTC): compute period schedules.
const REVENUE_RECOGNIZER_CRON = process.env.REVENUE_RECOGNIZER_CRON ?? "0 4 1 * *";
// Payroll Clerk — monthly (25th, 05:00 UTC): draft statutory payroll runs
// + exception review AHEAD of period close, so the close checklist's
// payroll gate finds drafts ready (Task #1136). Manual trigger shares the
// same exclusive lock.
const PAYROLL_CLERK_CRON = process.env.PAYROLL_CLERK_CRON ?? "0 5 25 * *";
const AUTOPILOT_ORG_ID = process.env.ATELIER_AUTOPILOT_ORG_ID ?? DEFAULT_ORG_ID;
const SYSTEM_USER_ID = "system";

let scheduledTask: ScheduledTask | null = null;
let rosterStewardTask: ScheduledTask | null = null;
let walletRetentionTask: ScheduledTask | null = null;
let fxImportTask: ScheduledTask | null = null;
let assistantPrivacyTask: ScheduledTask | null = null;
let walletPaymentProposerTask: ScheduledTask | null = null;
let winLossSlaTask: ScheduledTask | null = null;
let sessionCleanupTask: ScheduledTask | null = null;
let msAutologTask: ScheduledTask | null = null;
let billingOrchestratorTask: ScheduledTask | null = null;
let cashForecasterTask: ScheduledTask | null = null;
let msCalSyncTask: ScheduledTask | null = null;
let msLicenseForecastTask: ScheduledTask | null = null;
let procurementRenewalTask: ScheduledTask | null = null;
let partnerRenewalTask: ScheduledTask | null = null;
let selfBillingTask: ScheduledTask | null = null;
let collectionsAgentTask: ScheduledTask | null = null;
let revenueRecognizerTask: ScheduledTask | null = null;
let payrollClerkTask: ScheduledTask | null = null;

// Task #629 — hourly: renew Graph calendar subscriptions (max ~3-day
// lifetime), roll cache windows forward, and safety-sync stale caches.
const MS_CAL_SYNC_CRON = process.env.MS_CAL_SYNC_CRON ?? "15 * * * *";

let schedulerStarted = false;

// Phase 0 (Oct 2026 audit): the Arçelik retail price scraper is marketing-
// demo code. It used to launch headless Chromium against twelve retail sites
// every night from inside the finance/HR API process. It now runs only when
// a deployment explicitly opts in; the Atelier crons below are unaffected.
const PRICE_SCRAPER_ENABLED = process.env.ATELIER_PRICE_SCRAPER_ENABLED === "1";

export function startScheduler(): void {
  if (schedulerStarted) {
    logger.warn("Scheduler already running, skipping duplicate start");
    return;
  }
  schedulerStarted = true;

  if (!PRICE_SCRAPER_ENABLED) {
    logger.info("Price scrape scheduler disabled (ATELIER_PRICE_SCRAPER_ENABLED is not 1)");
  } else if (!cron.validate(SCRAPE_CRON)) {
    logger.error(
      { cron: SCRAPE_CRON },
      "Invalid PRICE_SCRAPE_CRON expression, price scraper not started",
    );
  } else scheduledTask = cron.schedule(
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
  if (scheduledTask) {
    logger.info({ cron: SCRAPE_CRON }, "Price scrape scheduler started");
  }

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
  }

  // Phase 0 — daily FX import (single FX source; see lib/atelier-fx.ts).
  if (cron.validate(FX_IMPORT_CRON)) {
    fxImportTask = cron.schedule(
      FX_IMPORT_CRON,
      async () => {
        try {
          const out = await refreshFxRatesFromEcb();
          logger.info(out, "FX import finished");
        } catch (err) {
          logger.error({ err }, "FX import encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: FX_IMPORT_CRON }, "FX import scheduler started");
  } else {
    logger.error(
      { cron: WALLET_RETENTION_CRON },
      "Invalid WALLET_RETENTION_CRON expression, wallet retention not scheduled",
    );
  }

  if (cron.validate(ASSISTANT_PRIVACY_CRON)) {
    assistantPrivacyTask = cron.schedule(
      ASSISTANT_PRIVACY_CRON,
      async () => {
        try {
          const tenants = await db.execute(sql`
            SELECT org_id FROM atelier_assistant_privacy_org_ids()
          `);
          let rowsQuarantined = 0;
          let orgsRecorded = 0;
          let scannedRows = 0;
          let attachmentBlobsPurged = 0;
          for (const row of tenants.rows as Array<{ org_id: string }>) {
            const quarantine = await quarantineLegacyAssistantTelemetry(
              Date.now(),
              row.org_id,
            );
            const retention = await runAssistantRetention(
              Date.now(),
              row.org_id,
            );
            rowsQuarantined += quarantine.rowsQuarantined;
            orgsRecorded += quarantine.orgsRecorded;
            scannedRows += retention.scannedRows;
            attachmentBlobsPurged += retention.attachmentBlobsPurged;
          }
          logger.info(
            {
              tenantsProcessed: tenants.rows.length,
              rowsQuarantined,
              orgsRecorded,
              scannedRows,
              attachmentBlobsPurged,
            },
            "Assistant privacy lifecycle finished",
          );
        } catch {
          logger.error("Assistant privacy lifecycle failed");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info(
      { cron: ASSISTANT_PRIVACY_CRON },
      "Assistant privacy lifecycle scheduler started",
    );
  } else {
    logger.error(
      { cron: ASSISTANT_PRIVACY_CRON },
      "Invalid ASSISTANT_PRIVACY_CRON expression, privacy lifecycle not scheduled",
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

  // Daily auth-session cleanup (Task #4) — expired rows from abandoned
  // browsers never hit the delete-on-read path, so sweep them here.
  if (cron.validate(SESSION_CLEANUP_CRON)) {
    sessionCleanupTask = cron.schedule(
      SESSION_CLEANUP_CRON,
      async () => {
        try {
          const out = await cleanupExpiredSessions();
          logger.info(out, "Auth session cleanup finished");
        } catch (err) {
          logger.error({ err }, "Auth session cleanup encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: SESSION_CLEANUP_CRON }, "Auth session cleanup scheduler started");
  } else {
    logger.error(
      { cron: SESSION_CLEANUP_CRON },
      "Invalid SESSION_CLEANUP_CRON expression, session cleanup not scheduled",
    );
  }

  // Microsoft 365 meeting auto-log (Task #336) — every 30 minutes, scan
  // each connected user's recent calendar for ended meetings with known
  // client contacts and create CRM activity entries.
  if (cron.validate(MS_AUTOLOG_CRON)) {
    msAutologTask = cron.schedule(
      MS_AUTOLOG_CRON,
      async () => {
        try {
          const out = await runMsMeetingAutolog();
          if (out.connectionsScanned > 0) {
            logger.info(out, "MS meeting auto-log finished");
          }
        } catch (err) {
          logger.error({ err }, "MS meeting auto-log encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: MS_AUTOLOG_CRON }, "MS meeting auto-log scheduler started");
  } else {
    logger.error(
      { cron: MS_AUTOLOG_CRON },
      "Invalid MS_AUTOLOG_CRON expression, MS meeting auto-log not scheduled",
    );
  }

  // Billing Orchestrator (Task #429) — daily scan of engagement billing
  // rules → due triggers → draft invoices awaiting partner approval.
  if (cron.validate(BILLING_ORCHESTRATOR_CRON)) {
    billingOrchestratorTask = cron.schedule(
      BILLING_ORCHESTRATOR_CRON,
      async () => {
        try {
          // Task #1099 — claim the SAME durable lock the manual route and
          // the milestone-event path use, so runs can never overlap.
          const { launchBillingOrchestratorRun, BILLING_ORCH_SYSTEM_ACTOR } =
            await import("./atelier-agents/billingOrchestratorJobs.js");
          const out = await launchBillingOrchestratorRun({
            orgId: DEFAULT_ORG_ID,
            kind: "billing_orchestrator_auto",
            userId: BILLING_ORCH_SYSTEM_ACTOR,
            label: "Billing Orchestrator — daily scan",
            input: { source: "cron" },
            triggeredByUserId: null,
            actorLabel: "Billing Orchestrator (cron)",
            wait: true,
          });
          if (!out.started) {
            logger.info({ reason: out.reason }, "Billing Orchestrator scheduled run skipped");
            return;
          }
          logger.info({ jobId: out.jobId }, "Billing Orchestrator scheduled run finished");
        } catch (err) {
          logger.error({ err }, "Billing Orchestrator scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: BILLING_ORCHESTRATOR_CRON }, "Billing Orchestrator scheduler started");
  } else {
    logger.error(
      { cron: BILLING_ORCHESTRATOR_CRON },
      "Invalid BILLING_ORCHESTRATOR_CRON expression, Billing Orchestrator not scheduled",
    );
  }

  if (cron.validate(CASH_FORECASTER_CRON)) {
    cashForecasterTask = cron.schedule(
      CASH_FORECASTER_CRON,
      async () => {
        try {
          const { runCashFlowForecaster } = await import("./atelier-agents/runner.js");
          const out = await runCashFlowForecaster({
            asOf: new Date().toISOString().slice(0, 10),
            currency: "USD", openingBalance: 0, orgId: DEFAULT_ORG_ID,
            triggeredByUserId: null, actorLabel: "Scheduler",
          });
          logger.info(
            { snapshotId: out.output.snapshotId, cashGapWeeks: out.output.cashGapWeeks },
            "Cash Flow Forecaster scheduled run finished",
          );
        } catch (err) {
          logger.error({ err }, "Cash Flow Forecaster scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: CASH_FORECASTER_CRON }, "Cash Flow Forecaster scheduler started");
  } else {
    logger.error(
      { cron: CASH_FORECASTER_CRON },
      "Invalid CASH_FORECASTER_CRON expression, Cash Flow Forecaster not scheduled",
    );
  }

  // Task #629 — Graph calendar subscription maintenance + safety sync.
  if (cron.validate(MS_CAL_SYNC_CRON)) {
    msCalSyncTask = cron.schedule(
      MS_CAL_SYNC_CRON,
      async () => {
        try {
          await runCalendarSubscriptionMaintenance();
        } catch (err) {
          logger.error({ err }, "MS calendar subscription maintenance encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: MS_CAL_SYNC_CRON }, "MS calendar sync scheduler started");
  } else {
    logger.error(
      { cron: MS_CAL_SYNC_CRON },
      "Invalid MS_CAL_SYNC_CRON expression, MS calendar sync not scheduled",
    );
  }

  // Microsoft 365 seat forecast (Task #632) — daily look-ahead of joiner
  // start dates vs spare license seats; alerts founders/HR once per
  // distinct shortfall, skips cleanly without creds/consent.
  if (cron.validate(MS_LICENSE_FORECAST_CRON)) {
    msLicenseForecastTask = cron.schedule(
      MS_LICENSE_FORECAST_CRON,
      async () => {
        try {
          const out = await runMsLicenseSeatForecast();
          if (out.checked || out.skippedReason !== "not-configured") {
            logger.info(out, "MS license seat forecast finished");
          }
        } catch (err) {
          logger.error({ err }, "MS license seat forecast encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: MS_LICENSE_FORECAST_CRON }, "MS license seat forecast scheduler started");
  } else {
    logger.error(
      { cron: MS_LICENSE_FORECAST_CRON },
      "Invalid MS_LICENSE_FORECAST_CRON expression, MS license seat forecast not scheduled",
    );
  }

  // Procurement renewal reminders (Task #732) — daily scan of tracked
  // vendor-registration statuses + researched renewal cadences; emits
  // Pane A reminders (and a one-time email nudge) to responsible partners.
  if (cron.validate(PROCUREMENT_RENEWAL_CRON)) {
    procurementRenewalTask = cron.schedule(
      PROCUREMENT_RENEWAL_CRON,
      async () => {
        try {
          const out = await runProcurementRenewalScan();
          logger.info(out, "Procurement renewal scan finished");
        } catch (err) {
          logger.error({ err }, "Procurement renewal scan encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: PROCUREMENT_RENEWAL_CRON }, "Procurement renewal scheduler started");
  } else {
    logger.error(
      { cron: PROCUREMENT_RENEWAL_CRON },
      "Invalid PROCUREMENT_RENEWAL_CRON expression, procurement renewal scan not scheduled",
    );
  }

  // Partner contract-renewal reminders (Task #1173) — daily scan of
  // partner-firm master agreements expiring within 30 days; one in-app
  // notification + branded email per firm, deduped within 35 days.
  if (cron.validate(PARTNER_RENEWAL_CRON)) {
    partnerRenewalTask = cron.schedule(
      PARTNER_RENEWAL_CRON,
      async () => {
        try {
          const out = await runPartnerContractRenewalScan({ orgId: AUTOPILOT_ORG_ID });
          logger.info(out, "Partner contract-renewal scan finished");
        } catch (err) {
          logger.error({ err }, "Partner contract-renewal scan encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: PARTNER_RENEWAL_CRON }, "Partner contract-renewal scheduler started");
  } else {
    logger.error(
      { cron: PARTNER_RENEWAL_CRON },
      "Invalid PARTNER_RENEWAL_CRON expression, partner contract-renewal scan not scheduled",
    );
  }

  // ── Task #1091 — finance autopilot agents ──────────────────────────
  // Each block guards concurrency with the background-jobs registry: a
  // running row keyed by lockKey is inserted first; if one already exists
  // (a still-running manual or prior scheduled run) the insert returns null
  // and we skip — the agents themselves are idempotent so this is belt-and-
  // suspenders. The job row is completed/failed in a finally-style pair.

  // Self-Billing Clerk — weekly.
  if (cron.validate(SELF_BILLING_CRON)) {
    selfBillingTask = cron.schedule(
      SELF_BILLING_CRON,
      async () => {
        try {
          // Shared single-flight guard (Task #1105): the SAME per-agent lock
          // the manual route uses, so a cron tick and a manual trigger can
          // never both run. Stable lockKey + singleton target (not per-date).
          const res = await runAgentExclusive({
            agent: "self_billing_clerk", orgId: AUTOPILOT_ORG_ID, userId: SYSTEM_USER_ID,
            label: "Self-Billing Clerk — weekly draft", resultHref: "/finance/payables/self-billing",
            work: () => runSelfBillingClerk({ input: {}, triggeredByUserId: null }),
          });
          if (!res.ran) { logger.info("Self-Billing Clerk skipped — run already in progress"); return; }
          logger.info({ runId: res.result.runId }, "Self-Billing Clerk scheduled run finished");
        } catch (err) {
          logger.error({ err }, "Self-Billing Clerk scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: SELF_BILLING_CRON }, "Self-Billing Clerk scheduler started");
  } else {
    logger.error({ cron: SELF_BILLING_CRON }, "Invalid SELF_BILLING_CRON expression, Self-Billing Clerk not scheduled");
  }

  // Payroll Clerk — monthly, ahead of period close (Task #1136).
  if (cron.validate(PAYROLL_CLERK_CRON)) {
    payrollClerkTask = cron.schedule(
      PAYROLL_CLERK_CRON,
      async () => {
        try {
          const res = await runAgentExclusive({
            agent: "payroll_clerk", orgId: AUTOPILOT_ORG_ID, userId: SYSTEM_USER_ID,
            label: "Payroll Clerk — monthly draft", resultHref: "/finance/payroll",
            work: () => runPayrollClerk({ orgId: AUTOPILOT_ORG_ID, input: {}, triggeredByUserId: null }),
          });
          if (!res.ran) { logger.info("Payroll Clerk skipped — run already in progress"); return; }
          logger.info({ runId: res.result.runId }, "Payroll Clerk scheduled run finished");
        } catch (err) {
          logger.error({ err }, "Payroll Clerk scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: PAYROLL_CLERK_CRON }, "Payroll Clerk scheduler started");
  } else {
    logger.error({ cron: PAYROLL_CLERK_CRON }, "Invalid PAYROLL_CLERK_CRON expression, Payroll Clerk not scheduled");
  }

  // Collections Agent — daily.
  if (cron.validate(COLLECTIONS_AGENT_CRON)) {
    collectionsAgentTask = cron.schedule(
      COLLECTIONS_AGENT_CRON,
      async () => {
        try {
          const res = await runAgentExclusive({
            agent: "collections_agent", orgId: AUTOPILOT_ORG_ID, userId: SYSTEM_USER_ID,
            label: "Collections Agent — daily draft", resultHref: "/finance/collections",
            work: () => runCollectionsAgent({ orgId: AUTOPILOT_ORG_ID, input: {}, triggeredByUserId: null }),
          });
          if (!res.ran) { logger.info("Collections Agent skipped — run already in progress"); return; }
          logger.info({ runId: res.result.runId }, "Collections Agent scheduled run finished");
        } catch (err) {
          logger.error({ err }, "Collections Agent scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: COLLECTIONS_AGENT_CRON }, "Collections Agent scheduler started");
  } else {
    logger.error({ cron: COLLECTIONS_AGENT_CRON }, "Invalid COLLECTIONS_AGENT_CRON expression, Collections Agent not scheduled");
  }

  // Revenue Recognizer — monthly.
  if (cron.validate(REVENUE_RECOGNIZER_CRON)) {
    revenueRecognizerTask = cron.schedule(
      REVENUE_RECOGNIZER_CRON,
      async () => {
        const period = new Date().toISOString().slice(0, 7);
        try {
          const res = await runAgentExclusive({
            agent: "revenue_recognizer", orgId: AUTOPILOT_ORG_ID, userId: SYSTEM_USER_ID,
            label: `Revenue Recognizer — ${period}`, resultHref: "/finance/revrec",
            work: () => runRevenueRecognizerForOrg({ orgId: AUTOPILOT_ORG_ID, periodLabel: period }),
          });
          if (!res.ran) { logger.info("Revenue Recognizer skipped — run already in progress"); return; }
          logger.info(res.result, "Revenue Recognizer scheduled run finished");
        } catch (err) {
          logger.error({ err }, "Revenue Recognizer scheduled run encountered an error");
        }
      },
      { timezone: "Etc/UTC" },
    );
    logger.info({ cron: REVENUE_RECOGNIZER_CRON }, "Revenue Recognizer scheduler started");
  } else {
    logger.error({ cron: REVENUE_RECOGNIZER_CRON }, "Invalid REVENUE_RECOGNIZER_CRON expression, Revenue Recognizer not scheduled");
  }

  // Boot pass: ensure subscriptions exist for already-connected users
  // shortly after startup (delayed so boot isn't slowed by Graph calls).
  setTimeout(() => {
    runCalendarSubscriptionMaintenance().catch((err) => {
      logger.error({ err }, "MS calendar boot maintenance encountered an error");
    });
  }, 10_000).unref?.();
}

export function stopScheduler(): void {
  schedulerStarted = false;
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
  if (fxImportTask) {
    fxImportTask.stop();
    fxImportTask = null;
  }
  if (walletRetentionTask) {
    walletRetentionTask.stop();
    walletRetentionTask = null;
    logger.info("Wallet retention scheduler stopped");
  }
  if (assistantPrivacyTask) {
    assistantPrivacyTask.stop();
    assistantPrivacyTask = null;
    logger.info("Assistant privacy lifecycle scheduler stopped");
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
  if (sessionCleanupTask) {
    sessionCleanupTask.stop();
    sessionCleanupTask = null;
    logger.info("Auth session cleanup scheduler stopped");
  }
  if (msAutologTask) {
    msAutologTask.stop();
    msAutologTask = null;
    logger.info("MS meeting auto-log scheduler stopped");
  }
  if (billingOrchestratorTask) {
    billingOrchestratorTask.stop();
    billingOrchestratorTask = null;
    logger.info("Billing Orchestrator scheduler stopped");
  }
  if (cashForecasterTask) {
    cashForecasterTask.stop();
    cashForecasterTask = null;
    logger.info("Cash Flow Forecaster scheduler stopped");
  }
  if (msCalSyncTask) {
    msCalSyncTask.stop();
    msCalSyncTask = null;
    logger.info("MS calendar sync scheduler stopped");
  }
  if (procurementRenewalTask) {
    procurementRenewalTask.stop();
    procurementRenewalTask = null;
  }
  if (partnerRenewalTask) {
    partnerRenewalTask.stop();
    partnerRenewalTask = null;
    logger.info("Partner contract-renewal scheduler stopped");
  }
  if (msLicenseForecastTask) {
    msLicenseForecastTask.stop();
    msLicenseForecastTask = null;
    logger.info("MS license seat forecast scheduler stopped");
  }
  if (selfBillingTask) {
    selfBillingTask.stop();
    selfBillingTask = null;
    logger.info("Self-Billing Clerk scheduler stopped");
  }
  if (collectionsAgentTask) {
    collectionsAgentTask.stop();
    collectionsAgentTask = null;
    logger.info("Collections Agent scheduler stopped");
  }
  if (revenueRecognizerTask) {
    revenueRecognizerTask.stop();
    revenueRecognizerTask = null;
    logger.info("Revenue Recognizer scheduler stopped");
  }
  if (payrollClerkTask) {
    payrollClerkTask.stop();
    payrollClerkTask = null;
    logger.info("Payroll Clerk scheduler stopped");
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
