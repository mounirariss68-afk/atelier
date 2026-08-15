/**
 * Payroll Clerk — Task #1136 (rule-based, ag_payroll_clerk).
 *
 * Deterministic monthly payroll preparation, mirroring the Self-Billing
 * Clerk pattern: the agent DRAFTS, humans APPROVE, it never posts or pays.
 *
 * For each active legal entity in a statutory-covered country it:
 *  1. computes (or refreshes) the DRAFT statutory payroll run for the
 *     period — posted runs are left untouched (reported as already_posted);
 *  2. gathers the exception list finance must clear before close:
 *     - engine validation errors (missing comp / currency / IBAN /
 *       nationality / entity links, negative net pay, …),
 *     - WPS SIF exclusions for AE entities (missing MOHRE Person ID,
 *       agent-bank routing code, invalid IBAN, missing employer config) —
 *       i.e. exactly who would be excluded from the bank file,
 *     - leavers with an end date in/before the period but no EOSB
 *       settlement started,
 *     - active salary advances not being recovered by the draft run,
 *     - comp changes effective later in the period (the run must be
 *       recomputed after they land);
 *  3. notifies finance leadership with the draft + exception review card.
 *
 * Scheduling: monthly cron ahead of the period-close payroll gate (the
 * close checklist's payroll items block sign-off until a run is posted),
 * plus a manual 202+poll trigger. Both go through the shared exclusive
 * lock so overlapping manual+scheduled runs are impossible.
 */
import { and, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierEmployees,
  atelierLegalEntities,
  atelierEosbSettlements,
  atelierSalaryAdvances,
  atelierCompChanges,
  atelierNotifications,
} from "@workspace/db";
import { computePayrollRun } from "../atelier-payroll/payrollRun.js";
import { resolveRules } from "../atelier-payroll/statutoryRules.js";
import { buildWpsSif, wpsApplicability, type WpsEmployeeInput } from "../atelier-payroll/wpsSif.js";
import { runAgent } from "./runAgent.js";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export interface PayrollClerkInput {
  /** Wage period YYYY-MM; defaults to the current month. */
  periodLabel?: string;
}

export interface PayrollClerkException {
  entityId: string;
  entityName: string;
  code:
    | "run_validation"
    | "sif_exclusion"
    | "sif_entity_config"
    | "leaver_settlement"
    | "advance_unapplied"
    | "comp_change_pending";
  employeeId: string | null;
  name: string | null;
  message: string;
}

export interface PayrollClerkEntityResult {
  entityId: string;
  entityName: string;
  country: string;
  status: "draft_ready" | "draft_with_exceptions" | "already_posted";
  runId: string | null;
  headcount: number;
  netPay: number;
  currency: string;
  /** WPS view for AE entities. */
  wps: {
    applicable: boolean;
    exemptReason: string | null;
    /** Employees the SIF would exclude (blocking problems). */
    excludedCount: number;
  } | null;
  exceptionCount: number;
}

export interface PayrollClerkOutput {
  periodLabel: string;
  entities: PayrollClerkEntityResult[];
  exceptions: PayrollClerkException[];
  notifiedUserIds: string[];
  rationaleSummary: string;
}

export async function runPayrollClerk(args: {
  orgId: string;
  input: PayrollClerkInput;
  triggeredByUserId: string | null;
}): Promise<{ runId: string; output: PayrollClerkOutput }> {
  const periodLabel = args.input.periodLabel ?? new Date().toISOString().slice(0, 7);
  const res = await runAgent<PayrollClerkInput, PayrollClerkOutput>(
    {
      agentId: "ag_payroll_clerk",
      orgId: args.orgId,
      input: { periodLabel },
      triggeredByUserId: args.triggeredByUserId,
      targetType: "payroll_period",
      targetId: periodLabel,
      targetLabel: `Payroll Clerk · ${periodLabel}`,
    },
    async (ctx) => {
      const output = await executePayrollClerk(args.orgId, periodLabel, ctx.progress);
      return {
        output,
        confidence: output.exceptions.length === 0 ? "green" : "amber",
      };
    },
  );
  return { runId: res.runId, output: res.output };
}

