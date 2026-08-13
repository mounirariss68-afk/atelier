/**
 * Atelier — Agents lens routes (Tasks #373 read, #381 write).
 *
 * Read routes replace the client-side seed in
 * `artifacts/atelier/src/lib/agents-lens-seed.ts` with Postgres-backed
 * reads, mirroring the v5 Press / Studio / Guardhouse pattern in
 * `v5Routes.ts`. Routes are firm-wide reads scoped by the active
 * persona's `orgId`; the recruiter persona is denied here (consistent
 * with its /studio-only allowlist enforced in routes/atelier/index.ts).
 *
 * Write routes (Task #381) drive the agent lifecycle from the lens UI:
 *   - approve / request-changes on a spec  (Design)
 *   - promote a version draft → candidate → shipped  (Build)
 *   - advance a retirement scheduled → deprecated → archived  (Retire)
 * Each write inserts an `atelier_audit_events` row, mirroring the v5
 * write pattern in `engagementRoutes.audit(...)`. Persona gating: only
 * employee personas may write; non-employees (contractor, PFR, board
 * observer, recruiter, compliance officer) receive 403.
 *
 * Demo bootstrap data was removed (2026-07-16); rows are user-entered and
 * mutated only through these routes.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { effectiveAgentRunStatus } from "../../lib/atelier-agents/run-staleness.js";
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
  atelierAuditEvents,
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

/**
 * Write gate for Agents lens lifecycle actions.
 * Only the six employee personas may move specs / versions / retirements
 * through their state machines. Non-employees (contractor, partner-firm
 * resource, board observer, recruiter, compliance officer) get 403.
 * Compliance officer is read-only by design (see personaRoles.ts).
 */
