/**
 * Task #1091 — Finance autopilot: founder-editable thresholds (D1),
 * the unified approvals inbox, and reverse-and-repost ("Fix this").
 *
 *   GET   /finance/autopilot/settings                       read thresholds (finance leadership)
 *   PATCH /finance/autopilot/settings                       edit thresholds (partner tier only; audited)
 *   GET   /finance/approvals/inbox                          aggregated pending founder/partner decisions
 *   POST  /gl/journals/:id/reverse-repost                   reverse + corrected repost (partner tier; one txn)
 *
 * The inbox NEVER forks action logic: it only aggregates what is pending
 * by querying the same tables the existing endpoints read, and deep-links
 * back into the existing pages where the actual approve/reject actions
 * live. No new action endpoints are added for the aggregated items.
 *
 * Chat parity for the inbox + settings surfaces is built separately
 * (#1091 chat capabilities); each route below carries an @cli-skip marker
 * documenting that so the route-coverage ratchet stays green.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierFinanceAutopilotSettings,
  atelierPaymentRuns,
  atelierPartnerFirmInvoices,
  atelierSelfBilledInvoices,
  atelierCloseCycle,
  atelierCloseAccrual,
  atelierPayrollRun,
  atelierCollectionsDraft,
  atelierGlJournalEntry,
  atelierGlJournalLine,
  atelierGlAccount,
  atelierGlPostingException,
  atelierAgentRuns,
  atelierTimesheetWeeks,
  atelierLeaveRequests,
  atelierExpenses,
  atelierVendorCostSplits,
  atelierVendorProjectMap,
  atelierVendorAllocRules,
  type VendorInvoiceExtraction,
} from "@workspace/db";
import { isGlPeriodLocked } from "../../lib/atelier-agents/bookkeeper.js";
// Task #1251 — tooling vendor detection for the two new inbox kinds.
import { detectVendorKey, vendorLabel, VENDOR_DEFAULT_KEY } from "../../lib/atelier-vendor-invoice-mining.js";
import { effectiveAgentRunStatus } from "../../lib/atelier-agents/run-staleness.js";
import {
  loadFinanceAutopilotSettings,
  loadFinanceAutopilotThresholds,
} from "../../lib/atelier-finance-autopilot-settings.js";
import { evaluateAutoPost } from "../../lib/atelier-finance-autopolicy.js";
import { loadSupplierAutopilotAttribution } from "./financePayablesRoutes.js";

const router: IRouter = Router();

function rid(p: string): string {
  return `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

export type Me = typeof atelierUsers.$inferSelect;
function ensure(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) { res.status(401).json({ error: "no-active-persona" }); return null; }
  return req.atelierPersona;
}
export function isFinanceAutopilotPartnerTier(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner";
}
export function isFinanceAutopilotLeadership(me: Me): boolean {
  return isFinanceAutopilotPartnerTier(me) || me.role === "finance";
}
function isPartnerTier(me: Me): boolean {
  return isFinanceAutopilotPartnerTier(me);
}
function isFinanceLeadership(me: Me): boolean {
  return isFinanceAutopilotLeadership(me);
}
async function audit(args: {
  entityType: string; entityId: string; actor: Me;
  action: string; payload: Record<string, unknown>; summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"), orgId: args.actor.orgId,
    entityType: args.entityType, entityId: args.entityId,
    actorType: "human", actorId: args.actor.id, actorLabel: args.actor.name,
    action: args.action, payload: args.payload, payloadSummary: args.summary,
  });
}

// ═══════════════════════════════════════════════════════════
// 1) AUTOPILOT SETTINGS (blueprint D1)
// ═══════════════════════════════════════════════════════════

// @cli-skip: chat parity via finance.autopilot_settings (financeApprovalsCapabilities, #1091); REST stays authoritative
router.get("/finance/autopilot/settings", async (req, res) => {
  const me = ensure(req, res); if (!me) return;
  if (!isFinanceLeadership(me))
    return res.status(403).json({ error: "forbidden", message: "Finance leadership only." });
  const settings = await loadFinanceAutopilotSettings(me.orgId);
  return res.json({ ok: true, data: { settings, canEdit: isPartnerTier(me) } });
});

const SettingsPatchSchema = z.object({
  journalAutoConfidence: z.number().min(0).max(1).optional(),
  supplierInvoiceAutoMaxAed: z.number().min(0).max(10_000_000).optional(),
  journalAutoMaxAed: z.number().min(0).max(10_000_000).optional(),
});
export type FinanceAutopilotSettingsPatch = z.infer<typeof SettingsPatchSchema>;

/**
 * Task #1091 — shared autopilot-threshold update. The PATCH route and
 * the Riser chat capability (finance.autopilot_settings write) BOTH run
 * this so the partner-tier gate, validation, audit and upsert never
 * fork. Returns an HTTP-shaped `{ status, body }` outcome.
 */
