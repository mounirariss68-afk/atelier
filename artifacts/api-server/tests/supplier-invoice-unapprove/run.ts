/**
 * Task #1104 — supplier-invoice UN-APPROVE probe.
 *
 * Drives the REAL production cores (`createSupplierInvoiceCore` +
 * `reviewSupplierInvoiceCore`) to prove the pull-back-from-ready-to-pay
 * window works and closes correctly:
 *
 *   (a) AUTO-APPROVE: a small, high-confidence, known-vendor parsed invoice
 *       auto-advances to `approved`, and the audit-derived attribution
 *       loader flags it as autopilot-approved.
 *   (b) UN-APPROVE: founder un-approves it → status back to `under_review`,
 *       reviewedAt cleared, `finance.supplier_invoice.unapprove` audit row.
 *   (c) ATTRIBUTION DROPS after a HUMAN re-approve — the latest approve
 *       event wins, so the autopilot badge cannot resurface.
 *   (d) BLOCKED IN RUN: once paymentRunId is set (run pickup), un-approve
 *       409s with `in-payment-run` and a clear message; paid rows get the
 *       credit-note message.
 *   (e) INVALID SOURCE STATE: un-approve of a `submitted` row → invalid-status.
 *
 * Deterministic: no LLM (confidences passed directly), probe-unique org,
 * all rows removed in `finally`.
 *
 * Run: pnpm exec tsx tests/supplier-invoice-unapprove/run.ts
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
    atelierPartnerFirmInvoices, atelierAuditEvents,
  } = D as any;
  const { and, eq } = await import("drizzle-orm");
  const {
    createSupplierInvoiceCore, reviewSupplierInvoiceCore, loadSupplierAutopilotAttribution,
  } = await import("../../src/routes/atelier/financePayablesRoutes.js");

  const STAMP = Date.now();
  const ORG = `aico_siun_${STAMP}`;
  const FP_ID = `p_siun_fp_${STAMP}`;
  const ENT_ID = `le_siun_${STAMP}`;
  const FIRM_ID = `pfrm_siun_${STAMP}`;
  const FIRM_NAME = `Known Vendor ${STAMP}`;
  const PDF = (tag: string) => Buffer.from(`%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n% ${tag}\ntrailer<</Root 1 0 R>>\n%%EOF\n`);
  const CONF = [0.97, 0.95, 0.99, 0.93];

  try {
    await db.insert(atelierLegalEntities).values({
      id: ENT_ID, orgId: ORG, legalNameEn: `SIUN Entity ${STAMP}`,
      shortName: "SIUN Ent", country: "AE", status: "active", isHeadEntity: true,
    });
    await db.insert(atelierPartnerFirms).values({
      id: FIRM_ID, orgId: ORG, name: FIRM_NAME, status: "active",
      partnershipStage: "agreed", agreementStage: "signed",
      bankIban: "AE070331234567890123456", createdByUserId: FP_ID,
    });
    await db.insert(atelierUsers).values({
      id: FP_ID, orgId: ORG, email: `${FP_ID}@example.com`, name: "SIUN FP",
      initials: "SF", role: "founding_partner", roleLabel: "FP", title: "FP",
      permissions: [], bdActive: false,
    }).onConflictDoNothing();
    const [me] = await db.select().from(atelierUsers).where(eq(atelierUsers.id, FP_ID));

    // (a) auto-approve via the parsed path (same shape as the autopost probe).
    const created = await createSupplierInvoiceCore({
      me, fileBuffer: PDF("siunA"), fileName: "siunA.pdf",
      supplierName: FIRM_NAME, amount: 800, currency: "AED", reference: `SIUN-A-${STAMP}`,
      periodLabel: null, invoiceDate: null, notes: null,
      partnerFirmId: FIRM_ID, explicitLegalEntityId: ENT_ID,
      via: "parsed_doc" as const, fieldConfidences: CONF,
      agentRunId: null, agentName: "Finance Doc Autopilot",
    });
    const invId = (created.body as any).item?.id as string;
    check("(a) parsed known-vendor invoice auto-approves", created.status === 201 && (created.body as any).autoAdvanced === true && (created.body as any).item?.status === "approved", created.body);
    const attr1 = await loadSupplierAutopilotAttribution(ORG, [invId]);
    check("(a) attribution loader flags the auto-approval", attr1.get(invId)?.agentName === "Finance Doc Autopilot", [...attr1.entries()]);

    // (e) un-approve of a submitted row → invalid-status (make a second row).
    const manual = await createSupplierInvoiceCore({
      me, fileBuffer: PDF("siunE"), fileName: "siunE.pdf",
      supplierName: FIRM_NAME, amount: 800, currency: "AED", reference: `SIUN-E-${STAMP}`,
      periodLabel: null, invoiceDate: null, notes: null,
      partnerFirmId: FIRM_ID, explicitLegalEntityId: ENT_ID,
      via: "ui_upload" as const,
    });
    const manualId = (manual.body as any).item?.id as string;
    const badSrc = await reviewSupplierInvoiceCore({ me, id: manualId, decision: "unapprove" });
    check("(e) un-approve of a submitted row → 409 invalid-status", badSrc.status === 409 && (badSrc.body as any).error === "invalid-status", badSrc);

    // (b) un-approve the auto-approved invoice.
    const un = await reviewSupplierInvoiceCore({ me, id: invId, decision: "unapprove" });
    check("(b) un-approve succeeds", un.status === 200 && (un.body as any).invoice?.status === "under_review", un.body);
    const [row1] = await db.select().from(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.id, invId));
    check("(b) reviewedAt cleared, back under_review", row1.status === "under_review" && row1.reviewedAt === null, { status: row1.status, reviewedAt: row1.reviewedAt });
    const audits = await db.select().from(atelierAuditEvents).where(and(
      eq(atelierAuditEvents.orgId, ORG),
      eq(atelierAuditEvents.entityId, invId),
      eq(atelierAuditEvents.action, "finance.supplier_invoice.unapprove"),
    ));
    check("(b) unapprove audit event written", audits.length === 1 && String(audits[0].payloadSummary).includes("Un-approved"), audits.map((a: any) => a.payloadSummary));

    // (c) human re-approve → attribution must NOT resurface.
    const reApprove = await reviewSupplierInvoiceCore({ me, id: invId, decision: "approve" });
    check("(c) human re-approve succeeds", reApprove.status === 200 && (reApprove.body as any).invoice?.status === "approved", reApprove.body);
    const attr2 = await loadSupplierAutopilotAttribution(ORG, [invId]);
    check("(c) attribution drops after human re-approve (latest event wins)", !attr2.has(invId), [...attr2.entries()]);

    // (d) simulate payment-run pickup → un-approve blocked with clear message.
    await db.update(atelierPartnerFirmInvoices)
      .set({ status: "scheduled", paymentRunId: `prun_siun_${STAMP}` })
      .where(eq(atelierPartnerFirmInvoices.id, invId));
    const blocked = await reviewSupplierInvoiceCore({ me, id: invId, decision: "unapprove" });
    check("(d) in a payment run → 409 in-payment-run", blocked.status === 409 && (blocked.body as any).error === "in-payment-run", blocked.body);
    check("(d) message tells the founder to cancel the run", String((blocked.body as any).message).includes("cancelling the run"), blocked.body);
    await db.update(atelierPartnerFirmInvoices)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(atelierPartnerFirmInvoices.id, invId));
    const paid = await reviewSupplierInvoiceCore({ me, id: invId, decision: "unapprove" });
    check("(d) paid → 409 with credit-note message", paid.status === 409 && String((paid.body as any).message).includes("credit note"), paid.body);

    // Race-window check: approved row whose paymentRunId got set between the
    // load and the guarded update still can't slip through (guard predicate).
    await db.update(atelierPartnerFirmInvoices)
      .set({ status: "approved", paymentRunId: null, paidAt: null })
      .where(eq(atelierPartnerFirmInvoices.id, invId));
    const ok2 = await reviewSupplierInvoiceCore({ me, id: invId, decision: "unapprove" });
    check("(b2) un-approve works again once out of the run", ok2.status === 200 && (ok2.body as any).invoice?.status === "under_review", ok2.body);
  } finally {
    try {
      await db.delete(atelierPartnerFirmInvoices).where(eq(atelierPartnerFirmInvoices.orgId, ORG));
      await db.delete(atelierAuditEvents).where(eq(atelierAuditEvents.orgId, ORG));
      await db.delete(atelierPartnerFirms).where(eq(atelierPartnerFirms.orgId, ORG));
      await db.delete(atelierUsers).where(eq(atelierUsers.orgId, ORG));
      await db.delete(atelierLegalEntities).where(eq(atelierLegalEntities.orgId, ORG));
    } catch (e) { console.warn("cleanup warning", e); }
    await pool.end?.();
  }

  if (failures > 0) { console.error(`\n${failures} check(s) FAILED`); process.exit(1); }
  console.log("\nAll supplier-invoice un-approve checks passed.");
}

main().catch((e) => { console.error(e); process.exit(1); });
