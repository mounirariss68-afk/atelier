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
import { z } from "zod";
import { eq, and, desc, isNull, max, inArray } from "drizzle-orm";
import {
  db,
  atelierFirmProfile,
  atelierUsers,
  atelierSigningEntitySignatories,
} from "@workspace/db";
import { canApproveAsPartner } from "./personaRoles";
import { runBrandProfileWriter } from "../../lib/atelier-agents/runner.js";
import {
  listSigningEntities,
  listEntitySignatories,
  loadPublishedFirmProfile,
  normalizeSigningEntities,
} from "../../lib/atelier-contract-service.js";
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
  const firmName = (body.firmName ?? "Cognirise").trim() || "Cognirise";
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

// ---- Task #232 — signing-entity registry (payload.legalEntities) ----

// Read surface for the contract-prep entity picker: any authenticated
// persona may list the firm's signing entities (names are firm-public).
// @cli-skip: contract-prep picker data source (Task #232)
router.get("/signing-entities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const entities = await listSigningEntities(me.orgId);
  // Task #335 — attach each entity's authorised signatories (resolved to
  // live users) so the management UI and contract surfaces share one read.
  const withSignatories = await Promise.all(
    entities.map(async (e) => ({
      ...e,
      authorisedSignatories: await listEntitySignatories(me.orgId, e.id),
    })),
  );
  res.json({
    entities: withSignatories,
    defaultEntityId: entities.find((e) => e.isDefault)?.id ?? null,
  });
});

// ---- Task #335 — authorised signatories per signing entity ----

const signatoriesBody = z.object({
  userIds: z.array(z.string().trim().min(1).max(120)).max(20),
});

/**
 * Replace the authorised-signatories list of one signing entity.
 * Partner-tier only. Every id must be a live org user. Audited.
 */
// @cli-skip: firm-profile management is UI-driven (Task #335)
router.put("/signing-entities/:entityId/signatories", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!canApproveAsPartner(me.role)) {
    res.status(403).json({
      error: "forbidden",
      message: "Only partners and founding partners manage authorised signatories.",
    });
    return;
  }
  const parsed = signatoriesBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const entityId = String(req.params.entityId);
  const entities = await listSigningEntities(me.orgId);
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) {
    res.status(404).json({ error: "entity-not-found" });
    return;
  }
  const userIds = [...new Set(parsed.data.userIds)];
  if (userIds.length > 0) {
    const users = await db
      .select({ id: atelierUsers.id })
      .from(atelierUsers)
      .where(
        and(
          eq(atelierUsers.orgId, me.orgId),
          inArray(atelierUsers.id, userIds),
          isNull(atelierUsers.deletedAt),
        ),
      );
    const found = new Set(users.map((u) => u.id));
    const unknown = userIds.filter((id) => !found.has(id));
    if (unknown.length > 0) {
      res.status(400).json({
        error: "unknown-users",
        message: `Not active users in this org: ${unknown.join(", ")}`,
      });
      return;
    }
  }
  await db
    .insert(atelierSigningEntitySignatories)
    .values({
      id: rid("sesig"),
      orgId: me.orgId,
      entityId,
      userIds,
      updatedBy: me.id,
      updatedByLabel: me.name,
    })
    .onConflictDoUpdate({
      target: [atelierSigningEntitySignatories.orgId, atelierSigningEntitySignatories.entityId],
      set: {
        userIds,
        updatedBy: me.id,
        updatedByLabel: me.name,
        updatedAt: new Date(),
      },
    });
  await audit({
    entityType: "signing_entity",
    entityId,
    actor: me,
    action: "signing_entity.signatories.updated",
    payload: { entityName: entity.name, userIds },
    summary: `Set ${userIds.length} authorised signator${userIds.length === 1 ? "y" : "ies"} for "${entity.name}"`,
  });
  const authorisedSignatories = await listEntitySignatories(me.orgId, entityId);
  res.json({ entityId, authorisedSignatories });
});

const legalEntitiesBody = z.object({
  entities: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(120).optional(),
        name: z.string().trim().min(1).max(300),
        jurisdiction: z.string().trim().max(300).default(""),
        registeredAddress: z.string().trim().max(600).default(""),
        officeAddress: z.string().trim().max(600).default(""),
        country: z.string().trim().max(120).default(""),
        governingLaw: z.string().trim().max(600).default(""),
        courts: z.string().trim().max(600).default(""),
        isDefault: z.boolean().default(false),
      }),
    )
    .max(20),
});

/**
 * Replace the signing-entity registry on the PUBLISHED firm profile row
 * in place (audited). This is deliberately not a draft/publish cycle:
 * the registry is operational contract-prep data, not brand copy.
 * Exactly one default is enforced server-side.
 */
// @cli-skip: firm-profile management is UI-driven (Task #232)
router.put("/firm-profile/legal-entities", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  if (!ensurePublisher(me, res)) return;
  const parsed = legalEntitiesBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", detail: parsed.error.flatten() });
    return;
  }
  const input = parsed.data.entities;
  const defaults = input.filter((e) => e.isDefault).length;
  if (input.length > 0 && defaults !== 1) {
    res.status(400).json({
      error: "default-required",
      message: "Exactly one signing entity must be marked as the default.",
    });
    return;
  }
  const names = input.map((e) => e.name.toLowerCase());
  if (new Set(names).size !== names.length) {
    res.status(400).json({ error: "duplicate-names", message: "Entity names must be unique." });
    return;
  }
  // Assign stable ids to new entries; keep existing ids untouched so
  // contracts that reference them stay resolvable.
  const withIds = input.map((e) => ({ ...e, id: e.id ?? rid("le") }));
  const ids = withIds.map((e) => e.id);
  if (new Set(ids).size !== ids.length) {
    res.status(400).json({ error: "duplicate-ids", message: "Entity ids must be unique." });
    return;
  }
  const entities = normalizeSigningEntities(withIds);

  let profile = await loadPublishedFirmProfile(me.orgId);
  if (!profile) {
    // Cold registry: create a minimal published profile row to carry it.
    const [{ next }] = await db
      .select({ next: max(atelierFirmProfile.version) })
      .from(atelierFirmProfile)
      .where(orgScope(me));
    const id = rid("frm");
    await db.insert(atelierFirmProfile).values({
      id,
      orgId: me.orgId,
      version: (next ?? 0) + 1,
      status: "published",
      payload: { legalEntities: entities } as never,
      notes: "Created to carry the signing-entity registry",
      createdByUserId: me.id,
      publishedAt: new Date(),
      publishedByUserId: me.id,
      publishedByName: me.name,
    });
    const [row] = await db
      .select()
      .from(atelierFirmProfile)
      .where(and(eq(atelierFirmProfile.id, id), orgScope(me)));
    profile = row;
  } else {
    const payload = { ...(profile.payload as Record<string, unknown>), legalEntities: entities };
    await db
      .update(atelierFirmProfile)
      .set({ payload: payload as never, updatedAt: new Date() })
      .where(and(eq(atelierFirmProfile.id, profile.id), eq(atelierFirmProfile.orgId, me.orgId)));
  }
  await audit({
    entityType: "firm_profile",
    entityId: profile!.id,
    actor: me,
    action: "firm_profile.legal_entities.updated",
    payload: {
      entities: entities.map((e) => ({ id: e.id, name: e.name, isDefault: e.isDefault })),
    },
    summary: `Updated signing-entity registry (${entities.length} entit${entities.length === 1 ? "y" : "ies"})`,
  });
  res.json({
    entities,
    defaultEntityId: entities.find((e) => e.isDefault)?.id ?? null,
  });
});

export default router;
