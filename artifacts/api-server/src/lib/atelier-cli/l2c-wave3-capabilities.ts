/**
 * Task #362 — L2C Wave 3 CLI capabilities (invoicing, AR, dunning).
 *
 * Restricted personas (contractor, partner_firm_resource, recruiter) and
 * board_observer are denied on every Wave 3 capability except `ar_aging`
 * (the rollup view, which board_observer is allowed to read).
 *
 * The capabilities below execute the writes themselves so they are
 * end-to-end usable from the CLI. They mirror the role gates and ZATCA
 * VRN precheck enforced by the HTTP routes in `invoiceRoutes.ts`.
 */

import { and, eq, isNull, desc, sql, inArray } from "drizzle-orm";
import {
  db,
  atelierInvoice,
  atelierInvoiceLine,
  atelierInvoiceSequence,
  atelierEinvoiceSubmission,
  atelierDunningLadder,
  atelierDunningEvent,
  atelierPromiseToPay,
  atelierAuditEvents,
  atelierTimesheetEntries,
  atelierExpenses,
  atelierAccounts,
} from "@workspace/db";
import { toUsdSync, FxRateMissingError } from "../atelier-fx.js";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import {
  channelForJurisdiction,
  submitEinvoice,
} from "../atelier-einvoice.js";
import {
  isRestrictedPersona,
  isBoardObserver,
} from "../../routes/atelier/personaRoles.js";
import type { CliPersona, ToolContext, ToolResult } from "./index.js";
import { resolveDunnableInvoiceByText } from "./finance-name-resolvers.js";

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const VAT_RATE_BY_JURISDICTION: Record<string, number> = { AE: 5, SA: 15, EU: 20, GLOBAL: 0 };
const JURISDICTIONS = new Set(["AE", "SA", "EU", "GLOBAL"]);

function isPartnerTier(p: CliPersona): boolean {
  return p.role === "founding_partner" || p.role === "partner";
}
function isFinanceLeadership(p: CliPersona): boolean {
  return isPartnerTier(p) || p.role === "finance";
}
function denyForbidden(msg: string): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: msg };
}
function denyInvalid(msg: string): ToolResult {
  return { ok: false, errorCode: "invalid_input", errorMessage: msg };
}
function denyRestricted(p: CliPersona, allowBoardObserver: boolean = false): ToolResult | null {
  if (isRestrictedPersona(p.role)) return denyForbidden("Wave 3 capabilities are denied for this persona.");
  if (!allowBoardObserver && isBoardObserver(p.role)) {
    return denyForbidden("board_observer cannot execute this capability (rollup-only access).");
  }
  return null;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

async function recordAudit(
  ctx: ToolContext,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  summary: string,
): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: "invoice",
    entityId,
    actorType: "human",
    actorId: ctx.persona.id,
    actorLabel: ctx.persona.name,
    action,
    payload: { ...payload, viaCli: true, turnId: ctx.turnId },
    payloadSummary: summary,
  });
}

async function loadFull(orgId: string, invoiceId: string) {
  const [inv] = await db.select().from(atelierInvoice).where(
    and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, orgId), isNull(atelierInvoice.deletedAt)),
  );
  if (!inv) return null;
  const lines = await db.select().from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, invoiceId)).orderBy(atelierInvoiceLine.ord);
  const submissions = await db.select().from(atelierEinvoiceSubmission).where(eq(atelierEinvoiceSubmission.invoiceId, invoiceId));
  const promises = await db.select().from(atelierPromiseToPay).where(eq(atelierPromiseToPay.invoiceId, invoiceId)).orderBy(desc(atelierPromiseToPay.createdAt));
  return { invoice: inv, lines, submissions, promises };
}

function recomputeTotals(lines: Array<{ amount: number }>, vatRatePct: number) {
  const subtotal = round2(lines.reduce((s, l) => s + l.amount, 0));
  const vat = round2((subtotal * vatRatePct) / 100);
  return { subtotal, vat, total: round2(subtotal + vat) };
}

