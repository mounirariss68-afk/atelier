/**
 * Task #1412 — explicit, read-only finance/procurement relationships.
 *
 * This is intentionally an adapter over the authoritative registries.  It
 * does not resolve names into identities and never treats an account as a
 * supplier (or a supplier as a legal entity).
 */
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or } from "drizzle-orm";
import {
  db,
  atelierAccounts,
  atelierBankAccount,
  atelierPartnerFirmBankChangeRequests,
  atelierPartnerFirmInvoices,
  atelierPartnerFirms,
  atelierLegalEntities,
} from "@workspace/db";
import { CATALOG_SCHEMA_VERSION, defineCapability } from "./capability-catalog.js";
import { accessibleEngagementIds } from "../../routes/atelier/engagementRoutes.js";
import { canSeeAccount } from "../../routes/atelier/accountRoutes.js";
import type { ToolResult } from "./index.js";
import type { ToolContext } from "./index.js";

const LIMIT = 8;
const SCAN_LIMIT = 32;
const FINANCE_ROLES: Array<"founding_partner" | "partner" | "finance"> = [
  "founding_partner",
  "partner",
  "finance",
];
const SENSITIVE_ROLES = new Set<string>(FINANCE_ROLES);
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const sensitive = (ctx: ToolContext) => SENSITIVE_ROLES.has(ctx.persona.role);

