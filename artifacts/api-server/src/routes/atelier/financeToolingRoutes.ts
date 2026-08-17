/**
 * Task #1251 — Vendor tooling spend: line-item mining + project cost
 * allocation. All routes under /api/atelier/finance/tooling, finance-
 * leadership gated (founding_partner | partner | finance), same predicate
 * glRoutes uses.
 *
 *   GET  /finance/tooling/overview
 *   GET  /finance/tooling/unmapped
 *   POST /finance/tooling/map
 *   GET  /finance/tooling/vendor-rules
 *   PUT  /finance/tooling/vendor-rules
 *   GET  /finance/tooling/targets
 *   GET  /finance/tooling/invoices/:id
 *   POST /finance/tooling/invoices/:id/approve
 *   POST /finance/tooling/invoices/:id/extract
 *
 * Reads report from APPROVED splits (overview/vendor-rules) and PROPOSED
 * queues (pending/unmapped). Writes (map, vendor-rules, approve) are
 * audited; approve additionally triggers recomputeEngagementCostToDate for
 * engagement-bucket splits. Splits never auto-approve here.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierPartnerFirmInvoices,
  atelierVendorProjectMap,
  atelierVendorAllocRules,
  atelierVendorCostSplits,
  atelierEngagements,
  atelierOpportunities,
  atelierAccounts,
  type VendorInvoiceExtraction,
  type VendorCostBucketType,
  type VendorAllocSplit,
} from "@workspace/db";
import { isRestrictedPersona, isBoardObserver } from "./personaRoles.js";
import {
  detectVendorKey,
  vendorLabel,
  bucketLabelFor,
  extractAndProposeForInvoice,
  proposeSplitsForInvoice,
  hasApprovedSplits,
  VENDOR_DEFAULT_KEY,
  RULE_VENDOR_KEYS,
} from "../../lib/atelier-vendor-invoice-mining.js";
import { recomputeEngagementCostToDate } from "../../lib/atelier-engagement-pnl-recompute.js";

type Me = typeof atelierUsers.$inferSelect;
const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function ensure(req: Request, res: Response): Me | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}
function isFinanceLeadership(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
}
/** Gate every read+write on the same finance-leadership predicate glRoutes uses. */
function deny(req: Request, res: Response): Me | null {
  const me = ensure(req, res);
  if (!me) return null;
  if (isRestrictedPersona(me.role) || isBoardObserver(me.role) || !isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "Tooling spend is limited to finance leadership (founding_partner | partner | finance)." });
    return null;
  }
  return me;
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

const BUCKET_TYPES: VendorCostBucketType[] = ["engagement", "opportunity", "account", "internal", "overhead", "ip_development"];
const BUCKET_ENUM = ["engagement", "opportunity", "account", "internal", "overhead", "ip_development"] as const;

/** Validate a bucketRef against org-scoped engagement/opportunity/account ids. */
async function validateBucketRef(
  orgId: string,
  bucketType: VendorCostBucketType,
  bucketRef: string | null,
): Promise<{ ok: true; ref: string | null } | { ok: false; error: string }> {
  if (bucketType === "internal" || bucketType === "overhead" || bucketType === "ip_development") {
    // bucketRef ignored for these types.
    return { ok: true, ref: null };
  }
  if (!bucketRef) return { ok: false, error: "bucketRef-required" };
  if (bucketType === "account") {
    const [a] = await db
      .select({ id: atelierAccounts.id })
      .from(atelierAccounts)
      .where(and(eq(atelierAccounts.id, bucketRef), eq(atelierAccounts.orgId, orgId), isNull(atelierAccounts.deletedAt)));
    if (!a) return { ok: false, error: "account-not-found" };
    return { ok: true, ref: a.id };
  }
  if (bucketType === "engagement") {
    const [e] = await db
      .select({ id: atelierEngagements.id })
      .from(atelierEngagements)
      .where(and(eq(atelierEngagements.id, bucketRef), eq(atelierEngagements.orgId, orgId)));
    if (!e) return { ok: false, error: "engagement-not-found" };
    return { ok: true, ref: e.id };
  }
  const [o] = await db
    .select({ id: atelierOpportunities.id })
    .from(atelierOpportunities)
    .where(and(eq(atelierOpportunities.id, bucketRef), eq(atelierOpportunities.orgId, orgId)));
  if (!o) return { ok: false, error: "opportunity-not-found" };
  return { ok: true, ref: o.id };
}

// A supplier invoice qualifies for tooling if its supplier is a detected
// tooling vendor. We surface such invoices with their extraction/split state.
function toolingVendorKey(partnerFirmName: string | null): string | null {
  return detectVendorKey(partnerFirmName);
}