// ───────────────────────── wallet.invoice.draft ─────────────────────────
defineCapability({
  id: "wallet.invoice.draft",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_invoice_draft",
  description:
    "Draft a new invoice. Required: jurisdiction (AE|SA|EU|GLOBAL), billToName. Optional: engagementId, currency, dueDate, billToVatId (required at issue time for SA/ZATCA).",
  slashAliases: { en: ["/draft-invoice", "/new-invoice"] },
  inputSchema: {
    type: "object",
    properties: {
      jurisdiction: { type: "string", enum: ["AE", "SA", "EU", "GLOBAL"] },
      engagementId: { type: "string" },
      billToName: { type: "string" },
      billToEmail: { type: "string" },
      billToVatId: { type: "string" },
      currency: { type: "string" },
      dueDate: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["jurisdiction", "billToName"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "invoice_card",
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance", "senior_manager"],
  surfaceOn: ["wallet", "global"],
  examplePhrases: {
    en: ["Draft an invoice for the DEWA engagement in AE", "Start a new SA invoice for Tasama"],
  },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    if (!isFinanceLeadership(ctx.persona) && ctx.persona.role !== "senior_manager") {
      return denyForbidden("Only partner-tier, finance, or senior_manager may draft invoices.");
    }
    const jurisdiction = String(input.jurisdiction ?? "").toUpperCase();
    if (!JURISDICTIONS.has(jurisdiction)) return denyInvalid(`Unknown jurisdiction "${jurisdiction}"`);
    const billToName = String(input.billToName ?? "").trim();
    if (!billToName) return denyInvalid("billToName is required.");
    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `Draft invoice — ${jurisdiction}, bill to "${billToName}"`,
          steps: [{ label: `Create invoice draft (${jurisdiction})`, isWrite: true }],
        },
        data: { preview: { jurisdiction, billToName } },
      };
    }
    const id = rid("inv");
    await db.insert(atelierInvoice).values({
      id,
      orgId: ctx.persona.orgId,
      engagementId: (input.engagementId as string) ?? null,
      jurisdiction,
      currency: String(input.currency ?? "USD"),
      status: "draft",
      billTo: {
        name: billToName,
        contactEmail: (input.billToEmail as string) ?? undefined,
        vatId: (input.billToVatId as string) ?? undefined,
      },
      vatRatePct: VAT_RATE_BY_JURISDICTION[jurisdiction] ?? 0,
      dueDate: (input.dueDate as string) ?? null,
      createdByUserId: ctx.persona.id,
    });
    await recordAudit(ctx, id, "wallet.invoice.drafted", { jurisdiction }, `Drafted invoice (${jurisdiction})`);
    const full = await loadFull(ctx.persona.orgId, id);
    return {
      ok: true,
      data: {
        ...(full ?? { invoiceId: id }),
        navigateTo: { path: `/wallet/invoices/${id}`, when: "on_commit" as const },
      },
      resultCardHint: "invoice_card",
    };
  },
});

// ───────────────────────── wallet.invoice.compose ─────────────────────────
defineCapability({
  id: "wallet.invoice.compose",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_invoice_compose",
  description: "Compose lines on a draft invoice from approved time + client-billable expenses.",
  slashAliases: { en: ["/compose-invoice"] },
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string" },
      fromDate: { type: "string" },
      toDate: { type: "string" },
      defaultRateUsd: { type: "number" },
      confirm: { type: "boolean" },
    },
    required: ["invoiceId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "invoice_card",
  irreversible: false,
  requiredRoles: ["founding_partner", "partner", "finance", "senior_manager"],
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["Compose lines on the latest invoice draft"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    if (!isFinanceLeadership(ctx.persona) && ctx.persona.role !== "senior_manager") {
      return denyForbidden("Only partner-tier, finance, or senior_manager may compose invoices.");
    }
    const invoiceId = String(input.invoiceId ?? "");
    const [inv] = await db.select().from(atelierInvoice).where(
      and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
    );
    if (!inv) return { ok: false, errorCode: "not_found", errorMessage: "Invoice not found." };
    if (inv.status !== "draft") return denyInvalid("Compose only allowed in draft state.");
    if (!inv.engagementId) return denyInvalid("engagementId required to compose.");

    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `Compose lines on ${inv.id} from time + expenses`,
          steps: [{ label: "Aggregate billable time + reimbursables", isWrite: true }],
        },
        data: { preview: { invoiceId } },
      };
    }

    const fromDate = String(input.fromDate ?? "1900-01-01");
    const toDate = String(input.toDate ?? "2999-12-31");
    const defaultRate = typeof input.defaultRateUsd === "number" ? input.defaultRateUsd : 250;
    const existing = await db.select().from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, inv.id));
    // sourceRef may carry a comma-joined list of timesheet ids (when we
    // aggregate hours by person); split so per-id membership checks work.
    const billed = new Set<string>();
    for (const l of existing) {
      if (!l.sourceRef) continue;
      for (const id of l.sourceRef.split(",")) {
        const trimmed = id.trim();
        if (trimmed) billed.add(trimmed);
      }
    }
    const timeRows = await db.select().from(atelierTimesheetEntries).where(and(
      eq(atelierTimesheetEntries.engagementId, inv.engagementId),
      eq(atelierTimesheetEntries.billable, true),
      eq(atelierTimesheetEntries.status, "approved"),
      isNull(atelierTimesheetEntries.deletedAt),
    ));
    const timeIn = timeRows.filter((t) => t.workDate >= fromDate && t.workDate <= toDate && !billed.has(t.id));
    const expRows = await db.select().from(atelierExpenses).where(and(
      eq(atelierExpenses.engagementId, inv.engagementId),
      eq(atelierExpenses.clientBillable, true),
      eq(atelierExpenses.status, "approved"),
      isNull(atelierExpenses.deletedAt),
    ));
    const expIn = expRows.filter((e) => e.expenseDate >= fromDate && e.expenseDate <= toDate && !billed.has(e.id));
    const newLines: Array<typeof atelierInvoiceLine.$inferInsert> = [];
    let ord = existing.length;
    const byPerson = new Map<string, { hours: number; ids: string[] }>();
    for (const t of timeIn) {
      const v = byPerson.get(t.personId) ?? { hours: 0, ids: [] };
      v.hours += t.hours; v.ids.push(t.id); byPerson.set(t.personId, v);
    }
    for (const [personId, agg] of byPerson) {
      const amount = round2(agg.hours * defaultRate);
      newLines.push({
        id: rid("invl"), orgId: ctx.persona.orgId, invoiceId: inv.id, ord: ord++,
        description: `Professional services — ${personId} (${agg.hours.toFixed(2)} hrs)`,
        qty: agg.hours, unitPrice: defaultRate, amount,
        sourceKind: "time", sourceRef: agg.ids.join(","),
      });
    }
    for (const e of expIn) {
      const markup = 1 + (e.markupPct ?? 0) / 100;
      const amount = round2(e.usdAmount * markup);
      newLines.push({
        id: rid("invl"), orgId: ctx.persona.orgId, invoiceId: inv.id, ord: ord++,
        description: `Reimbursable: ${e.merchant ?? e.category} (${e.expenseDate})`,
        qty: 1, unitPrice: amount, amount,
        sourceKind: "expense", sourceRef: e.id,
      });
    }
    if (newLines.length > 0) {
      await db.insert(atelierInvoiceLine).values(newLines);
      await recordAudit(ctx, inv.id, "wallet.invoice.line_added",
        { lineCount: newLines.length, source: "compose" },
        `Composed ${newLines.length} lines from time+expenses`);
    }
    const allAmounts = [...existing.map((l) => ({ amount: l.amount })), ...newLines.map((l) => ({ amount: l.amount as number }))];
    const tot = recomputeTotals(allAmounts, inv.vatRatePct);
    await db.update(atelierInvoice).set({ subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total, updatedAt: new Date() }).where(eq(atelierInvoice.id, inv.id));
    return {
      ok: true,
      data: {
        added: newLines.length,
        ...(await loadFull(ctx.persona.orgId, inv.id)),
        navigateTo: { path: `/wallet/invoices/${inv.id}`, when: "on_commit" as const },
      },
      resultCardHint: "invoice_card",
    };
  },
});