const EMPLOYEE_WRITE_ROLES = new Set<string>([
  "founding_partner",
  "partner",
  "finance",
  "hr",
  "senior_manager",
  "consultant",
]);
function denyNonEmployeeWrite(me: Me, res: Response): boolean {
  if (!EMPLOYEE_WRITE_ROLES.has(me.role)) {
    res.status(403).json({
      error: "non-employee-persona",
      message:
        "Only employee personas may modify agent lifecycle state.",
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

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function audit(args: {
  entityType: string;
  entityId: string;
  actor: Me;
  action: string;
  payload: Record<string, unknown>;
  summary: string;
}): Promise<unknown> {
  return db.insert(atelierAuditEvents).values({
    id: rid("aud"),
    entityType: args.entityType,
    entityId: args.entityId,
    actorType: "human",
    actorId: args.actor.id,
    actorLabel: args.actor.name,
    action: args.action,
    payload: args.payload,
    payloadSummary: args.summary,
  });
}

// ============================================================
// READS
// ============================================================
// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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

// @cli-skip: pending Task #340 read-parity migration
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
// @cli-skip: pending Task #340 read-parity migration
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
      // Task #1046 — a crash-orphaned "running" row renders as error.
      status: effectiveAgentRunStatus(r),
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

// @cli-skip: pending Task #340 read-parity migration
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

// ============================================================
// WRITES — Design: approve / request-changes on a spec
// ============================================================
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/agents-lens/specs/:id/review", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  if (denyNonEmployeeWrite(me, res)) return;

  const decisionRaw = (req.body?.decision ?? "") as string;
  if (decisionRaw !== "approve" && decisionRaw !== "request_changes") {
    res
      .status(400)
      .json({ error: "invalid-decision", message: "decision must be 'approve' or 'request_changes'." });
    return;
  }
  const note = typeof req.body?.note === "string" ? req.body.note : "";

  const [spec] = await db
    .select()
    .from(atelierAgentSpecs)
    .where(
      and(
        eq(atelierAgentSpecs.id, req.params.id),
        eq(atelierAgentSpecs.orgId, me.orgId),
        isNull(atelierAgentSpecs.deletedAt),
      ),
    );
  if (!spec) {
    res.status(404).json({ error: "spec-not-found" });
    return;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const newStatus =
    decisionRaw === "approve" ? "approved" : "drafting";
  const nextLog = [
    ...(spec.reviewLog ?? []),
    {
      actor: me.name,
      decision: decisionRaw,
      at: nowIso.slice(0, 10),
      note,
    },
  ];

  await db
    .update(atelierAgentSpecs)
    .set({
      status: newStatus,
      reviewLog: nextLog,
      updatedAt: nowIso,
    })
    .where(eq(atelierAgentSpecs.id, spec.id));

  await audit({
    entityType: "atelier_agent_spec",
    entityId: spec.id,
    actor: me,
    action: `agents_lens.spec.${decisionRaw}`,
    payload: {
      specId: spec.id,
      previousStatus: spec.status,
      newStatus,
      note,
    },
    summary: `${me.name} ${decisionRaw === "approve" ? "approved" : "requested changes on"} spec ${spec.name}`,
  });

  res.json({ ok: true, id: spec.id, status: newStatus });
});

// ============================================================
// WRITES — Build: promote a version draft → candidate → shipped
// ============================================================
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/agents-lens/versions/:id/promote", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  if (denyNonEmployeeWrite(me, res)) return;

  const target = (req.body?.target ?? "") as string;
  if (target !== "candidate" && target !== "shipped") {
    res.status(400).json({
      error: "invalid-target",
      message: "target must be 'candidate' or 'shipped'.",
    });
    return;
  }

  const [version] = await db
    .select()
    .from(atelierAgentVersions)
    .where(
      and(
        eq(atelierAgentVersions.id, req.params.id),
        eq(atelierAgentVersions.orgId, me.orgId),
        isNull(atelierAgentVersions.deletedAt),
      ),
    );
  if (!version) {
    res.status(404).json({ error: "version-not-found" });
    return;
  }

  // Linear promotion: draft → candidate → shipped.
  const validTransition =
    (version.status === "draft" && target === "candidate") ||
    (version.status === "candidate" && target === "shipped");
  if (!validTransition) {
    res.status(409).json({
      error: "invalid-transition",
      message: `Cannot promote ${version.status} → ${target}.`,
      currentStatus: version.status,
    });
    return;
  }

  await db
    .update(atelierAgentVersions)
    .set({ status: target, updatedAt: new Date() })
    .where(eq(atelierAgentVersions.id, version.id));

  await audit({
    entityType: "atelier_agent_version",
    entityId: version.id,
    actor: me,
    action: `agents_lens.version.promote.${target}`,
    payload: {
      versionId: version.id,
      agentId: version.agentId,
      version: version.version,
      previousStatus: version.status,
      newStatus: target,
    },
    summary: `${me.name} promoted ${version.agentName} v${version.version} ${version.status} → ${target}`,
  });

  res.json({ ok: true, id: version.id, status: target });
});

// ============================================================
// WRITES — Retire: advance scheduled → deprecated → archived
// ============================================================
// @cli-skip: UI-workflow write; CLI write parity needs confirm-flow capability design before exposure
router.post("/agents-lens/retirements/:id/advance", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (denyRecruiterOutsideStudio(me, res)) return;
  if (denyNonEmployeeWrite(me, res)) return;

  const target = (req.body?.target ?? "") as string;
  if (target !== "deprecated" && target !== "archived") {
    res.status(400).json({
      error: "invalid-target",
      message: "target must be 'deprecated' or 'archived'.",
    });
    return;
  }

  const [row] = await db
    .select()
    .from(atelierAgentRetirements)
    .where(
      and(
        eq(atelierAgentRetirements.id, req.params.id),
        eq(atelierAgentRetirements.orgId, me.orgId),
        isNull(atelierAgentRetirements.deletedAt),
      ),
    );
  if (!row) {
    res.status(404).json({ error: "retirement-not-found" });
    return;
  }

  const validTransition =
    (row.status === "scheduled" && target === "deprecated") ||
    (row.status === "deprecated" && target === "archived");
  if (!validTransition) {
    res.status(409).json({
      error: "invalid-transition",
      message: `Cannot advance ${row.status} → ${target}.`,
      currentStatus: row.status,
    });
    return;
  }

  await db
    .update(atelierAgentRetirements)
    .set({ status: target, updatedAt: new Date() })
    .where(eq(atelierAgentRetirements.id, row.id));

  await audit({
    entityType: "atelier_agent_retirement",
    entityId: row.id,
    actor: me,
    action: `agents_lens.retirement.advance.${target}`,
    payload: {
      retirementId: row.id,
      agentId: row.agentId,
      previousStatus: row.status,
      newStatus: target,
    },
    summary: `${me.name} advanced retirement of ${row.agentName} ${row.status} → ${target}`,
  });

  res.json({ ok: true, id: row.id, status: target });
});

export default router;