type SplitStatus = "proposed" | "unmapped" | "unreconciled" | "failed" | "none";

/** Compute the split status for an invoice from its extraction + splits. */
function invoiceSplitStatus(
  extraction: VendorInvoiceExtraction | null,
  proposedCount: number,
  approvedCount: number,
  unmapped: boolean,
): SplitStatus {
  if (!extraction) return "none";
  if (extraction.status === "failed") return "failed";
  if (extraction.status === "unreconciled") return "unreconciled";
  // ok extraction
  if (proposedCount > 0) return "proposed";
  if (approvedCount > 0) return "none"; // fully approved — nothing pending
  return unmapped ? "unmapped" : "none";
}

// =====================================================================
// GET /finance/tooling/overview
// =====================================================================
// @cli-skip: chat parity via finance.tooling_spend (#1251); REST stays authoritative for the tooling console
router.get("/finance/tooling/overview", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const orgId = me.orgId;

  // Approved splits drive the bucket totals + by-vendor / by-project rollups.
  const approved = await db
    .select()
    .from(atelierVendorCostSplits)
    .where(and(
      eq(atelierVendorCostSplits.orgId, orgId),
      eq(atelierVendorCostSplits.status, "approved"),
      isNull(atelierVendorCostSplits.deletedAt),
    ));

  // Resolve the vendorKey for each split's invoice (splits don't store it).
  const invIds = [...new Set(approved.map((s) => s.invoiceId))];
  const invRows = invIds.length
    ? await db.select({
        id: atelierPartnerFirmInvoices.id,
        partnerFirmName: atelierPartnerFirmInvoices.partnerFirmName,
      }).from(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, invIds))
    : [];
  const vendorByInv = new Map(invRows.map((r) => [r.id, toolingVendorKey(r.partnerFirmName) ?? "other"]));

  const totals = { internalUsd: 0, bdUsd: 0, deliveryUsd: 0, overheadUsd: 0, clientUsd: 0, ipDevUsd: 0, unallocatedUsd: 0 };
  const bucketOf = (t: VendorCostBucketType): keyof typeof totals => {
    switch (t) {
      case "internal": return "internalUsd";
      case "opportunity": return "bdUsd";
      case "engagement": return "deliveryUsd";
      case "overhead": return "overheadUsd";
      case "account": return "clientUsd";
      case "ip_development": return "ipDevUsd";
      default: return "unallocatedUsd";
    }
  };

  const byVendorMap = new Map<string, { vendorKey: string; vendorLabel: string; totalUsd: number; bucketTotals: { internalUsd: number; bdUsd: number; deliveryUsd: number; overheadUsd: number; clientUsd: number; ipDevUsd: number } }>();
  const byProjectMap = new Map<string, { vendorKey: string; projectKey: string; projectLabel: string; bucketType: VendorCostBucketType; bucketRef: string | null; bucketLabel: string; totalUsd: number }>();

  for (const s of approved) {
    const usd = round2(Number(s.usdAmount || 0));
    const bkey = bucketOf(s.bucketType);
    totals[bkey] += usd;
    const vk = vendorByInv.get(s.invoiceId) ?? "other";
    let v = byVendorMap.get(vk);
    if (!v) {
      v = { vendorKey: vk, vendorLabel: vendorLabel(vk), totalUsd: 0, bucketTotals: { internalUsd: 0, bdUsd: 0, deliveryUsd: 0, overheadUsd: 0, clientUsd: 0, ipDevUsd: 0 } };
      byVendorMap.set(vk, v);
    }
    v.totalUsd += usd;
    v.bucketTotals[bkey as keyof typeof v.bucketTotals] += usd;

    const pkey = `${vk}::${s.projectKey}::${s.bucketType}::${s.bucketRef ?? ""}`;
    let p = byProjectMap.get(pkey);
    if (!p) {
      p = {
        vendorKey: vk, projectKey: s.projectKey, projectLabel: s.projectLabel,
        bucketType: s.bucketType, bucketRef: s.bucketRef,
        bucketLabel: await bucketLabelFor(orgId, s.bucketType, s.bucketRef),
        totalUsd: 0,
      };
      byProjectMap.set(pkey, p);
    }
    p.totalUsd += usd;
  }

  for (const v of byVendorMap.values()) {
    v.totalUsd = round2(v.totalUsd);
    v.bucketTotals.internalUsd = round2(v.bucketTotals.internalUsd);
    v.bucketTotals.bdUsd = round2(v.bucketTotals.bdUsd);
    v.bucketTotals.deliveryUsd = round2(v.bucketTotals.deliveryUsd);
    v.bucketTotals.overheadUsd = round2(v.bucketTotals.overheadUsd);
    v.bucketTotals.clientUsd = round2(v.bucketTotals.clientUsd);
    v.bucketTotals.ipDevUsd = round2(v.bucketTotals.ipDevUsd);
  }
  for (const p of byProjectMap.values()) p.totalUsd = round2(p.totalUsd);
  for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] = round2(totals[k]);

  // Pending invoices: any tooling invoice with an extraction that isn't
  // fully approved (proposed / unmapped / unreconciled / failed).
  const toolingInvoices = await db
    .select()
    .from(atelierPartnerFirmInvoices)
    .where(and(
      eq(atelierPartnerFirmInvoices.orgId, orgId),
      isNull(atelierPartnerFirmInvoices.deletedAt),
    ))
    .orderBy(desc(atelierPartnerFirmInvoices.submittedAt))
    .limit(500);

  const allInvIds = toolingInvoices.map((r) => r.id);
  const allSplits = allInvIds.length
    ? await db.select().from(atelierVendorCostSplits).where(and(
        inArray(atelierVendorCostSplits.invoiceId, allInvIds),
        isNull(atelierVendorCostSplits.deletedAt),
      ))
    : [];
  const splitsByInv = new Map<string, typeof allSplits>();
  for (const s of allSplits) {
    const arr = splitsByInv.get(s.invoiceId) ?? [];
    arr.push(s);
    splitsByInv.set(s.invoiceId, arr);
  }

  const pendingInvoices: Array<{ invoiceId: string; reference: string | null; vendorKey: string; supplierName: string; totalUsd: number; splitStatus: SplitStatus; invoiceDate: string | null }> = [];
  let unmappedCount = 0;
  for (const inv of toolingInvoices) {
    const vk = toolingVendorKey(inv.partnerFirmName);
    if (!vk) continue; // not a tooling vendor
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    const splits = splitsByInv.get(inv.id) ?? [];
    const proposedCount = splits.filter((s) => s.status === "proposed").length;
    const approvedCount = splits.filter((s) => s.status === "approved").length;
    // Unmapped only when the extraction reconciled ("ok") but produced no
    // proposed/approved splits (all items resolved to a mapping otherwise).
    const unmapped = ext?.status === "ok" && proposedCount === 0 && approvedCount === 0;
    const status = invoiceSplitStatus(ext, proposedCount, approvedCount, unmapped);
    if (status === "unmapped") unmappedCount += 1;
    if (status === "none") continue; // nothing pending
    pendingInvoices.push({
      invoiceId: inv.id,
      reference: inv.reference,
      vendorKey: vk,
      supplierName: inv.partnerFirmName,
      totalUsd: round2(Number(inv.usdAmount || 0)),
      splitStatus: status,
      invoiceDate: inv.invoiceDate,
    });
  }

  return res.json({
    ok: true,
    data: {
      totals,
      byVendor: [...byVendorMap.values()].sort((a, b) => b.totalUsd - a.totalUsd),
      byProject: [...byProjectMap.values()].sort((a, b) => b.totalUsd - a.totalUsd),
      pendingInvoices,
      unmappedCount,
    },
  });
});