// ───────────────────────── wallet.invoice.issue ─────────────────────────
defineCapability({
  id: "wallet.invoice.issue",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_invoice_issue",
  description:
    "Issue a draft invoice — mints a gap-free invoice number and submits to the e-invoice channel (ZATCA/FTA/Peppol). Partner-tier only. Blocks SA submissions if buyer VRN is missing.",
  slashAliases: { en: ["/issue-invoice"] },
  inputSchema: {
    type: "object",
    properties: { invoiceId: { type: "string" }, confirm: { type: "boolean" } },
    required: ["invoiceId"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "invoice_card",
  irreversible: true,
  requiredRoles: ["founding_partner", "partner"],
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["Issue invoice inv_abc123"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    if (!isPartnerTier(ctx.persona)) return denyForbidden("Partner-tier required to issue invoices.");
    const invoiceId = String(input.invoiceId ?? "");
    const [inv] = await db.select().from(atelierInvoice).where(
      and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
    );
    if (!inv) return { ok: false, errorCode: "not_found", errorMessage: "Invoice not found." };
    if (inv.status !== "draft") return denyInvalid("Only draft invoices can be issued.");
    const billTo = inv.billTo as { name?: string; contactEmail?: string; vatId?: string } | null;
    if (!billTo?.name && !billTo?.contactEmail) {
      return denyInvalid("bill_to.name or bill_to.contactEmail required to issue.");
    }
    if (inv.jurisdiction === "SA" && !billTo?.vatId) {
      return { ok: false, errorCode: "zatca_vrn_required", errorMessage: "ZATCA submission blocked: buyer VRN (bill_to.vatId) required for SA invoices." };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `Issue ${inv.id} (${inv.jurisdiction}) — total ${inv.currency} ${inv.total.toFixed(2)}. ${channelForJurisdiction(inv.jurisdiction)?.toUpperCase() ?? "no channel"} will fire.`,
          steps: [
            { label: "Mint gap-free invoice number", isWrite: true },
            { label: `Submit to ${channelForJurisdiction(inv.jurisdiction)?.toUpperCase() ?? "no channel"}`, isWrite: true },
          ],
        },
        data: { preview: { invoiceId } },
      };
    }

    const result = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(atelierInvoice).where(
        and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
      ).for("update");
      if (!locked || locked.status !== "draft") return null;
      const lines = await tx.select().from(atelierInvoiceLine).where(eq(atelierInvoiceLine.invoiceId, locked.id));
      if (lines.length === 0) return null;
      // Sequences partition per (org, jurisdiction, calendar year).
      const yearPart = new Date().getUTCFullYear();
      const seqRows = await tx.select().from(atelierInvoiceSequence).where(and(
        eq(atelierInvoiceSequence.orgId, locked.orgId),
        eq(atelierInvoiceSequence.jurisdiction, locked.jurisdiction),
        eq(atelierInvoiceSequence.yearPart, yearPart),
      )).for("update");
      let seq = seqRows[0];
      if (!seq) {
        await tx.insert(atelierInvoiceSequence).values({
          orgId: locked.orgId, jurisdiction: locked.jurisdiction, yearPart,
          prefix: `${locked.jurisdiction}-INV-${yearPart}`, lastSeq: 0,
        });
        seq = { orgId: locked.orgId, jurisdiction: locked.jurisdiction, yearPart, prefix: `${locked.jurisdiction}-INV-${yearPart}`, lastSeq: 0, updatedAt: new Date() };
      }
      const next = seq.lastSeq + 1;
      const invoiceNumber = `${seq.prefix}-${String(next).padStart(6, "0")}`;
      await tx.update(atelierInvoiceSequence).set({ lastSeq: next, updatedAt: new Date() }).where(and(
        eq(atelierInvoiceSequence.orgId, locked.orgId),
        eq(atelierInvoiceSequence.jurisdiction, locked.jurisdiction),
        eq(atelierInvoiceSequence.yearPart, yearPart),
      ));
      const tot = recomputeTotals(lines, locked.vatRatePct);
      const issuedAt = new Date();
      const dueDate = locked.dueDate ?? new Date(Date.now() + 30 * 86400_000).toISOString().slice(0, 10);
      await tx.update(atelierInvoice).set({
        invoiceNumber, status: "issued", issuedAt, dueDate,
        subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total, updatedAt: new Date(),
      }).where(eq(atelierInvoice.id, locked.id));
      return { invoiceNumber, lines, inv: { ...locked, invoiceNumber, issuedAt, status: "issued", subtotal: tot.subtotal, vatAmount: tot.vat, total: tot.total } };
    });
    if (!result) return { ok: false, errorCode: "issue_failed", errorMessage: "Issue failed (state changed?)." };

    const channel = channelForJurisdiction(result.inv.jurisdiction);
    if (channel) {
      const sub = await submitEinvoice({ invoice: result.inv as typeof atelierInvoice.$inferSelect, lines: result.lines });
      await db.insert(atelierEinvoiceSubmission).values({
        id: rid("eis"), orgId: result.inv.orgId, invoiceId: result.inv.id,
        channel: sub.channel, status: sub.status,
        submissionPayloadRef: sub.submissionPayloadRef,
        responsePayloadRef: sub.responsePayloadRef,
        clearanceUuid: sub.clearanceUuid, qrCodePayload: sub.qrCodePayload,
        submittedAt: new Date(),
        clearedAt: sub.status === "cleared" ? new Date() : null,
        rejectedAt: sub.status === "rejected" ? new Date() : null,
        rejectedReason: sub.rejectedReason,
      });
      await recordAudit(ctx, result.inv.id,
        sub.status === "cleared" ? "einvoice.cleared" : "einvoice.rejected",
        { channel: sub.channel, clearanceUuid: sub.clearanceUuid },
        `${sub.channel.toUpperCase()} ${sub.status}`);
    }
    await recordAudit(ctx, result.inv.id, "wallet.invoice.issued",
      { invoiceNumber: result.invoiceNumber, total: result.inv.total },
      `Issued ${result.invoiceNumber} ($${result.inv.total})`);
    return {
      ok: true,
      data: {
        ...(await loadFull(ctx.persona.orgId, result.inv.id)),
        navigateTo: { path: `/wallet/invoices/${result.inv.id}`, when: "on_commit" as const },
      },
      resultCardHint: "invoice_card",
    };
  },
});

