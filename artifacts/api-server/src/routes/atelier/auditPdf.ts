import type { Request, Response } from "express";
import PDFDocument from "pdfkit";
import { and, desc, eq } from "drizzle-orm";
import { atelierAuditEvents } from "@workspace/db";
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
  "offboarding",
  "invitation",
  "compliance_record",
  "conflict_disclosure",
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
