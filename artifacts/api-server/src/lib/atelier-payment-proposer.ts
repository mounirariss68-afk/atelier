/**
 * Payment Proposer — Task #260.
 *
 * Aggregates lead-approved timesheet entries (contractors / employees on
 * billable engagements) and uploaded partner-firm hours into weekly
 * payment / invoice proposal rows. Idempotent on (payee, engagement, week).
 *
 * Run weekly via the cron in `lib/scheduler.ts`, or on-demand via
 * POST /wallet/approvals/run.
 *
 * Partner-approval rules (PRD §5.2):
 *  - Contractor proposal: requires Partner approval if usdAmount > $250.
 *  - Partner-firm invoice proposal: ALWAYS requires Partner approval.
 */

import {
  db,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierTimesheetEntries,
  atelierTimesheetWeeks,
  atelierPartnerFirmHours,
  atelierUsers,
  atelierContractors,
  atelierPartnerFirms,
  atelierEngagements,
  atelierNotifications,
  atelierAuditEvents,
} from "@workspace/db";
import { and, eq, isNull, inArray, or } from "drizzle-orm";
import { convertToUsd } from "./atelier-fx.js";
import { proposeSupplierInvoiceAllocation } from "./atelier-entity-allocation.js";
import { isoWeekStart, resolveContractorDayRateForDate } from "./atelier-nep-comp.js";

