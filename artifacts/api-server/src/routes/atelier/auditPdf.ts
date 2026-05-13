import type { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import {
  atelierAuditEvents,
  atelierEmployees,
  atelierContractors,
  atelierPartnerFirmResources,
  atelierOnboardings,
  atelierOffboardings,
} from "@workspace/db";
import { withRls } from "./rls";

const ENTITY_TYPES = new Set([
  "account",
  "opportunity",
  "engagement",
  "deliverable",
  "agent_run",
  "session",
  "atelier_asset",
  "onboarding",
  "onboarding_step",
  "offboarding",
  "offboarding_step",
  "invitation",
  "compliance_record",
  "conflict_disclosure",
  // Task #261 — v3 entity surfaces.
  "person",
  "employee",
  "contractor",
  "partner_firm_resource",
  "timesheet_week",
  "timesheet_entry",
  "expense",
  "contractor_payment",
  "partner_firm_invoice",
  "invoice_line_draft",
]);

export async function auditPdfHandler(req: Request, res: Response): Promise<void> {
  const entityType = String(req.query.entityType ?? "");
  const entityId = String(req.query.entityId ?? "");

  if (!ENTITY_TYPES.has(entityType) || !entityId) {
    res.status(400).json({ error: "invalid-query", expected: "entityType + entityId" });
    return;
  }

  const rows = await withRls(req, async (tx) => {
    return tx
      .select()
      .from(atelierAuditEvents)
      .where(
        and(
          eq(atelierAuditEvents.entityType, entityType),
          eq(atelierAuditEvents.entityId, entityId),
        ),
      )
      .orderBy(desc(atelierAuditEvents.ts))
      .limit(500);
  });

  const filename = `atelier-audit-${entityType}-${entityId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
  );

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);

  // Cover header
  doc
    .fillColor("#0E1F3D")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("THE ATELIER", { align: "left" });
  doc
    .fillColor("#E89E2C")
    .font("Helvetica")
    .fontSize(10)
    .text("AICo Employee Portal — Immutable Audit Trail", { align: "left" });
  doc.moveDown(0.8);

  doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(12);
  doc.text(`Entity: ${entityType} / ${entityId}`);
  doc.font("Helvetica").fontSize(10).fillColor("#444");
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.text(`Persona: ${req.atelierPersona?.name ?? "(unknown)"}`);
  doc.text(`Events: ${rows.length}`);
  doc.moveDown(0.8);
  doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor("#E89E2C").lineWidth(0.7).stroke();
  doc.moveDown(0.6);

  if (rows.length === 0) {
    doc.fillColor("#999").font("Helvetica-Oblique").fontSize(11);
    doc.text("No audit events recorded for this entity.");
  }

  for (const r of rows) {
    doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(10);
    doc.text(`${r.ts.toISOString()}  ·  ${r.actorType.toUpperCase()}  ·  ${r.actorLabel}`);
    doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(11);
    doc.text(r.action);
    if (r.payloadSummary) {
      doc.fillColor("#444").font("Helvetica").fontSize(10);
      doc.text(r.payloadSummary, { indent: 12, lineGap: 1 });
    }
    doc.moveDown(0.5);
  }

  // Footer
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor("#999")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `AICo · The Atelier · ${entityType}/${entityId} · page ${i + 1} of ${range.count}`,
        56,
        780,
        { width: 483, align: "center" },
      );
  }

  doc.end();
}

/**
 * Task #261 — Per-Person audit pack PDF.
 *
 * GET /roster/people/:id/audit
 *
 * Resolves the person's identity row (employee | contractor |
 * partner_firm_resource), then emits a Partner-signed PDF combining all
 * audit events keyed to:
 *   - the person id directly (entityType in person/employee/contractor/...)
 *   - any onboarding(s) for this person
 *   - any offboarding(s) for this person
 *
 * RLS: org_id is enforced via withRls; cross-tenant rows are invisible.
 */
export async function personAuditPdfHandler(req: Request, res: Response): Promise<void> {
  const personId = String(req.params.id ?? "");
  if (!personId) {
    res.status(400).json({ error: "missing-person-id" });
    return;
  }

  const { person, onboardingIds, offboardingIds, rows } = await withRls(req, async (tx) => {
    const [emp] = await tx.select().from(atelierEmployees).where(eq(atelierEmployees.id, personId)).limit(1);
    const [con] = emp
      ? [null]
      : await tx.select().from(atelierContractors).where(eq(atelierContractors.id, personId)).limit(1);
    const [pfr] = emp || con
      ? [null]
      : await tx
          .select()
          .from(atelierPartnerFirmResources)
          .where(eq(atelierPartnerFirmResources.id, personId))
          .limit(1);
    const personRow = emp ?? con ?? pfr ?? null;
    const onbs = await tx
      .select({ id: atelierOnboardings.id })
      .from(atelierOnboardings)
      .where(eq(atelierOnboardings.personId, personId));
    const offs = await tx
      .select({ id: atelierOffboardings.id })
      .from(atelierOffboardings)
      .where(eq(atelierOffboardings.personId, personId));
    const onbIds = onbs.map((r) => r.id);
    const offIds = offs.map((r) => r.id);
    const personEntityTypes = ["person", "employee", "contractor", "partner_firm_resource"];
    const conds = [
      and(inArray(atelierAuditEvents.entityType, personEntityTypes), eq(atelierAuditEvents.entityId, personId)),
    ];
    if (onbIds.length) {
      conds.push(
        and(
          inArray(atelierAuditEvents.entityType, ["onboarding", "onboarding_step"]),
          inArray(atelierAuditEvents.entityId, onbIds),
        ),
      );
    }
    if (offIds.length) {
      conds.push(
        and(
          inArray(atelierAuditEvents.entityType, ["offboarding", "offboarding_step"]),
          inArray(atelierAuditEvents.entityId, offIds),
        ),
      );
    }
    const auditRows = await tx
      .select()
      .from(atelierAuditEvents)
      .where(or(...conds))
      .orderBy(desc(atelierAuditEvents.ts))
      .limit(1000);
    return { person: personRow, onboardingIds: onbIds, offboardingIds: offIds, rows: auditRows };
  });

  const personLabel = (person as { fullName?: string } | null)?.fullName ?? personId;
  const filename = `atelier-audit-person-${personLabel.replace(/\s+/g, "_")}-${personId}.pdf`;
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, "_")}"`,
  );

  const doc = new PDFDocument({ size: "A4", margin: 56 });
  doc.pipe(res);

  doc
    .fillColor("#0E1F3D")
    .font("Helvetica-Bold")
    .fontSize(20)
    .text("THE ATELIER", { align: "left" });
  doc
    .fillColor("#E89E2C")
    .font("Helvetica")
    .fontSize(10)
    .text("AICo Employee Portal — Per-Person Audit Pack", { align: "left" });
  doc.moveDown(0.8);

  doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(12);
  doc.text(`Person: ${personLabel}`);
  doc.font("Helvetica").fontSize(10).fillColor("#444");
  doc.text(`Person ID: ${personId}`);
  doc.text(`Onboardings included: ${onboardingIds.length}`);
  doc.text(`Offboardings included: ${offboardingIds.length}`);
  doc.text(`Generated: ${new Date().toISOString()}`);
  doc.text(`Signed by: ${req.atelierPersona?.name ?? "(unknown)"} (${req.atelierPersona?.role ?? "?"})`);
  doc.text(`Events: ${rows.length}`);
  doc.moveDown(0.8);
  doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor("#E89E2C").lineWidth(0.7).stroke();
  doc.moveDown(0.6);

  if (rows.length === 0) {
    doc.fillColor("#999").font("Helvetica-Oblique").fontSize(11);
    doc.text("No audit events recorded for this person.");
  }

  for (const r of rows) {
    doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(10);
    doc.text(`${r.ts.toISOString()}  ·  ${r.actorType.toUpperCase()}  ·  ${r.actorLabel}`);
    doc.fillColor("#666").font("Helvetica").fontSize(9);
    doc.text(`${r.entityType} / ${r.entityId}`);
    doc.fillColor("#0E1F3D").font("Helvetica-Bold").fontSize(11);
    doc.text(r.action);
    if (r.payloadSummary) {
      doc.fillColor("#444").font("Helvetica").fontSize(10);
      doc.text(r.payloadSummary, { indent: 12, lineGap: 1 });
    }
    doc.moveDown(0.5);
  }

  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor("#999")
      .font("Helvetica")
      .fontSize(8)
      .text(
        `AICo · The Atelier · person/${personId} · signed ${req.atelierPersona?.name ?? ""} · page ${i + 1} of ${range.count}`,
        56,
        780,
        { width: 483, align: "center" },
      );
  }

  doc.end();
}
