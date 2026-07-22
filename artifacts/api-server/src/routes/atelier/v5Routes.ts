/**
 * Atelier v5 — Press / Alliances / Studio / Guardhouse / IP Catalog read routes.
 *
 * Task #354: Replaces the TypeScript seed files in
 * `artifacts/atelier/src/data/{press,alliances,studio,guardhouse,ip}-seed.ts`
 * with Postgres-backed reads. All routes are firm-wide reads scoped by
 * the active persona's `orgId`. Persona gating:
 *
 *   - `recruiter` is restricted to /studio (and identity). The non-employee
 *     allowlist in routes/atelier/index.ts enforces this firm-wide; here we
 *     additionally deny `recruiter` on every non-studio v5 surface so the
 *     two layers can never drift.
 *   - `compliance_officer` is firm-wide read on guardhouse + audit-relevant
 *     surfaces (controls, evidence, pentests, vendors, incidents, dsars,
 *     backups). They get *no* write capabilities here. Press / Studio / IP /
 *     Alliances remain accessible to them as read-only firm-wide knowledge
 *     surfaces; this matches `personaRoles.ts` ("compliance_officer is NOT
 *     restricted by engagement — by design they need firm-wide read for
 *     audit").
 *
 * Demo seed bootstrap was removed (2026-07-16); data is user-entered. It once populated the canonical
 * v5 demo dataset; the tables now start empty.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierUsers,
  atelierPressEditorialCalendar,
  atelierPressInFlightContent,
  atelierPressPartnerCadence,
  atelierPressNewsletter,
  atelierPressSpeakingOpportunities,
  atelierPressMentions,
  atelierStudioOpenRoles,
  atelierStudioCandidates,
  atelierStudioInterviewPanels,
  atelierStudioReferenceChecks,
  atelierStudioOffers,
  atelierStudioReferrals,
  atelierGuardhouseControls,
  atelierGuardhouseEvidence,
  atelierGuardhousePentests,
  atelierGuardhouseVendors,
  atelierGuardhouseIncidents,
  atelierGuardhouseDsars,
  atelierGuardhouseBackups,
  atelierIpCodeAssets,
  atelierIpOssDependencies,
  atelierIpDemoEnvironments,
  atelierIpLicenseGrants,
} from "@workspace/db";

const router: IRouter = Router();

type Me = typeof atelierUsers.$inferSelect;

function ensurePersona(req: Request, res: Response): Me | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

/**
 * Recruiter persona is scoped to /studio. Defense-in-depth: even if
 * future routing accidentally exposes a non-studio v5 surface, this
 * helper guarantees a 403.
 *
 * `compliance_officer` is intentionally NOT denied here. Per Task #354
 * and the docstring on `RESTRICTED` in `personaRoles.ts`, compliance
 * officers receive firm-wide read across the v5 surfaces by design —
 * audit work needs visibility into press, alliances, hiring pipeline,
 * controls, vendors, and IP. Their access remains bounded elsewhere:
 * no comp/personnel/breakglass/approval capabilities are granted.
 */
function denyRecruiterOutsideStudio(me: Me, res: Response): boolean {
  if (me.role === "recruiter") {
    res.status(403).json({
      error: "recruiter-scope",
      message: "Recruiter persona may only access /studio surfaces.",
    });
    return true;
  }
  return false;
}

/** Standard org-scoped soft-delete filter for any v5 table. */
function orgScope(
  me: Me,
  table: { orgId: AnyPgColumn; deletedAt: AnyPgColumn },
) {
  return and(eq(table.orgId, me.orgId), isNull(table.deletedAt));
}

// =============================================================
// PRESS
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/press/editorial-calendar", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressEditorialCalendar)
    .where(orgScope(me, atelierPressEditorialCalendar));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/press/in-flight", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressInFlightContent)
    .where(orgScope(me, atelierPressInFlightContent));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/press/partner-cadence", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressPartnerCadence)
    .where(orgScope(me, atelierPressPartnerCadence));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/press/newsletter", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const [row] = await db
    .select()
    .from(atelierPressNewsletter)
    .where(orgScope(me, atelierPressNewsletter))
    .limit(1);
  res.json({ newsletter: row ?? null });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/press/speaking-opportunities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressSpeakingOpportunities)
    .where(orgScope(me, atelierPressSpeakingOpportunities));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/press/mentions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierPressMentions)
    .where(orgScope(me, atelierPressMentions));
  res.json({ items: rows });
});

// =============================================================
// STUDIO  (recruiter has read access here; this is their workspace)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/open-roles", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioOpenRoles)
    .where(orgScope(me, atelierStudioOpenRoles));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/candidates", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioCandidates)
    .where(orgScope(me, atelierStudioCandidates));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/interview-panels", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioInterviewPanels)
    .where(orgScope(me, atelierStudioInterviewPanels));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/reference-checks", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioReferenceChecks)
    .where(orgScope(me, atelierStudioReferenceChecks));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/offers", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioOffers)
    .where(orgScope(me, atelierStudioOffers));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/studio/referrals", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierStudioReferrals)
    .where(orgScope(me, atelierStudioReferrals));
  res.json({ items: rows });
});

// =============================================================
// GUARDHOUSE  (compliance_officer is the canonical owner)
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/controls", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseControls)
    .where(orgScope(me, atelierGuardhouseControls));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/evidence", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseEvidence)
    .where(orgScope(me, atelierGuardhouseEvidence));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/pentests", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhousePentests)
    .where(orgScope(me, atelierGuardhousePentests));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/vendors", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseVendors)
    .where(orgScope(me, atelierGuardhouseVendors));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/incidents", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseIncidents)
    .where(orgScope(me, atelierGuardhouseIncidents));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/dsars", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseDsars)
    .where(orgScope(me, atelierGuardhouseDsars));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/guardhouse/backups", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierGuardhouseBackups)
    .where(orgScope(me, atelierGuardhouseBackups));
  res.json({ items: rows });
});

// =============================================================
// IP CATALOG
// =============================================================
// @cli-skip: pending Task #340 read-parity migration
router.get("/ip/code-assets", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpCodeAssets)
    .where(orgScope(me, atelierIpCodeAssets));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/ip/oss-dependencies", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpOssDependencies)
    .where(orgScope(me, atelierIpOssDependencies));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/ip/demo-environments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpDemoEnvironments)
    .where(orgScope(me, atelierIpDemoEnvironments));
  res.json({ items: rows });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/ip/license-grants", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierIpLicenseGrants)
    .where(orgScope(me, atelierIpLicenseGrants));
  res.json({ items: rows });
});

export default router;