// =====================================================================
// GET /finance/tooling/unmapped
// =====================================================================
// @cli-skip: read parity via finance.tooling_spend (#1251); mapping queue is a console-only view
router.get("/finance/tooling/unmapped", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const orgId = me.orgId;

  // Load existing mappings so we only surface project keys still unmapped.
  const maps = await db.select().from(atelierVendorProjectMap).where(and(
    eq(atelierVendorProjectMap.orgId, orgId),
    isNull(atelierVendorProjectMap.deletedAt),
  ));
  const mappedSet = new Set(maps.map((m) => `${m.vendorKey}::${m.projectKey}`));

  const rules = await db.select().from(atelierVendorAllocRules).where(and(
    eq(atelierVendorAllocRules.orgId, orgId),
    isNull(atelierVendorAllocRules.deletedAt),
  ));
  const ruledVendors = new Set(rules.filter((r) => (r.splits ?? []).length > 0).map((r) => r.vendorKey));

  const invoices = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).limit(1000);

  // Aggregate unmapped (vendorKey, projectKey) rows across reconciled invoices.
  const agg = new Map<string, { vendorKey: string; projectKey: string; projectLabel: string; invoiceCount: number; totalUsd: number; exampleInvoiceId: string }>();
  for (const inv of invoices) {
    const vk = toolingVendorKey(inv.partnerFirmName);
    if (!vk) continue;
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    if (!ext || ext.status !== "ok") continue;
    for (const item of ext.items) {
      const mapped = item.projectKey === VENDOR_DEFAULT_KEY
        ? ruledVendors.has(vk)
        : mappedSet.has(`${vk}::${item.projectKey}`);
      if (mapped) continue;
      const key = `${vk}::${item.projectKey}`;
      let a = agg.get(key);
      if (!a) {
        a = { vendorKey: vk, projectKey: item.projectKey, projectLabel: item.projectLabel, invoiceCount: 0, totalUsd: 0, exampleInvoiceId: inv.id };
        agg.set(key, a);
      }
      a.invoiceCount += 1;
      // Attribute the item's gross portion of the invoice USD as a signal.
      a.totalUsd += round2(Number(item.amount || 0));
    }
  }

  const rows = [...agg.values()].map((a) => ({ ...a, totalUsd: round2(a.totalUsd) }))
    .sort((a, b) => b.totalUsd - a.totalUsd);
  return res.json({ ok: true, data: { rows } });
});

