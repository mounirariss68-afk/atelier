/**
 * Task #383 — Expense taxonomy, categorization + accountant surfaces.
 *
 *   GET  /wallet/expense-taxonomy                      category tree + cost centers + funding sources
 *   POST /wallet/expense-categorize/suggest            merchant-memory → AI suggestion (fail-loud)
 *   GET  /wallet/expense-gl-mappings/:entityId         per-entity GL/VAT mapping list
 *   PUT  /wallet/expense-gl-mappings/:entityId         replace mapping set (finance leadership)
 *   GET  /wallet/bank/accounts/:accountId/signatories  signatory register (finance leadership view)
 *   PUT  /wallet/bank/accounts/:accountId/signatories  replace register (FOUNDING PARTNER only)
 *   PATCH /wallet/engagements/:engagementId/expense-markup  markup % on budget row
 *   GET  /wallet/expenses/export                       client-ready CSV / PDF (redacted)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import PDFDocument from "pdfkit";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db,
  atelierUsers,
  atelierAuditEvents,
  atelierExpenses,
  atelierExpenseGlMappings,
  atelierBankSignatories,
  atelierBankAccount,
  atelierEngagements,
  atelierEngagementBudget,
  atelierAccounts,
  atelierLegalEntities,
} from "@workspace/db";
import { isFoundingPartner } from "./personaRoles";
import {
  loadTaxonomy,
  resolveCategoryPair,
  COST_CENTERS,
  FUNDING_SOURCES,
} from "../../lib/atelier-expense-taxonomy.js";
import { suggestCategory } from "../../lib/atelier-expense-categorizer.js";
import { ObjectStorageService, ObjectNotFoundError } from "../../lib/objectStorage.js";

const router: IRouter = Router();
type Me = typeof atelierUsers.$inferSelect;

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

function isFinanceLeadership(me: Me): boolean {
  return me.role === "founding_partner" || me.role === "partner" || me.role === "finance";
}

async function audit(args: {
  entityType: string;
  entityId: string;
  actor: Me;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<void> {
  await db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ─────────────────────── taxonomy read ───────────────────────
// @cli-skip: reference data read; UI dropdown source (Task #383)
router.get("/wallet/expense-taxonomy", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await loadTaxonomy();
  const categories = rows
    .filter((r) => !r.parentCode)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((cat) => ({
      code: cat.code,
      label: cat.label,
      description: cat.description,
      subCategories: rows
        .filter((r) => r.parentCode === cat.code)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({
          code: s.code,
          label: s.label,
          description: s.description,
          policyKey: s.policyKey ?? s.legacyKeys[0] ?? "other",
        })),
    }));
  // Legal entities (id + name only) so any submitter can attribute internal
  // spend without needing the finance-scoped entity register.
  const entRows = await db
    .select({
      id: atelierLegalEntities.id,
      legalNameEn: atelierLegalEntities.legalNameEn,
      shortName: atelierLegalEntities.shortName,
    })
    .from(atelierLegalEntities)
    .where(and(eq(atelierLegalEntities.orgId, me.orgId), isNull(atelierLegalEntities.archivedAt)));
  const ents = entRows.map((e) => ({ id: e.id, name: e.shortName || e.legalNameEn }));
  // Active company bank accounts (id + display label only) so any submitter
  // can pick the paying account for company_account spend.
  const bankRows = await db
    .select({
      id: atelierBankAccount.id,
      bankName: atelierBankAccount.bankName,
      accountLabel: atelierBankAccount.accountLabel,
      last4: atelierBankAccount.accountNumberLast4,
      currency: atelierBankAccount.currency,
    })
    .from(atelierBankAccount)
    .where(
      and(
        eq(atelierBankAccount.orgId, me.orgId),
        eq(atelierBankAccount.isActive, true),
        isNull(atelierBankAccount.deletedAt),
      ),
    );
  const bankAccounts = bankRows.map((b) => ({
    id: b.id,
    label: `${b.bankName} · ${b.accountLabel} ····${b.last4} (${b.currency})`,
  }));
  res.json({
    categories,
    costCenters: COST_CENTERS,
    fundingSources: FUNDING_SOURCES,
    entities: ents,
    bankAccounts,
  });
});

// ─────────────────────── AI/memory suggestion ───────────────────────
// Separate endpoint so expense create/patch NEVER blocks on a model call.
// Fail-loud: when the AI errors we return aiError, never a silent guess.
// @cli-skip: interactive UI helper; no CLI shape (Task #383)
router.post("/wallet/expense-categorize/suggest", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const b = (req.body ?? {}) as {
    merchant?: string;
    description?: string;
    ocrText?: string;
    amount?: number;
    currency?: string;
    contextType?: string;
  };
  if (!b.merchant && !b.description && !b.ocrText) {
    res.status(400).json({ error: "invalid-body", message: "Provide merchant, description, or ocrText." });
    return;
  }
  const { suggestion, aiError } = await suggestCategory({
    merchant: b.merchant ?? null,
    description: b.description ?? null,
    ocrText: b.ocrText ?? null,
    amount: typeof b.amount === "number" ? b.amount : null,
    currency: b.currency ?? null,
    contextType: b.contextType ?? null,
    orgId: me.orgId,
  });
  res.json({ suggestion, aiError });
});

// ─────────────────────── GL / VAT mappings ───────────────────────
const VAT_TREATMENTS = new Set(["recoverable", "non_recoverable", "zero_rated", "out_of_scope"]);

// @cli-skip: accountant config read; UI-only (Task #383)
router.get("/wallet/expense-gl-mappings/:entityId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "finance/partner only" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierExpenseGlMappings)
    .where(
      and(
        eq(atelierExpenseGlMappings.orgId, me.orgId),
        eq(atelierExpenseGlMappings.entityId, req.params.entityId),
        isNull(atelierExpenseGlMappings.deletedAt),
      ),
    );
  res.json({
    mappings: rows.map((r) => ({
      id: r.id,
      entityId: r.entityId,
      subCategoryCode: r.subCategoryCode,
      glCode: r.glCode,
      vatTreatment: r.vatTreatment,
      notes: r.notes,
    })),
  });
});

// Replace-set semantics (like the signing-entity registry): the payload is
// the full mapping list for the entity; rows absent from it are soft-deleted.
// @cli-skip: accountant config write; UI-only (Task #383)
router.put("/wallet/expense-gl-mappings/:entityId", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "finance/partner only" });
    return;
  }
  const entityId = req.params.entityId;
  const body = (req.body ?? {}) as { mappings?: unknown };
  if (!Array.isArray(body.mappings)) {
    res.status(400).json({ error: "invalid-body", message: "mappings array required" });
    return;
  }
  const tax = await loadTaxonomy();
  const subCodes = new Set(tax.filter((r) => r.parentCode).map((r) => r.code));
  const seen = new Set<string>();
  const clean: Array<{ subCategoryCode: string; glCode: string; vatTreatment: string; notes: string | null }> = [];
  for (const raw of body.mappings as Array<Record<string, unknown>>) {
    const sub = String(raw?.subCategoryCode ?? "");
    const gl = String(raw?.glCode ?? "").trim();
    const vat = String(raw?.vatTreatment ?? "out_of_scope");
    if (!subCodes.has(sub)) {
      res.status(400).json({ error: "unknown-sub-category", subCategoryCode: sub });
      return;
    }
    if (!gl) {
      res.status(400).json({ error: "missing-gl-code", subCategoryCode: sub });
      return;
    }
    if (!VAT_TREATMENTS.has(vat)) {
      res.status(400).json({ error: "invalid-vat-treatment", vatTreatment: vat });
      return;
    }
    if (seen.has(sub)) {
      res.status(400).json({ error: "duplicate-sub-category", subCategoryCode: sub });
      return;
    }
    seen.add(sub);
    clean.push({
      subCategoryCode: sub,
      glCode: gl.slice(0, 60),
      vatTreatment: vat,
      notes: typeof raw?.notes === "string" ? raw.notes.slice(0, 500) : null,
    });
  }
  const existing = await db
    .select()
    .from(atelierExpenseGlMappings)
    .where(
      and(
        eq(atelierExpenseGlMappings.orgId, me.orgId),
        eq(atelierExpenseGlMappings.entityId, entityId),
        isNull(atelierExpenseGlMappings.deletedAt),
      ),
    );
  const byCode = new Map(existing.map((r) => [r.subCategoryCode, r]));
  const keep = new Set(clean.map((c) => c.subCategoryCode));
  for (const row of existing) {
    if (!keep.has(row.subCategoryCode)) {
      await db
        .update(atelierExpenseGlMappings)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(atelierExpenseGlMappings.id, row.id));
    }
  }
  for (const c of clean) {
    const prev = byCode.get(c.subCategoryCode);
    if (prev) {
      await db
        .update(atelierExpenseGlMappings)
        .set({ glCode: c.glCode, vatTreatment: c.vatTreatment, notes: c.notes, updatedAt: new Date() })
        .where(eq(atelierExpenseGlMappings.id, prev.id));
    } else {
      await db.insert(atelierExpenseGlMappings).values({
        id: rid("glmap"),
        orgId: me.orgId,
        entityId,
        subCategoryCode: c.subCategoryCode,
        glCode: c.glCode,
        vatTreatment: c.vatTreatment,
        notes: c.notes,
        createdByUserId: me.id,
      });
    }
  }
  await audit({
    entityType: "expense_gl_mapping",
    entityId,
    actor: me,
    action: "expense_gl_mapping.replace",
    payload: { entityId, count: clean.length },
    summary: `Replaced GL/VAT mapping set for entity ${entityId} (${clean.length} rows).`,
  });
  res.json({ ok: true, count: clean.length });
});

// ─────────────────────── bank signatory register ───────────────────────
const AUTHORITIES = new Set(["sole", "joint", "view_only"]);

// @cli-skip: entity-register read; UI-only (Task #383)
router.get("/wallet/bank/accounts/:accountId/signatories", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "finance/partner only" });
    return;
  }
  const rows = await db
    .select()
    .from(atelierBankSignatories)
    .where(
      and(
        eq(atelierBankSignatories.orgId, me.orgId),
        eq(atelierBankSignatories.bankAccountId, req.params.accountId),
        isNull(atelierBankSignatories.deletedAt),
      ),
    );
  res.json({
    signatories: rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      personName: r.personName,
      authority: r.authority,
      monetaryLimitAmount: r.monetaryLimitAmount,
      limitCurrency: r.limitCurrency,
      geography: r.geography,
      effectiveFrom: r.effectiveFrom,
      expiresOn: r.expiresOn,
      notes: r.notes,
    })),
  });
});

// Replace-set; FOUNDING PARTNER only (bank mandate authority is a
// founder-level decision, stricter than the general entity registry).
// @cli-skip: entity-register write; UI-only (Task #383)
router.put("/wallet/bank/accounts/:accountId/signatories", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFoundingPartner(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Only founding partners can edit bank signatories." });
    return;
  }
  const accountId = req.params.accountId;
  const [acct] = await db
    .select()
    .from(atelierBankAccount)
    .where(
      and(
        eq(atelierBankAccount.id, accountId),
        eq(atelierBankAccount.orgId, me.orgId),
        isNull(atelierBankAccount.deletedAt),
      ),
    );
  if (!acct) {
    res.status(404).json({ error: "bank-account-not-found" });
    return;
  }
  const body = (req.body ?? {}) as { signatories?: unknown };
  if (!Array.isArray(body.signatories)) {
    res.status(400).json({ error: "invalid-body", message: "signatories array required" });
    return;
  }
  const clean: Array<{
    userId: string;
    personName: string;
    authority: string;
    monetaryLimitAmount: number | null;
    limitCurrency: string | null;
    geography: string | null;
    effectiveFrom: string | null;
    expiresOn: string | null;
    notes: string | null;
  }> = [];
  for (const raw of body.signatories as Array<Record<string, unknown>>) {
    const userId = String(raw?.userId ?? "");
    const authority = String(raw?.authority ?? "view_only");
    if (!userId) {
      res.status(400).json({ error: "missing-user-id" });
      return;
    }
    if (!AUTHORITIES.has(authority)) {
      res.status(400).json({ error: "invalid-authority", authority });
      return;
    }
    const [u] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, userId));
    if (!u || u.orgId !== me.orgId) {
      res.status(400).json({ error: "unknown-user", userId });
      return;
    }
    clean.push({
      userId,
      personName: typeof raw?.personName === "string" && raw.personName ? raw.personName.slice(0, 200) : u.name,
      authority,
      monetaryLimitAmount:
        typeof raw?.monetaryLimitAmount === "number" && raw.monetaryLimitAmount >= 0
          ? raw.monetaryLimitAmount
          : null,
      limitCurrency: typeof raw?.limitCurrency === "string" ? raw.limitCurrency.toUpperCase().slice(0, 3) : null,
      geography: typeof raw?.geography === "string" ? raw.geography.slice(0, 100) : null,
      effectiveFrom: typeof raw?.effectiveFrom === "string" ? raw.effectiveFrom.slice(0, 10) : null,
      expiresOn: typeof raw?.expiresOn === "string" ? raw.expiresOn.slice(0, 10) : null,
      notes: typeof raw?.notes === "string" ? raw.notes.slice(0, 500) : null,
    });
  }
  // Soft-delete the current register, insert the replacement set.
  await db
    .update(atelierBankSignatories)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(atelierBankSignatories.orgId, me.orgId),
        eq(atelierBankSignatories.bankAccountId, accountId),
        isNull(atelierBankSignatories.deletedAt),
      ),
    );
  for (const s of clean) {
    await db.insert(atelierBankSignatories).values({
      id: rid("banksig"),
      orgId: me.orgId,
      bankAccountId: accountId,
      ...s,
      createdByUserId: me.id,
    });
  }
  await audit({
    entityType: "bank_account",
    entityId: accountId,
    actor: me,
    action: "bank_signatories.replace",
    payload: { count: clean.length, users: clean.map((s) => s.userId) },
    summary: `Replaced signatory register on ${acct.accountLabel} (${clean.length} signatories).`,
  });
  res.json({ ok: true, count: clean.length });
});

// ─────────────────────── engagement expense markup ───────────────────────
// @cli-skip: finance config write; UI-only (Task #383)
router.patch("/wallet/engagements/:engagementId/expense-markup", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me)) {
    res.status(403).json({ error: "forbidden", message: "finance/partner only" });
    return;
  }
  const engagementId = req.params.engagementId;
  const pct = Number((req.body ?? {}).expenseMarkupPct);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
    res.status(400).json({ error: "invalid-markup", message: "expenseMarkupPct must be 0–100." });
    return;
  }
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, engagementId),
        eq(atelierEngagements.orgId, me.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!eng) {
    res.status(404).json({ error: "engagement-not-found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierEngagementBudget)
    .where(eq(atelierEngagementBudget.engagementId, engagementId));
  if (existing) {
    await db
      .update(atelierEngagementBudget)
      .set({ expenseMarkupPct: pct, updatedAt: new Date() })
      .where(eq(atelierEngagementBudget.engagementId, engagementId));
  } else {
    await db.insert(atelierEngagementBudget).values({
      engagementId,
      orgId: me.orgId,
      expenseMarkupPct: pct,
      engagementLeadId: eng.engagementLeadId ?? "",
    });
  }
  await audit({
    entityType: "engagement",
    entityId: engagementId,
    actor: me,
    action: "engagement.expense_markup.set",
    payload: { expenseMarkupPct: pct },
    summary: `Set expense markup ${pct}% on engagement ${eng.name}.`,
  });
  res.json({ ok: true, expenseMarkupPct: pct });
});

// ─────────────────────── client-ready export ───────────────────────
interface ExportRow {
  refNo: number;
  date: string;
  merchant: string;
  categoryLabel: string;
  subCategoryLabel: string;
  description: string;
  currency: string;
  amount: number;
  usdNet: number;
  markupPct: number;
  usdBilled: number;
  receiptFileRef: string | null;
}

async function buildExportRows(me: Me, q: Record<string, unknown>): Promise<{
  rows: ExportRow[];
  engagementName: string | null;
  accountName: string | null;
  markupDefaultPct: number;
} | { error: string; status: number }> {
  const engagementId = typeof q.engagementId === "string" && q.engagementId ? q.engagementId : null;
  const from = typeof q.from === "string" && q.from ? q.from.slice(0, 10) : null;
  const to = typeof q.to === "string" && q.to ? q.to.slice(0, 10) : null;
  if (!engagementId) return { error: "engagementId-required", status: 400 };
  const [eng] = await db
    .select()
    .from(atelierEngagements)
    .where(
      and(
        eq(atelierEngagements.id, engagementId),
        eq(atelierEngagements.orgId, me.orgId),
        isNull(atelierEngagements.deletedAt),
      ),
    );
  if (!eng) return { error: "engagement-not-found", status: 404 };
  let accountName: string | null = null;
  if (eng.accountId) {
    const [acc] = await db.select().from(atelierAccounts).where(eq(atelierAccounts.id, eng.accountId));
    accountName = acc?.name ?? null;
  }
  const [budget] = await db
    .select()
    .from(atelierEngagementBudget)
    .where(eq(atelierEngagementBudget.engagementId, engagementId));
  const markupDefaultPct = budget?.expenseMarkupPct ?? 0;
  const tax = await loadTaxonomy();
  const labelOf = (code: string | null): string => tax.find((t) => t.code === code)?.label ?? "";
  const expenses = await db
    .select()
    .from(atelierExpenses)
    .where(
      and(
        eq(atelierExpenses.engagementId, engagementId),
        eq(atelierExpenses.orgId, me.orgId),
        eq(atelierExpenses.clientBillable, true),
        inArray(atelierExpenses.status, ["approved", "reimbursed"]),
        isNull(atelierExpenses.deletedAt),
      ),
    )
    .orderBy(desc(atelierExpenses.expenseDate));
  const rows: ExportRow[] = [];
  for (const ex of expenses) {
    if (from && ex.expenseDate < from) continue;
    if (to && ex.expenseDate > to) continue;
    const markupPct = ex.markupPct ?? markupDefaultPct;
    const usdNet = +ex.usdAmount.toFixed(2);
    rows.push({
      refNo: rows.length + 1,
      receiptFileRef: ex.receiptFileRef ?? null,
      date: ex.expenseDate,
      merchant: ex.merchant ?? "—",
      categoryLabel: labelOf(ex.categoryCode) || ex.category,
      subCategoryLabel: labelOf(ex.subCategoryCode),
      // Client-ready = REDACTED: description only (no claimant identity,
      // no policy findings, no receipts, no internal audit notes).
      description: (ex.description ?? "").slice(0, 300),
      currency: ex.currency,
      amount: ex.amount,
      usdNet,
      markupPct,
      usdBilled: +(usdNet * (1 + markupPct / 100)).toFixed(2),
    });
  }
  return { rows, engagementName: eng.name, accountName, markupDefaultPct };
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

// @cli-skip: file download; no CLI shape (Task #383)
router.get("/wallet/expenses/export", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!isFinanceLeadership(me) && me.role !== "senior_manager") {
    res.status(403).json({ error: "forbidden", message: "finance/partner/engagement-lead only" });
    return;
  }
  const built = await buildExportRows(me, req.query as Record<string, unknown>);
  if ("error" in built) {
    res.status(built.status).json({ error: built.error });
    return;
  }
  // senior_manager must actually lead the engagement.
  if (!isFinanceLeadership(me)) {
    const [eng] = await db
      .select()
      .from(atelierEngagements)
      .where(
        and(
          eq(atelierEngagements.id, String(req.query.engagementId)),
          eq(atelierEngagements.orgId, me.orgId),
        ),
      );
    if (!eng || eng.engagementLeadId !== me.id) {
      res.status(403).json({ error: "not-your-engagement" });
      return;
    }
  }
  const { rows, engagementName, accountName } = built;
  const format = req.query.format === "pdf" ? "pdf" : "csv";
  const total = rows.reduce((s, r) => s + r.usdBilled, 0);
  await audit({
    entityType: "expense",
    entityId: String(req.query.engagementId),
    actor: me,
    action: "expense.export",
    payload: { format, rowCount: rows.length, totalUsd: +total.toFixed(2) },
    summary: `Exported ${rows.length} client-ready expense line(s) (${format.toUpperCase()}) for ${engagementName}.`,
  });
  if (format === "csv") {
    const header = "Ref,Date,Merchant,Category,Sub-category,Description,Currency,Amount,USD Net,Markup %,USD Billed,Receipt";
    const lines = rows.map((r) =>
      [
        String(r.refNo),
        r.date,
        csvEscape(r.merchant),
        csvEscape(r.categoryLabel),
        csvEscape(r.subCategoryLabel),
        csvEscape(r.description),
        r.currency,
        r.amount.toFixed(2),
        r.usdNet.toFixed(2),
        r.markupPct.toFixed(1),
        r.usdBilled.toFixed(2),
        r.receiptFileRef ? `Receipt ${r.refNo}` : "—",
      ].join(","),
    );
    const csv = [header, ...lines, `,,,,,,,,TOTAL,,${total.toFixed(2)},`].join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="expenses-${req.query.engagementId}.csv"`);
    res.send(csv);
    return;
  }
  // PDF
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="expenses-${req.query.engagementId}.pdf"`);
  const doc = new PDFDocument({ size: "A4", margin: 48 });
  doc.pipe(res);
  doc.fontSize(16).text("Reimbursable Expenses", { continued: false });
  doc.moveDown(0.3);
  doc.fontSize(10).fillColor("#555");
  if (accountName) doc.text(`Client: ${accountName}`);
  doc.text(`Engagement: ${engagementName}`);
  doc.text(`Generated: ${new Date().toISOString().slice(0, 10)}`);
  doc.moveDown(0.8);
  doc.fillColor("#000");
  const cols = [
    { key: "refNo", label: "Ref", w: 24 },
    { key: "date", label: "Date", w: 55 },
    { key: "merchant", label: "Merchant", w: 90 },
    { key: "subCategoryLabel", label: "Category", w: 90 },
    { key: "description", label: "Description", w: 120 },
    { key: "usdNet", label: "Net (USD)", w: 55 },
    { key: "usdBilled", label: "Billed (USD)", w: 60 },
  ] as const;
  let y = doc.y;
  let x = 48;
  doc.fontSize(8).font("Helvetica-Bold");
  for (const c of cols) {
    doc.text(c.label, x, y, { width: c.w });
    x += c.w + 4;
  }
  doc.font("Helvetica");
  y += 14;
  for (const r of rows) {
    if (y > 780) {
      doc.addPage();
      y = 48;
    }
    x = 48;
    for (const c of cols) {
      const raw = r[c.key];
      const txt =
        c.key === "refNo" ? String(r.refNo) : typeof raw === "number" ? raw.toFixed(2) : String(raw);
      doc.text(txt.slice(0, 60), x, y, { width: c.w });
      x += c.w + 4;
    }
    y += 14;
  }
  y += 8;
  doc.font("Helvetica-Bold").fontSize(9).text(`Total billed: $${total.toFixed(2)}`, 48, y);

  // Numbered receipt appendix: one page per receipt, matching the Ref column.
  // Image receipts (JPEG/PNG) are embedded; other formats (e.g. PDF receipts)
  // get a reference page noting the receipt is held on file.
  const withReceipts = rows.filter((r) => r.receiptFileRef);
  if (withReceipts.length > 0) {
    const svc = new ObjectStorageService();
    doc.addPage();
    doc.font("Helvetica-Bold").fontSize(14).text("Receipt Appendix", 48, 48);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555")
      .text(
        `${withReceipts.length} receipt(s), numbered to match the Ref column of the expense table.`,
        48,
        doc.y + 4,
      );
    doc.fillColor("#000");
    for (const r of withReceipts) {
      doc.addPage();
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(`Receipt ${r.refNo} — ${r.merchant} · ${r.date} · $${r.usdNet.toFixed(2)}`, 48, 48);
      doc.font("Helvetica").fontSize(9);
      let embedded = false;
      if (r.receiptFileRef && r.receiptFileRef.startsWith("/objects/")) {
        try {
          const file = await svc.getObjectEntityFile(r.receiptFileRef);
          const dl = await svc.downloadObject(file, 60);
          const mediaType = (dl.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
          if (mediaType === "image/jpeg" || mediaType === "image/png") {
            const bytes = Buffer.from(await dl.arrayBuffer());
            doc.image(bytes, 48, 80, { fit: [500, 680], align: "center" });
            embedded = true;
          }
        } catch (err) {
          if (!(err instanceof ObjectNotFoundError)) {
            req.log?.warn?.({ err, refNo: r.refNo }, "receipt appendix embed failed");
          }
        }
      }
      if (!embedded) {
        doc
          .fillColor("#555")
          .text(
            "Receipt document is held on file in a non-embeddable format and is available on request.",
            48,
            84,
          )
          .fillColor("#000");
      }
    }
  }
  doc.end();
});

export default router;