// ───────────────────────── wallet.invoice.void ─────────────────────────
defineCapability({
  id: "wallet.invoice.void",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_invoice_void",
  description: "Void an issued invoice (irreversible). Founding-partner only. Requires reason.",
  slashAliases: { en: ["/void-invoice"] },
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string" }, reason: { type: "string" },
      confirm: { type: "boolean" }, typedName: { type: "string" },
    },
    required: ["invoiceId", "reason"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "invoice_card",
  irreversible: true,
  requiredRoles: ["founding_partner"],
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["Void invoice inv_abc123 — reason: client cancelled"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    if (ctx.persona.role !== "founding_partner") return denyForbidden("founding_partner required to void.");
    const reason = String(input.reason ?? "").trim();
    if (!reason) return denyInvalid("reason required.");
    const [inv] = await db.select().from(atelierInvoice).where(
      and(eq(atelierInvoice.id, String(input.invoiceId ?? "")), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
    );
    if (!inv) return { ok: false, errorCode: "not_found", errorMessage: "Invoice not found." };
    if (inv.status !== "issued") return denyInvalid("Only issued invoices can be voided. Drafts can be deleted.");
    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `IRREVERSIBLE: void ${inv.invoiceNumber ?? inv.id} (${reason})`,
          steps: [{ label: "Mark invoice void", isWrite: true }],
          typedNameRequired: inv.invoiceNumber ?? inv.id,
        },
        data: { preview: { invoiceId: inv.id, reason } },
      };
    }
    await db.update(atelierInvoice).set({
      status: "void", voidedAt: new Date(), voidedReason: reason, updatedAt: new Date(),
    }).where(eq(atelierInvoice.id, inv.id));
    await recordAudit(ctx, inv.id, "wallet.invoice.voided",
      { reason, invoiceNumber: inv.invoiceNumber }, `Voided: ${reason}`);
    return {
      ok: true,
      data: {
        ...(await loadFull(ctx.persona.orgId, inv.id)),
        navigateTo: { path: `/wallet/invoices/${inv.id}`, when: "on_commit" as const },
      },
      resultCardHint: "invoice_card",
    };
  },
});