// =====================================================================
// POST /finance/tooling/map
// =====================================================================
const MapSchema = z.object({
  vendorKey: z.string().min(1).max(40),
  projectKey: z.string().min(1).max(200),
  bucketType: z.enum(BUCKET_ENUM),
  bucketRef: z.string().max(200).nullable().optional(),
});
// @cli-skip: UI-workflow finance-leadership write; mapping requires the console's queue context
router.post("/finance/tooling/map", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const parsed = MapSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
  const { vendorKey, projectKey, bucketType } = parsed.data;
  const bucketRefIn = parsed.data.bucketRef ?? null;

  const v = await validateBucketRef(me.orgId, bucketType, bucketRefIn);
  if (!v.ok) return res.status(400).json({ error: v.error });
  const bucketRef = v.ref;

  // Resolve a display label for the project from any reconciled invoice.
  let projectLabel = projectKey;
  const invoices = await db.select({
    toolingExtraction: atelierPartnerFirmInvoices.toolingExtraction,
  }).from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).limit(1000);
  outer: for (const inv of invoices) {
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    if (!ext) continue;
    for (const it of ext.items) {
      if (it.projectKey === projectKey) { projectLabel = it.projectLabel; break outer; }
    }
  }

  const now = new Date();
  const mappingId = rid("vpm");
  // Upsert on (org, vendor, project): revive/rewrite an existing mapping.
  const [existing] = await db.select().from(atelierVendorProjectMap).where(and(
    eq(atelierVendorProjectMap.orgId, me.orgId),
    eq(atelierVendorProjectMap.vendorKey, vendorKey),
    eq(atelierVendorProjectMap.projectKey, projectKey),
  ));
  let finalMappingId = mappingId;
  if (existing) {
    finalMappingId = existing.id;
    await db.update(atelierVendorProjectMap).set({
      projectLabel, bucketType, bucketRef, deletedAt: null,
      createdByUserId: me.id, updatedAt: now,
    }).where(eq(atelierVendorProjectMap.id, existing.id));
  } else {
    await db.insert(atelierVendorProjectMap).values({
      id: mappingId, orgId: me.orgId, vendorKey, projectKey, projectLabel,
      bucketType, bucketRef, createdByUserId: me.id, createdAt: now, updatedAt: now,
    });
  }

  await audit({
    entityType: "vendor_project_map", entityId: finalMappingId, actor: me,
    action: "tooling.project_mapped",
    payload: { vendorKey, projectKey, projectLabel, bucketType, bucketRef },
    summary: `${me.name} mapped ${vendorLabel(vendorKey)} project "${projectLabel}" → ${bucketType}${bucketRef ? ` (${bucketRef})` : ""}.`,
  });

  // Re-propose splits for tooling invoices that reference this project and
  // now resolve fully. Only invoices with a reconciled ("ok") extraction.
  const reproposedInvoiceIds: string[] = [];
  const toolingInvoices = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).limit(1000);
  for (const inv of toolingInvoices) {
    const vk = toolingVendorKey(inv.partnerFirmName);
    if (vk !== vendorKey) continue;
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    if (!ext || ext.status !== "ok") continue;
    const touches = ext.items.some((it) => it.projectKey === projectKey);
    if (!touches) continue;
    // Approved invoices are immutable — skip so mapping changes never churn or
    // double-count already-approved spend.
    if (await hasApprovedSplits(inv.id)) continue;
    const out = await proposeSplitsForInvoice({
      inv: {
        id: inv.id, orgId: inv.orgId, partnerFirmName: inv.partnerFirmName,
        costAmount: Number(inv.costAmount || 0), costCurrency: inv.costCurrency,
        invoiceDate: inv.invoiceDate, fileName: inv.fileName, reference: inv.reference,
        blobRef: inv.blobRef,
      },
      vendorKey,
      payload: ext,
    });
    if (out.proposed) reproposedInvoiceIds.push(inv.id);
  }

  return res.json({ ok: true, data: { mappingId: finalMappingId, reproposedInvoiceIds } });
});

