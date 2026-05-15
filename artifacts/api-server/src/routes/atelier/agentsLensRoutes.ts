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
import { and, eq, inArray, isNull } from "drizzle-orm";
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
  atelierAgentRuns,
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

// Task #382 — incident detail with linked run telemetry and candidate
// fix version. Closes the Improve loop: the Improve page can render the
// failing transcripts that triggered each incident and link the proposed
// fix back to the candidate version in Build.
router.get("/agents-lens/incidents/:id", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  const [incident] = await db
    .select()
    .from(atelierAgentIncidents)
    .where(
      and(
        eq(atelierAgentIncidents.id, req.params.id),
        eq(atelierAgentIncidents.orgId, me.orgId),
        isNull(atelierAgentIncidents.deletedAt),
      ),
    );
  if (!incident) {
    res.status(404).json({ error: "incident-not-found" });
    return;
  }
  const evidenceIds = (incident.evidenceRunIds ?? []) as string[];
  const evidenceRuns = evidenceIds.length
    ? await db
        .select()
        .from(atelierAgentRuns)
        .where(
          and(
            inArray(atelierAgentRuns.id, evidenceIds),
            eq(atelierAgentRuns.orgId, me.orgId),
            isNull(atelierAgentRuns.deletedAt),
          ),
        )
    : [];
  let fixVersion = null;
  if (incident.fixVersionId) {
    const [v] = await db
      .select()
      .from(atelierAgentVersions)
      .where(
        and(
          eq(atelierAgentVersions.id, incident.fixVersionId),
          eq(atelierAgentVersions.orgId, me.orgId),
          isNull(atelierAgentVersions.deletedAt),
        ),
      );
    fixVersion = v ?? null;
  }
  res.json({
    incident,
    evidenceRuns: evidenceRuns.map((r) => ({
      id: r.id,
      agentId: r.agentId,
      status: r.status,
      statusMessage: r.statusMessage,
      confidence: r.confidence,
      targetType: r.targetType,
      targetId: r.targetId,
      targetLabel: r.targetLabel,
      progressPct: r.progressPct,
      sourcesCount: r.sourcesCount,
      costUsd: r.costUsd,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    })),
    fixVersion,
  });
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