export async function updateFinanceAutopilotSettingsCore(args: {
  me: Me;
  patch: unknown;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  const { me } = args;
  // Partner-tier only (finance may read but not change thresholds).
  if (!isPartnerTier(me))
    return { status: 403, body: { error: "forbidden", message: "Editing autopilot thresholds requires partner tier (founding_partner | partner)." } };
  const parsed = SettingsPatchSchema.safeParse(args.patch ?? {});
  if (!parsed.success)
    return { status: 400, body: { error: "invalid_input", details: parsed.error.flatten() } };
  const before = await loadFinanceAutopilotSettings(me.orgId);
  const next = {
    journalAutoConfidence: parsed.data.journalAutoConfidence ?? before.journalAutoConfidence,
    supplierInvoiceAutoMaxAed: parsed.data.supplierInvoiceAutoMaxAed ?? before.supplierInvoiceAutoMaxAed,
    journalAutoMaxAed: parsed.data.journalAutoMaxAed ?? before.journalAutoMaxAed,
  };
  const now = new Date();
  await db.insert(atelierFinanceAutopilotSettings).values({
    id: `fas_${me.orgId}`,
    orgId: me.orgId,
    journalAutoConfidence: next.journalAutoConfidence,
    supplierInvoiceAutoMaxAed: next.supplierInvoiceAutoMaxAed,
    journalAutoMaxAed: next.journalAutoMaxAed,
    updatedByUserId: me.id,
    updatedByName: me.name,
    updatedAt: now,
  }).onConflictDoUpdate({
    target: atelierFinanceAutopilotSettings.orgId,
    set: {
      journalAutoConfidence: next.journalAutoConfidence,
      supplierInvoiceAutoMaxAed: next.supplierInvoiceAutoMaxAed,
      journalAutoMaxAed: next.journalAutoMaxAed,
      updatedByUserId: me.id,
      updatedByName: me.name,
      updatedAt: now,
    },
  });
  await audit({
    entityType: "finance_autopilot_settings", entityId: `fas_${me.orgId}`, actor: me,
    action: "finance.autopilot.settings_update",
    payload: {
      before: {
        journalAutoConfidence: before.journalAutoConfidence,
        supplierInvoiceAutoMaxAed: before.supplierInvoiceAutoMaxAed,
        journalAutoMaxAed: before.journalAutoMaxAed,
      },
      after: next,
    },
    summary: `Updated finance autopilot thresholds: confidence ${next.journalAutoConfidence}, supplier-invoice ≤ AED ${next.supplierInvoiceAutoMaxAed}, AI-journal ≤ AED ${next.journalAutoMaxAed}`,
  });
  const settings = await loadFinanceAutopilotSettings(me.orgId);
  return { status: 200, body: { ok: true, data: { settings, before } } };
}

// @cli-skip: chat parity via finance.autopilot_settings (financeApprovalsCapabilities, #1091); REST stays authoritative
router.patch("/finance/autopilot/settings", async (req, res) => {
  const me = ensure(req, res); if (!me) return;
  const out = await updateFinanceAutopilotSettingsCore({ me, patch: req.body ?? {} });
  return res.status(out.status).json(out.body);
});

// ═══════════════════════════════════════════════════════════
// 2) UNIFIED APPROVALS INBOX
// ═══════════════════════════════════════════════════════════

export type RequiredRole = "partner" | "finance";
export interface InboxItem {
  id: string;
  kind: string;
  title: string;
  subtitle?: string;
  amount?: { currency: string; value: number };
  submittedAt: string | null;
  requiredRole: RequiredRole;
  href: string;
  /** Agent provenance when the record was agent-created. */
  agent?: { name: string; runId: string };
  /** True when the item's source agent run is dead/stale (freshness rule). */
  stale?: boolean;
  /**
   * Filtered-view flag: false when the CALLER's role cannot action this item.
   * We include partner-only items for finance callers with actionable:false
   * (rather than hiding them) so finance sees the full backlog but the UI
   * can disable the action — a consistent, documented choice.
   */
  actionable: boolean;
}

function iso(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return typeof d === "string" ? d : d.toISOString();
}

/**
 * Task #1091 — shared approvals-inbox aggregation. The GET route and the
 * Riser chat capability (finance.approvals_inbox) BOTH call this so the
 * queue never forks: it only reads what is pending across the finance
 * tables and deep-links back into the pages/chat actions where the real
 * approve/reject transitions live. Caller must be finance leadership.
 */
export interface FinanceApprovalsInbox {
  items: InboxItem[];
  totals: Record<string, { count: number; actionable: number }>;
  walletApprovals: { href: string; timesheets: number; leave: number; expenses: number };
  viewerRole: string;
  includesNonActionable: boolean;
}

export async function loadFinanceApprovalsInbox(me: Me): Promise<FinanceApprovalsInbox> {
  const orgId = me.orgId;
  const partnerTier = isPartnerTier(me);
  const items: InboxItem[] = [];

  // ── Agent-run name lookup for provenance/staleness (batched at the end). ──
  const agentRunIds = new Set<string>();

  // (a) Payment runs pending signatures (money-out → partner tier).
  const payRuns = await db.select().from(atelierPaymentRuns).where(and(
    eq(atelierPaymentRuns.orgId, orgId),
    eq(atelierPaymentRuns.status, "pending_signatures"),
    isNull(atelierPaymentRuns.deletedAt),
  )).orderBy(desc(atelierPaymentRuns.createdAt)).limit(200);
  for (const r of payRuns) {
    const sigNames = (r.signatures ?? []).map((s) => s.name).filter(Boolean);
    items.push({
      id: r.id, kind: "payment_run",
      title: `Payment run ${r.runNumber}`,
      subtitle: `${r.bankAccountLabel || "bank"} · ${r.itemCount} item(s)` +
        (sigNames.length ? ` · signed by ${sigNames.join(", ")}` : " · no signatures yet"),
      amount: { currency: "USD", value: round2(r.totalUsd) },
      submittedAt: iso(r.createdAt),
      requiredRole: "partner",
      href: "/finance/payables/payment-runs",
      actionable: partnerTier,
    });
  }

  // (b) Partner-firm AP invoices submitted / under_review (review → finance/partner).
  const pfInvoices = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    inArray(atelierPartnerFirmInvoices.status, ["submitted", "under_review"]),
    inArray(atelierPartnerFirmInvoices.source, ["partner_submitted", "internal_upload"]),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).orderBy(desc(atelierPartnerFirmInvoices.submittedAt)).limit(200);
  for (const r of pfInvoices) {
    const needsAlloc = r.allocStatus === "needs_input";
    // Task #1103 — source-specific deep link: the supplier-invoices page
    // lists only internal uploads; partner-submitted invoices live on the
    // partner-invoices page (both support ?focus= deep links).
    const isPartnerSubmitted = r.source === "partner_submitted";
    items.push({
      id: r.id, kind: "supplier_invoice",
      title: `${isPartnerSubmitted ? "Partner invoice" : "Supplier invoice"} ${r.reference ?? r.id}`,
      subtitle: `${r.partnerFirmName}` + (needsAlloc ? " · allocation needs input" : "") +
        ` · ${r.status}`,
      amount: { currency: r.costCurrency, value: round2(r.costAmount) },
      submittedAt: iso(r.submittedAt ?? r.createdAt),
      requiredRole: "finance",
      href: `/finance/payables/${isPartnerSubmitted ? "partner-invoices" : "supplier-invoices"}?focus=${encodeURIComponent(r.id)}`,
      actionable: true,
    });
  }

  // (b2) Task #1104 — autopilot-approved AP invoices not yet in a payment
  // run. Founders get a window to pull these back to review (un-approve)
  // before a run claims them, so they surface in the inbox with agent
  // attribution instead of silently sliding into the next run.
  const autoApproved = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    eq(atelierPartnerFirmInvoices.status, "approved"),
    isNull(atelierPartnerFirmInvoices.paymentRunId),
    inArray(atelierPartnerFirmInvoices.source, ["partner_submitted", "internal_upload"]),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).orderBy(desc(atelierPartnerFirmInvoices.reviewedAt)).limit(200);
  const autopilotById = await loadSupplierAutopilotAttribution(orgId, autoApproved.map((r) => r.id));
  for (const r of autoApproved) {
    const attr = autopilotById.get(r.id);
    if (!attr) continue; // human-approved — nothing to flag
    if (attr.agentRunId) agentRunIds.add(attr.agentRunId);
    const isPartnerSubmitted = r.source === "partner_submitted";
    items.push({
      id: r.id, kind: "supplier_invoice",
      title: `${isPartnerSubmitted ? "Partner invoice" : "Supplier invoice"} ${r.reference ?? r.id}`,
      subtitle: `${r.partnerFirmName} · auto-approved — can be un-approved until a payment run picks it up`,
      amount: { currency: r.costCurrency, value: round2(r.costAmount) },
      submittedAt: iso(r.reviewedAt ?? r.submittedAt ?? r.createdAt),
      requiredRole: "finance",
      href: `/finance/payables/${isPartnerSubmitted ? "partner-invoices" : "supplier-invoices"}?focus=${encodeURIComponent(r.id)}`,
      agent: { name: attr.agentName, runId: attr.agentRunId ?? "" },
      actionable: true,
    });
  }

  // (c) Self-billing (RCTI) drafts awaiting approval (review → finance/partner).
  const sbDrafts = await db.select().from(atelierSelfBilledInvoices).where(and(
    eq(atelierSelfBilledInvoices.orgId, orgId),
    eq(atelierSelfBilledInvoices.status, "draft"),
    isNull(atelierSelfBilledInvoices.deletedAt),
  )).orderBy(desc(atelierSelfBilledInvoices.createdAt)).limit(200);
  for (const r of sbDrafts) {
    if (r.agentRunId) agentRunIds.add(r.agentRunId);
    items.push({
      id: r.id, kind: "self_billing_draft",
      title: `Self-billed invoice ${r.invoiceNumber}`,
      subtitle: `${r.supplierName} · week ${r.weekIso}`,
      amount: { currency: r.currency, value: round2(r.totalAmount) },
      submittedAt: iso(r.createdAt),
      requiredRole: "finance",
      href: `/finance/payables/self-billing?focus=${encodeURIComponent(r.id)}`,
      agent: r.agentRunId ? { name: "Self-Billing Clerk", runId: r.agentRunId } : undefined,
      actionable: true,
    });
  }

  // (d) Proposed close accruals + CT provisions (partner tier).
  const accruals = await db.select().from(atelierCloseAccrual).where(and(
    eq(atelierCloseAccrual.orgId, orgId),
    eq(atelierCloseAccrual.status, "proposed"),
    isNull(atelierCloseAccrual.deletedAt),
  )).orderBy(desc(atelierCloseAccrual.createdAt)).limit(200);
  for (const r of accruals) {
    const isCt = r.sourceKey === "ct_provision";
    items.push({
      id: r.id, kind: isCt ? "ct_provision" : "close_accrual",
      title: isCt ? `CT provision ${r.periodLabel}` : `Close accrual ${r.periodLabel}`,
      subtitle: r.memo,
      amount: { currency: r.currency, value: round2(r.amount) },
      submittedAt: iso(r.createdAt),
      requiredRole: "partner",
      href: "/finance/close",
      actionable: partnerTier,
    });
  }

  // (e) Close cycles awaiting first/second sign-off (partner tier).
  const cycles = await db.select().from(atelierCloseCycle).where(and(
    eq(atelierCloseCycle.orgId, orgId),
    inArray(atelierCloseCycle.status, ["ready"]),
    isNull(atelierCloseCycle.deletedAt),
  )).orderBy(desc(atelierCloseCycle.periodLabel)).limit(100);
  for (const r of cycles) {
    const awaitingSecond = !!r.firstSignoffUserId && !r.secondSignoffUserId;
    items.push({
      id: r.id, kind: "close_signoff",
      title: `${r.periodType} close ${r.periodLabel}`,
      subtitle: awaitingSecond ? "awaiting SECOND distinct-partner sign-off" : "awaiting first sign-off",
      submittedAt: iso(r.firstSignoffAt ?? r.updatedAt),
      requiredRole: "partner",
      href: "/finance/close",
      actionable: partnerTier,
    });
  }

  // (f) Payroll runs draft awaiting approval (money-out → partner tier).
  const payrolls = await db.select().from(atelierPayrollRun).where(and(
    eq(atelierPayrollRun.orgId, orgId),
    eq(atelierPayrollRun.status, "draft"),
    isNull(atelierPayrollRun.deletedAt),
  )).orderBy(desc(atelierPayrollRun.createdAt)).limit(100);
  for (const r of payrolls) {
    items.push({
      id: r.id, kind: "payroll_run",
      title: `Payroll run ${r.periodLabel}`,
      subtitle: `${(r.lines ?? []).length} employee line(s)`,
      amount: { currency: r.currency, value: round2(r.totalAmount) },
      submittedAt: iso(r.createdAt),
      requiredRole: "partner",
      href: "/finance/payroll",
      actionable: partnerTier,
    });
  }

  // (g) Collections / dunning drafts (requireApproval ⇒ partner tier; else finance).
  const drafts = await db.select().from(atelierCollectionsDraft).where(and(
    eq(atelierCollectionsDraft.orgId, orgId),
    eq(atelierCollectionsDraft.status, "draft"),
    isNull(atelierCollectionsDraft.deletedAt),
  )).orderBy(desc(atelierCollectionsDraft.createdAt)).limit(200);
  for (const r of drafts) {
    if (r.agentRunId) agentRunIds.add(r.agentRunId);
    const needPartner = r.requireApproval;
    items.push({
      id: r.id, kind: "collections_draft",
      title: r.escalation ? `Collections escalation · ${r.invoiceNumber ?? r.invoiceId}` : `Dunning draft · ${r.invoiceNumber ?? r.invoiceId}`,
      subtitle: `${r.customerName ?? ""} · ${r.daysOverdue}d overdue`.trim(),
      amount: { currency: "USD", value: round2(r.outstandingUsd) },
      submittedAt: iso(r.createdAt),
      requiredRole: needPartner ? "partner" : "finance",
      href: "/finance/collections",
      agent: r.agentRunId ? { name: "Collections Agent", runId: r.agentRunId } : undefined,
      actionable: needPartner ? partnerTier : true,
    });
  }

  // (h) AI-coded journals queued for review. There is no dedicated review
  // queue table today — the parsed/AI-coded posting path surfaces its
  // "needs review" state as OPEN GL posting exceptions, so we aggregate
  // those (the Bookkeeper never guesses; an open exception is a journal
  // that could not auto-post and needs a human).
  const exceptions = await db.select().from(atelierGlPostingException).where(and(
    eq(atelierGlPostingException.orgId, orgId),
    eq(atelierGlPostingException.status, "open"),
    isNull(atelierGlPostingException.deletedAt),
  )).orderBy(desc(atelierGlPostingException.updatedAt)).limit(200);
  for (const r of exceptions) {
    items.push({
      id: r.id, kind: "journal_review",
      title: `Journal needs review · ${r.code}`,
      subtitle: `${r.sourceKind} ${r.sourceLabel ?? r.sourceRef}`,
      submittedAt: iso(r.updatedAt),
      requiredRole: "finance",
      href: "/finance/ledger",
      actionable: true,
    });
  }

  // (i) Task #1251 — vendor tooling spend: two kinds.
  //   vendor_project_unmapped: one item per vendor with unmapped project(s).
  //   vendor_cost_split: one item per invoice with proposed (not yet
  //     approved) splits awaiting a finance-lead decision.
  {
    const toolingInvoices = await db.select({
      id: atelierPartnerFirmInvoices.id,
      reference: atelierPartnerFirmInvoices.reference,
      partnerFirmName: atelierPartnerFirmInvoices.partnerFirmName,
      costCurrency: atelierPartnerFirmInvoices.costCurrency,
      costAmount: atelierPartnerFirmInvoices.costAmount,
      submittedAt: atelierPartnerFirmInvoices.submittedAt,
      createdAt: atelierPartnerFirmInvoices.createdAt,
      lineItems: atelierPartnerFirmInvoices.lineItems,
    }).from(atelierPartnerFirmInvoices).where(and(
      eq(atelierPartnerFirmInvoices.orgId, orgId),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    )).limit(1000);

    const maps = await db.select({
      vendorKey: atelierVendorProjectMap.vendorKey,
      projectKey: atelierVendorProjectMap.projectKey,
    }).from(atelierVendorProjectMap).where(and(
      eq(atelierVendorProjectMap.orgId, orgId),
      isNull(atelierVendorProjectMap.deletedAt),
    ));
    const mappedSet = new Set(maps.map((m) => `${m.vendorKey}::${m.projectKey}`));
    const rules = await db.select({
      vendorKey: atelierVendorAllocRules.vendorKey,
      splits: atelierVendorAllocRules.splits,
    }).from(atelierVendorAllocRules).where(and(
      eq(atelierVendorAllocRules.orgId, orgId),
      isNull(atelierVendorAllocRules.deletedAt),
    ));
    const ruledVendors = new Set(rules.filter((r) => (r.splits ?? []).length > 0).map((r) => r.vendorKey));

    // Proposed-split counts per invoice.
    const invIds = toolingInvoices.map((r) => r.id);
    const proposedRows = invIds.length
      ? await db.select({ invoiceId: atelierVendorCostSplits.invoiceId })
          .from(atelierVendorCostSplits).where(and(
            inArray(atelierVendorCostSplits.invoiceId, invIds),
            eq(atelierVendorCostSplits.status, "proposed"),
            isNull(atelierVendorCostSplits.deletedAt),
          ))
      : [];
    const proposedByInv = new Map<string, number>();
    for (const p of proposedRows) proposedByInv.set(p.invoiceId, (proposedByInv.get(p.invoiceId) ?? 0) + 1);

    // Unmapped project names per vendor (aggregated across reconciled invoices).
    const unmappedByVendor = new Map<string, Set<string>>();
    for (const inv of toolingInvoices) {
      const vk = detectVendorKey(inv.partnerFirmName);
      if (!vk) continue;
      const ext = (inv.lineItems ?? null) as VendorInvoiceExtraction | null;
      if (!ext || ext.status !== "ok") continue;
      for (const item of ext.items) {
        const mapped = item.projectKey === VENDOR_DEFAULT_KEY
          ? ruledVendors.has(vk)
          : mappedSet.has(`${vk}::${item.projectKey}`);
        if (mapped) continue;
        const set = unmappedByVendor.get(vk) ?? new Set<string>();
        set.add(item.projectLabel);
        unmappedByVendor.set(vk, set);
      }
      // vendor_cost_split item — proposed splits awaiting approval.
      const proposedCount = proposedByInv.get(inv.id) ?? 0;
      if (proposedCount > 0) {
        items.push({
          id: inv.id, kind: "vendor_cost_split",
          title: `Tooling cost split · ${inv.reference ?? inv.id}`,
          subtitle: `${vendorLabel(vk)} · ${proposedCount} proposed split(s) awaiting approval`,
          amount: { currency: inv.costCurrency, value: round2(Number(inv.costAmount || 0)) },
          submittedAt: iso(inv.submittedAt ?? inv.createdAt),
          requiredRole: "finance",
          href: `/finance/tooling?focus=${encodeURIComponent(inv.id)}`,
          actionable: true,
        });
      }
    }
    for (const [vk, names] of unmappedByVendor) {
      const list = [...names];
      items.push({
        id: `vendor_unmapped_${vk}`, kind: "vendor_project_unmapped",
        title: `Unmapped ${vendorLabel(vk)} project(s)`,
        subtitle: `${list.length} project(s) need a cost bucket: ${list.slice(0, 4).join(", ")}${list.length > 4 ? "…" : ""}`,
        submittedAt: null,
        requiredRole: "finance",
        href: "/finance/tooling?focus=unmapped",
        actionable: true,
      });
    }
  }

  // ── Resolve agent-run provenance + staleness in one batched read. ──
  if (agentRunIds.size > 0) {
    const runs = await db.select({
      id: atelierAgentRuns.id,
      status: atelierAgentRuns.status,
      updatedAt: atelierAgentRuns.updatedAt,
      createdAt: atelierAgentRuns.createdAt,
    }).from(atelierAgentRuns).where(inArray(atelierAgentRuns.id, [...agentRunIds]));
    const staleById = new Map<string, boolean>();
    for (const run of runs) {
      // Freshness rule: a run that resolves to "error" (incl. dead/stale) is stale.
      staleById.set(run.id, effectiveAgentRunStatus(run) === "error");
    }
    for (const it of items) {
      if (it.agent) it.stale = staleById.get(it.agent.runId) ?? false;
    }
  }

  // Sort newest-first across kinds.
  items.sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""));

  // Totals per kind (count + summed amount where present).
  const totals: Record<string, { count: number; actionable: number }> = {};
  for (const it of items) {
    const t = totals[it.kind] ?? (totals[it.kind] = { count: 0, actionable: 0 });
    t.count += 1;
    if (it.actionable) t.actionable += 1;
  }

  // Wallet approvals (HR items): summary COUNTS only, deep-linked to
  // /wallet/approvals rather than re-listed here (native, no FX).
  const [tsPending, leavePending, expPending] = await Promise.all([
    db.select({ id: atelierTimesheetWeeks.id }).from(atelierTimesheetWeeks).where(and(
      eq(atelierTimesheetWeeks.orgId, orgId),
      eq(atelierTimesheetWeeks.status, "submitted"))).limit(500),
    db.select({ id: atelierLeaveRequests.id }).from(atelierLeaveRequests).where(and(
      eq(atelierLeaveRequests.orgId, orgId),
      eq(atelierLeaveRequests.status, "pending"))).limit(500),
    db.select({ id: atelierExpenses.id }).from(atelierExpenses).where(and(
      eq(atelierExpenses.orgId, orgId),
      eq(atelierExpenses.status, "submitted"),
      isNull(atelierExpenses.deletedAt))).limit(500),
  ]);
  const walletApprovals = {
    href: "/wallet/approvals",
    timesheets: tsPending.length,
    leave: leavePending.length,
    expenses: expPending.length,
  };

  return {
    items,
    totals,
    walletApprovals,
    viewerRole: me.role,
    // Consistency note (mirrored in code): partner-only items are INCLUDED
    // for finance callers with actionable:false, never silently dropped.
    includesNonActionable: !partnerTier,
  };
}