// =====================================================================
// GET /finance/tooling/vendor-rules
// =====================================================================
// @cli-skip: read parity via finance.tooling_spend (#1251); flat-vendor rules are a console-only view
router.get("/finance/tooling/vendor-rules", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const rules = await db.select().from(atelierVendorAllocRules).where(and(
    eq(atelierVendorAllocRules.orgId, me.orgId),
    isNull(atelierVendorAllocRules.deletedAt),
  ));
  const rulesByVendor = new Map(rules.map((r) => [r.vendorKey, r]));
  // Always return one row per supported flat-vendor (+ replit fallback) so the
  // console editor can seed the FIRST rule for a vendor that has none yet
  // (client renders one card per row; splits: [] renders an empty, addable card).
  const out = [];
  for (const vendorKey of RULE_VENDOR_KEYS) {
    const r = rulesByVendor.get(vendorKey);
    const splits = (r?.splits ?? []) as VendorAllocSplit[];
    const enriched = [];
    for (const s of splits) {
      enriched.push({
        bucketType: s.bucketType,
        bucketRef: s.bucketRef,
        bucketLabel: await bucketLabelFor(me.orgId, s.bucketType, s.bucketRef),
        pct: s.pct,
      });
    }
    out.push({ vendorKey, vendorLabel: vendorLabel(vendorKey), splits: enriched });
  }
  return res.json({ ok: true, data: { rules: out } });
});

// =====================================================================
// PUT /finance/tooling/vendor-rules
// =====================================================================
const VendorRulesSchema = z.object({
  vendorKey: z.string().min(1).max(40),
  splits: z.array(z.object({
    bucketType: z.enum(BUCKET_ENUM),
    bucketRef: z.string().max(200).nullable().optional(),
    pct: z.number().min(0).max(100),
  })).min(1).max(50),
});
// @cli-skip: UI-workflow finance-leadership write; flat-vendor rule edit needs the console's split editor
router.put("/finance/tooling/vendor-rules", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const parsed = VendorRulesSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
  const { vendorKey } = parsed.data;

  const sum = parsed.data.splits.reduce((s, x) => s + x.pct, 0);
  if (Math.abs(sum - 100) > 0.01) return res.status(400).json({ error: "pct-sum", message: "Split percentages must sum to 100." });

  // Validate every ref.
  const cleaned: VendorAllocSplit[] = [];
  for (const s of parsed.data.splits) {
    const v = await validateBucketRef(me.orgId, s.bucketType, s.bucketRef ?? null);
    if (!v.ok) return res.status(400).json({ error: v.error });
    cleaned.push({ bucketType: s.bucketType, bucketRef: v.ref, pct: s.pct });
  }

  const now = new Date();
  const [existing] = await db.select().from(atelierVendorAllocRules).where(and(
    eq(atelierVendorAllocRules.orgId, me.orgId),
    eq(atelierVendorAllocRules.vendorKey, vendorKey),
  ));
  if (existing) {
    await db.update(atelierVendorAllocRules).set({
      splits: cleaned, updatedByUserId: me.id, updatedAt: now, deletedAt: null,
    }).where(eq(atelierVendorAllocRules.id, existing.id));
  } else {
    await db.insert(atelierVendorAllocRules).values({
      id: rid("var"), orgId: me.orgId, vendorKey, splits: cleaned,
      updatedByUserId: me.id, createdAt: now, updatedAt: now,
    });
  }

  await audit({
    entityType: "vendor_alloc_rule", entityId: vendorKey, actor: me,
    action: "tooling.vendor_rule_set",
    payload: { vendorKey, splits: cleaned },
    summary: `${me.name} set the ${vendorLabel(vendorKey)} allocation rule (${cleaned.length} split(s)).`,
  });

  // Re-propose splits for reconciled flat invoices of this vendor.
  const toolingInvoices = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).limit(1000);
  for (const inv of toolingInvoices) {
    const vk = toolingVendorKey(inv.partnerFirmName);
    if (vk !== vendorKey) continue;
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    if (!ext || ext.status !== "ok") continue;
    if (!ext.items.some((it) => it.projectKey === VENDOR_DEFAULT_KEY)) continue;
    // Approved invoices are immutable — skip so rule changes never churn or
    // double-count already-approved spend.
    if (await hasApprovedSplits(inv.id)) continue;
    await proposeSplitsForInvoice({
      inv: {
        id: inv.id, orgId: inv.orgId, partnerFirmName: inv.partnerFirmName,
        costAmount: Number(inv.costAmount || 0), costCurrency: inv.costCurrency,
        invoiceDate: inv.invoiceDate, fileName: inv.fileName, reference: inv.reference,
        blobRef: inv.blobRef,
      },
      vendorKey,
      payload: ext,
    });
  }

  return res.json({ ok: true });
});