const PARTNER_APPROVAL_THRESHOLD_USD = 250;
const DEFAULT_HOURLY_FALLBACK_USD = 100;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoWeekOf(d: Date): string {
  // ISO week YYYY-Www
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function isoWeekOfDateStr(s: string): string {
  return isoWeekOf(new Date(`${s}T00:00:00Z`));
}

export interface PaymentProposerSummary {
  triggeredBy: string; // "cron" | userId
  weeksScanned: string[];
  contractorProposals: { created: number; updated: number; skipped: number };
  partnerFirmProposals: { created: number; updated: number; skipped: number };
  notificationsSent: number;
}

interface RunArgs {
  triggeredBy?: string; // "cron" or userId
  weeksIso?: string[]; // optional explicit weeks; default = last 4 ISO weeks
}

function lastNIsoWeeks(n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n * 7; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const w = isoWeekOf(d);
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Look up an hourly cost rate for a payee. Contractors carry day_rate;
 * employees fall back to a synthetic firm-cost number. We never read
 * the rate-card here (that's the SELL price; this is COST).
 */
async function payeeHourlyCostUsd(payeeUserId: string): Promise<{
  ratePerHour: number;
  rateCurrency: string;
  payeeName: string;
  personType: "employee" | "contractor";
}> {
  const [user] = await db
    .select()
    .from(atelierUsers)
    .where(eq(atelierUsers.id, payeeUserId));
  const personType: "employee" | "contractor" =
    user?.role === "contractor" ? "contractor" : "employee";
  // Try contractor row by email match (atelier_contractors has no user_id FK).
  if (personType === "contractor" && user?.email) {
    const [c] = await db
      .select()
      .from(atelierContractors)
      .where(and(eq(atelierContractors.email, user.email), isNull(atelierContractors.deletedAt)));
    if (c?.dayRateAmount) {
      const ratePerHour = c.dayRateAmount / 8;
      return {
        ratePerHour,
        rateCurrency: c.dayRateCurrency ?? "USD",
        payeeName: user.name,
        personType,
      };
    }
  }
  return {
    ratePerHour: DEFAULT_HOURLY_FALLBACK_USD,
    rateCurrency: "USD",
    payeeName: user?.name ?? payeeUserId,
    personType,
  };
}

export async function runPaymentProposer(args: RunArgs = {}): Promise<PaymentProposerSummary> {
  const triggeredBy = args.triggeredBy ?? "cron";
  const weeksIso = args.weeksIso?.length ? args.weeksIso : lastNIsoWeeks(4);
  const proposalRunId = rid("ppr");

  const summary: PaymentProposerSummary = {
    triggeredBy,
    weeksScanned: weeksIso,
    contractorProposals: { created: 0, updated: 0, skipped: 0 },
    partnerFirmProposals: { created: 0, updated: 0, skipped: 0 },
    notificationsSent: 0,
  };

  // ----- Contractor proposals from lead-approved timesheet weeks -----
  // PRD: contractor payments compose from weeks that the engagement-lead
  // has signed off on (week.status='lead_approved'). Approval state lives
  // on the *week* row in this codebase, not the entry row, so we drive
  // the query off atelierTimesheetWeeks. Employees are paid on the
  // standard payroll cycle and are filtered out here (personType filter).
  const leadApprovedWeeks = await db
    .select()
    .from(atelierTimesheetWeeks)
    .where(
      and(
        isNull(atelierTimesheetWeeks.deletedAt),
        eq(atelierTimesheetWeeks.status, "lead_approved"),
        eq(atelierTimesheetWeeks.personType, "contractor"),
        inArray(atelierTimesheetWeeks.weekIso, weeksIso),
      ),
    );

  type Bucket = {
    contractorId: string;
    payeeUserId: string;
    payeeName: string;
    ratePerHour: number;
    rateCurrency: string;
    engagementId: string;
    weekIso: string;
    hours: number;
    entryIds: string[];
  };
  const buckets = new Map<string, Bucket>();
  for (const wk of leadApprovedWeeks) {
    // Resolve contractor identity + day-rate from the contractors table.
    const [con] = await db
      .select()
      .from(atelierContractors)
      .where(and(eq(atelierContractors.id, wk.personId), isNull(atelierContractors.deletedAt)));
    if (!con) {
      summary.contractorProposals.skipped++;
      continue;
    }
    // Effective-dated NEP plans win over the roster field, resolved as of
    // the WORK week — future-dated revisions activate on their effective
    // date without manual sync (Task #1298).
    const wkStart = isoWeekStart(wk.weekIso);
    const planRate = wkStart
      ? await resolveContractorDayRateForDate(con.orgId, con.id, wkStart)
      : null;
    const effDayRate = planRate?.dayRateAmount ?? con.dayRateAmount;
    const ratePerHour = effDayRate ? effDayRate / 8 : DEFAULT_HOURLY_FALLBACK_USD;
    const rateCurrency = (planRate?.currency ?? con.dayRateCurrency) ?? "USD";
    // Resolve linked user (if any) so payeeUserId is a real user id when
    // the contractor has logged in; else fall back to contractor.id.
    let payeeUserId = con.id;
    if (con.email) {
      const [u] = await db.select().from(atelierUsers).where(eq(atelierUsers.email, con.email));
      if (u?.id) payeeUserId = u.id;
    }
    // Pull this week's billable entries grouped per engagement.
    const entries = await db
      .select()
      .from(atelierTimesheetEntries)
      .where(
        and(
          isNull(atelierTimesheetEntries.deletedAt),
          eq(atelierTimesheetEntries.weekId, wk.id),
          eq(atelierTimesheetEntries.billable, true),
        ),
      );
    for (const e of entries) {
      if (!e.engagementId) continue;
      const key = `${payeeUserId}|${e.engagementId}|${wk.weekIso}`;
      const cur = buckets.get(key) ?? {
        contractorId: con.id,
        payeeUserId,
        payeeName: con.fullName,
        ratePerHour,
        rateCurrency,
        engagementId: e.engagementId,
        weekIso: wk.weekIso,
        hours: 0,
        entryIds: [],
      };
      cur.hours += e.hours ?? 0;
      cur.entryIds.push(e.id);
      buckets.set(key, cur);
    }
  }

  for (const b of buckets.values()) {
    if (b.hours <= 0) {
      summary.contractorProposals.skipped++;
      continue;
    }
    const meta = {
      ratePerHour: b.ratePerHour,
      rateCurrency: b.rateCurrency,
      payeeName: b.payeeName,
      personType: "contractor" as const,
    };
    const costAmount = +(b.hours * meta.ratePerHour).toFixed(2);
    const fx = await convertToUsd(costAmount, meta.rateCurrency, new Date());
    const usdAmount = +fx.usdAmount.toFixed(2);
    const requiresPartner = usdAmount > PARTNER_APPROVAL_THRESHOLD_USD;

    const [existing] = await db
      .select()
      .from(atelierContractorPayments)
      .where(
        and(
          eq(atelierContractorPayments.payeeUserId, b.payeeUserId),
          eq(atelierContractorPayments.engagementId, b.engagementId),
          eq(atelierContractorPayments.weekIso, b.weekIso),
          isNull(atelierContractorPayments.deletedAt),
        ),
      );
    if (existing) {
      // Only refresh proposed rows; never disturb partner-approved/paid.
      if (existing.status !== "proposed") {
        summary.contractorProposals.skipped++;
        continue;
      }
      await db
        .update(atelierContractorPayments)
        .set({
          hours: b.hours,
          ratePerHour: meta.ratePerHour,
          rateCurrency: meta.rateCurrency,
          costAmount,
          costCurrency: meta.rateCurrency,
          fxRate: fx.rate,
          usdAmount,
          requiresPartnerApproval: requiresPartner,
          evidenceEntryIds: b.entryIds,
          proposalRunId,
          updatedAt: new Date(),
        })
        .where(eq(atelierContractorPayments.id, existing.id));
      summary.contractorProposals.updated++;
    } else {
      await db.insert(atelierContractorPayments).values({
        id: rid("cp"),
        payeeUserId: b.payeeUserId,
        payeePersonType: meta.personType,
        payeeName: meta.payeeName,
        engagementId: b.engagementId,
        weekIso: b.weekIso,
        hours: b.hours,
        ratePerHour: meta.ratePerHour,
        rateCurrency: meta.rateCurrency,
        costAmount,
        costCurrency: meta.rateCurrency,
        fxRate: fx.rate,
        usdAmount,
        status: "proposed",
        requiresPartnerApproval: requiresPartner,
        proposalRunId,
        evidenceEntryIds: b.entryIds,
      });
      summary.contractorProposals.created++;
    }
  }

  // ----- Partner-firm invoice proposals -----
  const pfHours = await db
    .select()
    .from(atelierPartnerFirmHours)
    .where(
      and(
        isNull(atelierPartnerFirmHours.deletedAt),
        inArray(atelierPartnerFirmHours.weekIso, weeksIso),
      ),
    );
  type PfBucket = {
    partnerFirmId: string;
    engagementId: string;
    weekIso: string;
    hours: number;
    costAmount: number;
    costCurrency: string;
    rowIds: string[];
  };
  const pfBuckets = new Map<string, PfBucket>();
  for (const r of pfHours) {
    const key = `${r.partnerFirmId}|${r.engagementId}|${r.weekIso}`;
    const cur = pfBuckets.get(key) ?? {
      partnerFirmId: r.partnerFirmId,
      engagementId: r.engagementId,
      weekIso: r.weekIso,
      hours: 0,
      costAmount: 0,
      costCurrency: r.costCurrency ?? "USD",
      rowIds: [],
    };
    cur.hours += r.hours ?? 0;
    cur.costAmount += r.costAmount ?? 0;
    cur.costCurrency = r.costCurrency ?? cur.costCurrency;
    cur.rowIds.push(r.id);
    pfBuckets.set(key, cur);
  }
  for (const b of pfBuckets.values()) {
    if (b.hours <= 0) {
      summary.partnerFirmProposals.skipped++;
      continue;
    }
    const fx = await convertToUsd(b.costAmount, b.costCurrency, new Date());
    const usdAmount = +fx.usdAmount.toFixed(2);
    const [firm] = await db
      .select()
      .from(atelierPartnerFirms)
      .where(eq(atelierPartnerFirms.id, b.partnerFirmId));
    const partnerFirmName = firm?.name ?? b.partnerFirmId;
    const [existing] = await db
      .select()
      .from(atelierPartnerFirmInvoices)
      .where(
        and(
          eq(atelierPartnerFirmInvoices.partnerFirmId, b.partnerFirmId),
          eq(atelierPartnerFirmInvoices.engagementId, b.engagementId),
          eq(atelierPartnerFirmInvoices.weekIso, b.weekIso),
          isNull(atelierPartnerFirmInvoices.deletedAt),
        ),
      );
    if (existing) {
      if (existing.status !== "proposed") {
        summary.partnerFirmProposals.skipped++;
        continue;
      }
      await db
        .update(atelierPartnerFirmInvoices)
        .set({
          hours: b.hours,
          costAmount: +b.costAmount.toFixed(2),
          costCurrency: b.costCurrency,
          fxRate: fx.rate,
          usdAmount,
          evidenceFirmHourIds: b.rowIds,
          proposalRunId,
          partnerFirmName,
          updatedAt: new Date(),
        })
        .where(eq(atelierPartnerFirmInvoices.id, existing.id));
      summary.partnerFirmProposals.updated++;
    } else {
      const pfiId = rid("pfi");
      await db.insert(atelierPartnerFirmInvoices).values({
        id: pfiId,
        partnerFirmId: b.partnerFirmId,
        partnerFirmName,
        engagementId: b.engagementId,
        weekIso: b.weekIso,
        hours: b.hours,
        costAmount: +b.costAmount.toFixed(2),
        costCurrency: b.costCurrency,
        fxRate: fx.rate,
        usdAmount,
        status: "proposed",
        proposalRunId,
        evidenceFirmHourIds: b.rowIds,
      });
      // Task #1095 — prefill the entity allocation (fail-soft).
      await proposeSupplierInvoiceAllocation(pfiId, { allowAi: false }).catch(() => null);
      summary.partnerFirmProposals.created++;
    }
  }

  // ----- Notify Partners about anything still awaiting approval -----
  const partners = await db
    .select({ id: atelierUsers.id, orgId: atelierUsers.orgId, name: atelierUsers.name })
    .from(atelierUsers)
    .where(and(eq(atelierUsers.role, "partner"), isNull(atelierUsers.deletedAt)));
  const totalCreated =
    summary.contractorProposals.created + summary.partnerFirmProposals.created;
  if (totalCreated > 0 && partners.length > 0) {
    for (const p of partners) {
      await db.insert(atelierNotifications).values({
        id: rid("ntf"),
        orgId: p.orgId,
        userId: p.id,
        kind: "wallet_payment_proposal",
        payload: { proposalRunId, summary },
        channel: "in_app",
        subject: `Wallet — ${totalCreated} new payment proposal(s) for review`,
        body: `Payment Proposer composed ${summary.contractorProposals.created} contractor and ${summary.partnerFirmProposals.created} partner-firm proposal(s) for weeks ${weeksIso.join(", ")}.`,
        refType: "wallet_payment_proposal",
        refId: proposalRunId,
        status: "queued",
      });
      summary.notificationsSent++;
    }
  }

  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "wallet_payment_proposer",
    entityId: proposalRunId,
    actorType: "agent",
    actorLabel: "Payment Proposer",
    action: "wallet.payment_proposer.run",
    payload: summary as never,
    payloadSummary: `Composed ${summary.contractorProposals.created} contractor + ${summary.partnerFirmProposals.created} partner-firm proposals (${weeksIso.length} week(s)).`,
  });

  return summary;
}
