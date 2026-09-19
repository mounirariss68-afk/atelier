/**
 * Self-Billing Clerk — Task #430 (rule-based, ag_self_billing_clerk).
 *
 * Composes RCTI (self-billed) invoices per (supplier, ISO week) from:
 *  - lead-approved contractor timesheet weeks (billable entries per
 *    engagement) at the contracted day rate / 8, and
 *  - uploaded partner-firm hours (cost amounts per engagement).
 *
 * Snapshots the rate source + VAT computation inputs on each invoice,
 * derives VAT from the issuing legal entity + supplier vat_treatment,
 * and reconciles every invoice against the payment-proposal rows
 * (atelier_contractor_payments / atelier_partner_firm_invoices).
 *
 * Idempotent: reruns refresh DRAFT invoices only. Approved / disputed /
 * scheduled / paid / rejected invoices are never touched.
 */

import {
  db,
  atelierSelfBilledInvoices,
  atelierSelfBillingSequences,
  atelierContractorPayments,
  atelierPartnerFirmInvoices,
  atelierTimesheetEntries,
  atelierTimesheetWeeks,
  atelierPartnerFirmHours,
  atelierUsers,
  atelierContractors,
  atelierPartnerFirms,
  atelierEngagements,
  atelierLegalEntities,
  atelierAuditEvents,
  atelierNotifications,
  type SelfBilledInvoiceLine,
  type SelfBilledRateSnapshot,
  type SelfBilledVat,
  type SelfBilledReconciliation,
} from "@workspace/db";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { convertToUsd } from "../atelier-fx.js";
import { resolveContractorRate, contractorRatePerHour } from "../atelier-contractor-rates.js";
import { runAgent } from "./runAgent.js";

const DEFAULT_HOURLY_FALLBACK_USD = 100;
const ORG_ID = "aico";

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function lastNIsoWeeks(n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n * 7 && out.length < n; i++) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    const w = isoWeekOf(d);
    if (!seen.has(w)) {
      seen.add(w);
      out.push(w);
    }
  }
  return out;
}

/** Race-safe-enough sequence: single UPDATE ... RETURNING per allocation. */
async function nextSeq(scope: string): Promise<number> {
  const id = `${scope}:${ORG_ID}`;
  const rows = await db
    .update(atelierSelfBillingSequences)
    .set({ nextValue: sql`${atelierSelfBillingSequences.nextValue} + 1`, updatedAt: new Date() })
    .where(eq(atelierSelfBillingSequences.id, id))
    .returning({ v: atelierSelfBillingSequences.nextValue });
  if (rows.length > 0) return Math.round(rows[0].v) - 1;
  await db
    .insert(atelierSelfBillingSequences)
    .values({ id, orgId: ORG_ID, nextValue: 2 })
    .onConflictDoNothing();
  return nextSeq(scope);
}

export async function nextInvoiceNumber(weekIso: string): Promise<string> {
  const n = await nextSeq("sbi");
  return `RCTI-${weekIso}-${String(n).padStart(4, "0")}`;
}

export async function nextRunNumber(): Promise<string> {
  const n = await nextSeq("payrun");
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `PR-${d}-${String(n).padStart(4, "0")}`;
}

/** Standard VAT rate by entity country for `standard` treatment. */
const STANDARD_VAT_BY_COUNTRY: Record<string, number> = {
  AE: 5,
  SA: 15,
  GB: 20,
  TR: 20,
};