// =====================================================================
// GET /finance/tooling/targets
// =====================================================================
// @cli-skip: read parity via finance.tooling_spend (#1251); target pickers are console-only
router.get("/finance/tooling/targets", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const engagements = await db.select({
    id: atelierEngagements.id, name: atelierEngagements.name,
  }).from(atelierEngagements).where(and(
    eq(atelierEngagements.orgId, me.orgId),
    isNull(atelierEngagements.deletedAt),
  )).orderBy(desc(atelierEngagements.createdAt)).limit(500);

  const oppRows = await db.select({
    id: atelierOpportunities.id, name: atelierOpportunities.name, accountId: atelierOpportunities.accountId,
  }).from(atelierOpportunities).where(and(
    eq(atelierOpportunities.orgId, me.orgId),
    isNull(atelierOpportunities.deletedAt),
  )).orderBy(desc(atelierOpportunities.createdAt)).limit(500);

  const accIds = [...new Set(oppRows.map((o) => o.accountId))];
  const accs = accIds.length
    ? await db.select({ id: atelierAccounts.id, name: atelierAccounts.name })
        .from(atelierAccounts).where(inArray(atelierAccounts.id, accIds))
    : [];
  const accName = new Map(accs.map((a) => [a.id, a.name]));

  // Task #1268 — account (client) targets for the new "account" bucket.
  const accountRows = await db.select({
    id: atelierAccounts.id, name: atelierAccounts.name,
  }).from(atelierAccounts).where(and(
    eq(atelierAccounts.orgId, me.orgId),
    isNull(atelierAccounts.deletedAt),
  )).orderBy(desc(atelierAccounts.createdAt)).limit(500);

  return res.json({
    ok: true,
    data: {
      engagements: engagements.map((e) => ({ id: e.id, name: e.name })),
      opportunities: oppRows.map((o) => ({ id: o.id, name: o.name, accountName: accName.get(o.accountId) ?? "" })),
      accounts: accountRows.map((a) => ({ id: a.id, name: a.name })),
    },
  });
});

// =====================================================================
// GET /finance/tooling/invoices/:id
// =====================================================================
// @cli-skip: read parity via finance.tooling_spend (#1251); the per-invoice split panel is console-only
router.get("/finance/tooling/invoices/:id", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const [inv] = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.id, req.params.id),
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ));
  if (!inv) return res.status(404).json({ error: "not-found" });
  const vk = toolingVendorKey(inv.partnerFirmName);
  const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;

  const splitRows = await db.select().from(atelierVendorCostSplits).where(and(
    eq(atelierVendorCostSplits.invoiceId, inv.id),
    isNull(atelierVendorCostSplits.deletedAt),
  ));
  const splits = [];
  for (const s of splitRows) {
    splits.push({
      id: s.id,
      projectKey: s.projectKey,
      projectLabel: s.projectLabel,
      bucketType: s.bucketType,
      bucketRef: s.bucketRef,
      bucketLabel: await bucketLabelFor(me.orgId, s.bucketType, s.bucketRef),
      grossUsd: round2(Number(s.grossAmount || 0)),
      creditUsd: round2(Number(s.creditAmount || 0)),
      vatUsd: round2(Number(s.vatAmount || 0)),
      netUsd: round2(Number(s.netAmount || 0)),
      status: s.status,
    });
  }

  const extraction = ext
    ? {
        status: ext.status,
        extractedAt: ext.extractedAt,
        currency: ext.currency,
        subtotal: ext.subtotal,
        vatAmount: ext.vatAmount,
        creditsTotal: ext.creditsTotal,
        items: ext.items.map((it) => ({
          projectKey: it.projectKey, projectLabel: it.projectLabel, category: it.category, amount: it.amount,
        })),
        note: ext.note,
      }
    : null;

  return res.json({
    ok: true,
    data: {
      invoiceId: inv.id,
      reference: inv.reference,
      supplierName: inv.partnerFirmName,
      vendorKey: vk,
      extraction,
      splits,
    },
  });
});