// ───────────────────────── wallet.ar.aging ─────────────────────────
defineCapability({
  id: "wallet.ar.aging",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_ar_aging",
  description: "Show AR aging — outstanding receivable bucketed by overdue days, with DSO and grouping (customer | engagement | partner).",
  slashAliases: { en: ["/ar", "/ar-aging"] },
  inputSchema: {
    type: "object",
    properties: { group: { type: "string", enum: ["customer", "engagement", "partner"] } },
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ar_aging_grid",
  irreversible: false,
  surfaceOn: ["wallet", "home"],
  promoteAsSuggestion: true,
  examplePhrases: { en: ["Show AR aging", "Where is the cash sitting?"] },
  async run(input, ctx) {
    // board_observer is allowed on the AR rollup (rollup-only access).
    if (isRestrictedPersona(ctx.persona.role)) return denyForbidden("Wave 3 capabilities are denied for this persona.");
    const groupBy = (input.group as string) ?? "customer";
    if (!["customer", "engagement", "partner"].includes(groupBy)) return denyInvalid("group must be customer | engagement | partner");
    const rows = await db.select().from(atelierInvoice).where(and(
      isNull(atelierInvoice.deletedAt),
      eq(atelierInvoice.orgId, ctx.persona.orgId),
      inArray(atelierInvoice.status, ["issued", "paid"]),
    ));
    // Oct 2026 audit — (1) group by the invoice's ACCOUNT, not by the
    // free-text `billTo.name` (null on most invoices → "Unknown customer");
    // (2) sum in USD through the single FX source instead of adding QAR,
    // SAR and GBP face values under a `totalUsd` label. Per-invoice rows
    // keep their own currency and amount.
    const accountIds = Array.from(new Set(rows.map((r) => r.accountId).filter((v): v is string => Boolean(v))));
    const accountRows = accountIds.length
      ? await db
          .select({ id: atelierAccounts.id, name: atelierAccounts.name, brandName: atelierAccounts.brandName })
          .from(atelierAccounts)
          .where(inArray(atelierAccounts.id, accountIds))
      : [];
    const accountName = new Map(accountRows.map((a) => [a.id, a.brandName ? `${a.name} (${a.brandName})` : a.name]));
    const fxMissing = new Set<string>();
    const toUsd = (amount: number, currency: string | null | undefined): number => {
      try {
        return toUsdSync(amount, currency ?? "USD");
      } catch (err) {
        if (err instanceof FxRateMissingError) {
          fxMissing.add(err.currency);
          return amount; // surfaced via `fxMissing`, never silently dropped
        }
        throw err;
      }
    };
    const today = new Date();
    const buckets = { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 };
    let revenue90d = 0;
    const ninetyAgo = today.getTime() - 90 * 86400_000;
    type AgedRow = {
      invoice: typeof atelierInvoice.$inferSelect;
      daysOverdue: number;
      outstanding: number;
      outstandingUsd: number;
      currency: string;
      bucket: keyof typeof buckets;
    };
    const aged: AgedRow[] = [];
    for (const r of rows) {
      const outstanding = round2(r.total - r.amountPaid);
      if (r.issuedAt && new Date(r.issuedAt).getTime() >= ninetyAgo) revenue90d += toUsd(r.total, r.currency);
      if (outstanding <= 0 || r.status === "paid") continue;
      const outstandingUsd = round2(toUsd(outstanding, r.currency));
      const due = r.dueDate ? new Date(r.dueDate) : today;
      const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400_000));
      const k = days === 0 ? "current" : days <= 30 ? "d1_30" : days <= 60 ? "d31_60" : days <= 90 ? "d61_90" : "d90_plus";
      buckets[k as keyof typeof buckets] += outstandingUsd;
      aged.push({ invoice: r, daysOverdue: days, outstanding, outstandingUsd, currency: r.currency ?? "USD", bucket: k as keyof typeof buckets });
    }
    aged.sort((a, b) => b.daysOverdue - a.daysOverdue);
    type Group = { key: string; label: string; totalUsd: number; invoiceCount: number; oldestDays: number };
    const groups = new Map<string, Group>();
    for (const a of aged) {
      let key = "—", label = "—";
      if (groupBy === "customer") {
        const bt = a.invoice.billTo as { name?: string } | null;
        const acct = a.invoice.accountId ? accountName.get(a.invoice.accountId) : undefined;
        key = a.invoice.accountId ?? bt?.name ?? "—";
        label = acct ?? bt?.name ?? (a.invoice.accountId ? `Account ${a.invoice.accountId}` : "No account on invoice");
      } else if (groupBy === "engagement") {
        key = a.invoice.engagementId ?? "—"; label = a.invoice.engagementId ?? "No engagement";
      } else {
        key = a.invoice.createdByUserId ?? "—"; label = a.invoice.createdByUserId ?? "—";
      }
      const g = groups.get(key) ?? { key, label, totalUsd: 0, invoiceCount: 0, oldestDays: 0 };
      g.totalUsd = round2(g.totalUsd + a.outstandingUsd); g.invoiceCount += 1;
      g.oldestDays = Math.max(g.oldestDays, a.daysOverdue);
      groups.set(key, g);
    }
    const totalOutstanding = round2(Object.values(buckets).reduce((s, v) => s + v, 0));
    const dso = revenue90d > 0 ? Math.round((totalOutstanding / revenue90d) * 90) : 0;
    const includeRows = !isBoardObserver(ctx.persona.role);
    return {
      ok: true,
      data: {
        buckets: Object.entries(buckets).map(([k, v]) => ({ bucket: k, totalUsd: round2(v) })),
        totalOutstandingUsd: totalOutstanding,
        invoiceCount: aged.length,
        delinquentCount: aged.filter((a) => a.daysOverdue > 0).length,
        dso, groupBy,
        currency: "USD",
        ...(fxMissing.size ? { fxMissing: Array.from(fxMissing), note: `No FX rate for ${Array.from(fxMissing).join(", ")}; those amounts are included at face value.` } : {}),
        groups: Array.from(groups.values()).sort((a, b) => b.totalUsd - a.totalUsd),
        rows: includeRows ? aged.slice(0, 200) : [],
        truncated: includeRows && aged.length > 200,
      },
      resultCardHint: "ar_aging_grid",
    };
  },
});

