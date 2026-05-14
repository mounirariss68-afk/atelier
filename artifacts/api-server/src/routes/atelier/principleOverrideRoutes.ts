/**
 * Atelier — Principle Override (breakglass) routes. Task #293.
 *
 * The DB column-level RLS layer (lib/db/drizzle/0025_atelier_column_rls.sql)
 * masks `compensation` and `personnel_contract` sensitivity classes for
 * any persona outside the allow-list. Breakglass is the audited escape
 * hatch: a partner-tier actor calls `atelier_breakglass(...)` inside a
 * single Drizzle transaction, which writes a row to
 * `atelier_principle_override` AND flips the per-transaction GUC
 * `app.principle_override = 'true'`. The mask helpers then return TRUE
 * for the rest of the transaction so the caller can read the unmasked
 * row in the SAME response — and only that response.
 *
 * Two endpoints:
 *   POST /admin/breakglass/read   — partner-tier reads one masked row
 *                                    unmasked (employee comp, contractor
 *                                    cost, partner-economics, person doc)
 *   GET  /admin/breakglass        — paginated audit ledger of past
 *                                    overrides (partner-tier + finance + hr)
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { desc, sql } from "drizzle-orm";
import { db, atelierPrincipleOverride, atelierAuditEvents } from "@workspace/db";
import { withRls } from "./rls.js";
import { canBreakglass, isFinance, isHr, isLeadership } from "./personaRoles.js";
import { assertAuditAction } from "./auditContract.js";

const router: IRouter = Router();

const ALLOWED_TARGET_TABLES = new Set([
  "atelier_employees",
  "atelier_contractors",
  "atelier_partner_firm_resources",
  "atelier_partner_economics",
  "atelier_person_documents",
]);
const ALLOWED_SENSITIVITY = new Set(["compensation", "personnel_contract"]);

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

// @cli-skip: pending Task #340 read-parity migration
router.post("/admin/breakglass/read", async (req: Request, res: Response) => {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return;
  }
  if (!canBreakglass(me.role)) {
    res.status(403).json({ error: "forbidden", reason: "partner-tier-required" });
    return;
  }
  const { targetTable, targetId, sensitivityClass, reason } = (req.body ?? {}) as {
    targetTable?: string;
    targetId?: string;
    sensitivityClass?: string;
    reason?: string;
  };
  if (!targetTable || !ALLOWED_TARGET_TABLES.has(targetTable)) {
    res.status(400).json({ error: "invalid-target-table" });
    return;
  }
  if (!sensitivityClass || !ALLOWED_SENSITIVITY.has(sensitivityClass)) {
    res.status(400).json({ error: "invalid-sensitivity-class" });
    return;
  }
  if (!reason || reason.trim().length < 8) {
    res.status(400).json({ error: "reason-required", reason: "min 8 chars" });
    return;
  }
  if (!targetId) {
    res.status(400).json({ error: "target-id-required" });
    return;
  }

  try {
    const result = await withRls(req, async (tx) => {
      // Invoke the SECURITY-INVOKER helper. It writes the audit row +
      // flips app.principle_override to 'true' for THIS transaction only.
      const overrideRes = await tx.execute<{ override_id: string }>(sql`
        SELECT atelier_breakglass(
          ${targetTable}::text,
          ${targetId}::text,
          ${sensitivityClass}::text,
          ${reason}::text
        ) AS override_id
      `);
      const overrideId =
        (overrideRes as unknown as { rows?: Array<{ override_id: string }> }).rows?.[0]
          ?.override_id ?? null;

      // Read the unmasked row through the same masked view — the helper
      // returns the raw value because principle_override is now active.
      const view = `${targetTable}_v`;
      const rowRes = await tx.execute(
        sql`SELECT * FROM ${sql.identifier(view)} WHERE id = ${targetId} LIMIT 1`,
      );
      const row =
        (rowRes as unknown as { rows?: Array<Record<string, unknown>> }).rows?.[0] ??
        null;
      return { overrideId, row };
    });

    // Mirror to the firm-wide audit_events stream so audit exports / Why
    // Drawer pick it up alongside other privileged actions.
    assertAuditAction("principle_override.granted");
    await db.insert(atelierAuditEvents).values({
      id: rid("aud"),
      entityType: targetTable,
      entityId: targetId,
      actorType: "human",
      actorId: me.id,
      actorLabel: me.name,
      action: "principle_override.granted",
      payload: {
        overrideId: result.overrideId,
        sensitivityClass,
        reason,
      },
      payloadSummary: `${me.name} invoked breakglass on ${targetTable}/${targetId} (${sensitivityClass}): ${reason}`,
    });

    res.json({
      overrideId: result.overrideId,
      target: { table: targetTable, id: targetId },
      sensitivityClass,
      row: result.row,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: "breakglass-failed", reason: msg });
  }
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/admin/breakglass", async (req: Request, res: Response) => {
  const me = req.atelierPersona;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return;
  }
  // Auditors of the breakglass ledger: leadership + finance + hr.
  if (!isLeadership(me.role) && !isFinance(me.role) && !isHr(me.role)) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  const limit = Math.min(Number(req.query.limit ?? 50), 200);
  const rows = await db
    .select()
    .from(atelierPrincipleOverride)
    .orderBy(desc(atelierPrincipleOverride.grantedAt))
    .limit(limit);
  res.json({
    items: rows.map((r) => ({
      id: r.id,
      actorUserId: r.actorUserId,
      actorRole: r.actorRole,
      targetTable: r.targetTable,
      targetId: r.targetId,
      sensitivityClass: r.sensitivityClass,
      reason: r.reason,
      grantedAt: r.grantedAt.toISOString(),
      expiresAt: r.expiresAt?.toISOString() ?? null,
    })),
  });
});

export default router;