async function executePayrollClerk(
  orgId: string,
  periodLabel: string,
  progress: (pct: number, msg: string) => Promise<void>,
): Promise<PayrollClerkOutput> {
  const today = new Date().toISOString().slice(0, 10);
  const periodEnd = `${periodLabel}-31`;
  const out: PayrollClerkOutput = {
    periodLabel,
    entities: [],
    exceptions: [],
    notifiedUserIds: [],
    rationaleSummary: "",
  };

  const entities = await db.select().from(atelierLegalEntities).where(and(
    eq(atelierLegalEntities.orgId, orgId),
    eq(atelierLegalEntities.status, "active"),
  ));
  const covered = entities.filter((e) => !!resolveRules(e.country, today));

  let i = 0;
  for (const ent of covered) {
    i++;
    const entityName = ent.shortName || ent.legalNameEn;
    await progress(Math.round((i / Math.max(covered.length, 1)) * 70), `Drafting ${entityName} · ${periodLabel}`);

    // 1. Compute/refresh the DRAFT run. Posted runs are returned as-is by
    //    the engine and never touched (approval/posting stays human-gated).
    const { run, lines } = await computePayrollRun({
      orgId: orgId,
      entityId: ent.id,
      periodLabel,
      createdByUserId: null,
    });
    const alreadyPosted = run.status === "posted";
    const pushEx = (e: Omit<PayrollClerkException, "entityId" | "entityName">) =>
      out.exceptions.push({ entityId: ent.id, entityName, ...e });

    // 2a. Engine validation errors → exceptions.
    if (!alreadyPosted) {
      for (const v of run.validationErrors ?? []) {
        pushEx({ code: "run_validation", employeeId: v.employeeId ?? null, name: v.name ?? null, message: v.message });
      }
    }

    // 2b. WPS SIF exclusions (AE only).
    let wps: PayrollClerkEntityResult["wps"] = null;
    if (ent.country === "AE") {
      const entityCfg = {
        entityId: ent.id,
        name: entityName,
        country: ent.country,
        freeZoneRegime: ent.statutory?.freeZoneRegime ?? null,
        wps: ent.statutory?.wps ?? null,
      };
      const app = wpsApplicability(entityCfg);
      let excludedCount = 0;
      if (app.applicable && lines.length > 0) {
        const empRows = await db.select({
          id: atelierEmployees.id,
          fullName: atelierEmployees.fullName,
          mohrePersonId: atelierEmployees.mohrePersonId,
          bankRoutingCode: atelierEmployees.bankRoutingCode,
          iban: atelierEmployees.iban,
        }).from(atelierEmployees).where(and(
          eq(atelierEmployees.orgId, orgId),
          inArray(atelierEmployees.id, lines.map((l) => l.employeeId)),
        ));
        const byId = new Map(empRows.map((e) => [e.id, e]));
        const sifInput: WpsEmployeeInput[] = lines.map((l) => {
          const e = byId.get(l.employeeId);
          return {
            employeeId: l.employeeId,
            name: e?.fullName ?? l.personName,
            mohrePersonId: e?.mohrePersonId ?? null,
            bankRoutingCode: e?.bankRoutingCode ?? null,
            iban: e?.iban ?? null,
            netPay: l.netPay,
            daysInMonth: l.daysInMonth,
            payableDays: l.payableDays,
            unpaidLeaveDays: l.unpaidLeaveDays,
          };
        });
        const built = buildWpsSif({ entity: entityCfg, periodLabel, employees: sifInput, generatedAt: new Date() });
        if (!built.ok) {
          const excluded = new Set<string>();
          for (const p of built.problems) {
            if (p.employeeId) {
              excluded.add(p.employeeId);
              pushEx({ code: "sif_exclusion", employeeId: p.employeeId, name: p.name, message: `${p.field}: ${p.message}` });
            } else {
              pushEx({ code: "sif_entity_config", employeeId: null, name: null, message: p.message });
            }
          }
          excludedCount = excluded.size;
        }
      }
      wps = { applicable: app.applicable, exemptReason: app.reason, excludedCount };
    }

    // 2c. Leavers with an end date in/before the period but no settlement.
    const leavers = await db.select({
      id: atelierEmployees.id,
      fullName: atelierEmployees.fullName,
      endDate: atelierEmployees.endDate,
    }).from(atelierEmployees).where(and(
      eq(atelierEmployees.orgId, orgId),
      eq(atelierEmployees.legalEntityId, ent.id),
      isNull(atelierEmployees.deletedAt),
      sql`${atelierEmployees.endDate} IS NOT NULL`,
      lte(atelierEmployees.endDate, periodEnd),
    ));
    const settlements = leavers.length > 0
      ? await db.select({ employeeId: atelierEosbSettlements.employeeId })
          .from(atelierEosbSettlements)
          .where(and(
            eq(atelierEosbSettlements.orgId, orgId),
            eq(atelierEosbSettlements.legalEntityId, ent.id),
            inArray(atelierEosbSettlements.employeeId, leavers.map((l) => l.id)),
            isNull(atelierEosbSettlements.deletedAt),
          ))
      : [];
    const settled = new Set(settlements.map((s) => s.employeeId));
    for (const l of leavers) {
      if (settled.has(l.id)) continue;
      pushEx({
        code: "leaver_settlement",
        employeeId: l.id,
        name: l.fullName,
        message: `left on ${l.endDate} but no EOSB settlement has been started — final pay needs a leaver settlement, not a regular salary line.`,
      });
    }

    // 2d. Active advances the draft run is NOT recovering.
    if (!alreadyPosted) {
      const advances = await db.select().from(atelierSalaryAdvances).where(and(
        eq(atelierSalaryAdvances.orgId, orgId),
        eq(atelierSalaryAdvances.legalEntityId, ent.id),
        eq(atelierSalaryAdvances.status, "active"),
        lte(atelierSalaryAdvances.startPeriod, periodLabel),
        isNull(atelierSalaryAdvances.deletedAt),
      ));
      const lineByEmp = new Map(lines.map((l) => [l.employeeId, l]));
      for (const adv of advances) {
        if (adv.outstanding <= 0) continue;
        const line = lineByEmp.get(adv.employeeId);
        if (!line || (line.advanceDeduction ?? 0) <= 0) {
          pushEx({
            code: "advance_unapplied",
            employeeId: adv.employeeId,
            name: adv.personName,
            message: `salary advance with ${adv.outstanding} ${adv.currency} outstanding is not being recovered by this draft (${line ? "no deduction on the line" : "employee has no payable line"}).`,
          });
        }
      }
    }

    // 2e. Comp changes effective later in the period → recompute needed.
    const empIds = lines.map((l) => l.employeeId);
    if (!alreadyPosted && empIds.length > 0) {
      const pending = await db.select().from(atelierCompChanges).where(and(
        eq(atelierCompChanges.orgId, orgId),
        inArray(atelierCompChanges.employeeId, empIds),
        gt(atelierCompChanges.effectiveFrom, today),
        lte(atelierCompChanges.effectiveFrom, periodEnd),
      ));
      for (const c of pending) {
        const line = lines.find((l) => l.employeeId === c.employeeId);
        pushEx({
          code: "comp_change_pending",
          employeeId: c.employeeId,
          name: line?.personName ?? null,
          message: `comp change effective ${c.effectiveFrom} lands later this period — recompute the draft before approval so the split is applied.`,
        });
      }
    }

    const entityExceptions = out.exceptions.filter((e) => e.entityId === ent.id).length;
    out.entities.push({
      entityId: ent.id,
      entityName,
      country: ent.country,
      status: alreadyPosted ? "already_posted" : entityExceptions > 0 ? "draft_with_exceptions" : "draft_ready",
      runId: run.id,
      headcount: run.totals.headcount,
      netPay: run.totals.netPay,
      currency: run.currency,
      wps,
      exceptionCount: entityExceptions,
    });
  }

  // 3. Notify finance leadership (review card). The clerk NEVER posts or
  //    pays — approval stays with the existing partner-gated flow.
  await progress(85, "Notifying finance");
  const drafts = out.entities.filter((e) => e.status !== "already_posted");
  if (drafts.length > 0) {
    const finance = await db.select({ id: atelierUsers.id, orgId: atelierUsers.orgId })
      .from(atelierUsers)
      .where(and(
        eq(atelierUsers.orgId, orgId),
        inArray(atelierUsers.role, ["founding_partner", "partner", "finance"]),
        isNull(atelierUsers.deletedAt),
      ));
    // Reruns refresh drafts idempotently — supersede any prior draft
    // notification for this org+period instead of stacking duplicates.
    await db.delete(atelierNotifications).where(and(
      eq(atelierNotifications.orgId, orgId),
      eq(atelierNotifications.kind, "payroll_clerk_draft"),
      eq(atelierNotifications.refId, periodLabel),
    ));
    for (const u of finance) {
      await db.insert(atelierNotifications).values({
        id: rid("ntf"),
        orgId: u.orgId,
        userId: u.id,
        kind: "payroll_clerk_draft",
        payload: {
          periodLabel,
          entities: out.entities,
          exceptionCount: out.exceptions.length,
        },
        channel: "in_app",
        subject: `Payroll ${periodLabel} — ${drafts.length} draft run(s) ready for review${out.exceptions.length ? ` · ${out.exceptions.length} exception(s)` : ""}`,
        body:
          `The Payroll Clerk prepared draft payroll for ${periodLabel}: ` +
          drafts.map((d) => `${d.entityName} (${d.headcount} people, ${d.netPay} ${d.currency}${d.wps && !d.wps.applicable ? ", WPS-exempt" : d.wps && d.wps.excludedCount > 0 ? `, ${d.wps.excludedCount} excluded from SIF` : ""})`).join("; ") +
          `. ${out.exceptions.length > 0 ? `${out.exceptions.length} exception(s) need attention before approval.` : "No exceptions found."}` +
          " Review and post in Finance → Payroll — the clerk never posts or pays.",
        refType: "payroll_period",
        refId: periodLabel,
        status: "queued",
      });
      out.notifiedUserIds.push(u.id);
    }
  }

  out.rationaleSummary =
    `Period ${periodLabel}: ${drafts.length} draft(s) prepared, ` +
    `${out.entities.filter((e) => e.status === "already_posted").length} already posted, ` +
    `${out.exceptions.length} exception(s) across ${covered.length} covered entit${covered.length === 1 ? "y" : "ies"}; ` +
    `notified ${out.notifiedUserIds.length} finance user(s).`;
  return out;
}
