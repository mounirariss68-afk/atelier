/**
 * Atelier — Reference data routes (Task #290).
 *
 * Endpoints:
 *   GET    /atelier/reference/bootstrap                 (single-shot read for FE hydration)
 *   GET    /atelier/reference/countries
 *   GET    /atelier/reference/industries
 *   GET    /atelier/reference/sub-industries
 *   PATCH  /atelier/reference/countries/:isoAlpha2       (admin: partner | operations)
 *   POST   /atelier/reference/industries                 (admin)
 *   PATCH  /atelier/reference/industries/:code           (admin)
 *   POST   /atelier/reference/sub-industries             (admin)
 *   PATCH  /atelier/reference/sub-industries/:code       (admin)
 *
 * Countries are a closed ISO 3166-1 list — there is no POST: new entries
 * are added by extending COUNTRY_EXTRAS in the seed and re-running it.
 *
 * NOTE on access control: the patch (Persona Replacement, Task #292) will
 * formalize the role set including `operations`. Until then we gate writes
 * on `partner` only, with a TODO marker to widen to `operations` once the
 * persona enum lands.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  atelierUsers,
  atelierCountries,
  atelierIndustries,
  atelierSubIndustries,
  atelierAuditEvents,
} from "@workspace/db";

// =============================================================
// Validation schemas (Task #290) — keep parity with the rigour
// applied in accountRoutes/opportunityRoutes by parsing every
// write body with Zod before touching the DB.
// =============================================================
const STATUS = z.enum(["active", "deprecated"]);
const SHORT_TEXT = z.string().trim().min(1).max(120);
const MED_TEXT = z.string().trim().min(1).max(500);

const PatchCountryBody = z
  .object({
    displayNameEn: SHORT_TEXT.optional(),
    displayNameAr: SHORT_TEXT.nullable().optional(),
    displayNameTr: SHORT_TEXT.nullable().optional(),
    aliases: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
    region: z
      .enum(["MENA", "Africa", "Asia", "Europe", "Americas", "Oceania", "Antarctica"])
      .optional(),
    subRegion: z.string().trim().max(80).nullable().optional(),
    flagEmoji: z.string().min(1).max(8).optional(),
    primaryCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
    primaryLanguage: z.string().min(2).max(8).nullable().optional(),
    dialCode: z.string().regex(/^\+\d{1,4}$/).nullable().optional(),
    vatDefaultPct: z.number().int().min(0).max(50).nullable().optional(),
    isGcc: z.boolean().optional(),
    isAicoTargetMarket: z.boolean().optional(),
    status: STATUS.optional(),
    displayOrderOverride: z.number().int().min(0).max(9999).nullable().optional(),
  })
  .strict();

const CreateIndustryBody = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z_]{1,15}$/),
    displayNameEn: SHORT_TEXT,
    displayNameAr: SHORT_TEXT.nullable().optional(),
    shortDescription: MED_TEXT.nullable().optional(),
    displayOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

const PatchIndustryBody = z
  .object({
    displayNameEn: SHORT_TEXT.optional(),
    displayNameAr: SHORT_TEXT.nullable().optional(),
    shortDescription: MED_TEXT.nullable().optional(),
    displayOrder: z.number().int().min(0).max(9999).optional(),
    status: STATUS.optional(),
  })
  .strict();

const CreateSubIndustryBody = z
  .object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,40}$/),
    industryCode: z.string().regex(/^[A-Z][A-Z_]{1,15}$/),
    displayNameEn: SHORT_TEXT,
    displayNameAr: SHORT_TEXT.nullable().optional(),
    shortDescription: MED_TEXT, // patch §6.1 — required on create
    defaultOfferingAnchor: z.string().trim().min(1).max(40), // patch §6.1 — required on create
    displayOrder: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

const PatchSubIndustryBody = z
  .object({
    displayNameEn: SHORT_TEXT.optional(),
    displayNameAr: SHORT_TEXT.nullable().optional(),
    shortDescription: MED_TEXT.nullable().optional(),
    defaultOfferingAnchor: z.string().trim().min(1).max(40).nullable().optional(),
    displayOrder: z.number().int().min(0).max(9999).optional(),
    status: STATUS.optional(),
  })
  .strict();

const router: IRouter = Router();

function ensurePersona(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  if (!req.atelierPersona) {
    res.status(401).json({ error: "no-active-persona" });
    return null;
  }
  return req.atelierPersona;
}

// TODO (Task #292): widen to (role === 'partner' || role === 'operations')
// once the 9-persona enum migration lands.
function canAdminReferenceData(me: typeof atelierUsers.$inferSelect): boolean {
  return me.role === "partner" || me.role === "operations";
}

function requireAdmin(req: Request, res: Response): typeof atelierUsers.$inferSelect | null {
  const me = ensurePersona(req, res);
  if (!me) return null;
  if (!canAdminReferenceData(me)) {
    res.status(403).json({ error: "reference-data-admin-only" });
    return null;
  }
  return me;
}

async function audit(
  me: typeof atelierUsers.$inferSelect,
  entityType: string,
  entityId: string,
  action: string,
  payload: Record<string, unknown>,
  summary: string,
) {
  await db.insert(atelierAuditEvents).values({
    id: `aud_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    entityType,
    entityId,
    actorType: "human",
    actorId: me.id,
    actorLabel: me.name,
    action,
    payload,
    payloadSummary: summary,
  });
}

// =============================================================
// READ — bootstrap (one fetch for the FE combobox)
// =============================================================
router.get("/reference/bootstrap", async (req, res) => {
  const me = ensurePersona(req, res);
  if (!me) return;
  const includeDeprecated = req.query.includeDeprecated === "true";
  const [countriesRows, industriesRows, subRows] = await Promise.all([
    db.select().from(atelierCountries),
    db.select().from(atelierIndustries),
    db.select().from(atelierSubIndustries),
  ]);
  const filterActive = <T extends { status: string }>(rows: T[]) =>
    includeDeprecated ? rows : rows.filter((r) => r.status === "active");
  res.json({
    countries: filterActive(countriesRows),
    industries: filterActive(industriesRows),
    subIndustries: filterActive(subRows),
  });
});

router.get("/reference/countries", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  const includeDeprecated = req.query.includeDeprecated === "true";
  const rows = await db.select().from(atelierCountries);
  res.json(includeDeprecated ? rows : rows.filter((r) => r.status === "active"));
});

router.get("/reference/industries", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  const includeDeprecated = req.query.includeDeprecated === "true";
  const rows = await db.select().from(atelierIndustries);
  res.json(includeDeprecated ? rows : rows.filter((r) => r.status === "active"));
});

router.get("/reference/sub-industries", async (req, res) => {
  if (!ensurePersona(req, res)) return;
  const includeDeprecated = req.query.includeDeprecated === "true";
  const rows = await db.select().from(atelierSubIndustries);
  res.json(includeDeprecated ? rows : rows.filter((r) => r.status === "active"));
});

// =============================================================
// WRITE — countries
// =============================================================
router.patch("/reference/countries/:isoAlpha2", async (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const iso = String(req.params.isoAlpha2 ?? "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(iso)) {
    res.status(400).json({ error: "invalid-iso" });
    return;
  }
  const parsed = PatchCountryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.flatten() });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierCountries)
    .where(eq(atelierCountries.isoAlpha2, iso));
  if (!existing) {
    res.status(404).json({ error: "country-not-found" });
    return;
  }
  // Cannot mutate ISO codes (patch §6.1) — Zod schema does not include them.
  const patch: Partial<typeof atelierCountries.$inferInsert> = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  const [updated] = await db
    .update(atelierCountries)
    .set(patch)
    .where(eq(atelierCountries.isoAlpha2, iso))
    .returning();

  await audit(
    me,
    "reference_country",
    iso,
    "reference.country.update",
    { before: existing, after: updated },
    `${me.name} updated country ${iso}`,
  );

  res.json(updated);
});

// =============================================================
// WRITE — industries
// =============================================================
router.post("/reference/industries", async (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const parsed = CreateIndustryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.flatten() });
    return;
  }
  const code = parsed.data.code.toUpperCase();
  const [existing] = await db
    .select()
    .from(atelierIndustries)
    .where(eq(atelierIndustries.code, code));
  if (existing) {
    res.status(409).json({ error: "industry-exists" });
    return;
  }
  const [created] = await db
    .insert(atelierIndustries)
    .values({
      code,
      displayNameEn: parsed.data.displayNameEn,
      displayNameAr: parsed.data.displayNameAr ?? null,
      shortDescription: parsed.data.shortDescription ?? null,
      displayOrder: parsed.data.displayOrder ?? 99,
      status: "active",
      createdByUserId: me.id,
    })
    .returning();

  await audit(
    me,
    "reference_industry",
    code,
    "reference.industry.create",
    { row: created },
    `${me.name} created industry ${code}`,
  );

  res.json(created);
});

router.patch("/reference/industries/:code", async (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const code = String(req.params.code ?? "").toUpperCase();
  if (!/^[A-Z][A-Z_]{1,15}$/.test(code)) {
    res.status(400).json({ error: "invalid-code" });
    return;
  }
  const parsed = PatchIndustryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.flatten() });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierIndustries)
    .where(eq(atelierIndustries.code, code));
  if (!existing) {
    res.status(404).json({ error: "industry-not-found" });
    return;
  }
  const patch: Partial<typeof atelierIndustries.$inferInsert> = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  const [updated] = await db
    .update(atelierIndustries)
    .set(patch)
    .where(eq(atelierIndustries.code, code))
    .returning();

  await audit(
    me,
    "reference_industry",
    code,
    "reference.industry.update",
    { before: existing, after: updated },
    `${me.name} updated industry ${code}`,
  );

  res.json(updated);
});

// =============================================================
// WRITE — sub-industries
// =============================================================
router.post("/reference/sub-industries", async (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const parsed = CreateSubIndustryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.flatten() });
    return;
  }
  const code = parsed.data.code.toUpperCase();
  const industryCode = parsed.data.industryCode.toUpperCase();
  const [parent] = await db
    .select()
    .from(atelierIndustries)
    .where(eq(atelierIndustries.code, industryCode));
  if (!parent) {
    res.status(400).json({ error: "parent-industry-not-found" });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierSubIndustries)
    .where(eq(atelierSubIndustries.code, code));
  if (existing) {
    res.status(409).json({ error: "sub-industry-exists" });
    return;
  }
  const [created] = await db
    .insert(atelierSubIndustries)
    .values({
      code,
      industryCode,
      displayNameEn: parsed.data.displayNameEn,
      displayNameAr: parsed.data.displayNameAr ?? null,
      shortDescription: parsed.data.shortDescription,
      displayOrder: parsed.data.displayOrder ?? 99,
      status: "active",
      defaultOfferingAnchor: parsed.data.defaultOfferingAnchor,
      createdByUserId: me.id,
    })
    .returning();

  await audit(
    me,
    "reference_sub_industry",
    code,
    "reference.sub_industry.create",
    { row: created },
    `${me.name} created sub-industry ${code} under ${industryCode}`,
  );

  res.json(created);
});

router.patch("/reference/sub-industries/:code", async (req, res) => {
  const me = requireAdmin(req, res);
  if (!me) return;
  const code = String(req.params.code ?? "").toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,40}$/.test(code)) {
    res.status(400).json({ error: "invalid-code" });
    return;
  }
  const parsed = PatchSubIndustryBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "invalid-body", issues: parsed.error.flatten() });
    return;
  }
  const [existing] = await db
    .select()
    .from(atelierSubIndustries)
    .where(eq(atelierSubIndustries.code, code));
  if (!existing) {
    res.status(404).json({ error: "sub-industry-not-found" });
    return;
  }
  const patch: Partial<typeof atelierSubIndustries.$inferInsert> = {
    ...parsed.data,
    updatedAt: new Date(),
  };

  const [updated] = await db
    .update(atelierSubIndustries)
    .set(patch)
    .where(eq(atelierSubIndustries.code, code))
    .returning();

  await audit(
    me,
    "reference_sub_industry",
    code,
    "reference.sub_industry.update",
    { before: existing, after: updated },
    `${me.name} updated sub-industry ${code}`,
  );

  res.json(updated);
});

// Suppress an unused-warning for `and` (kept for future combined filters).
void and;

export default router;