function computeVat(args: {
  supplierVatTreatment: string | null;
  entityCountry: string | null;
  subtotal: number;
}): SelfBilledVat {
  const treatment = (args.supplierVatTreatment ?? "").toLowerCase() || "out_of_scope";
  let ratePct = 0;
  let note: string | null = null;
  if (treatment === "standard") {
    const rate = args.entityCountry ? STANDARD_VAT_BY_COUNTRY[args.entityCountry.toUpperCase()] : undefined;
    if (rate == null) {
      note = args.entityCountry
        ? `No standard VAT rate configured for entity country ${args.entityCountry}; applied 0%.`
        : "No issuing legal entity resolved; applied 0% VAT.";
    } else {
      ratePct = rate;
    }
  } else if (treatment === "reverse_charge") {
    note = "Reverse charge — VAT accounted for by the recipient.";
  } else if (treatment !== "zero_rated" && treatment !== "exempt" && treatment !== "out_of_scope") {
    note = `Unknown supplier VAT treatment "${treatment}"; applied 0%.`;
  }
  const amount = +(args.subtotal * (ratePct / 100)).toFixed(2);
  return {
    treatment,
    ratePct,
    amount,
    entityCountry: args.entityCountry,
    supplierVatTreatment: args.supplierVatTreatment,
    note,
  };
}

export interface SelfBillingClerkInput {
  weeksIso?: string[];
  supplierType?: "contractor" | "partner_firm";
}

export interface SelfBillingClerkOutput {
  weeksScanned: string[];
  invoicesCreated: number;
  invoicesUpdated: number;
  invoicesSkipped: number;
  reconciliationMismatches: number;
  exceptions: Array<{ code: string; supplierId: string; weekIso: string; message: string }>;
  rationaleSummary: string;
}

interface DraftInvoice {
  supplierType: "contractor" | "partner_firm";
  supplierId: string;
  supplierName: string;
  supplierEmail: string | null;
  payeeUserId: string | null;
  supplierVatTreatment: string | null;
  weekIso: string;
  currency: string;
  lines: SelfBilledInvoiceLine[];
  rateSnapshot: SelfBilledRateSnapshot;
  contractorPaymentIds: string[];
  partnerFirmInvoiceIds: string[];
}

export async function runSelfBillingClerk(args: {
  input: SelfBillingClerkInput;
  triggeredByUserId: string | null;
}): Promise<{ runId: string; output: SelfBillingClerkOutput }> {
  const weeksIso = args.input.weeksIso?.length ? args.input.weeksIso : lastNIsoWeeks(4);
  const res = await runAgent<SelfBillingClerkInput, SelfBillingClerkOutput>(
    {
      agentId: "ag_self_billing_clerk",
      input: args.input,
      triggeredByUserId: args.triggeredByUserId,
      targetType: "self_billing_period",
      targetId: weeksIso.join(","),
      targetLabel: `Self-billing run · ${weeksIso.join(", ")}`,
    },
    async (ctx) => {
      const output = await executeSelfBillingClerk(weeksIso, args.input.supplierType, ctx.runId, ctx.progress);
      return {
        output,
        confidence: output.exceptions.length === 0 && output.reconciliationMismatches === 0 ? "green" : "amber",
      };
    },
  );
  return { runId: res.runId, output: res.output };
}

