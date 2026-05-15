/**
 * Atelier — Agents lens read routes (Task #373).
 *
 * Replaces the client-side seed in `artifacts/atelier/src/lib/agents-lens-seed.ts`
 * with Postgres-backed reads, mirroring the v5 Press / Studio / Guardhouse
 * pattern in `v5Routes.ts`. Routes are firm-wide reads scoped by the active
 * persona's `orgId`; the recruiter persona is denied here (consistent with
 * its /studio-only allowlist enforced in routes/atelier/index.ts).
 *
 * Bootstrap data lives in `lib/atelier-seed-agents-lens.ts` and is loaded
 * idempotently on cold start from `index.ts`.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db,
  atelierUsers,
  atelierAgentSpecs,
  atelierAgentVersions,
  atelierAgentEvalSuites,
  atelierAgentDeployments,
  atelierAgentIncidents,
  atelierAgentRetirements,
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

function orgScope(
  me: Me,
  table: { orgId: AnyPgColumn; deletedAt: AnyPgColumn },
) {
  return and(eq(table.orgId, me.orgId), isNull(table.deletedAt));
}

router.get("/agents-lens/specs", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentSpecs)
    .where(orgScope(me, atelierAgentSpecs));
  res.json({ items: rows });
});

router.get("/agents-lens/versions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentVersions)
    .where(orgScope(me, atelierAgentVersions));
  res.json({ items: rows });
});

router.get("/agents-lens/eval-suites", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentEvalSuites)
    .where(orgScope(me, atelierAgentEvalSuites));
  res.json({ items: rows });
});

router.get("/agents-lens/deployments", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentDeployments)
    .where(orgScope(me, atelierAgentDeployments));
  res.json({ items: rows });
});

router.get("/agents-lens/incidents", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentIncidents)
    .where(orgScope(me, atelierAgentIncidents));
  res.json({ items: rows });
});

router.get("/agents-lens/retirements", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const rows = await db
    .select()
    .from(atelierAgentRetirements)
    .where(orgScope(me, atelierAgentRetirements));
  res.json({ items: rows });
});

export default router;
