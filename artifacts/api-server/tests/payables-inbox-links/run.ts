/**
 * Task #1103 — payables "Needs your action" deep-link routing probe.
 *
 * Guards the source-specific inbox routing: the unified approvals inbox
 * aggregates BOTH partner-submitted and internally-uploaded AP invoices
 * as kind "supplier_invoice", but each must deep-link to the page that
 * actually lists it:
 *   - source "partner_submitted"  → /finance/payables/partner-invoices?focus=<id>
 *   - source "internal_upload"    → /finance/payables/supplier-invoices?focus=<id>
 * (Both pages support ?focus= deep links; the supplier-invoices list API
 * returns only internal uploads, so a partner-submitted href pointing at
 * it would open a list where the item is absent.)
 *
 * Run: pnpm --filter @workspace/api-server run test:payables-inbox-links
 */

// DB isolation bootstrap — MUST be the first import.
import "../crm/scratch-db.js";

import { inArray } from "drizzle-orm";

const STAMP = Date.now();
const ORG = "aico";
const FIN_ID = `p_test_pil_fin_${STAMP}`;
const PARTNER_INV = `pfi_test_pil_partner_${STAMP}`;
const INTERNAL_INV = `pfi_test_pil_internal_${STAMP}`;

const failures: string[] = [];
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  \u2713 ${name}`);
  else {
    failures.push(name);
    console.error(`  \u2717 ${name}${detail ? ` \u2014 ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  // Dynamic imports AFTER the scratch-db bootstrap has repointed DATABASE_URL.
  const { db, atelierUsers, atelierPartnerFirmInvoices } = await import("@workspace/db");
  const { loadFinanceApprovalsInbox } = await import("../../src/routes/atelier/financeAutopilotRoutes.js");
  try {
    await db.insert(atelierUsers).values({
      id: FIN_ID,
      orgId: ORG,
      email: `pil.${STAMP}@cognirise.ai`,
      name: "Probe Finance",
      initials: "PF",
      role: "finance",
      roleLabel: "Finance",
      title: "Finance",
      permissions: [],
    });
    await db.insert(atelierPartnerFirmInvoices).values([
      {
        id: PARTNER_INV,
        orgId: ORG,
        partnerFirmId: `pf_test_pil_${STAMP}`,
        partnerFirmName: "Probe Partner Firm",
        weekIso: "2026-W30",
        costAmount: 1200,
        costCurrency: "USD",
        usdAmount: 1200,
        status: "submitted",
        source: "partner_submitted",
        reference: `PIL-P-${STAMP}`,
        submittedAt: new Date(),
      },
      {
        id: INTERNAL_INV,
        orgId: ORG,
        partnerFirmId: `pf_test_pil_${STAMP}`,
        partnerFirmName: "Probe Supplier Ltd",
        weekIso: "2026-W30",
        costAmount: 900,
        costCurrency: "USD",
        usdAmount: 900,
        status: "submitted",
        source: "internal_upload",
        reference: `PIL-I-${STAMP}`,
        submittedAt: new Date(),
      },
    ]);

    const me = (await db.select().from(atelierUsers).where(inArray(atelierUsers.id, [FIN_ID])))[0];
    const inbox = await loadFinanceApprovalsInbox(me as never);

    const partnerItem = inbox.items.find((i) => i.id === PARTNER_INV);
    const internalItem = inbox.items.find((i) => i.id === INTERNAL_INV);

    check("partner-submitted invoice appears in the inbox", !!partnerItem);
    check("internally-uploaded invoice appears in the inbox", !!internalItem);
    check(
      "partner-submitted item deep-links to the partner-invoices page",
      partnerItem?.href === `/finance/payables/partner-invoices?focus=${encodeURIComponent(PARTNER_INV)}`,
      partnerItem?.href,
    );
    check(
      "internal upload deep-links to the supplier-invoices page",
      internalItem?.href === `/finance/payables/supplier-invoices?focus=${encodeURIComponent(INTERNAL_INV)}`,
      internalItem?.href,
    );
    check("both keep kind supplier_invoice (panel filter contract)",
      partnerItem?.kind === "supplier_invoice" && internalItem?.kind === "supplier_invoice");
    check("partner-submitted item titled as a partner invoice",
      !!partnerItem && partnerItem.title.startsWith("Partner invoice"),
      partnerItem?.title);
  } finally {
    await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, [PARTNER_INV, INTERNAL_INV]));
    await db.delete(atelierUsers).where(inArray(atelierUsers.id, [FIN_ID]));
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} check(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll payables inbox deep-link checks passed.");
  process.exit(0);
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