// ───────────────────────── wallet.dunning.next_action ─────────────────────────
defineCapability({
  id: "wallet.dunning.next_action",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_dunning_next_action",
  description:
    "Recommend the next dunning ladder step per overdue invoice. Accepts an optional invoiceId, or free text (q) — an invoice number, client/account name — to narrow the list.",
  slashAliases: { en: ["/next-dun", "/collections-next"] },
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string" },
      q: { type: "string", description: "Invoice number or client/account name to narrow by." },
    },
  },
  isWrite: false,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "dunning_card",
  irreversible: false,
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["What's the next collections action?", "Who should we chase next?"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    const invoiceId = input.invoiceId ? String(input.invoiceId) : undefined;
    const q = typeof input.q === "string" ? input.q.trim() : "";
    const where = [
      isNull(atelierInvoice.deletedAt),
      eq(atelierInvoice.orgId, ctx.persona.orgId),
      eq(atelierInvoice.status, "issued"),
    ];
    if (invoiceId) where.push(eq(atelierInvoice.id, invoiceId));
    let invoices = await db.select().from(atelierInvoice).where(and(...where));
    // Task #789 — free-text narrowing by invoice number or client name.
    if (!invoiceId && q) {
      const resolved = await resolveDunnableInvoiceByText(q, ctx.persona.orgId);
      if (resolved.outcome === "match") {
        invoices = invoices.filter((i) => i.id === resolved.row.id);
      } else if (
        resolved.outcome === "ambiguous" ||
        (resolved.outcome === "not_found" && (resolved.options?.length ?? 0) > 0)
      ) {
        // Ambiguity or a near-miss must ask, never blend actions across
        // candidate invoices — a typo could otherwise dun the wrong client.
        const options = resolved.outcome === "ambiguous" ? resolved.options : resolved.options!;
        const prompt = resolved.outcome === "ambiguous" ? resolved.prompt : resolved.message;
        return {
          ok: true,
          data: { prompt, options, nextActions: [] },
          disambiguation: { kind: "invoice", field: "invoiceId", options },
        };
      } else {
        return {
          ok: true,
          data: {
            nextActions: [],
            note: resolved.message,
            navigateTo: { path: "/wallet", when: "on_commit" as const },
          },
          resultCardHint: "dunning_card",
        };
      }
    }
    const today = new Date();
    const out: Array<Record<string, unknown>> = [];
    for (const inv of invoices) {
      const outstanding = round2(inv.total - inv.amountPaid);
      if (outstanding <= 0) continue;
      const due = inv.dueDate ? new Date(inv.dueDate) : today;
      const days = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400_000));
      const [ladder] = await db.select().from(atelierDunningLadder).where(
        and(eq(atelierDunningLadder.jurisdiction, inv.jurisdiction), eq(atelierDunningLadder.isDefault, true), isNull(atelierDunningLadder.deletedAt)),
      );
      if (!ladder) continue;
      const events = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, inv.id));
      const stepIndex = events.length;
      const step = ladder.steps[stepIndex] ?? null;
      const billTo = inv.billTo as { name?: string } | null;
      // Mirror the HTTP next-action endpoint: suppress on open future P2P,
      // and gate on the step's offsetDays cadence.
      const openPromises = await db.select().from(atelierPromiseToPay).where(
        and(eq(atelierPromiseToPay.invoiceId, inv.id), eq(atelierPromiseToPay.status, "open")),
      );
      const futureP = openPromises.find((p) => new Date(p.promisedDate).getTime() >= today.getTime());
      let reason: string;
      let recommended: typeof step | null = step;
      if (futureP) {
        reason = `Hold — open promise-to-pay through ${futureP.promisedDate}`;
        recommended = null;
      } else if (!step) {
        reason = "Ladder exhausted — escalate.";
      } else if (days < step.offsetDays) {
        reason = `Wait — step "${step.template}" fires at +${step.offsetDays}d (currently +${days}d)`;
        recommended = null;
      } else {
        reason = `Step ${stepIndex + 1} of ${ladder.steps.length}`;
      }
      out.push({
        invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
        customerName: billTo?.name ?? "—", daysOverdue: days, outstanding,
        nextStep: recommended ? { stepIndex, template: recommended.template, channel: recommended.channel, requireApproval: !!recommended.requireApproval } : null,
        reason,
      });
    }
    out.sort((a, b) => (b.daysOverdue as number) - (a.daysOverdue as number));
    return {
      ok: true,
      data: {
        nextActions: out,
        navigateTo: { path: "/wallet", when: "on_commit" as const },
      },
      resultCardHint: "dunning_card",
    };
  },
});