// =====================================================================
// POST /finance/tooling/invoices/:id/approve
// =====================================================================
// @cli-skip: UI-workflow finance-leadership write; approving splits needs the split panel's review context
// founder-reviewed = finance-leadership approval (founding_partner|partner|finance),
// consistent with payables review gates.
router.post("/finance/tooling/invoices/:id/approve", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const [inv] = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.id, req.params.id),
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ));
  if (!inv) return res.status(404).json({ error: "not-found" });

  const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
  const proposed = await db.select().from(atelierVendorCostSplits).where(and(
    eq(atelierVendorCostSplits.invoiceId, inv.id),
    eq(atelierVendorCostSplits.status, "proposed"),
    isNull(atelierVendorCostSplits.deletedAt),
  ));

  // 409 if any item is unmapped (no proposed splits despite a reconciled
  // extraction that produced items). Include the project names so the
  // console can say exactly what still needs a home (Task #1268).
  if (ext?.status === "ok" && ext.items.length > 0 && proposed.length === 0) {
    const maps = await db.select().from(atelierVendorProjectMap).where(and(
      eq(atelierVendorProjectMap.orgId, me.orgId),
      isNull(atelierVendorProjectMap.deletedAt),
    ));
    const vk = toolingVendorKey(inv.partnerFirmName) ?? "";
    const mapped = new Set(maps.filter((m) => m.vendorKey === vk).map((m) => m.projectKey));
    const unmappedLabels = [...new Set(ext.items
      .filter((it) => it.projectKey === VENDOR_DEFAULT_KEY ? false : !mapped.has(it.projectKey))
      .map((it) => it.projectLabel))];
    const n = unmappedLabels.length;
    return res.status(409).json({
      error: "unmapped",
      unmappedProjects: unmappedLabels,
      message: n > 0
        ? `${n} project${n === 1 ? " needs" : "s need"} a home before approval: ${unmappedLabels.join(", ")}.`
        : "This invoice has unmapped project(s); map them before approving.",
    });
  }
  if (proposed.length === 0) {
    return res.status(409).json({ error: "no-proposed-splits", message: "There are no proposed splits to approve on this invoice." });
  }

  const now = new Date();
  const affectedEngagements = new Set<string>();
  await db.transaction(async (tx) => {
    for (const s of proposed) {
      await tx.update(atelierVendorCostSplits).set({
        status: "approved", decidedByUserId: me.id, decidedAt: now, updatedAt: now,
      }).where(eq(atelierVendorCostSplits.id, s.id));
      if (s.bucketType === "engagement" && s.bucketRef) affectedEngagements.add(s.bucketRef);
    }
  });

  await audit({
    entityType: "partner_firm_invoice", entityId: inv.id, actor: me,
    action: "tooling.splits_approved",
    payload: {
      invoiceId: inv.id, vendorKey: toolingVendorKey(inv.partnerFirmName),
      approvedCount: proposed.length,
      splitIds: proposed.map((s) => s.id),
    },
    summary: `${me.name} approved ${proposed.length} tooling cost split(s) on invoice ${inv.reference ?? inv.id}.`,
  });

  // Engagement-bucket splits now count toward cost-to-date (subs bucket).
  for (const engId of affectedEngagements) {
    await recomputeEngagementCostToDate(engId, { actorUserId: me.id }).catch(() => {});
  }

  return res.json({ ok: true, data: { approvedCount: proposed.length } });
});

// =====================================================================
// POST /finance/tooling/invoices/:id/extract
// =====================================================================
// @cli-skip: UI-workflow finance-leadership write; re-extraction is driven from the split panel
router.post("/finance/tooling/invoices/:id/extract", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const [inv] = await db.select({ id: atelierPartnerFirmInvoices.id, partnerFirmName: atelierPartnerFirmInvoices.partnerFirmName }).from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.id, req.params.id),
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  ));
  if (!inv) return res.status(404).json({ error: "not-found" });
  if (!toolingVendorKey(inv.partnerFirmName)) {
    return res.status(400).json({ error: "not-a-tooling-vendor", message: "This supplier is not a tooling vendor (Replit/Anthropic/Perplexity/OpenAI)." });
  }
  // Immutable once approved: re-extraction would rewrite line items / churn
  // proposals while approved spend stays counted, risking a double-count.
  if (await hasApprovedSplits(inv.id)) {
    return res.status(409).json({
      error: "splits-already-approved",
      message: "This invoice already has approved cost splits — unapprove/supersede them before re-extracting.",
    });
  }
  const out = await extractAndProposeForInvoice(inv.id);
  await audit({
    entityType: "partner_firm_invoice", entityId: inv.id, actor: me,
    action: "tooling.reextracted",
    payload: { invoiceId: inv.id, status: out.status },
    summary: `${me.name} re-ran tooling extraction on invoice ${inv.id} (status ${out.status}).`,
  });
  return res.json({ ok: true, data: { status: out.status } });
});

