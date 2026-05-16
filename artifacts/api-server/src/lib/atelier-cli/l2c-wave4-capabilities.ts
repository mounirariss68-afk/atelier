/**
 * Task #363 — L2C Wave 4 CLI capabilities (cash, bank, forecast, renewals).
 *
 * Restricted personas (contractor / partner_firm_resource / recruiter)
 * are denied module-wide at the catalog gate. board_observer is denied
 * on every Wave-4 capability EXCEPT `cash_forecast_13w`, which is
 * surfaced via `BOARD_OBSERVER_ROLLUP_ALLOWLIST`.
 *
 * Capabilities below execute end-to-end so the CLI mirrors the HTTP
 * routes in bankRoutes.ts / cashRoutes.ts / renewalRoutes.ts.
 */

import { and, eq, isNull, desc, sql, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import {
  db,
  atelierBankAccount,
  atelierBankStatementImport,
  atelierBankTransaction,
  atelierBankReconPeriod,
  atelierCashReceipt,
  atelierCashApplication,
  atelierCashForecastSnapshot,
  atelierRenewal,
  atelierInvoice,
  atelierContract,
  atelierAuditEvents,
  atelierPeriodCloseLock,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { parseBankStatement } from "../bank-parsers/index.js";
import {
  runCashApplicationMatcher,
  runCashFlowForecaster,
} from "../atelier-agents/runner.js";
import {
  isRestrictedPersona,
  isBoardObserver,
} from "../../routes/atelier/personaRoles.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function denyForbidden(msg: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: msg };
}
function denyInvalid(msg: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: msg };
}
function denyRestricted(p: CliPersona, allowBoardObserver = false): ToolResult | null {
  if (isRestrictedPersona(p.role)) return denyForbidden("Wave 4 capabilities are denied for this persona.");
  if (!allowBoardObserver && isBoardObserver(p.role)) {
    return denyForbidden("board_observer cannot execute this capability (rollup-only access).");
  }
  return null;
}
function isPartnerTier(p: CliPersona): boolean {
  return p.role === "founding_partner" || p.role === "partner";
}
function isFinanceLeadership(p: CliPersona): boolean {
  return isPartnerTier(p) || p.role === "finance";
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

async function recordAudit(
  ctx: ToolContext, entityType: string, entityId: string,
  action: string, payload: Record<string, unknown>, summary: string,
): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), entityType, entityId,
    actorType: "human", actorId: ctx.persona.id, actorLabel: ctx.persona.name,
    action, payload: { ...payload, viaCli: true, turnId: ctx.turnId }, payloadSummary: summary,
  });
}