// ───────────────────────── wallet.dunning.send_next ─────────────────────────
defineCapability({
  id: "wallet.dunning.send_next",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_dunning_send_next",
  description:
    "Fire the next dunning ladder step on an overdue invoice. Identify the invoice by invoiceId, or by free text (q) — invoice number or client/account name, e.g. \"send the dunning reminder for Acme\". Step 2+ requires partner approval. Outbound channel: email.",
  slashAliases: { en: ["/dun", "/send-reminder"] },
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string" },
      q: { type: "string", description: "Invoice number or client/account name when no id is known." },
      confirm: { type: "boolean" },
    },
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: "email",
  resultCard: "dunning_card",
  irreversible: true,
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["Send the next reminder on invoice INV-000123"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    // Task #789 — resolve by id or by free text (invoice number / client
    // name) with ranked disambiguation and friendly misses.
    let invoiceId = input.invoiceId ? String(input.invoiceId) : "";
    const q = typeof input.q === "string" ? input.q.trim() : "";
    if (!invoiceId && q) {
      const resolved = await resolveDunnableInvoiceByText(q, ctx.persona.orgId);
      if (resolved.outcome === "ambiguous") {
        return {
          ok: true,
          data: { prompt: resolved.prompt, options: resolved.options, navigateTo: null },
          disambiguation: { kind: "invoice", field: "invoiceId", options: resolved.options },
        };
      }
      if (resolved.outcome === "not_found") {
        if (resolved.options && resolved.options.length > 0) {
          return {
            ok: true,
            data: { prompt: resolved.message, options: resolved.options, navigateTo: null },
            disambiguation: { kind: "invoice", field: "invoiceId", options: resolved.options },
          };
        }
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `${resolved.message} Say "what's the next collections action?" to see the overdue list.`,
        };
      }
      invoiceId = resolved.row.id;
    }
    if (!invoiceId) {
      return {
        ok: false,
        errorCode: "invalid_body",
        errorMessage:
          'Tell me which invoice — an invoice number or the client\'s name, e.g. "send the dunning reminder for Acme".',
      };
    }
    const [inv] = await db.select().from(atelierInvoice).where(
      and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
    );
    if (!inv) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          "I couldn't find that invoice — it may have been paid or removed. Say \"what's the next collections action?\" to see the current overdue list.",
      };
    }
    if (inv.status !== "issued") return denyInvalid("Only issued invoices can be dunned.");
    const [ladder] = await db.select().from(atelierDunningLadder).where(
      and(eq(atelierDunningLadder.jurisdiction, inv.jurisdiction), eq(atelierDunningLadder.isDefault, true), isNull(atelierDunningLadder.deletedAt)),
    );
    if (!ladder) return { ok: false, errorCode: "no_ladder", errorMessage: `No default ladder for ${inv.jurisdiction}` };
    const events = await db.select().from(atelierDunningEvent).where(eq(atelierDunningEvent.invoiceId, invoiceId));
    const stepIndex = events.length;
    if (stepIndex >= ladder.steps.length) return denyInvalid("Ladder exhausted.");
    const step = ladder.steps[stepIndex];
    // Cadence gate: respect the step's `offsetDays` from due date.
    const today = new Date();
    const due = inv.dueDate ? new Date(inv.dueDate) : today;
    const daysOverdue = Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400_000));
    if (daysOverdue < step.offsetDays) {
      return { ok: false, errorCode: "step_not_due_yet", errorMessage: `Step "${step.template}" fires at +${step.offsetDays}d (currently +${daysOverdue}d).` };
    }
    // Open promise-to-pay suppresses further dunning.
    const openPromises = await db.select().from(atelierPromiseToPay).where(
      and(eq(atelierPromiseToPay.invoiceId, invoiceId), eq(atelierPromiseToPay.status, "open")),
    );
    const future = openPromises.find((p) => new Date(p.promisedDate).getTime() >= today.getTime());
    if (future) {
      return { ok: false, errorCode: "promise_open", errorMessage: `Open promise-to-pay through ${future.promisedDate} — dunning suppressed.` };
    }
    if (step.requireApproval && !isPartnerTier(ctx.persona)) {
      return denyForbidden(`Step "${step.template}" requires partner approval.`);
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `Send dunning step ${stepIndex + 1} (${step.template}) on ${inv.invoiceNumber ?? inv.id}. Outbound: email.`,
          steps: [{ label: "Send dunning notice", isWrite: true }],
          outboundChannel: "email",
        },
        data: { preview: { invoiceId } },
      };
    }
    const eventId = rid("dun");
    await db.insert(atelierDunningEvent).values({
      id: eventId, orgId: ctx.persona.orgId, invoiceId, ladderId: ladder.id,
      stepIndex, channel: step.channel, template: step.template,
      messageRef: `enc:wallet:dunning/${invoiceId}/step-${stepIndex}`, sentBy: ctx.persona.id,
    });
    await recordAudit(ctx, invoiceId, "dunning.notice.sent",
      { stepIndex, template: step.template, channel: step.channel, ladderId: ladder.id },
      `Sent ${step.template} (step ${stepIndex + 1})`);
    return {
      ok: true,
      data: {
        event: { id: eventId, stepIndex, template: step.template },
        ...(await loadFull(ctx.persona.orgId, invoiceId)),
        navigateTo: { path: `/wallet/invoices/${invoiceId}`, when: "on_commit" as const },
      },
      resultCardHint: "dunning_card",
    };
  },
});