// =====================================================================
// GET /finance/tooling/mappings — Task #1268
// =====================================================================
// All saved project→bucket associations, newest first, with display labels
// and who saved them. Powers the "Project mappings" panel.
// @cli-skip: read parity via finance.tooling_spend (#1251); the mappings panel is console-only
router.get("/finance/tooling/mappings", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const maps = await db.select().from(atelierVendorProjectMap).where(and(
    eq(atelierVendorProjectMap.orgId, me.orgId),
    isNull(atelierVendorProjectMap.deletedAt),
  )).orderBy(desc(atelierVendorProjectMap.updatedAt)).limit(1000);

  const userIds = [...new Set(maps.map((m) => m.createdByUserId).filter((x): x is string => !!x))];
  const users = userIds.length
    ? await db.select({ id: atelierUsers.id, name: atelierUsers.name })
        .from(atelierUsers).where(inArray(atelierUsers.id, userIds))
    : [];
  const userName = new Map(users.map((u) => [u.id, u.name]));

  const rows = [];
  for (const m of maps) {
    rows.push({
      id: m.id,
      vendorKey: m.vendorKey,
      vendorLabel: vendorLabel(m.vendorKey),
      projectKey: m.projectKey,
      projectLabel: m.projectLabel,
      bucketType: m.bucketType,
      bucketRef: m.bucketRef,
      bucketLabel: await bucketLabelFor(me.orgId, m.bucketType, m.bucketRef),
      createdByName: (m.createdByUserId && userName.get(m.createdByUserId)) || null,
      updatedAt: m.updatedAt ? m.updatedAt.toISOString() : null,
    });
  }
  return res.json({ ok: true, data: { rows } });
});

// =====================================================================
// DELETE /finance/tooling/mappings/:id — Task #1268
// =====================================================================
// Soft-delete a saved mapping: the project name returns to the unmapped
// queue, and any still-PROPOSED splits that relied on it are cleared so
// affected invoices show "unmapped" again. Approved splits are immutable —
// already-approved spend never moves.
// @cli-skip: UI-workflow finance-leadership write; unmapping is driven from the mappings panel
router.delete("/finance/tooling/mappings/:id", async (req, res) => {
  const me = deny(req, res); if (!me) return;
  const [m] = await db.select().from(atelierVendorProjectMap).where(and(
    eq(atelierVendorProjectMap.id, req.params.id),
    eq(atelierVendorProjectMap.orgId, me.orgId),
    isNull(atelierVendorProjectMap.deletedAt),
  ));
  if (!m) return res.status(404).json({ error: "not-found" });

  const now = new Date();
  await db.update(atelierVendorProjectMap).set({ deletedAt: now, updatedAt: now })
    .where(eq(atelierVendorProjectMap.id, m.id));

  // Re-propose (which now yields "unmapped" → zero proposed rows) for
  // reconciled invoices touching this project. Approved invoices are skipped —
  // immutability guard, same as the map/rules routes.
  const reproposedInvoiceIds: string[] = [];
  const toolingInvoices = await db.select().from(atelierPartnerFirmInvoices).where(and(
    eq(atelierPartnerFirmInvoices.orgId, me.orgId),
    isNull(atelierPartnerFirmInvoices.deletedAt),
  )).limit(1000);
  for (const inv of toolingInvoices) {
    const vk = toolingVendorKey(inv.partnerFirmName);
    if (vk !== m.vendorKey) continue;
    const ext = (inv.toolingExtraction ?? null) as VendorInvoiceExtraction | null;
    if (!ext || ext.status !== "ok") continue;
    if (!ext.items.some((it) => it.projectKey === m.projectKey)) continue;
    if (await hasApprovedSplits(inv.id)) continue;
    await proposeSplitsForInvoice({
      inv: {
        id: inv.id, orgId: inv.orgId, partnerFirmName: inv.partnerFirmName,
        costAmount: Number(inv.costAmount || 0), costCurrency: inv.costCurrency,
        invoiceDate: inv.invoiceDate, fileName: inv.fileName, reference: inv.reference,
        blobRef: inv.blobRef,
      },
      vendorKey: m.vendorKey,
      payload: ext,
    });
    reproposedInvoiceIds.push(inv.id);
  }

  await audit({
    entityType: "vendor_project_map", entityId: m.id, actor: me,
    action: "tooling.project_unmapped",
    payload: { vendorKey: m.vendorKey, projectKey: m.projectKey, projectLabel: m.projectLabel, bucketType: m.bucketType, bucketRef: m.bucketRef },
    summary: `${me.name} removed the ${vendorLabel(m.vendorKey)} mapping for "${m.projectLabel}" — the project returns to the unmapped queue.`,
  });

  return res.json({ ok: true, data: { removedId: m.id, reproposedInvoiceIds } });
});

export default router;