// ───────────────────────── bank.import ─────────────────────────
defineCapability({
  id: "bank.import",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "bank_import",
  description: "Import a bank statement (csv|xero) into a registered bank account.",
  slashAliases: { en: ["/bank-import", "/import-bank"] },
  inputSchema: {
    type: "object",
    properties: {
      bankAccountId: { type: "string" },
      source: { type: "string", enum: ["csv", "xero"] },
      raw: { type: "string", description: "Raw CSV body" },
      statementDate: { type: "string", description: "ISO date YYYY-MM-DD" },
    },
    required: ["bankAccountId", "raw", "statementDate"],
  },
  isWrite: true, twoPhaseConfirm: true, outboundChannel: null,
  resultCard: "entity_card", irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance"],
  surfaceOn: ["wallet"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    if (!isFinanceLeadership(ctx.persona)) return denyForbidden("finance/partner only");
    const i = input as { bankAccountId?: string; source?: "csv" | "xero"; raw?: string; statementDate?: string };
    if (!i.bankAccountId || !i.raw || !i.statementDate) return denyInvalid("bankAccountId, raw, statementDate required");
    const [acct] = await db.select().from(atelierBankAccount)
      .where(and(eq(atelierBankAccount.id, i.bankAccountId), eq(atelierBankAccount.orgId, ctx.persona.orgId)));
    if (!acct) return { ok: false, errorCode: "not_found", errorMessage: "bank account not found" };
    const fileHash = createHash("sha256").update(i.raw).digest("hex").slice(0, 16);
    const dup = await db.select({ id: atelierBankStatementImport.id }).from(atelierBankStatementImport)
      .where(and(eq(atelierBankStatementImport.orgId, ctx.persona.orgId),
        eq(atelierBankStatementImport.bankAccountId, i.bankAccountId),
        eq(atelierBankStatementImport.fileHash, fileHash)));
    if (dup.length > 0) return { ok: false, errorCode: "duplicate", errorMessage: "Statement already imported", data: { importId: dup[0].id } };
    const parsed = parseBankStatement(i.source ?? "csv", i.raw, acct.currency);
    const importId = rid("bnkimp");
    await db.insert(atelierBankStatementImport).values({
      id: importId, orgId: ctx.persona.orgId, bankAccountId: i.bankAccountId,
      statementDate: i.statementDate, source: i.source ?? "csv", fileHash, rowsCount: parsed.rows.length,
      importedBy: ctx.persona.id, createdByUserId: ctx.persona.id,
    });
    if (parsed.rows.length > 0) {
      await db.insert(atelierBankTransaction).values(parsed.rows.map((r) => ({
        id: rid("bnktxn"), orgId: ctx.persona.orgId, bankAccountId: i.bankAccountId!,
        statementImportId: importId, postedDate: r.postedDate, amount: r.amount, currency: r.currency,
        counterpartyNameRaw: r.counterpartyNameRaw, referenceRaw: r.referenceRaw,
        kind: r.kind, matchedState: "unmatched", createdByUserId: ctx.persona.id,
      })));
    }
    await recordAudit(ctx, "bank_statement_import", importId, "bank_import.create",
      { rowsCount: parsed.rows.length }, `Imported ${parsed.rows.length} bank rows`);
    return {
      ok: true,
      data: {
        importId,
        rowsImported: parsed.rows.length,
        errors: parsed.errors,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
      resultCardHint: "entity_card",
    };
  },
});

// ───────────────────────── cash.apply ─────────────────────────
defineCapability({
  id: "cash.apply",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "cash",
  toolName: "cash_apply",
  description: "Apply a cash receipt against one or more open invoices.",
  slashAliases: { en: ["/apply-cash", "/cash-apply"] },
  inputSchema: {
    type: "object",
    properties: {
      cashReceiptId: { type: "string" },
      applications: {
        type: "array",
        items: {
          type: "object",
          properties: {
            invoiceId: { type: "string" },
            appliedAmount: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["invoiceId", "appliedAmount"],
        },
      },
    },
    required: ["cashReceiptId", "applications"],
  },
  isWrite: true, twoPhaseConfirm: true, outboundChannel: null,
  resultCard: "cash_receipt_card", irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance"],
  surfaceOn: ["wallet"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    if (!isFinanceLeadership(ctx.persona)) return denyForbidden("finance/partner only");
    const i = input as { cashReceiptId?: string; applications?: Array<{ invoiceId: string; appliedAmount: number; rationale?: string }> };
    if (!i.cashReceiptId || !Array.isArray(i.applications) || i.applications.length === 0)
      return denyInvalid("cashReceiptId + applications[] required");
    const [r] = await db.select().from(atelierCashReceipt)
      .where(and(eq(atelierCashReceipt.id, i.cashReceiptId), eq(atelierCashReceipt.orgId, ctx.persona.orgId)));
    if (!r) return { ok: false, errorCode: "not_found", errorMessage: "receipt not found" };
    const totalRequested = i.applications.reduce((s, a) => s + (Number(a.appliedAmount) || 0), 0);
    const remaining = round2(r.totalAmount - r.appliedAmount);
    if (totalRequested - remaining > 0.01) return denyInvalid(`over-apply: ${totalRequested} > ${remaining}`);
    const invoices = await db.select().from(atelierInvoice).where(and(
      eq(atelierInvoice.orgId, ctx.persona.orgId),
      inArray(atelierInvoice.id, i.applications.map((a) => a.invoiceId)),
    ));
    if (invoices.length !== i.applications.length) return { ok: false, errorCode: "not_found", errorMessage: "invoice not found" };
    const created: string[] = [];
    for (const a of i.applications) {
      const inv = invoices.find((x) => x.id === a.invoiceId)!;
      const outstanding = round2(inv.total - inv.amountPaid);
      if (a.appliedAmount > outstanding + 0.01) return denyInvalid(`over-apply on ${inv.id}: outstanding ${outstanding}`);
      const appId = rid("capp");
      await db.insert(atelierCashApplication).values({
        id: appId, orgId: ctx.persona.orgId, cashReceiptId: r.id, invoiceId: inv.id,
        appliedAmount: a.appliedAmount, currency: r.currency,
        appliedByUserId: ctx.persona.id, rationaleText: a.rationale ?? null, createdByUserId: ctx.persona.id,
      });
      const newPaid = round2(inv.amountPaid + a.appliedAmount);
      await db.update(atelierInvoice).set({
        amountPaid: newPaid,
        status: newPaid >= inv.total - 0.01 ? "paid" : inv.status,
        paidAt: newPaid >= inv.total - 0.01 ? new Date() : inv.paidAt,
        updatedAt: new Date(),
      }).where(eq(atelierInvoice.id, inv.id));
      created.push(appId);
      await recordAudit(ctx, "cash_application", appId, "cash_apply.commit",
        { receiptId: r.id, invoiceId: inv.id, applied: a.appliedAmount },
        `Applied ${r.currency} ${a.appliedAmount} to ${inv.invoiceNumber ?? inv.id}`);
    }
    await db.update(atelierCashReceipt).set({
      appliedAmount: round2(r.appliedAmount + totalRequested), updatedAt: new Date(),
    }).where(eq(atelierCashReceipt.id, r.id));
    return {
      ok: true,
      data: {
        receipt: { id: r.id, totalAmount: r.totalAmount, appliedAmount: round2(r.appliedAmount + totalRequested) },
        applicationIds: created,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
      resultCardHint: "cash_receipt_card",
    };
  },
});

// ───────────────────────── cash.match ─────────────────────────
defineCapability({
  id: "cash.match",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "cash",
  toolName: "cash_match",
  description: "Run the Cash Application Matcher to propose invoice matches for an unapplied receipt.",
  slashAliases: { en: ["/match-cash", "/cash-match"] },
  inputSchema: { type: "object", properties: { cashReceiptId: { type: "string" } }, required: ["cashReceiptId"] },
  isWrite: false, twoPhaseConfirm: false, outboundChannel: null,
  resultCard: "cash_receipt_card", irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance"],
  surfaceOn: ["wallet"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    const i = input as { cashReceiptId?: string };
    if (!i.cashReceiptId) return denyInvalid("cashReceiptId required");
    const [r] = await db.select().from(atelierCashReceipt)
      .where(and(eq(atelierCashReceipt.id, i.cashReceiptId), eq(atelierCashReceipt.orgId, ctx.persona.orgId)));
    if (!r) return { ok: false, errorCode: "not_found", errorMessage: "receipt not found" };
    const [txn] = await db.select().from(atelierBankTransaction).where(eq(atelierBankTransaction.id, r.bankTransactionId));
    const open = (await db.select().from(atelierInvoice)
      .where(and(eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt))))
      .filter((x) => x.total - x.amountPaid > 0.01);
    const out = await runCashApplicationMatcher({
      receipt: {
        id: r.id, totalAmount: r.totalAmount - r.appliedAmount, currency: r.currency,
        counterpartyNameRaw: txn?.counterpartyNameRaw ?? null,
        referenceRaw: txn?.referenceRaw ?? null, postedDate: r.receivedAt,
      },
      openInvoices: open.map((x) => ({
        id: x.id, invoiceNumber: x.invoiceNumber,
        billToName: (x.billTo as { name?: string } | null)?.name ?? null,
        currency: x.currency, total: x.total, amountPaid: x.amountPaid, dueDate: x.dueDate,
      })),
      triggeredByUserId: ctx.persona.id, actorLabel: ctx.persona.name,
    });
    return { ok: true, data: out.output, resultCardHint: "cash_receipt_card" };
  },
});

// ───────────────────────── bank.recon.finalise ─────────────────────────
defineCapability({
  id: "bank.recon.finalise",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "bank",
  toolName: "bank_recon_finalise",
  description: "Irreversibly finalise a bank reconciliation period (partner-tier).",
  slashAliases: { en: ["/finalise-recon"] },
  inputSchema: {
    type: "object",
    properties: {
      reconId: { type: "string" }, rationale: { type: "string" }, varianceAccepted: { type: "boolean" },
    },
    required: ["reconId"],
  },
  isWrite: true, twoPhaseConfirm: true, outboundChannel: null,
  resultCard: "bank_recon_card", irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  approverRoles: ["founding_partner", "partner"],
  surfaceOn: ["wallet"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    if (!isPartnerTier(ctx.persona)) return denyForbidden("partner-tier only");
    const i = input as { reconId?: string; rationale?: string; varianceAccepted?: boolean };
    if (!i.reconId) return denyInvalid("reconId required");
    const [period] = await db.select().from(atelierBankReconPeriod)
      .where(and(eq(atelierBankReconPeriod.id, i.reconId), eq(atelierBankReconPeriod.orgId, ctx.persona.orgId)));
    if (!period) return { ok: false, errorCode: "not_found", errorMessage: "recon period not found" };
    if (period.status === "finalised") return { ok: false, errorCode: "already_finalised", errorMessage: "already finalised" };
    if (Math.abs(period.variance) > 0.01 && !i.varianceAccepted)
      return { ok: false, errorCode: "variance_present", errorMessage: `variance ${period.variance}; pass varianceAccepted=true` };
    await db.update(atelierBankReconPeriod).set({
      status: "finalised", finalisedAt: new Date(), finalisedByUserId: ctx.persona.id,
      approvedByUserId: ctx.persona.id, rationaleText: i.rationale ?? null, updatedAt: new Date(),
    }).where(eq(atelierBankReconPeriod.id, i.reconId));
    const monthLabel = period.periodEnd.slice(0, 7);
    const [lock] = await db.select().from(atelierPeriodCloseLock)
      .where(and(eq(atelierPeriodCloseLock.orgId, ctx.persona.orgId), eq(atelierPeriodCloseLock.periodLabel, monthLabel)));
    if (lock) {
      const next = Array.from(new Set([...(lock.lockedModules ?? []), "bank_rec"]));
      await db.update(atelierPeriodCloseLock).set({ lockedModules: next, updatedAt: new Date() })
        .where(eq(atelierPeriodCloseLock.id, lock.id));
    }
    await recordAudit(ctx, "bank_recon_period", i.reconId, "bank_recon.finalise",
      { variance: period.variance, varianceAccepted: !!i.varianceAccepted },
      `Finalised recon ${period.periodLabel}`);
    return {
      ok: true,
      data: {
        id: i.reconId,
        status: "finalised",
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
      resultCardHint: "bank_recon_card",
    };
  },
});

// ───────────────────────── cash_forecast_13w ─────────────────────────
defineCapability({
  id: "cash_forecast_13w",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "treasury",
  toolName: "cash_forecast_13w",
  description: "Compute / read the 13-week direct-method cash forecast snapshot (firm-wide rollup).",
  slashAliases: { en: ["/cash-forecast", "/13-week"] },
  representativePrompts: { en: ["Show the 13-week cash forecast", "Run the cash forecaster"] },
  inputSchema: {
    type: "object",
    properties: {
      compute: { type: "boolean", description: "If true, run the Cash Flow Forecaster and snapshot." },
    },
  },
  isWrite: false, twoPhaseConfirm: false, outboundChannel: null,
  resultCard: "cash_forecast_strip", irreversible: false,
  // board_observer allow-listed via BOARD_OBSERVER_ROLLUP_ALLOWLIST.
  requiredRoles: ["founding_partner", "partner", "finance", "board_observer"],
  surfaceOn: ["wallet", "home"],
  async run(input, ctx) {
    if (isRestrictedPersona(ctx.persona.role)) return denyForbidden("forbidden");
    const i = input as { compute?: boolean };
    if (i.compute && !isFinanceLeadership(ctx.persona)) return denyForbidden("finance/partner only for compute=true");
    if (i.compute) {
      const out = await runCashFlowForecaster({
        asOf: new Date().toISOString().slice(0, 10),
        currency: "USD", openingBalance: 0,
        triggeredByUserId: ctx.persona.id, actorLabel: ctx.persona.name,
      });
      // Persist 13 rows
      const snapshotId = out.output.snapshotId;
      await db.insert(atelierCashForecastSnapshot).values(out.output.weeks.map((w) => ({
        id: rid("cfc"), orgId: ctx.persona.orgId, snapshotId,
        weekIndex: w.weekIndex, weekStart: w.weekStart,
        expectedIn: w.expectedIn, expectedOut: w.expectedOut,
        openingBalance: w.openingBalance, closingBalance: w.closingBalance,
        confidenceLow: w.confidenceLow, confidenceHigh: w.confidenceHigh,
        isCashGap: w.isCashGap, currency: out.output.currency,
        inputEvidenceRef: snapshotId, computedByAgentRunId: out.runId,
        createdByUserId: ctx.persona.id,
      })));
      return { ok: true, data: out.output, resultCardHint: "cash_forecast_strip" };
    }
    // Read latest snapshot.
    const rows = await db.select().from(atelierCashForecastSnapshot)
      .where(eq(atelierCashForecastSnapshot.orgId, ctx.persona.orgId))
      .orderBy(desc(atelierCashForecastSnapshot.snapshotAt)).limit(13);
    return {
      ok: true,
      data: {
        weeks: rows.sort((a, b) => a.weekIndex - b.weekIndex),
        cashGapWeeks: rows.filter((r) => r.isCashGap).map((r) => r.weekIndex),
      },
      resultCardHint: "cash_forecast_strip",
    };
  },
});

// ───────────────────────── renewal.open ─────────────────────────
defineCapability({
  id: "renewal.open",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "renewal",
  toolName: "renewal_open",
  description: "Open a renewal motion (manual entry; auto-open uses /crm/renewals/auto-open).",
  slashAliases: { en: ["/open-renewal", "/renew"] },
  inputSchema: {
    type: "object",
    properties: {
      accountId: { type: "string" }, contractId: { type: "string" }, engagementId: { type: "string" },
      currentArrUsd: { type: "number" }, proposedArrUsd: { type: "number" },
      expansionTargetUsd: { type: "number" }, renewalDueAt: { type: "string" },
      riskTier: { type: "string", enum: ["green", "amber", "red"] },
    },
  },
  isWrite: true, twoPhaseConfirm: true, outboundChannel: null,
  resultCard: "renewal_card", irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "finance"],
  surfaceOn: ["account_workspace", "engagement_dashboard", "wallet", "home"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    const i = input as {
      accountId?: string; contractId?: string; engagementId?: string;
      currentArrUsd?: number; proposedArrUsd?: number; expansionTargetUsd?: number;
      renewalDueAt?: string; riskTier?: "green" | "amber" | "red";
    };
    if (!i.accountId && !i.contractId && !i.engagementId)
      return denyInvalid("Provide accountId / contractId / engagementId.");
    const id = rid("ren");
    const cur = i.currentArrUsd ?? 0;
    const proposed = i.proposedArrUsd ?? cur;
    const nrr = cur > 0 ? Math.round(((proposed - cur) / cur) * 1000) / 10 : 0;
    await db.insert(atelierRenewal).values({
      id, orgId: ctx.persona.orgId, engagementId: i.engagementId ?? null,
      contractId: i.contractId ?? null, accountId: i.accountId ?? null,
      currentArrUsd: cur, proposedArrUsd: proposed,
      expansionTargetUsd: i.expansionTargetUsd ?? 0, nrrDeltaPct: nrr,
      renewalDueAt: i.renewalDueAt ?? null, riskTier: i.riskTier ?? "green",
      partnerOwnerId: ctx.persona.id, status: "open", createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, "renewal", id, "renewal.open",
      { accountId: i.accountId, currentArrUsd: cur, nrrDeltaPct: nrr },
      `Opened renewal ARR $${cur} → $${proposed} (${nrr >= 0 ? "+" : ""}${nrr}% NRR)`);
    // Task #511 — opened renewals land on the originating account/engagement.
    const renewalNav = i.engagementId
      ? `/clients/deliver/engagements/${i.engagementId}`
      : i.accountId
        ? `/accounts/${i.accountId}`
        : null;
    return {
      ok: true,
      data: {
        renewal: {
          id, accountId: i.accountId ?? null, contractId: i.contractId ?? null,
          currentArrUsd: cur, proposedArrUsd: proposed, nrrDeltaPct: nrr,
          renewalDueAt: i.renewalDueAt ?? null, riskTier: i.riskTier ?? "green",
          status: "open",
        },
        navigateTo: renewalNav
          ? { path: renewalNav, when: "on_commit" as const }
          : null,
      },
      resultCardHint: "renewal_card",
    };
  },
});

// ───────────────────────── renewal.list ─────────────────────────
defineCapability({
  id: "renewal.list",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "renewal",
  toolName: "renewal_list",
  description: "List open renewals (firm-wide).",
  slashAliases: { en: ["/renewals", "/list-renewals"] },
  inputSchema: {
    type: "object",
    properties: { status: { type: "string", enum: ["open", "won", "lost", "withdrawn"] } },
  },
  isWrite: false, twoPhaseConfirm: false, outboundChannel: null,
  resultCard: "ranked_list", irreversible: false,
  requiredRoles: ["founding_partner", "partner", "senior_manager", "finance"],
  surfaceOn: ["account_workspace", "wallet", "home"],
  async run(input, ctx) {
    const den = denyRestricted(ctx.persona); if (den) return den;
    const status = (input as { status?: string }).status ?? "open";
    const rows = await db.select().from(atelierRenewal)
      .where(and(eq(atelierRenewal.orgId, ctx.persona.orgId), eq(atelierRenewal.status, status), isNull(atelierRenewal.deletedAt)))
      .orderBy(desc(atelierRenewal.renewalDueAt)).limit(100);
    return {
      ok: true,
      data: {
        items: rows.map((r) => ({
          id: r.id, accountId: r.accountId, currentArrUsd: r.currentArrUsd,
          proposedArrUsd: r.proposedArrUsd, nrrDeltaPct: r.nrrDeltaPct,
          riskTier: r.riskTier, renewalDueAt: r.renewalDueAt, status: r.status,
          usdAmount: r.proposedArrUsd,
        })),
        total: rows.length,
      },
      resultCardHint: "ranked_list",
    };
  },
});