function forbidden(): ToolResult {
  return { ok: false, errorCode: "forbidden", errorMessage: "Finance and supplier records require finance leadership access." };
}
function maskIban(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  return normalized.length >= 4 ? `····${normalized.slice(-4)}` : "····";
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

defineCapability({
  id: "finance.procurement_relationships",
  schemaVersion: CATALOG_SCHEMA_VERSION,
  module: "finance",
  toolName: "finance_procurement_relationships",
  description: "Read explicit, source-backed relationships between CRM account procurement, partner firms, supplier invoices, and legal-entity bank accounts without inferring identity or payment authority.",
  slashAliases: { en: ["/procurement-relationships", "/supplier-records"] },
  representativePrompts: { en: ["Show the procurement record for this account.", "Which invoices and approved bank details are explicitly linked to this supplier?"] },
  inputSchema: {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["account_procurement", "partner_firm", "supplier_invoice", "entity_bank_account"] },
      id: { type: "string" },
      query: { type: "string" },
    },
    required: ["kind"],
    additionalProperties: false,
  },
  isWrite: false,
  irreversible: false,
  requiredRoles: FINANCE_ROLES,
  twoPhaseConfirm: false,
  outboundChannel: null,
  resultCard: "ranked_list",
  surfaceOn: ["global", "account_workspace", "ledger"],
  async run(input, ctx): Promise<ToolResult> {
    // Catalog visibility is not an authorization boundary.
    if (!sensitive(ctx)) return forbidden();
    const kind = text(input.kind);
    const id = text(input.id);
    const query = text(input.query);
    if (!kind || !["account_procurement", "partner_firm", "supplier_invoice", "entity_bank_account"].includes(kind)) {
      return { ok: false, errorCode: "invalid_kind", errorMessage: "Unsupported finance relationship kind." };
    }

    if (kind === "account_procurement") {
      // Account visibility is row-specific. Require the canonical id so the
      // ACL is evaluated before any discovery limit; name search remains on
      // the existing ACL-first account.procurement capability.
      if (!id) {
        return {
          ok: false,
          errorCode: "invalid_input",
          errorMessage: "account_procurement requires the canonical account id.",
        };
      }
      const access = await accessibleEngagementIds({ id: ctx.persona.id, role: ctx.persona.role } as never);
      const base = and(eq(atelierAccounts.orgId, ctx.persona.orgId), isNull(atelierAccounts.deletedAt), ne(atelierAccounts.status, "archived"));
      const rows = await db.select().from(atelierAccounts)
        .where(and(base, eq(atelierAccounts.id, id)))
        .limit(1);
      const visible = [];
      for (const row of rows) {
        if (!(await canSeeAccount(access, ctx.persona, row.id))) continue;
        visible.push({
          kind,
          id: row.id,
          accountName: row.name,
          procurement: row.procurement ?? null,
          source: "atelier_accounts.procurement",
          sourceUpdatedAt: iso(row.updatedAt),
        });
        if (visible.length >= LIMIT) break;
      }
      return { ok: true, data: { shape: "finance_procurement_relationships", kind, relationships: visible, bounded: { limit: LIMIT, maxHops: 1 } } };
    }

    if (kind === "partner_firm") {
      const base = and(
        eq(atelierPartnerFirms.orgId, ctx.persona.orgId),
        isNull(atelierPartnerFirms.deletedAt),
        // Terminal suppliers retain history (including the last approved
        // bank) but are not current payable counterparties.
        inArray(atelierPartnerFirms.status, ["active", "renewal_due", "paused"]),
      );
      const where = id ? and(base, eq(atelierPartnerFirms.id, id)) :
        query ? and(base, ilike(atelierPartnerFirms.name, `%${query}%`)) : base;
      const firms = await db.select().from(atelierPartnerFirms).where(where).orderBy(asc(atelierPartnerFirms.id)).limit(SCAN_LIMIT);
      const relationships = [];
      for (const firm of firms) {
        const invoices = await db.select({
          id: atelierPartnerFirmInvoices.id, legalEntityId: atelierPartnerFirmInvoices.legalEntityId,
          engagementId: atelierPartnerFirmInvoices.engagementId, status: atelierPartnerFirmInvoices.status,
          reference: atelierPartnerFirmInvoices.reference, updatedAt: atelierPartnerFirmInvoices.updatedAt,
        }).from(atelierPartnerFirmInvoices).where(and(eq(atelierPartnerFirmInvoices.orgId, ctx.persona.orgId), eq(atelierPartnerFirmInvoices.partnerFirmId, firm.id), isNull(atelierPartnerFirmInvoices.deletedAt))).orderBy(asc(atelierPartnerFirmInvoices.id)).limit(LIMIT);
        const changes = await db.select({
          id: atelierPartnerFirmBankChangeRequests.id, status: atelierPartnerFirmBankChangeRequests.status,
          createdAt: atelierPartnerFirmBankChangeRequests.createdAt, decidedAt: atelierPartnerFirmBankChangeRequests.decidedAt,
        }).from(atelierPartnerFirmBankChangeRequests).where(and(eq(atelierPartnerFirmBankChangeRequests.orgId, ctx.persona.orgId), eq(atelierPartnerFirmBankChangeRequests.partnerFirmId, firm.id), isNull(atelierPartnerFirmBankChangeRequests.deletedAt))).orderBy(desc(atelierPartnerFirmBankChangeRequests.createdAt), desc(atelierPartnerFirmBankChangeRequests.id)).limit(LIMIT);
        relationships.push({
          kind, id: firm.id, name: firm.name,
          approvedBank: firm.bankIban ? { ibanMasked: maskIban(firm.bankIban), currency: firm.bankCurrency, status: "approved", source: "atelier_partner_firms" } : null,
          invoices: invoices.map((invoice) => ({ ...invoice, updatedAt: iso(invoice.updatedAt), relationship: { partnerFirmId: firm.id, legalEntityId: invoice.legalEntityId, engagementId: invoice.engagementId } })),
          bankChangeHistory: changes.map((change) => ({ ...change, createdAt: iso(change.createdAt), decidedAt: iso(change.decidedAt) })),
          source: "atelier_partner_firms",
        });
        if (relationships.length >= LIMIT) break;
      }
      return { ok: true, data: { shape: "finance_procurement_relationships", kind, relationships, bounded: { limit: LIMIT, maxHops: 1 } } };
    }

    if (kind === "supplier_invoice") {
      const base = and(eq(atelierPartnerFirmInvoices.orgId, ctx.persona.orgId), isNull(atelierPartnerFirmInvoices.deletedAt));
      const where = id ? and(base, eq(atelierPartnerFirmInvoices.id, id)) :
        query ? and(base, or(ilike(atelierPartnerFirmInvoices.partnerFirmName, `%${query}%`), ilike(atelierPartnerFirmInvoices.reference, `%${query}%`))) : base;
      const rows = await db.select().from(atelierPartnerFirmInvoices).where(where).orderBy(asc(atelierPartnerFirmInvoices.id)).limit(LIMIT);
      return { ok: true, data: { shape: "finance_procurement_relationships", kind, relationships: rows.map((row) => ({
        id: row.id, supplierName: row.partnerFirmName, partnerFirmId: row.partnerFirmId || null,
        legalEntityId: row.legalEntityId, engagementId: row.engagementId, reference: row.reference,
        status: row.status, sourceType: row.source,
        supplierBankIbanMasked: row.partnerFirmId ? null : maskIban(row.supplierBankIban),
        bankAuthority: row.partnerFirmId ? "partner_firm_registry" : "invoice_local_one_off",
        amount: row.costAmount, currency: row.costCurrency,
        source: "atelier_partner_firm_invoices", sourceUpdatedAt: iso(row.updatedAt),
      })), bounded: { limit: LIMIT, maxHops: 1 } } };
    }

    const base = and(eq(atelierBankAccount.orgId, ctx.persona.orgId), isNull(atelierBankAccount.deletedAt), eq(atelierBankAccount.isActive, true));
    const where = id ? and(base, eq(atelierBankAccount.id, id)) : query ? and(base, ilike(atelierBankAccount.accountLabel, `%${query}%`)) : base;
    const rows = await db.select({
      bank: atelierBankAccount,
      legalEntityName: atelierLegalEntities.legalNameEn,
      legalEntityStatus: atelierLegalEntities.status,
    }).from(atelierBankAccount)
      .innerJoin(atelierLegalEntities, and(
        eq(atelierLegalEntities.id, atelierBankAccount.legalEntityId),
        eq(atelierLegalEntities.orgId, ctx.persona.orgId),
        ne(atelierLegalEntities.status, "archived"),
      ))
      .where(where)
      .orderBy(asc(atelierBankAccount.id))
      .limit(LIMIT);
    const relationships = rows.map(({ bank: row, legalEntityName, legalEntityStatus }) => ({
      kind,
      id: row.id,
      legalEntityId: row.legalEntityId,
      legalEntityName,
      legalEntityStatus,
      accountLabel: row.accountLabel,
      bankName: row.bankName,
      currency: row.currency,
      ibanMasked: maskIban(row.iban),
      status: "active",
      source: "atelier_bank_account",
      sourceUpdatedAt: iso(row.updatedAt),
    }));
    return { ok: true, data: { shape: "finance_procurement_relationships", kind, relationships, bounded: { limit: LIMIT, maxHops: 1 } } };
  },
});