async function executeSelfBillingClerk(
  weeksIso: string[],
  supplierTypeFilter: "contractor" | "partner_firm" | undefined,
  agentRunId: string,
  progress: (pct: number, msg: string) => Promise<void>,
): Promise<SelfBillingClerkOutput> {
  const out: SelfBillingClerkOutput = {
    weeksScanned: weeksIso,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    invoicesSkipped: 0,
    reconciliationMismatches: 0,
    exceptions: [],
    rationaleSummary: "",
  };
  const now = new Date().toISOString();

  const engagements = await db
    .select({ id: atelierEngagements.id, name: atelierEngagements.name })
    .from(atelierEngagements);
  const engagementName = new Map(engagements.map((e) => [e.id, e.name]));

  // Issuing entity: single active entity default (mirrors Bookkeeper).
  const entities = await db
    .select()
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, ORG_ID), eq(atelierLegalEntities.status, "active")));
  const defaultEntity = entities.length === 1 ? entities[0] : null;

  const drafts: DraftInvoice[] = [];

  // ── Contractor invoices from lead-approved timesheet weeks ──
  if (supplierTypeFilter !== "partner_firm") {
    await progress(15, "Scanning lead-approved contractor timesheet weeks");
    const weeks = await db
      .select()
      .from(atelierTimesheetWeeks)
      .where(
        and(
          isNull(atelierTimesheetWeeks.deletedAt),
          inArray(atelierTimesheetWeeks.status, ["lead_approved", "partner_approved"]),
          eq(atelierTimesheetWeeks.personType, "contractor"),
          inArray(atelierTimesheetWeeks.weekIso, weeksIso),
        ),
      );
    // supplierId|weekIso → draft
    const byKey = new Map<string, DraftInvoice>();
    for (const wk of weeks) {
      const [con] = await db
        .select()
        .from(atelierContractors)
        .where(and(eq(atelierContractors.id, wk.personId), isNull(atelierContractors.deletedAt)));
      if (!con) {
        out.exceptions.push({
          code: "unknown_contractor",
          supplierId: wk.personId,
          weekIso: wk.weekIso,
          message: `Lead-approved week ${wk.weekIso} references contractor ${wk.personId} not on the roster.`,
        });
        continue;
      }
      let payeeUserId: string | null = null;
      if (con.email) {
        const [u] = await db.select().from(atelierUsers).where(eq(atelierUsers.email, con.email));
        payeeUserId = u?.id ?? null;
      }
      const entries = await db
        .select()
        .from(atelierTimesheetEntries)
        .where(
          and(
            isNull(atelierTimesheetEntries.deletedAt),
            eq(atelierTimesheetEntries.weekId, wk.id),
            eq(atelierTimesheetEntries.billable, true),
            inArray(atelierTimesheetEntries.status, ["lead_approved", "approved", "partner_approved"]),
          ),
        );
      for (const e of entries) {
        if (!e.engagementId || !(e.hours && e.hours > 0)) continue;
        const resolved = await resolveContractorRate({
          orgId: con.orgId, contractorId: con.id, engagementId: e.engagementId,
          workDate: e.workDate, fallbackDayRate: DEFAULT_HOURLY_FALLBACK_USD * 8,
        });
        const ratePerHour = contractorRatePerHour(resolved) || DEFAULT_HOURLY_FALLBACK_USD;
        const rateCurrency = resolved.currency || "USD";
        // Invoice currency is part of the bucket: a term can change currency
        // during a week and must never be silently converted to roster currency.
        const key = `${con.id}|${wk.weekIso}|${rateCurrency}`;
        let draft = byKey.get(key);
        if (!draft) {
          draft = {
            supplierType: "contractor",
            supplierId: con.id,
            supplierName: con.fullName,
            supplierEmail: con.email ?? null,
            payeeUserId,
            supplierVatTreatment: con.vatTreatment ?? null,
            weekIso: wk.weekIso,
            currency: rateCurrency,
            lines: [],
            rateSnapshot: {
              source: resolved.source === "roster" ? "contractor_day_rate" : resolved.source === "engagement_term" ? "contractor_day_rate" : resolved.source,
              dayRateAmount: resolved.dayRateAmount,
              dayRateCurrency: resolved.currency,
              ratePerHour,
              capturedAt: now,
            },
            contractorPaymentIds: [],
            partnerFirmInvoiceIds: [],
          };
          byKey.set(key, draft);
          drafts.push(draft);
        }
        if (!draft.rateSnapshot) draft.rateSnapshot = {
          source: resolved.source === "roster" ? "contractor_day_rate" : resolved.source === "engagement_term" ? "contractor_day_rate" : resolved.source,
          dayRateAmount: resolved.dayRateAmount,
          dayRateCurrency: resolved.currency,
          ratePerHour,
          capturedAt: now,
        };
        const existing = draft.lines.find((l) => l.engagementId === e.engagementId && l.rateCurrency === rateCurrency && l.ratePerHour === ratePerHour);
        if (existing) {
          existing.hours += e.hours;
          existing.amount = +(existing.hours * ratePerHour).toFixed(2);
          existing.evidenceIds.push(e.id);
        } else {
          draft.lines.push({
            engagementId: e.engagementId,
            engagementName: engagementName.get(e.engagementId) ?? null,
            hours: e.hours,
            ratePerHour,
            rateCurrency,
            amount: +(e.hours * ratePerHour).toFixed(2),
            evidenceIds: [e.id],
          });
        }
      }
    }
  }

  // ── Partner-firm invoices from uploaded firm hours ──
  if (supplierTypeFilter !== "contractor") {
    await progress(35, "Scanning partner-firm hours");
    const pfHours = await db
      .select()
      .from(atelierPartnerFirmHours)
      .where(
        and(isNull(atelierPartnerFirmHours.deletedAt), inArray(atelierPartnerFirmHours.weekIso, weeksIso)),
      );
    const byKey = new Map<string, DraftInvoice>();
    for (const r of pfHours) {
      const key = `${r.partnerFirmId}|${r.weekIso}`;
      let draft = byKey.get(key);
      if (!draft) {
        const [firm] = await db
          .select()
          .from(atelierPartnerFirms)
          .where(eq(atelierPartnerFirms.id, r.partnerFirmId));
        draft = {
          supplierType: "partner_firm",
          supplierId: r.partnerFirmId,
          supplierName: firm?.name ?? r.partnerFirmId,
          supplierEmail: firm?.contactEmail ?? null,
          payeeUserId: null,
          supplierVatTreatment: null,
          weekIso: r.weekIso,
          currency: r.costCurrency ?? firm?.defaultBillingCurrency ?? "USD",
          lines: [],
          rateSnapshot: {
            source: "partner_firm_hours",
            dayRateAmount: null,
            dayRateCurrency: null,
            ratePerHour: 0,
            capturedAt: now,
          },
          contractorPaymentIds: [],
          partnerFirmInvoiceIds: [],
        };
        byKey.set(key, draft);
        drafts.push(draft);
      }
      const hours = r.hours ?? 0;
      const amount = r.costAmount ?? 0;
      if (hours <= 0 && amount <= 0) continue;
      const existing = draft.lines.find((l) => l.engagementId === r.engagementId);
      if (existing) {
        existing.hours += hours;
        existing.amount = +(existing.amount + amount).toFixed(2);
        existing.evidenceIds.push(r.id);
        existing.ratePerHour = existing.hours > 0 ? +(existing.amount / existing.hours).toFixed(2) : 0;
      } else {
        draft.lines.push({
          engagementId: r.engagementId,
          engagementName: engagementName.get(r.engagementId) ?? null,
          hours,
          ratePerHour: hours > 0 ? +(amount / hours).toFixed(2) : 0,
          rateCurrency: r.costCurrency ?? "USD",
          amount: +amount.toFixed(2),
          evidenceIds: [r.id],
        });
      }
    }
  }

  // ── Upsert invoices (idempotent; drafts only) ──
  await progress(55, "Composing self-billed invoices");
  for (const d of drafts) {
    d.lines = d.lines.filter((l) => l.amount > 0 || l.hours > 0);
    if (d.lines.length === 0) {
      out.invoicesSkipped++;
      continue;
    }
    const subtotal = +d.lines.reduce((s, l) => s + l.amount, 0).toFixed(2);
    const vat = computeVat({
      supplierVatTreatment: d.supplierVatTreatment,
      entityCountry: defaultEntity?.country ?? null,
      subtotal,
    });
    const total = +(subtotal + vat.amount).toFixed(2);
    const fx = await convertToUsd(total, d.currency, new Date());
    const totalUsd = +fx.usdAmount.toFixed(2);

    // Reconcile vs payment proposals for the same supplier + week.
    const recon = await reconcile(d, totalUsd, vat.amount, fx.rate);
    if (recon.record.status === "mismatch") out.reconciliationMismatches++;

    const [existing] = await db
      .select()
      .from(atelierSelfBilledInvoices)
      .where(
        and(
          eq(atelierSelfBilledInvoices.orgId, ORG_ID),
          eq(atelierSelfBilledInvoices.supplierType, d.supplierType),
          eq(atelierSelfBilledInvoices.supplierId, d.supplierId),
          eq(atelierSelfBilledInvoices.weekIso, d.weekIso),
          eq(atelierSelfBilledInvoices.currency, d.currency),
          isNull(atelierSelfBilledInvoices.deletedAt),
        ),
      );
    if (existing) {
      if (existing.status !== "draft") {
        out.invoicesSkipped++;
        continue;
      }
      await db
        .update(atelierSelfBilledInvoices)
        .set({
          supplierName: d.supplierName,
          supplierEmail: d.supplierEmail,
          payeeUserId: d.payeeUserId,
          legalEntityId: existing.legalEntityId ?? defaultEntity?.id ?? null,
          currency: d.currency,
          lines: d.lines,
          rateSnapshot: d.rateSnapshot,
          subtotalAmount: subtotal,
          vat,
          vatAmount: vat.amount,
          totalAmount: total,
          fxRate: fx.rate,
          totalUsd,
          contractorPaymentIds: recon.kind === "contractor" ? recon.proposalIds : [],
          partnerFirmInvoiceIds: recon.kind === "partner_firm" ? recon.proposalIds : [],
          reconciliation: recon.record,
          agentRunId,
          updatedAt: new Date(),
        })
        .where(eq(atelierSelfBilledInvoices.id, existing.id));
      out.invoicesUpdated++;
    } else {
      await db.insert(atelierSelfBilledInvoices).values({
        id: rid("sbi"),
        orgId: ORG_ID,
        invoiceNumber: await nextInvoiceNumber(d.weekIso),
        supplierType: d.supplierType,
        supplierId: d.supplierId,
        supplierName: d.supplierName,
        supplierEmail: d.supplierEmail,
        payeeUserId: d.payeeUserId,
        legalEntityId: defaultEntity?.id ?? null,
        weekIso: d.weekIso,
        currency: d.currency,
        lines: d.lines,
        rateSnapshot: d.rateSnapshot,
        subtotalAmount: subtotal,
        vat,
        vatAmount: vat.amount,
        totalAmount: total,
        fxRate: fx.rate,
        totalUsd,
        status: "draft",
        contractorPaymentIds: recon.kind === "contractor" ? recon.proposalIds : [],
        partnerFirmInvoiceIds: recon.kind === "partner_firm" ? recon.proposalIds : [],
        reconciliation: recon.record,
        agentRunId,
      });
      out.invoicesCreated++;
    }
  }

  await progress(85, "Recording audit trail");
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "self_billing_clerk",
    entityId: agentRunId,
    actorType: "agent",
    actorLabel: "Self-Billing Clerk",
    action: "finance.self_billing.run",
    payload: out as never,
    payloadSummary: `Self-Billing Clerk composed ${out.invoicesCreated} new + refreshed ${out.invoicesUpdated} draft invoice(s) across ${weeksIso.length} week(s); ${out.reconciliationMismatches} reconciliation mismatch(es).`,
  });

  // Notify partners when new drafts await approval.
  if (out.invoicesCreated > 0) {
    const partners = await db
      .select({ id: atelierUsers.id, orgId: atelierUsers.orgId })
      .from(atelierUsers)
      .where(and(inArray(atelierUsers.role, ["partner", "founding_partner"]), isNull(atelierUsers.deletedAt)));
    for (const p of partners) {
      await db.insert(atelierNotifications).values({
        id: rid("ntf"),
        orgId: p.orgId,
        userId: p.id,
        kind: "self_billing_drafts",
        payload: { agentRunId, created: out.invoicesCreated, mismatches: out.reconciliationMismatches },
        channel: "in_app",
        subject: `Self-billing — ${out.invoicesCreated} invoice draft(s) for review`,
        body: `The Self-Billing Clerk composed ${out.invoicesCreated} self-billed invoice draft(s) for weeks ${weeksIso.join(", ")}. Review and approve them in Finance → Payables.`,
        refType: "self_billed_invoice",
        refId: agentRunId,
        status: "queued",
      });
    }
  }

  out.rationaleSummary =
    `Scanned weeks ${weeksIso.join(", ")}: created ${out.invoicesCreated}, refreshed ${out.invoicesUpdated} draft(s), ` +
    `skipped ${out.invoicesSkipped} non-draft/empty, ${out.reconciliationMismatches} reconciliation mismatch(es), ` +
    `${out.exceptions.length} exception(s).`;
  return out;
}