// @cli-skip: chat parity via finance.approvals_inbox (financeApprovalsCapabilities, #1091); REST stays authoritative
router.get("/finance/approvals/inbox", async (req, res) => {
  const me = ensure(req, res); if (!me) return;
  // Role gate: founding_partner | partner | finance only; everyone else 403.
  // Deliberately NOT widened for other viewers of /finance/payables (Task
  // #1108 decision): the payables decide/approve writes are leadership-tier
  // too, so a kind-filtered wider read would only list items the viewer
  // cannot act on. The payables "Needs your action" panel renders an
  // explicit role-limited notice on this 403 instead of hiding silently.
  if (!isFinanceLeadership(me))
    return res.status(403).json({ error: "forbidden", message: "The approvals inbox is limited to finance leadership (founding_partner | partner | finance)." });
  const data = await loadFinanceApprovalsInbox(me);
  return res.json({ ok: true, data });
});

// ═══════════════════════════════════════════════════════════
// 3) REVERSE-AND-REPOST ("Fix this")
// ═══════════════════════════════════════════════════════════

const ReverseRepostSchema = z.object({
  memo: z.string().min(3).max(300),
  lines: z.array(z.object({
    accountCode: z.string().min(2),
    engagementId: z.string().optional(),
    debit: z.number().min(0).default(0),
    credit: z.number().min(0).default(0),
    memo: z.string().max(300).optional(),
  })).min(2).max(50),
});

// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/gl/journals/:id/reverse-repost", async (req, res) => {
  const me = ensure(req, res); if (!me) return;
  // Reversing a posted journal is partner tier (blueprint §4 "Reverse a
  // posted journal → Founder").
  if (!isPartnerTier(me))
    return res.status(403).json({ error: "forbidden", message: "Reverse-and-repost requires partner tier (founding_partner | partner)." });
  const parsed = ReverseRepostSchema.safeParse(req.body ?? {});
  if (!parsed.success)
    return res.status(400).json({ error: "invalid_input", details: parsed.error.flatten() });
  const b = parsed.data;

  const [orig] = await db.select().from(atelierGlJournalEntry).where(and(
    eq(atelierGlJournalEntry.id, req.params.id),
    eq(atelierGlJournalEntry.orgId, me.orgId),
    isNull(atelierGlJournalEntry.deletedAt),
  ));
  if (!orig) return res.status(404).json({ error: "not_found" });

  // Blocked when the original's period is locked/signed-off (same GL
  // period-lock check the accrual approve path uses).
  if (await isGlPeriodLocked(me.orgId, orig.periodLabel))
    return res.status(409).json({ error: "period_locked", message: `Period ${orig.periodLabel} is locked/signed-off for the GL module — cannot reverse-and-repost here.` });

  // Validate corrected lines: balanced + accounts exist for the entity.
  const totalDebit = round2(b.lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(b.lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.011)
    return res.status(400).json({ error: "unbalanced", totalDebit, totalCredit });
  if (totalDebit <= 0)
    return res.status(400).json({ error: "invalid_input", message: "Repost must move a non-zero amount." });
  const accounts = await db.select().from(atelierGlAccount).where(and(
    eq(atelierGlAccount.orgId, me.orgId),
    eq(atelierGlAccount.legalEntityId, orig.legalEntityId),
    eq(atelierGlAccount.active, true),
    isNull(atelierGlAccount.deletedAt),
  ));
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  for (const l of b.lines) {
    if (!byCode.has(l.accountCode))
      return res.status(400).json({ error: "missing_account", accountCode: l.accountCode });
  }

  // Original lines (to build the reversal with debit/credit swapped).
  const origLines = await db.select().from(atelierGlJournalLine).where(and(
    eq(atelierGlJournalLine.orgId, me.orgId),
    eq(atelierGlJournalLine.journalEntryId, orig.id),
  ));

  const reversalId = rid("gljrn");
  const repostId = rid("gljrn");
  // Post both entries in ONE transaction (atomic correction).
  await db.transaction(async (tx) => {
    // Reversal of the original: mirror lines, same period/date.
    await tx.insert(atelierGlJournalEntry).values({
      id: reversalId, orgId: me.orgId, legalEntityId: orig.legalEntityId,
      periodLabel: orig.periodLabel, entryDate: orig.entryDate,
      kind: "reversal", sourceKind: "reverse_repost_reversal", sourceRef: orig.id,
      memo: `Reversal of ${orig.id}: ${orig.memo ?? ""}`.slice(0, 300),
      currency: orig.currency, totalDebit: orig.totalCredit, totalCredit: orig.totalDebit,
      reversesEntryId: orig.id, createdByUserId: me.id,
    });
    for (const l of origLines) {
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: reversalId,
        accountId: l.accountId, accountCode: l.accountCode, accountName: l.accountName,
        engagementId: l.engagementId ?? null,
        debit: round2(l.credit || 0), credit: round2(l.debit || 0),
        memo: l.memo ? `Reversal: ${l.memo}` : null,
      });
    }
    // Corrected repost: new lines, linked back to the original.
    await tx.insert(atelierGlJournalEntry).values({
      id: repostId, orgId: me.orgId, legalEntityId: orig.legalEntityId,
      periodLabel: orig.periodLabel, entryDate: orig.entryDate,
      kind: "repost", sourceKind: "reverse_repost", sourceRef: repostId,
      memo: b.memo, currency: orig.currency, totalDebit, totalCredit,
      repostOfEntryId: orig.id, createdByUserId: me.id,
    });
    for (const l of b.lines) {
      const acct = byCode.get(l.accountCode)!;
      await tx.insert(atelierGlJournalLine).values({
        id: rid("gljl"), orgId: me.orgId, journalEntryId: repostId,
        accountId: acct.id, accountCode: acct.code, accountName: acct.name,
        engagementId: l.engagementId ?? null,
        debit: round2(l.debit), credit: round2(l.credit), memo: l.memo ?? null,
      });
    }
  });

  // Audit both entries, linked to the original.
  await audit({
    entityType: "gl_journal_entry", entityId: reversalId, actor: me,
    action: "gl.reverse_repost.reversal",
    payload: { originalId: orig.id, periodLabel: orig.periodLabel, totalDebit: orig.totalCredit, totalCredit: orig.totalDebit },
    summary: `Reversed journal ${orig.id} (${orig.periodLabel})`,
  });
  await audit({
    entityType: "gl_journal_entry", entityId: repostId, actor: me,
    action: "gl.reverse_repost.repost",
    payload: { originalId: orig.id, reversalId, periodLabel: orig.periodLabel, memo: b.memo, totalDebit, lines: b.lines.length },
    summary: `Reposted corrected journal for ${orig.id} (${orig.periodLabel}): ${b.memo} (${orig.currency} ${totalDebit})`,
  });

  return res.status(201).json({ ok: true, data: { reversalId, repostId, originalId: orig.id } });
});

export default router;
