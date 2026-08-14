/**
 * Task #1091 — supplier-invoice AUTO-POST integration probe.
 *
 * Unlike the pure-function policy probe, this drives the REAL production
 * core (`createSupplierInvoiceCore`) so we prove the engine actually flips
 * a persisted state transition:
 *
 *   (a) DEFAULTS: a small (AED<1000), high-confidence, KNOWN-VENDOR parsed
 *       invoice lands `approved` (auto-advanced, "ready to pay").
 *   (b) LOWERED CEILING: the SAME parsed input, with
 *       supplierInvoiceAutoMaxAed dropped below the amount, stays in review
 *       (status "submitted", autoAdvanced=false).
 *   (c) MANUAL UI UPLOAD: via:"ui_upload" (no parse confidences) never
 *       autos — stays "submitted" — even for the same small known vendor.
 *   (d) UNKNOWN VENDOR: a parsed invoice from an unregistered supplier
 *       never autos (money never moves on a guessed entity/vendor).
 *
 * Deterministic: no LLM (we pass confidences directly), FX is seeded/
 * fallback, allocation is forced resolvable via explicitLegalEntityId.
 * Probe-unique org; all rows removed in `finally`.
 *
 * Run: pnpm exec tsx tests/supplier-invoice-autopost/run.ts
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
import "../crm/scratch-db.js";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log(`PASS ${name}`);
  else { failures++; console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail) : ""); }
}

async function main() {
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
  const D = await import("@workspace/db");
  const {
    db, pool, atelierUsers, atelierPartnerFirms, atelierLegalEntities,
    atelierPartnerFirmInvoices, atelierFinanceAutopilotSettings, atelierAuditEvents,
  } = D as any;
  const { and, eq, inArray, like } = await import("drizzle-orm");
  const { createSupplierInvoiceCore } = await import("../../src/routes/atelier/financePayablesRoutes.js");

  const STAMP = Date.now();
  const ORG = `aico_siap_${STAMP}`;
  const FP_ID = `p_siap_fp_${STAMP}`;
  const ENT_ID = `le_siap_${STAMP}`;
  const FIRM_ID = `pfrm_siap_${STAMP}`;
  const FIRM_NAME = `Known Vendor ${STAMP}`;
  const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${tag}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  const createdInvoiceIds: string[] = [];

  // High confidence per required field — clears the default 0.9 floor.
  const CONF = [0.97, 0.95, 0.99, 0.93];

  try {
    // ---- setup: entity, known partner firm (with IBAN → no bank hold), FP.
    await db.insert(atelierLegalEntities).values({
      id: ENT_ID, orgId: ORG, legalNameEn: `SIAP Entity ${STAMP}`,
      shortName: "SIAP Ent", country: "AE", status: "active", isHeadEntity: true,
    });
    await db.insert(atelierPartnerFirms).values({
      id: FIRM_ID, orgId: ORG, name: FIRM_NAME, status: "active",
      partnershipStage: "agreed", agreementStage: "signed",
      bankIban: "AE070331234567890123456", createdByUserId: FP_ID,
    });
    await db.insert(atelierUsers).values({
      id: FP_ID, orgId: ORG, email: `${FP_ID}@example.com`, name: "SIAP FP",
      initials: "SF", role: "founding_partner", roleLabel: "FP", title: "FP",
      permissions: [], bdActive: false,
    }).onConflictDoNothing();
    const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, FP_ID));

    // Common args for the KNOWN-VENDOR parsed path. explicitLegalEntityId
    // forces a resolvable ("proposed") allocation so auto-advance isn't
    // blocked on entity selection.
    const parsedArgs = (ref: string, amount: number, currency: string, tag: string) => ({
      me, fileBuffer: PDF(tag), fileName: `${tag}.pdf`,
      supplierName: FIRM_NAME, amount, currency, reference: ref,
      periodLabel: null, invoiceDate: null, notes: null,
      partnerFirmId: FIRM_ID, explicitLegalEntityId: ENT_ID,
      via: "parsed_doc" as const, fieldConfidences: CONF,
      agentRunId: null, agentName: "Finance Doc Autopilot",
    });

    // (a) DEFAULTS — small, high-confidence, known vendor → auto-approved.
    {
      const out = await createSupplierInvoiceCore(parsedArgs(`SIAP-A-${STAMP}`, 800, "AED", "siapA"));
      const item = (out.body as any).item;
      if (item?.id) createdInvoiceIds.push(item.id);
      check("(a) defaults: parsed AED 800 known-vendor invoice auto-advances", out.status === 201 && (out.body as any).autoAdvanced === true, out.body);
      check("(a) defaults: persisted status is 'approved' (ready to pay)", item?.status === "approved", item?.status);
    }

    // (b) LOWERED CEILING — same input, ceiling below the amount → review.
    {
      await db.insert(atelierFinanceAutopilotSettings).values({
        id: `fas_${ORG}`, orgId: ORG, journalAutoConfidence: 0.9,
        supplierInvoiceAutoMaxAed: 500, journalAutoMaxAed: 5000,
        updatedByUserId: FP_ID, updatedByName: "SIAP FP",
      }).onConflictDoUpdate({
        target: atelierFinanceAutopilotSettings.orgId,
        set: { supplierInvoiceAutoMaxAed: 500 },
      });
      const out = await createSupplierInvoiceCore(parsedArgs(`SIAP-B-${STAMP}`, 800, "AED", "siapB"));
      const item = (out.body as any).item;
      if (item?.id) createdInvoiceIds.push(item.id);
      check("(b) lowered ceiling (500): same AED 800 input does NOT auto-advance", out.status === 201 && (out.body as any).autoAdvanced === false, out.body);
      check("(b) lowered ceiling: persisted status stays 'submitted' (review)", item?.status === "submitted", item?.status);
      // restore defaults for the remaining cases
      await db.delete(atelierFinanceAutopilotSettings).where(eq(atelierFinanceAutopilotSettings.orgId, ORG));
    }

    // (c) MANUAL UI UPLOAD — no parse confidences → never autos.
    {
      const out = await createSupplierInvoiceCore({
        me, fileBuffer: PDF("siapC"), fileName: "siapC.pdf",
        supplierName: FIRM_NAME, amount: 800, currency: "AED", reference: `SIAP-C-${STAMP}`,
        periodLabel: null, invoiceDate: null, notes: null,
        partnerFirmId: FIRM_ID, explicitLegalEntityId: ENT_ID,
        via: "ui_upload" as const,
      });
      const item = (out.body as any).item;
      if (item?.id) createdInvoiceIds.push(item.id);
      check("(c) ui_upload: no confidences → never auto-advances", out.status === 201 && (out.body as any).autoAdvanced === false, out.body);
      check("(c) ui_upload: persisted status stays 'submitted'", item?.status === "submitted", item?.status);
    }

    // (d) UNKNOWN VENDOR — parsed, high-confidence, but unregistered → review.
    {
      const out = await createSupplierInvoiceCore({
        me, fileBuffer: PDF("siapD"), fileName: "siapD.pdf",
        supplierName: `Random Unregistered ${STAMP}`, amount: 800, currency: "AED",
        reference: `SIAP-D-${STAMP}`, periodLabel: null, invoiceDate: null, notes: null,
        partnerFirmId: null, explicitLegalEntityId: ENT_ID,
        via: "parsed_doc" as const, fieldConfidences: CONF,
        agentRunId: null, agentName: "Finance Doc Autopilot",
      });
      const item = (out.body as any).item;
      if (item?.id) createdInvoiceIds.push(item.id);
      check("(d) unknown vendor: parsed but unregistered → does NOT auto-advance", out.status === 201 && (out.body as any).autoAdvanced === false, out.body);
      check("(d) unknown vendor: persisted status stays 'submitted'", item?.status === "submitted", item?.status);
    }
  } finally {
    try {
      if (createdInvoiceIds.length)
        await db.delete(atelierPartnerFirmInvoices).where(inArray(atelierPartnerFirmInvoices.id, createdInvoiceIds));
      await db.delete(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.orgId, ORG));
      await db.delete(atelierFinanceAutopilotSettings).where(eq(atelierFinanceAutopilotSettings.orgId, ORG));
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, ORG));
      await db.delete(atelierPartnerFirms).where(eq(atelierPartnerFirms.orgId, ORG));
      await db.delete(atelierUsers).where(eq(atelierUsers.orgId, ORG));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.orgId, ORG));
    } catch (e) { console.warn("cleanup warning", e); }
    await pool.end?.();
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
  console.log("\nAll supplier-invoice auto-post checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