async function reconcile(
  d: DraftInvoice,
  invoiceTotalUsd: number,
  vatAmount: number,
  fxRate: number,
): Promise<{ kind: "contractor" | "partner_firm"; proposalIds: string[]; record: SelfBilledReconciliation }> {
  const notes: string[] = [];
  let proposalIds: string[] = [];
  let proposalTotalUsd: number | null = null;
  if (d.supplierType === "contractor") {
    // Proposals key on payeeUserId (user id when linked, else contractor id).
    const payeeIds = [d.supplierId, ...(d.payeeUserId ? [d.payeeUserId] : [])];
    const props = await db
      .select()
      .from(atelierContractorPayments)
      .where(
        and(
          inArray(atelierContractorPayments.payeeUserId, payeeIds),
          eq(atelierContractorPayments.weekIso, d.weekIso),
          isNull(atelierContractorPayments.deletedAt),
        ),
      );
    const evidenceBuckets = new Set(d.lines.map((l) => [...l.evidenceIds].sort().join(",")));
    const matchedCandidates = props.filter((p) =>
      (p.rateCurrency ?? "USD").toUpperCase() === d.currency.toUpperCase() &&
      evidenceBuckets.has([...((p.evidenceEntryIds ?? []) as string[])].sort().join(",")),
    );
    // A corrected proposed row may coexist with immutable history for the
    // same evidence. Link one canonical row per evidence set (the oldest
    // historical row), never both.
    const matchedByEvidence = new Map<string, typeof matchedCandidates[number]>();
    for (const p of matchedCandidates) {
      const key = [...((p.evidenceEntryIds ?? []) as string[])].sort().join(",");
      const prior = matchedByEvidence.get(key);
      const immutable = p.status === "approved" || p.status === "partner_approved" ||
        p.status === "paid" || p.status === "rejected";
      const priorImmutable = prior && (prior.status === "approved" || prior.status === "partner_approved" ||
        prior.status === "paid" || prior.status === "rejected");
      if (!prior || (immutable && !priorImmutable)) matchedByEvidence.set(key, p);
    }
    const matched = [...matchedByEvidence.values()];
    proposalIds = matched.map((p) => p.id);
    if (matched.length > 0) proposalTotalUsd = +matched.reduce((s, p) => s + (p.usdAmount ?? 0), 0).toFixed(2);
  } else {
    const props = await db
      .select()
      .from(atelierPartnerFirmInvoices)
      .where(
        and(
          eq(atelierPartnerFirmInvoices.partnerFirmId, d.supplierId),
          eq(atelierPartnerFirmInvoices.weekIso, d.weekIso),
          isNull(atelierPartnerFirmInvoices.deletedAt),
        ),
      );
    proposalIds = props.map((p) => p.id);
    if (props.length > 0) proposalTotalUsd = +props.reduce((s, p) => s + (p.usdAmount ?? 0), 0).toFixed(2);
  }
  // Proposals carry no VAT — compare against the pre-VAT subtotal in USD.
  const subtotalUsd = +((invoiceTotalUsd - vatAmount * fxRate) as number).toFixed(2);
  let status: string;
  let deltaUsd: number | null = null;
  if (proposalTotalUsd == null) {
    status = "no_proposal";
    notes.push("No payment-proposal rows found for this supplier + week.");
  } else {
    deltaUsd = +(subtotalUsd - proposalTotalUsd).toFixed(2);
    if (Math.abs(deltaUsd) <= 0.01) {
      status = "matched";
    } else {
      status = "mismatch";
      notes.push(
        `Invoice subtotal $${subtotalUsd.toFixed(2)} differs from proposal total $${proposalTotalUsd.toFixed(2)} by $${deltaUsd.toFixed(2)}.`,
      );
    }
  }
  return {
    kind: d.supplierType,
    proposalIds,
    record: {
      status,
      proposalIds,
      proposalTotalUsd,
      invoiceTotalUsd: subtotalUsd,
      deltaUsd,
      notes,
      checkedAt: new Date().toISOString(),
    },
  };
}
