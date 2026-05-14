/**
 * Atelier — Task #297 Firm Profile routes.
 *
 * The Firm Profile is the canonical brand-copy source for everything the
 * firm publishes. Drafts may stack; exactly one (orgId) row carries
 * status='published' at any time. Founding partners and HR roles publish.
 *
 * All queries and mutations are scoped by `me.orgId`. Cross-tenant reads
 * and writes are not possible.
 *
 * Mounted under /api/atelier by routes/atelier/index.ts.
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, desc, isNull, max } from "drizzle-orm";
import { db, atelierFirmProfile, atelierUsers } from "@workspace/db";
import { runBrandProfileWriter } from "../../lib/atelier-agents/runner.js";
import { audit } from "./engagementRoutes.js";

const router: IRouter = Router();

function rid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  const me = req.atelierPersona ?? null;
  if (!me) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return me;
}

const PUBLISH_ROLES = new Set(["founding_partner", "hr"]);

function ensurePublisher(me: typeof atelierUsers.$inferSelect, res: Response): boolean {
  if (!PUBLISH_ROLES.has(me.role)) {
    res.status(403).json({ error: "forbidden", message: "Only founding_partner or hr can publish a Firm Profile." });
    return false;
  }
  return true;
}

/** Always combine the per-row deletedAt + the persona's orgId. */
function orgScope(me: typeof atelierUsers.$inferSelect) {
  return and(eq(atelierFirmProfile.orgId, me.orgId), isNull(atelierFirmProfile.deletedAt));
}

function toWire(row: typeof atelierFirmProfile.$inferSelect) {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    payload: row.payload,
    runId: row.runId,
    notes: row.notes,
    publishedAt: row.publishedAt,
    publishedByUserId: row.publishedByUserId,
    publishedByName: row.publishedByName,
    supersededAt: row.supersededAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdByUserId: row.createdByUserId,
  };
}

// ---- list / latest ----

// @cli-skip: pending Task #340 read-parity migration
router.get("/firm-profile", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const [published] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.status, "published"), orgScope(me)))
    .orderBy(desc(atelierFirmProfile.publishedAt))
    .limit(1);
  const [latestDraft] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.status, "draft"), orgScope(me)))
    .orderBy(desc(atelierFirmProfile.createdAt))
    .limit(1);
  res.json({
    published: published ? toWire(published) : null,
    latestDraft: latestDraft ? toWire(latestDraft) : null,
    canPublish: PUBLISH_ROLES.has(me.role),
  });
});

// @cli-skip: pending Task #340 read-parity migration
router.get("/firm-profile/versions", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const rows = await db
    .select()
    .from(atelierFirmProfile)
    .where(orgScope(me))
    .orderBy(desc(atelierFirmProfile.version));
  res.json({ versions: rows.map(toWire) });
});

// ---- create draft from agent ----

// @cli-skip: pending Task #340 read-parity migration
router.post("/firm-profile/run-writer", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Task #297 — admin-gated: only founding_partner / hr may create or
  // version the canonical brand copy at the API layer. UI gating is
  // not sufficient; this route is the source of truth.
  if (!ensurePublisher(me, res)) return;
  const body = req.body as { firmName?: string; userBrief?: string | null };
  const firmName = (body.firmName ?? "AICo").trim() || "AICo";
  // Seed the writer with this org's published version (if any).
  const [published] = await db
    .select({ payload: atelierFirmProfile.payload })
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.status, "published"), orgScope(me)))
    .orderBy(desc(atelierFirmProfile.publishedAt))
    .limit(1);

  const { runId, output } = await runBrandProfileWriter({
    firmName,
    existingProfile: published?.payload ?? null,
    userBrief: body.userBrief ?? null,
    triggeredByUserId: me.id,
    actorLabel: me.name ?? me.id,
  });

  // Versions are scoped per org, so the next version is org-local.
  const [{ next }] = await db
    .select({ next: max(atelierFirmProfile.version) })
    .from(atelierFirmProfile)
    .where(orgScope(me));
  const nextVersion = (next ?? 0) + 1;
  const id = rid("frm");
  await db.insert(atelierFirmProfile).values({
    id,
    orgId: me.orgId,
    version: nextVersion,
    status: "draft",
    payload: output,
    runId,
    notes: body.userBrief ?? null,
    createdByUserId: me.id,
  });
  await audit({
    entityType: "firm_profile",
    entityId: id,
    actor: me,
    action: "firm_profile.draft.created",
    payload: { runId, version: nextVersion, source: "brand_profile_writer" },
    summary: `Brand Profile Writer drafted Firm Profile v${nextVersion}`,
  });
  const [row] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.id, id), orgScope(me)));
  res.status(201).json({ draft: toWire(row), runId });
});

// ---- manual draft save (edits to a draft payload) ----

// @cli-skip: pending Task #340 read-parity migration
router.post("/firm-profile/draft", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  // Task #297 — admin-gated: only founding_partner / hr may save edits
  // to a Firm Profile draft.
  if (!ensurePublisher(me, res)) return;
  const body = req.body as { payload?: unknown; notes?: string | null };
  if (!body.payload || typeof body.payload !== "object") {
    res.status(400).json({ error: "payload-required" });
    return;
  }
  const [{ next }] = await db
    .select({ next: max(atelierFirmProfile.version) })
    .from(atelierFirmProfile)
    .where(orgScope(me));
  const nextVersion = (next ?? 0) + 1;
  const id = rid("frm");
  await db.insert(atelierFirmProfile).values({
    id,
    orgId: me.orgId,
    version: nextVersion,
    status: "draft",
    payload: body.payload as never,
    notes: body.notes ?? null,
    createdByUserId: me.id,
  });
  await audit({
    entityType: "firm_profile",
    entityId: id,
    actor: me,
    action: "firm_profile.draft.created",
    payload: { version: nextVersion, source: "manual" },
    summary: `Manual Firm Profile draft v${nextVersion}`,
  });
  const [row] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.id, id), orgScope(me)));
  res.status(201).json({ draft: toWire(row) });
});

// ---- publish ----

// @cli-skip: pending Task #340 read-parity migration
router.post("/firm-profile/:id/publish", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensurePublisher(me, res)) return;
  const [target] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.id, req.params.id), orgScope(me)));
  if (!target) { res.status(404).json({ error: "not-found" }); return; }
  if (target.status === "published") {
    res.status(400).json({ error: "already-published" });
    return;
  }
  // Atomically supersede this org's existing published row, publish this one.
  await db.transaction(async (tx) => {
    await tx
      .update(atelierFirmProfile)
      .set({ status: "superseded", supersededAt: new Date() })
      .where(and(
        eq(atelierFirmProfile.status, "published"),
        eq(atelierFirmProfile.orgId, me.orgId),
        isNull(atelierFirmProfile.deletedAt),
      ));
    await tx
      .update(atelierFirmProfile)
      .set({
        status: "published",
        publishedAt: new Date(),
        publishedByUserId: me.id,
        publishedByName: me.name,
        updatedAt: new Date(),
      })
      .where(and(eq(atelierFirmProfile.id, target.id), eq(atelierFirmProfile.orgId, me.orgId)));
  });
  await audit({
    entityType: "firm_profile",
    entityId: target.id,
    actor: me,
    action: "firm_profile.published",
    payload: { version: target.version },
    summary: `Published Firm Profile v${target.version}`,
  });
  const [row] = await db
    .select()
    .from(atelierFirmProfile)
    .where(and(eq(atelierFirmProfile.id, target.id), orgScope(me)));
  res.json({ published: toWire(row) });
});

export default router;