// ───────────────────────── wallet.dunning.record_promise ─────────────────────────
defineCapability({
  id: "wallet.dunning.record_promise",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "wallet",
  toolName: "wallet_dunning_record_promise",
  description:
    "Record a promise-to-pay on an invoice (promisedAmount, promisedDate, contactName). Identify the invoice by invoiceId, or by free text (q) — invoice number or client/account name, e.g. \"log a promise to pay from Acme, 50k by June 15\".",
  slashAliases: { en: ["/p2p", "/promise"] },
  inputSchema: {
    type: "object",
    properties: {
      invoiceId: { type: "string" },
      q: { type: "string", description: "Invoice number or client/account name when no id is known." },
      promisedAmount: { type: "number" },
      promisedDate: { type: "string" }, contactName: { type: "string" },
      confirm: { type: "boolean" },
    },
    required: ["promisedAmount", "promisedDate"],
  },
  isWrite: true,
  twoPhaseConfirm: true,
  outboundChannel: null,
  resultCard: "dunning_card",
  irreversible: false,
  surfaceOn: ["wallet"],
  examplePhrases: { en: ["Log a promise to pay on INV-000123 — $50000 by 2026-06-15"] },
  async run(input, ctx) {
    const denied = denyRestricted(ctx.persona);
    if (denied) return denied;
    const promisedAmount = Number(input.promisedAmount ?? 0);
    const promisedDate = String(input.promisedDate ?? "");
    if (!(promisedAmount > 0) || !promisedDate) return denyInvalid("promisedAmount and promisedDate required.");
    // Task #803 — resolve by id or by free text (invoice number / client
    // name) with ranked disambiguation and friendly misses (same contract
    // as wallet.dunning.send_next).
    let invoiceId = input.invoiceId ? String(input.invoiceId) : "";
    const q = typeof input.q === "string" ? input.q.trim() : "";
    if (!invoiceId && q) {
      const resolved = await resolveDunnableInvoiceByText(q, ctx.persona.orgId);
      if (resolved.outcome === "ambiguous") {
        return {
          ok: true,
          data: { prompt: resolved.prompt, options: resolved.options, navigateTo: null },
          disambiguation: { kind: "invoice", field: "invoiceId", options: resolved.options },
        };
      }
      if (resolved.outcome === "not_found") {
        if (resolved.options && resolved.options.length > 0) {
          return {
            ok: true,
            data: { prompt: resolved.message, options: resolved.options, navigateTo: null },
            disambiguation: { kind: "invoice", field: "invoiceId", options: resolved.options },
          };
        }
        return {
          ok: false,
          errorCode: "not_found",
          errorMessage: `${resolved.message} Say "what's the next collections action?" to see the overdue list.`,
        };
      }
      invoiceId = resolved.row.id;
    }
    if (!invoiceId) {
      return {
        ok: false,
        errorCode: "invalid_body",
        errorMessage:
          'Tell me which invoice — an invoice number or the client\'s name, e.g. "log a promise to pay from Acme, 50k by June 15".',
      };
    }
    const [inv] = await db.select().from(atelierInvoice).where(
      and(eq(atelierInvoice.id, invoiceId), eq(atelierInvoice.orgId, ctx.persona.orgId), isNull(atelierInvoice.deletedAt)),
    );
    if (!inv) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage:
          "I couldn't find that invoice — it may have been paid or removed. Say \"what's the next collections action?\" to see the current overdue list.",
      };
    }
    if (input.confirm !== true) {
      return {
        ok: true,
        confirmation: {
          summary: `Promise-to-pay on ${inv.invoiceNumber ?? inv.id} — ${promisedAmount} by ${promisedDate}`,
          steps: [{ label: "Record promise", isWrite: true }],
        },
        data: { preview: { ...input, invoiceId } },
      };
    }
    const id = rid("p2p");
    await db.insert(atelierPromiseToPay).values({
      id, orgId: ctx.persona.orgId, invoiceId,
      promisedAmount, promisedDate,
      contactName: (input.contactName as string) ?? null,
      recordedBy: ctx.persona.id,
    });
    await recordAudit(ctx, invoiceId, "dunning.promise.recorded",
      { promisedAmount, promisedDate, contactName: (input.contactName as string) ?? null },
      `P2P $${promisedAmount} by ${promisedDate}`);
    return {
      ok: true,
      data: {
        ...(await loadFull(ctx.persona.orgId, invoiceId)),
        navigateTo: { path: `/wallet/invoices/${invoiceId}`, when: "on_commit" as const },
      },
      resultCardHint: "dunning_card",
    };
  },
});
