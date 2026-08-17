import type { Request, Response } from "express";
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
import { resolveUserIdForPerson } from "./meRoutes";
import { contentDispositionFilename } from "../../lib/httpFilename.js";
import {
  createBrandDoc,
  addBrandPage,
  glassSection,
  writeBrandFooters,
  block,
  BRAND,
  FONT,
  PAGE,
  type BrandBlock,
} from "../../lib/atelier-pdf-brand.js";

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
    contentDispositionFilename("attachment", filename),
  );

  // Task #1007 — rendered on the shared glassmorphism brand kit.
  const doc = createBrandDoc();
  doc.pipe(res);
  addBrandPage(doc);

  doc.font(FONT.display).fontSize(16).fillColor(BRAND.navy).text("Immutable Audit Trail", PAGE.left, doc.y);
  doc
    .font(FONT.medium)
    .fontSize(9.5)
    .fillColor(BRAND.gold)
    .text("Atelier — Cognirise Employee Portal", PAGE.left, doc.y + 2);
  doc.moveDown(0.9);

  glassSection(doc, null, [
    block.body(`Entity: ${entityType} / ${entityId}`, { font: FONT.semibold, color: BRAND.navy }),
    block.muted(`Generated: ${new Date().toISOString()}`),
    block.muted(`Persona: ${req.atelierPersona?.name ?? "(unknown)"}`),
    block.muted(`Events: ${rows.length}`),
  ]);

  const eventBlocks: BrandBlock[] = [];
  if (rows.length === 0) {
    eventBlocks.push(block.italic("No audit events recorded for this entity."));
  }
  for (const r of rows) {
    eventBlocks.push(
      block.muted(`${r.ts.toISOString()}  ·  ${r.actorType.toUpperCase()}  ·  ${r.actorLabel}`, { size: 8 }),
      block.strong(r.action, { size: 10 }),
    );
    if (r.payloadSummary) {
      eventBlocks.push(block.body(r.payloadSummary, { indent: 10, size: 9, color: BRAND.ink }));
    }
    eventBlocks.push(block.gap(7));
  }
  glassSection(doc, "Audit Events", eventBlocks);

  writeBrandFooters(doc, { label: `Cognirise · Atelier · ${entityType}/${entityId}` });
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
  // Task #261 SEC — partner-signed audit pack must be locked to
  // partner / operations personas, OR a strict self-export where the
  // requesting persona's id matches the requested personId. Without
  // this guard any employee/lead could exfiltrate another person's
  // full audit trail (IDOR).
  const persona = (req as Request & {
    atelierPersona?: { id: string; role: string; orgId: string };
  }).atelierPersona;
  if (!persona) {
    res.status(401).json({ error: "unauthenticated" });
    return;
  }
  // Task #221 — the per-person audit pack is a sensitive-people surface:
  // founding_partner | hr only, plus a strict self-export. Self must be
  // resolved via the person row's login linkage (employees.userId /
  // contractor email), because :id is a roster person id while
  // persona.id is an atelier_users id — they are different namespaces.
  const isPrivileged =
    persona.role === "founding_partner" || persona.role === "hr";
  let isSelf = false;
  if (!isPrivileged) {
    const ownerUserId = await resolveUserIdForPerson(persona.orgId, personId);
    isSelf = ownerUserId !== null && ownerUserId === persona.id;
  }
  if (!isPrivileged && !isSelf) {
    res.status(403).json({ error: "forbidden" });
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
      // Task #261 — "complete" audit pack must also include events the
      // person AUTHORED (e.g., a contractor submitting their own
      // timesheet/expense rows where the entity is the timesheet/expense,
      // not the person). Without this OR clause the pack misses every
      // mutation the person performed across other entity types.
      eq(atelierAuditEvents.actorId, personId),
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
    contentDispositionFilename("attachment", filename),
  );

  // Task #1007 — rendered on the shared glassmorphism brand kit.
  const doc = createBrandDoc();
  doc.pipe(res);
  addBrandPage(doc);

  doc.font(FONT.display).fontSize(16).fillColor(BRAND.navy).text("Per-Person Audit Pack", PAGE.left, doc.y);
  doc
    .font(FONT.medium)
    .fontSize(9.5)
    .fillColor(BRAND.gold)
    .text("Atelier — Cognirise Employee Portal", PAGE.left, doc.y + 2);
  doc.moveDown(0.9);

  glassSection(doc, null, [
    block.body(`Person: ${personLabel}`, { font: FONT.semibold, color: BRAND.navy }),
    block.muted(`Person ID: ${personId}`),
    block.muted(`Onboardings included: ${onboardingIds.length}`),
    block.muted(`Offboardings included: ${offboardingIds.length}`),
    block.muted(`Generated: ${new Date().toISOString()}`),
    block.muted(`Signed by: ${req.atelierPersona?.name ?? "(unknown)"} (${req.atelierPersona?.role ?? "?"})`),
    block.muted(`Events: ${rows.length}`),
  ]);

  const eventBlocks: BrandBlock[] = [];
  if (rows.length === 0) {
    eventBlocks.push(block.italic("No audit events recorded for this person."));
  }
  for (const r of rows) {
    eventBlocks.push(
      block.muted(`${r.ts.toISOString()}  ·  ${r.actorType.toUpperCase()}  ·  ${r.actorLabel}`, { size: 8 }),
      block.muted(`${r.entityType} / ${r.entityId}`, { size: 8 }),
      block.strong(r.action, { size: 10 }),
    );
    if (r.payloadSummary) {
      eventBlocks.push(block.body(r.payloadSummary, { indent: 10, size: 9, color: BRAND.ink }));
    }
    eventBlocks.push(block.gap(7));
  }
  glassSection(doc, "Audit Events", eventBlocks);

  writeBrandFooters(doc, {
    label: `Cognirise · Atelier · person/${personId} · signed ${req.atelierPersona?.name ?? ""}`,
  });
  doc.end();
}
